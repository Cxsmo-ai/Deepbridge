# Docker

Deepbridge is designed to run well in Docker.

## Published GHCR image

Images are published to GitHub Container Registry on pushes to `main` and version tags:

```bash
docker pull ghcr.io/cxsmo-ai/deepbridge:latest
```

Run the published image:

```bash
docker run --rm \
  --name deepbridge \
  -p 7000:7000 \
  --env-file .env \
  ghcr.io/cxsmo-ai/deepbridge:latest
```

Available tags normally include:

- `latest`
- `main`
- `sha-<commit>`
- semantic version tags when pushing `vX.Y.Z`

## Build locally

```bash
docker build -t deepbridge:local .
```

## Run local build with Docker

```bash
docker run --rm \
  --name deepbridge \
  -p 7000:7000 \
  --env-file .env \
  deepbridge:local
```

Open:

```text
http://localhost:7000
```

## Docker Compose

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

View logs:

```bash
docker compose logs -f deepbridge
```

Stop:

```bash
docker compose down
```

## Environment

Recommended production values:

```env
PORT=7000
BASE_URL=https://deepbridge.example.com
DEEPBRID_API_KEY=your_deepbrid_api_key_here
NODE_ENV=production
```

`BASE_URL` should be the public HTTPS URL users install in Stremio.

## Reverse proxy

Deepbridge works behind reverse proxies such as Traefik, Caddy, Nginx, or Cloudflare Tunnel. Make sure the public URL is HTTPS and matches `BASE_URL`.

## Health check

```bash
curl http://localhost:7000/health
```

Expected:

```json
{"status":"ok"}
```
