# Security Policy

## Supported versions

Deepbridge currently supports the latest `main` branch only.

## Reporting a vulnerability

Please report security-sensitive issues privately to the project maintainer. If no private channel is listed for your fork, create a minimal public issue asking for a private contact method without disclosing details.

## Sensitive data

Never share:

- Deepbrid API keys
- Indexer API keys
- Stremio config tokens
- Private hostnames/IP addresses
- SSH usernames, paths, or keys
- Full final playback URLs

## Deployment recommendations

- Use HTTPS for public deployments.
- Keep `.env` files out of Git.
- Rotate keys if they were exposed.
- Use least-privilege infrastructure credentials.
- Keep Docker images and Node.js dependencies updated.
