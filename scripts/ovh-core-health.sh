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
    [[ "${unit}" == mccluster-core-runner.service || "${unit}" == mccluster-compute-node.service ]] && continue
    systemctl reset-failed "${unit}" >/dev/null 2>&1 || true
    if systemctl restart "${unit}"; then
      mcc_log "rollback: restarted ${unit}"
    else
      mcc_log "rollback: FAILED to restart ${unit}"
      failed=1
    fi
  done
  # Never hand a fresh job to dependencies that failed to recover.
  [[ ${failed} -eq 0 ]] || return "${failed}"
  if mcc_unit_installed mccluster-ollama-adapter.service; then
    mcc_probe "${MCC_ADAPTER_HEALTH_URL}" || return 1
  fi
  mcc_resume_producers
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

# Drain the existing processes, including releases predating this deployer.
# Restart=no + a signal to the MAIN PID avoids both systemd's forced stop
# timeout and its normal control-group SIGTERM (which would kill job children).
# On a timeout the dependencies stay untouched, and restoring Restart=always
# lets the old runner restart after its current job finishes naturally.
MCC_DRAIN_TIMEOUT="${MCC_DRAIN_TIMEOUT:-660}"
MCC_RUNNER_DRAIN_DROPIN="${MCC_RUNNER_DRAIN_DROPIN:-/run/systemd/system/mccluster-core-runner.service.d/90-mccluster-deploy-drain.conf}"
MCC_RUNNER_DRAIN_OWNED=0
MCC_NODE_DRAIN_RECEIPT=""
MCC_NODE_WAS_ACTIVE=0
MCC_RUNNER_WAS_ACTIVE=0

# systemd provides INVOCATION_ID to this oneshot and its child deployer. Check
# the effective running unit, not the incoming file, before pausing any work.
# Manual deployments must be launched under an approved recovery supervisor.
mcc_verify_reconcile_recovery_budget() {
  local invocation state grace kill_mode failure_mode
  [[ -n "${INVOCATION_ID:-}" ]] || return 0
  invocation="$(systemctl show --property=InvocationID --value mccluster-vps-reconcile.service)" || return 1
  [[ "${invocation}" == "${INVOCATION_ID}" ]] || return 0
  state="$(systemctl show --property=ActiveState --value mccluster-vps-reconcile.service)" || return 1
  grace="$(LC_ALL=C systemctl show --property=TimeoutStopUSec --value mccluster-vps-reconcile.service)" || return 1
  kill_mode="$(systemctl show --property=KillMode --value mccluster-vps-reconcile.service)" || return 1
  failure_mode="$(systemctl show --property=TimeoutStartFailureMode --value mccluster-vps-reconcile.service)" || return 1
  if [[ "${state}" != activating && "${state}" != active ]] ||
     [[ "${grace}" != 20min || "${kill_mode}" != control-group || "${failure_mode}" != terminate ]]; then
    mcc_log "reconciler lacks verified recovery grace; install/reload the reviewed timeout allowance before retrying"
    return 75
  fi
}

# A legacy invocation may bootstrap ONLY this owned, non-security timeout.
# It always exits afterward; only a later invocation may pass the normal guard.
MCC_TIMEOUT_BOOTSTRAP_DROPIN=/etc/systemd/system/mccluster-vps-reconcile.service.d/90-mccluster-recovery-timeout-bootstrap.conf
MCC_TIMEOUT_BOOTSTRAP_TMP=""
MCC_TIMEOUT_BOOTSTRAP_COMMITTED=0
MCC_TIMEOUT_BOOTSTRAP_PREVIOUS_GRACE=""

mcc_bootstrap_systemctl() {
  SYSTEMD_COLORS=0 SYSTEMD_URLIFY=0 timeout --foreground --signal=TERM --kill-after=1s 5s systemctl "$@"
}

mcc_timeout_bootstrap_content() {
  printf '# McCluster recovery-timeout bootstrap v1; timeout only.\n[Service]\nTimeoutStopSec=20min\n'
}

mcc_bootstrap_snapshot() {
  local snapshot line
  MCC_BOOTSTRAP_INVOCATION="" MCC_BOOTSTRAP_STATE="" MCC_BOOTSTRAP_GRACE=""
  MCC_BOOTSTRAP_KILL_MODE="" MCC_BOOTSTRAP_FAILURE_MODE="" MCC_BOOTSTRAP_START_LIMIT=""
  snapshot="$(LC_ALL=C mcc_bootstrap_systemctl show \
    --property=InvocationID --property=ActiveState --property=TimeoutStopUSec \
    --property=KillMode --property=TimeoutStartFailureMode --property=TimeoutStartUSec \
    mccluster-vps-reconcile.service)" || return 1
  while IFS= read -r line; do
    case "${line}" in
      InvocationID=*) MCC_BOOTSTRAP_INVOCATION="${line#*=}" ;;
      ActiveState=*) MCC_BOOTSTRAP_STATE="${line#*=}" ;;
      TimeoutStopUSec=*) MCC_BOOTSTRAP_GRACE="${line#*=}" ;;
      KillMode=*) MCC_BOOTSTRAP_KILL_MODE="${line#*=}" ;;
      TimeoutStartFailureMode=*) MCC_BOOTSTRAP_FAILURE_MODE="${line#*=}" ;;
      TimeoutStartUSec=*) MCC_BOOTSTRAP_START_LIMIT="${line#*=}" ;;
    esac
  done <<< "${snapshot}"
  [[ -n "${MCC_BOOTSTRAP_START_LIMIT}" ]] || return 1
}

mcc_restore_timeout_bootstrap() {
  local failed=0
  [[ -n "${MCC_TIMEOUT_BOOTSTRAP_TMP:-}" && -e "${MCC_TIMEOUT_BOOTSTRAP_TMP}" ]] || return 0
  if [[ ${MCC_TIMEOUT_BOOTSTRAP_COMMITTED} -eq 0 &&
        "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" -ef "${MCC_TIMEOUT_BOOTSTRAP_TMP}" ]]; then
    # The staging inode proves this invocation created it. Never remove a
    # preexisting or concurrently replaced file, even with the same name.
    if rm -f -- "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}"; then
      mcc_bootstrap_systemctl daemon-reload || failed=1
      if ! mcc_bootstrap_snapshot || [[ "${MCC_BOOTSTRAP_GRACE}" != "${MCC_TIMEOUT_BOOTSTRAP_PREVIOUS_GRACE}" ]]; then failed=1; fi
    else failed=1; fi
  fi
  rm -f -- "${MCC_TIMEOUT_BOOTSTRAP_TMP}" || failed=1
  MCC_TIMEOUT_BOOTSTRAP_TMP=""
  return "${failed}"
}

# systemctl cat can omit newly added, not-yet-loaded drop-ins. Check the
# on-disk unit search paths too, including generic and dash-prefix drop-ins.
mcc_bootstrap_check_disk_timeouts() {
  local paths root suffix config scan_rc count=0
  paths="$(SYSTEMD_COLORS=0 timeout --foreground --signal=TERM --kill-after=1s 5s systemd-analyze unit-paths)" || return 1
  [[ -n "${paths}" ]] || return 1
  while IFS= read -r root; do
    [[ "${root}" == /* ]] || return 75
    for suffix in service.d mccluster-.service.d mccluster-vps-.service.d mccluster-vps-reconcile.service.d; do
      [[ ! -L "${root}/${suffix}" ]] || return 75
      for config in "${root}/${suffix}/"*.conf; do
        [[ -e "${config}" || -L "${config}" ]] || continue
        [[ "${config}" != "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" ]] || continue
        count=$((count + 1))
        (( count <= 128 )) && [[ -f "${config}" && -r "${config}" && ! -L "${config}" ]] || return 75
        if grep -Eq '^[[:space:]]*Timeout(Stop)?Sec[[:space:]]*=' "${config}"; then
          mcc_log "foreign on-disk timeout configuration exists; refusing timeout bootstrap"
          return 75
        else
          scan_rc=$?
          [[ ${scan_rc} -eq 1 ]] || return 1
        fi
      done
    done
  done <<< "${paths}"
}

mcc_bootstrap_reconcile_timeout() {
  local dir unit_text start_limit owner mode path
  command -v timeout >/dev/null || return 1
  [[ -n "${INVOCATION_ID:-}" ]] || return 75
  mcc_bootstrap_snapshot || return 1
  # Only the known legacy default is eligible. Unknown operator settings and
  # incompatible lifecycle/security modes remain fail-closed, never rewritten.
  [[ "${MCC_BOOTSTRAP_INVOCATION}" == "${INVOCATION_ID}" &&
     ( "${MCC_BOOTSTRAP_STATE}" == active || "${MCC_BOOTSTRAP_STATE}" == activating ) &&
     "${MCC_BOOTSTRAP_GRACE}" == '1min 30s' &&
     "${MCC_BOOTSTRAP_START_LIMIT}" == 20min &&
     "${MCC_BOOTSTRAP_KILL_MODE}" == control-group &&
     "${MCC_BOOTSTRAP_FAILURE_MODE}" == terminate ]] || return 75
  MCC_TIMEOUT_BOOTSTRAP_PREVIOUS_GRACE="${MCC_BOOTSTRAP_GRACE}"
  start_limit="${MCC_BOOTSTRAP_START_LIMIT}"
  dir="$(dirname "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}")"
  [[ ! -L "${dir}" && ! -L "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" ]] || return 75
  for path in "${dir}" "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}"; do
    [[ -e "${path}" ]] || continue
    read -r owner mode < <(stat -c '%u %a' -- "${path}") || return 1
    [[ "${owner}" == "${EUID}" && "${mode}" =~ ^[0-7]{3,4}$ ]] && (( (8#${mode} & 022) == 0 )) || return 75
  done
  if [[ -e "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" ]]; then
    [[ -f "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" ]] &&
      cmp -s "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" <(mcc_timeout_bootstrap_content) || return 75
  fi
  # systemctl cat identifies each effective fragment with its absolute path.
  # Refuse every preexisting TimeoutStopSec assignment except our exact file.
  unit_text="$(mcc_bootstrap_systemctl cat --no-pager mccluster-vps-reconcile.service)" || return 1
  if ! awk -v owned="${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" '
    $0 == "# " owned { owned_file=1; next }
    /^# \// { owned_file=0 }
    !owned_file && /^[[:space:]]*Timeout(Stop)?Sec[[:space:]]*=/ { conflict=1 }
    END { exit conflict ? 1 : 0 }
  ' <<< "${unit_text}"; then
    mcc_log "foreign TimeoutStopSec configuration exists; refusing timeout bootstrap"
    return 75
  fi
  mcc_bootstrap_check_disk_timeouts || return $?
  if [[ ! -e "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" ]]; then
    if [[ ! -d "${dir}" ]]; then mkdir -m 0755 -- "${dir}" || return 1; fi
    read -r owner mode < <(stat -c '%u %a' -- "${dir}") || return 1
    [[ "${owner}" == "${EUID}" && "${mode}" =~ ^[0-7]{3,4}$ ]] && (( (8#${mode} & 022) == 0 )) || return 75
    MCC_TIMEOUT_BOOTSTRAP_TMP="$(mktemp "${dir}/.mccluster-timeout.XXXXXX")" || return 1
    mcc_timeout_bootstrap_content > "${MCC_TIMEOUT_BOOTSTRAP_TMP}" || return 1
    chmod 0644 "${MCC_TIMEOUT_BOOTSTRAP_TMP}" || return 1
    # Atomic no-replace installation, retaining the staging inode for rollback.
    ln -T -- "${MCC_TIMEOUT_BOOTSTRAP_TMP}" "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" || return 1
  fi
  mcc_bootstrap_systemctl daemon-reload || return 1
  mcc_bootstrap_snapshot || return 1
  [[ "${MCC_BOOTSTRAP_INVOCATION}" == "${INVOCATION_ID}" &&
     ( "${MCC_BOOTSTRAP_STATE}" == active || "${MCC_BOOTSTRAP_STATE}" == activating ) &&
     "${MCC_BOOTSTRAP_GRACE}" == 20min &&
     "${MCC_BOOTSTRAP_KILL_MODE}" == control-group &&
     "${MCC_BOOTSTRAP_FAILURE_MODE}" == terminate &&
     "${MCC_BOOTSTRAP_START_LIMIT}" == "${start_limit}" ]] || return 75
  [[ -f "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" && ! -L "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" ]] &&
    cmp -s "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" <(mcc_timeout_bootstrap_content) || return 75
  if [[ -n "${MCC_TIMEOUT_BOOTSTRAP_TMP}" ]]; then
    [[ "${MCC_TIMEOUT_BOOTSTRAP_DROPIN}" -ef "${MCC_TIMEOUT_BOOTSTRAP_TMP}" ]] || return 75
  fi
  MCC_TIMEOUT_BOOTSTRAP_COMMITTED=1
  mcc_restore_timeout_bootstrap || return 1
  mcc_log "timeout-only bootstrap installed; deferring deployment to the next timer invocation"
}

mcc_node_drain() {
  # Existing Core environment, existing canonical API, no new credential or
  # grant. --env-file never executes shell commands from the environment file.
  node --env-file=/etc/mccluster/core.env \
    "${SOURCE_DIR}/scripts/ovh-core-compute-drain.mjs" "$1" "${MCC_NODE_DRAIN_RECEIPT}"
}

mcc_drain_producers() {
  local state deadline unit
  [[ "${MCC_DRAIN_TIMEOUT}" =~ ^[1-9][0-9]{0,2}$ ]] && (( MCC_DRAIN_TIMEOUT <= 660 )) || return 2
  deadline=$((SECONDS + MCC_DRAIN_TIMEOUT))
  # A service already starting/stopping may race the snapshot. Do not assume
  # is-active=false means quiescent (auto-restart is "activating").
  for unit in mccluster-core-runner.service mccluster-compute-node.service; do
    mcc_unit_installed "${unit}" || continue
    state="$(systemctl show --property=ActiveState --value "${unit}")" || return 1
    case "${state}" in active|inactive|failed) ;; *)
      mcc_log "${unit} is ${state}; defer deployment until its state is stable"
      return 75 ;;
    esac
  done
  DRAIN_STARTED=1
  if systemctl is-active --quiet mccluster-core-runner.service; then
    MCC_RUNNER_WAS_ACTIVE=1
    if [[ ${MCC_RUNNER_DRAIN_OWNED} -eq 0 ]]; then
      mkdir -p "$(dirname "${MCC_RUNNER_DRAIN_DROPIN}")" || return 1
      # Refuse a stale/foreign override rather than overwriting its owner.
      (set -o noclobber; printf '[Service]\nRestart=no\n' >"${MCC_RUNNER_DRAIN_DROPIN}") || return 1
      MCC_RUNNER_DRAIN_OWNED=1
      systemctl daemon-reload || return 1
      [[ "$(systemctl show --property=Restart --value mccluster-core-runner.service)" == no ]] || return 1
      systemctl kill --kill-whom=main --signal=SIGTERM mccluster-core-runner.service || return 1
    fi
    while :; do
      state="$(systemctl show --property=ActiveState --value mccluster-core-runner.service)" || return 1
      case "${state}" in
        inactive)
          [[ "$(systemctl show --property=Result --value mccluster-core-runner.service)" == success ]] || return 1
          break ;;
        active|activating|deactivating) ;;
        *) mcc_log "runner did not exit cleanly; refusing dependency replacement"; return 1 ;;
      esac
      if (( SECONDS >= deadline )); then
        mcc_log "runner drain timed out; leaving dependencies and in-flight work untouched"
        return 75
      fi
      sleep 1
    done
  fi
  if systemctl is-active --quiet mccluster-compute-node.service; then
    MCC_NODE_WAS_ACTIVE=1
    mkdir -p "${BACKUP_DIR}" || return 1
    if [[ -z "${MCC_NODE_DRAIN_RECEIPT}" ]]; then
      MCC_NODE_DRAIN_RECEIPT="${BACKUP_DIR}/compute-drain.json"
      mcc_node_drain begin || return 1
    fi
    while :; do
      # 10 means existing leases still need time; all other failures abort.
      if mcc_node_drain check; then break; else state=$?; fi
      [[ ${state} -eq 10 ]] || return "${state}"
      if (( SECONDS >= deadline )); then
        mcc_log "compute drain timed out; leaving dependencies and leases untouched"
        return 75
      fi
      sleep 1
    done
    # The canonical node row fence prevents a new lease between check and stop.
    systemctl stop mccluster-compute-node.service || return 1
  fi
  mcc_log "Core runner and compute node drained; dependency replacement may proceed"
}

mcc_resume_producers() {
  local failed=0
  if [[ ${MCC_NODE_WAS_ACTIVE:-0} -eq 1 ]] || { [[ ${LIVE_TOUCHED:-0} -eq 1 ]] && mcc_unit_installed mccluster-compute-node.service; }; then
    systemctl reset-failed mccluster-compute-node.service >/dev/null 2>&1 || true
    systemctl start mccluster-compute-node.service || { mcc_log "FAILED to start mccluster-compute-node.service"; failed=1; }
  fi
  if [[ -n "${MCC_NODE_DRAIN_RECEIPT:-}" && -f "${MCC_NODE_DRAIN_RECEIPT}" ]]; then
    if mcc_node_drain end; then MCC_NODE_DRAIN_RECEIPT=""; else failed=1; fi
  fi
  if [[ ${MCC_RUNNER_DRAIN_OWNED:-0} -eq 1 ]]; then
    if rm -f "${MCC_RUNNER_DRAIN_DROPIN}" && systemctl daemon-reload; then
      MCC_RUNNER_DRAIN_OWNED=0
    else failed=1; fi
  fi
  if [[ ${MCC_RUNNER_WAS_ACTIVE:-0} -eq 1 ]] || { [[ ${LIVE_TOUCHED:-0} -eq 1 ]] && mcc_unit_installed mccluster-core-runner.service; }; then
    systemctl reset-failed mccluster-core-runner.service >/dev/null 2>&1 || true
    # On pre-mutation timeout, this is intentionally nonblocking: the old
    # main PID may still be finishing. Restart=always resumes after its exit.
    if [[ ${LIVE_TOUCHED:-0} -eq 1 ]]; then
      systemctl start mccluster-core-runner.service || { mcc_log "FAILED to start mccluster-core-runner.service"; failed=1; }
    else
      systemctl start --no-block mccluster-core-runner.service || failed=1
    fi
  fi
  return "${failed}"
}
