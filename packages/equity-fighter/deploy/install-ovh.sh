#!/usr/bin/env bash
# Install or update Equity Fighter on the OVH McCluster Core box. Run as root from a
# checkout of mcclusterishere/mccluster at the commit to install:
#   sudo bash packages/equity-fighter/deploy/install-ovh.sh
# Owner-run only. It does not touch Core's units, Ollama, the Worker or Supabase.
# It refuses to start the service until /etc/mccluster/equity-fighter.env exists
# (copy packages/equity-fighter/.env.example, fill it, chmod 0640 root:mccluster-core).
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=/opt/mccluster/equity-fighter
ENV_FILE=/etc/mccluster/equity-fighter.env
UNIT=mccluster-equity-fighter.service

[[ ${EUID} -eq 0 ]] || { echo "run as root" >&2; exit 1; }
id mccluster-core >/dev/null 2>&1 || { echo "user mccluster-core missing: install McCluster Core first" >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { echo "Node 20+ required" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
cp -a "${SRC}/package.json" "${SRC}/package-lock.json" "${SRC}/tsconfig.json" "${SRC}/src" "${STAGE}/"
( cd "${STAGE}" && npm ci --no-audit --no-fund --ignore-scripts && npx --no-install tsc -p tsconfig.json && npm prune --omit=dev --no-audit --no-fund )

install -d -o root -g mccluster-core -m 0750 "${TARGET}"
if [[ -d "${TARGET}/dist" ]]; then rm -rf "${TARGET}/dist.previous" && mv "${TARGET}/dist" "${TARGET}/dist.previous"; fi
cp -a "${STAGE}/dist" "${STAGE}/package.json" "${TARGET}/"
chown -R root:mccluster-core "${TARGET}"
chmod -R g+rX,o-rwx "${TARGET}"

install -m 0644 "${SRC}/deploy/${UNIT}" "/etc/systemd/system/${UNIT}"
systemctl daemon-reload

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "installed ${TARGET}; not started: ${ENV_FILE} is missing (see packages/equity-fighter/.env.example)"
  exit 0
fi
chown root:mccluster-core "${ENV_FILE}" && chmod 0640 "${ENV_FILE}"
systemctl enable "${UNIT}"
systemctl restart "${UNIT}"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:4790/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:4790/health; echo
    exit 0
  fi
  sleep 1
done
echo "Equity Fighter did not answer /health; rolling back to the previous build" >&2
journalctl -u "${UNIT}" -n 40 --no-pager >&2 || true
if [[ -d "${TARGET}/dist.previous" ]]; then
  rm -rf "${TARGET}/dist" && mv "${TARGET}/dist.previous" "${TARGET}/dist" && systemctl restart "${UNIT}"
else
  systemctl stop "${UNIT}"
fi
exit 1
