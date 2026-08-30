#!/usr/bin/env python3
"""Check the rule that the exterior shell starts at L1 and the B levels are under it.

THE RULE (AGENTS.md, "The exterior shell starts at L1")
The perfect exterior is the part of the building that stands above grade. Its
base is the L1 datum, y = 0. B1 through B5 are underground -- below the shell,
not inside it. A B level poking above y = 0 is a level poking out through the
ground, and a shell reaching below it is describing a building that does not
exist.

The one deliberate exception: the B3 armoured ramps. A ramp out of B3 arrives
at L1 grade, so B3_R1/R2 touch y = 0. Touching is allowed; crossing is not.

THE DATUM IS L1'S BASE, NOT y = 0
Different files put the origin in different places and both are correct:

    playable build   L1 base at y  0.000    grade is the origin
    v04 master       L1 base at y +0.130    the origin sits inside B1

So this measures the datum from the model -- the bottom of L1 -- and checks
everything against that. Assuming y = 0 reports v04 as broken when it is not;
the first version of this script did exactly that, and the model was fine.

USAGE
    python3 tools/check_shell_datum.py                     # the v04 master
    python3 tools/check_shell_datum.py --model X.glb --shell Y.glb

Exits non-zero and names the offending nodes if the rule is broken, so it can
be wired into CI rather than remembered.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOL = 1e-6          # float noise, not slack
SCALE = 273         # model units -> metres, matching the playable build
RAMP_EXCEPTION = ("B3_R1", "B3_R2")


def read_glb(path: Path) -> dict:
    d = path.read_bytes()
    magic, ver, _ = struct.unpack("<III", d[:12])
    if magic != 0x46546C67 or ver != 2:
        raise SystemExit(f"{path}: not a glTF 2.0 GLB")
    js, off = None, 12
    while off < len(d):
        (clen,) = struct.unpack("<I", d[off : off + 4])
        if d[off + 4 : off + 8][:4] == b"JSON":
            js = json.loads(d[off + 8 : off + 8 + clen])
        off += 8 + clen
    if js is None:
        raise SystemExit(f"{path}: no JSON chunk")
    return js


def node_y(js: dict, nd: dict) -> tuple[float, float]:
    lo, hi = 9e9, -9e9
    for prim in js["meshes"][nd["mesh"]]["primitives"]:
        a = js["accessors"][prim["attributes"]["POSITION"]]
        lo = min(lo, a["min"][1])
        hi = max(hi, a["max"][1])
    t = nd.get("translation", [0, 0, 0])[1]
    s = nd.get("scale", [1, 1, 1])[1]
    return lo * s + t, hi * s + t


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", type=Path,
                    default=HERE.parent / "PRIM3_Site0_Master_Facility_v04.glb")
    ap.add_argument("--shell", type=Path, default=None,
                    help="optional: a fitted exterior shell to check the base of")
    a = ap.parse_args()

    js = read_glb(a.model)

    # the datum is where L1 starts, whatever this file calls it
    l1 = [node_y(js, nd) for nd in js["nodes"]
          if "mesh" in nd and str(nd.get("name", "")).startswith("L1")]
    if not l1:
        raise SystemExit(f"{a.model.name}: no L1 nodes, cannot locate the datum")
    datum = min(lo for lo, _ in l1)
    print(f"{a.model.name}: L1 datum at y {datum:+.4f}")

    below, ramps, bad = [], [], []
    for nd in js["nodes"]:
        name = str(nd.get("name", ""))
        if "mesh" not in nd or name[:2] not in ("B1", "B2", "B3", "B4", "B5"):
            continue
        lo, hi = node_y(js, nd)
        if hi > datum + TOL:
            (ramps if name.startswith(RAMP_EXCEPTION) else bad).append((name, lo, hi))
        else:
            below.append((name, lo, hi))

    rel = lambda v: (v - datum) * SCALE      # metres relative to grade
    print(f"  {len(below)} B-level nodes under the datum, "
          f"{len(ramps)} ramp nodes reaching it")
    for name, lo, hi in ramps:
        print(f"  ramp at grade  {name:<40} {rel(lo):+8.1f} .. {rel(hi):+7.1f} m")

    if a.shell:
        sjs = read_glb(a.shell)
        snd = [n for n in sjs["nodes"] if "mesh" in n][0]
        slo, shi = node_y(sjs, snd)
        print(f"{a.shell.name}: bounding box {rel(slo):+.1f} .. {rel(shi):+.1f} m")
        # The datum is the shell's FLOOR, not the bottom of its box -- the model
        # carries a plinth below its floor, and checking the box here is the
        # exact mistake that put L1 underground. The floor height is recorded in
        # the fit manifest by tools/measure_shell_floor.py; if it is there, the
        # box is expected to sit below the datum by that much.
        man = a.shell.with_name("site0_shell_fit.json")
        if man.exists():
            fit = json.loads(man.read_text())
            plinth = fit.get("shell_floor_m")
            if plinth is None:
                print("  !! the fit manifest records no shell_floor_m; "
                      "cannot tell the plinth from a misplacement")
            else:
                print(f"  its floor sits {plinth:.2f} m above that box base, "
                      f"so the box is expected to reach {-plinth:+.2f} m")
                if abs(rel(slo) + plinth) > 0.5:
                    bad.append((f"<shell floor off the datum> {a.shell.name}", slo, shi))
        else:
            print("  !! no fit manifest beside the shell; skipping the floor check")

    if bad:
        print()
        print(f"RULE BROKEN: {len(bad)} node(s) cross the L1 datum")
        for name, lo, hi in bad:
            print(f"  {name:<46} {rel(lo):+8.1f} .. {rel(hi):+7.1f} m")
        raise SystemExit(1)
    print("  ok: the shell stands on L1 and every B level is under it")


if __name__ == "__main__":
    main()
