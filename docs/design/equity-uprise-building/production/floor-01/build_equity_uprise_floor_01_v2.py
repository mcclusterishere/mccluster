#!/usr/bin/env python3
"""Equity Uprise Floor 1 hybrid volumetric GLB builder.

Design target:
V1 interior quality + fully assembled building stacking behavior + Core V2 truth.

This is a deterministic visualization / simulation asset and NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
import trimesh

FT = 0.3048
HERE = Path(__file__).resolve().parent
OUTDIR = HERE.parent / "generated"
OUTDIR.mkdir(exist_ok=True)
OUT = OUTDIR / "equity-uprise-floor-01-core-v2.glb"
REPORT = OUTDIR / "equity-uprise-floor-01-core-v2-report.json"
INVENTORY_PATH = HERE / "floor-01-object-inventory.json"

W = D = 72.0
H = 11.0
PASS = (54.0, 34.0, 62.0, 44.0)
FREIGHT = (0.0, 60.0, 8.0, 72.0)
SB = (8.0, 54.0, 18.0, 72.0)
SA = (60.0, 54.0, 72.0, 72.0)
MEP = (50.0, 66.0, 60.0, 72.0)

C = {
    "floor": [86, 89, 91, 255],
    "floor_alt": [105, 108, 110, 255],
    "wall": [43, 42, 41, 255],
    "part": [58, 57, 55, 255],
    "core": [48, 51, 56, 255],
    "freight": [69, 72, 76, 255],
    "stair": [103, 102, 98, 255],
    "stone": [52, 53, 54, 255],
    "stone_top": [70, 71, 72, 255],
    "glass": [196, 220, 228, 92],
    "wood": [108, 82, 60, 255],
    "wood_light": [128, 96, 68, 255],
    "seat": [71, 69, 68, 255],
    "seat_alt": [82, 79, 77, 255],
    "red": [133, 26, 29, 255],
    "screen": [22, 29, 34, 255],
    "screen_glow": [43, 68, 78, 255],
    "light": [224, 211, 181, 255],
    "light_warm": [242, 203, 146, 255],
    "plant": [74, 91, 72, 255],
    "plant_light": [92, 111, 82, 255],
    "rug": [58, 56, 55, 255],
    "white": [220, 220, 215, 255],
    "safety": [156, 40, 43, 255],
    "black": [24, 25, 26, 255],
}

PBR = {
    "floor": ("floor_honed_gray", 0.02, 0.46, None),
    "floor_alt": ("floor_honed_gray_alt", 0.02, 0.52, None),
    "wall": ("wall_charcoal_mineral", 0.00, 0.86, None),
    "part": ("partition_charcoal", 0.00, 0.78, None),
    "core": ("metal_gunmetal_brushed", 0.72, 0.36, None),
    "freight": ("metal_service_gunmetal", 0.62, 0.42, None),
    "stair": ("metal_stair", 0.48, 0.46, None),
    "stone": ("reception_stone_dark", 0.01, 0.56, None),
    "stone_top": ("stone_honed_top", 0.01, 0.42, None),
    "glass": ("glass_clear_arch", 0.00, 0.08, None),
    "wood": ("wood_warm_muted", 0.00, 0.58, None),
    "wood_light": ("wood_warm_light", 0.00, 0.52, None),
    "seat": ("upholstery_charcoal", 0.00, 0.92, None),
    "seat_alt": ("upholstery_charcoal_alt", 0.00, 0.88, None),
    "red": ("accent_red_navigation", 0.04, 0.50, [0.18, 0.01, 0.015]),
    "screen": ("screen_dark", 0.06, 0.20, [0.025, 0.045, 0.055]),
    "screen_glow": ("screen_active", 0.04, 0.18, [0.10, 0.22, 0.28]),
    "light": ("light_warm_diffuser", 0.00, 0.34, [0.72, 0.56, 0.34]),
    "light_warm": ("light_warm_emissive", 0.00, 0.28, [1.0, 0.62, 0.28]),
    "plant": ("plant_dark", 0.00, 0.94, None),
    "plant_light": ("plant_light", 0.00, 0.90, None),
    "rug": ("rug_charcoal", 0.00, 0.98, None),
    "white": ("paint_warm_white", 0.00, 0.78, None),
    "safety": ("safety_red", 0.04, 0.54, None),
    "black": ("black_matte", 0.08, 0.72, None),
}
_COLOR_PROFILE = {tuple(C[key]): (key, *PBR[key]) for key in PBR}
_MATERIAL_CACHE = {}


def pbr_visual(mesh, color):
    rgba = [int(v) for v in (color or C["part"])]
    profile = _COLOR_PROFILE.get(tuple(rgba), ("part", "partition_charcoal", 0.0, 0.78, None))
    key, name, metallic, roughness, emissive = profile
    cache_key = (key, tuple(rgba))
    material = _MATERIAL_CACHE.get(cache_key)
    if material is None:
        alpha = rgba[3] if len(rgba) > 3 else 255
        material = trimesh.visual.material.PBRMaterial(
            name=name,
            baseColorFactor=np.asarray(rgba, dtype=np.uint8),
            metallicFactor=float(metallic),
            roughnessFactor=float(roughness),
            emissiveFactor=emissive,
            alphaMode="BLEND" if alpha < 255 else "OPAQUE",
            doubleSided=alpha < 255,
        )
        _MATERIAL_CACHE[cache_key] = material
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=np.zeros((len(mesh.vertices), 2), dtype=float),
        material=material,
    )
    return mesh

inventory = json.loads(INVENTORY_PATH.read_text())
INV = {o["id"]: o for o in inventory["objects"]}
scene = trimesh.Scene()
records = []
modelled_inventory_ids = set()


def mark(inv_id):
    if inv_id:
        if inv_id not in INV:
            raise KeyError(f"Unknown Floor 1 inventory id: {inv_id}")
        modelled_inventory_ids.add(inv_id)


def box(name, bounds, height, z=0, color=None, inv_id=None):
    x1, y1, x2, y2 = map(float, bounds)
    mesh = trimesh.creation.box(
        extents=((x2 - x1) * FT, (y2 - y1) * FT, height * FT)
    )
    mesh.apply_translation(
        (((x1 + x2) / 2) * FT, ((y1 + y2) / 2) * FT, (z + height / 2) * FT)
    )
    pbr_visual(mesh, color or C["part"])
    scene.add_geometry(mesh, node_name=name, geom_name=name)
    records.append(name)
    mark(inv_id)
    return mesh


def cyl(name, xy, radius, height, z=0, color=None, inv_id=None, sections=32):
    mesh = trimesh.creation.cylinder(
        radius=radius * FT, height=height * FT, sections=sections
    )
    mesh.apply_translation((xy[0] * FT, xy[1] * FT, (z + height / 2) * FT))
    mesh.visual.face_colors = color or C["part"]
    scene.add_geometry(mesh, node_name=name, geom_name=name)
    records.append(name)
    mark(inv_id)
    return mesh


def wh(name, x1, x2, y, t, h, gaps=None, color=None, z=0):
    cur = x1
    for i, (a, b) in enumerate(sorted(gaps or []) + [(x2, x2)]):
        if a > cur:
            box(f"{name}_{i+1}", (cur, y - t / 2, a, y + t / 2), h, z, color)
        cur = max(cur, b)


def wv(name, x, y1, y2, t, h, gaps=None, color=None, z=0):
    cur = y1
    for i, (a, b) in enumerate(sorted(gaps or []) + [(y2, y2)]):
        if a > cur:
            box(f"{name}_{i+1}", (x - t / 2, cur, x + t / 2, a), h, z, color)
        cur = max(cur, b)


def ibounds(inv_id):
    b = INV[inv_id]["placement"]["bounds_ft"]
    return (b["x1"], b["y1"], b["x2"], b["y2"])


def icenter(inv_id):
    p = INV[inv_id]["placement"]["center_ft"]
    return (p["x"], p["y"])


def table(inv_id, bounds, top_h=0.22, top_z=2.45, color=None):
    x1, y1, x2, y2 = bounds
    color = color or C["wood"]
    box(f"{inv_id}::top", bounds, top_h, top_z, color, inv_id)
    inset = 0.35
    leg = 0.24
    for i, (x, y) in enumerate(
        [
            (x1 + inset, y1 + inset),
            (x2 - inset, y1 + inset),
            (x1 + inset, y2 - inset),
            (x2 - inset, y2 - inset),
        ],
        1,
    ):
        box(
            f"{inv_id}::leg-{i}",
            (x - leg / 2, y - leg / 2, x + leg / 2, y + leg / 2),
            top_z,
            0,
            C["core"],
            inv_id,
        )


def chair(inv_id, x, y, orientation=0, task=False):
    seat_w = 1.65 if task else 1.8
    seat_d = 1.55 if task else 1.8
    box(
        f"{inv_id}::seat",
        (x - seat_w / 2, y - seat_d / 2, x + seat_w / 2, y + seat_d / 2),
        0.35,
        1.45,
        C["seat"],
        inv_id,
    )
    if orientation in (0, 180):
        yy = y + seat_d / 2 - 0.12 if orientation == 0 else y - seat_d / 2 + 0.12
        box(
            f"{inv_id}::back",
            (x - seat_w / 2, yy - 0.12, x + seat_w / 2, yy + 0.12),
            1.75 if task else 1.9,
            1.72,
            C["seat_alt"],
            inv_id,
        )
    else:
        xx = x + seat_w / 2 - 0.12 if orientation == 90 else x - seat_w / 2 + 0.12
        box(
            f"{inv_id}::back",
            (xx - 0.12, y - seat_d / 2, xx + 0.12, y + seat_d / 2),
            1.75 if task else 1.9,
            1.72,
            C["seat_alt"],
            inv_id,
        )
    if task:
        cyl(f"{inv_id}::pedestal", (x, y), 0.16, 1.4, 0, C["core"], inv_id, 16)
        cyl(f"{inv_id}::base", (x, y), 0.65, 0.08, 0.05, C["core"], inv_id, 24)
    else:
        for i, (lx, ly) in enumerate(
            [(x - 0.62, y - 0.62), (x + 0.62, y - 0.62), (x - 0.62, y + 0.62), (x + 0.62, y + 0.62)],
            1,
        ):
            box(
                f"{inv_id}::leg-{i}",
                (lx - 0.08, ly - 0.08, lx + 0.08, ly + 0.08),
                1.45,
                0,
                C["core"],
                inv_id,
            )


def sofa(inv_id, bounds):
    x1, y1, x2, y2 = bounds
    box(f"{inv_id}::plinth", (x1 + 0.15, y1 + 0.15, x2 - 0.15, y2 - 0.15), 0.35, 0.25, C["black"], inv_id)
    box(f"{inv_id}::seat", (x1 + 0.35, y1 + 0.35, x2 - 0.35, y2 - 0.35), 0.55, 1.05, C["seat"], inv_id)
    box(f"{inv_id}::back", (x1 + 0.25, y2 - 0.42, x2 - 0.25, y2 - 0.18), 2.15, 1.45, C["seat_alt"], inv_id)
    box(f"{inv_id}::arm-west", (x1 + 0.12, y1 + 0.2, x1 + 0.48, y2 - 0.15), 1.55, 0.72, C["seat"], inv_id)
    box(f"{inv_id}::arm-east", (x2 - 0.48, y1 + 0.2, x2 - 0.12, y2 - 0.15), 1.55, 0.72, C["seat"], inv_id)
    # three loose seat cushions
    width = (x2 - x1 - 1.0) / 3
    for i in range(3):
        xa = x1 + 0.5 + i * width
        box(f"{inv_id}::cushion-{i+1}", (xa, y1 + 0.45, xa + width - 0.12, y2 - 0.55), 0.18, 1.58, C["seat_alt"], inv_id)


def round_table(inv_id, center, diameter, height):
    x, y = center
    cyl(f"{inv_id}::top", (x, y), diameter / 2, 0.18, height - 0.18, C["wood_light"], inv_id)
    cyl(f"{inv_id}::stem", (x, y), 0.22, height - 0.28, 0.1, C["core"], inv_id, 24)
    cyl(f"{inv_id}::base", (x, y), 0.7, 0.12, 0, C["core"], inv_id, 32)


def plant(inv_id, center, diameter):
    x, y = center
    cyl(f"{inv_id}::pot", (x, y), diameter / 2, 1.35, 0, C["stone"], inv_id, 32)
    for i, (dx, dy, r, h) in enumerate(
        [(-0.35, 0.0, 0.58, 1.8), (0.25, 0.15, 0.52, 2.1), (0.05, -0.35, 0.48, 1.65), (0.3, -0.28, 0.42, 1.55)],
        1,
    ):
        cyl(f"{inv_id}::foliage-{i}", (x + dx, y + dy), r, h, 1.05, C["plant" if i % 2 else "plant_light"], inv_id, 20)


def wall_screen(inv_id, bounds, z=4.2, height=3.0, facing="south"):
    x1, y1, x2, y2 = bounds
    # dark bezel + inset luminous screen
    box(f"{inv_id}::bezel", bounds, height, z, C["core"], inv_id)
    if abs(x2 - x1) >= abs(y2 - y1):
        pad = min(0.12, (x2 - x1) * 0.06)
        b = (x1 + pad, y1 - 0.02, x2 - pad, y2 + 0.02)
    else:
        pad = min(0.12, (y2 - y1) * 0.06)
        b = (x1 - 0.02, y1 + pad, x2 + 0.02, y2 - pad)
    box(f"{inv_id}::screen", b, height - 0.35, z + 0.18, C["screen"], inv_id)


def kiosk(inv_id, bounds, height=5.0):
    x1, y1, x2, y2 = bounds
    box(f"{inv_id}::body", bounds, 3.35, 0, C["core"], inv_id)
    # screen faces south
    box(f"{inv_id}::screen", (x1 + 0.1, y1 - 0.08, x2 - 0.1, y1 + 0.05), 2.15, 3.1, C["screen"], inv_id)
    box(f"{inv_id}::red-status", (x1 + 0.18, y1 - 0.1, x2 - 0.18, y1 + 0.03), 0.08, 5.18, C["red"], inv_id)


def cabinet(inv_id, bounds, height, color=None):
    x1, y1, x2, y2 = bounds
    color = color or C["part"]
    box(f"{inv_id}::case", bounds, height, 0, color, inv_id)
    # face split and top cap
    mid = (x1 + x2) / 2
    box(f"{inv_id}::face-a", (x1 + 0.06, y1 - 0.03, mid - 0.03, y1 + 0.03), max(0.6, height - 0.35), 0.15, C["black"], inv_id)
    box(f"{inv_id}::face-b", (mid + 0.03, y1 - 0.03, x2 - 0.06, y1 + 0.03), max(0.6, height - 0.35), 0.15, C["black"], inv_id)
    box(f"{inv_id}::top", (x1 - 0.03, y1 - 0.03, x2 + 0.03, y2 + 0.03), 0.12, height, C["stone_top"], inv_id)


def safety_panel(inv_id, center, width=1.1, depth=0.16, height=1.5, z=3.5, color=None):
    x, y = center
    box(f"{inv_id}::cabinet", (x - width / 2, y - depth / 2, x + width / 2, y + depth / 2), height, z, color or C["white"], inv_id)
    box(f"{inv_id}::marker", (x - width * 0.32, y - depth / 2 - 0.03, x + width * 0.32, y + depth / 2 + 0.03), 0.16, z + height - 0.28, C["safety"], inv_id)


def light_bar(name, bounds, inv_id="F1-LIGHT-GRID-01", color=None):
    box(name, bounds, 0.07, 10.62, color or C["light"], inv_id)


def stair(name, bounds, flight_width):
    x1, y1, x2, y2 = bounds
    margin = 0.75
    west = (x1 + margin, x1 + margin + flight_width)
    east = (x2 - margin - flight_width, x2 - margin)
    sy = y1 + 0.75
    ny = y2 - 4.5
    tread = (ny - sy) / 10
    rise = 13.5 / 22
    box(name + "::lower-landing", (west[0], y1 + 0.75, west[1], sy + 2.5), 0.25, 0, C["stair"])
    for i in range(10):
        box(name + f"::flight1-{i+1:02d}", (west[0], sy + i * tread, west[1], sy + (i + 0.92) * tread), 0.22, (i + 1) * rise - 0.22, C["stair"])
    mid = 11 * rise
    box(name + "::mid-landing", (west[0], ny, east[1], y2 - 0.75), 0.25, mid - 0.25, C["stair"])
    for i in range(10):
        box(name + f"::flight2-{i+1:02d}", (east[0], ny - (i + 0.92) * tread, east[1], ny - i * tread), 0.22, mid + (i + 1) * rise - 0.22, C["stair"])
    box(name + "::upper-landing", (east[0], y1 + 0.75, east[1], sy + 2.5), 0.25, 13.25, C["stair"])
    # rails make the stairs read spatially without claiming permit detail
    for x in (west[0], west[1], east[0], east[1]):
        box(name + f"::rail-{x:.2f}", (x - 0.035, sy, x + 0.035, ny), 3.0, 2.0, C["core"])


# ---------------------------------------------------------------------------
# Architectural shell / generated geometry
# ---------------------------------------------------------------------------
box("floor_slab", (0, 0, 72, 72), 0.5, -0.5, C["floor"])
box("north_exterior_wall", (0, 71.25, 72, 72), H, 0, C["wall"])
box("west_exterior_wall", (0, 0, 0.75, 60), H, 0, C["wall"])
box("east_exterior_wall", (71.25, 0, 72, 72), H, 0, C["wall"])
box("south_exterior_left", (0, 0, 29, 0.75), H, 0, C["wall"])
box("south_exterior_right", (43, 0, 72, 0.75), H, 0, C["wall"])

# dark baseboard line strengthens the original V1 architectural feel
for n, b in [
    ("baseboard_west", (0.76, 1, 0.9, 53.5)),
    ("baseboard_east", (71.1, 1, 71.24, 53.5)),
    ("baseboard_north", (18.5, 53.6, 59.5, 53.75)),
]:
    box(n, b, 0.35, 0, C["black"])

# public ceiling clouds: visible in human views, hideable in viewer cutaway
box("ceiling_arrival", (1, 1, 53, 31), 0.25, 10.75, C["wall"])
box("ceiling_program", (1, 31, 53, 44.5), 0.25, 10.75, C["wall"])
box("ceiling_reception", (18, 44.5, 54, 54), 0.25, 10.75, C["wall"])
box("ceiling_corridor", (18, 54, 60, 60), 0.25, 10.75, C["wall"])

# Vestibule / entrance geometry
wv("vestibule_west_glass", 29, 0, 9, 0.2, H, color=C["glass"])
wv("vestibule_east_glass", 43, 0, 9, 0.2, H, color=C["glass"])
wh("vestibule_inner_glass", 29, 43, 9, 0.2, H, [(31, 41)], C["glass"])
for x in (29, 31, 36, 41, 43):
    box(f"entry_frame_{x}", (x - 0.08, 0, x + 0.08, 9), H, 0, C["core"])

# Inventory-driven public door pairs
for inv_id, y in [("F1-ENTRY-DOOR-OUTER", 0.36), ("F1-ENTRY-DOOR-INNER", 8.92)]:
    p = INV[inv_id]["placement"]
    mid = (p["x1"] + p["x2"]) / 2
    box(f"{inv_id}::leaf-left", (p["x1"], y - 0.08, mid - 0.05, y + 0.08), 8.5, 0, C["glass"], inv_id)
    box(f"{inv_id}::leaf-right", (mid + 0.05, y - 0.08, p["x2"], y + 0.08), 8.5, 0, C["glass"], inv_id)
    for x in (p["x1"], mid, p["x2"]):
        box(f"{inv_id}::frame-{x:.1f}", (x - 0.06, y - 0.12, x + 0.06, y + 0.12), 8.8, 0, C["core"], inv_id)

box("F1-ENTRY-MAT-01::mat", ibounds("F1-ENTRY-MAT-01"), 0.06, 0.01, C["rug"], "F1-ENTRY-MAT-01")
box("F1-ENTRY-SIGN-01::panel", (33, 8.88, 39, 9.08), 1.8, 6.65, C["stone"], "F1-ENTRY-SIGN-01")
box("F1-ENTRY-SIGN-01::red-line", (34, 8.84, 38, 9.02), 0.12, 6.95, C["red"], "F1-ENTRY-SIGN-01")

box("F1-ARRIVAL-INSET-01::floor-field", ibounds("F1-ARRIVAL-INSET-01"), 0.06, 0.01, C["floor_alt"], "F1-ARRIVAL-INSET-01")
box("F1-ARRIVAL-NAV-01::reveal", ibounds("F1-ARRIVAL-NAV-01"), 0.10, 0.02, C["red"], "F1-ARRIVAL-NAV-01")

# ---------------------------------------------------------------------------
# Orientation Lounge — preserve V1 composition, upgrade primitives
# ---------------------------------------------------------------------------
box("F1-LOUNGE-RUG-01::rug", ibounds("F1-LOUNGE-RUG-01"), 0.06, 0.01, C["rug"], "F1-LOUNGE-RUG-01")
sofa("F1-LOUNGE-SOFA-01", ibounds("F1-LOUNGE-SOFA-01"))
for cid in ("F1-LOUNGE-CHAIR-01", "F1-LOUNGE-CHAIR-02"):
    p = INV[cid]["placement"]
    chair(cid, p["center_ft"]["x"], p["center_ft"]["y"], p["orientation_deg"])
p = INV["F1-LOUNGE-TABLE-01"]["placement"]
round_table("F1-LOUNGE-TABLE-01", (p["center_ft"]["x"], p["center_ft"]["y"]), p["diameter_ft"], p["height_ft"])
p = INV["F1-LOUNGE-PLANT-01"]["placement"]
plant("F1-LOUNGE-PLANT-01", (p["center_ft"]["x"], p["center_ft"]["y"]), p["diameter_ft"])
wall_screen("F1-LOUNGE-DISPLAY-01", (0.82, 18.0, 1.02, 24.0), 4.1, 3.4)

# ---------------------------------------------------------------------------
# Intake / Verification — preserve V1 room, add privacy/support detail
# ---------------------------------------------------------------------------
wh("intake_south", 2, 16, 32, 0.5, H, color=C["part"])
wh("intake_north", 2, 16, 44, 0.5, H, color=C["part"])
wv("intake_west", 2, 32, 44, 0.5, H, color=C["part"])
wv("intake_east_glass", 16, 32, 44, 0.22, H, [(34, 37)], C["glass"])
table("F1-INTAKE-TABLE-01", ibounds("F1-INTAKE-TABLE-01"), 0.24, 2.45, C["wood"])
for cid in ("F1-INTAKE-CHAIR-01", "F1-INTAKE-CHAIR-02", "F1-INTAKE-CHAIR-03", "F1-INTAKE-CHAIR-04"):
    p = INV[cid]["placement"]
    chair(cid, p["center_ft"]["x"], p["center_ft"]["y"], p["orientation_deg"])
cabinet("F1-INTAKE-CREDENZA-01", (2.7, 41.8, 6.2, 43.25), 2.8, C["wood"])
wall_screen("F1-INTAKE-DISPLAY-01", (7.0, 43.82, 11.5, 44.02), 4.5, 2.7)

# ---------------------------------------------------------------------------
# Development Passport Studio — current program, V1 material language
# ---------------------------------------------------------------------------
for tid in ("F1-PASSPORT-TABLE-01", "F1-PASSPORT-TABLE-02"):
    table(tid, ibounds(tid), 0.22, 2.48, C["wood"])
for cid in [f"F1-PASSPORT-CHAIR-{i:02d}" for i in range(1, 7)]:
    p = INV[cid]["placement"]
    chair(cid, p["center_ft"]["x"], p["center_ft"]["y"], p["orientation_deg"], task=True)
for kid in [f"F1-PASSPORT-KIOSK-{i:02d}" for i in range(1, 4)]:
    kiosk(kid, ibounds(kid))
table("F1-PASSPORT-DOC-01", (47.2, 39.0, 50.8, 42.0), 0.20, 2.6, C["wood_light"])

# ---------------------------------------------------------------------------
# Journey Wall + Reception — V1 focal composition expanded by current program
# ---------------------------------------------------------------------------
box("F1-JOURNEY-WALL-01::feature", (28, 52.15, 44, 52.85), 10.55, 0, C["stone"], "F1-JOURNEY-WALL-01")
box("F1-JOURNEY-WALL-01::cap", (27.8, 52.0, 44.2, 53.0), 0.22, 10.45, C["stone_top"], "F1-JOURNEY-WALL-01")
for did in [f"F1-JOURNEY-DISPLAY-{i:02d}" for i in range(1, 5)]:
    wall_screen(did, ibounds(did), 4.25, 3.35)
box("F1-JOURNEY-RED-REVEAL-01::reveal", ibounds("F1-JOURNEY-RED-REVEAL-01"), 0.15, 3.95, C["red"], "F1-JOURNEY-RED-REVEAL-01")

# reception desk: substantial plinth, worktop, privacy return; same V1 footprint
rb = ibounds("F1-RECEPTION-DESK-01")
box("F1-RECEPTION-DESK-01::plinth", rb, 2.85, 0, C["stone"], "F1-RECEPTION-DESK-01")
box("F1-RECEPTION-DESK-01::worktop", (29.8, 43.82, 42.2, 47.2), 0.18, 3.28, C["stone_top"], "F1-RECEPTION-DESK-01")
box("F1-RECEPTION-DESK-01::privacy-front", (31.8, 43.78, 42.0, 44.18), 0.55, 2.95, C["stone"], "F1-RECEPTION-DESK-01")
box("F1-RECEPTION-ACCESS-01::counter", ibounds("F1-RECEPTION-ACCESS-01"), 0.18, 2.67, C["stone_top"], "F1-RECEPTION-ACCESS-01")
wall_screen("F1-RECEPTION-MONITOR-01", ibounds("F1-RECEPTION-MONITOR-01"), 3.45, 1.75)
cabinet("F1-RECEPTION-SECURITY-01", (38.6, 48.1, 42.2, 50.0), 2.85, C["core"])

# ---------------------------------------------------------------------------
# Directory / passenger / freight interfaces
# ---------------------------------------------------------------------------
kiosk("F1-DIRECTORY-01", ibounds("F1-DIRECTORY-01"), 6.0)
safety_panel("F1-EGRESS-MAP-01", icenter("F1-EGRESS-MAP-01"), 1.8, 0.12, 1.8, 4.2, C["core"])
safety_panel("F1-EGRESS-MAP-02", icenter("F1-EGRESS-MAP-02"), 1.8, 0.12, 1.8, 4.2, C["core"])

x1, y1, x2, y2 = PASS
wh("passenger_south", x1, x2, y1, 0.65, H, color=C["core"])
wh("passenger_north", x1, x2, y2, 0.65, H, color=C["core"])
wv("passenger_east", x2, y1, y2, 0.65, H, color=C["core"])
wv("passenger_west", x1, y1, y2, 0.65, H, [(37, 41)], C["core"])
p = INV["F1-PASS-ELEV-DOOR-01"]["placement"]
mid = (p["y1"] + p["y2"]) / 2
box("F1-PASS-ELEV-DOOR-01::leaf-a", (53.88, p["y1"], 54.04, mid - 0.03), 8.5, 0, C["freight"], "F1-PASS-ELEV-DOOR-01")
box("F1-PASS-ELEV-DOOR-01::leaf-b", (53.88, mid + 0.03, 54.04, p["y2"]), 8.5, 0, C["freight"], "F1-PASS-ELEV-DOOR-01")
safety_panel("F1-PASS-ELEV-CALL-01", (53.68, 35.6), 0.62, 0.14, 1.6, 3.6, C["core"])

x1, y1, x2, y2 = FREIGHT
wh("freight_north", x1, x2, y2 - 0.325, 0.65, H, color=C["freight"])
wv("freight_west", x1 + 0.325, y1, y2, 0.65, H, color=C["freight"])
wv("freight_east", x2, y1, y2, 0.65, H, color=C["freight"])
wh("freight_south", x1, x2, y1, 0.65, H, [(1.5, 6.5)], C["freight"])
p = INV["F1-FREIGHT-DOOR-01"]["placement"]
mid = (p["x1"] + p["x2"]) / 2
box("F1-FREIGHT-DOOR-01::leaf-a", (p["x1"], 59.88, mid - 0.04, 60.04), 9.0, 0, C["core"], "F1-FREIGHT-DOOR-01")
box("F1-FREIGHT-DOOR-01::leaf-b", (mid + 0.04, 59.88, p["x2"], 60.04), 9.0, 0, C["core"], "F1-FREIGHT-DOOR-01")
safety_panel("F1-FREIGHT-CONTROL-01", (6.9, 59.66), 0.8, 0.14, 1.8, 3.4, C["freight"])

# ---------------------------------------------------------------------------
# Correct Core V2 stairs + B1 direction controls
# ---------------------------------------------------------------------------
wh("stair_b_south", 8, 18, 54, 0.65, H, [(14, 17)], C["core"])
wh("stair_b_north", 8, 18, 71.675, 0.65, H, color=C["core"])
wv("stair_b_west", 8, 54, 72, 0.65, H, color=C["core"])
wv("stair_b_east", 18, 54, 72, 0.65, H, color=C["core"])
stair("stair_b", SB, 3.9)
wh("stair_a_south", 60, 72, 54, 0.65, H, [(61.5, 64.5)], C["core"])
wh("stair_a_north", 60, 72, 71.675, 0.65, H, color=C["core"])
wv("stair_a_west", 60, 54, 72, 0.65, H, color=C["core"])
wv("stair_a_east", 71.675, 54, 72, 0.65, H, color=C["core"])
stair("stair_a", SA, 4.8)
box("F1-STAIR-B-BARRIER-DOWN::barrier", (13.9, 54.22, 17.1, 54.42), 3.0, 0, C["red"], "F1-STAIR-B-BARRIER-DOWN")
box("F1-STAIR-A-BARRIER-DOWN::barrier", (61.4, 54.22, 64.6, 54.42), 3.0, 0, C["red"], "F1-STAIR-A-BARRIER-DOWN")

# ---------------------------------------------------------------------------
# Support band / life safety / operations
# ---------------------------------------------------------------------------
wh("support_south", 18, 60, 60, 0.5, H, [(20, 23), (27.5, 30.5), (35.5, 38.5), (43.5, 46.5), (51, 53.5)], C["part"])
for x, y1, y2, n in [
    (26, 60, 70, "restroom_divider"),
    (34, 60, 72, "ops_divider"),
    (42, 60, 72, "it_divider"),
    (50, 60, 72, "service_divider"),
    (54, 60, 66, "janitor_east"),
]:
    wv(n, x, y1, y2, 0.5, H, color=C["part"])
wh("restroom_a_north", 18, 26, 70, 0.5, H, color=C["part"])
wh("restroom_b_north", 26, 34, 70, 0.5, H, color=C["part"])
box("mep_riser", MEP, H, 0, C["freight"])

for vid in ("F1-RR-A-VANITY-01", "F1-RR-B-VANITY-01"):
    cabinet(vid, ibounds(vid), 2.75, C["stone"])
for fid in ("F1-RR-A-FIXTURE-01", "F1-RR-B-FIXTURE-01"):
    b = ibounds(fid)
    x = (b[0] + b[2]) / 2
    y = (b[1] + b[3]) / 2
    cyl(fid + "::bowl", (x, y), 0.72, 1.15, 0, C["white"], fid, 32)
    box(fid + "::tank", (x - 0.6, b[1], x + 0.6, b[1] + 0.45), 1.65, 0.8, C["white"], fid)

cabinet("F1-OPS-PANEL-01", (34.7, 64.0, 37.4, 67.2), 6.4, C["core"])
cabinet("F1-IT-RACK-01", (44.0, 64.0, 48.0, 69.0), 7.0, C["black"])
cabinet("F1-JANITOR-STORAGE-01", (50.5, 61.0, 53.4, 64.4), 6.0, C["part"])

for sid in ("F1-AED-01", "F1-FIRST-AID-01", "F1-FE-01", "F1-FE-02", "F1-SPILL-01", "F1-TWOWAY-01"):
    color = C["safety"] if sid in ("F1-AED-01", "F1-FE-01", "F1-FE-02") else C["white"]
    safety_panel(sid, icenter(sid), 1.05 if sid != "F1-TWOWAY-01" else 0.8, 0.16, 1.3, 3.4, color)

# ---------------------------------------------------------------------------
# V1-style warm lighting fixtures + architectural accents
# ---------------------------------------------------------------------------
light_positions = []
for x in (8, 18, 28, 38, 48, 58):
    for y in (7, 18, 29, 40):
        # skip passenger core overlap and far service/stair band
        if not (53 < x < 63 and 33 < y < 45):
            light_positions.append((x, y))
for i, (x, y) in enumerate(light_positions[:24], 1):
    light_bar(f"F1-LIGHT-GRID-01::{i:02d}", (x - 1.35, y - 0.10, x + 1.35, y + 0.10))
# reception and lounge focal fixtures are visible geometry; viewer supplies actual light energy
for i, x in enumerate((32.5, 36.0, 39.5), 1):
    light_bar(f"F1-RECEPTION-LIGHT-01::{i}", (x - 1.0, 47.8, x + 1.0, 48.0), "F1-RECEPTION-LIGHT-01", C["light_warm"])
for i, x in enumerate((6.5, 10.0, 13.5), 1):
    light_bar(f"F1-LOUNGE-LIGHT-01::{i}", (x - 0.8, 19.8, x + 0.8, 20.0), "F1-LOUNGE-LIGHT-01", C["light_warm"])

# V1 restrained navigation spine
box("red_wayfinding_spine", (18.3, 53.72, 59.7, 53.82), 0.10, 0.08, C["red"])

# ---------------------------------------------------------------------------
# Export + deterministic inventory coverage verification
# ---------------------------------------------------------------------------
scene.metadata.update(
    {
        "scene_id": "equity-uprise-floor-01",
        "version": "hybrid-v1-design-core-v2-truth-1",
        "not_for_construction": True,
        "source_units": "feet",
        "feet_to_meters": FT,
        "floor_identity": "Arrival / Orientation / Intake",
        "render_mode": "designed-interior-cutaway",
        "design_formula": "V1 interior quality + assembled-building stacking behavior + Core V2 truth",
        "inventory_ref": "floor-01-object-inventory.json",
        "inventory_records": len(INV),
        "vertical_systems": {
            "passenger_elevator": PASS,
            "service_freight_elevator": FREIGHT,
            "stair_b": SB,
            "stair_a": SA,
            "mep_riser": MEP,
        },
    }
)

data = scene.export(file_type="glb")
OUT.write_bytes(data)

checks = []
ext = (scene.extents / FT).tolist()


def check(name, passed, actual=None, expected=None):
    checks.append({"name": name, "passed": bool(passed), "actual": actual, "expected": expected})


check("72ft building width", abs(ext[0] - 72) < 0.05, ext[0], 72)
check("72ft building depth", abs(ext[1] - 72) < 0.05, ext[1], 72)
check("inventory records loaded", len(INV) == 67, len(INV), 67)
missing_inventory = sorted(set(INV) - modelled_inventory_ids)
check(
    "all inventory records represented in 3D",
    not missing_inventory,
    len(modelled_inventory_ids),
    len(INV),
)
check("passenger elevator retained", any(n.startswith("F1-PASS-ELEV-DOOR-01") for n in records))
check("freight elevator retained", any(n.startswith("F1-FREIGHT-DOOR-01") for n in records))
check("Stair A retained", any(n.startswith("stair_a::flight1") for n in records))
check("Stair B retained", any(n.startswith("stair_b::flight1") for n in records))
check("Journey Wall modeled", "F1-JOURNEY-WALL-01" in modelled_inventory_ids)
check("Reception modeled", "F1-RECEPTION-DESK-01" in modelled_inventory_ids)
check("Orientation Lounge modeled", "F1-LOUNGE-SOFA-01" in modelled_inventory_ids)
check("Intake modeled", "F1-INTAKE-TABLE-01" in modelled_inventory_ids)
check("Passport Studio modeled", "F1-PASSPORT-TABLE-01" in modelled_inventory_ids)
check("Directory modeled", "F1-DIRECTORY-01" in modelled_inventory_ids)

failed = [x for x in checks if not x["passed"]]
report = {
    "scene_id": "equity-uprise-floor-01",
    "version": "hybrid-v1-design-core-v2-truth-1",
    "design_formula": "V1 interior quality + assembled-building stacking behavior + Core V2 truth",
    "not_for_construction": True,
    "mesh_count": len(scene.geometry),
    "glb_bytes": len(data),
    "sha256": hashlib.sha256(data).hexdigest(),
    "bounds_m": scene.bounds.tolist(),
    "extents_ft": ext,
    "inventory_records": len(INV),
    "inventory_records_modeled": len(modelled_inventory_ids),
    "inventory_records_missing": missing_inventory,
    "checks_total": len(checks),
    "checks_passed": len(checks) - len(failed),
    "checks_failed": len(failed),
    "passed": not failed,
    "checks": checks,
}
REPORT.write_text(json.dumps(report, indent=2) + "\n")
print(
    json.dumps(
        {
            k: report[k]
            for k in [
                "version",
                "mesh_count",
                "glb_bytes",
                "sha256",
                "inventory_records",
                "inventory_records_modeled",
                "inventory_records_missing",
                "checks_passed",
                "checks_total",
                "passed",
            ]
        },
        indent=2,
    )
)
if failed:
    raise SystemExit(1)
