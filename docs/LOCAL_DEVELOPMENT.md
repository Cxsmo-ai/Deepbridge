# Local Development

This guide covers running Deepbridge directly with Node.js for development.

## Requirements

- Node.js 22 or newer
- npm
- A Deepbrid API key for live stream resolution
- Optional Newznab-compatible indexer credentials

## Install

```bash
npm ci
```

## Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=7000
BASE_URL=http://localhost:7000
DEEPBRID_API_KEY=your_deepbrid_api_key_here
NODE_ENV=development
```

## Run in development mode

```bash
npm run dev
```

The configuration page will be available at:

```text
http://localhost:7000
```

Health check:

```text
http://localhost:7000/health
```

## Build production JavaScript

```bash
npm run build
npm start
```

## Stremio local testing

Use the configuration page to generate a manifest URL, then install it in Stremio:

```text
http://localhost:7000/<configuration-token>/manifest.json
```

For local testing on another device, `localhost` must be reachable from that device. Use your LAN IP or a secure tunnel.

## Useful checks

```bash
npm run build
npm run check
```
