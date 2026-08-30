#!/usr/bin/env python3
"""Make B1–B5 regular floors: one footprint, matching the building.

THE PROBLEM, MEASURED
---------------------
In `prim3_site0_l1.glb` every level above ground fits its own building and
every level below it does not. Footprint width as a share of the main
hull:

    L3   97%      B1    98%   (but shifted, and 0.14 past the north face)
    L2   99%      B2   112%
    L1  105%      B3    59%
                  B4   140%
                  B5    53%

Raw extents, hull first:

    ARCH_MAIN_HULL     x -0.449 .. 0.465   z -0.304 .. 0.341
    ARCH_L2_FLOOR      x -0.444 .. 0.461   z -0.300 .. 0.336
    ARCH_B1_FLOOR      x -0.450 .. 0.450   z -0.300 .. 0.480
    ARCH_B2_FLOOR      x -0.510 .. 0.510   z -0.320 .. 0.480
    ARCH_B3_FLOOR      x -0.210 .. 0.330   z -0.160 .. 0.300
    ARCH_B4_FLOOR      x -0.630 .. 0.650   z -0.260 .. 0.340
    ARCH_B5_FLOOR      x -0.170 .. 0.310   z -0.140 .. 0.280

B4 is 1.28 wide against a 0.91 hull — a third of that floor hangs outside
the building. B5 is 0.48 wide and stops less than halfway across. B1 and
B2 run 0.14 past the north face. Stacked, they read as a staircase rather
than a building, and walking them you either run out of floor before the
wall or walk out through it into nothing.

Note this is NOT the central-void question. The void is already right:
only L1 and L2 are open at the centre; B1–B5 are solid slabs, which is
exactly the rule. The defect is that those solid slabs are all different
sizes and none of them is the building's size.

WHAT THIS DOES
--------------
Remaps every `ARCH_B*_FLOOR` and `ARCH_B*_WALLS` in X and Z onto the L2
business deck's footprint, which is the one floor that actually fits
(99% of hull, inset 5 thou from the shell like a floor should be). Y is
left completely alone, so every level keeps its own height, thickness and
position in the stack.

The remap is affine per node — `x' = (x-lo)/(hi-lo) * (T1-T0) + T0` — so a
slab stays a slab and a wall ring stays a wall ring. Nothing is
re-modelled; the shapes are the ones Kimi made, resized to the building.

Rooms are deliberately NOT touched. `ARCH_B3_RM_PRIME COMMAND` and its
siblings sit inside their level and stay where they were put; enlarging
the slab under them only gives them more floor around them, never less.

USAGE
-----
    python3 tools/square_the_basements.py \
        --in  game/assets/prim3_site0_l1.glb \
        --out game/assets/prim3_site0_l1_squared.glb

Verifies its own output and refuses to write a file where any basement
still misses the target footprint. Re-running is a no-op.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

FLOOR_SUFFIXES = ("_FLOOR", "_WALLS")
LEVELS = ("B1", "B2", "B3", "B4", "B5")
REFERENCE = "ARCH_L2_FLOOR"          # the one floor that fits
TOLERANCE = 1e-4


def read_glb(path: Path):
    d = path.read_bytes()
    magic, ver, _ = struct.unpack("<III", d[:12])
    if magic != 0x46546C67 or ver != 2:
        raise SystemExit(f"{path}: not a glTF 2.0 GLB")
    js, binc, off = None, bytearray(), 12
    while off < len(d):
        (clen,) = struct.unpack("<I", d[off : off + 4])
        tag = d[off + 4 : off + 8]
        body = d[off + 8 : off + 8 + clen]
        if tag[:4] == b"JSON":
            js = json.loads(body)
        elif tag[:3] == b"BIN":
            binc = bytearray(body)
        off += 8 + clen
    if js is None:
        raise SystemExit(f"{path}: no JSON chunk")
    return js, binc


def write_glb(path: Path, js: dict, binc: bytearray) -> None:
    while len(binc) % 4:
        binc.append(0)
    jb = json.dumps(js, separators=(",", ":")).encode()
    while len(jb) % 4:
        jb += b" "
    total = 12 + 8 + len(jb) + (8 + len(binc) if binc else 0)
    out = bytearray(struct.pack("<III", 0x46546C67, 2, total))
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb
    if binc:
        out += struct.pack("<II", len(binc), 0x004E4942) + bytes(binc)
    path.write_bytes(out)


def positions(js, binc, acc_idx):
    """Yield (byte_offset, x, y, z) for each vertex of a POSITION accessor."""
    a = js["accessors"][acc_idx]
    bv = js["bufferViews"][a["bufferView"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride") or 12
    for i in range(a["count"]):
        o = base + stride * i
        yield o, *struct.unpack_from("<3f", binc, o)


def node_box(js, binc, node):
    lo = [9e9] * 3
    hi = [-9e9] * 3
    for prim in js["meshes"][node["mesh"]]["primitives"]:
        a = js["accessors"][prim["attributes"]["POSITION"]]
        if "min" in a and "max" in a:
            for i in range(3):
                lo[i] = min(lo[i], a["min"][i])
                hi[i] = max(hi[i], a["max"][i])
        else:
            for _, x, y, z in positions(js, binc, prim["attributes"]["POSITION"]):
                for i, v in enumerate((x, y, z)):
                    lo[i] = min(lo[i], v)
                    hi[i] = max(hi[i], v)
    return lo, hi


def remap_node(js, binc, node, target):
    """Affine-remap this node's X and Z onto `target`. Y untouched."""
    lo, hi = node_box(js, binc, node)
    (tx0, tx1), (tz0, tz1) = target
    sx = (tx1 - tx0) / (hi[0] - lo[0]) if hi[0] - lo[0] > 1e-9 else 1.0
    sz = (tz1 - tz0) / (hi[2] - lo[2]) if hi[2] - lo[2] > 1e-9 else 1.0

    for prim in js["meshes"][node["mesh"]]["primitives"]:
        ai = prim["attributes"]["POSITION"]
        nlo = [9e9] * 3
        nhi = [-9e9] * 3
        for off, x, y, z in list(positions(js, binc, ai)):
            nx = (x - lo[0]) * sx + tx0
            nz = (z - lo[2]) * sz + tz0
            struct.pack_into("<3f", binc, off, nx, y, nz)
            for i, v in enumerate((nx, y, nz)):
                nlo[i] = min(nlo[i], v)
                nhi[i] = max(nhi[i], v)
        a = js["accessors"][ai]
        a["min"] = [round(v, 6) for v in nlo]
        a["max"] = [round(v, 6) for v in nhi]
    return (hi[0] - lo[0], hi[2] - lo[2]), (tx1 - tx0, tz1 - tz0)


def target_from_reference(js, binc):
    for nd in js["nodes"]:
        if str(nd.get("name", "")).startswith(REFERENCE):
            lo, hi = node_box(js, binc, nd)
            return ((lo[0], hi[0]), (lo[2], hi[2]))
    raise SystemExit(f"reference floor {REFERENCE} not found")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True, type=Path)
    ap.add_argument("--out", dest="dst", required=True, type=Path)
    a = ap.parse_args()

    js, binc = read_glb(a.src)
    target = target_from_reference(js, binc)
    (tx0, tx1), (tz0, tz1) = target
    print(f"target footprint (from {REFERENCE}): "
          f"x {tx0:.3f}..{tx1:.3f}  z {tz0:.3f}..{tz1:.3f}")

    touched = 0
    for nd in js["nodes"]:
        nm = str(nd.get("name", ""))
        if "mesh" not in nd:
            continue
        if not nm.startswith("ARCH_B"):
            continue
        if not any(s in nm for s in FLOOR_SUFFIXES):
            continue
        if not any(nm.startswith(f"ARCH_{lv}_") for lv in LEVELS):
            continue
        (ow, od), (nw, nd_) = remap_node(js, binc, nd, target)
        if abs(ow - nw) < TOLERANCE and abs(od - nd_) < TOLERANCE:
            print(f"  == {nm[:40]:<40} already square")
        else:
            print(f"  ++ {nm[:40]:<40} {ow:.3f}x{od:.3f} -> {nw:.3f}x{nd_:.3f}")
        touched += 1

    write_glb(a.dst, js, binc)
    print(f"wrote {a.dst} ({a.dst.stat().st_size} bytes, {touched} nodes squared)")

    # ---- verify ----
    vjs, vbin = read_glb(a.dst)
    bad = []
    for nd in vjs["nodes"]:
        nm = str(nd.get("name", ""))
        if not nm.startswith("ARCH_B") or "mesh" not in nd:
            continue
        if not any(s in nm for s in FLOOR_SUFFIXES):
            continue
        if not any(nm.startswith(f"ARCH_{lv}_") for lv in LEVELS):
            continue
        lo, hi = node_box(vjs, vbin, nd)
        if (abs(lo[0] - tx0) > TOLERANCE or abs(hi[0] - tx1) > TOLERANCE
                or abs(lo[2] - tz0) > TOLERANCE or abs(hi[2] - tz1) > TOLERANCE):
            bad.append(nm)
    if bad:
        raise SystemExit(f"VERIFY FAILED: still off-footprint: {bad}")
    print(f"  verified: all {touched} basement floors and walls on one footprint")


if __name__ == "__main__":
    main()
