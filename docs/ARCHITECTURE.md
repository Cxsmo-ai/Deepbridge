# Architecture

Deepbridge is a Fastify TypeScript service that implements Stremio addon routes.

## Modules

```text
src/server.ts                 HTTP routes, config handling, Deepbrid resolution
src/core/parseRelease.ts      Release parser
src/core/releaseMatch.ts      Matching, scoring, and dedupe
src/core/types.ts             Shared types
src/deepbrid/apiClient.ts     Deepbrid API client
src/deepbrid/officialAddon.ts Deepbrid official source adapter
src/deepbrid/usenetFinder.ts  Optional Deepbrid website Usenet Finder source
src/indexer/search.ts         External indexer search and candidate creation
src/stremio/formatStreams.ts  Stremio stream card formatting
src/stremio/manifest.ts       Stremio manifest
public/index.html             Configuration UI
```

## Stream flow

```text
Stremio requests /stream/{type}/{id}.json
  │
  ├─ Fetch Deepbrid official streams
  ├─ Optionally search Deepbrid website Usenet Finder
  ├─ Search configured external indexers
  ├─ Parse/rank/dedupe releases
  ├─ Pregrab selected external NZBs through Deepbrid
  ├─ Filter archives and failed results
  └─ Return direct playback URLs in Stremio stream cards
```

## Playback model

Deepbridge does not proxy video by default. It resolves and formats streams, then Stremio plays final URLs directly from Deepbrid/myfast/seed hosts.

## External pregrab

External candidates are submitted to Deepbrid during stream-list generation. Candidates are shown only when Deepbrid returns a usable video file. Archive-only posts and archive-looking final URLs are dropped.
