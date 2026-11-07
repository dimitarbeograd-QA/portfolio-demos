#!/usr/bin/env bash
# Spark – начално пускане на чиста Ubuntu 22.04/24.04 машина (Oracle Always Free).
# Пуска се НА СЪРВЪРА:  curl -fsSL <raw-url>/bootstrap.sh -o bootstrap.sh && bash bootstrap.sh
# Прави: Docker + ufw, клонира репото, генерира тайните, пише deploy/.env, стартира compose.
# Не праща и не записва нищо извън тази машина. Може да се пуска повторно (не презаписва .env).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/dimitarbeograd-QA/portfolio-demos}"
BRANCH="${BRANCH:-claude/add-spark-dating}"
DIR="${DIR:-$HOME/portfolio-demos}"

[ "$(id -u)" -ne 0 ] || { echo "Пусни като обикновен потребител (с sudo), не като root."; exit 1; }

echo "==> Инсталиране на Docker, git, ufw"
sudo apt-get update -y
sudo apt-get install -y docker.io docker-compose-v2 git ufw openssl curl
sudo usermod -aG docker "$USER" || true

echo "==> Защитна стена (SSH, 80, 443)"
sudo ufw allow OpenSSH >/dev/null
sudo ufw allow 80/tcp >/dev/null
sudo ufw allow 443/tcp >/dev/null
sudo ufw --force enable >/dev/null
# Oracle образите имат iptables правила, които блокират 80/443 въпреки ufw
if sudo iptables -S INPUT 2>/dev/null | grep -q REJECT; then
  sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
  command -v netfilter-persistent >/dev/null || sudo apt-get install -y iptables-persistent
  sudo netfilter-persistent save || true
fi

echo "==> Репо"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch origin "$BRANCH" && git -C "$DIR" checkout "$BRANCH" && git -C "$DIR" pull --ff-only origin "$BRANCH"
else git clone -b "$BRANCH" "$REPO_URL" "$DIR"; fi
cd "$DIR/spark-dating/deploy"

if [ ! -f .env ]; then
  echo "==> Настройка (.env)"
  read -rp "Адрес на сайта (напр. spark-xx.duckdns.org): " SITE
  read -rp "Адрес на администрацията (напр. admin-xx.duckdns.org): " ADM
  read -rp "Подател на пощата (MAIL_FROM, напр. Spark <имейл@домейн>): " FROM
  read -rsp "SMTP_URL (напр. smtp://логин:ключ@smtp-relay.brevo.com:587; скрито): " SMTP; echo
  read -rp "Твоят IP за достъп до администрацията (празно = всички): " MYIP
  umask 077
  cat > .env <<EOF
SITE_DOMAIN=$SITE
ADMIN_DOMAIN=$ADM
SESSION_SECRET=$(openssl rand -hex 48)
ADMIN_SESSION_SECRET=$(openssl rand -hex 48)
SMTP_URL=$SMTP
MAIL_FROM=$FROM
ADMIN_ALLOW_IPS=${MYIP:-0.0.0.0/0 ::/0}
ICE_SERVERS=
EOF
  echo ".env е записан (права 600)."
else
  echo "==> .env вече съществува – не го пипам."
fi

echo "==> Стартиране (първото строене отнема няколко минути)"
sudo docker compose --env-file .env up -d --build
sudo docker compose --env-file .env ps

cat <<'MSG'

Готово. Следващи стъпки:
1) DNS: и двата адреса трябва да сочат към публичния IP на тази машина (иначе Caddy не взима сертификат).
2) Първи администратор:
   sudo docker compose --env-file .env run --rm -it admin node scripts/create-admin.js ТвоетоИме
   (запиши ключа за 2FA в приложение – показва се само веднъж)
3) Логове при проблем:  sudo docker compose --env-file .env logs --tail=100
MSG
