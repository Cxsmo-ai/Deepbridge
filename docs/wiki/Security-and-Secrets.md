# Security and Secrets

Treat Deepbridge configuration as private.

## Never share publicly

- Deepbrid API key.
- Generated Stremio manifest URL.
- Dashboard configuration token.
- Easynews username/password.
- Newshosting username/password.
- Nexus/Miatrix cookie.
- Nexus/Miatrix email/password.
- External indexer API keys.
- Deepbrid Finder pairing URL.
- SSH private keys.
- WireGuard private keys.
- Final playback URLs.

## Safe to share

- Public GitHub repo URL.
- Docker Hub image name.
- Sanitized logs.
- Health output with secrets redacted.
- Error messages with tokens removed.

## Env files

Keep `.env` on your server only.

Do not commit:

```text
.env
*.key
*.pem
wg*.conf
```

## GitHub issues

When asking for help:

1. Remove API keys.
2. Remove config tokens.
3. Remove cookies.
4. Remove playback URLs.
5. Replace your domain with `example.com` if needed.

## Browser extension safety

The Finder bridge is designed so browser cookies stay in the browser. The extension pairs to one Deepbridge configuration using a random bridge ID and secret. Do not post the pairing URL publicly.

## WireGuard safety

WireGuard config files contain private keys. Store them only on the VM:

```bash
sudo chmod 600 /etc/wireguard/wg-nexus.conf
```

Do not put VPN configs in the Deepbridge repo.

