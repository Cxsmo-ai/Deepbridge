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

External indexers should be Newznab-compatible. Deepbridge searches them, ranks results, submits selected NZBs to Deepbrid, hides failures, filters archives, and returns direct Deepbrid playback URLs for valid video files.

## Result limits

Resolution-specific limits can control how many results appear for 2160p, 1080p, 720p, and SD.

## Security note

Do not paste configuration tokens or API keys in public GitHub issues.

## Support panel

The dashboard also contains a project-support panel with the Deepbrid referral guide. It is displayed below the configuration form and is documented in [DASHBOARD.md](DASHBOARD.md).
