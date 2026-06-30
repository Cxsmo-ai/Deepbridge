# Source Setup Guides

This page explains what each source does and when to use it.

## Deepbrid official streams

Required:

- Deepbrid API key.

What it does:

- Uses Deepbrid's official stream flow.
- Returns direct Deepbrid/myfast playback links where available.

## Deepbrid My Library

Required:

- Deepbrid API key.
- Ready torrents in your Deepbrid torrent library.

What it does:

- Lists your ready Deepbrid torrents.
- Adds private Stremio catalogs for movies, TV shows, and anime.
- Refreshes exact torrent playback links when opened.

## Easynews

Required:

- Easynews username.
- Easynews password.

What it does:

- Searches Easynews directly.
- Returns direct Easynews CDN URLs when available.
- Does not need Deepbrid for Easynews direct playback.

## Newshosting

Required:

- Newshosting username.
- Newshosting password.

What it does:

- Searches Newshosting inside Deepbridge.
- Generates an NZB on demand.
- Submits that NZB to Deepbrid when selected.
- Skips huge posts above the configured max file count.

## Nexus/Miatrix

Required:

- Nexus/Miatrix account.
- Website cookie or email/password configured in dashboard or env.

What it does:

- Searches the logged-in website flow.
- Uses movie search for movies and TV search for shows.
- Uses exact `SxxEyy` fallback when a series page does not expose release rows.
- Fetches NZBs only when resolving through Deepbrid.

Read:

- [Nexus Miatrix Source](Nexus-Miatrix-Source)
- [Oracle Nexus Only WireGuard](Oracle-Nexus-Only-WireGuard)

## External Newznab and Prowlarr

Required:

- Newznab-compatible URL.
- API key.

Supported examples:

- Prowlarr
- NZBHydra2
- AltHub
- NZBGeek
- DrunkenSlug
- NZBPlanet
- NZBFinder
- NinjaCentral
- Other compatible Newznab APIs

Recommended mode:

- `Direct Deepbrid links`

Deepbridge will search, rank, filter, submit selected NZBs to Deepbrid, and only show playable links.

## Deepbrid Finder browser bridge

Required:

- Deepbrid account with Finder access.
- MV2-capable browser if you use the MV2 extension.
- Logged-in Deepbrid tab.
- Per-config pairing URL.

What it does:

- Lets Deepbridge ask your browser to use Deepbrid's website Finder.
- Does not upload cookies to Oracle.
- Keeps each generated config paired to its own bridge ID and secret.

Read:

- [Deepbrid Finder Browser Extension](Deepbrid-Finder-Browser-Extension)

