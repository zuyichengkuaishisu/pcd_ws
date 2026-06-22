#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="open-inspection-platform.service"
SOURCE_UNIT="$ROOT_DIR/deploy/open-inspection-platform.service"
MODE="${1:-system}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [system|user]

  system  Install a system-wide unit (default, requires sudo)
  user    Install a user unit (no sudo, but boot autostart needs linger)
EOF
}

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$MODE" != "system" && "$MODE" != "user" ]]; then
  echo "Error: unknown mode '$MODE'"
  usage
  exit 1
fi

if [[ ! -f "$SOURCE_UNIT" ]]; then
  echo "Error: missing $SOURCE_UNIT"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed."
  exit 1
fi

render_unit() {
  local mode="$1"
  local wanted_by docker_after

  if [[ "$mode" == "system" ]]; then
    wanted_by="multi-user.target"
    docker_after="docker.service"
  else
    wanted_by="default.target"
    docker_after=""
  fi

  sed \
    -e "s|__PROJECT_DIR__|$ROOT_DIR|g" \
    -e "s|__WANTED_BY__|$wanted_by|g" \
    -e "s| __DOCKER_AFTER__|$docker_after|g" \
    -e "s|__DOCKER_AFTER__||g" \
    "$SOURCE_UNIT"
}

install_system_unit() {
  local target_unit="/etc/systemd/system/$SERVICE_NAME"

  if ! systemctl is-enabled docker >/dev/null 2>&1; then
    echo "Enabling Docker to start on boot..."
    sudo systemctl enable docker
  fi

  echo "Installing system unit to $target_unit"
  render_unit system | sudo tee "$target_unit" >/dev/null

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl start "$SERVICE_NAME"

  echo
  echo "Open Inspection Platform is enabled to start on boot (system service)."
  echo "Status:  sudo systemctl status $SERVICE_NAME"
  echo "Logs:    sudo journalctl -u $SERVICE_NAME -f"
  echo "Disable: sudo systemctl disable --now $SERVICE_NAME"
}

install_user_unit() {
  local target_dir="$HOME/.config/systemd/user"
  local target_unit="$target_dir/$SERVICE_NAME"

  mkdir -p "$target_dir"
  echo "Installing user unit to $target_unit"
  render_unit user > "$target_unit"

  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME"
  systemctl --user start "$SERVICE_NAME"

  local linger
  linger="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo "no")"

  echo
  echo "Open Inspection Platform user service is enabled."
  echo "Status:  systemctl --user status $SERVICE_NAME"
  echo "Logs:    journalctl --user -u $SERVICE_NAME -f"
  echo "Disable: systemctl --user disable --now $SERVICE_NAME"

  if [[ "$linger" != "yes" ]]; then
    echo
    echo "Note: Linger is not enabled, so this service only starts after you log in."
    echo "For boot autostart without login, run once:"
    echo "  sudo loginctl enable-linger $USER"
    echo
    echo "Or install the system service instead:"
    echo "  sudo $0 system"
  else
    echo
    echo "Linger is enabled; the service will start automatically on boot."
  fi
}

case "$MODE" in
  system) install_system_unit ;;
  user) install_user_unit ;;
esac
