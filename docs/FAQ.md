# FAQ

## Is Deepbridge affiliated with Deepbrid or Stremio?

No. Deepbridge is an independent community project.

## Does Deepbridge proxy video?

No, not by default. It returns direct final playback URLs so the video bandwidth comes from Deepbrid/myfast/seed hosts.

## Why are external results fewer than indexer results?

Deepbridge filters and pregrabs external results. Broken, archive-only, or non-video results are hidden.

## Why should I use HTTPS?

Stremio clients and modern platforms work more reliably with HTTPS public addon URLs. HTTPS also protects configuration tokens in transit.

## Can I run it locally?

Yes. Use `npm run dev` or Docker with `BASE_URL=http://localhost:7000`. Other devices need a reachable LAN or public URL.
