#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/web-pcd-viewer"
SERVICE_NAME="open-inspection-platform-preview.service"
SOURCE_UNIT="$ROOT_DIR/deploy/open-inspection-platform-preview.service"
MODE="${1:-system}"
RUN_USER="${SUDO_USER:-$USER}"
RUN_GROUP="$(id -gn "$RUN_USER")"
NODE_BIN_DIR="${NODE_BIN_DIR:-}"
APP_PORT="${APP_PORT:-4174}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [system|user]

  system  Install a system-wide unit (default, requires sudo)
  user    Install a user unit (no sudo, but boot autostart needs linger)

Optional env:
  NODE_BIN_DIR  Override Node.js bin directory used by the service
  APP_PORT      Preview service port (default: 4174)
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

if [[ ! -d "$WEB_DIR" ]]; then
  echo "Error: missing $WEB_DIR"
  exit 1
fi

discover_node_bin_dir() {
  if [[ -n "$NODE_BIN_DIR" ]]; then
    echo "$NODE_BIN_DIR"
    return
  fi

  if command -v npm >/dev/null 2>&1; then
    dirname "$(command -v npm)"
    return
  fi

  if [[ -x "$HOME/.local/bin/npm" ]]; then
    echo "$HOME/.local/bin"
    return
  fi

  if [[ -x "/home/$RUN_USER/.local/bin/npm" ]]; then
    echo "/home/$RUN_USER/.local/bin"
    return
  fi

  echo ""
}

NODE_BIN_DIR="$(discover_node_bin_dir)"

if [[ -z "$NODE_BIN_DIR" || ! -x "$NODE_BIN_DIR/node" || ! -x "$NODE_BIN_DIR/npm" ]]; then
  echo "Error: Node.js/npm not found. Set NODE_BIN_DIR or install Node.js first."
  exit 1
fi

if [[ ! -d "$WEB_DIR/node_modules" ]]; then
  echo "Error: $WEB_DIR/node_modules is missing."
  echo "Run 'cd $WEB_DIR && $NODE_BIN_DIR/npm install' first."
  exit 1
fi

render_unit() {
  local mode="$1"
  local wanted_by="$2"
  local run_user_directive
  local run_group_directive

  if [[ "$mode" == "system" ]]; then
    run_user_directive="User=$RUN_USER"
    run_group_directive="Group=$RUN_GROUP"
  else
    run_user_directive="# Runs in the current user manager."
    run_group_directive="# Group inherited from the user manager."
  fi

  sed \
    -e "s|__PROJECT_DIR__|$ROOT_DIR|g" \
    -e "s|__WEB_DIR__|$WEB_DIR|g" \
    -e "s|__NODE_BIN_DIR__|$NODE_BIN_DIR|g" \
    -e "s|__RUN_USER_DIRECTIVE__|$run_user_directive|g" \
    -e "s|__RUN_GROUP_DIRECTIVE__|$run_group_directive|g" \
    -e "s|__APP_PORT__|$APP_PORT|g" \
    -e "s|__WANTED_BY__|$wanted_by|g" \
    "$SOURCE_UNIT"
}

install_system_unit() {
  local target_unit="/etc/systemd/system/$SERVICE_NAME"

  echo "Installing system unit to $target_unit"
  render_unit system "multi-user.target" | sudo tee "$target_unit" >/dev/null

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"

  echo
  echo "Open Inspection Platform preview service is enabled to start on boot."
  echo "Status:  sudo systemctl status $SERVICE_NAME"
  echo "Logs:    sudo journalctl -u $SERVICE_NAME -f"
  echo "Disable: sudo systemctl disable --now $SERVICE_NAME"
}

install_user_unit() {
  local target_dir="$HOME/.config/systemd/user"
  local target_unit="$target_dir/$SERVICE_NAME"
  local linger

  mkdir -p "$target_dir"
  echo "Installing user unit to $target_unit"
  render_unit user "default.target" > "$target_unit"

  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME"
  systemctl --user restart "$SERVICE_NAME"

  linger="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo "no")"

  echo
  echo "Open Inspection Platform preview user service is enabled."
  echo "Status:  systemctl --user status $SERVICE_NAME"
  echo "Logs:    journalctl --user -u $SERVICE_NAME -f"
  echo "Disable: systemctl --user disable --now $SERVICE_NAME"

  if [[ "$linger" != "yes" ]]; then
    echo
    echo "Note: Linger is not enabled, so this service only starts after you log in."
    echo "For boot autostart without login, run once:"
    echo "  sudo loginctl enable-linger $USER"
  else
    echo
    echo "Linger is enabled; the service will start automatically on boot."
  fi
}

case "$MODE" in
  system) install_system_unit ;;
  user) install_user_unit ;;
esac
