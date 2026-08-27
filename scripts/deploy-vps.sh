#!/usr/bin/env bash
# Deploy to the Hostinger VPS (2026-08 move; replaces the Render/Vercel API calls in
# deploy.yml). Ships the working tree's HEAD: git-archives the repo to the VPS, builds
# both images there, and swaps containers. Traefik notices the new containers by their
# labels; nothing else on the box is touched.
#
# Run from the repo root. Reads VPS_* from ./.env (falls back to defaults for CI, where
# the key comes from a secret instead). Migrations are NOT run here — they stay CI's job
# (deploy.yml), same as on Render, so a hand deploy can never race a schema change.
#
#   ./scripts/deploy-vps.sh           # deploy HEAD
#   ./scripts/deploy-vps.sh --logs    # deploy, then follow API logs
set -euo pipefail

ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
  VPS_HOST=$(grep -E '^VPS_HOST=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')
  VPS_USER=$(grep -E '^VPS_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')
  VPS_SSH_KEY=$(grep -E '^VPS_SSH_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')
fi
VPS_HOST="${VPS_HOST:-31.97.157.41}"
VPS_USER="${VPS_USER:-root}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/burgers_vps}"
VPS_SSH_KEY="${VPS_SSH_KEY/#\~/$HOME}"
SSH=(ssh -i "$VPS_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=20 "$VPS_USER@$VPS_HOST")

APP_DIR=/docker/burgers-bar
SHA=$(git rev-parse --short HEAD)

echo "==> Preflight: .env.prod must already exist on the VPS (secrets never ride this script)"
"${SSH[@]}" "test -f $APP_DIR/.env.prod" || {
  echo "ERROR: $APP_DIR/.env.prod missing on the VPS. Create it from .env.prod.example first."
  exit 1
}

echo "==> Shipping source at $SHA (committed state only — git archive ignores local edits)"
git archive --format=tar HEAD | gzip | "${SSH[@]}" "
  set -euo pipefail
  mkdir -p $APP_DIR/src.new
  tar -xzf - -C $APP_DIR/src.new
  # Keep exactly one previous tree for a fast rollback (deploy again from the old commit).
  rm -rf $APP_DIR/src.prev
  [ -d $APP_DIR/src ] && mv $APP_DIR/src $APP_DIR/src.prev
  mv $APP_DIR/src.new $APP_DIR/src
  cp $APP_DIR/.env.prod $APP_DIR/src/.env.prod
  echo $SHA > $APP_DIR/src/DEPLOYED_SHA
"

echo "==> Building and swapping containers on the VPS (build happens there, not here)"
"${SSH[@]}" "cd $APP_DIR/src && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build --remove-orphans"

echo "==> Waiting for the API healthcheck"
"${SSH[@]}" '
  for i in $(seq 1 30); do
    status=$(docker inspect --format "{{.State.Health.Status}}" burgers-bar-api-1 2>/dev/null || echo starting)
    [ "$status" = healthy ] && echo "API healthy." && exit 0
    sleep 4
  done
  echo "API did not become healthy; recent logs:"; docker logs --tail 40 burgers-bar-api-1; exit 1
'

DEPLOY_HOST=$("${SSH[@]}" "grep -E '^DEPLOY_HOST=' $APP_DIR/.env.prod | cut -d= -f2-")
echo "==> Deployed $SHA -> https://$DEPLOY_HOST"

if [ "${1:-}" = "--logs" ]; then
  "${SSH[@]}" "docker logs -f --tail 20 burgers-bar-api-1"
fi
