# Deepbridge

<p align="center">
  <strong>A polished Stremio addon for Deepbrid-powered streaming with official sources, built-in Easynews/Newshosting/Nexus website support, and pre-resolved external Usenet indexer results.</strong>
</p>

<p align="center">
  <a href="https://github.com/Cxsmo-ai/Deepbridge/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Cxsmo-ai/Deepbridge/ci.yml?branch=main&style=for-the-badge&label=CI"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/actions/workflows/publish-docker.yml"><img alt="Docker Hub publish" src="https://img.shields.io/github/actions/workflow/status/Cxsmo-ai/Deepbridge/publish-docker.yml?branch=main&style=for-the-badge&label=Docker%20Hub"></a>
  <a href="https://hub.docker.com/r/pickymarker/deepbridge"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/pickymarker/deepbridge?style=for-the-badge&logo=docker"></a>
  <a href="https://hub.docker.com/r/pickymarker/deepbridge"><img alt="Docker image size" src="https://img.shields.io/docker/image-size/pickymarker/deepbridge/latest?style=for-the-badge&logo=docker"></a>
  <a href="https://hub.docker.com/r/pickymarker/deepbridge"><img alt="Docker stars" src="https://img.shields.io/docker/stars/pickymarker/deepbridge?style=for-the-badge&logo=docker"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Cxsmo-ai/Deepbridge?style=for-the-badge&label=Latest%20release"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/releases/latest"><img alt="Release date" src="https://img.shields.io/github/release-date/Cxsmo-ai/Deepbridge?style=for-the-badge&label=Release%20date"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Cxsmo-ai/Deepbridge?style=for-the-badge"></a>
  <a href="https://github.com/Cxsmo-ai/Deepbridge/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Cxsmo-ai/Deepbridge?style=for-the-badge"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge"></a>
</p>
<p align="center">
  <a href="#quick-start">Quick start</a> |
  <a href="docs/DOCKER.md">Docker</a> |
  <a href="docs/CONFIGURATION.md">Configuration</a> |
  <a href="docs/TROUBLESHOOTING.md">Troubleshooting</a> |
  <a href="docs/METRICS.md">Live metrics</a> |
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

`latest` is a multi-architecture manifest with native `linux/amd64` and `linux/arm64` images. Docker and Podman select the correct image automatically, including on Oracle ARM VMs.

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

Deepbridge is a self-hosted Stremio addon that bridges Stremio, Deepbrid, built-in Easynews, built-in Newshosting, Nexus/Miatrix website search, and optional Newznab-compatible Usenet indexers. It combines Deepbrid official streams, native Easynews/Newshosting/Nexus results, and external indexer NZBs resolved through Deepbrid, then presents clean, ranked Stremio stream cards.

Deepbridge is built for people who want a simple addon URL, a clean configuration page, Docker-friendly deployment, and direct playback links from Deepbrid/myfast rather than proxying large video traffic through the addon server.

## Highlights

- Deepbrid official stream support.
- Built-in Easynews source configured directly in the Deepbridge dashboard.
- Easynews direct fallback returns final Easynews CDN links when native Easynews resolution succeeds.
- Built-in Newshosting source configured directly in the dashboard.
- Newshosting runs inside Deepbridge, generates NZBs on demand, and submits them to Deepbrid without a separate indexer API key.
- Built-in Nexus/Miatrix website source configured directly in the dashboard.
- Nexus/Miatrix is searched through the logged-in website flow, not the API, and selected NZBs are fetched only during Deepbrid resolution.
- Deepbrid torrent library support with fresh link refresh at playback time.
- My Library Movies, My Library TV Shows, and My Library Anime catalogs.
- Each ready library torrent has its own catalog entry and exact direct playback refresh.
- External magnet support that adds to Deepbrid on demand.
- Direct-links-only mode hides unresolved addon proxy links by default.
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
- Sanitized Easynews direct stats in health output without exposing Easynews credentials or playback URLs.
- GitHub-ready project structure with CI, support, security, and contribution templates.

## My Library catalogs

Deepbridge exposes three private Stremio catalogs when a Deepbrid API key is configured:

- **My Library Movies**
- **My Library TV Shows**
- **My Library Anime**

The catalog index reads ready torrents from your Deepbrid library, enriches them with Cinemeta metadata, and keeps the torrent ID rather than caching a volatile playback URL. Each catalog card represents a specific torrent release. When Stremio starts playback, Deepbridge refreshes that exact torrent through Deepbrid and returns its current direct Deepbrid/myfast URL.

Queued, processing, failed, or linkless torrents are deliberately hidden. This ensures every visible My Library item is eligible for direct playback. Use the dashboard's **My Library Catalogs** toggle to disable the catalogs for an installation link.

## Built-in Easynews support

Deepbridge now includes Easynews as a built-in source. You do not need to install a separate Easynews Stremio addon, and you do not need to add Easynews as an external Newznab indexer unless you separately operate one for your own workflow.

Configure Easynews from the Deepbridge dashboard:

```text
Built-in Easynews Source
  Enable Easynews Direct
  Easynews Username
  Easynews Password
  Max Easynews Direct Results
```

Easynews credentials are stored in the generated private Stremio configuration token, the same per-user model used by the dashboard for Deepbrid and external indexer credentials. There are no server-level Easynews environment variables required.

Easynews behavior:

- Deepbridge searches Easynews natively using an Easynews++/members-style search flow.
- Easynews rows are filtered for video evidence, title/episode match, duration, size, password flags, and virus flags.
- Matching Easynews results are resolved before being shown to Stremio.
- Stremio receives ready streams, not unresolved Easynews addon links.
- Stream cards are labeled `Easynews Direct` when playback uses Easynews directly.

External Newznab/Prowlarr/AltHub-style indexers are still fully supported and remain Deepbrid-resolved sources. They are configured separately in the `External Indexers` dashboard section.

## Built-in Newshosting support

Deepbridge includes Newshosting as an in-process source. You do not need to run or add a separate Newznab proxy for Newshosting.

Configure Newshosting from the Deepbridge dashboard:

```text
Built-in Newshosting Source
  Enable Newshosting
  Newshosting Username
  Newshosting Password
  Host / IP / Port
  Max Newshosting Results
  Max NZB Files
```

Newshosting behavior:

- Deepbridge logs into Newshosting's connector protocol directly.
- Search results are ranked against the requested movie or episode.
- Newshosting stream listing is on-demand by default, so searches stay fast and Deepbrid only receives the NZB when a stream is opened.
- When Deepbrid needs an NZB, Deepbridge generates that NZB on the same addon server in an isolated worker.
- Oversized Newshosting posts are skipped when they exceed the configured max NZB file count.
- Deepbrid receives an addon-hosted NZB URL; there is no separate Newznab API key.
- Stream cards are labeled `Newshosting` when the result came from this built-in source.

## Nexus / Miatrix website support

Deepbridge can optionally search `nexus.miatrix.com` as a logged-in website session without using the Nexus API.

Configure Nexus/Miatrix from the Deepbridge dashboard:

```text
Nexus / Miatrix Website Source
  Enable Nexus / Miatrix
  Nexus / Miatrix Website Cookie
  Nexus Email / Username
  Nexus Password
  Max Nexus Results
  Nexus Search Timeout
```

Nexus/Miatrix behavior:

- Deepbridge searches the normal website browse page and extracts release/detail/NZB links from the HTML result table.
- You can provide either a website cookie or normal Nexus login credentials.
- Search requests do not download NZBs.
- Deepbridge fetches a Nexus NZB only when that result is selected for Deepbrid resolution.
- The fetched NZB is cached briefly on the addon server so Deepbrid can retrieve it without receiving your Nexus cookie.
- Stream cards are labeled `Nexus/Miatrix` when the result came from this built-in source.

Because Nexus download allowances can be limited, keep **Max Nexus Results** low. The dashboard default is `2`.

If you route Nexus traffic through a VPN on your server, keep that routing limited to Nexus/Miatrix hostnames so the rest of Deepbridge continues using the normal server network path.

## Deepbrid Usenet Finder bridge

Deepbrid's premium website Finder is accessed through a paired browser extension, not through copied cookies, cURL commands, server-side Cloudflare solvers, or stored Google credentials.

### Install and pair the MV2 extension

1. Download `deepbridge-finder-bridge-mv2.zip` from the latest GitHub release and extract it.
2. In an MV2-capable browser, enable Developer mode and use **Load unpacked** to select the extracted folder.
3. Open `https://www.deepbrid.com/usenet-finder` and sign in normally. Keep this tab open.
4. In the Deepbridge dashboard, enable **Browser Extension Finder Bridge** and generate the install link.
5. Open the generated **Deepbrid Browser Extension Pairing URL** in the same browser profile.
6. Click the extension icon and confirm both messages:
   - `Paired with Oracle: persistent bridge active.`
   - `Authenticated Deepbrid tab detected.`

Finder searches are now sent from Oracle only to that paired browser configuration and run inside the logged-in Deepbrid tab. Browser cookies, passwords, and Google credentials never leave the browser. Each generated dashboard configuration has its own random bridge identity and request queue, so results are not mixed between users.

If Oracle is restarted or redeployed, reopen the configuration's pairing URL once to reconnect the extension. If the Deepbrid tab is closed, open it again before requesting Finder streams.
## External result modes

Deepbridge supports two external Newznab/AltHub result modes from the dashboard:

- `Direct Deepbrid links` - recommended. Attempts more AltHub/Newznab candidates through Deepbrid and only shows streams after Deepbrid returns a direct playable URL.
- `Strict prechecked` - faster/stricter. Attempts fewer candidates and only shows streams confirmed playable during the stream request.

Both modes avoid exposing unresolved addon proxy links in Stremio results. External streams shown in Stremio are direct Deepbrid/myfast playback URLs. These modes apply to external indexers and built-in Newshosting; the built-in Easynews source has its own dashboard credentials and direct Easynews resolution path.

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

The README includes live badges for CI, Docker Hub publishing, Docker Hub pulls, Docker Hub image size, Docker Hub stars, latest release, release date, stars, forks, and license status.

- The release badges link directly to the latest extension release; download counts are intentionally not shown because GitHub starts them at zero until an asset is downloaded.
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

Deepbridge includes a browser dashboard at the addon root URL. The dashboard generates private Stremio manifest links, manages Deepbrid, built-in Easynews, and external indexer configuration, and includes the project support panel with the Deepbrid referral guide.

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
| `DEEPBRID_OFFICIAL_TIMEOUT` | No | Timeout (ms) for official Deepbrid streams. Default `4500`. |
| `DEEPBRID_RESOLVE_TIMEOUT` | No | Timeout (ms) for resolving NZB links via Deepbrid (direct mode). Default `4500`. |
| `DEEPBRID_RESOLVE_TIMEOUT_PRECHECKED` | No | Timeout (ms) for resolving NZB links (prechecked mode). Default `7000`. |
| `DEEPBRID_INDEXER_TIMEOUT` | No | Timeout (ms) for Newznab/NZBHydra indexer searches. Default `12000`. |
| `DEEPBRID_INDEXER_TIMEOUT_EASYNEWS` | No | Timeout (ms) for Easynews indexer searches. Default `45000`. |

Deepbrid API keys, Easynews credentials, external indexers, timeout overrides, and per-source limits can also be configured per user from the dashboard and encoded into the generated manifest URL.

### Per-user timeout overrides

The dashboard includes a **ÃƒÂ¢Ã‚ÂÃ‚Â± Timeout Settings** section where users can override the default timeouts without needing server-level environment variables. This is useful when custom Newznab or NZBHydra indexers are slow and cause `TimeoutError: The operation was aborted due to timeout` errors.

- **Official Streams (ms)** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Timeout for fetching official Deepbrid streams. Default: 4500ms.
- **Resolve Links (ms)** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Timeout for resolving NZB links through Deepbrid. Default: 4500ms.
- **Indexer Search (ms)** ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Timeout for Newznab/NZBHydra indexer searches. Default: 12000ms.

Set to `0` to use server defaults. Per-user values take priority over environment variables.

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Architecture

```text
Stremio
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬Å¡
  ÃƒÂ¢Ã¢â‚¬â€œÃ‚Â¼
Deepbridge addon
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Deepbrid official addon sources
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Built-in Easynews direct source
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ External Newznab-compatible indexers resolved through Deepbrid
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Release parsing/ranking/deduplication
  ÃƒÂ¢Ã¢â‚¬ÂÃ…â€œÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ External pregrab via Deepbrid
  ÃƒÂ¢Ã¢â‚¬ÂÃ¢â‚¬ÂÃƒÂ¢Ã¢â‚¬ÂÃ¢â€šÂ¬ Direct final Deepbrid/myfast or Easynews CDN playback URLs
```

Deepbridge is intentionally not a video proxy. It prepares stream results and returns direct playback URLs so media bandwidth comes from Deepbrid or Easynews servers, not your addon host.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â Support The Project: Deepbrid Referral Guide

<p align="center">
  <a href="https://www.deepbrid.com/aff/go/pickymarker4906?i=4" target="_blank" rel="noopener noreferrer">
    <img src="https://www.deepbrid.com/file/get/path/banners.5ea0998723b53/i/236387" alt="Deepbrid Banner" width="728">
  </a>
</p>

This vendor package is **100% free and open-source**. However, maintaining and updating this project takes significant time and effort.

The **ONLY** way to support this project and ensure its continued development is by using our **Deepbrid Referral Link** when you sign up or renew your account.

<p align="center">
  <strong><a href="https://www.deepbrid.com/aff/go/pickymarker4906">ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ¢â‚¬Â° CLICK HERE TO SIGN UP FOR DEEPBRID ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ‹â€ </a></strong>
</p>

### ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂºÃ¢â‚¬Ëœ How to Properly Use the Referral Link (IMPORTANT)

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
- Easynews usernames, passwords, generated config tokens, and final playback URLs should be treated as secrets.
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
  easynews/   Built-in Easynews search, matching, and direct resolver
  indexer/    External indexer search
  stremio/    Manifest and Stremio stream formatting
  server.ts   Fastify HTTP server and routes
public/       Configuration UI
docs/         Documentation
.github/      GitHub workflows and templates
```

## License

Apache-2.0. See [LICENSE](LICENSE).
