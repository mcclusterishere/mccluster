#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${MCCLUSTER_REPO_URL:-https://github.com/mcclusterishere/mccluster.git}"
DEPLOY_REF="${MCCLUSTER_DEPLOY_REF:-deploy/ovh-production}"
STATE_ROOT="${MCCLUSTER_RECONCILE_STATE_ROOT:-/var/lib/mccluster/reconcile}"
CHECKOUT="${STATE_ROOT}/source"
STATE_FILE="${STATE_ROOT}/deployed_sha"
LOCK_FILE="${STATE_ROOT}/reconcile.lock"

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

if [[ ! -d "${CHECKOUT}/.git" ]]; then
  rm -rf "${CHECKOUT}"
  git clone --no-checkout "${REPO_URL}" "${CHECKOUT}"
fi

cd "${CHECKOUT}"
git remote set-url origin "${REPO_URL}"
git fetch --prune origin "+refs/heads/main:refs/remotes/origin/main" "+refs/heads/${DEPLOY_REF}:refs/remotes/origin/${DEPLOY_REF}"
TARGET_SHA="$(git rev-parse "refs/remotes/origin/${DEPLOY_REF}^{commit}")"
CURRENT_SHA="$(cat "${STATE_FILE}" 2>/dev/null || true)"

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
SOURCE_RECEIPT_TMP="${STATE_ROOT}/last-source-fetch.json.tmp"
printf '{"schema_version":"mccluster-reconcile-git-source/v1","repository":"mcclusterishere/mccluster","promoted_ref":"deploy/ovh-production","github_main_sha":"%s","github_promoted_sha":"%s","observed_at":"%s"}\n' \
  "${MAIN_SHA}" "${TARGET_SHA}" "$(date -u +%FT%TZ)" > "${SOURCE_RECEIPT_TMP}"
chmod 0644 "${SOURCE_RECEIPT_TMP}"
mv -f "${SOURCE_RECEIPT_TMP}" "${STATE_ROOT}/last-source-fetch.json"

git reset --hard "${TARGET_SHA}"
# Dedicated reconcile checkout must contain only the promoted revision. Remove ignored
# build/test residue too so stale local state cannot influence validation or deployment.
git clean -ffdx

# A matching SHA is not enough: local file edits, stale units, or a forged/stale
# deploy manifest are runtime drift. Compare the live install with the exact
# promoted checkout every reconcile cycle and self-heal any mismatch.
LIVE_CORE="${MCCLUSTER_LIVE_CORE:-/opt/mccluster/core}"
CORE_DRIFT=""
UNIT_DRIFT=""
PROVENANCE_DRIFT=""

if [[ ! -d "${LIVE_CORE}" ]]; then
  CORE_DRIFT="live core missing"
else
  CORE_DRIFT="$(rsync -acni --delete --omit-dir-times \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude '.mccluster-artifacts' \
    --exclude '.mccluster-deploy.json' \
    "${CHECKOUT}/core/" "${LIVE_CORE}/" | head -n 1 || true)"
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
bash "${CHECKOUT}/scripts/deploy-ovh-core.sh" "${CHECKOUT}" "${TARGET_SHA}"

printf '%s\n' "${TARGET_SHA}" > "${STATE_FILE}.tmp"
mv "${STATE_FILE}.tmp" "${STATE_FILE}"
printf '{"deployed_sha":"%s","deploy_ref":"%s","deployed_at":"%s"}\n' \
  "${TARGET_SHA}" "${DEPLOY_REF}" "$(date -u +%FT%TZ)" > "${STATE_ROOT}/last-success.json"

echo "reconciled OVH to ${TARGET_SHA} from ${DEPLOY_REF}"
