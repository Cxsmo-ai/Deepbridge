# Oracle Cloud Podman Guide

This guide is for a simple Oracle Cloud VM using Podman.

## 1. Create the VM

1. Create an Oracle Cloud account.
2. Create an ARM or AMD VM.
3. Use Ubuntu.
4. Open inbound ports for HTTP/HTTPS through your reverse proxy.
5. SSH into the VM.

Useful Oracle link:

- https://www.oracle.com/cloud/

## 2. Install basic packages

```bash
sudo apt update
sudo apt install -y podman curl git ufw
```

## 3. Create a Podman network

If you use Traefik, create a shared proxy network:

```bash
podman network create proxynet
```

## 4. Create the Deepbridge env file

```bash
mkdir -p ~/deepbridge
cd ~/deepbridge
nano .env
```

Example:

```env
PORT=7000
BASE_URL=https://your-deepbridge-domain.example
DEEPBRID_API_KEY=your_deepbrid_api_key_here
NODE_ENV=production
```

Do not commit `.env` to GitHub.

## 5. Run Deepbridge directly with Podman

```bash
podman pull docker.io/pickymarker/deepbridge:latest

podman run -d \
  --name deepbridge \
  --network proxynet \
  --env-file ~/deepbridge/.env \
  --label traefik.enable=true \
  --label traefik.http.routers.deepbridge.entrypoints=websecure \
  --label 'traefik.http.routers.deepbridge.rule=Host(`your-deepbridge-domain.example`)' \
  --label traefik.http.routers.deepbridge.tls.certresolver=myresolver \
  --label traefik.http.services.deepbridge.loadbalancer.server.port=7000 \
  docker.io/pickymarker/deepbridge:latest
```

If you do not use Traefik, publish the port instead:

```bash
podman run -d \
  --name deepbridge \
  --restart unless-stopped \
  -p 7000:7000 \
  --env-file ~/deepbridge/.env \
  docker.io/pickymarker/deepbridge:latest
```

## 6. Make it survive reboot

For user services:

```bash
mkdir -p ~/.config/systemd/user
podman generate systemd --new --name deepbridge --files
mv container-deepbridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now container-deepbridge.service
loginctl enable-linger "$USER"
```

## 7. Update Deepbridge

```bash
podman pull docker.io/pickymarker/deepbridge:latest
podman stop deepbridge
podman rm deepbridge
```

Then run the same `podman run` command again.

## 8. Check logs and health

```bash
podman logs -f deepbridge
curl http://127.0.0.1:7000/health
```

From outside the server:

```text
https://your-deepbridge-domain.example/manifest.json
```

You should get JSON, not `404` or `Bad Gateway`.

