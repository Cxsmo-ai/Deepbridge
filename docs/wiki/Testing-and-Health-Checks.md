# Testing and Health Checks

## Basic health

Local:

```bash
curl http://127.0.0.1:7000/health
```

Public:

```bash
curl https://your-deepbridge-domain.example/health
```

Manifest:

```bash
curl https://your-deepbridge-domain.example/manifest.json
```

Expected:

- `/health` returns status JSON.
- `/manifest.json` returns Stremio manifest JSON.
- Public URL is HTTPS in production.

## Per-config health

Use your generated config token:

```text
https://your-deepbridge-domain.example/<token>/health
```

This returns sanitized status for that configuration.

It should not expose:

- API keys.
- Passwords.
- Indexer keys.
- NZB URLs.
- Playback URLs.

## Container logs

Docker:

```bash
docker logs -f deepbridge
```

Docker Compose:

```bash
docker compose logs -f deepbridge
```

Podman:

```bash
podman logs -f deepbridge
```

## Test Stremio flow

1. Install the manifest URL in Stremio.
2. Open a known movie.
3. Open a known TV episode.
4. Check stream cards.
5. Select one stream.
6. Confirm playback starts.
7. Check logs for errors.

## Good test titles

Use items that exist in your own sources:

- A common movie in Deepbrid official streams.
- A ready torrent from your Deepbrid My Library.
- A known Easynews result if Easynews is enabled.
- A known Newshosting result if Newshosting is enabled.
- A known Nexus/Miatrix result if Nexus is enabled.

## GitHub Actions

The repo has CI and Docker publish workflows:

- https://github.com/Cxsmo-ai/Deepbridge/actions

The Docker image is published here:

- https://hub.docker.com/r/pickymarker/deepbridge

