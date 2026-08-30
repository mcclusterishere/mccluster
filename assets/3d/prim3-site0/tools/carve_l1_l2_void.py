#!/usr/bin/env python3
"""Cut the central void into L1 and L2, and drop the forbidden PRIME spur.

WHY THIS EXISTS
---------------
The v03 interior master is a real, fully named 127-node facility: seven
levels, research wings, high bays, habitats, four stair/lift cores, the
R1/R2 armoured ramps at every level pair and the V1/V2 lift platforms at
every stop. It is good work. Two things were left undone in it, and this
script is both of them.

1. NO FLOOR HAS A VOID. Every one of the eight floor plates — L3, L2, L1,
   B1..B5 — is a plain eight-vertex box. Measured, not assumed:

       L3_FLIGHT_DECK                            1 prim, 8 verts
       L2_BUSINESS_AVIATION_FLOOR                1 prim, 8 verts
       L1_GROUND_DEFENSE_FLOOR                   1 prim, 8 verts
       B1..B5                                    1 prim, 8 verts each

   The contract says L1 and L2 are the only levels with the middle carved
   out, and the whole two-storey heart of the building depends on it. The
   lift platforms travel through a shaft that, geometrically, was solid
   rock. This carves the opening.

2. THE FORBIDDEN SPUR IS STILL IN THE FILE. AGENTS.md, the README and the
   canonical contract all name `L3_PRIME_ELEVATED_DEPARTURE_SPUR` and
   `L3_PRIME_SPUR_SUPPORT_*` as rejected geometry that must not be
   recreated. All seven nodes are present in the master. Removed here.

HOW THE HOLE IS SIZED — and it is measured from the model, not invented
----------------------------------------------------------------------
The V1 and V2 heavy-lift platforms occupy exactly

    x -0.220 .. -0.040   and   x  0.040 .. 0.220,   z -0.110 .. 0.110

at every single stop: B3, B2, B1, L1, L2. Their combined envelope is
therefore x ±0.220, z ±0.110, and that is the hole. It is the footprint
the platforms already need in order to travel at all.

It is checked against the roof above it: the L3 retractable transfer
aperture frames leave an inner opening of x ±0.263, z ±0.133 — slightly
LARGER, which is the correct relationship. What passes through the roof
must fit through the floors below it.

And it is checked against the programme beside it: the four L1 corner
rooms all begin at |x| = 0.220. The void touches them and does not eat
them. Nothing loses its floor.

Nothing falls through the hole, because at each level the lift platform
IS the floor when it is parked there.

USAGE
-----
    python3 assets/3d/prim3-site0/tools/carve_l1_l2_void.py \
        --in  <base v03 glb> \
        --out assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v04.glb

Re-running on its own output is a no-op: a plate already carved is left
alone, so this is safe to run twice.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

# the hole, in model units — see the header for where these come from
HOLE_X = 0.220
HOLE_Z = 0.110

# the only two plates that get it
OPEN_PLATES = ("L1_GROUND_DEFENSE_FLOOR", "L2_BUSINESS_AVIATION_FLOOR")

# rejected geometry named in AGENTS.md and the canonical contract
FORBIDDEN_PREFIXES = ("L3_PRIME_ELEVATED_DEPARTURE_SPUR", "L3_PRIME_SPUR_SUPPORT_")


# ---------------------------------------------------------------- glb io

def read_glb(path: Path):
    d = path.read_bytes()
    magic, ver, _ = struct.unpack("<III", d[:12])
    if magic != 0x46546C67:
        raise SystemExit(f"{path} is not a GLB")
    if ver != 2:
        raise SystemExit(f"{path} is glTF {ver}, expected 2")
    js, binc, off = None, b"", 12
    while off < len(d):
        (clen,) = struct.unpack("<I", d[off : off + 4])
        tag = d[off + 4 : off + 8]
        body = d[off + 8 : off + 8 + clen]
        if tag[:4] == b"JSON":
            js = json.loads(body)
        elif tag[:3] == b"BIN":
            binc = body
        off += 8 + clen
    if js is None:
        raise SystemExit(f"{path} has no JSON chunk")
    return js, bytearray(binc)


def write_glb(path: Path, js: dict, binc: bytearray) -> None:
    while len(binc) % 4:
        binc.append(0)
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    while len(jb) % 4:
        jb += b" "
    total = 12 + 8 + len(jb) + (8 + len(binc) if binc else 0)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb
    if binc:
        out += struct.pack("<II", len(binc), 0x004E4942) + bytes(binc)
    path.write_bytes(out)


def append_view(js: dict, binc: bytearray, payload: bytes) -> int:
    """Append bytes to the BIN chunk and return the new bufferView index."""
    while len(binc) % 4:
        binc.append(0)
    off = len(binc)
    binc += payload
    js["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(payload)})
    js["buffers"][0]["byteLength"] = len(binc)
    return len(js["bufferViews"]) - 1


# ------------------------------------------------------------- geometry

def box_tris(x0, y0, z0, x1, y1, z1):
    """Eight corners and 36 indices for an axis-aligned box."""
    v = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    idx = [
        0, 1, 2, 0, 2, 3,   # -z
        5, 4, 7, 5, 7, 6,   # +z
        4, 0, 3, 4, 3, 7,   # -x
        1, 5, 6, 1, 6, 2,   # +x
        4, 5, 1, 4, 1, 0,   # -y
        3, 2, 6, 3, 6, 7,   # +y
    ]
    return v, idx


def ring(x0, y0, z0, x1, y1, z1, hx, hz):
    """A rectangular plate with a rectangular hole, as four boxes.

    West and east strips run the full depth; north and south strips fill
    only the gap between them, so no two boxes overlap and the ring has no
    doubled interior faces.
    """
    pieces = [
        (x0, -hx, z0, z1),   # west   full depth
        (hx, x1, z0, z1),    # east   full depth
        (-hx, hx, z0, -hz),  # south  between them
        (-hx, hx, hz, z1),   # north  between them
    ]
    verts: list[tuple[float, float, float]] = []
    idx: list[int] = []
    for ax0, ax1, az0, az1 in pieces:
        if ax1 - ax0 <= 1e-9 or az1 - az0 <= 1e-9:
            continue  # a strip the hole swallowed entirely
        v, i = box_tris(ax0, y0, az0, ax1, y1, az1)
        base = len(verts)
        verts += v
        idx += [n + base for n in i]
    return verts, idx


# ------------------------------------------------------------------ run

def carve(js: dict, binc: bytearray) -> list[str]:
    notes: list[str] = []
    by_name = {n.get("name"): n for n in js["nodes"]}

    for plate in OPEN_PLATES:
        node = by_name.get(plate)
        if node is None or "mesh" not in node:
            notes.append(f"  !! {plate}: not found, skipped")
            continue
        mesh = js["meshes"][node["mesh"]]
        if mesh.get("extras", {}).get("shape") == "ring":
            notes.append(f"  == {plate}: already carved, left alone")
            continue

        prim = mesh["primitives"][0]
        pos = js["accessors"][prim["attributes"]["POSITION"]]
        lo, hi = pos["min"], pos["max"]

        # the plate's own vertex colour, so the ring matches the slab
        colour = None
        if "COLOR_0" in prim["attributes"]:
            ca = js["accessors"][prim["attributes"]["COLOR_0"]]
            colour = bytes(int(c) for c in ca["max"][:4])

        verts, idx = ring(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], HOLE_X, HOLE_Z)

        pv = append_view(js, binc, b"".join(struct.pack("<3f", *v) for v in verts))
        js["accessors"].append({
            "bufferView": pv, "byteOffset": 0, "componentType": 5126,
            "type": "VEC3", "count": len(verts),
            "min": [min(v[i] for v in verts) for i in range(3)],
            "max": [max(v[i] for v in verts) for i in range(3)],
        })
        pos_acc = len(js["accessors"]) - 1

        attrs = {"POSITION": pos_acc}
        if colour is not None:
            cv = append_view(js, binc, colour * len(verts))
            js["accessors"].append({
                "bufferView": cv, "byteOffset": 0, "componentType": 5121,
                "normalized": True, "type": "VEC4", "count": len(verts),
                "min": list(colour), "max": list(colour),
            })
            attrs["COLOR_0"] = len(js["accessors"]) - 1

        iv = append_view(js, binc, b"".join(struct.pack("<I", n) for n in idx))
        js["accessors"].append({
            "bufferView": iv, "byteOffset": 0, "componentType": 5125,
            "type": "SCALAR", "count": len(idx),
            "min": [min(idx)], "max": [max(idx)],
        })

        mesh["primitives"] = [{
            "attributes": attrs,
            "indices": len(js["accessors"]) - 1,
            "mode": 4,
        }]
        mesh.setdefault("extras", {})
        mesh["extras"].update({
            "shape": "ring",
            "carved": "central transfer void",
            "hole_extents": [HOLE_X * 2, HOLE_Z * 2],
            "hole_bounds": {"x": [-HOLE_X, HOLE_X], "z": [-HOLE_Z, HOLE_Z]},
            "why": "L1 and L2 are the only levels open to the mobility canyon; "
                   "the hole is the V1/V2 lift platform envelope, which is the "
                   "footprint the platforms already occupy at every stop.",
        })
        notes.append(f"  ++ {plate}: carved {HOLE_X*2:.3f} x {HOLE_Z*2:.3f}, "
                     f"{len(verts)} verts / {len(idx)} indices")
    return notes


def drop_forbidden(js: dict) -> list[str]:
    """Remove the rejected spur nodes and repair every index that moved."""
    kill = {
        i for i, n in enumerate(js["nodes"])
        if str(n.get("name", "")).startswith(FORBIDDEN_PREFIXES)
    }
    if not kill:
        return ["  == no forbidden spur geometry present"]

    names = sorted(js["nodes"][i].get("name", "?") for i in kill)
    keep = [i for i in range(len(js["nodes"])) if i not in kill]
    remap = {old: new for new, old in enumerate(keep)}

    js["nodes"] = [js["nodes"][i] for i in keep]
    for n in js["nodes"]:
        if "children" in n:
            n["children"] = [remap[c] for c in n["children"] if c in remap]
            if not n["children"]:
                del n["children"]
    for sc in js.get("scenes", []):
        sc["nodes"] = [remap[c] for c in sc.get("nodes", []) if c in remap]

    return [f"  -- dropped {len(kill)} forbidden nodes: {', '.join(names)}"]


def verify(path: Path) -> None:
    """Read the result back and assert the contract, or exit non-zero."""
    js, _ = read_glb(path)
    names = [n.get("name", "") for n in js["nodes"]]
    bad = [n for n in names if n.startswith(FORBIDDEN_PREFIXES)]
    if bad:
        raise SystemExit(f"VERIFY FAILED: forbidden geometry survived: {bad}")

    solid = ("L3_FLIGHT_DECK", "B1_OPEN_TECH_RESEARCH_FLOOR",
             "B2_INDUSTRIAL_PRODUCTION_FLOOR", "B3_PRIME_COMMAND_SUSTAINMENT_FLOOR",
             "B4_DEEP_TRANSIT_LOGISTICS_FLOOR",
             "B5_GLOBAL_COORDINATION_RESILIENCE_FLOOR")
    by_name = {n.get("name"): n for n in js["nodes"]}

    for plate in OPEN_PLATES:
        m = js["meshes"][by_name[plate]["mesh"]]
        if m.get("extras", {}).get("shape") != "ring":
            raise SystemExit(f"VERIFY FAILED: {plate} is not carved")
        n = js["accessors"][m["primitives"][0]["attributes"]["POSITION"]]["count"]
        if n < 24:
            raise SystemExit(f"VERIFY FAILED: {plate} has only {n} verts")

    for plate in solid:
        node = by_name.get(plate)
        if node is None:
            continue
        m = js["meshes"][node["mesh"]]
        if m.get("extras", {}).get("shape") == "ring":
            raise SystemExit(f"VERIFY FAILED: {plate} must stay a solid plate")

    print(f"  verified: {len(names)} nodes, L1+L2 carved, "
          f"{len(solid)} plates still solid, no forbidden geometry")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True, type=Path)
    ap.add_argument("--out", dest="dst", required=True, type=Path)
    a = ap.parse_args()

    js, binc = read_glb(a.src)
    print(f"read {a.src.name}: {len(js['nodes'])} nodes, {len(binc)} bin bytes")
    for line in carve(js, binc):
        print(line)
    for line in drop_forbidden(js):
        print(line)

    js.setdefault("asset", {}).setdefault("extras", {})
    js["asset"]["extras"]["floor_plate_rule"] = (
        "Only L1 and L2 have the middle carved out. B1-B5 and L3 are "
        "continuous plates penetrated only by named shafts."
    )

    write_glb(a.dst, js, binc)
    print(f"wrote {a.dst} ({a.dst.stat().st_size} bytes)")
    verify(a.dst)


if __name__ == "__main__":
    main()
