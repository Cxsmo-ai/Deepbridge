# Contributing

Contributions are welcome.

## Development setup

```bash
npm ci
npm run build
npm run dev
```

## Pull request checklist

- Keep secrets out of the repo.
- Run `npm run build`.
- If Docker-related, run `docker build -t deepbridge:test .`.
- Update docs when behavior changes.
- Keep stream/card formatting readable in Stremio.
- Prefer small focused changes.

## Coding style

- TypeScript, CommonJS runtime.
- Keep code compact and readable.
- Follow existing module boundaries:
  - `src/core` for parsing/ranking/shared logic.
  - `src/deepbrid` for Deepbrid integrations.
  - `src/indexer` for external indexers.
  - `src/stremio` for manifest/stream formatting.

## Security

Do not add logs that print API keys, config tokens, final playback URLs, or indexer keys.
