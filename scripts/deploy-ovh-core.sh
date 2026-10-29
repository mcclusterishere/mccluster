#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:-}"
DEPLOY_SHA="${2:-}"
TARGET_ROOT="${MCCLUSTER_TARGET_ROOT:-/opt/mccluster}"
CORE_TARGET="${TARGET_ROOT}/core"
RECONCILE_TARGET="${TARGET_ROOT}/reconcile"
RECONCILE_SCRIPT="${RECONCILE_TARGET}/mccluster-vps-reconcile.sh"
RELEASE_ROOT="${TARGET_ROOT}/releases"
SYSTEMD_DIR="/etc/systemd/system"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${RELEASE_ROOT}/predeploy-${STAMP}"
DEPLOY_MANIFEST="${CORE_TARGET}/.mccluster-deploy.json"
# Set once the live install is about to change; rollback restarts and verifies
# only when there is something live to recover.
LIVE_TOUCHED=0

# Shared restart + health probe: the forward gate and rollback use one probe.
# shellcheck source=scripts/ovh-core-health.sh
source "$(dirname "${BASH_SOURCE[0]}")/ovh-core-health.sh"

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
git -C "${SOURCE_DIR}" diff --quiet HEAD -- core scripts/deploy-ovh-core.sh scripts/ovh-core-health.sh scripts/mccluster-vps-reconcile.sh

# Validate the incoming Core tree before touching the live install.
pushd "${SOURCE_DIR}/core" >/dev/null
npm run check
npm test
popd >/dev/null

rollback() {
  local rc=$?
  # Recovery is handled explicitly below: a failing step inside rollback must
  # neither re-enter this trap nor exit silently under errexit.
  trap - ERR
  set +e
  if [[ ${rc} -eq 0 ]]; then
    return 0
  fi
  if [[ ${LIVE_TOUCHED} -eq 0 ]]; then
    mcc_log "deploy failed (rc=${rc}) before the live install changed; nothing to roll back"
    exit "${rc}"
  fi
  mcc_log "deploy failed (rc=${rc}); rolling back to the previous release"
  if [[ -d "${BACKUP_DIR}/core" ]]; then
    mkdir -p "${CORE_TARGET}"
    if ! rsync -a --delete "${BACKUP_DIR}/core/" "${CORE_TARGET}/"; then
      mcc_log "ROLLBACK FAILED: could not restore Core files from ${BACKUP_DIR}/core"
      exit "${MCC_ROLLBACK_UNHEALTHY_RC}"
    fi
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
    systemctl daemon-reload || mcc_log "rollback: systemctl daemon-reload failed"
  fi
  # The reconciler has its own backup marker so it can be restored even if this
  # was the first Core deployment and there was no prior Core tree to restore.
  if [[ -f "${BACKUP_DIR}/reconcile-script" ]]; then
    install -d -o root -g root -m 0755 "${RECONCILE_TARGET}"
    install -o root -g root -m 0755 "${BACKUP_DIR}/reconcile-script" "${RECONCILE_SCRIPT}"
  elif [[ -f "${BACKUP_DIR}/new-reconcile-script" ]]; then
    rm -f "${RECONCILE_SCRIPT}"
  fi
  if [[ ! -d "${BACKUP_DIR}/core" ]]; then
    mcc_log "ROLLBACK FAILED: no previous Core release was captured (first deploy); there is no healthy release to restore"
    exit "${MCC_ROLLBACK_UNHEALTHY_RC}"
  fi
  # Restoring files is not recovery. A release that failed to start leaves its
  # units inactive, so restart every unit the deploy restarted and verify the
  # restored release with the deploy's own health probe.
  if ! mcc_recover_restored_release; then
    mcc_log "deploy rc=${rc}; rollback restored files from ${BACKUP_DIR} but the restored release is unhealthy"
    exit "${MCC_ROLLBACK_UNHEALTHY_RC}"
  fi
  mcc_log "deploy failed (rc=${rc}); previous release restored from ${BACKUP_DIR} and healthy"
  exit "${rc}"
}
trap rollback ERR

LIVE_TOUCHED=1

# Snapshot only the deploy-controlled Core tree. Secrets remain under /etc/mccluster.
# The deployment manifest lives inside Core, so rollback restores provenance too.
if [[ -d "${CORE_TARGET}" ]]; then
  mkdir -p "${BACKUP_DIR}/core"
  rsync -a "${CORE_TARGET}/" "${BACKUP_DIR}/core/"
fi

# The reconciler is part of the deployment contract too. Keep it under /opt so
# the reconciler's own ProtectSystem=full sandbox can update it on the first
# promoted release, then rollback it together with Core if validation fails.
mkdir -p "${BACKUP_DIR}"
if [[ -f "${RECONCILE_SCRIPT}" ]]; then
  cp -p "${RECONCILE_SCRIPT}" "${BACKUP_DIR}/reconcile-script"
else
  touch "${BACKUP_DIR}/new-reconcile-script"
fi
install -d -o root -g root -m 0755 "${RECONCILE_TARGET}"
install -o root -g root -m 0755 "${SOURCE_DIR}/scripts/mccluster-vps-reconcile.sh" "${RECONCILE_SCRIPT}"

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
install -d -o mccluster-core -g mccluster-core -m 0750 \
  /var/lib/mccluster-core/previews \
  /var/lib/mccluster-core/workspace \
  /var/lib/mccluster-core/sessions \
  /var/lib/mccluster-core/artifacts
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
for timer in mccluster-core-actors.timer mccluster-core-knowledge.timer mccluster-core-digest.timer mccluster-core-portfolio-plan.timer mccluster-core-reflection.timer mccluster-core-system-health.timer mccluster-vps-reconcile.timer; do
  if systemctl list-unit-files "${timer}" --no-legend 2>/dev/null | grep -q "${timer}"; then
    systemctl enable --now "${timer}"
  fi
done

# Catch up the knowledge export after deployment without blocking inference.
systemctl start --no-block mccluster-core-knowledge.service

for unit in "${MCC_CORE_SERVICES[@]}"; do
  if mcc_unit_installed "${unit}"; then
    systemctl restart "${unit}"
  fi
done

# The preview file server is loopback-only and receives no Core credentials.
systemctl enable --now "${MCC_PREVIEW_SERVICE}"
systemctl restart "${MCC_PREVIEW_SERVICE}"

# The resident AI path is part of the minimum healthy Core surface.
# A release that leaves the adapter unable to reach Ollama must roll back
# instead of stamping a deployment where Control can queue work but never reply.
# Same probe rollback uses: preview /health, required units active, adapter /health.
mcc_verify_core_health strict

grep -Fq "\"commit_sha\":\"${DEPLOY_SHA}\"" "${DEPLOY_MANIFEST}"
printf 'deployed_core=%s\ncommit_sha=%s\nmanifest=%s\nbackup=%s\n' "${CORE_TARGET}" "${DEPLOY_SHA}" "${DEPLOY_MANIFEST}" "${BACKUP_DIR}"
