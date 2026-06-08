# Troubleshooting

## Health check fails

Check logs:

```bash
docker compose logs -f deepbridge
```

Verify `.env` and port mappings.

Health endpoints:

```text
/health
/<configuration-token>/health
```

These endpoints report addon status, local resolve cache/in-flight counts, last Deepbrid add/precheck stats, sanitized per-indexer search stats, and sanitized Deepbrid API/download-cache health. They do not return API keys, indexer keys, playback URLs, or NZB URLs.

## Stremio does not show streams

- Confirm the manifest URL is installed correctly.
- Confirm `BASE_URL` is public and HTTPS in production.
- Check `/health`.
- Check server logs for `/stream/...` requests.
- Verify your Deepbrid API key is valid.

## Official streams work but external streams do not

External streams depend on indexer results and Deepbrid being able to expose a video file. Deepbridge filters obvious archive-only results and prioritizes successful pregrabs.

Try:

- Refresh the episode in Stremio.
- Restart Stremio to clear stale stream entries.
- Use `Direct Deepbrid links` external result mode if you want Deepbridge to attempt more AltHub/Newznab candidates before showing results.
- Check whether external entries say `Prechecked`.
- Check `/<configuration-token>/health` after loading a stream. `cache.indexerSearch` should show raw/deduped/candidate counts per AltHub/Newznab host, and `cache.deepbridAdd.bySource` should show attempted and ready counts for working Deepbrid sources.
- Check sanitized server logs.

## Playback is slow to start

Deepbridge does not proxy video by default. Playback speed depends on the final Deepbrid/myfast/seed host and the player. If logs show no `/resolve` click after selecting a prechecked external result, Stremio is using the direct final link.

## Bad Gateway during stream list

This usually means a reverse proxy timeout or a slow upstream indexer/Deepbrid response. Check logs and consider reducing external limits.

## Do not share secrets

When asking for help, redact API keys, tokens, IPs, and final playback URLs.
