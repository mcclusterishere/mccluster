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

for cmd in git flock node npm systemctl rsync; do
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

if [[ -n "${CURRENT_SHA}" && "${CURRENT_SHA}" == "${TARGET_SHA}" ]]; then
  echo "already deployed ${TARGET_SHA}"
  exit 0
fi

# Production deployments must point at a commit already merged into canonical main.
if ! git merge-base --is-ancestor "${TARGET_SHA}" refs/remotes/origin/main; then
  echo "refusing deploy: ${TARGET_SHA} is not contained in origin/main" >&2
  exit 3
fi

git reset --hard "${TARGET_SHA}"
# Dedicated reconcile checkout must contain only the promoted revision. Remove ignored
# build/test residue too so stale local state cannot influence validation or deployment.
git clean -ffdx

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
