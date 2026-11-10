#!/usr/bin/env bash
# Run ON the OVH host as root. Never send the private key to GitHub or to chat.
# A failed SSH preflight must not alter the active reconciliation transport.
#
#   prepare   create the host-only key pair if absent and print its PUBLIC half
#   activate  prove the key, then switch the reconciler to SSH
#   status    evidence: print key=value lines, exit 0 only if every proof
#             holds. It changes no key, unit, drop-in or transport. It does
#             create and remove a throwaway probe repository in the key
#             directory, and opens three SSH sessions to GitHub, one of them a
#             push dry run that sends nothing.
#
# Exit status (every mode):
#   0  done; for status, every proof holds
#   1  status: at least one proof does not hold (proofs_unproven= names it)
#   2  a precondition: not root, unknown mode, a required command missing,
#      a key or known-hosts file that is a symlink or has the wrong owner
#   3  activate: a proof refused (identity, write access, ref access, a Git
#      rewrite); nothing on the host changed
#   4  activate: the switch did not complete (a reconcile cycle already
#      running did not end in time, systemd did not reload, the first cycle
#      failed or was not a new cycle over SSH with this key, or the timer is
#      inactive). In every case but the last, the previous transport is in
#      place when the script exits.
set -Eeuo pipefail

MODE="${1:-prepare}"
KEY_DIR=/var/lib/mccluster/reconcile/ssh
KEY="${KEY_DIR}/github_deploy_ed25519"
KNOWN="${KEY_DIR}/github_known_hosts"
REPO="git@github.com:mcclusterishere/mccluster.git"
DROPIN_DIR=/etc/systemd/system/mccluster-vps-reconcile.service.d
DROPIN="${DROPIN_DIR}/50-github-readonly-ssh.conf"
GITHUB_HOST_KEY="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
GITHUB_FINGERPRINT="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"
SSH_COMMAND="/usr/bin/ssh -F /dev/null -i ${KEY} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN} -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no"
RECONCILE_STATE=/var/lib/mccluster/reconcile
RECONCILE_CHECKOUT="${RECONCILE_STATE}/source"
RECONCILE_UNIT=mccluster-vps-reconcile.service
RECONCILE_TIMER=mccluster-vps-reconcile.timer
PROBE_CONNECT_TIMEOUT=20
# The same window Core health uses before it calls the reconciler stale.
CYCLE_FRESH_SECONDS=1500
TIMER_CYCLES_REQUIRED=2
# activate waits this long for a reconcile cycle that is already running to end
# (a cycle that deploys may run to the unit's 20-minute start limit).
RECONCILE_IDLE_WAIT_SECONDS=1260
RECONCILE_IDLE_POLL_SECONDS=2

# ---------------------------------------------------------------------------
# GITHUB BEHAVIOUR THIS SCRIPT DEPENDS ON
#
# Neither answer below could be exercised where this was written. Each is
# matched in exactly one place, through the variable named here, and anything
# that is not recognised is treated as unproven and refused. Confirm both on
# the first real run: docs/control-plane/OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md.
#
# 1. `ssh -T git@github.com` greets the identity the key belongs to, then exits 1.
#      a deploy key:    Hi <owner>/<repository>! You've successfully authenticated, but GitHub does not provide shell access.
#      a personal key:  Hi <login>! You've successfully authenticated, but GitHub does not provide shell access.
#    Only the opening "Hi <identity>!" is matched; the rest of the sentence may
#    change. While the repository is public ANY key registered with GitHub can
#    fetch it over SSH, so a successful fetch does not show that this key is
#    this repository's deploy key. The greeting does.
GITHUB_GREETING_PATTERN='^Hi ([A-Za-z0-9._/-]+)!( |$)'
GITHUB_DEPLOY_KEY_IDENTITY="mcclusterishere/mccluster"
# 2. A push with a read-only deploy key is refused before any ref is offered:
#      ERROR: The key you are authenticating with has been marked as read only.
#    The match needs "key" and "marked as read only" on one line, so an archived
#    repository ("... was archived so it is read-only") or a permission refusal
#    is never mistaken for a read-only KEY.
GITHUB_READ_ONLY_KEY_REFUSAL_PATTERN='key[^[:cntrl:]]*marked as read[ -]?only'
# ---------------------------------------------------------------------------

if [[ "${EUID}" -ne 0 ]]; then
  echo "This host-only setup must run as root on OVH." >&2
  exit 2
fi
if [[ "${MODE}" != "prepare" && "${MODE}" != "activate" && "${MODE}" != "status" ]]; then
  echo "usage: sudo bash scripts/ovh-private-repo-ssh.sh prepare|activate|status" >&2
  exit 2
fi
for cmd in ssh ssh-keygen git systemctl stat mktemp date env cmp; do
  command -v "${cmd}" >/dev/null || { echo "required command unavailable: ${cmd}" >&2; exit 2; }
done

MCC_TEMP_PATHS=()
mcc_cleanup() {
  local path
  for path in "${MCC_TEMP_PATHS[@]:-}"; do
    if [[ -n "${path}" ]]; then rm -rf -- "${path}"; fi
  done
  return 0
}
trap mcc_cleanup EXIT

# The pinned command, as arguments. It holds no quoting or globbing characters,
# so splitting it on spaces gives exactly the words systemd hands to Git.
mcc_ssh() {
  local -a argv
  read -r -a argv <<< "${SSH_COMMAND}"
  env -u SSH_AUTH_SOCK "${argv[@]}" -o ConnectTimeout="${PROBE_CONNECT_TIMEOUT}" "$@" </dev/null
}

# Git for the proofs: no system, user or environment configuration, so nothing
# (a url.*.insteadOf rule, a credential helper, a hook) can stand in for the key.
mcc_probe_git() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY -u GIT_NAMESPACE \
      -u GIT_CONFIG_PARAMETERS -u GIT_TEMPLATE_DIR -u SSH_AUTH_SOCK \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_COUNT=0 GIT_TERMINAL_PROMPT=0 LC_ALL=C \
    GIT_SSH_COMMAND="${SSH_COMMAND} -o ConnectTimeout=${PROBE_CONNECT_TIMEOUT}" git -C "${KEY_DIR}" "$@" </dev/null
}

# Git as the reconciler unit runs it (its HOME, the system configuration, a
# clean environment): what it resolves is what a reconcile cycle will use.
mcc_reconciler_git() {
  env -i PATH="${PATH}" HOME="${RECONCILE_STATE}" LC_ALL=C GIT_TERMINAL_PROMPT=0 git -C / "$@" </dev/null
}
mcc_reconciler_rewrites_url() {
  [[ "$(mcc_reconciler_git ls-remote --get-url "${REPO}" 2>/dev/null || true)" == "${REPO}" ]] || return 0
  if [[ -d "${RECONCILE_CHECKOUT}/.git" ]]; then
    [[ "$(mcc_reconciler_git -C "${RECONCILE_CHECKOUT}" ls-remote --get-url "${REPO}" 2>/dev/null || true)" == "${REPO}" ]] || return 0
  fi
  return 1
}

# What a remote said, made safe to show: one line of printable ASCII, at most
# 300 characters. It is shown only when an answer was NOT recognised, so the
# owner can compare GitHub's real wording with the patterns above.
mcc_printable() {
  local text
  text="$(tr '\r\n\t' '   ' | tr -cd '\40-\176')"
  while [[ "${text}" == *'  '* ]]; do text="${text//  / }"; done
  text="${text% }"
  printf '%s' "${text:0:300}"
}

mcc_key_fingerprint() {
  local words fingerprint=""
  words="$(ssh-keygen -lf "${KEY}.pub" -E sha256 2>/dev/null || true)"
  read -r _ fingerprint _ <<< "${words%%$'\n'*}" || true
  [[ "${fingerprint}" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] && printf '%s' "${fingerprint}"
  return 0
}

# The key pair is usable only as a root-owned regular file nobody else can read.
# Prints one word: present, missing, symlinked, not_root_owned, group_or_other_accessible.
mcc_key_pair_state() {
  local mode
  if [[ -L "${KEY_DIR}" || -L "${KEY}" || -L "${KEY}.pub" || -L "${KNOWN}" ]]; then echo symlinked; return 0; fi
  if [[ ! -f "${KEY}" || ! -f "${KEY}.pub" ]]; then echo missing; return 0; fi
  if [[ "$(stat -c %u "${KEY}")" != "0" ]]; then echo not_root_owned; return 0; fi
  mode="$(stat -c %a "${KEY}")"
  if [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]] || (( (8#${mode} & 077) != 0 )); then echo group_or_other_accessible; return 0; fi
  echo present
}

# Pinned means the known-hosts file is exactly GitHub's published Ed25519 key
# and nothing else: a second key or a certificate-authority line would widen
# what ssh accepts as github.com.
mcc_host_key_is_pinned() {
  [[ -f "${KNOWN}" && ! -L "${KNOWN}" ]] || return 1
  cmp -s -- "${KNOWN}" <(printf '%s\n' "${GITHUB_HOST_KEY}") || cmp -s -- "${KNOWN}" <(printf '%s' "${GITHUB_HOST_KEY}") || return 1
  ssh-keygen -lf "${KNOWN}" -E sha256 2>/dev/null | grep -Fq "${GITHUB_FINGERPRINT}"
}

# Sets GITHUB_IDENTITY to what GitHub greeted (owner/repository or a login) and
# GITHUB_GREETING_ANSWER to the whole answer, made printable.
# Returns 0 this repository's deploy key, 3 another identity, 4 no recognisable greeting.
GITHUB_IDENTITY=""
GITHUB_GREETING_ANSWER=""
mcc_github_identity() {
  local output line count=0
  GITHUB_IDENTITY=""
  output="$(mcc_ssh -T git@github.com 2>&1 || true)"
  GITHUB_GREETING_ANSWER="$(mcc_printable <<< "${output}")"
  while IFS= read -r line; do
    line="${line%$'\r'}"
    if [[ "${line}" =~ ${GITHUB_GREETING_PATTERN} ]]; then
      GITHUB_IDENTITY="${BASH_REMATCH[1]}"
      count=$((count + 1))
    fi
  done <<< "${output}"
  if [[ ${count} -ne 1 ]]; then GITHUB_IDENTITY=""; return 4; fi
  [[ "${GITHUB_IDENTITY}" == "${GITHUB_DEPLOY_KEY_IDENTITY}" ]] && return 0
  return 3
}

# Least privilege, proven from the host. A dry-run push never sends an update,
# and GitHub refuses a read-only deploy key before any ref is offered. A dry run
# that is ACCEPTED means the key can write. The throwaway repository it needs
# is created under the root-only key directory and removed.
# Returns 0 read-only, 3 write-capable, 4 could not tell. Sets
# GITHUB_PUSH_ANSWER to what the dry run printed, made printable.
GITHUB_PUSH_ANSWER=""
mcc_deploy_key_write_access() {
  local probe output rc=0
  GITHUB_PUSH_ANSWER=""
  # A run killed with SIGKILL cannot clean up after itself; sweep what such a run left.
  find "${KEY_DIR}" -maxdepth 1 -type d -name '.write-probe.*' -mmin +60 -exec rm -rf -- {} + 2>/dev/null || true
  probe="$(mktemp -d "${KEY_DIR}/.write-probe.XXXXXX")" || return 4
  MCC_TEMP_PATHS+=("${probe}")
  mcc_probe_git -C "${probe}" init -q . >/dev/null 2>&1 || return 4
  mcc_probe_git -C "${probe}" -c user.name=mccluster-read-only-probe -c user.email=probe@invalid \
    commit -q --allow-empty -m "read-only probe; never pushed" >/dev/null 2>&1 || return 4
  [[ "$(mcc_probe_git -C "${probe}" ls-remote --get-url "${REPO}" 2>/dev/null || true)" == "${REPO}" ]] || return 4
  output="$(mcc_probe_git -C "${probe}" push --dry-run "${REPO}" HEAD:refs/heads/mccluster-read-only-probe 2>&1)" || rc=$?
  rm -rf -- "${probe}"
  GITHUB_PUSH_ANSWER="$(mcc_printable <<< "${output}")"
  if [[ ${rc} -eq 0 ]]; then return 3; fi
  if grep -Eiq -- "${GITHUB_READ_ONLY_KEY_REFUSAL_PATTERN}" <<< "${output}"; then return 0; fi
  return 4
}

# Both protected refs as read over SSH with the pinned command. Sets SSH_MAIN_SHA
# and SSH_PROMOTED_SHA; returns non-zero unless both are exact commit ids.
SSH_MAIN_SHA=""
SSH_PROMOTED_SHA=""
mcc_read_refs_over_ssh() {
  local refs sha ref
  SSH_MAIN_SHA=""
  SSH_PROMOTED_SHA=""
  refs="$(mcc_probe_git ls-remote "${REPO}" refs/heads/main refs/heads/deploy/ovh-production 2>/dev/null || true)"
  while read -r sha ref; do
    [[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || continue
    case "${ref}" in
      refs/heads/main) SSH_MAIN_SHA="${sha}" ;;
      refs/heads/deploy/ovh-production) SSH_PROMOTED_SHA="${sha}" ;;
    esac
  done <<< "${refs}"
  [[ -n "${SSH_MAIN_SHA}" && -n "${SSH_PROMOTED_SHA}" ]]
}

mcc_dropin_content() {
  cat <<DROPIN_EOF
[Service]
Environment="MCCLUSTER_REPO_URL=${REPO}"
Environment="GIT_SSH_COMMAND=${SSH_COMMAND}"
DROPIN_EOF
}

# 2026-11-09T22:05:00Z to seconds since 1970, without relying on date -d.
mcc_utc_epoch() {
  local pattern='^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$'
  local year month day hour minute second era year_of_era day_of_year day_of_era
  [[ "${1:-}" =~ ${pattern} ]] || return 0
  year=$((10#${BASH_REMATCH[1]})); month=$((10#${BASH_REMATCH[2]})); day=$((10#${BASH_REMATCH[3]}))
  hour=$((10#${BASH_REMATCH[4]})); minute=$((10#${BASH_REMATCH[5]})); second=$((10#${BASH_REMATCH[6]}))
  (( month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 60 )) || return 0
  if (( month <= 2 )); then year=$((year - 1)); fi
  era=$((year / 400))
  year_of_era=$((year - era * 400))
  day_of_year=$(( (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1 ))
  day_of_era=$((year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year))
  printf '%s' $(( (era * 146097 + day_of_era - 719468) * 86400 + hour * 3600 + minute * 60 + second ))
}

# One string field of a receipt line the reconciler wrote. Only characters a
# receipt can hold are accepted, so nothing else is ever echoed.
mcc_receipt_field() {
  local pattern="\"$2\":\"([A-Za-z0-9+/:_.-]*)\""
  [[ "$1" =~ ${pattern} ]] && printf '%s' "${BASH_REMATCH[1]}"
  return 0
}

# The reconciler is a oneshot unit. A cycle the timer has already started keeps
# the environment it started with, and systemd merges a start request into that
# running start job: `systemctl start` would wait for THAT cycle, over the old
# transport, and report it as the first cycle after the switch. activate calls
# this before it changes anything. Returns non-zero if a cycle is still
# running after RECONCILE_IDLE_WAIT_SECONDS.
mcc_wait_reconciler_idle() {
  local state said=0 deadline=$((SECONDS + RECONCILE_IDLE_WAIT_SECONDS))
  while :; do
    state="$(systemctl show --property=ActiveState --value "${RECONCILE_UNIT}" 2>/dev/null || true)"
    case "${state}" in
      activating|deactivating|reloading|refreshing) ;;
      *) return 0 ;;
    esac
    if (( SECONDS >= deadline )); then return 1; fi
    if [[ ${said} -eq 0 ]]; then
      echo "A reconcile cycle is running; waiting for it to end before switching (up to $((RECONCILE_IDLE_WAIT_SECONDS / 60)) minutes)."
      said=1
    fi
    sleep "${RECONCILE_IDLE_POLL_SECONDS}"
  done
}

# The cycle `systemctl start` waited for must be a new one that fetched over SSH
# with this key. The reconciler's own receipt says so: last-cycle.json names the
# unit's invocation, the transport Git really used, whether the host key was
# pinned, the key's fingerprint and the outcome. A cycle the timer started
# before the reload, or a reconciler that writes no receipts, proves nothing
# about the switch. Sets FIRST_CYCLE_ID.
FIRST_CYCLE_ID=""
mcc_first_cycle_used_this_key() {
  local invocation fingerprint line=""
  FIRST_CYCLE_ID=""
  invocation="$(systemctl show --property=InvocationID --value "${RECONCILE_UNIT}" 2>/dev/null || true)"
  fingerprint="$(mcc_key_fingerprint)"
  [[ "${invocation}" =~ ^[0-9a-f]{32}$ && -n "${fingerprint}" ]] || return 1
  [[ -f "${RECONCILE_STATE}/last-cycle.json" && ! -L "${RECONCILE_STATE}/last-cycle.json" ]] || return 1
  IFS= read -r -n 1024 line < "${RECONCILE_STATE}/last-cycle.json" || true
  [[ "${line}" == '{"schema_version":"mccluster-reconcile-cycle/v1",'*'}' ]] || return 1
  [[ "$(mcc_receipt_field "${line}" cycle_id)" == "${invocation}" ]] || return 1
  [[ "$(mcc_receipt_field "${line}" transport)" == ssh && "${line}" == *'"ssh_host_key_pinned":true'* ]] || return 1
  [[ "$(mcc_receipt_field "${line}" ssh_key_fingerprint)" == "${fingerprint}" ]] || return 1
  case "$(mcc_receipt_field "${line}" outcome)" in
    verified_no_change|deployed) FIRST_CYCLE_ID="${invocation}"; return 0 ;;
  esac
  return 1
}

# Read-only evidence for incident #510. Prints no key material: a public-key
# fingerprint, verdicts about the unit's effective environment (never the
# environment itself), commit ids read over SSH, and fields of the reconciler's
# own cycle receipts. The only thing it creates is the throwaway repository of
# the write probe, which it removes.
mcc_status() {
  local -a unproven=()
  local state fingerprint="" environment="" value="" rc=0 line="" now="" age=""
  local cycle_id="" trigger="" transport="" outcome="" finished="" cycle_fingerprint="" finished_epoch=""
  local repo_pattern='.*(^|[[:space:]"])MCCLUSTER_REPO_URL=([^[:space:]"]*)'
  local before="" after="" escaped=""
  local timer_cycles=0 seen=" "
  local -a timer_lines=()
  say() { printf '%s=%s\n' "$1" "$2"; }

  say mode status
  say checked_at "$(date -u +%FT%TZ)"
  say repository "${GITHUB_DEPLOY_KEY_IDENTITY}"

  state="$(mcc_key_pair_state)"
  say key_pair "${state}"
  if [[ "${state}" == present ]]; then
    fingerprint="$(mcc_key_fingerprint)"
  else
    unproven+=(key_pair)
  fi
  say key_fingerprint "${fingerprint:-unavailable}"
  [[ -n "${fingerprint}" ]] || unproven+=(key_fingerprint)

  if mcc_host_key_is_pinned; then say github_host_key pinned; else say github_host_key not_pinned; unproven+=(github_host_key); fi

  if [[ ! -e "${DROPIN}" ]]; then say dropin absent; unproven+=(dropin)
  elif [[ -f "${DROPIN}" && ! -L "${DROPIN}" && "$(cat "${DROPIN}")" == "$(mcc_dropin_content)" ]]; then say dropin installed
  else say dropin modified; unproven+=(dropin); fi

  # The unit's effective environment as systemd reports it. A later drop-in can
  # override an earlier one, so the LAST assignment of each variable decides.
  # systemd prints an entry that holds spaces either inside double quotes or
  # with each space written as \x20. Only those two forms mark where the entry
  # ends; any other rendering is not accepted.
  environment="$(systemctl show --property=Environment --value "${RECONCILE_UNIT}" 2>/dev/null || true)"
  if [[ "${environment}" =~ ${repo_pattern} && "${BASH_REMATCH[2]}" == "${REPO}" ]]; then say effective_repo_url "${REPO}"
  else say effective_repo_url not_ssh; unproven+=(effective_repo_url); fi
  before="${environment%GIT_SSH_COMMAND=*}"
  after="${environment##*GIT_SSH_COMMAND=}"
  escaped="${SSH_COMMAND// /\\x20}"
  if [[ "${environment}" == *GIT_SSH_COMMAND=* ]] && {
       [[ "${before}" == *'"' && ( "${after}" == "${SSH_COMMAND}\"" || "${after}" == "${SSH_COMMAND}\" "* ) ]] ||
       [[ ( -z "${before}" || "${before}" == *' ' ) && ( "${after}" == "${escaped}" || "${after}" == "${escaped} "* ) ]]
     }; then say effective_ssh_command pinned_deploy_key
  else say effective_ssh_command not_pinned; unproven+=(effective_ssh_command); fi
  environment=""; before=""; after=""

  # What the reconciler's own Git resolves: a url.*.insteadOf rule in its
  # configuration would send an "SSH" fetch somewhere else.
  if mcc_reconciler_rewrites_url; then say git_url_rewrite rewritten; unproven+=(git_url_rewrite); else say git_url_rewrite none; fi
  value="$(mcc_reconciler_git -C "${RECONCILE_CHECKOUT}" remote get-url origin 2>/dev/null || true)"
  if [[ "${value}" == "${REPO}" ]]; then say checkout_origin "${REPO}"; else say checkout_origin not_ssh; unproven+=(checkout_origin); fi
  value=""

  if [[ "${state}" == present ]] && mcc_host_key_is_pinned; then
    rc=0; mcc_github_identity || rc=$?
    case "${rc}" in
      0) say github_identity "deploy_key_of_${GITHUB_DEPLOY_KEY_IDENTITY}" ;;
      3) say github_identity "other_identity:${GITHUB_IDENTITY}"; unproven+=(github_identity) ;;
      *) say github_identity unrecognised; say github_identity_answer "${GITHUB_GREETING_ANSWER:-nothing}"; unproven+=(github_identity) ;;
    esac
    rc=0; mcc_deploy_key_write_access || rc=$?
    case "${rc}" in
      0) say write_access denied_read_only ;;
      3) say write_access WRITE_CAPABLE; unproven+=(write_access) ;;
      *) say write_access unproven; say write_access_answer "${GITHUB_PUSH_ANSWER:-nothing}"; unproven+=(write_access) ;;
    esac
    if mcc_read_refs_over_ssh; then
      say ssh_main_sha "${SSH_MAIN_SHA}"
      say ssh_promoted_sha "${SSH_PROMOTED_SHA}"
    else
      say ssh_main_sha "${SSH_MAIN_SHA:-unreadable}"
      say ssh_promoted_sha "${SSH_PROMOTED_SHA:-unreadable}"
      unproven+=(ssh_refs)
    fi
  else
    # No usable key or no pinned host key: nothing is sent to GitHub.
    say github_identity not_checked; say write_access not_checked
    say ssh_main_sha not_checked; say ssh_promoted_sha not_checked
    unproven+=(github_identity write_access ssh_refs)
  fi

  value="$(systemctl is-active "${RECONCILE_TIMER}" 2>/dev/null || true)"
  [[ "${value}" =~ ^[a-z-]{1,32}$ ]] || value=unknown
  say reconcile_timer "${value}"
  [[ "${value}" == active ]] || unproven+=(reconcile_timer)
  value="$(systemctl show --property=LastTriggerUSec --value "${RECONCILE_TIMER}" 2>/dev/null || true)"
  [[ "${value}" =~ ^[A-Za-z0-9\ :+-]{1,64}$ ]] || value=unknown
  say timer_last_trigger "${value}"

  # The reconciler's own receipts: what its cycles really used. A cycle counts
  # only if it succeeded, a timer started it, it fetched over SSH with the
  # pinned host key, and it offered THIS key.
  now="$(date -u +%s)"
  line=""
  if [[ -f "${RECONCILE_STATE}/last-verified-cycle.json" && ! -L "${RECONCILE_STATE}/last-verified-cycle.json" ]]; then
    IFS= read -r -n 1024 line < "${RECONCILE_STATE}/last-verified-cycle.json" || true
  fi
  if [[ "${line}" == '{"schema_version":"mccluster-reconcile-cycle/v1",'*'}' ]]; then
    cycle_id="$(mcc_receipt_field "${line}" cycle_id)"
    trigger="$(mcc_receipt_field "${line}" trigger)"
    transport="$(mcc_receipt_field "${line}" transport)"
    cycle_fingerprint="$(mcc_receipt_field "${line}" ssh_key_fingerprint)"
    finished="$(mcc_receipt_field "${line}" finished_at)"
    finished_epoch="$(mcc_utc_epoch "${finished}")"
    if [[ "${finished_epoch}" =~ ^[0-9]+$ && "${now}" =~ ^[0-9]+$ ]]; then age=$((now - finished_epoch)); fi
    say last_verified_cycle_id "${cycle_id:-none}"
    say last_verified_cycle_trigger "${trigger:-unknown}"
    say last_verified_cycle_transport "${transport:-unknown}"
    say last_verified_cycle_key_fingerprint "${cycle_fingerprint:-none}"
    say last_verified_cycle_finished_at "${finished:-unknown}"
    say last_verified_cycle_age_seconds "${age:-unknown}"
    if [[ "${transport}" == ssh && "${line}" == *'"ssh_host_key_pinned":true'* && -n "${fingerprint}" && "${cycle_fingerprint}" == "${fingerprint}" \
          && "${age}" =~ ^-?[0-9]+$ ]] && (( age >= -30 && age <= CYCLE_FRESH_SECONDS )); then
      say last_verified_cycle ssh_with_this_key_and_fresh
    else
      say last_verified_cycle not_ssh_with_this_key_or_stale
      unproven+=(last_verified_cycle)
    fi
  else
    say last_verified_cycle absent
    unproven+=(last_verified_cycle)
  fi

  if [[ -f "${RECONCILE_STATE}/cycles.jsonl" && ! -L "${RECONCILE_STATE}/cycles.jsonl" ]]; then
    while IFS= read -r line; do
      (( ${#line} <= 1024 )) && [[ "${line}" == '{"schema_version":"mccluster-reconcile-cycle/v1",'*'}' ]] || continue
      cycle_id="$(mcc_receipt_field "${line}" cycle_id)"
      trigger="$(mcc_receipt_field "${line}" trigger)"
      outcome="$(mcc_receipt_field "${line}" outcome)"
      [[ "${cycle_id}" =~ ^[0-9a-f]{32}$ && "${seen}" != *" ${cycle_id} "* ]] || continue
      [[ "${outcome}" == verified_no_change || "${outcome}" == deployed ]] || continue
      if [[ "$(mcc_receipt_field "${line}" transport)" != ssh || "${line}" != *'"ssh_host_key_pinned":true'* \
            || -z "${fingerprint}" || "$(mcc_receipt_field "${line}" ssh_key_fingerprint)" != "${fingerprint}" ]]; then
        timer_cycles=0; timer_lines=(); continue
      fi
      [[ "${trigger}" == timer || "${trigger}" == timer_inferred ]] || continue
      seen+="${cycle_id} "
      timer_cycles=$((timer_cycles + 1))
      timer_lines+=("${cycle_id} ${trigger} ${outcome} $(mcc_receipt_field "${line}" finished_at)")
    done < <(tail -c 65536 -- "${RECONCILE_STATE}/cycles.jsonl" 2>/dev/null | tail -n 40)
  fi
  for line in "${timer_lines[@]:-}"; do [[ -z "${line}" ]] || say timer_cycle "${line}"; done
  say timer_cycles_over_ssh_with_this_key "${timer_cycles}"
  say timer_cycles_required "${TIMER_CYCLES_REQUIRED}"
  (( timer_cycles >= TIMER_CYCLES_REQUIRED )) || unproven+=(timer_cycles)

  if [[ ${#unproven[@]} -eq 0 ]]; then
    say proofs_unproven none
    say status proven
    return 0
  fi
  value="${unproven[*]}"
  say proofs_unproven "${value// /,}"
  say status unproven
  return 1
}

if [[ "${MODE}" == "status" ]]; then
  rc=0
  mcc_status || rc=$?
  exit "${rc}"
fi

install -d -o root -g root -m 0700 "${KEY_DIR}"
if [[ -L "${KEY_DIR}" || -L "${KEY}" || -L "${KEY}.pub" || -L "${KNOWN}" ]]; then
  echo "Refusing symlinked SSH credential or host-key file." >&2
  exit 2
fi

if [[ "${MODE}" == "prepare" && ! -e "${KEY}" ]]; then
  # Generate a NEW key on OVH if none is configured at this path.
  # The private half never leaves this host.
  (umask 077; ssh-keygen -q -t ed25519 -a 100 -N "" -f "${KEY}" -C "mccluster-ovh-readonly-reconcile")
fi
if [[ ! -f "${KEY}" || ! -f "${KEY}.pub" ]]; then
  echo "OVH key pair missing. Run prepare on the host first." >&2
  exit 2
fi
if [[ "$(stat -c %u "${KEY}")" != "0" ]]; then
  echo "The deploy key must be owned by root." >&2
  exit 2
fi
key_mode="$(stat -c %a "${KEY}")"
if (( (8#${key_mode} & 077) != 0 )); then
  echo "The deploy key is accessible to group/other; refusing use." >&2
  exit 2
fi

# Pin GitHub's published Ed25519 host key, never trust ssh-keyscan / TOFU.
# The file is replaced by rename and only when it differs, so a reconcile cycle
# that is already using it never reads a half-written file.
if ! mcc_host_key_is_pinned; then
  known_tmp="$(mktemp "${KNOWN}.XXXXXX")"
  MCC_TEMP_PATHS+=("${known_tmp}")
  printf '%s\n' "${GITHUB_HOST_KEY}" > "${known_tmp}"
  chmod 0600 "${known_tmp}"
  mv -f "${known_tmp}" "${KNOWN}"
fi
if ! ssh-keygen -lf "${KNOWN}" -E sha256 | grep -Fq "${GITHUB_FINGERPRINT}"; then
  echo "GitHub host key fingerprint does not match pinned value." >&2
  exit 2
fi

if [[ "${MODE}" == "prepare" ]]; then
  echo "Register ONLY the following public key as a read-only Deploy key:"
  echo "https://github.com/mcclusterishere/mccluster/settings/keys"
  cat "${KEY}.pub"
  echo "Its fingerprint, to compare with the one GitHub shows: $(mcc_key_fingerprint)"
  echo "Leave 'Allow write access' OFF, then run this script with activate."
  exit 0
fi

# activate. Every proof below comes BEFORE the transport changes; a refusal
# leaves the reconciler exactly as it was.

# Prove the key can read BOTH protected refs before installing the override.
refs="$(mcc_probe_git ls-remote "${REPO}" refs/heads/main refs/heads/deploy/ovh-production)" \
  || { echo "Cannot read the repository over SSH (is the deploy key added, and is TCP 22 to github.com open?)." >&2; exit 3; }
grep -Fq $'\trefs/heads/main' <<< "${refs}" || { echo "Cannot read main over SSH." >&2; exit 3; }
grep -Fq $'\trefs/heads/deploy/ovh-production' <<< "${refs}" || { echo "Cannot read production ref over SSH." >&2; exit 3; }

# Prove WHOSE key it is. A personal key, or another repository's deploy key,
# can read this repository while it is public and must not become the transport.
identity_rc=0
mcc_github_identity || identity_rc=$?
if [[ ${identity_rc} -eq 3 ]]; then
  echo "GitHub greets this key as '${GITHUB_IDENTITY}', not as a Deploy key of ${GITHUB_DEPLOY_KEY_IDENTITY}. Register it under the repository's Deploy keys, not on an account." >&2
  exit 3
elif [[ ${identity_rc} -ne 0 ]]; then
  echo "Could not prove this key is a Deploy key of ${GITHUB_DEPLOY_KEY_IDENTITY}: GitHub's greeting was not recognised. Refusing to switch the transport." >&2
  echo "GitHub answered: ${GITHUB_GREETING_ANSWER:-nothing}" >&2
  exit 3
fi

# Prove it cannot write.
write_rc=0
mcc_deploy_key_write_access || write_rc=$?
if [[ ${write_rc} -eq 3 ]]; then
  echo "The deploy key has WRITE access. Turn 'Allow write access' off in GitHub, then run activate again." >&2
  exit 3
elif [[ ${write_rc} -ne 0 ]]; then
  echo "Could not prove the deploy key is read-only; refusing to switch the transport." >&2
  echo "The dry-run push answered: ${GITHUB_PUSH_ANSWER:-nothing}" >&2
  exit 3
fi

# Prove the reconciler's own Git will really use SSH for this URL.
if mcc_reconciler_rewrites_url; then
  echo "Git configuration on this host rewrites ${REPO}; the reconciler would not fetch over SSH. Refusing to switch the transport." >&2
  exit 3
fi

# A cycle that is already running would be taken for the first cycle after the switch.
if ! mcc_wait_reconciler_idle; then
  echo "A reconcile cycle has been running for over $((RECONCILE_IDLE_WAIT_SECONDS / 60)) minutes. Nothing was changed; run activate again when it has ended." >&2
  exit 4
fi

install -d -o root -g root -m 0755 "${DROPIN_DIR}"
# Keep what was there. Until the first cycle has completed over the new
# transport, ANY way this script ends puts the previous transport back.
previous=""
if [[ -f "${DROPIN}" && ! -L "${DROPIN}" ]]; then
  previous="$(mktemp "${DROPIN}.previous.XXXXXX")"
  MCC_TEMP_PATHS+=("${previous}")
  cat "${DROPIN}" > "${previous}"
  chmod 0644 "${previous}"
fi
SWITCH_PENDING=0
mcc_undo_switch() {
  [[ "${SWITCH_PENDING}" == 1 ]] || return 0
  SWITCH_PENDING=0
  if [[ -n "${previous}" ]]; then mv -f -- "${previous}" "${DROPIN}"; else rm -f -- "${DROPIN}"; fi
  if systemctl daemon-reload; then
    echo "The reconciler's transport was put back as it was before this run." >&2
  else
    echo "The drop-in was put back as it was, but systemd did not reload it. Run: systemctl daemon-reload" >&2
  fi
  return 0
}
trap 'mcc_undo_switch; mcc_cleanup' EXIT
tmp="$(mktemp "${DROPIN}.XXXXXX")"
MCC_TEMP_PATHS+=("${tmp}")
mcc_dropin_content > "${tmp}"
chmod 0644 "${tmp}"
SWITCH_PENDING=1
mv -f "${tmp}" "${DROPIN}"
if ! systemctl daemon-reload; then
  echo "systemd did not reload after the drop-in was written." >&2
  exit 4
fi
echo "Starting one reconcile cycle over SSH. A cycle that deploys can take up to 20 minutes: do not interrupt it."
if ! systemctl start "${RECONCILE_UNIT}"; then
  echo "The reconciler did not complete its first cycle after the switch." >&2
  echo "Read: journalctl -u ${RECONCILE_UNIT} -n 50 --no-pager" >&2
  exit 4
fi
if ! mcc_first_cycle_used_this_key; then
  echo "The cycle that ran after the switch was not a new cycle over SSH with this key: a cycle the timer had already started, or a reconciler that writes no cycle receipts." >&2
  echo "Read: journalctl -u ${RECONCILE_UNIT} -n 50 --no-pager, and ${RECONCILE_STATE}/last-cycle.json" >&2
  exit 4
fi
SWITCH_PENDING=0
systemctl is-active --quiet "${RECONCILE_TIMER}" || { echo "The SSH drop-in is installed, but ${RECONCILE_TIMER} is not active: no cycle will run on its own." >&2; exit 4; }
echo "OVH reconciler switched to authenticated read-only GitHub SSH after verified ref access."
echo "Its first cycle, ${FIRST_CYCLE_ID}, fetched over SSH with this key."
echo "This key is a Deploy key of ${GITHUB_DEPLOY_KEY_IDENTITY} and GitHub refuses it for writing."
echo "The cycle just run was started by hand. Wait for two timer cycles (about five minutes), then:"
echo "  sudo bash $0 status"
echo "It exits 0 only when every proof holds. Do that before making the repository private."
