#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root: sudo bash core/install.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
CORE_SRC="$REPO_DIR/core"

if [[ ! -f "$CORE_SRC/package.json" ]]; then
  echo "Run this installer from a checkout of mcclusterishere/mccluster." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gh jq nodejs npm openssl rsync

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js >=20 is required; installed major version is $NODE_MAJOR." >&2
  echo "Upgrade Node.js, then rerun this installer." >&2
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl enable --now ollama

if ! command -v opencode >/dev/null 2>&1; then
  npm install -g opencode-ai
fi
OPENCODE_BIN="$(command -v opencode)"
if [[ "$OPENCODE_BIN" != "/usr/local/bin/opencode" ]]; then
  ln -sf "$OPENCODE_BIN" /usr/local/bin/opencode
fi

groupadd --system mccluster-work 2>/dev/null || true

if ! id mccluster-core >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/mccluster-core --shell /usr/sbin/nologin --gid mccluster-work mccluster-core
else
  usermod -a -G mccluster-work mccluster-core
fi

if ! id mccluster-agent >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/mccluster-agent --shell /usr/sbin/nologin --gid mccluster-work mccluster-agent
else
  usermod -a -G mccluster-work mccluster-agent
fi

install -d -o root -g mccluster-work -m 2770 /srv/mccluster /srv/mccluster/repos /srv/mccluster/worktrees
install -d -o mccluster-core -g mccluster-work -m 0750 /var/lib/mccluster-core
install -d -o mccluster-agent -g mccluster-work -m 0750 /var/lib/mccluster-agent /var/lib/mccluster-agent/.config /var/lib/mccluster-agent/.config/opencode
install -d -o root -g root -m 0755 /opt/mccluster
install -d -o root -g root -m 0755 /etc/mccluster

rsync -a --delete --exclude 'node_modules' "$CORE_SRC/" /opt/mccluster/core/
chown -R root:root /opt/mccluster/core
chmod -R u=rwX,go=rX /opt/mccluster/core

install -o mccluster-agent -g mccluster-work -m 0640 "$CORE_SRC/opencode/opencode.json" /var/lib/mccluster-agent/.config/opencode/opencode.json

if [[ ! -f /etc/mccluster/agent.env ]]; then
  OPENCODE_PASSWORD="$(openssl rand -hex 32)"
  cat >/etc/mccluster/agent.env <<EOF
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=$OPENCODE_PASSWORD
EOF
  chown root:mccluster-agent /etc/mccluster/agent.env
  chmod 0640 /etc/mccluster/agent.env
else
  OPENCODE_PASSWORD="$(awk -F= '$1=="OPENCODE_SERVER_PASSWORD" {print substr($0,index($0,"=")+1)}' /etc/mccluster/agent.env | tail -1)"
fi

if [[ -z "${OPENCODE_PASSWORD:-}" ]]; then
  echo "OPENCODE_SERVER_PASSWORD is missing from /etc/mccluster/agent.env" >&2
  exit 1
fi

if [[ ! -f /etc/mccluster/core.env ]]; then
  sed "s/^OPENCODE_SERVER_PASSWORD=.*/OPENCODE_SERVER_PASSWORD=$OPENCODE_PASSWORD/" "$CORE_SRC/core.env.example" >/etc/mccluster/core.env
  chown root:mccluster-core /etc/mccluster/core.env
  chmod 0640 /etc/mccluster/core.env
else
  if grep -q '^OPENCODE_SERVER_PASSWORD=$' /etc/mccluster/core.env; then
    sed -i "s/^OPENCODE_SERVER_PASSWORD=$/OPENCODE_SERVER_PASSWORD=$OPENCODE_PASSWORD/" /etc/mccluster/core.env
  fi
fi

if [[ ! -d /srv/mccluster/repos/mccluster/.git ]]; then
  runuser -u mccluster-core -- git clone https://github.com/mcclusterishere/mccluster.git /srv/mccluster/repos/mccluster
fi
chgrp -R mccluster-work /srv/mccluster/repos/mccluster /srv/mccluster/worktrees
chmod -R g+rX /srv/mccluster/repos/mccluster
chmod g+rws /srv/mccluster/repos /srv/mccluster/worktrees

install -o root -g root -m 0644 "$CORE_SRC/systemd/mccluster-opencode.service" /etc/systemd/system/mccluster-opencode.service
install -o root -g root -m 0644 "$CORE_SRC/systemd/mccluster-core-runner.service" /etc/systemd/system/mccluster-core-runner.service
install -o root -g root -m 0644 "$CORE_SRC/systemd/mccluster-core-digest.service" /etc/systemd/system/mccluster-core-digest.service
install -o root -g root -m 0644 "$CORE_SRC/systemd/mccluster-core-digest.timer" /etc/systemd/system/mccluster-core-digest.timer

# qwen3:8b is the resident default because its ~5.2 GB Q4 footprint leaves
# meaningful headroom on the 24 GB host. Pulling is idempotent.
ollama pull qwen3:8b

systemctl daemon-reload
systemctl enable --now mccluster-opencode.service
systemctl enable mccluster-core-runner.service
systemctl enable --now mccluster-core-digest.timer

cat <<'EOF'

McCluster Core host packages and services are installed.

Before starting the durable runner, edit:
  sudoedit /etc/mccluster/core.env

Required values:
  SUPABASE_SERVICE_ROLE_KEY
  MCCLUSTER_ORG_ID

Optional morning SMS values:
  MCCLUSTER_PHONE
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_FROM

For autonomous draft PR creation, authenticate GitHub for the mccluster-core
service account using a credential method you control. Core never gives those
credentials to OpenCode.

Then validate and start:
  sudo -u mccluster-core -H env $(sudo sed '/^#/d;/^$/d' /etc/mccluster/core.env | xargs) node /opt/mccluster/core/src/runner.mjs --once
  sudo systemctl start mccluster-core-runner
  sudo systemctl status mccluster-core-runner mccluster-opencode ollama --no-pager
  sudo systemctl list-timers mccluster-core-digest.timer

Logs:
  sudo journalctl -u mccluster-core-runner -u mccluster-opencode -u mccluster-core-digest -f
EOF
