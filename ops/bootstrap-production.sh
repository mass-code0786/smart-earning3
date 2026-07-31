#!/usr/bin/env bash
set -euo pipefail
: "${REPOSITORY_URL:?Set REPOSITORY_URL}"
: "${DOMAIN:?Set DOMAIN}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL}"
APP_ROOT="/var/www/smart-earning3"
sudo apt-get update
sudo apt-get install -y git nginx postgresql-client certbot python3-certbot-nginx nodejs npm
sudo npm install -g pm2
if [[ ! -d "$APP_ROOT/.git" ]]; then sudo git clone "$REPOSITORY_URL" "$APP_ROOT"; fi
sudo chown -R "$USER":"$USER" "$APP_ROOT"
cd "$APP_ROOT"
npm ci --include=dev
if [[ ! -f .env ]]; then cp .env.example .env; chmod 600 .env; printf 'Populate %s/.env from the production secret store, then rerun this script.\n' "$APP_ROOT"; exit 3; fi
npm run verify:production-environment
printf 'server { listen 80; listen [::]:80; server_name %s; location / { proxy_pass http://127.0.0.1:3015; } }\n' "$DOMAIN" | sudo tee /etc/nginx/sites-available/smart-earning >/dev/null
sudo ln -sfn /etc/nginx/sites-available/smart-earning /etc/nginx/sites-enabled/smart-earning
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx --non-interactive --agree-tos --redirect --email "$LETSENCRYPT_EMAIL" -d "$DOMAIN"
sudo install -m 0644 ops/nginx-smart-earning.conf /etc/nginx/sites-available/smart-earning
sudo sed -i "s/example.com/$DOMAIN/g" /etc/nginx/sites-available/smart-earning
sudo nginx -t
sudo systemctl reload nginx
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo install -d -o "$USER" -g "$USER" -m 0750 /var/log/smart-earning /var/backups/smart-earning
sudo install -m 0644 ops/smart-earning-backup.service /etc/systemd/system/smart-earning-backup.service
sudo install -m 0644 ops/smart-earning-backup.timer /etc/systemd/system/smart-earning-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now smart-earning-backup.timer
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
npm run deploy:production -- --confirm-production-deploy
pm2 save
curl --fail --silent "https://$DOMAIN/api/health/ready"
