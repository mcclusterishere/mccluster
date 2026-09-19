#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:-}"
DEPLOY_SHA="${2:-}"
TARGET_ROOT="${MCCLUSTER_TARGET_ROOT:-/opt/mccluster}"
CORE_TARGET="${TARGET_ROOT}/core"
RELEASE_ROOT="${TARGET_ROOT}/releases"
SYSTEMD_DIR="/etc/systemd/system"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${RELEASE_ROOT}/predeploy-${STAMP}"
DEPLOY_MANIFEST="${CORE_TARGET}/.mccluster-deploy.json"

if [[ -z "${SOURCE_DIR}" || ! -d "${SOURCE_DIR}/core" ]]; then
  echo "usage: $0 <checked-out-repo-dir> <exact-commit-sha>" >&2
  exit 2
fi

if [[ ! "${DEPLOY_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "exact 40-character Git commit SHA required" >&2
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
# Only the exact checkout selected by the promotion/reconcile gate may be stamped.
test "$(git -C "${SOURCE_DIR}" rev-parse HEAD)" = "${DEPLOY_SHA}"
git -C "${SOURCE_DIR}" diff --quiet HEAD -- core scripts/deploy-ovh-core.sh

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
    # Restore the unit files as well as code. Otherwise a failed release leaves
    # new ExecStart paths or privileges behind while claiming code rollback.
    if [[ -d "${BACKUP_DIR}/units" ]]; then
      for saved in "${BACKUP_DIR}"/units/*; do
        [[ -e "${saved}" ]] || continue
        install -m 0644 "${saved}" "${SYSTEMD_DIR}/$(basename "${saved}")"
      done
    fi
    if [[ -f "${BACKUP_DIR}/new-units" ]]; then
      while IFS= read -r name; do
        systemctl disable --now "${name}" >/dev/null 2>&1 || true
        rm -f "${SYSTEMD_DIR}/${name}"
      done < "${BACKUP_DIR}/new-units"
    fi
    if [[ -f "${BACKUP_DIR}/preview-build.rules" ]]; then
      install -m 0644 "${BACKUP_DIR}/preview-build.rules" /etc/polkit-1/rules.d/50-mccluster-preview-build.rules
    elif [[ -f "${BACKUP_DIR}/new-preview-rule" ]]; then
      rm -f /etc/polkit-1/rules.d/50-mccluster-preview-build.rules
    fi
    if [[ -f "${BACKUP_DIR}/node-capabilities.json" ]]; then
      install -o root -g mccluster-node -m 0640 "${BACKUP_DIR}/node-capabilities.json" /etc/mccluster-node/capabilities.json
    elif [[ -f "${BACKUP_DIR}/new-node-capabilities" ]]; then
      rm -f /etc/mccluster-node/capabilities.json
    fi
    systemctl daemon-reload || true
    for unit in mccluster-core-runner.service mccluster-core-tool-broker.service mccluster-preview-gateway.service mccluster-compute-gateway.service mccluster-ollama-adapter.service mccluster-compute-node.service; do
      if systemctl list-unit-files "${unit}" --no-legend 2>/dev/null | grep -q "${unit}"; then
        systemctl try-restart "${unit}" || true
      fi
    done
  fi
  exit "${rc}"
}
trap rollback ERR

# Snapshot only the deploy-controlled Core tree. Secrets remain under /etc/mccluster.
# The deployment manifest lives inside Core, so rollback restores provenance too.
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

cat >"${DEPLOY_MANIFEST}" <<EOF
{"schema_version":1,"commit_sha":"${DEPLOY_SHA}","deployed_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

chown -R root:root "${CORE_TARGET}"
chmod 0644 "${DEPLOY_MANIFEST}"

# Capture exactly the settings this release will replace, before installing them.
mkdir -p "${BACKUP_DIR}/units"
for unit in "${SOURCE_DIR}"/core/systemd/*.service "${SOURCE_DIR}"/core/systemd/*.timer; do
  [[ -e "${unit}" ]] || continue
  name="$(basename "${unit}")"
  if [[ -f "${SYSTEMD_DIR}/${name}" ]]; then
    cp -p "${SYSTEMD_DIR}/${name}" "${BACKUP_DIR}/units/${name}"
  else
    printf '%s\n' "${name}" >> "${BACKUP_DIR}/new-units"
  fi
done
install -d -o mccluster-core -g mccluster-core -m 0750 /var/lib/mccluster-core/previews
# This rule only delegates starting constrained build instances; Core keeps NoNewPrivileges.
if [[ -d /etc/polkit-1/rules.d ]]; then
  if [[ -f /etc/polkit-1/rules.d/50-mccluster-preview-build.rules ]]; then
    cp -p /etc/polkit-1/rules.d/50-mccluster-preview-build.rules "${BACKUP_DIR}/preview-build.rules"
  else
    touch "${BACKUP_DIR}/new-preview-rule"
  fi
  install -m 0644 "${SOURCE_DIR}/core/systemd/50-mccluster-preview-build.rules" /etc/polkit-1/rules.d/50-mccluster-preview-build.rules
fi

# Install the canonical systemd units shipped by the repo.
for unit in "${SOURCE_DIR}"/core/systemd/*.service "${SOURCE_DIR}"/core/systemd/*.timer; do
  [[ -e "${unit}" ]] || continue
  install -m 0644 "${unit}" "${SYSTEMD_DIR}/$(basename "${unit}")"
done

# Canonicalize non-secret compute-node capabilities from Git when this host
# declares a known node name. Node identity and enrollment secrets remain local.
if [[ -r /etc/mccluster-node/node.env ]]; then
  NODE_NAME="$(sed -n 's/^MCCLUSTER_NODE_NAME=//p' /etc/mccluster-node/node.env | tail -n 1)"
  NODE_MANIFEST_SOURCE="${SOURCE_DIR}/core/node-manifests/${NODE_NAME}.json"
  if [[ -n "${NODE_NAME}" && -f "${NODE_MANIFEST_SOURCE}" ]]; then
    install -d -o root -g mccluster-node -m 0750 /etc/mccluster-node
    if [[ -f /etc/mccluster-node/capabilities.json ]]; then
      cp -p /etc/mccluster-node/capabilities.json "${BACKUP_DIR}/node-capabilities.json"
    else
      touch "${BACKUP_DIR}/new-node-capabilities"
    fi
    install -o root -g mccluster-node -m 0640 "${NODE_MANIFEST_SOURCE}" /etc/mccluster-node/capabilities.json
  fi
fi

systemctl daemon-reload

# Keep timers enabled; restart only services that already exist on this host.
for timer in mccluster-core-digest.timer mccluster-core-portfolio-plan.timer mccluster-core-reflection.timer mccluster-core-system-health.timer mccluster-vps-reconcile.timer; do
  if systemctl list-unit-files "${timer}" --no-legend 2>/dev/null | grep -q "${timer}"; then
    systemctl enable --now "${timer}"
  fi
done

for unit in mccluster-core-tool-broker.service mccluster-compute-gateway.service mccluster-ollama-adapter.service mccluster-compute-node.service mccluster-core-runner.service; do
  if systemctl list-unit-files "${unit}" --no-legend 2>/dev/null | grep -q "${unit}"; then
    systemctl restart "${unit}"
  fi
done

# The preview file server is loopback-only and receives no Core credentials.
systemctl enable --now mccluster-preview-gateway.service
systemctl restart mccluster-preview-gateway.service
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 --max-time 5 http://127.0.0.1:4799/health >/dev/null

# Runner and broker are the minimum healthy Core surface.
systemctl is-active --quiet mccluster-core-runner.service
systemctl is-active --quiet mccluster-core-tool-broker.service

grep -Fq "\"commit_sha\":\"${DEPLOY_SHA}\"" "${DEPLOY_MANIFEST}"
printf 'deployed_core=%s\ncommit_sha=%s\nmanifest=%s\nbackup=%s\n' "${CORE_TARGET}" "${DEPLOY_SHA}" "${DEPLOY_MANIFEST}" "${BACKUP_DIR}"
