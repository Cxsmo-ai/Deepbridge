# Full Setup Checklist

Use this page as the beginner-friendly order of operations.

## Step 1: Decide where Deepbridge will run

Pick one:

- Your local PC for testing.
- A home server.
- A VPS.
- Oracle Cloud VM.

If you want Stremio devices outside your home to use it, you need a public HTTPS URL.

## Step 2: Create the server

For Oracle:

1. Create Ubuntu VM.
2. Add your SSH key.
3. Open needed firewall/security-list ports.
4. Install Podman.
5. Set up HTTPS with Traefik, Caddy, Nginx, or Cloudflare Tunnel.

Read:

- [Oracle Cloud Podman Guide](Oracle-Cloud-Podman-Guide)

## Step 3: Start Deepbridge

Fastest Docker test:

```bash
docker run -d \
  --name deepbridge \
  -p 7000:7000 \
  -e PORT=7000 \
  -e BASE_URL=http://localhost:7000 \
  -e DEEPBRID_API_KEY=your_deepbrid_api_key_here \
  pickymarker/deepbridge:latest
```

Oracle/Podman users should use the Podman guide instead.

## Step 4: Open the dashboard

Open:

```text
http://localhost:7000
```

Or your public URL:

```text
https://your-deepbridge-domain.example/
```

## Step 5: Add your Deepbrid API key

Deepbrid is the core service. Without it, most Deepbridge features will not be useful.

Deepbrid:

- https://www.deepbrid.com/

Paste your API key into the dashboard or set `DEEPBRID_API_KEY` in `.env`.

## Step 6: Enable My Library

Recommended:

- Enable Deepbrid Library.
- Enable My Library Catalogs.

This adds:

- My Library Movies.
- My Library TV Shows.
- My Library Anime.

## Step 7: Add optional sources

Add only the sources you actually use:

| Source | Needs | Guide |
| --- | --- | --- |
| Easynews | Easynews username/password | [Source Setup Guides](Source-Setup-Guides) |
| Newshosting | Newshosting username/password | [Source Setup Guides](Source-Setup-Guides) |
| Nexus/Miatrix | Nexus account cookie or login | [Nexus Miatrix Source](Nexus-Miatrix-Source) |
| External indexers | Newznab/Prowlarr URL and API key | [Source Setup Guides](Source-Setup-Guides) |
| Deepbrid Finder | Browser extension and logged-in Deepbrid tab | [Deepbrid Finder Browser Extension](Deepbrid-Finder-Browser-Extension) |

## Step 8: Generate the manifest URL

In the dashboard:

1. Fill in settings.
2. Click generate.
3. Copy the Stremio manifest URL.

Keep it private.

## Step 9: Install in Stremio

1. Open Stremio.
2. Go to Addons.
3. Add addon by URL.
4. Paste the generated manifest URL.
5. Install.

## Step 10: Test

Test one item per enabled source:

- One popular movie.
- One TV episode.
- One item from My Library.
- One Nexus item if Nexus is enabled.
- One Easynews/Newshosting item if enabled.

Read:

- [Testing and Health Checks](Testing-and-Health-Checks)
- [Troubleshooting](Troubleshooting)

## Step 11: Update later

Docker:

```bash
docker pull pickymarker/deepbridge:latest
docker restart deepbridge
```

Podman:

```bash
podman pull docker.io/pickymarker/deepbridge:latest
podman restart deepbridge
```

