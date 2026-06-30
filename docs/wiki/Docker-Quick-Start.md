# Docker Quick Start

Use this if you already have Docker installed.

## Requirements

- A machine that can run Docker.
- A Deepbrid API key.
- A public HTTPS URL if you want to install the addon outside your home network.

## Pull the image

```bash
docker pull pickymarker/deepbridge:latest
```

The `latest` tag is multi-architecture and supports `linux/amd64` and `linux/arm64`.

## Create `.env`

```env
PORT=7000
BASE_URL=http://localhost:7000
DEEPBRID_API_KEY=your_deepbrid_api_key_here
NODE_ENV=production
```

For a public server, set `BASE_URL` to your HTTPS URL:

```env
BASE_URL=https://deepbridge.example.com
```

## Run with Docker

```bash
docker run -d \
  --name deepbridge \
  --restart unless-stopped \
  -p 7000:7000 \
  --env-file .env \
  pickymarker/deepbridge:latest
```

Open:

```text
http://localhost:7000
```

## Run with Docker Compose

Create `docker-compose.yml`:

```yaml
services:
  deepbridge:
    image: pickymarker/deepbridge:latest
    container_name: deepbridge
    restart: unless-stopped
    env_file: .env
    ports:
      - "7000:7000"
```

Start:

```bash
docker compose up -d
```

Logs:

```bash
docker compose logs -f deepbridge
```

Update:

```bash
docker compose pull
docker compose up -d
```

Stop:

```bash
docker compose down
```

