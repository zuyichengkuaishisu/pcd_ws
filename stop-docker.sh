#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Error: docker compose is not available."
  echo ""
  echo "Docker Engine is installed but the Compose plugin is missing."
  echo "On Ubuntu/Debian, install it with:"
  echo "  sudo apt install -y docker-compose-v2"
  echo ""
  echo "Then re-run: ./stop-docker.sh"
  exit 1
fi

echo "Stopping Open Inspection Platform..."
"${COMPOSE_CMD[@]}" -f "$ROOT_DIR/docker-compose.yml" down
