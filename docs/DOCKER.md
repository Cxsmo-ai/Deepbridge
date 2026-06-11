# Docker

Deepbridge is designed to run well in Docker.

## Published container images

Images are published to Docker Hub on pushes to `main` and version tags. Published tags are multi-architecture images for `linux/amd64` and `linux/arm64`:

```bash
docker pull pickymarker/deepbridge:latest
```

Run the published Docker Hub image:

```bash
docker run --rm \
  --name deepbridge \
  -p 7000:7000 \
  --env-file .env \
  pickymarker/deepbridge:latest
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
NEWSHOSTING_USERNAME=
NEWSHOSTING_PASSWORD=
NEWSHOSTING_SERVER_HOST=srv.aboutusenet.com
NEWSHOSTING_SERVER_IP=81.171.93.8
NEWSHOSTING_SERVER_PORT=5598
NEWSHOSTING_MAX_NZB_FILES=160
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
