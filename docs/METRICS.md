# Live Metrics and Download Tracking

Deepbridge shows live project status and usage signals in the README with GitHub/Shields badges.

## What is tracked live in the README

The README includes live badges for:

- CI workflow status.
- Docker Hub publishing workflow status.
- Docker Hub pull count for `pickymarker/deepbridge`.
- Docker Hub image size for the `latest` tag.
- Docker Hub stars for `pickymarker/deepbridge`.
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

## Docker Hub image tracking

Deepbridge is published to Docker Hub at:

```text
pickymarker/deepbridge
```

Docker Hub exposes public pull/star/image-size metadata, so the README can show live Docker Hub badges:

```text
https://img.shields.io/docker/pulls/pickymarker/deepbridge
https://img.shields.io/docker/stars/pickymarker/deepbridge
https://img.shields.io/docker/image-size/pickymarker/deepbridge/latest
```

These badges are the public live Docker pull statistics for the primary Docker Hub image.

## GHCR note

Deepbridge previously published to GHCR, but Docker Hub is now the primary public image because Docker Hub exposes public pull statistics and GHCR does not.

## Other tracking options

If you want additional public download counters, use one of these approaches:

1. **Docker Hub**
   - Docker Hub exposes public pull counts.
   - Deepbridge uses this as the primary image with `pickymarker/deepbridge`.

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
