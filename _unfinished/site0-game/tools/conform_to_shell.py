#!/usr/bin/env python3
"""Cut the interior down to the perfect shell's coordinates, band by band.

THE INSTRUCTION
"Cut every excess piece of the Kimi build and make it conform exactly to the
shell coordinates of the perfect glb."

WHY NOT CLIP TO THE SHELL'S HOLLOW INTERIOR
Because the question "is this point inside the shell" has no answer for this
mesh. The Tripo export is NOT watertight -- 283,418 of its 2,940,568 edges
(9.64%) are boundary edges, used by one triangle instead of two. A ray-parity
inside/outside test needs a closed surface; with holes a ray leaves through one
and the parity flips wrongly. Run that way, the test called road markings at
the dead centre of the building 0% inside. Anything cut on that basis would be
cut arbitrarily, so it is not used.

WHAT IS WELL DEFINED
The shell's SILHOUETTE at any height -- the extent of its surface in X and Z
within a horizontal band. That needs only vertex positions, so holes cannot
corrupt it. This clips every interior vertex to the silhouette of the band it
sits in, which is what "conform to the shell coordinates" can actually mean:
the building's outline matches the shell's outline at every height, and
anything beyond it is cut off.

Above ground, each vertex is clamped to its own band, so the interior follows
the shell as it tapers. Below ground the shell has no opinion -- it starts at
L1 -- so underground geometry is clamped to the shell's widest band instead,
which keeps the basements inside the building's plan without pretending the
shell encloses them.

WHAT THIS DOES TO SHAPES
Clamping is a cut, not a squash: vertices outside the silhouette are brought to
it and vertices inside are untouched. A box overhanging the edge becomes a
smaller box. A post that runs up past where the shell narrows gets tapered
rather than truncated -- worth knowing for the 0.7 m lift cores, which are the
tallest things here.

USAGE
    python3 tools/conform_to_shell.py \
        --in    game/assets/prim3_site0_master.glb \
        --shell game/assets/site0_shell_fitted.glb \
        --out   game/assets/prim3_site0_master.glb

Verifies its own output and refuses to write a file that still protrudes.
Re-running is a no-op.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

SCALE = 273.0
BANDS = 64
INSET = 0.25          # metres held back from the skin, so faces do not z-fight
EPS = 0.05            # metres; below this a protrusion is float noise


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


def positions(js, binc, acc_idx):
    a = js["accessors"][acc_idx]
    bv = js["bufferViews"][a["bufferView"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride") or 12
    for i in range(a["count"]):
        o = base + stride * i
        yield o, *struct.unpack_from("<3f", binc, o)


def build_silhouette(shell: Path):
    js, binc = read_glb(shell)
    nd = [n for n in js["nodes"] if "mesh" in n][0]
    prim = js["meshes"][nd["mesh"]]["primitives"][0]
    a = js["accessors"][prim["attributes"]["POSITION"]]
    t = nd.get("translation", [0, 0, 0])
    s = nd.get("scale", [1, 1, 1])
    ylo = (a["min"][1] * s[1] + t[1]) * SCALE
    yhi = (a["max"][1] * s[1] + t[1]) * SCALE
    band = [[9e9, -9e9, 9e9, -9e9] for _ in range(BANDS)]
    for _, x, y, z in positions(js, binc, prim["attributes"]["POSITION"]):
        wx, wy, wz = (x * s[0] + t[0]) * SCALE, (y * s[1] + t[1]) * SCALE, (z * s[2] + t[2]) * SCALE
        k = min(BANDS - 1, max(0, int((wy - ylo) / (yhi - ylo) * BANDS)))
        b = band[k]
        if wx < b[0]: b[0] = wx
        if wx > b[1]: b[1] = wx
        if wz < b[2]: b[2] = wz
        if wz > b[3]: b[3] = wz
    # fill empty bands from below so a gap never widens the allowance
    last = None
    for k in range(BANDS):
        if band[k][0] > band[k][1]:
            band[k] = list(last) if last else [0, 0, 0, 0]
        else:
            last = band[k]
    widest = max(band, key=lambda b: (b[1] - b[0]) * (b[3] - b[2]))
    return band, ylo, yhi, widest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True, type=Path)
    ap.add_argument("--shell", required=True, type=Path)
    ap.add_argument("--out", dest="dst", required=True, type=Path)
    a = ap.parse_args()

    band, ylo, yhi, widest = build_silhouette(a.shell)
    print(f"silhouette: {BANDS} bands over {ylo:.1f}..{yhi:.1f} m, inset {INSET} m")
    print(f"widest band  x {widest[0]:+.1f}..{widest[1]:+.1f}  z {widest[2]:+.1f}..{widest[3]:+.1f}")

    def limits(wy):
        """the allowed x/z rectangle at world height wy, in metres"""
        b = widest if wy < ylo else band[min(BANDS - 1, max(0, int((wy - ylo) / (yhi - ylo) * BANDS)))]
        return (b[0] + INSET, b[1] - INSET, b[2] + INSET, b[3] - INSET)

    js, binc = read_glb(a.src)
    cut = {}
    for nd in js["nodes"]:
        if "mesh" not in nd:
            continue
        name = str(nd.get("name", ""))
        t = nd.get("translation", [0, 0, 0])
        s = nd.get("scale", [1, 1, 1])
        for prim in js["meshes"][nd["mesh"]]["primitives"]:
            ai = prim["attributes"]["POSITION"]
            lo, hi = [9e9] * 3, [-9e9] * 3
            for off, x, y, z in list(positions(js, binc, ai)):
                wx, wy, wz = (x * s[0] + t[0]) * SCALE, (y * s[1] + t[1]) * SCALE, (z * s[2] + t[2]) * SCALE
                x0, x1, z0, z1 = limits(wy)
                nx, nz = min(max(wx, x0), x1), min(max(wz, z0), z1)
                d = max(abs(nx - wx), abs(nz - wz))
                if d > EPS:
                    cut[name] = max(cut.get(name, 0.0), d)
                # back to local space
                lx = (nx / SCALE - t[0]) / s[0]
                lz = (nz / SCALE - t[2]) / s[2]
                struct.pack_into("<3f", binc, off, lx, y, lz)
                for i, v in enumerate((lx, y, lz)):
                    lo[i] = min(lo[i], v)
                    hi[i] = max(hi[i], v)
            acc = js["accessors"][ai]
            acc["min"] = [round(v, 6) for v in lo]
            acc["max"] = [round(v, 6) for v in hi]

    for name, d in sorted(cut.items(), key=lambda kv: -kv[1]):
        print(f"  cut {d:7.1f} m  {name}")
    print(f"{len(cut)} nodes cut back to the shell's silhouette")

    write_glb(a.dst, js, binc)

    # ---- verify: nothing may protrude any more ----
    vjs, vbin = read_glb(a.dst)
    still = []
    for nd in vjs["nodes"]:
        if "mesh" not in nd:
            continue
        t = nd.get("translation", [0, 0, 0])
        s = nd.get("scale", [1, 1, 1])
        for prim in vjs["meshes"][nd["mesh"]]["primitives"]:
            for _, x, y, z in positions(vjs, vbin, prim["attributes"]["POSITION"]):
                wx, wy, wz = (x * s[0] + t[0]) * SCALE, (y * s[1] + t[1]) * SCALE, (z * s[2] + t[2]) * SCALE
                x0, x1, z0, z1 = limits(wy)
                if wx < x0 - EPS or wx > x1 + EPS or wz < z0 - EPS or wz > z1 + EPS:
                    still.append(str(nd.get("name", "")))
                    break
            if still and still[-1] == str(nd.get("name", "")):
                break
    if still:
        raise SystemExit(f"VERIFY FAILED: {len(set(still))} node(s) still outside: {sorted(set(still))[:6]}")
    print(f"wrote {a.dst} ({a.dst.stat().st_size:,} bytes)")
    print("  verified: every vertex is inside the shell's silhouette at its own height")


if __name__ == "__main__":
    main()
