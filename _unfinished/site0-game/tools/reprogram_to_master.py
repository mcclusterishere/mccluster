#!/usr/bin/env python3
"""Rename the Kimi build's nodes to the repo master's programme.

THE DECISION
------------
Two models of Site 0 existed with different level programmes. The owner
called it on 2026-08-19: **the repo master wins on everything.** The Kimi
build keeps its geometry — it is far better geometry, 183 named meshes
against 120 nodes of massing — and takes the master's names.

So this renames, and only renames. Not one vertex is touched. Run
`square_the_basements.py` first if the footprints still need fixing; this
step is orthogonal to it.

WHERE THE TWO DISAGREED
-----------------------
Above ground they already agree: ground defence on L1, business and
aviation on L2, flight deck on L3, command island on L4. The whole
conflict was underground:

    level   Kimi build                    repo master (wins)
    B1      logistics / blast loading     open tech research
    B2      aircraft / drone hangar       industrial production
    B3      armored vehicle vault         PRIME command & sustainment
    B4      power / water / robotics      deep transit logistics
    B5      hardened utilities            global coordination & resilience

HOW ROOMS WERE MAPPED, and where judgement was used
---------------------------------------------------
Most rooms have an honest counterpart — Kimi's `INTERMODAL TRANSFER HALL`
on B4 is plainly the master's `B4_INTERFACILITY_TRANSFER_HALL`, and its
`PRIME COMMAND` on B3 is `B3_PRIME_COMMAND_CORE`.

Where the master has no counterpart, the room is named **in the master's
own vocabulary for that level** rather than left in the old programme or
invented from nothing. Those are marked `coined: true` in the emitted
mapping so nobody has to guess later which names came from the contract
and which were derived.

Every mapping is written to `site0_node_mapping.json` beside the output.
Nothing here is implicit.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

# ---- the mapping. exact Kimi node name (or prefix) -> master name -------
# `coined` marks a name derived in the master's style because the master
# has no counterpart for that room.
MAP: dict[str, tuple[str, bool]] = {
    # ---------------- B1 : open tech research ----------------
    "ARCH_B1_FLOOR":                   ("B1_OPEN_TECH_RESEARCH_FLOOR", False),
    "ARCH_B1_WALLS":                   ("B1_OPEN_TECH_RESEARCH_ENCLOSURE", True),
    "ARCH_B1_RM_LIBRARY SPINE":        ("B1_CENTRAL_OPEN_TECH_LIBRARY", False),
    "ARCH_B1_RM_ARCHIVES":             ("B1_RESEARCH_WING_0", False),
    "ARCH_B1_RM_ROBOTICS WING":        ("B1_RESEARCH_WING_1", False),
    "ARCH_B1_RM_CLEAN PROTOTYPE":      ("B1_RESEARCH_WING_2", False),
    # ---------------- B2 : industrial production -------------
    "ARCH_B2_FLOOR":                   ("B2_INDUSTRIAL_PRODUCTION_FLOOR", False),
    "ARCH_B2_WALLS":                   ("B2_INDUSTRIAL_PRODUCTION_ENCLOSURE", True),
    "ARCH_B2_RM_HIGH-BAY MANUFACTURING": ("B2_HIGH_BAY_0", False),
    "ARCH_B2_RM_MATERIALS STAGING":    ("B2_HIGH_BAY_1", False),
    "ARCH_B2_RM_MACHINING":            ("B2_HIGH_BAY_2", False),
    "ARCH_B2_RM_VEHICLE ASSEMBLY":     ("B2_HIGH_BAY_3", False),
    # ---------------- B3 : PRIME command & sustainment -------
    "ARCH_B3_FLOOR":                   ("B3_PRIME_COMMAND_SUSTAINMENT_FLOOR", False),
    "ARCH_B3_WALLS":                   ("B3_PRIME_COMMAND_SUSTAINMENT_ENCLOSURE", True),
    "ARCH_B3_RM_PRIME COMMAND":        ("B3_PRIME_COMMAND_CORE", False),
    "ARCH_B3_RM_COMMON / GALLEY":      ("B3_MEDICAL_FOOD_EAST", False),
    "ARCH_B3_RM_PROTOTYPE CUSTODY":    ("B3_ARMORED_VAULT_WEST", False),
    "ARCH_B3_RM_SECURE COMMS":         ("B3_SUSTAINMENT_WEST", False),
    "ARCH_B3_RAMP_W":                  ("B3_R1_ARMORED_RAMP_LANDING", False),
    "ARCH_B3_RAMP_E":                  ("B3_R2_ARMORED_RAMP_LANDING", False),
    "ARCH_B3_WELL_W":                  ("B3_R1_RAMP_WELL", True),
    "ARCH_B3_WELL_E":                  ("B3_R2_RAMP_WELL", True),
    # ---------------- B4 : deep transit logistics ------------
    "ARCH_B4_FLOOR":                   ("B4_DEEP_TRANSIT_LOGISTICS_FLOOR", False),
    "ARCH_B4_WALLS":                   ("B4_DEEP_TRANSIT_LOGISTICS_ENCLOSURE", True),
    "ARCH_B4_RM_INTERMODAL TRANSFER HALL": ("B4_INTERFACILITY_TRANSFER_HALL", False),
    "ARCH_B4_RM_HEAVY TRANSFER TERMINUS":  ("B4_WEST_TUNNEL", False),
    "ARCH_B4_RM_TUNNEL DISPATCH":      ("B4_EAST_TUNNEL", False),
    # ---------------- B5 : global coordination & resilience --
    "ARCH_B5_FLOOR":                   ("B5_GLOBAL_COORDINATION_RESILIENCE_FLOOR", False),
    "ARCH_B5_WALLS":                   ("B5_GLOBAL_COORDINATION_RESILIENCE_ENCLOSURE", True),
    "ARCH_B5_RM_CONTINUITY LEADERSHIP": ("B5_COORDINATION_CORE", False),
    "ARCH_B5_RM_RESIDENT HABITAT":     ("B5_HABITAT_WEST", False),
    "ARCH_B5_RM_HEALTH / MEDICAL":     ("B5_HABITAT_EAST", False),
    "ARCH_B5_RM_AGRICULTURE / FOOD":   ("B5_RESILIENCE_AGRICULTURE", True),
    # ---------------- L1 : ground defence --------------------
    "ARCH_L1_PODIUM_LOW":              ("L1_GROUND_DEFENSE_FLOOR", False),
    "ARCH_L1_PODIUM_UPPER":            ("L1_GROUND_DEFENSE_LINTEL", True),
    "ARCH_L1_ROOM_HR-05":              ("L1_HUMAN_READINESS", False),
    "ARCH_L1_ROOM_SEC-C":              ("L1_DEFENSE_SECURITY", False),
    "ARCH_L1_ROOM_SEC-E":              ("L1_DEFENSE_SECURITY_SOUTH_GATE", True),
    "ARCH_L1_ROOM_GD-01":              ("L1_ASIMOV_ANDROID_READINESS", False),
    "ARCH_L1_ROOM_HR-03":              ("L1_ARMORY_EQUIPMENT_ISSUE", True),
    "ARCH_L1_ROOM_LG-01":              ("L1_LOGISTICS_RECEIVING", False),
    "ARCH_L1_ROOMWALL":                ("L1_ROOM_PARTITION", True),
    "ARCH_L1_ROAD_MARK":               ("L1_THROUGH_ROAD_MARKING", True),
    "ARCH_L1_ROAD":                    ("L1_NORTH_SOUTH_THROUGH_ROAD", False),
    "ARCH_APRON_N":                    ("L1_ROAD_NORTH_GATE", False),
    "ARCH_APRON_S":                    ("L1_ROAD_SOUTH_GATE", False),
    "ARCH_L1_LAMPMAST":                ("L1_ROAD_LAMP_MAST", True),
    # ---------------- L2 : business & aviation ---------------
    "ARCH_L2_FLOOR":                   ("L2_BUSINESS_AVIATION_FLOOR", False),
    "ARCH_L2_RM_RECEPTION":            ("L2_NORTH_BUSINESS_SALES_TRADING", False),
    "ARCH_L2_RM_OFFICES":              ("L2_NORTH_BUSINESS_OFFICES", True),
    "ARCH_L2_RM_ADMIN":                ("L2_NORTH_BUSINESS_ADMIN", True),
    "ARCH_L2_RM_HANGAR SUPPORT":       ("L2_SOUTH_AVIATION_SUPPORT", False),
    "ARCH_L2_RM_AIRCRAFT INSPECTION":  ("L2_SOUTH_AVIATION_INSPECTION", True),
    "ARCH_L2_RM_UAS SUPPORT":          ("L2_BUSINESS_DRONE_LAUNCH_PAD", False),
    "ARCH_L2_RM_PARTS":                ("L2_SOUTH_AVIATION_PARTS", True),
    "ARCH_L2_DIVIDE":                  ("L2_ARMORED_DEMONSTRATION_STAGING_DECK", False),
    "ARCH_L2_GLASSBAND":               ("L2_BUSINESS_RIBBON_GLAZING", True),
    # ---------------- L3 : flight deck -----------------------
    "ARCH_L3_FLIGHTDECK":              ("L3_FLIGHT_DECK", False),
    "ARCH_L3_MARKING":                 ("L3_LAUNCH_TAKEOFF_RUN", False),
    "ARCH_L3_LIFTPAD_V1":              ("L3_V1_HEAVY_TRANSFER_PAD", False),
    "ARCH_L3_LIFTPAD_V2":              ("L3_V2_HEAVY_TRANSFER_PAD", False),
    "ARCH_L3_HELIPAD":                 ("L3_RECOVERY_LANDING_LANE", False),
    "ARCH_L3_PARAPET":                 ("L3_FLIGHT_DECK_PARAPET", True),
    "ARCH_L3_A_PAD":                   ("L3_PRIME_EXTERNAL_LIFT_APRON", False),
    "ARCH_L3_B_PAD":                   ("L3_PRIME_EMERGENCY_MERGE_LANE", False),
    # ---------------- L4 : command island --------------------
    "ARCH_L4_TOWER_BASE":              ("L4_ISLAND_PEDESTAL", False),
    "ARCH_L4_TOWER_MID":               ("L4_EXECUTIVE_FLIGHT_CONTROL_BASE", False),
    "ARCH_L4_CAB":                     ("L4_FLIGHT_CONTROL", False),
    "ARCH_L4_OPS_FLOOR":               ("L4_COMMAND_CENTER", False),
    "ARCH_L4_FLOOR":                   ("L4_ISLAND_PENTHOUSE_FLOOR", True),
    "ARCH_L4_TOWER_GLASS":             ("L4_ISLAND_GLAZING", True),
    "ARCH_L4_ROOF_RING":               ("L4_ISLAND_ROOF_RING", True),
    "ARCH_L4_RADOME":                  ("L4_ISLAND_RADOME", True),
    "ARCH_L4_MAST":                    ("L4_ISLAND_MAST", True),
    # ---------------- cores, lifts, egress -------------------
    "ARCH_CORE_A":                     ("VERTICAL_PASSENGER_CORE_A", False),
    "ARCH_CORE_B":                     ("VERTICAL_PASSENGER_CORE_B", False),
    "ARCH_CORE_C":                     ("VERTICAL_PASSENGER_CORE_C", False),
    "ARCH_CORE_D":                     ("VERTICAL_PASSENGER_CORE_D", False),
    "ARCH_CORE_EW":                    ("FREIGHT_HEAVY_LIFT_CORE_WEST", True),
    "ARCH_CORE_EE":                    ("FREIGHT_HEAVY_LIFT_CORE_EAST", True),
    "ARCH_LIFT_A":                     ("V1_HEAVY_LIFT_PLATFORM_A", True),
    "ARCH_LIFT_B":                     ("V2_HEAVY_LIFT_PLATFORM_B", True),
    "ARCH_LIFT_C":                     ("V1_HEAVY_LIFT_PLATFORM_C", True),
    "ARCH_LIFT_D":                     ("V2_HEAVY_LIFT_PLATFORM_D", True),
    "ARCH_STAIR_EW":                   ("EGRESS_STAIR_WEST", True),
    "ARCH_STAIR_EE":                   ("EGRESS_STAIR_EAST", True),
    # ---------------- shell ----------------------------------
    "ARCH_MAIN_HULL":                  ("SHELL_MAIN_RECTANGLE", False),
    "ARCH_HULL_REVEAL":                ("SHELL_PANEL_REVEAL", True),
    "ARCH_HULL_BULWARK_STRAKE":        ("SHELL_BULWARK_STRAKE", True),
}


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


def master_name(old: str):
    """Longest-prefix match, so ARCH_L3_MARKING | centerline_7 resolves."""
    base = old.split("|")[0].strip()
    if base in MAP:
        return MAP[base]
    best = None
    for k in MAP:
        if base.startswith(k) and (best is None or len(k) > len(best)):
            best = k
    return MAP[best] if best else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True, type=Path)
    ap.add_argument("--out", dest="dst", required=True, type=Path)
    a = ap.parse_args()

    js, binc = read_glb(a.src)
    mapping, unmapped, seen = [], [], {}

    for nd in js["nodes"]:
        old = str(nd.get("name", ""))
        hit = master_name(old)
        if hit is None:
            unmapped.append(old)
            continue
        new, coined = hit
        # keep repeated pieces distinct: _00, _01, ... in original order
        n = seen.get(new, 0)
        seen[new] = n + 1
        final = new if n == 0 else f"{new}_{n:02d}"
        nd["name"] = final
        if "mesh" in nd:
            js["meshes"][nd["mesh"]]["name"] = final
        mapping.append({"kimi": old, "master": final, "coined": coined})

    js.setdefault("asset", {}).setdefault("extras", {})
    js["asset"]["extras"]["programme"] = "repo master v04 (owner's call, 2026-08-19)"
    js["asset"]["extras"]["geometry_from"] = "Kimi build prim3_site0_l1"
    js["asset"]["extras"]["node_mapping"] = "site0_node_mapping.json"

    write_glb(a.dst, js, binc)
    out_map = a.dst.parent / "site0_node_mapping.json"
    coined = sum(1 for m in mapping if m["coined"])
    out_map.write_text(json.dumps({
        "note": "Geometry is the Kimi build's, untouched. Names are the repo "
                "master's programme. 'coined' marks a name derived in the "
                "master's style because the master had no counterpart.",
        "renamed": len(mapping),
        "coined": coined,
        "unmapped": unmapped,
        "mapping": mapping,
    }, indent=1) + "\n")

    print(f"renamed {len(mapping)} nodes ({coined} coined in the master's style)")
    if unmapped:
        print(f"  !! {len(unmapped)} unmapped: {unmapped[:6]}")
    print(f"wrote {a.dst} ({a.dst.stat().st_size} bytes)")
    print(f"wrote {out_map}")

    # ---- verify: no ARCH_ names left, and the level vocabulary is the master's
    vjs, _ = read_glb(a.dst)
    names = [n.get("name", "") for n in vjs["nodes"]]
    left = [n for n in names if n.startswith("ARCH_")]
    if left:
        raise SystemExit(f"VERIFY FAILED: {len(left)} nodes still ARCH_*: {left[:5]}")
    for want in ("B1_OPEN_TECH_RESEARCH_FLOOR", "B2_INDUSTRIAL_PRODUCTION_FLOOR",
                 "B3_PRIME_COMMAND_SUSTAINMENT_FLOOR", "B4_DEEP_TRANSIT_LOGISTICS_FLOOR",
                 "B5_GLOBAL_COORDINATION_RESILIENCE_FLOOR", "L1_GROUND_DEFENSE_FLOOR",
                 "L2_BUSINESS_AVIATION_FLOOR", "L3_FLIGHT_DECK"):
        if want not in names:
            raise SystemExit(f"VERIFY FAILED: master node {want} missing")
    print(f"  verified: {len(names)} nodes, zero ARCH_* left, "
          f"all eight master floor plates present")


if __name__ == "__main__":
    main()
