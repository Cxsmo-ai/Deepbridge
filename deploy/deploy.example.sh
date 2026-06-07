#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="your-vm.example.com"
REMOTE_USER="deploy"
REMOTE_PATH="/opt/deepbridge"
SSH_KEY="${SSH_KEY:-~/.ssh/id_ed25519}"

ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_PATH'"
rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  --exclude .git \
  ./ "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/"
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" "cd '$REMOTE_PATH' && docker compose up -d --build"
