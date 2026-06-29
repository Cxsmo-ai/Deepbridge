# Changelog

All notable changes to Deepbridge should be documented here.

The format is inspired by Keep a Changelog, and this project uses human-readable version notes.

## Unreleased

### Added
- GitHub-ready repository documentation and templates.
- Docker Compose example.
- CI workflow for TypeScript and Docker builds.
- Support, security, contribution, and troubleshooting documentation.
- Paired Deepbrid Finder browser bridge with isolated per-configuration pairing identities.
- Persistent Manifest V2 Finder Bridge extension release for MV2-capable browsers.
- Finder browser-bridge status endpoint and dashboard pairing URL.
- Deepbrid My Library movie, TV, and anime catalogs with refreshed direct playback links.
- Native multi-architecture Docker Hub publishing for `linux/amd64` and `linux/arm64`.
- Optional Nexus/Miatrix website source that searches the logged-in website flow without the API, supports cookie or email/password login, and submits selected NZBs through Deepbrid.

### Changed
- Repository metadata prepared for public Apache-2.0 release.
- Replaced dashboard cookie, copied-header, cURL, and Byparr configuration with the browser-pairing workflow.
- Finder now searches all available title and alias query variants before applying configured processing limits.
- README and configuration documentation now describe extension installation, pairing confirmation, and reconnecting after an Oracle restart.
- Release badges now show the latest release and release date instead of zero-prone download counters.
- Replaced the truncated license text with the complete canonical Apache License 2.0.
