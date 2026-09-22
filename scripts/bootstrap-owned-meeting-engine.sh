#!/usr/bin/env bash
set -euo pipefail

# Bootstrap a McCluster-owned working copy of the permissively licensed meeting
# engine without vendoring a large third-party tree into the main mccluster repo.
#
# This script clones source only. It does not publish ports, install Docker, or
# deploy production services.

UPSTREAM_URL="${MCCLUSTER_MEETING_UPSTREAM_URL:-https://github.com/Vexa-ai/vexa-core.git}"
UPSTREAM_REF="${MCCLUSTER_MEETING_UPSTREAM_REF:-37a920cd05116d6919186b0b9b4d564247d0e929}"
VENDOR_ROOT="${MCCLUSTER_VENDOR_ROOT:-/srv/mccluster/vendor}"
DEST="${MCCLUSTER_MEETING_ENGINE_ROOT:-$VENDOR_ROOT/vexa-core}"
OWNED_BRANCH="${MCCLUSTER_MEETING_OWNED_BRANCH:-mccluster-owned}"

mkdir -p "$VENDOR_ROOT"

if [[ ! -d "$DEST/.git" ]]; then
  git clone "$UPSTREAM_URL" "$DEST"
fi

cd "$DEST"

if ! git remote get-url upstream >/dev/null 2>&1; then
  if git remote get-url origin >/dev/null 2>&1; then
    git remote rename origin upstream
  else
    git remote add upstream "$UPSTREAM_URL"
  fi
fi

git fetch upstream --tags --prune

if git cat-file -e "$UPSTREAM_REF^{commit}" >/dev/null 2>&1; then
  BASE="$UPSTREAM_REF"
elif git rev-parse --verify "refs/tags/$UPSTREAM_REF" >/dev/null 2>&1; then
  BASE="refs/tags/$UPSTREAM_REF"
else
  BASE="upstream/$UPSTREAM_REF"
fi

if git show-ref --verify --quiet "refs/heads/$OWNED_BRANCH"; then
  git switch "$OWNED_BRANCH"
else
  git switch --create "$OWNED_BRANCH" "$BASE"
fi

cat <<EOF

Owned meeting-engine source is ready.

Path:       $DEST
Upstream:   $UPSTREAM_URL
Pinned ref: $UPSTREAM_REF
Branch:     $OWNED_BRANCH

Next:
1. Create/fork a McCluster-owned remote when desired.
2. Add it as origin:
     git remote add origin git@github.com:mcclusterishere/<owned-meeting-repo>.git
3. Push:
     git push -u origin $OWNED_BRANCH
4. Keep upstream for security/reliability updates:
     git fetch upstream --tags
5. Preserve upstream Apache-2.0 LICENSE/NOTICE obligations.

No production service was started by this script.
EOF
