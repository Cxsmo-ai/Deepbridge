# Project Notes for Agents

## Verification

- Install dependencies: `npm ci`
- TypeScript/build check: `npm run build`
- General check alias: `npm run check`
- Local dev server: `npm run dev`
- Production start after build: `npm start`
- Docker build: `docker build -t deepbridge:local .`

## Safety

- Never commit `.env`, API keys, Stremio configuration tokens, final playback URLs, private IPs, or SSH key paths.
- Keep local deployment details in private files only.
- Public deployment examples must use placeholders.
