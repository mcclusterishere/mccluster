#!/usr/bin/env python3
"""Place the perfect exterior shell around the interior, and prove it fits.

WHY THE SHELL MOVES AND THE INTERIOR DOES NOT
---------------------------------------------
The obvious way round is to transform the interior into the shell. That is
the wrong way, for two reasons:

1. The owner's instruction was *keep the geometry*. Moving 183 meshes to
   suit a skin is not keeping it.
2. `game/index.html` hard-codes lift shafts, level heights and waypoints in
   MODEL coordinates:

       SHAFTS  A:{x:-0.065*SCALE, z:0.27*SCALE, ...}
       PTS     gate:(0,-0.28*SCALE)  fork:(0,0.255*SCALE)  ...

   Translate the geometry and every one of those silently points at empty
   air — lifts that open onto nothing, objectives in the wrong room. The
   game would still run and would be quietly broken, which is worse than
   not running.

So the shell is fitted to the interior. The interior is the datum.

THE MEASUREMENT
---------------
Building envelope, meaning every above-ground node EXCEPT the north and
south aprons — an apron is outdoor pavement and belongs outside the
building by definition:

    axis   shell centre   size      building centre   size      fill
    X       +0.0000      0.9562      +0.0000        0.9590     100.3%
    Y       +0.2360      0.4720      (above ground) 0.4416      93.6%
    Z       +0.0000      0.9832      +0.0448        0.8958      91.1%

Two things follow. The building sits 0.0448 north of the shell's centre,
so the shell is translated +0.0448 in Z to sit around it. And X fills
100.3% — 0.0028 model units over, which at the game's SCALE=273 is 0.77 m
on a 261 m facade. The shell is scaled by 1.004 in X and Z so the building
is inside it rather than flush with it, which also buys a little wall
thickness rather than co-planar faces that would z-fight.

Y is left alone: the shell already stands on y=0 and is taller than the
above-ground interior. The basements are below y=0 and are outside the
shell on purpose — a shell is the part of the building you can see.

USAGE
-----
    python3 tools/fit_shell_to_interior.py \
        --interior game/assets/prim3_site0_master.glb \
        --shell    <path to PRIM3+site+zero+perfect+model.glb> \
        --out      game/assets/site0_shell_fitted.glb \
        --manifest game/assets/site0_shell_fit.json

Writes the shell with the fit transform baked into its node (geometry
untouched — a transform, not a rewrite), plus a manifest recording the
numbers. Verifies containment and exits non-zero if anything above ground
still pokes out.

THE SHELL IS NOT LOADED BY THE GAME BY DEFAULT. It is one mesh of
1,024,579 vertices, 47 MB. Downloading that to stand inside it — where it
is a solid skin you would see only the back of — costs the player
everything and shows them nothing. `game/index.html` takes `?shell=1` to
load it when you want an exterior look.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

APRONS = ("L1_ROAD_NORTH_GATE", "L1_ROAD_SOUTH_GATE", "ARCH_APRON_N", "ARCH_APRON_S")
CLEARANCE = 1.004      # so the building sits inside the skin, not flush with it


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


def envelope(js, *, skip_underground=True, skip=()):
    lo, hi = [9e9] * 3, [-9e9] * 3
    for nd in js["nodes"]:
        if "mesh" not in nd:
            continue
        nm = str(nd.get("name", ""))
        if any(s in nm for s in skip):
            continue
        a, b = node_box(js, nd)
        if skip_underground and b[1] < -0.001:
            continue
        for i in range(3):
            lo[i] = min(lo[i], a[i])
            hi[i] = max(hi[i], b[i])
    return lo, hi


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interior", required=True, type=Path)
    ap.add_argument("--shell", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--manifest", required=True, type=Path)
    a = ap.parse_args()

    ijs, _ = read_glb(a.interior)
    sjs, sbin = read_glb(a.shell)

    blo, bhi = envelope(ijs, skip=APRONS)                 # the building
    alo, ahi = envelope(ijs)                              # building + aprons
    snode = sjs["nodes"][0]
    slo, shi = node_box(sjs, snode)

    print(f"shell     x {slo[0]:+.4f}..{shi[0]:+.4f}  y {slo[1]:+.4f}..{shi[1]:+.4f}  z {slo[2]:+.4f}..{shi[2]:+.4f}")
    print(f"building  x {blo[0]:+.4f}..{bhi[0]:+.4f}  y {blo[1]:+.4f}..{bhi[1]:+.4f}  z {blo[2]:+.4f}..{bhi[2]:+.4f}")

    # scale about the shell's own centre in X/Z, then translate so the
    # shell's centre lands on the building's centre. Y untouched.
    sc = [(slo[i] + shi[i]) / 2 for i in range(3)]
    bc = [(blo[i] + bhi[i]) / 2 for i in range(3)]

    base_t = snode.get("translation", [0, 0, 0])
    base_s = snode.get("scale", [1, 1, 1])
    new_s = [base_s[0] * CLEARANCE, base_s[1], base_s[2] * CLEARANCE]
    # after scaling about the origin the centre moves to sc*CLEARANCE, so
    # correct for that as well as for the offset to the building centre
    new_t = [
        base_t[0] + (bc[0] - sc[0] * CLEARANCE),
        base_t[1],
        base_t[2] + (bc[2] - sc[2] * CLEARANCE),
    ]
    snode["translation"] = [round(v, 6) for v in new_t]
    snode["scale"] = [round(v, 6) for v in new_s]
    snode["name"] = "SHELL_EXTERIOR_PERFECT"
    sjs["meshes"][snode["mesh"]]["name"] = "SHELL_EXTERIOR_PERFECT"
    sjs.setdefault("asset", {}).setdefault("extras", {})
    sjs["asset"]["extras"]["fitted_to"] = a.interior.name
    sjs["asset"]["extras"]["note"] = ("Transform only — not one vertex moved. "
                                      "The interior is the datum; the shell is fitted to it.")

    write_glb(a.out, sjs, sbin)
    nlo, nhi = node_box(sjs, snode)
    print(f"fitted    x {nlo[0]:+.4f}..{nhi[0]:+.4f}  y {nlo[1]:+.4f}..{nhi[1]:+.4f}  z {nlo[2]:+.4f}..{nhi[2]:+.4f}")

    # ---- verify containment of every above-ground node -----------------
    bad = []
    for nd in ijs["nodes"]:
        if "mesh" not in nd:
            continue
        nm = str(nd.get("name", ""))
        if any(s in nm for s in APRONS):
            continue
        lo, hi = node_box(ijs, nd)
        if hi[1] < -0.001:
            continue
        if (lo[0] < nlo[0] - 1e-4 or hi[0] > nhi[0] + 1e-4
                or lo[2] < nlo[2] - 1e-4 or hi[2] > nhi[2] + 1e-4
                or hi[1] > nhi[1] + 1e-4):
            bad.append(nm)
    if bad:
        raise SystemExit(f"VERIFY FAILED: {len(bad)} above-ground nodes outside the shell: {bad[:6]}")

    manifest = {
        "schema": "prim3.site0.shell-fit.v1",
        "interior": a.interior.name,
        "shell": a.out.name,
        "shell_source": a.shell.name,
        "decision": "The interior is the datum. The shell is fitted to it, because "
                    "game/index.html hard-codes lift shafts and waypoints in model "
                    "coordinates and moving the geometry would silently desync them.",
        "transform": {"translation": snode["translation"], "scale": snode["scale"],
                      "clearance": CLEARANCE, "y": "untouched"},
        "building_envelope": {"min": [round(v, 6) for v in blo], "max": [round(v, 6) for v in bhi]},
        "with_aprons": {"min": [round(v, 6) for v in alo], "max": [round(v, 6) for v in ahi],
                        "note": "aprons are outdoor pavement and sit outside the shell by design"},
        "fitted_shell": {"min": [round(v, 6) for v in nlo], "max": [round(v, 6) for v in nhi]},
        "verified": "every above-ground node except the aprons is inside the fitted shell",
        "not_loaded_by_default": "1,024,579 verts / 47 MB; game/index.html takes ?shell=1",
    }
    a.manifest.write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"wrote {a.out} ({a.out.stat().st_size} bytes)")
    print(f"wrote {a.manifest}")
    print("  verified: the whole building is inside the perfect shell")


if __name__ == "__main__":
    main()
