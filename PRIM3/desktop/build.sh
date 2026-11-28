#!/usr/bin/env bash
# Build PRIM3 desktop: copy in the Site 0 master (checked against its manifest), run the rules tests
# and the McCluster studio playtest headless, then export Windows and Linux builds into build/.
#   GODOT=/path/to/godot ./build.sh            # everything
#   GODOT=/path/to/godot ./build.sh --sync     # only copy the Site 0 master in (for the editor)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
godot="${GODOT:-godot}"
master="$repo/assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v04.glb"
manifest="$repo/assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v04_manifest.json"

want="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$manifest")"
have="$(sha256sum "$master" | cut -d' ' -f1)"
if [ "$want" != "$have" ]; then
  echo "Site 0 master does not match its manifest ($have != $want); refusing to build." >&2
  exit 1
fi
mkdir -p "$here/assets/site0"
cp "$master" "$here/assets/site0/"
# the web game's own art, used as it is: operator models and carried items, the CC0 PBR textures and
# night HDRI, and the White Industrial kit (assets/3d/*/ stay the single source; nothing is duplicated in git)
mkdir -p "$here/assets/web/operators/items" "$here/assets/web/tactics" "$here/assets/web/kit"
cp "$repo"/assets/3d/prim3-operators/{E,R,T}.glb "$repo"/assets/3d/prim3-operators/manifest.json "$here/assets/web/operators/"
cp "$repo"/assets/3d/prim3-operators/items/*.glb "$here/assets/web/operators/items/"
cp -r "$repo"/assets/3d/prim3-tactics/pbr "$repo"/assets/3d/prim3-tactics/hdri "$repo"/assets/3d/prim3-tactics/CREDITS.md "$here/assets/web/tactics/"
cp -r "$repo"/assets/3d/prim3-kit/white-industrial/models "$repo"/assets/3d/prim3-kit/white-industrial/catalog.json "$here/assets/web/kit/"
[ "${1:-}" = "--sync" ] && { echo "Site 0 master ($have) and the web game's art copied in."; exit 0; }

cd "$here"
"$godot" --headless --path . --import >/dev/null 2>&1 || "$godot" --headless --path . --editor --quit >/dev/null 2>&1 || true
"$godot" --headless --path . -s res://tests/run_tests.gd
for m in site0-through-road site0-drone-pad site0-heavy-hall; do
  "$godot" --headless --path . -- --mccluster-scenario=ci-$m --mccluster-mission=$m --mccluster-seed=1 --mccluster-max-steps=4000 \
    | grep '"kind":"terminal"' || true
done
mkdir -p build/windows build/linux
"$godot" --headless --path . --export-release "Windows Desktop" build/windows/PRIM3.exe
"$godot" --headless --path . --export-release "Linux" build/linux/PRIM3.x86_64
ls -la build/windows build/linux
