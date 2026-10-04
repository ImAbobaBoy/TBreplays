#!/usr/bin/env bash
# Ubuntu 22.04+. Keeps existing maps, replay data and user accounts in place.
set -euo pipefail
umask 022
SITE_IP=${1:?Usage: bash deploy/deploy-ip-https.sh PUBLIC_IPV4}
REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
BACKEND="$REPO/TBReplays/TBReplays"
FRONTEND="$REPO/TBreplaysF-design-integrated/TBreplaysF/TBreplaysF/TBReplays.Web"
RELEASE="/opt/tbreplays/releases/$(date +%Y%m%d-%H%M%S)"
[[ $EUID -eq 0 ]] || { echo 'Run as root'; exit 1; }
[[ $SITE_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Expected public IPv4'; exit 1; }
[[ -f "$BACKEND/MapData/map_catalog.json" ]] || { echo 'MapData/map_catalog.json missing; upload maps first'; exit 1; }
command -v dotnet >/dev/null
command -v npm >/dev/null
[[ $(df --output=avail -B1 / | tail -1) -gt 1073741824 ]] || { echo 'At least 1 GiB free disk space required'; exit 1; }

# Prefer the existing persisted account directory from server configuration.
ONLINE_DATA=$(python3 - "$BACKEND" <<'PY'
import json, pathlib, sys
base = pathlib.Path(sys.argv[1])
config = {}
for name in ('appsettings.json', 'appsettings.Production.json', 'appsettings.Local.json'):
    file = base / name
    if file.exists():
        config.update(json.loads(file.read_text(encoding='utf-8-sig')).get('Online', {}))
path = pathlib.Path(config.get('DataPath', 'Data/Online'))
print(path if path.is_absolute() else base / path)
PY
)
ONLINE_DATA=${TBREPLAYS_ONLINE_DATA:-$ONLINE_DATA}
[[ -f "$ONLINE_DATA/users.json" ]] || { echo "Existing users.json missing in $ONLINE_DATA; set TBREPLAYS_ONLINE_DATA to the current account directory"; exit 1; }

apt-get update
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https ca-certificates curl gnupg
# Ubuntu installations without universe do not expose caddy. Use its official stable repository.
CADDY_REPO_TEMP=$(mktemp -d)
trap 'rm -rf -- "$CADDY_REPO_TEMP"' EXIT
curl --fail --silent --show-error --location --proto '=https' \
    https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o "$CADDY_REPO_TEMP/gpg.key"
gpg --batch --yes --dearmor -o "$CADDY_REPO_TEMP/caddy.gpg" "$CADDY_REPO_TEMP/gpg.key"
curl --fail --silent --show-error --location --proto '=https' \
    https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o "$CADDY_REPO_TEMP/caddy.list"
install -m 644 "$CADDY_REPO_TEMP/caddy.gpg" /usr/share/keyrings/caddy-stable-archive-keyring.gpg
install -m 644 "$CADDY_REPO_TEMP/caddy.list" /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy python3-venv
[[ -x /opt/tbreplays-certbot/bin/python ]] || python3 -m venv /opt/tbreplays-certbot
/opt/tbreplays-certbot/bin/python -m pip install --upgrade 'certbot>=5.4'
mkdir -p "$RELEASE" /srv/tbreplays/web /var/lib/tbreplays/acme /etc/caddy/tbreplays
chmod 755 /var/lib/tbreplays /var/lib/tbreplays/acme

dotnet publish "$BACKEND/TBReplays.csproj" -c Release -o "$RELEASE"
(cd "$FRONTEND" && npm ci && npm run build)
cp -a "$FRONTEND/dist/." /srv/tbreplays/web/
chmod -R a+rX /srv/tbreplays/web

# Stop only old processes started from this project's backend/frontend directories.
systemctl stop tbreplays.service 2>/dev/null || true
python3 - "$BACKEND" "$FRONTEND" <<'PY'
import pathlib, signal, sys, os
backend, frontend = map(pathlib.Path, sys.argv[1:])
for process in pathlib.Path('/proc').iterdir():
    if not process.name.isdigit() or int(process.name) == os.getpid():
        continue
    try:
        cwd = (process / 'cwd').resolve()
        command = (process / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
        name = (process / 'comm').read_text().strip()
        if (cwd == backend and name in ('dotnet', 'TBReplays')) or (cwd == frontend and 'vite' in command and name in ('node', 'npm run dev')):
            os.kill(int(process.name), signal.SIGTERM)
    except (OSError, ProcessLookupError):
        pass
PY

BACKUP="/var/backups/tbreplays/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
chmod 700 /var/backups/tbreplays "$BACKUP"
cp -a "$ONLINE_DATA" "$BACKUP/online"
[[ ! -f /etc/caddy/Caddyfile ]] || cp -a /etc/caddy/Caddyfile "$BACKUP/Caddyfile"

cat >/etc/tbreplays.env <<EOF
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5000
MapImport__DataDirectory=$BACKEND/MapData
Online__DataPath=$ONLINE_DATA
Online__AllowedOrigins__0=https://$SITE_IP
Online__KnownProxies__0=127.0.0.1
EOF
chmod 600 /etc/tbreplays.env
cat >/etc/systemd/system/tbreplays.service <<EOF
[Unit]
Description=TBReplays backend
After=network.target
[Service]
WorkingDirectory=$BACKEND
ExecStart=$(command -v dotnet) $RELEASE/TBReplays.dll
EnvironmentFile=/etc/tbreplays.env
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
[Install]
WantedBy=multi-user.target
EOF
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=TBREPLAYS_IP=%s\n' "$SITE_IP" >/etc/systemd/system/caddy.service.d/tbreplays.conf
systemctl daemon-reload

# Serve ACME over HTTP for the first certificate. No self-signed certificate is used.
if [[ ! -f "/etc/letsencrypt/live/$SITE_IP/fullchain.pem" ]]; then
    cat >/etc/caddy/Caddyfile <<EOF
http://$SITE_IP {
    root * /var/lib/tbreplays/acme
    file_server
}
EOF
    systemctl enable --now caddy
    systemctl reload caddy
    /opt/tbreplays-certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
        --preferred-profile shortlived --webroot --webroot-path /var/lib/tbreplays/acme \
        --cert-name "$SITE_IP" --ip-address "$SITE_IP"
fi

mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat >/etc/letsencrypt/renewal-hooks/deploy/tbreplays-caddy <<EOF
#!/bin/sh
set -eu
install -o root -g caddy -m 640 /etc/letsencrypt/live/$SITE_IP/fullchain.pem /etc/caddy/tbreplays/fullchain.pem
install -o root -g caddy -m 640 /etc/letsencrypt/live/$SITE_IP/privkey.pem /etc/caddy/tbreplays/privkey.pem
systemctl reload caddy
EOF
chmod 750 /etc/letsencrypt/renewal-hooks/deploy/tbreplays-caddy
install -o root -g caddy -m 640 "/etc/letsencrypt/live/$SITE_IP/fullchain.pem" /etc/caddy/tbreplays/fullchain.pem
install -o root -g caddy -m 640 "/etc/letsencrypt/live/$SITE_IP/privkey.pem" /etc/caddy/tbreplays/privkey.pem
cp "$REPO/deploy/Caddyfile.ip" /etc/caddy/Caddyfile
TBREPLAYS_IP="$SITE_IP" caddy validate --config /etc/caddy/Caddyfile

cat >/etc/systemd/system/tbreplays-certbot.service <<'EOF'
[Unit]
Description=Renew TBReplays IP certificate
[Service]
Type=oneshot
ExecStart=/opt/tbreplays-certbot/bin/certbot renew --quiet
EOF
cat >/etc/systemd/system/tbreplays-certbot.timer <<'EOF'
[Unit]
Description=Check IP certificate renewal twice daily
[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now tbreplays.service tbreplays-certbot.timer caddy
systemctl reload caddy
curl --fail --silent --show-error "https://$SITE_IP/" >/dev/null
# systemctl start returns before Kestrel has completed startup. Caddy may briefly return 502.
if ! curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
    --retry 12 --retry-delay 2 --retry-max-time 60 --retry-connrefused \
    "https://$SITE_IP/api/auth/csrf" >/dev/null; then
    echo 'Backend did not become ready. Startup diagnostics:' >&2
    systemctl status tbreplays.service --no-pager >&2 || true
    journalctl -u tbreplays.service -n 60 --no-pager >&2 || true
    exit 1
fi
echo "Ready: https://$SITE_IP/ (maps and accounts preserved; backup: $BACKUP)"
