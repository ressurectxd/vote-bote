#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
COMMAND_NAME="${COMMAND_NAME:-vote-bot-update}"
TARGET="${TARGET:-/usr/local/bin/$COMMAND_NAME}"
PM2_NAME="${PM2_NAME:-vote-bot}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo ./deploy/install-update-command.sh"
  exit 1
fi

cat > "$TARGET" <<EOF
#!/usr/bin/env sh
APP_DIR="$APP_DIR" PM2_NAME="$PM2_NAME" "$APP_DIR/deploy/update.sh"
EOF

chmod +x "$TARGET"
echo "Installed $TARGET"
echo "Now you can deploy with: $COMMAND_NAME"
