# Dashboard

Deepbridge includes a built-in browser dashboard served from the addon root URL.

```text
http://localhost:7000/
https://your-domain.example/
```

The dashboard has two main jobs:

1. Generate a personalized Stremio manifest URL.
2. Explain how users can support the project through the Deepbrid referral flow.

## Configuration panel

The configuration panel lets users enter:

- Public/base addon URL override.
- Deepbrid API key.
- External result mode for direct Deepbrid links or strict prechecked external streams.
- Official Deepbrid resolution limits.
- One or more external Newznab-compatible indexers.
- Indexer presets such as AltHub, NZBGeek, DrunkenSlug, NZBPlanet, NZBFinder, NinjaCentral, Prowlarr/local proxy, and custom Newznab.
- Per-indexer resolution limits.

Direct Deepbrid links mode is recommended. It attempts more Newznab/AltHub candidates through Deepbrid and only shows direct playable Deepbrid/myfast links in Stremio.

When the user clicks **Generate Install Link**, the dashboard encodes the configuration into a private Stremio manifest URL:

```text
https://your-domain.example/<configuration-token>/manifest.json
```

Treat this URL as private because it contains encoded configuration.

## Support panel

The dashboard includes a **Support The Project: Deepbrid Referral Guide** section.

This section explains that Deepbridge is free and open source, and that users can support continued development by using the Deepbrid referral link shown in the dashboard when signing up or renewing.

The support panel includes:

- Deepbrid referral banner at the top of the dashboard.
- A prominent referral call-to-action link.
- Step-by-step referral tracking instructions.
- A note that users should click the referral link right before purchasing so tracking is not lost.

## Referral privacy note

The referral link is public project-support information, not a secret. It is intentionally included in the dashboard UI and documented here so self-hosters know what users will see.

The dashboard should never expose:

- Deepbrid API keys.
- Indexer API keys.
- Stremio configuration tokens except the one generated for the current user.
- Server-side `.env` values.
- Private deployment details.

## Self-hosting customization

Fork maintainers can customize or remove the dashboard support panel in `public/index.html` if they want a different support flow.

If you modify the support panel, update this document and the README so users know what the dashboard displays.

## README support block

The GitHub README includes the same referral/support language as the dashboard, plus a GitHub-safe clickable banner image. GitHub does not render raw `<iframe>` embeds in README files, so use an `<a><img></a>` banner instead.
