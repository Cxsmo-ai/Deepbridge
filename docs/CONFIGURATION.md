# Configuration

Deepbridge supports environment-level configuration and per-user web configuration.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7000` | HTTP port inside Node.js/container. |
| `BASE_URL` | request-derived/local | Public addon base URL. Recommended in production. |
| `DEEPBRID_API_KEY` | empty | Optional fallback Deepbrid API key. |
| `DEEPBRID_WEB_COOKIE` | empty | Optional logged-in Deepbrid website session cookie for the premium `/usenet-finder` source. API key alone is not enough for this website search flow. |
| `DEEPBRID_WEB_USER_AGENT` | Chrome-like default | Optional browser User-Agent to use with `DEEPBRID_WEB_COOKIE`. Cloudflare clearance cookies may be bound to the browser User-Agent that created them. |
| `DEEPBRID_WEB_HEADERS_JSON` | empty | Optional JSON object of safe browser headers copied from an authenticated `/usenet-finder` request. Used only by the Deepbrid Usenet Finder flow. |
| `DEEPBRID_BYPARR_URL` | empty | Optional Byparr `/v1` endpoint used to solve Cloudflare from the server network, then retry Finder with the logged-in Deepbrid cookie plus Byparr clearance. On the Oracle `proxynet` stack this is usually `http://byparr:8191/v1`. |
| `DEEPBRID_BYPARR_TIMEOUT` | `70000` | Maximum milliseconds for the Usenet Finder-only Byparr Cloudflare solve. |
| `DEEPBRID_USENET_FINDER_ENABLED` | `true` | Enables the Deepbrid website Usenet Finder source when a web cookie is configured. |
| `DEEPBRID_USENET_FINDER_MAX_RESULTS` | `4` | Maximum ready Finder streams returned per stream request. |
| `DEEPBRID_USENET_FINDER_MAX_PROCESS` | `5` | Maximum Finder rows to process into file links per stream request. |
| `NEWSHOSTING_USERNAME` | empty | Optional global fallback Newshosting username. Per-link dashboard config can be used instead. |
| `NEWSHOSTING_PASSWORD` | empty | Optional global fallback Newshosting password. Do not commit real values. |
| `NEWSHOSTING_SERVER_HOST` | `srv.aboutusenet.com` | TLS/SNI host for Newshosting connector access. |
| `NEWSHOSTING_SERVER_IP` | `81.171.93.8` | Connector IP used by the built-in Newshosting client. |
| `NEWSHOSTING_SERVER_PORT` | `5598` | Connector TCP port. |
| `NEWSHOSTING_MAX_NZB_FILES` | `32` | Maximum file entries to expand into a generated Newshosting NZB before skipping the release. Lower values keep Newshosting fast by avoiding huge multipart posts. |
| `NODE_ENV` | unset | Set to `production` for hosted deployments. |

## Web configuration page

Open the root URL of the addon:

```text
https://your-domain.example/
```

The page can encode user-specific settings into a Stremio manifest URL. Treat generated manifest URLs as private because they can contain encoded configuration.

## External indexers

External indexers should be Newznab-compatible. Deepbridge searches them with TV/movie-specific Newznab queries plus broader fallback searches, ranks results, filters obvious archive-only entries, and resolves selected NZBs through Deepbrid.

Indexer URLs can be entered either as the service root or the Newznab API endpoint. For example, both `https://indexer.example` and `https://indexer.example/api` are accepted; Deepbridge normalizes them before searching.

## Deepbrid Usenet Finder

Deepbridge can optionally use Deepbrid's own premium website Usenet Finder as a first-party Deepbrid source. This is separate from the API-key-only official Stremio source and separate from external Newznab indexers.

The Finder website flow currently requires a logged-in Deepbrid website session cookie. A Deepbrid API key is still required for the addon overall, but API key alone does not authenticate `/usenet-finder` search. For hosted installs, prefer setting `DEEPBRID_WEB_COOKIE` on the server instead of embedding the cookie in generated Stremio configuration tokens.

If the server receives a Cloudflare challenge page from `/usenet-finder`, set `DEEPBRID_BYPARR_URL` to a reachable Byparr endpoint. Byparr is used only for the Deepbrid Usenet Finder flow to obtain Cloudflare clearance cookies from the same network as the addon; Deepbridge still sends the Deepbrid login session cookie on the final Finder requests. Other Deepbridge sources do not call Byparr.

When Cloudflare or Deepbrid rejects a cookie that works in a browser, copy the request headers from Edge/Chrome for a successful `/usenet-finder` page load and provide them as `DEEPBRID_WEB_HEADERS_JSON`. Deepbridge only replays an allowlist of browser identity headers, not arbitrary headers.

When enabled, Deepbridge searches `/usenet-finder`, scores matching rows, processes a small number of best candidates through Deepbrid's Finder AJAX flow, and returns only direct video file URLs.

## Built-in Newshosting

Newshosting is configured in the dashboard as a built-in source, not as an external indexer. It does not need a Newznab API key. Deepbridge searches Newshosting in-process, exposes a same-server private NZB URL for each selected result, and submits that URL to Deepbrid when the stream is opened. Very large posts are skipped when they exceed the configured max NZB file count so a single oversized result cannot stall stream collection.

Generated manifest URLs are private because they can contain the encoded Newshosting username/password.

## Deepbrid torrent library

Deepbridge can show ready torrents already present in your Deepbrid torrent library. Torrent library links are volatile, so stream cards point back to Deepbridge. When playback starts, Deepbridge refreshes `GET /torrents/info?id={id}` and redirects to the newest link instead of storing old `links[]` values.

When **My Library Catalogs** is enabled, Deepbridge also exposes three Stremio catalogs: **My Library Movies**, **My Library TV Shows**, and **My Library Anime**. Each ready torrent is a separate catalog item with enriched Cinemeta metadata. Selecting an item refreshes its exact Deepbrid torrent ID and returns only the current direct playback URL. The catalog index caches torrent IDs and metadata for five minutes; it never persists a volatile direct playback URL.

`DEEPBRID_LIBRARY_CATALOG_TIMEOUT` controls the Deepbrid library-list request timeout in milliseconds. Per-install links can override it with `deepbridLibraryCatalogTimeout`.

External magnet links can be added in the dashboard, one per line. They are not searched like a tracker; they are static magnets that Deepbridge adds to Deepbrid only when opened.

Upstream Stremio addon URLs can also be added, one per line. Deepbridge calls their standard `/stream/{type}/{id}.json` endpoint. Cached/direct service streams are shown with the upstream addon name, while P2P/torrent streams, `magnet:` streams, and `infoHash` streams are skipped when `directLinksOnly` is enabled. Disable direct-links-only only if you intentionally want Deepbridge to expose on-demand `/torrent/add` routes.

`Deepbrid Library` means the item was already in your Deepbrid torrent library. Upstream addon entries are labeled separately and are blocked when they look like P2P/torrent playback.

## External result mode

`directLinksOnly` defaults to enabled. In this mode Deepbridge only returns stream cards with real direct playback URLs. Unresolved `/resolve`, `/torrent/add`, and `/torrent/play` addon links are hidden. Disable it only if you want instant-resolve proxy cards.

The dashboard supports two external result modes:

- `direct` - recommended default. Deepbridge attempts more external candidates through Deepbrid and only shows streams after Deepbrid returns a direct playable URL.
- `prechecked` - stricter/faster mode. Deepbridge attempts fewer external candidates and only shows streams confirmed playable during the stream request.

Both modes avoid unresolved proxy-style Stremio entries. External results shown in Stremio are direct Deepbrid/myfast playback URLs.

## Result limits

Resolution-specific limits can control how many results appear for 2160p, 1080p, 720p, and SD.

## Health and cache checks

Use `/health` to check addon status, local resolve cache/in-flight counts, last Deepbrid add/precheck stats, sanitized per-indexer search stats, and fallback Deepbrid API status.

Use `/<configuration-token>/health` to check the same diagnostics for a generated dashboard configuration without exposing API keys, indexer keys, raw NZB URLs, or final playback URLs. After a stream request, `cache.indexerSearch` shows planned searches, raw/deduped/selected item counts, candidate counts, archive skips, and resolution breakdowns per indexer host. `cache.newshostingDirect` shows built-in Newshosting search counts. `cache.deepbridAdd.bySource` shows how many candidates were attempted, became ready, failed, or were skipped per source.

## Security note

Do not paste configuration tokens or API keys in public GitHub issues.

## Support panel

The dashboard also contains a project-support panel with the Deepbrid referral guide. It is displayed below the configuration form and is documented in [DASHBOARD.md](DASHBOARD.md).
