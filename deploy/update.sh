#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-/opt/vote-bot}"
PM2_NAME="${PM2_NAME:-vote-bot}"

cd "$APP_DIR"

if [ -f data/db.json ]; then
  mkdir -p data/backups
  cp data/db.json "data/backups/db.$(date +%F-%H%M%S).json"
fi

git pull --ff-only
npm install
npm run build
npm prune --omit=dev

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" || pm2 start dist/index.js --name "$PM2_NAME"
  pm2 save
else
  echo "pm2 is not installed. Run: npm install -g pm2"
  exit 1
fi
