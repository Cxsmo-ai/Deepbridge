# Nexus Miatrix Source

Deepbridge can search `nexus.miatrix.com` without using the Nexus API. It logs into or uses the normal website session and parses website pages.

Nexus/Miatrix:

- https://nexus.miatrix.com/

## What it needs

Use one of these:

1. Nexus/Miatrix website cookie.
2. Nexus/Miatrix email and password.

The dashboard supports per-user configuration. Environment variables can also be used for server-wide fallback.

## Dashboard fields

| Field | Meaning |
| --- | --- |
| Enable Nexus / Miatrix | Turns the source on |
| Nexus / Miatrix Website Cookie | Optional logged-in website cookie |
| Nexus / Miatrix Email | Optional email login |
| Nexus / Miatrix Password | Optional password login |
| Max Nexus / Miatrix Results | Maximum Nexus streams returned |
| Search timeout | Website search timeout |
| NZB timeout | NZB fetch timeout |

## How search works

Movies:

- Uses movie-shaped Nexus search.
- Filters by title and year when possible.

TV episodes:

- Uses TV-shaped Nexus search.
- Searches the series page when possible.
- Extracts release rows and NZB links from rendered pages.
- If the series page does not expose releases, it falls back to exact release searches like `Show Name S01E03`.
- The exact fallback keeps only the requested `SxxEyy` and rejects other shows that merely contain the same word in the title.

Anime:

- Uses the same series/movie matching system.
- Avoids cross-matching obvious anime/non-anime results where metadata makes that clear.

## How NZB resolving works

1. Stremio asks for streams.
2. Deepbridge finds matching Nexus releases.
3. Deepbridge shows Nexus/Miatrix stream cards.
4. When a stream is selected, Deepbridge fetches the NZB from Nexus.
5. Deepbridge gives Deepbrid a short-lived addon-hosted NZB URL.
6. Deepbrid returns direct playback links if the NZB exposes playable video.

## RAR-only limitation

Some Nexus posts are RAR archive sets. Deepbrid's public API may return only raw `.rar` parts for those posts instead of an extracted video file. Deepbridge filters archive-only results when a playable video cannot be found.

This is a Deepbrid public API limitation, not a Nexus search failure.

## Recommended Oracle setup

If you run Deepbridge on Oracle and want Nexus to see a VPN IP, do not put the whole VM or container behind a VPN. Use [Oracle Nexus Only WireGuard](Oracle-Nexus-Only-WireGuard) so only `nexus.miatrix.com` traffic uses the VPN.

