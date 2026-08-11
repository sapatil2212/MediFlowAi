# Self-hosted relay (coturn) for video consultations

The video feature uses no third-party video, signalling, STUN, or TURN service. Media travels directly between the two browsers. This directory provisions the one piece of infrastructure that cannot be avoided: a **STUN/TURN server on your own machine**.

## Why this is required

Browsers behind NAT cannot discover how to reach each other unaided.

- **STUN** tells each browser its own public address. Cheap, tiny traffic. Fixes roughly 85% of connections.
- **TURN** relays the media when no direct path exists — symmetric NAT, corporate firewalls, some mobile carriers. Uses real bandwidth, needed for the remaining ~15%.

Without either, calls only connect when both people are on the same local network. That is exactly the "Relay server (TURN) is not configured" warning in the dashboard: it is not a bug, it is the app telling you this server does not exist yet.

Costs are your own bandwidth on relayed calls only, roughly 15–30 MB per minute of relayed call.

## Option A — install directly (recommended)

On an Ubuntu/Debian VPS with a public IP:

```bash
bash setup.sh turn.yourdomain.com
```

The script installs coturn, generates a shared secret, writes a hardened config, opens the firewall, starts the service, and prints the exact `.env` lines to paste into the application.

Then add an A record for `turn.yourdomain.com` pointing at the server's public IP, paste the printed variables into `.env`, and restart the app.

## Option B — Docker

```bash
# edit turnserver.conf: replace <PUBLIC_IP>, <TURN_REALM>, <SHARED_SECRET>
openssl rand -hex 32        # use this for <SHARED_SECRET>
docker compose up -d
docker compose logs -f coturn
```

`network_mode: host` is intentional — TURN needs a wide UDP relay port range, which Docker's userland proxy handles poorly.

## Firewall ports

| Port | Protocol | Purpose |
|---|---|---|
| 3478 | TCP + UDP | STUN/TURN |
| 5349 | TCP + UDP | STUN/TURN over TLS |
| 10000–20000 | UDP | Media relay range |

If you run on a cloud provider, open these in the security group as well as in `ufw`.

## Application configuration

```env
TURN_URLS="turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp"
TURN_STUN_URLS="stun:turn.yourdomain.com:3478"
TURN_REALM="turn.yourdomain.com"
TURN_SHARED_SECRET="<the generated secret>"
TURN_CREDENTIAL_TTL_SECONDS="3600"
```

The secret stays server-side. The browser only ever receives a short-lived HMAC-SHA1 credential derived from it, capped at one hour, so a leaked credential expires on its own and cannot mint others.

## TLS

Worth doing. TURN over TCP/443 or 5349 is what gets calls through networks that block UDP outright.

```bash
apt-get install -y certbot
certbot certonly --standalone -d turn.yourdomain.com
```

Append to `/etc/turnserver.conf`:

```conf
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem
```

Restart coturn, then add the TLS endpoint to `TURN_URLS`:

```
,turns:turn.yourdomain.com:5349?transport=tcp
```

Certificates renew on certbot's timer; add a `--deploy-hook` of `systemctl restart coturn` so coturn picks up the new cert.

## Verifying it works

In the dashboard: **Video Consult → Connection test**. It runs real ICE gathering from your browser against your configured servers and reports whether `srflx` (STUN) and `relay` (TURN) candidates come back. A green relay result means restrictive-network calls will connect.

You can also check from the command line:

```bash
# should print a shared-secret / realm line
turnutils_stunclient turn.yourdomain.com
journalctl -u coturn -f
```

## Running without a relay

Leaving `TURN_URLS` empty is supported and is the right setting for local development — two browsers on one machine connect over host candidates. The app never silently falls back to a public STUN or TURN service, which is why nothing works across networks until you configure this.
