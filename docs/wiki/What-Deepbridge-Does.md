# What Deepbridge Does

Deepbridge is a search, sorting, filtering, and resolving layer between Stremio and several media sources.

It does not normally proxy video. It returns direct playback URLs from Deepbrid/myfast, Easynews CDN URLs, or another direct source when one is available. That keeps your server lightweight.

## Main features

- Deepbrid official stream support.
- Deepbrid My Library stream support.
- My Library catalogs for movies, TV shows, and anime.
- Built-in Easynews direct source.
- Built-in Newshosting source.
- Built-in Nexus/Miatrix website source.
- Optional external Newznab/Prowlarr/NZBHydra-compatible indexers.
- Optional static external magnets.
- Optional upstream Stremio addon URLs.
- Optional Deepbrid Usenet Finder browser-extension bridge.
- Direct-link-first stream results.
- Filtering for bad, broken, archive-only, passworded, oversized, or unusable releases.
- Release parsing for resolution, codec, HDR, audio, group, season, and episode.
- Per-user dashboard configuration encoded into private manifest URLs.
- Docker and Podman friendly deployment.

## How stream requests work

1. Stremio asks Deepbridge for streams for a movie or episode.
2. Deepbridge searches enabled sources.
3. Deepbridge filters and ranks results.
4. Deepbridge resolves selected NZBs or torrents through Deepbrid when needed.
5. Stremio receives clean stream cards with direct playback links when possible.

## Important limitation

Deepbrid's public API can add external NZBs, but some RAR-only Usenet posts only expose raw archive parts through the public API. Deepbridge hides archive-only results when Deepbrid cannot expose a playable video file.

Deepbrid's own website Finder can sometimes resolve archive posts differently through its private website flow. That is why the optional Finder browser extension exists.

## Recommended source order

For a stable setup, start with:

1. Deepbrid API key.
2. My Library catalogs.
3. Easynews or Newshosting if you have them.
4. Nexus/Miatrix if you have an account.
5. External Newznab/Prowlarr indexers.
6. Deepbrid Finder browser extension only if you need Deepbrid's website Finder.

