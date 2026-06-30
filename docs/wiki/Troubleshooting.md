# Troubleshooting

## Dashboard shows 404

Check the container is running:

```bash
podman ps
podman logs --since 5m deepbridge
```

Check the public route:

```bash
curl -I https://your-deepbridge-domain.example/
curl -I https://your-deepbridge-domain.example/manifest.json
```

If using Traefik, check:

- Container is on the same proxy network as Traefik.
- Traefik labels are correct.
- `BASE_URL` matches the public domain.
- DNS points to the server.

## Bad Gateway

Usually one of these:

- Container is down.
- Reverse proxy cannot reach the container.
- Wrong internal port.
- Proxy timeout.
- DNS or certificate issue.

Check:

```bash
podman ps
podman logs -f deepbridge
curl http://127.0.0.1:7000/health
```

## Stremio shows no streams

Check:

- Manifest URL is installed correctly.
- Deepbrid API key is valid.
- Source toggles are enabled.
- `directLinksOnly` is not hiding unresolved torrent results you expected.
- Public `BASE_URL` is HTTPS.
- Logs show `/stream/...` requests.

## My Library catalog opens but other addons scrape too

Deepbridge My Library catalog entries use private IDs so the Deepbridge stream handler can return only the exact library torrent. Make sure you installed the latest image and refreshed/reinstalled the manifest URL after enabling My Library catalogs.

## Nexus finds zero results

Check:

- Nexus source is enabled.
- Cookie or email/password is valid.
- Account can search the same title in the browser.
- Oracle Nexus-only WireGuard is working if you use it.
- Health output shows Nexus configured.
- Logs do not show login rejection or timeout.

For TV, Deepbridge uses exact `SxxEyy` fallback when series pages do not expose releases. If Nexus itself has no matching episode releases, Deepbridge should return zero Nexus streams rather than wrong generic results.

## Nexus returns archive-only posts

Some posts are RAR-only. Deepbrid's public API may expose only raw `.rar` parts for those NZBs. Deepbridge hides results when no playable video link is exposed.

Try a different release, another source, or the Deepbrid Finder browser extension if Deepbrid's website Finder can handle that archive flow.

## Finder extension says not paired

Check:

- Extension is installed and enabled.
- You opened the pairing URL from the dashboard.
- Deepbrid tab is logged in.
- The pairing URL belongs to the same generated configuration.
- Browser allows the extension to access Deepbrid and the Deepbridge domain.

## DockerHub image did not update

Check GitHub Actions:

- https://github.com/Cxsmo-ai/Deepbridge/actions

Then on the server:

```bash
podman pull docker.io/pickymarker/deepbridge:latest
podman restart deepbridge
```

For a full recreate, stop and remove the container, then run it again with the same env and labels.

