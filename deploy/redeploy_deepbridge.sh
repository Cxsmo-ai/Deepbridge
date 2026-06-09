#!/bin/bash
# Redeploy deepbridge on Oracle VM with the latest DockerHub image
set -e

echo "[1/3] Stopping old deepbridge container..."
podman stop deepbridge 2>/dev/null || true
podman rm deepbridge 2>/dev/null || true

echo "[2/3] Starting new deepbridge container with latest image..."
podman run -d \
  --name deepbridge \
  --restart unless-stopped \
  --network proxynet \
  -e PORT=7000 \
  -e NODE_ENV=production \
  -l traefik.enable=true \
  -l 'traefik.http.routers.deepbridge.rule=Host(`d7j3rx.deepascension.net`)' \
  -l traefik.http.routers.deepbridge.entrypoints=websecure \
  -l traefik.http.routers.deepbridge.tls.certresolver=myresolver \
  -l traefik.http.services.deepbridge.loadbalancer.server.port=7000 \
  docker.io/pickymarker/deepbridge:latest

echo "[3/3] Verifying..."
sleep 3
podman ps --filter name=deepbridge
podman inspect deepbridge --format '{{ index .Config.Labels "traefik.http.routers.deepbridge.rule" }}'
echo "=== DONE ==="
