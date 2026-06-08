# Deepbridge

<p align="center">
  <strong>A polished Stremio addon for Deepbrid-powered streaming with official sources plus pre-resolved external Usenet indexer results.</strong>
</p>

<p align="center">
  <a href="https://github.com/Cxsmo-ai/Deepbridge/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Cxsmo-ai/Deepbridge/ci.yml?branch=main&style=for-the-badge&label=CI"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/actions/workflows/publish-docker.yml"><img alt="Docker Hub publish" src="https://img.shields.io/github/actions/workflow/status/Cxsmo-ai/Deepbridge/publish-docker.yml?branch=main&style=for-the-badge&label=Docker%20Hub"></a>
  <a href="https://hub.docker.com/r/pickymarker/deepbridge"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/pickymarker/deepbridge?style=for-the-badge&logo=docker"></a>
  <a href="https://hub.docker.com/r/pickymarker/deepbridge"><img alt="Docker image size" src="https://img.shields.io/docker/image-size/pickymarker/deepbridge/latest?style=for-the-badge&logo=docker"></a>
  <a href="https://hub.docker.com/r/pickymarker/deepbridge"><img alt="Docker stars" src="https://img.shields.io/docker/stars/pickymarker/deepbridge?style=for-the-badge&logo=docker"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/releases"><img alt="Release downloads" src="https://img.shields.io/github/downloads/Cxsmo-ai/Deepbridge/total?style=for-the-badge&label=Release%20downloads"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Cxsmo-ai/Deepbridge?style=for-the-badge"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Cxsmo-ai/Deepbridge?style=for-the-badge"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/Cxsmo-ai/Deepbridge?style=for-the-badge"></a>
</p>
<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/DOCKER.md">Docker</a> ·
  <a href="docs/CONFIGURATION.md">Configuration</a> ·
  <a href="docs/TROUBLESHOOTING.md">Troubleshooting</a> ·
  <a href="docs/METRICS.md">Live metrics</a> ·
  <a href="SECURITY.md">Security</a>
</p>

---

## Pull from Docker Hub

Docker Hub image:

```text
https://hub.docker.com/r/pickymarker/deepbridge
```

Image name:

```text
pickymarker/deepbridge:latest
```

Pull command:

```bash
docker pull pickymarker/deepbridge:latest
```

Run it:

```bash
docker run --rm \
  --name deepbridge \
  -p 7000:7000 \
  --env-file .env \
  pickymarker/deepbridge:latest
```

## What is Deepbridge?

Deepbridge is a self-hosted Stremio addon that bridges Stremio, Deepbrid, and optional Newznab-compatible Usenet indexers. It combines Deepbrid official streams with external indexer NZBs resolved through Deepbrid, then presents clean, ranked Stremio stream cards.

Deepbridge is built for people who want a simple addon URL, a clean configuration page, Docker-friendly deployment, and direct playback links from Deepbrid/myfast rather than proxying large video traffic through the addon server.

## Highlights

- Deepbrid official stream support.
- Optional external Usenet indexer support.
- Direct external result mode: pre-adds/prechecks more indexer NZBs through Deepbrid before showing them.
- External pregrab: indexer NZBs are submitted to Deepbrid before being shown as direct playback links.
- Broken external results are hidden when Deepbrid cannot expose a video file.
- Archive/RAR results are filtered from external results.
- Direct final playback URLs; the addon does not proxy video by default.
- Movie, series, and anime-friendly ID parsing.
- Better release parsing for resolution, quality, codec, HDR, audio, release group, season packs, and single episodes.
- Clean Stremio stream cards with source, readiness, size, and metadata.
- Docker, Docker Compose, and local Node.js workflows.
- Health endpoints for addon status, local resolve cache, and sanitized Deepbrid API/download-cache checks.
- GitHub-ready project structure with CI, support, security, and contribution templates.

## External result modes

Deepbridge supports two external Newznab/AltHub result modes from the dashboard:

- `Direct Deepbrid links` - recommended. Attempts more AltHub/Newznab candidates through Deepbrid and only shows streams after Deepbrid returns a direct playable URL.
- `Strict prechecked` - faster/stricter. Attempts fewer candidates and only shows streams confirmed playable during the stream request.

Both modes avoid exposing unresolved addon proxy links in Stremio results. External streams shown in Stremio are direct Deepbrid/myfast playback URLs.

## Health checks

```text
/health
/<configuration-token>/health
```

Health responses include addon status, local resolve cache/in-flight counts, last Deepbrid add/precheck stats, and sanitized Deepbrid API/download-cache status. They do not expose API keys, indexer keys, playback URLs, or NZB URLs.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/Cxsmo-ai/Deepbridge.git
cd deepbridge
npm ci
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=7000
BASE_URL=http://localhost:7000
DEEPBRID_API_KEY=your_deepbrid_api_key_here
```

### 3. Run locally

```bash
npm run dev
```

Open:

```text
http://localhost:7000
```

### 4. Install in Stremio

Use the generated manifest URL from the web configuration page, or manually install:

```text
http://localhost:7000/<configuration-token>/manifest.json
```

For a public deployment behind HTTPS:

```text
https://your-domain.example/<configuration-token>/manifest.json
```



## Live metrics and downloads

The README includes live badges for CI, Docker Hub publishing, Docker Hub pulls, Docker Hub image size, Docker Hub stars, release downloads, stars, forks, and license status.

- Release download counts are tracked live by GitHub/Shields once release assets are published.
- Docker Hub exposes public live pull/star/image-size badges for `pickymarker/deepbridge`.
- Docker Hub is the primary published image so public pull stats reflect normal install usage.

See [docs/METRICS.md](docs/METRICS.md) for what can and cannot be tracked live.

## Prebuilt container image

Deepbridge publishes Docker images to Docker Hub:

```bash
docker pull pickymarker/deepbridge:latest
```

Run the published image:

```bash
docker run --rm \
  --name deepbridge \
  -p 7000:7000 \
  --env-file .env \
  pickymarker/deepbridge:latest
```

## Docker quick start

```bash
docker build -t deepbridge:local .
docker run --rm -p 7000:7000 --env-file .env deepbridge:local
```

Or with Docker Compose:

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

See [docs/DOCKER.md](docs/DOCKER.md) for production notes.


## Dashboard

Deepbridge includes a browser dashboard at the addon root URL. The dashboard generates private Stremio manifest links, manages Deepbrid/indexer configuration, and includes the project support panel with the Deepbrid referral guide.

See [docs/DASHBOARD.md](docs/DASHBOARD.md) for the full dashboard and support-panel documentation.
## Configuration

Deepbridge can be configured globally with environment variables or per-user with the web configuration page.

Core environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port. Defaults to `7000`. |
| `BASE_URL` | Recommended in production | Public addon base URL, e.g. `https://deepbridge.example.com`. |
| `DEEPBRID_API_KEY` | Optional if using per-user config | Fallback Deepbrid API key. |
| `NODE_ENV` | No | Set to `production` in hosted deployments. |

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Architecture

```text
Stremio
  │
  ▼
Deepbridge addon
  ├─ Deepbrid official addon sources
  ├─ External Newznab-compatible indexers
  ├─ Release parsing/ranking/deduplication
  ├─ External pregrab via Deepbrid
  └─ Direct final Deepbrid/myfast playback URLs
```

Deepbridge is intentionally not a video proxy. It prepares stream results and returns direct playback URLs so media bandwidth comes from Deepbrid servers, not your addon host.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 🎁 Support The Project: Deepbrid Referral Guide

<p align="center">
  <a href="https://www.deepbrid.com/aff/go/pickymarker4906?i=4" target="_blank" rel="noopener noreferrer">
    <img src="https://www.deepbrid.com/file/get/path/banners.5ea0998723b53/i/236387" alt="Deepbrid Banner" width="728">
  </a>
</p>

This vendor package is **100% free and open-source**. However, maintaining and updating this project takes significant time and effort.

The **ONLY** way to support this project and ensure its continued development is by using our **Deepbrid Referral Link** when you sign up or renew your account.

<p align="center">
  <strong><a href="https://www.deepbrid.com/aff/go/pickymarker4906">👉 CLICK HERE TO SIGN UP FOR DEEPBRID 👈</a></strong>
</p>

### 🛑 How to Properly Use the Referral Link (IMPORTANT)

To ensure the referral tracks correctly and supports the project, please follow these exact steps:

1. **Clear Your Cookies/Cache** (or use an Incognito/Private Browsing window) to ensure no old tracking cookies interfere.
2. **Click this exact link**: <https://www.deepbrid.com/aff/go/pickymarker4906>
3. **Create your account** or **log in** immediately after clicking the link.
4. **Purchase your premium plan** in the same browsing session.

> [!IMPORTANT]
> If you navigate away and come back later, the referral tracking might drop. **Always click the link right before making your purchase!**

> [!NOTE]
> GitHub README files do not render raw `<iframe>` embeds for security reasons, so this README uses the GitHub-supported clickable banner image above.
## Support status

Deepbridge is community software. It is not affiliated with Stremio, Deepbrid, or any indexer provider.

For support:

1. Read [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
2. Check [docs/FAQ.md](docs/FAQ.md).
3. Open a GitHub issue with sanitized logs.

Never paste API keys, Stremio config tokens, private domains, IP addresses, or SSH key paths into issues.

## Security and privacy

- Keep Deepbrid API keys private.
- Do not commit `.env` files.
- Do not publish generated Stremio config tokens.
- External indexer URLs and API keys should be treated as secrets.
- Use HTTPS for public deployments.

See [SECURITY.md](SECURITY.md).

## Development

```bash
npm ci
npm run build
npm run dev
```

Project layout:

```text
src/
  core/       Release parsing, scoring, media keys, shared types
  deepbrid/   Deepbrid API and official source adapter
  indexer/    External indexer search
  stremio/    Manifest and Stremio stream formatting
  server.ts   Fastify HTTP server and routes
public/       Configuration UI
docs/         Documentation
.github/      GitHub workflows and templates
```

## License

Apache-2.0. See [LICENSE](LICENSE).
