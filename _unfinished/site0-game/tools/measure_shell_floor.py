#!/usr/bin/env python3
"""Find the height of the perfect shell's OWN floor, so L1 can be put on it.

WHY THIS EXISTS
The first fit aligned the shell's bounding-box base with the L1 datum. That was
wrong, and walking it showed why: the Tripo model has a plinth below its own
floor, so aligning bounding boxes buried L1 inside it. Measured over the
building footprint, the shell's internal floor sits at a median 2.58 m while L1
sat at 0 -- which put the player's eye, at 1.86 m, UNDER the shell's floor.
Level 1 was underground.

The datum is the shell's FLOOR, not the bottom of its bounding box.

HOW IT MEASURES
Sample a grid of columns over the footprint. At each column, collect every
height at which the shell's surface crosses. The lowest crossing is its floor
and the highest is its deck; the medians of those are the numbers to fit
against. Medians rather than extremes because a photogrammetric surface is
uneven and a single low triangle should not move a building.

    python3 tools/measure_shell_floor.py --shell game/assets/site0_shell_fitted.glb
"""
from __future__ import annotations

import argparse
import array
import json
import statistics
import struct
from collections import defaultdict
from pathlib import Path

SCALE = 273


def read(path: Path):
    d = path.read_bytes()
    off, js, binc = 12, None, b""
    while off < len(d):
        (clen,) = struct.unpack("<I", d[off : off + 4])
        tag = d[off + 4 : off + 8]
        if tag[:4] == b"JSON":
            js = json.loads(d[off + 8 : off + 8 + clen])
        elif tag[:3] == b"BIN":
            binc = d[off + 8 : off + 8 + clen]
        off += 8 + clen
    return js, binc


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shell", required=True, type=Path)
    ap.add_argument("--grid", type=int, default=17, help="sample columns per axis")
    a = ap.parse_args()

    js, binc = read(a.shell)
    nd = [n for n in js["nodes"] if "mesh" in n][0]
    prim = js["meshes"][nd["mesh"]]["primitives"][0]
    pa, ia = js["accessors"][prim["attributes"]["POSITION"]], js["accessors"][prim["indices"]]
    pbv, ibv = js["bufferViews"][pa["bufferView"]], js["bufferViews"][ia["bufferView"]]
    if (pbv.get("byteStride") or 12) != 12:
        raise SystemExit("interleaved positions are not handled; run on the uncompressed fit")
    P = array.array("f")
    P.frombytes(binc[pbv.get("byteOffset", 0) + pa.get("byteOffset", 0) :][: pa["count"] * 12])
    I = array.array("I")
    I.frombytes(binc[ibv.get("byteOffset", 0) + ia.get("byteOffset", 0) :][: ia["count"] * 4])

    t = nd.get("translation", [0, 0, 0])
    s = nd.get("scale", [1, 1, 1])
    fx = lambda v: (v * s[0] + t[0]) * SCALE
    fy = lambda v: (v * s[1] + t[1]) * SCALE
    fz = lambda v: (v * s[2] + t[2]) * SCALE

    xs = [fx(P[i * 3]) for i in range(0, pa["count"], 97)]
    zs = [fz(P[i * 3 + 2]) for i in range(0, pa["count"], 97)]
    xlo, xhi, zlo, zhi = min(xs), max(xs), min(zs), max(zs)

    G = 48
    grid = defaultdict(list)
    for k in range(0, len(I), 3):
        a0, b0, c0 = I[k] * 3, I[k + 1] * 3, I[k + 2] * 3
        ax, az = fx(P[a0]), fz(P[a0 + 2])
        bx, bz = fx(P[b0]), fz(P[b0 + 2])
        cx, cz = fx(P[c0]), fz(P[c0 + 2])
        i0 = max(0, min(G - 1, int((min(ax, bx, cx) - xlo) / (xhi - xlo) * G)))
        i1 = max(0, min(G - 1, int((max(ax, bx, cx) - xlo) / (xhi - xlo) * G)))
        j0 = max(0, min(G - 1, int((min(az, bz, cz) - zlo) / (zhi - zlo) * G)))
        j1 = max(0, min(G - 1, int((max(az, bz, cz) - zlo) / (zhi - zlo) * G)))
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                grid[(i, j)].append(k)

    def stack(px, pz):
        i = max(0, min(G - 1, int((px - xlo) / (xhi - xlo) * G)))
        j = max(0, min(G - 1, int((pz - zlo) / (zhi - zlo) * G)))
        out = []
        for k in grid.get((i, j), ()):
            a0, b0, c0 = I[k] * 3, I[k + 1] * 3, I[k + 2] * 3
            ax, ay, az = fx(P[a0]), fy(P[a0 + 1]), fz(P[a0 + 2])
            bx, by, bz = fx(P[b0]), fy(P[b0 + 1]), fz(P[b0 + 2])
            cx, cy, cz = fx(P[c0]), fy(P[c0 + 1]), fz(P[c0 + 2])
            den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
            if abs(den) < 1e-9:
                continue
            w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den
            w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den
            w3 = 1 - w1 - w2
            if w1 < -1e-9 or w2 < -1e-9 or w3 < -1e-9:
                continue
            out.append(w1 * ay + w2 * by + w3 * cy)
        return sorted(out)

    # sample the middle of the footprint, where the building actually sits
    floors, decks = [], []
    N = a.grid
    for i in range(N):
        for j in range(N):
            px = xlo * 0.85 + (xhi - xlo) * 0.85 * i / (N - 1)
            pz = zlo * 0.6 + (zhi * 0.6 - zlo * 0.6) * j / (N - 1)
            st = stack(px, pz)
            if len(st) >= 2:
                floors.append(st[0])
                decks.append(st[-1])

    if not floors:
        raise SystemExit("no interior columns found; is this the right mesh?")
    mf, md = statistics.median(floors), statistics.median(decks)
    print(f"{a.shell.name}: {len(floors)} interior columns sampled")
    print(f"  shell floor  median {mf:6.2f} m   (p25 {sorted(floors)[len(floors)//4]:.2f}, "
          f"p75 {sorted(floors)[3*len(floors)//4]:.2f})")
    print(f"  shell deck   median {md:6.2f} m")
    print(f"  clear height        {md-mf:6.2f} m")
    print()
    print(f"  to put L1's floor on the shell's floor, lower the shell by {mf:.2f} m")
    print(f"  translation.y delta = {-mf/SCALE:+.6f} model units")


if __name__ == "__main__":
    main()
