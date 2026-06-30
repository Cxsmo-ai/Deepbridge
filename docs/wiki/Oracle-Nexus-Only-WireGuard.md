# Oracle Nexus Only WireGuard

This guide routes only `nexus.miatrix.com` traffic through WireGuard on an Oracle Cloud VM. Everything else stays on the normal Oracle network.

Use this if you want Nexus/Miatrix to see the VPN IP while Deepbrid, Easynews, DockerHub, Stremio, Traefik, SSH, and normal server traffic keep using the regular VM IP.

## Important warning

Do not set `AllowedIPs = 0.0.0.0/0` in the normal WireGuard way unless you want the whole VM to use the VPN.

This guide uses:

- WireGuard interface `wg-nexus`.
- A separate routing table.
- `nftables` marking only Nexus destination IPs.
- A DNS refresh script because website IPs can change.
- A block fallback so Nexus does not silently leak over the normal Oracle IP if VPN routing breaks.

## 1. Install packages

```bash
sudo apt update
sudo apt install -y wireguard resolvconf nftables dnsutils curl
```

## 2. Get a WireGuard config

From your VPN provider, download a WireGuard config for a nearby server.

For Mullvad:

- https://mullvad.net/
- https://mullvad.net/en/account/wireguard-config

Pick a server close to your region. Save the config as:

```text
/etc/wireguard/wg-nexus.conf
```

Protect it:

```bash
sudo chmod 600 /etc/wireguard/wg-nexus.conf
```

## 3. Edit the WireGuard config

Open:

```bash
sudo nano /etc/wireguard/wg-nexus.conf
```

Make sure the peer has:

```ini
AllowedIPs = 0.0.0.0/0, ::/0
Table = off
```

`Table = off` is the key. It prevents WireGuard from replacing the VM's normal default route.

Example shape:

```ini
[Interface]
PrivateKey = your_private_key
Address = 10.x.x.x/32
DNS = 10.x.x.x
Table = off

[Peer]
PublicKey = vpn_server_public_key
Endpoint = vpn-server.example:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
```

Do not commit this file to GitHub.

## 4. Create routing table

Add a table name:

```bash
echo "200 nexusvpn" | sudo tee -a /etc/iproute2/rt_tables
```

Start WireGuard:

```bash
sudo systemctl enable --now wg-quick@wg-nexus
```

Find the VPN gateway:

```bash
ip addr show wg-nexus
```

Usually you can route through the interface directly:

```bash
sudo ip route add default dev wg-nexus table nexusvpn
sudo ip rule add fwmark 0x66 table nexusvpn
```

Make it persistent by creating:

```bash
sudo nano /etc/systemd/system/nexus-policy-route.service
```

Paste:

```ini
[Unit]
Description=Nexus-only WireGuard policy route
After=wg-quick@wg-nexus.service
Requires=wg-quick@wg-nexus.service

[Service]
Type=oneshot
ExecStart=/usr/sbin/ip route replace default dev wg-nexus table nexusvpn
ExecStart=/usr/sbin/ip rule add fwmark 0x66 table nexusvpn
ExecStop=/usr/sbin/ip rule del fwmark 0x66 table nexusvpn
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nexus-policy-route
```

## 5. Create nftables marking rules

Create:

```bash
sudo nano /etc/nftables.d/nexus-only-vpn.nft
```

Paste:

```nft
table inet nexus_only_vpn {
  set nexus4 {
    type ipv4_addr
    flags interval
  }

  chain output {
    type route hook output priority mangle; policy accept;
    ip daddr @nexus4 meta mark set 0x66
  }

  chain block_nexus_leak {
    type filter hook output priority filter; policy accept;
    ip daddr @nexus4 oifname != "wg-nexus" reject
  }
}
```

Include it from `/etc/nftables.conf`:

```bash
sudo nano /etc/nftables.conf
```

Make sure it contains:

```nft
#!/usr/sbin/nft -f
flush ruleset
include "/etc/nftables.d/*.nft"
```

Enable nftables:

```bash
sudo systemctl enable --now nftables
```

## 6. Refresh Nexus IPs automatically

Create:

```bash
sudo nano /usr/local/sbin/update-nexus-vpn-set.sh
```

Paste:

```bash
#!/usr/bin/env bash
set -euo pipefail

HOSTS=("nexus.miatrix.com")
IPS=()

for host in "${HOSTS[@]}"; do
  while read -r ip; do
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && IPS+=("$ip")
  done < <(dig +short A "$host")
done

if [ "${#IPS[@]}" -eq 0 ]; then
  echo "No Nexus IPs resolved; leaving nft set unchanged" >&2
  exit 1
fi

nft flush set inet nexus_only_vpn nexus4
for ip in "${IPS[@]}"; do
  nft add element inet nexus_only_vpn nexus4 "{ $ip }"
done

printf 'Nexus IPs routed through wg-nexus: %s\n' "${IPS[*]}"
```

Make executable:

```bash
sudo chmod +x /usr/local/sbin/update-nexus-vpn-set.sh
sudo /usr/local/sbin/update-nexus-vpn-set.sh
```

Create a timer:

```bash
sudo nano /etc/systemd/system/update-nexus-vpn-set.service
```

```ini
[Unit]
Description=Refresh Nexus/Miatrix VPN destination IP set

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/update-nexus-vpn-set.sh
```

```bash
sudo nano /etc/systemd/system/update-nexus-vpn-set.timer
```

```ini
[Unit]
Description=Refresh Nexus/Miatrix VPN destination IP set every 15 minutes

[Timer]
OnBootSec=30
OnUnitActiveSec=15min
Unit=update-nexus-vpn-set.service

[Install]
WantedBy=timers.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now update-nexus-vpn-set.timer
```

## 7. Test that only Nexus uses the VPN

Normal public IP:

```bash
curl -4 https://ifconfig.me
```

Nexus route check:

```bash
NEXUS_IP="$(dig +short A nexus.miatrix.com | head -n1)"
ip route get "$NEXUS_IP" mark 0x66
```

Expected:

```text
dev wg-nexus table nexusvpn
```

Confirm Deepbrid is not marked:

```bash
DEEPBRID_IP="$(dig +short A www.deepbrid.com | head -n1)"
ip route get "$DEEPBRID_IP"
```

Expected:

```text
dev ens...
```

Confirm the nft set:

```bash
sudo nft list set inet nexus_only_vpn nexus4
```

## 8. Test from Deepbridge

Restart Deepbridge:

```bash
podman restart deepbridge
```

Open a stream search that uses Nexus/Miatrix, then check:

```bash
podman logs --since 5m deepbridge
curl https://your-deepbridge-domain.example/health
```

The goal:

- Nexus website requests go through `wg-nexus`.
- Deepbrid API and playback resolving do not.
- SSH stays reachable.
- DockerHub pulls still use normal Oracle networking.

## Troubleshooting

If Nexus stops working:

```bash
sudo systemctl status wg-quick@wg-nexus
sudo systemctl status nexus-policy-route
sudo systemctl status nftables
sudo /usr/local/sbin/update-nexus-vpn-set.sh
sudo nft list ruleset
```

If SSH breaks, you probably routed the whole VM through the VPN. Recheck `Table = off` and remove unwanted default routes from the main table.

