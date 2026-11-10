#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${MCCLUSTER_REPO_URL:-https://github.com/mcclusterishere/mccluster.git}"
DEPLOY_REF="${MCCLUSTER_DEPLOY_REF:-deploy/ovh-production}"
STATE_ROOT="${MCCLUSTER_RECONCILE_STATE_ROOT:-/var/lib/mccluster/reconcile}"
CHECKOUT="${STATE_ROOT}/source"
STATE_FILE="${STATE_ROOT}/deployed_sha"
LOCK_FILE="${STATE_ROOT}/reconcile.lock"

# ---------------------------------------------------------------------------
# Reconcile cycle evidence (incident #510).
#
# The timer stayed "active" for a day while every fetch failed, and the only
# success marker (last-success.json) is written on a deploy, never on a cycle
# that verified the promoted ref and found nothing to change. Each cycle that
# holds the lock now leaves one non-secret receipt: which systemd invocation ran
# it, what started it, how it ended, and how the repository was really read.
#
# Evidence can never fail, delay or change a cycle:
#   - it is gathered only after the outcome is decided, in a subshell, with
#     errexit, nounset and pipefail off, so nothing in it can end this script;
#   - every command that could block runs under one shared time budget;
#   - every value is matched against a strict pattern before it is written;
#     nothing read from the environment, a file or Git reaches the JSON verbatim;
#   - files are written to a temporary name and renamed, mode 0644, under
#     STATE_ROOT only. The private key is never opened: fingerprints come from
#     the public half and from the known-hosts file.
# last-success.json keeps its meaning: the last DEPLOY.
CYCLE_FILE="${STATE_ROOT}/last-cycle.json"
CYCLE_VERIFIED_FILE="${STATE_ROOT}/last-verified-cycle.json"
CYCLE_LOG="${STATE_ROOT}/cycles.jsonl"
CYCLE_LOG_KEEP=40
CYCLE_LINE_MAX=1024
CYCLE_EVIDENCE_BUDGET=10
CYCLE_EVIDENCE_DEADLINE=0
# Used only on systemd older than 252, which does not say what started a unit.
CYCLE_TIMER_INFER_WINDOW_US=2000000
# The exact known-hosts line scripts/ovh-private-repo-ssh.sh pins: GitHub's
# published Ed25519 host key. A public key; the same constant as in that script.
CYCLE_GITHUB_HOST_KEY="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
CYCLE_STARTED_AT="$(date -u +%FT%TZ 2>/dev/null || true)"
CYCLE_STAGE="preflight"
CYCLE_OWNS_LOCK=0
CYCLE_RECORDED=0
CYCLE_MAIN_SHA=""
CYCLE_PROMOTED_SHA=""

# Run one evidence command inside what is left of the shared budget. Without
# coreutils timeout nothing is run at all: unknown is recorded, never a guess.
mcc_cycle_bounded() {
  local left=$(( CYCLE_EVIDENCE_DEADLINE - SECONDS ))
  (( left > 0 )) || return 124
  command -v timeout >/dev/null 2>&1 || return 127
  SYSTEMD_COLORS=0 SYSTEMD_URLIFY=0 GIT_TERMINAL_PROMPT=0 LC_ALL=C \
    timeout --foreground --signal=TERM --kill-after=1s "${left}s" "$@" </dev/null 2>/dev/null
}

# Replace <target> with the lines given, through a temporary name in the same
# directory: created exclusively (never through a link left at that name), then
# renamed over the target. A directory at the target is refused, not entered.
mcc_cycle_put() {
  local target="$1" tmp="$1.tmp"
  shift
  rm -f -- "${tmp}" 2>/dev/null
  if [[ ! -d "${target}" ]] \
     && ( set -o noclobber; printf '%s\n' "$@" > "${tmp}" ) 2>/dev/null \
     && chmod 0644 -- "${tmp}" 2>/dev/null \
     && mv -f -- "${tmp}" "${target}" 2>/dev/null; then
    return 0
  fi
  rm -f -- "${tmp}" 2>/dev/null
  echo "mccluster-vps-reconcile: cycle evidence not written: ${target##*/}" >&2
  return 1
}

# mcc_cycle_receipt_write <verified_no_change|deployed|deferred|failed> <exit-code|signal>
# Runs only inside the subshell mcc_cycle_receipt opens.
mcc_cycle_receipt_write() {
  set +Eeu +o pipefail
  trap - EXIT ERR
  umask 022
  local outcome="${1:-}" code="${2:-}" exit_json="null" interrupted="false"
  local url="" transport="other" pinned="false" fingerprint="" credential="false"
  local key="${STATE_ROOT}/ssh/github_deploy_ed25519" known="${STATE_ROOT}/ssh/github_known_hosts"
  local pinned_command="" text="" first="" rest=""
  local invocation="" trigger="other" timer_us="" start_us="" unit_invocation="" version="" previous="" needle=""
  local main_sha="" promoted_sha="" deployed="" stage="" started="" finished="" line=""
  local entry="" from=0
  local -a kept=()

  case "${outcome}" in verified_no_change|deployed|deferred|failed) ;; *) return 0 ;; esac
  if [[ "${code}" == signal ]]; then
    # The shell is being terminated (unit timeout, stop, shutdown): no exit status exists yet.
    interrupted="true"
  elif [[ "${code}" =~ ^(0|[1-9][0-9]{0,2})$ ]] && (( code <= 255 )); then
    exit_json="${code}"
  fi
  CYCLE_EVIDENCE_DEADLINE=$(( SECONDS + CYCLE_EVIDENCE_BUDGET ))

  # Transport: the URL Git really uses for origin after url.*.insteadOf, not the
  # configured one. A rewritten or unrecognised URL is "other" and proves nothing.
  if [[ -d "${CHECKOUT}/.git" ]]; then
    url="$(mcc_cycle_bounded git -C "${CHECKOUT}" remote get-url origin)"
  fi
  if [[ -z "${url}" ]]; then
    url="$(mcc_cycle_bounded git ls-remote --get-url "${REPO_URL}")"
  fi
  if [[ "${url}" == "git@github.com:mcclusterishere/mccluster.git" ]]; then
    transport="ssh"
  elif [[ "${url}" == "https://github.com/mcclusterishere/mccluster.git" ]]; then
    transport="https"
  elif [[ "${url}" =~ ^https://[^/@[:space:]]+@github\.com/mcclusterishere/mccluster\.git$ ]]; then
    transport="https"
    credential="true"
  fi
  url=""

  if [[ "${transport}" == "ssh" ]]; then
    # Only the exact command ovh-private-repo-ssh.sh installs is recognised. It
    # names one identity and one known-hosts file and disables every other source.
    pinned_command="/usr/bin/ssh -F /dev/null -i ${key} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${known} -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no"
    if [[ "${GIT_SSH_COMMAND:-}" == "${pinned_command}" ]]; then
      if [[ -f "${known}" && ! -L "${known}" ]]; then
        # Pinned means: the whole file is that one line. A second key or a
        # certificate-authority line would widen what ssh accepts as GitHub.
        # Compared byte for byte: a NUL byte would end a shell read early and hide what follows it.
        if cmp -s -- "${known}" <(printf '%s\n' "${CYCLE_GITHUB_HOST_KEY}") || cmp -s -- "${known}" <(printf '%s' "${CYCLE_GITHUB_HOST_KEY}"); then
          pinned="true"
        fi
      fi
      if [[ -f "${key}.pub" && ! -L "${key}.pub" ]]; then
        text="$(mcc_cycle_bounded ssh-keygen -lf "${key}.pub" -E sha256)"
        read -r first fingerprint rest <<< "${text%%$'\n'*}"
      fi
    fi
    [[ "${fingerprint}" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || fingerprint=""
  elif [[ "${transport}" == "https" ]]; then
    # Whether a credential COULD have been offered. A public repository answers
    # an HTTPS fetch without asking for one, so this never proves authentication.
    [[ -n "${GIT_ASKPASS:-}" ]] && credential="true"
    [[ -n "${HOME:-}" && -e "${HOME}/.netrc" ]] && credential="true"
    if [[ -d "${CHECKOUT}/.git" ]]; then
      mcc_cycle_bounded git -C "${CHECKOUT}" config --get-regexp '^(credential\.(.+\.)?helper|http\.(.+\.)?extraheader|core\.askpass)$' >/dev/null && credential="true"
    else
      mcc_cycle_bounded git config --get-regexp '^(credential\.(.+\.)?helper|http\.(.+\.)?extraheader|core\.askpass)$' >/dev/null && credential="true"
    fi
  fi

  # Bounded history: at most CYCLE_LOG_KEEP well-formed lines, read from at most
  # the last 64 KiB of the previous file.
  if [[ -f "${CYCLE_LOG}" && ! -L "${CYCLE_LOG}" ]]; then
    while IFS= read -r entry; do
      if (( ${#entry} <= CYCLE_LINE_MAX )) \
         && [[ "${entry}" == '{"schema_version":"mccluster-reconcile-cycle/v1",'*'}' ]]; then
        kept+=("${entry}")
      fi
    done < <(tail -c 65536 -- "${CYCLE_LOG}" 2>/dev/null)
  fi
  if [[ -f "${CYCLE_FILE}" && ! -L "${CYCLE_FILE}" ]]; then
    { IFS= read -r -n "${CYCLE_LINE_MAX}" previous < "${CYCLE_FILE}"; } 2>/dev/null
  fi

  # Trigger. systemd 252 and later tell an activated unit what started it
  # (TRIGGER_UNIT), so there "timer" is systemd's own statement and its absence
  # means something else started the unit. Older systemd says nothing: only
  # there, a timer start is inferred when THIS invocation's main process started
  # within the window after the timer's last elapse, and no earlier receipt
  # already carries that elapse. A start by hand does not move the timer's last
  # elapse, and one elapse starts one cycle.
  invocation="${INVOCATION_ID:-}"
  [[ "${invocation}" =~ ^[0-9a-f]{32}$ ]] || invocation=""
  if [[ -n "${invocation}" ]]; then
    if [[ "${TRIGGER_UNIT:-}" == "mccluster-vps-reconcile.timer" ]]; then
      trigger="timer"
      timer_us="${TRIGGER_TIMER_MONOTONIC_USEC:-}"
    elif [[ -z "${TRIGGER_UNIT:-}" ]]; then
      text="$(mcc_cycle_bounded systemctl --version)"
      read -r first version rest <<< "${text%%$'\n'*}"
      if [[ "${version}" =~ ^[1-9][0-9]{2}$ ]] && (( version < 252 )); then
        text="$(mcc_cycle_bounded systemctl show --property=InvocationID --property=ExecMainStartTimestampMonotonic mccluster-vps-reconcile.service)"
        while IFS= read -r entry; do
          case "${entry}" in
            InvocationID=*) unit_invocation="${entry#*=}" ;;
            ExecMainStartTimestampMonotonic=*) start_us="${entry#*=}" ;;
          esac
        done <<< "${text}"
        # The timer's last elapse, as a number. systemctl prints every property
        # whose name holds "USec" as a time span ("12h 46min 21.250283s"), so it
        # is read from systemd over D-Bus, where busctl prints "t <usec>".
        text="$(mcc_cycle_bounded busctl get-property org.freedesktop.systemd1 /org/freedesktop/systemd1/unit/mccluster_2dvps_2dreconcile_2etimer org.freedesktop.systemd1.Timer LastTriggerUSecMonotonic)"
        [[ "${text}" =~ ^t\ ([1-9][0-9]{0,17})$ ]] && timer_us="${BASH_REMATCH[1]}"
        if [[ "${unit_invocation}" == "${invocation}" \
              && "${timer_us}" =~ ^[1-9][0-9]{0,17}$ && "${start_us}" =~ ^[1-9][0-9]{0,17}$ ]] \
           && (( start_us >= timer_us && start_us - timer_us <= CYCLE_TIMER_INFER_WINDOW_US )); then
          trigger="timer_inferred"
          needle="\"timer_trigger_monotonic_usec\":\"${timer_us}\""
          for entry in "${previous}" "${kept[@]}"; do
            [[ "${entry}" == *"${needle}"* ]] && trigger="other"
          done
        fi
      fi
    fi
  fi
  [[ "${trigger}" != "other" && "${timer_us}" =~ ^[1-9][0-9]{0,17}$ ]] || timer_us=""

  # Only refs of the approved deployment ref are named under its label.
  if [[ "${DEPLOY_REF}" == "deploy/ovh-production" ]]; then
    main_sha="${CYCLE_MAIN_SHA}"
    promoted_sha="${CYCLE_PROMOTED_SHA}"
  fi
  [[ "${main_sha}" =~ ^[0-9a-f]{40}$ ]] || main_sha=""
  [[ "${promoted_sha}" =~ ^[0-9a-f]{40}$ ]] || promoted_sha=""
  if [[ -f "${STATE_FILE}" && ! -L "${STATE_FILE}" ]]; then
    { IFS= read -r -n 64 deployed < "${STATE_FILE}"; } 2>/dev/null
  fi
  [[ "${deployed}" =~ ^[0-9a-f]{40}$ ]] || deployed=""
  stage="${CYCLE_STAGE}"
  [[ "${stage}" =~ ^[a-z_]{1,32}$ ]] || stage="unknown"
  finished="$(date -u +%FT%TZ 2>/dev/null)"
  [[ "${finished}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 0
  started="${CYCLE_STARTED_AT}"
  [[ "${started}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || started="${finished}"

  line="$(printf '{"schema_version":"mccluster-reconcile-cycle/v1","repository":"mcclusterishere/mccluster","promoted_ref":"deploy/ovh-production","cycle_id":"%s","trigger":"%s","timer_trigger_monotonic_usec":"%s","outcome":"%s","stage":"%s","exit_code":%s,"interrupted":%s,"transport":"%s","ssh_host_key_pinned":%s,"ssh_key_fingerprint":"%s","https_credential_configured":%s,"github_main_sha":"%s","github_promoted_sha":"%s","deployed_sha":"%s","started_at":"%s","finished_at":"%s"}' \
    "${invocation}" "${trigger}" "${timer_us}" "${outcome}" "${stage}" "${exit_json}" "${interrupted}" \
    "${transport}" "${pinned}" "${fingerprint}" "${credential}" \
    "${main_sha}" "${promoted_sha}" "${deployed}" "${started}" "${finished}")"
  (( ${#line} > 0 && ${#line} <= CYCLE_LINE_MAX )) || return 0

  mcc_cycle_put "${CYCLE_FILE}" "${line}"
  if [[ "${outcome}" == "verified_no_change" || "${outcome}" == "deployed" ]]; then
    mcc_cycle_put "${CYCLE_VERIFIED_FILE}" "${line}"
  fi

  # The history keeps its newest CYCLE_LOG_KEEP lines, rewritten whole and renamed.
  kept+=("${line}")
  from=$(( ${#kept[@]} - CYCLE_LOG_KEEP ))
  (( from > 0 )) || from=0
  mcc_cycle_put "${CYCLE_LOG}" "${kept[@]:from}"
  return 0
}

# mcc_cycle_receipt <outcome> <exit-code|signal>: at most one receipt per cycle.
# The mark is set first so the exit handler can never start a second writer.
mcc_cycle_receipt() {
  CYCLE_RECORDED=1
  ( mcc_cycle_receipt_write "$@" ) || true
  return 0
}

# A cycle that ends without a recorded success (fetch refused, ancestry gate,
# deployer failed or deferred, unit timeout) leaves a failed or deferred receipt
# naming the stage. This handler does not call exit and installs no signal trap,
# so the exit status and the signal behaviour of the cycle stay exactly as they
# were. A run that never held the lock writes nothing.
mcc_cycle_on_exit() {
  local rc="${1:-}"
  [[ "${CYCLE_OWNS_LOCK:-0}" == 1 && "${CYCLE_RECORDED:-1}" == 0 ]] || return 0
  case "${rc}" in
    75) mcc_cycle_receipt deferred 75 ;;
    0|"") mcc_cycle_receipt failed signal ;;
    *) mcc_cycle_receipt failed "${rc}" ;;
  esac
  return 0
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "mccluster-vps-reconcile must run as root" >&2
  exit 2
fi

for cmd in git flock node npm systemctl rsync cmp; do
  command -v "${cmd}" >/dev/null || { echo "missing required command: ${cmd}" >&2; exit 2; }
done

install -d -m 0755 "${STATE_ROOT}"
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "reconcile already running"; exit 0; }
CYCLE_OWNS_LOCK=1
trap 'mcc_cycle_on_exit "$?" || true' EXIT

CYCLE_STAGE="fetch"
if [[ ! -d "${CHECKOUT}/.git" ]]; then
  rm -rf "${CHECKOUT}"
  git clone --no-checkout "${REPO_URL}" "${CHECKOUT}"
fi

cd "${CHECKOUT}"
git remote set-url origin "${REPO_URL}"
git fetch --prune origin "+refs/heads/main:refs/remotes/origin/main" "+refs/heads/${DEPLOY_REF}:refs/remotes/origin/${DEPLOY_REF}"
TARGET_SHA="$(git rev-parse "refs/remotes/origin/${DEPLOY_REF}^{commit}")"
CURRENT_SHA="$(cat "${STATE_FILE}" 2>/dev/null || true)"

CYCLE_PROMOTED_SHA="${TARGET_SHA}"
CYCLE_STAGE="ancestry"
# Production deployments must point at a commit already merged into canonical main.
if ! git merge-base --is-ancestor "${TARGET_SHA}" refs/remotes/origin/main; then
  echo "refusing deploy: ${TARGET_SHA} is not contained in origin/main" >&2
  exit 3
fi

# A private GitHub repository cannot be queried anonymously via the REST API.
# Record a short-lived, non-secret attestation only AFTER both ref fetches and
# the ancestry guard succeed. Core reads this receipt if public API visibility
# is absent; a stale receipt must never be treated as fresh source evidence.
if [[ "${DEPLOY_REF}" != "deploy/ovh-production" ]]; then
  echo "refusing source attestation for unapproved deployment ref" >&2
  exit 3
fi
MAIN_SHA="$(git rev-parse "refs/remotes/origin/main^{commit}")"
if [[ ! "${MAIN_SHA}" =~ ^[0-9a-f]{40}$ || ! "${TARGET_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "invalid Git source revision; refusing source attestation" >&2
  exit 3
fi
CYCLE_MAIN_SHA="${MAIN_SHA}"
CYCLE_STAGE="source_receipt"
SOURCE_RECEIPT_TMP="${STATE_ROOT}/last-source-fetch.json.tmp"
printf '{"schema_version":"mccluster-reconcile-git-source/v1","repository":"mcclusterishere/mccluster","promoted_ref":"deploy/ovh-production","github_main_sha":"%s","github_promoted_sha":"%s","observed_at":"%s"}\n' \
  "${MAIN_SHA}" "${TARGET_SHA}" "$(date -u +%FT%TZ)" > "${SOURCE_RECEIPT_TMP}"
chmod 0644 "${SOURCE_RECEIPT_TMP}"
mv -f "${SOURCE_RECEIPT_TMP}" "${STATE_ROOT}/last-source-fetch.json"

CYCLE_STAGE="checkout"
git reset --hard "${TARGET_SHA}"
# Dedicated reconcile checkout must contain only the promoted revision. Remove ignored
# build/test residue too so stale local state cannot influence validation or deployment.
git clean -ffdx

# A matching SHA is not enough: local file edits, stale units, or a forged/stale
# deploy manifest are runtime drift. Compare the live install with the exact
# promoted checkout every reconcile cycle and self-heal any mismatch.
CYCLE_STAGE="drift_compare"
LIVE_CORE="${MCCLUSTER_LIVE_CORE:-/opt/mccluster/core}"
CORE_DRIFT=""
UNIT_DRIFT=""
PROVENANCE_DRIFT=""

if [[ ! -d "${LIVE_CORE}" ]]; then
  CORE_DRIFT="live core missing"
else
  # An empty list means "no drift" only when rsync finished the comparison. One
  # that failed (an I/O error, a broken library, an OOM kill) compared nothing,
  # so the cycle fails here instead of attesting a host it did not check. The
  # whole list is read, never cut short by a pipe that could kill rsync.
  DRIFT_RC=0
  CORE_DRIFT="$(rsync -acni --delete --omit-dir-times \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude '.mccluster-artifacts' \
    --exclude '.mccluster-deploy.json' \
    "${CHECKOUT}/core/" "${LIVE_CORE}/")" || DRIFT_RC=$?
  if (( DRIFT_RC != 0 )); then
    echo "drift comparison failed (rsync exit ${DRIFT_RC}); refusing to attest ${TARGET_SHA}" >&2
    exit 4
  fi
  CORE_DRIFT="${CORE_DRIFT%%$'\n'*}"
fi

for unit in "${CHECKOUT}"/core/systemd/*.service "${CHECKOUT}"/core/systemd/*.timer; do
  [[ -e "${unit}" ]] || continue
  name="$(basename "${unit}")"
  if [[ ! -f "/etc/systemd/system/${name}" ]] || ! cmp -s "${unit}" "/etc/systemd/system/${name}"; then
    UNIT_DRIFT="${name}"
    break
  fi
done

if [[ ! -f "${LIVE_CORE}/.mccluster-deploy.json" ]] || \
   ! grep -Fq "\"commit_sha\":\"${TARGET_SHA}\"" "${LIVE_CORE}/.mccluster-deploy.json"; then
  PROVENANCE_DRIFT="deploy manifest mismatch"
fi

if [[ -n "${CURRENT_SHA}" && "${CURRENT_SHA}" == "${TARGET_SHA}" && \
      -z "${CORE_DRIFT}" && -z "${UNIT_DRIFT}" && -z "${PROVENANCE_DRIFT}" ]]; then
  CYCLE_STAGE="complete"
  mcc_cycle_receipt verified_no_change 0 || true
  echo "already deployed and attested ${TARGET_SHA}"
  exit 0
fi

if [[ -n "${CURRENT_SHA}" && "${CURRENT_SHA}" == "${TARGET_SHA}" ]]; then
  echo "runtime drift detected at approved SHA ${TARGET_SHA}: core=${CORE_DRIFT:-ok} unit=${UNIT_DRIFT:-ok} provenance=${PROVENANCE_DRIFT:-ok}" >&2
fi

# Validate and deploy using the canonical rollback-safe deployer shipped by the target revision.
# deploy-ovh-core.sh takes <checkout> <exact-40-char-sha> and exits 2 without
# the second argument. Passing only the checkout meant autonomous
# reconciliation could never deploy: every run died on argument validation
# while the manual workflow, which passes both, kept working. TARGET_SHA is
# already resolved above and is the exact commit this run verified is
# contained in origin/main, so it is the only correct value to pass.
CYCLE_STAGE="deploy"
bash "${CHECKOUT}/scripts/deploy-ovh-core.sh" "${CHECKOUT}" "${TARGET_SHA}"
CYCLE_STAGE="stamp"

printf '%s\n' "${TARGET_SHA}" > "${STATE_FILE}.tmp"
mv "${STATE_FILE}.tmp" "${STATE_FILE}"
# Replaced by rename like every other file Core reads here: written in place, a
# health run between the truncate and the write would read an empty file.
printf '{"deployed_sha":"%s","deploy_ref":"%s","deployed_at":"%s"}\n' \
  "${TARGET_SHA}" "${DEPLOY_REF}" "$(date -u +%FT%TZ)" > "${STATE_ROOT}/last-success.json.tmp"
chmod 0644 "${STATE_ROOT}/last-success.json.tmp"
mv -f "${STATE_ROOT}/last-success.json.tmp" "${STATE_ROOT}/last-success.json"

CYCLE_STAGE="complete"
mcc_cycle_receipt deployed 0 || true

echo "reconciled OVH to ${TARGET_SHA} from ${DEPLOY_REF}"
