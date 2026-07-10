# Deploy to a Linux Server

This guide assumes Ubuntu/Debian and a long-running bot process via systemd.

The bot uses Telegram long polling. It does not need an open inbound HTTP port. The server only needs outbound HTTPS access to `api.telegram.org`. Port 80 is useful only if you later switch to webhooks or host a landing page.

## 1. Install runtime

```bash
sudo apt update
sudo apt install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
```

Check versions:

```bash
node -v
yarn -v
```

## 2. Create app user

```bash
sudo useradd --system --create-home --home /opt/vote-bot --shell /usr/sbin/nologin vote-bot
```

## 3. Upload the project

Option A: clone from GitHub:

```bash
sudo git clone <repo-url> /opt/vote-bot
sudo chown -R vote-bot:vote-bot /opt/vote-bot
```

Option B: copy files from your machine:

```bash
rsync -av --exclude .env --exclude data --exclude dist ./ user@SERVER_IP:/tmp/vote-bot/
ssh user@SERVER_IP "sudo rm -rf /opt/vote-bot && sudo mv /tmp/vote-bot /opt/vote-bot && sudo chown -R vote-bot:vote-bot /opt/vote-bot"
```

## 4. Configure env

```bash
sudo -u vote-bot cp /opt/vote-bot/.env.example /opt/vote-bot/.env
sudo nano /opt/vote-bot/.env
```

Set:

```bash
BOT_TOKEN=123456:replace_me
DATA_FILE=/opt/vote-bot/data/db.json
```

## 5. Install and build

```bash
cd /opt/vote-bot
sudo -u vote-bot yarn install --immutable
sudo -u vote-bot yarn build
```

## 6. Install systemd service

```bash
sudo cp /opt/vote-bot/deploy/vote-bot.service.example /etc/systemd/system/vote-bot.service
sudo systemctl daemon-reload
sudo systemctl enable vote-bot
sudo systemctl start vote-bot
```

Check status and logs:

```bash
sudo systemctl status vote-bot
sudo journalctl -u vote-bot -f
```

## 7. Update deploy

If the project is deployed through Git:

```bash
cd /opt/vote-bot
./deploy/update.sh
```

Manual equivalent:

```bash
cd /opt/vote-bot
sudo -u vote-bot git pull
sudo -u vote-bot yarn install --immutable
sudo -u vote-bot yarn build
sudo systemctl restart vote-bot
sudo journalctl -u vote-bot -f
```

## Backups

The current storage is `/opt/vote-bot/data/db.json`. Back it up before updates:

```bash
sudo cp /opt/vote-bot/data/db.json /opt/vote-bot/data/db.backup.$(date +%F-%H%M%S).json
```

For serious production use, replace JSON storage with SQLite or Postgres.
