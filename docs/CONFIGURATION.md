# Configuration

Deepbridge supports environment-level configuration and per-user web configuration.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7000` | HTTP port inside Node.js/container. |
| `BASE_URL` | request-derived/local | Public addon base URL. Recommended in production. |
| `DEEPBRID_API_KEY` | empty | Optional fallback Deepbrid API key. |
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

## Built-in Newshosting

Newshosting is configured in the dashboard as a built-in source, not as an external indexer. It does not need a Newznab API key. Deepbridge searches Newshosting in-process, exposes a same-server private NZB URL for each selected result, and submits that URL to Deepbrid when the stream is opened. Very large posts are skipped when they exceed the configured max NZB file count so a single oversized result cannot stall stream collection.

Generated manifest URLs are private because they can contain the encoded Newshosting username/password.

## Deepbrid torrent library

Deepbridge can show ready torrents already present in your Deepbrid torrent library. Torrent library links are volatile, so stream cards point back to Deepbridge. When playback starts, Deepbridge refreshes `GET /torrents/info?id={id}` and redirects to the newest link instead of storing old `links[]` values.

External magnet links can be added in the dashboard, one per line. They are not searched like a tracker; they are static magnets that Deepbridge adds to Deepbrid only when opened.

Upstream Stremio addon URLs can also be added, one per line. Deepbridge calls their standard `/stream/{type}/{id}.json` endpoint, extracts `magnet:` URLs or `infoHash` streams, and wraps them as Deepbrid-on-demand playback links. HTTP streams without a magnet/infoHash are ignored because Deepbrid torrent add needs torrent metadata.

## External result mode

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
