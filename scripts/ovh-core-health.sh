# shellcheck shell=bash
# McCluster Core service restart + health probe, shared by the forward deploy
# and by rollback in scripts/deploy-ovh-core.sh. Sourced, never executed.
#
# Rollback used to restore the previous release's files and then
# `systemctl try-restart … || true`. try-restart is a no-op for a unit that is
# not running, which is exactly the state a release that "fails to start"
# leaves behind, so the restored files were never loaded and nothing checked
# that the restored release came back. Rollback now restarts every unit the
# deploy restarted and runs the same probe the deploy gates on; if the
# restored release is unhealthy too, the deployer exits
# MCC_ROLLBACK_UNHEALTHY_RC and says so loudly.

# Services the forward deploy restarts, in its order. Rollback restarts the
# same set (those still installed after the unit files are restored).
MCC_CORE_SERVICES=(
  mccluster-core-tool-broker.service
  mccluster-compute-gateway.service
  mccluster-ollama-adapter.service
  mccluster-compute-node.service
  mccluster-core-runner.service
)
MCC_PREVIEW_SERVICE=mccluster-preview-gateway.service
# The resident AI path is the minimum healthy Core surface.
MCC_CORE_REQUIRED_ACTIVE=(
  mccluster-core-runner.service
  mccluster-core-tool-broker.service
  mccluster-ollama-adapter.service
  mccluster-compute-node.service
)
MCC_PREVIEW_HEALTH_URL="${MCC_PREVIEW_HEALTH_URL:-http://127.0.0.1:4799/health}"
MCC_ADAPTER_HEALTH_URL="${MCC_ADAPTER_HEALTH_URL:-http://127.0.0.1:4790/health}"
MCC_HEALTH_RETRIES="${MCC_HEALTH_RETRIES:-5}"
MCC_HEALTH_TIMEOUT="${MCC_HEALTH_TIMEOUT:-5}"
MCC_ROLLBACK_UNHEALTHY_RC=3

mcc_log() { printf '[mccluster-deploy] %s\n' "$*" >&2; }

mcc_unit_installed() {
  systemctl list-unit-files "$1" --no-legend 2>/dev/null | grep -q "$1"
}

# One local HTTP probe, with the deploy's retry and timeout budget.
mcc_probe() {
  curl --fail --silent --show-error \
    --retry "${MCC_HEALTH_RETRIES}" --retry-connrefused --retry-delay 1 \
    --max-time "${MCC_HEALTH_TIMEOUT}" "$1" >/dev/null
}

# mcc_verify_core_health strict|installed
#   strict    — forward deploy: every required unit must exist and be active.
#   installed — rollback: the previous release may predate a unit this release
#               introduced (and rollback removed), so check what is installed.
# Returns non-zero and logs every failing check (it does not stop at the first).
mcc_verify_core_health() {
  local mode="${1:-strict}" failed=0 unit
  if [[ "${mode}" == strict ]] || mcc_unit_installed "${MCC_PREVIEW_SERVICE}"; then
    if ! mcc_probe "${MCC_PREVIEW_HEALTH_URL}"; then
      mcc_log "health: preview gateway ${MCC_PREVIEW_HEALTH_URL} did not answer"
      failed=1
    fi
  fi
  for unit in "${MCC_CORE_REQUIRED_ACTIVE[@]}"; do
    if [[ "${mode}" != strict ]] && ! mcc_unit_installed "${unit}"; then
      continue
    fi
    if ! systemctl is-active --quiet "${unit}"; then
      mcc_log "health: ${unit} is not active"
      failed=1
    fi
  done
  if [[ "${mode}" == strict ]] || mcc_unit_installed mccluster-ollama-adapter.service; then
    if ! mcc_probe "${MCC_ADAPTER_HEALTH_URL}"; then
      mcc_log "health: resident AI adapter ${MCC_ADAPTER_HEALTH_URL} did not answer"
      failed=1
    fi
  fi
  return "${failed}"
}

# Restart every deploy-restarted unit that is installed. A unit the failed
# release crashed is inactive/failed, so this must be restart (not try-restart)
# and must clear the failed state and start-rate limit first.
mcc_restart_restored_units() {
  local failed=0 unit
  for unit in "${MCC_CORE_SERVICES[@]}" "${MCC_PREVIEW_SERVICE}"; do
    mcc_unit_installed "${unit}" || continue
    systemctl reset-failed "${unit}" >/dev/null 2>&1 || true
    if systemctl restart "${unit}"; then
      mcc_log "rollback: restarted ${unit}"
    else
      mcc_log "rollback: FAILED to restart ${unit}"
      failed=1
    fi
  done
  return "${failed}"
}

# Restart the restored units, then verify the restored release with the same
# probe the deploy uses. Returns 0 only when the restored release is healthy.
mcc_recover_restored_release() {
  local restart_ok=0 health_ok=0 unit
  mcc_restart_restored_units || restart_ok=1
  mcc_verify_core_health installed || health_ok=1
  if [[ ${restart_ok} -eq 0 && ${health_ok} -eq 0 ]]; then
    mcc_log "rollback: restored release restarted and verified healthy"
    return 0
  fi
  mcc_log "ROLLBACK FAILED: the restored release is NOT healthy; Core needs manual intervention"
  for unit in "${MCC_CORE_SERVICES[@]}" "${MCC_PREVIEW_SERVICE}"; do
    mcc_unit_installed "${unit}" || continue
    systemctl --no-pager --lines=20 status "${unit}" >&2 2>&1 || true
  done
  return 1
}
