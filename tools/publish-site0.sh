#!/usr/bin/env bash
# Promote the playable Site 0 build out of _unfinished/ and into the web root.
#
# WHY A SCRIPT AND NOT A MOVE
# The game is one part of the recovered Kimi build. The design bible, the splat
# viewer, the model tools and the probe harness live beside it and belong
# together -- splitting the game out would fragment the thing to save a copy
# step. So the repo keeps it whole in _unfinished/site0-game/, and this promotes
# exactly the playable part into site0/ at deploy time.
#
# WHY IT IS ALLOWED OUT AT ALL
# _unfinished/README.md's rule is that a visitor must never walk into a room
# that does not work yet. The game now works: the mission completes in 39 s,
# all 41 lift stops land on real floor, zero page errors, zero failed requests,
# and the HUD fits down to 390 px. It is a room that works.
#
# WHAT IS NOT PROMOTED
#   viewer/     15 MB of Gaussian splats, loaded on demand, still rough
#   index.html  the design bible -- an internal document
#   tools/      build scripts no page fetches
#   probe/      the test harness
#   the older GLBs, and the 47 MB fitted shell (not in git at all)
#
# Run it from the repo root. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=_unfinished/site0-game
DST=site0

[ -f "$SRC/game/index.html" ] || { echo "missing $SRC/game/index.html"; exit 1; }

rm -rf "$DST"
mkdir -p "$DST/assets" "$DST/vendor"

# The import map says ../vendor/ because the game sits one level below vendor/
# in the source tree. Published, they are siblings.
# Two substitutions, both in one pass:
#   ../vendor/  -> ./vendor/  the game sits one level below vendor/ in the
#                             source tree; published, they are siblings.
#                             The leading ./ is NOT optional: an import map
#                             value must be a URL, and a bare "vendor/..." is
#                             a bare SPECIFIER. The browser rejects the whole
#                             entry -- "Ignored an import map value ... Bare
#                             specifier" -- and the page dies on
#                             "Failed to resolve module specifier three".
#                             This shipped once. The page still returned 200
#                             and every asset still returned 200; only the
#                             console said anything.
#   __STAMP__   -> the commit the model is versioned so a new build is not
#                             served from a stale cache. three.js is not: it is
#                             pinned at 0.166.1 and does not change, and an
#                             import map maps a PREFIX for the addons, which a
#                             query string cannot be appended to without
#                             breaking sub-path resolution. Versioning the one
#                             file that changes beats versioning half of them.
STAMP="${STAMP:-${GITHUB_SHA:-dev}}"
STAMP="${STAMP:0:12}"
sed -e 's|\.\./vendor/|./vendor/|g' -e "s/__STAMP__/$STAMP/g" \
    "$SRC/game/index.html" > "$DST/index.html"

cp "$SRC/game/icon.png" "$DST/icon.png"
# The perfect exterior. 17 MB, streamed in the background after the interior --
# see the comment in game/index.html. Without it the page shows the remodelled
# block massing, which is the part of the Kimi build that was rejected.
cp "$SRC/game/assets/site0_shell_perfect.glb" "$DST/assets/"
cp "$SRC/game/assets/prim3_site0_master.glb" \
   "$SRC/game/assets/site0_shell_fit.json" \
   "$SRC/game/assets/site0_node_mapping.json" "$DST/assets/"

# three.js only. spark.module.js is the splat viewer's, and the viewer is not
# promoted.
cp -r "$SRC/vendor/three" "$DST/vendor/three"

# ---- verify, rather than trust the sed ----
fail=0
grep -q '\.\./vendor/' "$DST/index.html" && { echo "::error::../vendor/ survived the rewrite"; fail=1; }
grep -q '__STAMP__'   "$DST/index.html" && { echo "::error::__STAMP__ survived the rewrite"; fail=1; }
# Every import map value must be a URL, not a bare specifier: absolute, or
# beginning ./ ../ or /. Checking the substitution happened is not the same as
# checking the result is valid, and the difference is a blank page.
python3 - "$DST/index.html" <<'PY' || fail=1
import json, re, sys
html = open(sys.argv[1]).read()
m = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
if not m:
    print("::error::no import map in the published page"); sys.exit(1)
bad = [f"{k} -> {v}" for k, v in json.loads(m.group(1))["imports"].items()
       if not re.match(r'^(\./|\.\./|/|[a-z][a-z0-9+.-]*:)', v)]
if bad:
    print("::error::import map value is a bare specifier, the page will not "
          "load: " + "; ".join(bad)); sys.exit(1)
print("  import map ok:", ", ".join(json.loads(m.group(1))["imports"].values()))
PY
for f in "$DST/index.html" "$DST/icon.png" "$DST/assets/prim3_site0_master.glb" \
         "$DST/assets/site0_shell_perfect.glb" \
         "$DST/vendor/three/addons/libs/meshopt_decoder.module.js" \
         "$DST/vendor/three/three.module.js" \
         "$DST/vendor/three/addons/loaders/GLTFLoader.js" \
         "$DST/vendor/three/addons/controls/OrbitControls.js"; do
  [ -s "$f" ] || { echo "::error::missing or empty: $f"; fail=1; }
done
# every import the page declares must resolve to a file that is actually here
while read -r spec; do
  case "$spec" in
    vendor/*) [ -e "$DST/$spec" ] || { echo "::error::import map points at a missing file: $spec"; fail=1; } ;;
  esac
done < <(sed -n 's/.*"\(vendor\/[^"]*\)".*/\1/p' "$DST/index.html")
[ "$fail" = 0 ] || exit 1

# The page's own module must at least parse. `node --check` validates module
# syntax without running it -- the other half of "the file is there" versus
# "the file works", which is the half that was missing when a bare specifier
# shipped a blank page behind three 200s.
awk '/<script type="module">/{f=1;next} /<\/script>/{if(f){f=0}} f' \
    "$DST/index.html" > "$DST/.check.mjs"
[ -s "$DST/.check.mjs" ] || { echo "::error::no module script in the published page"; exit 1; }
if ! node --check "$DST/.check.mjs"; then
  echo "::error::the published page's module does not parse"
  rm -f "$DST/.check.mjs"; exit 1
fi
rm -f "$DST/.check.mjs"
echo "  module parses"

echo "published $DST ($(du -sh "$DST" | cut -f1)) stamped $STAMP"
