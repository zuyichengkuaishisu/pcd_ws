#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed or not in PATH."
  echo "Please install Docker Desktop or Docker Engine first."
  exit 1
fi

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
  echo "Then re-run: ./start-docker.sh"
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env" && -f "$ROOT_DIR/.env.example" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "Created $ROOT_DIR/.env from .env.example"
  echo "Edit .env if you need to change robot or mapping gateway addresses."
fi

echo "Starting Open Inspection Platform with Docker..."
"${COMPOSE_CMD[@]}" -f "$ROOT_DIR/docker-compose.yml" down --remove-orphans 2>/dev/null || true
if ! BUILD_OUTPUT="$("${COMPOSE_CMD[@]}" -f "$ROOT_DIR/docker-compose.yml" up -d --build 2>&1)"; then
  echo "$BUILD_OUTPUT"
  echo ""
  if grep -Eq "failed to resolve source metadata|registry-1\\.docker\\.io|i/o timeout|DeadlineExceeded" <<<"$BUILD_OUTPUT"; then
    echo "Docker failed to pull the Node base image from Docker Hub."
    echo "If Docker Hub is slow or blocked in your network, pick one of these fixes:"
    echo "  1. Set NODE_IMAGE in $ROOT_DIR/.env and retry."
    echo "     Example: NODE_IMAGE=docker.m.daocloud.io/library/node:24-bookworm-slim"
    echo "  2. Configure Docker registry mirrors, then restart Docker."
    echo "     Example mirrors: https://docker.1ms.run , https://docker.xuanyuan.me"
  fi
  exit 1
fi

echo "$BUILD_OUTPUT"

APP_PORT="${APP_PORT:-4174}"
if [[ -f "$ROOT_DIR/.env" ]]; then
  ENV_APP_PORT="$(awk -F= '/^APP_PORT=/{print $2}' "$ROOT_DIR/.env" | tail -n 1)"
  if [[ -n "${ENV_APP_PORT:-}" ]]; then
    APP_PORT="$ENV_APP_PORT"
  fi
fi

echo "Open Inspection Platform is starting."
echo "Open http://localhost:${APP_PORT}"
echo "View logs with: ${COMPOSE_CMD[*]} -f \"$ROOT_DIR/docker-compose.yml\" logs -f"
