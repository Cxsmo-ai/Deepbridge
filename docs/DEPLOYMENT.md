# Deployment

This document describes safe deployment patterns without including real infrastructure details.

## Golden rules

- Do not publish API keys.
- Do not publish SSH key paths.
- Do not publish private IP addresses or hostnames unless intended.
- Use HTTPS for public Stremio addon URLs.
- Set `BASE_URL` to the public URL of your deployment.

## Generic VM deployment flow

1. Provision a Linux VM.
2. Install Docker or Podman.
3. Clone your Deepbridge repository.
4. Create `.env` from `.env.example`.
5. Start with Docker Compose.
6. Put a reverse proxy in front for HTTPS.

Example:

```bash
git clone https://github.com/YOUR_USERNAME/deepbridge.git
cd deepbridge
cp .env.example .env
nano .env
docker compose up -d --build
```

## Reverse proxy checklist

- Public hostname points at your VM.
- TLS certificate is valid.
- Proxy forwards to `deepbridge:7000` or `127.0.0.1:7000`.
- `BASE_URL=https://your-domain.example`.
- `/health` returns `{"status":"ok"}`.

## Stremio install URL

```text
https://your-domain.example/<configuration-token>/manifest.json
```

## Safe deployment templates

Use `deploy/` templates as examples only. Replace placeholders locally and never commit real secrets.
