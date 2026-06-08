# Configuration

Deepbridge supports environment-level configuration and per-user web configuration.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7000` | HTTP port inside Node.js/container. |
| `BASE_URL` | request-derived/local | Public addon base URL. Recommended in production. |
| `DEEPBRID_API_KEY` | empty | Optional fallback Deepbrid API key. |
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

## External result mode

The dashboard supports two external result modes:

- `direct` - recommended default. Deepbridge attempts more external candidates through Deepbrid and only shows streams after Deepbrid returns a direct playable URL.
- `prechecked` - stricter/faster mode. Deepbridge attempts fewer external candidates and only shows streams confirmed playable during the stream request.

Both modes avoid unresolved proxy-style Stremio entries. External results shown in Stremio are direct Deepbrid/myfast playback URLs.

## Result limits

Resolution-specific limits can control how many results appear for 2160p, 1080p, 720p, and SD.

## Health and cache checks

Use `/health` to check addon status, local resolve cache/in-flight counts, last Deepbrid add/precheck stats, sanitized per-indexer search stats, and fallback Deepbrid API status.

Use `/<configuration-token>/health` to check the same diagnostics for a generated dashboard configuration without exposing API keys, indexer keys, raw NZB URLs, or final playback URLs. After a stream request, `cache.indexerSearch` shows planned searches, raw/deduped/selected item counts, candidate counts, archive skips, and resolution breakdowns per indexer host. `cache.deepbridAdd.bySource` shows how many candidates were attempted, became ready, failed, or were skipped per source.

## Security note

Do not paste configuration tokens or API keys in public GitHub issues.

## Support panel

The dashboard also contains a project-support panel with the Deepbrid referral guide. It is displayed below the configuration form and is documented in [DASHBOARD.md](DASHBOARD.md).
