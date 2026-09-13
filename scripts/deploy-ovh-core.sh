#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:-}"
TARGET_ROOT="${MCCLUSTER_TARGET_ROOT:-/opt/mccluster}"
CORE_TARGET="${TARGET_ROOT}/core"
RELEASE_ROOT="${TARGET_ROOT}/releases"
SYSTEMD_DIR="/etc/systemd/system"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${RELEASE_ROOT}/predeploy-${STAMP}"

if [[ -z "${SOURCE_DIR}" || ! -d "${SOURCE_DIR}/core" ]]; then
  echo "usage: $0 <checked-out-repo-dir>" >&2
  exit 2
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "deploy script must run as root (use sudo)" >&2
  exit 2
fi

command -v rsync >/dev/null
command -v node >/dev/null
command -v npm >/dev/null
command -v systemctl >/dev/null

mkdir -p "${RELEASE_ROOT}"

# Validate the incoming Core tree before touching the live install.
pushd "${SOURCE_DIR}/core" >/dev/null
npm run check
npm test
popd >/dev/null

rollback() {
  local rc=$?
  if [[ ${rc} -eq 0 ]]; then
    return 0
  fi
  echo "deploy failed (rc=${rc}); attempting rollback" >&2
  if [[ -d "${BACKUP_DIR}/core" ]]; then
    mkdir -p "${CORE_TARGET}"
    rsync -a --delete "${BACKUP_DIR}/core/" "${CORE_TARGET}/"
    systemctl daemon-reload || true
    for unit in mccluster-core-runner.service mccluster-core-tool-broker.service mccluster-compute-gateway.service mccluster-compute-node.service; do
      systemctl try-restart "${unit}" || true
    done
  fi
  exit "${rc}"
}
trap rollback ERR

# Snapshot only the deploy-controlled Core tree. Secrets remain under /etc/mccluster.
if [[ -d "${CORE_TARGET}" ]]; then
  mkdir -p "${BACKUP_DIR}/core"
  rsync -a "${CORE_TARGET}/" "${BACKUP_DIR}/core/"
fi

mkdir -p "${CORE_TARGET}"
rsync -a --delete \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.mccluster-artifacts' \
  "${SOURCE_DIR}/core/" "${CORE_TARGET}/"

chown -R root:root "${CORE_TARGET}"

# Install the canonical systemd units shipped by the repo.
for unit in "${SOURCE_DIR}"/core/systemd/*.service "${SOURCE_DIR}"/core/systemd/*.timer; do
  [[ -e "${unit}" ]] || continue
  install -m 0644 "${unit}" "${SYSTEMD_DIR}/$(basename "${unit}")"
done

systemctl daemon-reload

# Keep timers enabled; restart only services that already exist on this host.
for timer in mccluster-core-digest.timer mccluster-core-portfolio-plan.timer mccluster-core-reflection.timer; do
  if systemctl list-unit-files "${timer}" --no-legend 2>/dev/null | grep -q "${timer}"; then
    systemctl enable --now "${timer}"
  fi
done

for unit in mccluster-core-tool-broker.service mccluster-compute-gateway.service mccluster-compute-node.service mccluster-core-runner.service; do
  if systemctl list-unit-files "${unit}" --no-legend 2>/dev/null | grep -q "${unit}"; then
    systemctl restart "${unit}"
  fi
done

# Runner and broker are the minimum healthy Core surface.
systemctl is-active --quiet mccluster-core-runner.service
systemctl is-active --quiet mccluster-core-tool-broker.service

printf 'deployed_core=%s\nbackup=%s\n' "${CORE_TARGET}" "${BACKUP_DIR}"
