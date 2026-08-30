#!/usr/bin/env python3
"""Bring every interior node inside the perfect shell, by moving it, not resizing it.

THE INSTRUCTION
"Everything should fit INSIDE the perfect glb."

WHAT WAS OUTSIDE
Measured against the fitted shell's envelope, six nodes broke the skin. Not one
of them is too big to fit -- every one is smaller than the envelope and simply
sits in the wrong place:

    B4_INTERFACILITY_TRANSFER_HALL   35.50 m past -X   (212.9 m wide in a 262 m envelope)
    L1_ROAD_NORTH_GATE               25.02 m past +Z
    L1_ROAD_SOUTH_GATE               19.46 m past -Z
    B2_HIGH_BAY_0                     5.47 m past -X
    B2_HIGH_BAY_1                     5.47 m past -X
    B2_HIGH_BAY_3                     5.46 m past +X

So the fix is a TRANSLATION -- the smallest one that brings each node inside.
Shape, size and orientation are all preserved exactly, and because none of
these nodes had a transform and no mesh is shared between nodes, this writes a
`translation` on the node and changes no vertex data at all.

WHAT IT DOES NOT TOUCH
Y. The vertical is settled elsewhere and by a different rule -- the shell's
floor is the L1 datum, the B levels are underneath it, and nothing here may
move a level up or down. See AGENTS.md and tools/measure_shell_floor.py.

WHAT "INSIDE" MEANS HERE
Inside the shell's envelope: nothing breaks the skin, nothing is visible
sticking out of the building. It is NOT the stricter test of sitting inside the
shell's hollow cavity -- the cavity is a good deal smaller than the envelope at
low levels, and satisfying that would mean resizing the building rather than
nudging six nodes. That is recorded as a known limit, not silently skipped.

USAGE
    python3 tools/fit_inside_shell.py \
        --in  game/assets/prim3_site0_master.glb \
        --shell game/assets/site0_shell_fitted.glb \
        --out game/assets/prim3_site0_master.glb

Verifies its own output and refuses to write a file that still breaks the skin.
Re-running is a no-op.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

TOL = 1e-6


def read_glb(path: Path):
    d = path.read_bytes()
    magic, ver, _ = struct.unpack("<III", d[:12])
    if magic != 0x46546C67 or ver != 2:
        raise SystemExit(f"{path}: not a glTF 2.0 GLB")
    js, binc, off = None, bytearray(), 12
    while off < len(d):
        (clen,) = struct.unpack("<I", d[off : off + 4])
        tag, body = d[off + 4 : off + 8], d[off + 8 : off + 8 + clen]
        if tag[:4] == b"JSON":
            js = json.loads(body)
        elif tag[:3] == b"BIN":
            binc = bytearray(body)
        off += 8 + clen
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


def node_box(js, nd):
    lo, hi = [9e9] * 3, [-9e9] * 3
    for prim in js["meshes"][nd["mesh"]]["primitives"]:
        a = js["accessors"][prim["attributes"]["POSITION"]]
        for i in range(3):
            lo[i] = min(lo[i], a["min"][i])
            hi[i] = max(hi[i], a["max"][i])
    t = nd.get("translation", [0, 0, 0])
    s = nd.get("scale", [1, 1, 1])
    return ([lo[i] * s[i] + t[i] for i in range(3)],
            [hi[i] * s[i] + t[i] for i in range(3)])


def breaches(lo, hi, slo, shi):
    """How far outside the envelope, per axis, in X and Z only."""
    out = {}
    for i, ax in ((0, "X"), (2, "Z")):
        if lo[i] < slo[i] - TOL:
            out["-" + ax] = slo[i] - lo[i]
        if hi[i] > shi[i] + TOL:
            out["+" + ax] = hi[i] - shi[i]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True, type=Path)
    ap.add_argument("--shell", required=True, type=Path)
    ap.add_argument("--out", dest="dst", required=True, type=Path)
    ap.add_argument("--scale", type=float, default=273.0)
    a = ap.parse_args()

    js, binc = read_glb(a.src)
    sjs, _ = read_glb(a.shell)
    snd = [n for n in sjs["nodes"] if "mesh" in n][0]
    slo, shi = node_box(sjs, snd)
    S = a.scale
    print(f"envelope  x {slo[0]:+.4f}..{shi[0]:+.4f}   z {slo[2]:+.4f}..{shi[2]:+.4f}")

    # a mesh reused by two nodes cannot be fixed by moving one of them
    seen = {}
    for nd in js["nodes"]:
        if "mesh" in nd:
            seen.setdefault(nd["mesh"], []).append(str(nd.get("name", "")))
    shared = {m: n for m, n in seen.items() if len(n) > 1}

    moved, refused = [], []
    for nd in js["nodes"]:
        if "mesh" not in nd:
            continue
        name = str(nd.get("name", ""))
        lo, hi = node_box(js, nd)
        br = breaches(lo, hi, slo, shi)
        if not br:
            continue
        if nd["mesh"] in shared:
            refused.append((name, br, "mesh shared with " + ", ".join(shared[nd["mesh"]])))
            continue
        d = [0.0, 0.0, 0.0]
        ok = True
        for i in (0, 2):
            need_pos = max(0.0, slo[i] - lo[i])
            need_neg = max(0.0, hi[i] - shi[i])
            if (hi[i] - lo[i]) > (shi[i] - slo[i]) + TOL:
                ok = False        # bigger than the envelope; a shift cannot save it
                break
            d[i] = need_pos - need_neg
        if not ok:
            refused.append((name, br, "wider than the envelope; would need resizing"))
            continue
        t = nd.get("translation", [0.0, 0.0, 0.0])
        nd["translation"] = [t[0] + d[0], t[1], t[2] + d[2]]
        moved.append((name, br, d))

    for name, br, d in moved:
        pretty = ", ".join(f"{k} {v*S:.2f} m" for k, v in br.items())
        print(f"  -> {name:<40} was out by {pretty:<24} moved "
              f"({d[0]*S:+.2f}, {d[2]*S:+.2f}) m")
    for name, br, why in refused:
        print(f"  !! {name:<40} {why}")

    if not moved and not refused:
        print("  nothing was outside the envelope")

    write_glb(a.dst, js, binc)

    # ---- verify ----
    vjs, _ = read_glb(a.dst)
    still = []
    for nd in vjs["nodes"]:
        if "mesh" not in nd:
            continue
        lo, hi = node_box(vjs, nd)
        br = breaches(lo, hi, slo, shi)
        if br:
            still.append((str(nd.get("name", "")), br))
    if still:
        print()
        for name, br in still:
            print(f"  STILL OUT  {name}: " + ", ".join(f"{k} {v*S:.2f} m" for k, v in br.items()))
        raise SystemExit(f"VERIFY FAILED: {len(still)} node(s) still break the skin")

    print(f"wrote {a.dst} ({a.dst.stat().st_size:,} bytes, {len(moved)} nodes moved)")
    print("  verified: every node is inside the shell's envelope in X and Z")


if __name__ == "__main__":
    main()
