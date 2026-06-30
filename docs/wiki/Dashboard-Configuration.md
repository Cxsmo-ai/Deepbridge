# Dashboard Configuration

Open your Deepbridge root URL in a browser:

```text
https://your-deepbridge-domain.example/
```

The dashboard builds a private Stremio manifest URL. Treat that URL like a password because it can contain encoded settings.

## Basic fields

| Field | What to enter |
| --- | --- |
| Deepbrid API key | Your Deepbrid API key |
| External result mode | `Direct Deepbrid links` is recommended |
| Direct links only | Keep enabled for clean Stremio results |
| Official timeout | How long to wait for official Deepbrid streams |
| Resolve timeout | How long to wait for Deepbrid NZB/torrent resolving |
| Indexer timeout | How long to wait for external indexers |

## My Library

Enable:

- Deepbrid Library
- My Library Catalogs

Deepbridge will expose:

- My Library Movies
- My Library TV Shows
- My Library Anime

Each catalog card points to a specific Deepbrid torrent ID. When you click it, Deepbridge refreshes the exact torrent and returns the current direct playback link.

## External indexers

Use Newznab-compatible URLs. Examples:

```text
https://api.althub.co.za
https://your-prowlarr.example/1/api
https://your-nzbhydra.example/api
```

You need each indexer's API key.

## Built-in sources

These are configured directly in the dashboard:

- Easynews
- Newshosting
- Nexus/Miatrix
- Deepbrid Finder browser bridge

## Install in Stremio

1. Generate the manifest URL.
2. Copy the full manifest URL.
3. Open Stremio.
4. Add addon by URL.
5. Paste the manifest URL.
6. Install.

## Keep private

Do not post these publicly:

- Generated manifest URL.
- Deepbrid API key.
- Easynews username/password.
- Newshosting username/password.
- Nexus/Miatrix cookie or email/password.
- External indexer API keys.
- Deepbrid Finder pairing URL.

