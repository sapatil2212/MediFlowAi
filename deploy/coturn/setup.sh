#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — provision self-hosted coturn for BookMyTime video consultations.
#
# Run on your own Ubuntu/Debian VPS as root:
#   bash setup.sh turn.yourdomain.com
#
# It installs coturn, generates a shared secret, writes the config, opens the
# firewall, and prints the exact .env lines to paste into the application.
#
# No third-party video/STUN/TURN service is used — this server is the only relay.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REALM="${1:-}"
if [[ -z "$REALM" ]]; then
  echo "Usage: bash setup.sh <turn-domain>   e.g. bash setup.sh turn.bookmytime.tech" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo bash setup.sh $REALM)" >&2
  exit 1
fi

echo "==> Detecting public IP"
PUBLIC_IP="$(curl -fsS https://api.ipify.org || true)"
if [[ -z "$PUBLIC_IP" ]]; then
  read -rp "Could not auto-detect. Enter this server's public IPv4: " PUBLIC_IP
fi
echo "    Public IP: $PUBLIC_IP"

echo "==> Installing coturn"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn

echo "==> Generating shared secret"
SECRET="$(openssl rand -hex 32)"

echo "==> Writing /etc/turnserver.conf"
cat >/etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=${PUBLIC_IP}

min-port=10000
max-port=20000

use-auth-secret
static-auth-secret=${SECRET}
realm=${REALM}

no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff

no-cli
no-sqlite
user-quota=12
total-quota=1200
max-bps=500000

log-file=/var/log/turnserver.log
simple-log
EOF

chmod 640 /etc/turnserver.conf

echo "==> Enabling the service"
# Debian's package ships a guard that keeps the daemon disabled by default.
if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn || echo 'TURNSERVER_ENABLED=1' >>/etc/default/coturn
fi

echo "==> Opening firewall (ufw, if present)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 3478/tcp  >/dev/null 2>&1 || true
  ufw allow 3478/udp  >/dev/null 2>&1 || true
  ufw allow 5349/tcp  >/dev/null 2>&1 || true
  ufw allow 5349/udp  >/dev/null 2>&1 || true
  ufw allow 10000:20000/udp >/dev/null 2>&1 || true
  echo "    ufw rules added."
else
  echo "    ufw not found — open these yourself in your cloud security group:"
  echo "      TCP 3478, UDP 3478, TCP 5349, UDP 5349, UDP 10000-20000"
fi

systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 2

if systemctl is-active --quiet coturn; then
  echo "==> coturn is running."
else
  echo "!! coturn failed to start. Inspect: journalctl -u coturn -n 50" >&2
  exit 1
fi

cat <<EOF

────────────────────────────────────────────────────────────────────────────
 Add these lines to your application .env, then restart the app:
────────────────────────────────────────────────────────────────────────────
TURN_URLS="turn:${REALM}:3478?transport=udp,turn:${REALM}:3478?transport=tcp"
TURN_STUN_URLS="stun:${REALM}:3478"
TURN_REALM="${REALM}"
TURN_SHARED_SECRET="${SECRET}"
TURN_CREDENTIAL_TTL_SECONDS="3600"
────────────────────────────────────────────────────────────────────────────

 Point DNS: an A record for ${REALM} -> ${PUBLIC_IP}

 Strongly recommended next step — enable TLS so calls survive networks that
 block UDP entirely:

   apt-get install -y certbot
   certbot certonly --standalone -d ${REALM}
   # then append to /etc/turnserver.conf:
   #   cert=/etc/letsencrypt/live/${REALM}/fullchain.pem
   #   pkey=/etc/letsencrypt/live/${REALM}/privkey.pem
   systemctl restart coturn
   # and add the TLS endpoint to TURN_URLS:
   #   ,turns:${REALM}:5349?transport=tcp

 Verify from the dashboard: Video Consult -> Connection test.
────────────────────────────────────────────────────────────────────────────
EOF
