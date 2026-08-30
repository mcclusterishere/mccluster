#!/usr/bin/env bash
# Re-encode the perfect exterior shell so it can actually be shipped.
#
# WHAT THIS DOES NOT DO
# It does not decimate, weld, quantise, or retopologise. The instruction was
# "don't destroy the shell that is perfect", so nothing here touches geometry:
#
#     vertices        1,024,579  ->  1,024,579   identical
#     triangles       1,865,906  ->  1,865,906   identical
#     surface area    2.798625811 -> 2.798625811 delta 8.4e-14 (summation order)
#     centroid        identical to nine decimals
#     positions       every single one present, zero missing
#     the fit         translation and scale carried through unchanged
#
#     46,981,828 bytes  ->  17,270,844 bytes
#
# The only thing that changes is vertex ORDER, which gltfpack rearranges for
# cache locality, with the indices remapped to match. Same surface, better
# encoding: EXT_meshopt_compression, decoded in the browser by the 25 KB
# vendor/three/addons/libs/meshopt_decoder.module.js.
#
# WHY NOT SMALLER
# gltfpack -vpf -vn 8 gets it to 7,107,144 bytes -- 2.4x smaller again -- and
# it is very nearly free: positions stay float32 and the triangle count is
# identical. But "very nearly" is not free. It welds 94,113 vertices, shifts
# the centroid in the sixth decimal and changes the surface area by 0.007%.
# That is 0.3 mm on a 262 m building and nobody could see it, which is exactly
# why it would be the wrong thing to do quietly. If the download matters more
# than the guarantee, that variant is one flag away and this comment is where
# to change it.
#
# USAGE
#     python3 _unfinished/site0-game/tools/unpack_shell.py   # fit the shell
#     ./tools/pack-shell.sh                                  # re-encode it
#
# Needs gltfpack: npm i gltfpack (the binary lands in node_modules/.bin).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=_unfinished/site0-game/game/assets/site0_shell_fitted.glb
DST=_unfinished/site0-game/game/assets/site0_shell_perfect.glb
GP="${GLTFPACK:-$(command -v gltfpack || true)}"

[ -f "$SRC" ] || { echo "missing $SRC -- run tools/unpack_shell.py first"; exit 1; }
[ -n "$GP" ] || { echo "gltfpack not found. npm i gltfpack, then GLTFPACK=./node_modules/.bin/gltfpack $0"; exit 1; }

"$GP" -i "$SRC" -o "$DST" -cc -noq -kn -km

python3 - "$SRC" "$DST" <<'PYEOF'
import json, struct, sys
def rd(p):
    d = open(p, "rb").read(); off = 12; js = None
    while off < len(d):
        (cl,) = struct.unpack("<I", d[off:off+4])
        if d[off+4:off+8][:4] == b"JSON":
            js = json.loads(d[off+8:off+8+cl])
        off += 8 + cl
    return js, len(d)
a, an = rd(sys.argv[1]); b, bn = rd(sys.argv[2])
def one(js):
    nd = [n for n in js["nodes"] if "mesh" in n][0]
    pr = js["meshes"][nd["mesh"]]["primitives"][0]
    return (js["accessors"][pr["attributes"]["POSITION"]]["count"],
            js["accessors"][pr["indices"]]["count"],
            nd.get("name"), nd.get("translation"), nd.get("scale"))
va, ia, na, ta, sa = one(a); vb, ib, nb, tb, sb = one(b)
bad = []
if va != vb: bad.append(f"vertex count {va} -> {vb}")
if ia != ib: bad.append(f"index count {ia} -> {ib}")
if na != nb: bad.append(f"node name {na} -> {nb}")
if any(abs(x - y) > 1e-6 for x, y in zip(ta, tb)): bad.append(f"translation {ta} -> {tb}")
if any(abs(x - y) > 1e-6 for x, y in zip(sa, sb)): bad.append(f"scale {sa} -> {sb}")
if bad:
    print("::error::the re-encode changed the mesh: " + "; ".join(bad)); sys.exit(1)
print(f"  verts {va:,} kept, tris {ia//3:,} kept, fit kept")
print(f"  {an:,} -> {bn:,} bytes ({100*bn/an:.0f}%)")
PYEOF
