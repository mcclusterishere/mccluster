#!/usr/bin/env bash
# McCluster static frontend release: OVH/local export -> Cloudflare Pages.
# No GitHub Action, GitHub API, or Cloudflare Git integration is involved.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${PAGES_PUBLIC_EXPORT:?Set PAGES_PUBLIC_EXPORT to an approved, already-built public web directory}"
: "${PAGES_RELEASE_DIR:?Set PAGES_RELEASE_DIR to a NEW, empty staging directory}"
: "${MC_SOURCE_SHA:?Set MC_SOURCE_SHA to the exact 40-character source commit}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID for the Pages account}"

PAGES_PROJECT_NAME="${PAGES_PROJECT_NAME:-mccluster-web}"
if [[ ! "${PAGES_PROJECT_NAME}" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Invalid Pages project name" >&2; exit 2
fi

node "${ROOT}/scripts/stage-cloudflare-pages.mjs" \
  --input "${PAGES_PUBLIC_EXPORT}" --output "${PAGES_RELEASE_DIR}" --commit "${MC_SOURCE_SHA}"

# Set PAGES_STAGE_ONLY=1 to stage and validate without any Cloudflare mutation.
if [[ "${PAGES_STAGE_ONLY:-0}" == "1" ]]; then
  echo "Staged only; no deployment made."; exit 0
fi
: "${CLOUDFLARE_API_TOKEN:?Set a scoped Cloudflare Pages edit token on the release host}"
if [[ ! "${CLOUDFLARE_ACCOUNT_ID}" =~ ^[0-9a-f]{32}$ ]]; then
  echo "Invalid Cloudflare account id" >&2; exit 2
fi

# Production ships only commits already on main. From a git checkout, the
# source SHA must be an ancestor of origin/main (fetch first if it is stale);
# an unknown SHA fails the same way.
if git -C "${ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git -C "${ROOT}" merge-base --is-ancestor "${MC_SOURCE_SHA}" origin/main 2>/dev/null; then
    echo "MC_SOURCE_SHA ${MC_SOURCE_SHA} is not on origin/main; refusing to deploy it to production." >&2; exit 2
  fi
fi

# Install/pin Wrangler as part of the OVH release runner image. We deliberately
# refuse npx's auto-install of an unpinned package during production deployment.
WRANGLER_BIN="${WRANGLER_BIN:-wrangler}"
if ! command -v "${WRANGLER_BIN}" >/dev/null 2>&1; then
  echo "Wrangler is missing. Install a reviewed, pinned version on the release runner." >&2; exit 2
fi

# The project must exist as a Direct Upload project whose production branch is
# "main"; otherwise --branch=main lands as a preview deployment and the
# production alias never serves the release. Fail before uploading anything.
# wrangler's project list (even --json) carries no production branch, so the
# project is read from the Pages API; anything but "main" fails closed. The
# token goes to curl on stdin, never on the command line.
CF_API="https://api.cloudflare.com/client/v4"
if ! project_json="$(printf 'header = "Authorization: Bearer %s"\n' "${CLOUDFLARE_API_TOKEN}" \
    | curl -fsS --max-time 30 -K - "${CF_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PAGES_PROJECT_NAME}")"; then
  echo "Pages project ${PAGES_PROJECT_NAME} was not found for this account/token. Create it once with:" >&2
  echo "  wrangler pages project create ${PAGES_PROJECT_NAME} --production-branch=main" >&2; exit 2
fi
production_branch="$(printf '%s' "${project_json}" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);if(j.success===true&&typeof j.result?.production_branch==="string")process.stdout.write(j.result.production_branch);}catch{}
});')"
if [[ "${production_branch}" != "main" ]]; then
  echo "Pages project ${PAGES_PROJECT_NAME} production branch is '${production_branch:-unknown}', not 'main'; a --branch=main upload would be a preview. Refusing." >&2; exit 2
fi
echo "Deploying sanitized website to ${PAGES_PROJECT_NAME} (no custom-domain changes)"
"${WRANGLER_BIN}" pages deploy "${PAGES_RELEASE_DIR}" \
  --project-name="${PAGES_PROJECT_NAME}" \
  --branch=main \
  --commit-hash="${MC_SOURCE_SHA}" \
  --commit-dirty=false
echo "Deploy finished. Verify pages.dev content and release provenance before changing DNS."
