#!/usr/bin/env bash
# Reproduce the deploy-pages.yml strip on a COPY of the working tree, so browser
# acceptance can run against the emitted artifact instead of the source checkout
# (audit W1, 2026-11-09). Reads the workflow's own rm lines; never touches the
# repository. The fictional-city and site0 steps of the workflow are not run here.
#   scripts/build-public-export.sh <output-dir>
#   MCC_SERVE_ROOT=<output-dir> node scripts/e2e/prim3-generated-missions.e2e.mjs
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${1:?output directory required}"
rm -rf "$OUT"; mkdir -p "$OUT"
( cd "$SRC" && git ls-files -co --exclude-standard -z | tar --null -T - -cf - ) | ( cd "$OUT" && tar -xf - )
cd "$OUT"
WF="$SRC/.github/workflows/deploy-pages.yml"
joined() { sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n *//g' "$WF"; }
RMRF=$(joined | grep -E '^\s*rm -rf ' | head -1 | sed 's/^\s*rm -rf //')
RMF=$(joined | grep -E '^\s*rm -f ' | head -1 | sed 's/^\s*rm -f //')
# shellcheck disable=SC2086
rm -rf $RMRF; rm -f $RMF
find . -type f \( -name '*.html' -o -name '*.js' -o -name '*.mjs' -o -name '*.css' \) -not -path './vendor/*' -print0 \
  | xargs -0 sed -i "s/__STAMP__/localexport00/g"
echo "export built at $OUT"
