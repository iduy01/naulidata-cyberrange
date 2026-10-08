#!/usr/bin/env bash
#
# provision.sh — one-shot provisioning of the Cyber Range VM (Proxmox guest).
#
# What it does:
#   1. installs Docker Engine + the compose plugin (if missing)
#   2. creates the shared log directory /opt/admin/logs
#   3. adds the internal DNS entry feedback.admin.local
#   4. builds and starts the lab (docker compose up -d --build)
#   5. seeds the simulated attack telemetry into /opt/admin/logs
#
# Tested on Debian 12 / Ubuntu 22.04 / 24.04. Run as root (sudo).
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # scripts/ -> repo root
COMPOSE_FILE="${REPO_DIR}/docker/docker-compose.yml"
LOG_DIR="/opt/admin/logs"
INTERNAL_HOST="feedback.admin.local"
HTTP_PORT=3075
SSH_PORT=2275

log() { printf '\033[1;34m[provision]\033[0m %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root: sudo bash provision.sh" >&2
  exit 1
fi

# --- 1. Docker -----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker Engine + compose plugin"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc || \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  log "docker already installed: $(docker --version)"
fi

# --- 2. shared log directory ---------------------------------------------------
log "creating ${LOG_DIR}"
mkdir -p "${LOG_DIR}"
chmod 755 "${LOG_DIR}"

# --- 3. internal DNS entry -----------------------------------------------------
if ! grep -q "${INTERNAL_HOST}" /etc/hosts; then
  log "mapping ${INTERNAL_HOST} -> 127.0.0.1 in /etc/hosts"
  echo "127.0.0.1 ${INTERNAL_HOST}" >> /etc/hosts
fi

# --- 4. build + start ----------------------------------------------------------
log "building and starting the lab"
docker compose -f "${COMPOSE_FILE}" up -d --build

log "waiting for the web application on :${HTTP_PORT}"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HTTP_PORT}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# --- 5. seed telemetry ---------------------------------------------------------
# Run the seeder INSIDE the app container so the log files are owned by the same
# user that the application writes them as (avoids host permission issues).
log "seeding simulated attack logs into ${LOG_DIR}"
docker compose -f "${COMPOSE_FILE}" exec -T app python3 /usr/src/app/scripts/inject_logs.py --dir "${LOG_DIR}" --clear \
  || log "WARNING: could not seed logs automatically — run scripts/inject_logs.py as root"

cat <<EOF

============================================================
  Cyber Range is UP
------------------------------------------------------------
  Web (vulnerable app) : http://<VM-IP>:${HTTP_PORT}
  Internal name        : http://${INTERNAL_HOST}:${HTTP_PORT}
  Blue Team SSH        : ssh analyst@<VM-IP> -p ${SSH_PORT}   (pw: blue_team_rocks)
  Logs (Blue Team)     : ${LOG_DIR}/access.log  ${LOG_DIR}/error.log
============================================================
EOF
