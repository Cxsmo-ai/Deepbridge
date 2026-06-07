# Live Metrics and Download Tracking

Deepbridge shows live project status and usage signals in the README with GitHub/Shields badges.

## What is tracked live in the README

The README includes live badges for:

- CI workflow status.
- GHCR publishing workflow status.
- Link to the GHCR image package.
- GitHub release asset downloads.
- GitHub stars.
- GitHub forks.
- Repository license.

## Release download counts

GitHub exposes download counts for uploaded release assets. The README uses:

```text
https://img.shields.io/github/downloads/Cxsmo-ai/Deepbridge/total
```

This count updates automatically through Shields/GitHub once release assets exist.

Important: GitHub automatically generated source archives may behave differently from uploaded release assets. For best download tracking, attach files such as checksums, packaged archives, or installer artifacts to GitHub Releases.

## GHCR package tracking

The Docker image is published to GitHub Container Registry:

```text
ghcr.io/cxsmo-ai/deepbridge:latest
```

The README links to the package page and shows the GHCR publish workflow status.

## GHCR pull/download count limitation

GitHub Container Registry currently does **not** provide a public live pull/download count badge for container images like Docker Hub does.

That means this can be shown live:

- whether GHCR publishing succeeded
- where the image package lives
- which tags are published on the package page

But this cannot be shown publicly from GitHub alone:

- total GHCR pulls
- live GHCR pull count badge
- user-level identity for who pulled the image

## Options if true public Docker pull counts are required

If you want a public pull counter, use one of these approaches:

1. **Mirror to Docker Hub**
   - Docker Hub exposes public pull counts.
   - The README can show a Docker Hub pulls badge.

2. **Publish GitHub Releases**
   - Attach release artifacts and track release asset downloads.
   - This works well for packaged source archives or release bundles.

3. **Use a private analytics proxy**
   - Put a landing/download endpoint in front of your image instructions.
   - Track clicks before sending users to GHCR.
   - This tracks documentation clicks, not actual `docker pull` events.

4. **Use registry logs on self-hosted registry infrastructure**
   - Host your own registry or proxy.
   - Track pulls from your own logs.

## Privacy note

Deepbridge does not phone home or track users from inside the addon. Any public metrics shown in the README come from GitHub, GitHub Actions, Shields, or the package/release host.
