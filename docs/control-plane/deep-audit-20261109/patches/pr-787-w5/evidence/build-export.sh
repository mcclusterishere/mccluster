#!/usr/bin/env bash
# Scratch copy (not part of any patch) of the audit branch's scripts/build-public-export.sh
# (claude/new-session-83ken5, audit W1) with the source tree as an argument: copy the tracked
# files of <src>, apply deploy-pages.yml's own `rm -rf` and `rm -f` lines, stamp __STAMP__.
# Like the original it does not run the workflow's fictional-city, site0 or
# equity-uprise-preview copy steps.   build-export.sh <src-worktree> <out-dir>
set -euo pipefail
SRC="$(cd "$1" && pwd)"; OUT="${2:?output directory required}"
rm -rf "$OUT"; mkdir -p "$OUT"
( cd "$SRC" && git ls-files -z | tar --null -T - -cf - ) | ( cd "$OUT" && tar -xf - )
cd "$OUT"
WF="$SRC/.github/workflows/deploy-pages.yml"
joined() { sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n *//g' "$WF"; }
RMRF=$(joined | grep -E '^\s*rm -rf ' | head -1 | sed 's/^\s*rm -rf //')
RMF=$(joined | grep -E '^\s*rm -f ' | head -1 | sed 's/^\s*rm -f //')
echo "strip rm -rf: $RMRF"; echo "strip rm -f: $RMF"
# shellcheck disable=SC2086
rm -rf $RMRF; rm -f $RMF
find . -type f \( -name '*.html' -o -name '*.js' -o -name '*.mjs' -o -name '*.css' \) -not -path './vendor/*' -print0 \
  | xargs -0 sed -i "s/__STAMP__/localexport00/g"
echo "export of $(git -C "$SRC" rev-parse HEAD) built at $OUT: PRIM3/ present? $([ -e PRIM3 ] && echo yes || echo no); js/prim3-mission: $(ls js/prim3-mission | tr '\n' ' ')"
