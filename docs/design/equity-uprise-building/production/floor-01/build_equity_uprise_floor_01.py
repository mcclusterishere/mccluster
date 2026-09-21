#!/usr/bin/env python3
"""
Deterministic Equity Uprise Floor 1 GLB generator.

Authority:
  Floor 1 written spec -> schematic basis -> canonical DXF/SVG ->
  production/floor-01 JSON package -> this generator -> GLB.

This generator is for visualization/web output and is NOT FOR CONSTRUCTION.
It expects \`trimesh\` and \`numpy\`.
"""

from pathlib import Path
import json
import trimesh

FT = 0.3048

HERE = Path(__file__).resolve().parent
MANIFEST = json.loads((HERE / "floor-01-scene-manifest.json").read_text())
MATERIALS = json.loads((HERE / "floor-01-materials.json").read_text())
HOTSPOTS = json.loads((HERE / "floor-01-hotspots.json").read_text())
CAMERAS = json.loads((HERE / "floor-01-camera.json").read_text())

OUT_DIR = HERE / "generated"
OUT_DIR.mkdir(exist_ok=True)
OUT = OUT_DIR / "equity-uprise-floor-01-deterministic-v1.glb"
REPORT = OUT_DIR / "equity-uprise-floor-01-deterministic-v1-report.json"

def rgba(hexstr, alpha=255):
    s = hexstr.lstrip("#")
    return [int(s[i:i+2], 16) for i in (0, 2, 4)] + [alpha]

mat = {m["id"]: m for m in MATERIALS["materials"]}
COLORS = {
    "floor": rgba(mat["floor_honed_gray"]["base_color"]),
    "wall": rgba(mat["wall_charcoal_mineral"]["base_color"]),
    "core": rgba(mat["metal_gunmetal_brushed"]["base_color"]),
    "stone": rgba(mat["reception_stone_dark"]["base_color"]),
    "glass": rgba(mat["glass_clear_arch"]["base_color"], 105),
    "wood": rgba(mat["wood_warm_muted"]["base_color"]),
    "seat": rgba(mat["upholstery_charcoal"]["base_color"]),
    "accent": rgba(mat["accent_red_navigation"]["base_color"]),
    "service": [73, 74, 74, 255],
    "hotspot": [210, 210, 210, 20],
}

scene = trimesh.Scene()
records = []

def add_box(name, bounds_ft, height_ft, z0_ft=0, color=None):
    x1, y1, x2, y2 = bounds_ft
    mesh = trimesh.creation.box(
        extents=((x2-x1)*FT, (y2-y1)*FT, height_ft*FT)
    )
    mesh.apply_translation((
        ((x1+x2)/2)*FT,
        ((y1+y2)/2)*FT,
        (z0_ft + height_ft/2)*FT
    ))
    if color is not None:
        mesh.visual.face_colors = color
    scene.add_geometry(mesh, node_name=name, geom_name=name)
    records.append({
        "name": name,
        "bounds_ft": [x1, y1, x2, y2],
        "height_ft": height_ft,
        "z0_ft": z0_ft
    })

def add_cyl(name, xy, radius_ft, height_ft, z0_ft=0, color=None):
    mesh = trimesh.creation.cylinder(
        radius=radius_ft*FT,
        height=height_ft*FT,
        sections=32
    )
    mesh.apply_translation((
        xy[0]*FT,
        xy[1]*FT,
        (z0_ft + height_ft/2)*FT
    ))
    if color is not None:
        mesh.visual.face_colors = color
    scene.add_geometry(mesh, node_name=name, geom_name=name)
    records.append({
        "name": name,
        "center_ft": list(xy),
        "radius_ft": radius_ft,
        "height_ft": height_ft
    })

def wall_h(name, x1, x2, y, t, h, gaps=None, color=None):
    cursor = x1
    for i, (g1, g2) in enumerate(sorted(gaps or []) + [(x2, x2)]):
        if g1 > cursor:
            add_box(
                f"{name}_{i+1}",
                (cursor, y-t/2, g1, y+t/2),
                h,
                color=color
            )
        cursor = max(cursor, g2)

def wall_v(name, x, y1, y2, t, h, gaps=None, color=None):
    cursor = y1
    for i, (g1, g2) in enumerate(sorted(gaps or []) + [(y2, y2)]):
        if g1 > cursor:
            add_box(
                f"{name}_{i+1}",
                (x-t/2, cursor, x+t/2, g1),
                h,
                color=color
            )
        cursor = max(cursor, g2)

D = MANIFEST["production_modeling_defaults"]
H = float(D["default_finished_ceiling_height_ft"])
ext_t = float(D["exterior_wall_thickness_ft"])
int_t = float(D["interior_partition_thickness_ft"])
core_t = float(D["core_wall_thickness_ft"])

# Floor and removable ceiling.
add_box("floor_slab", (0,0,72,72), 0.5, -0.5, COLORS["floor"])
add_box("ceiling_slab", (0,0,72,72), 0.35, H, COLORS["wall"])

# Exterior walls are kept fully inside the locked 72' x 72' footprint.
add_box("south_exterior_wall_left", (0,0,29,ext_t), H, color=COLORS["wall"])
add_box("south_exterior_wall_right", (43,0,72,ext_t), H, color=COLORS["wall"])
add_box("north_exterior_wall", (0,72-ext_t,72,72), H, color=COLORS["wall"])
add_box("west_exterior_wall", (0,0,ext_t,72), H, color=COLORS["wall"])
add_box("east_exterior_wall", (72-ext_t,0,72,72), H, color=COLORS["wall"])

# Entry vestibule.
wall_v("vestibule_west_glass", 29,0,9,0.25,H,color=COLORS["glass"])
wall_v("vestibule_east_glass", 43,0,9,0.25,H,color=COLORS["glass"])
wall_h("vestibule_inner_glass", 29,43,9,0.25,H,[(32,40)],COLORS["glass"])
wall_h("entry_glass_left", 29,32,0.35,0.2,H,color=COLORS["glass"])
wall_h("entry_glass_right", 40,43,0.35,0.2,H,color=COLORS["glass"])
for x in (29,32,40,43):
    add_box(f"entry_frame_{x}", (x-0.08,0,x+0.08,9), H, color=COLORS["core"])

# Intake room.
wall_h("intake_south_wall", 2,16,32,int_t,H,color=COLORS["wall"])
wall_h("intake_north_wall", 2,16,44,int_t,H,color=COLORS["wall"])
wall_v("intake_east_glass", 16,32,44,0.25,H,[(33.5,37.0)],COLORS["glass"])

# Reception feature wall.
wall_h("reception_feature_wall", 28,44,52.5,0.75,12.0,color=COLORS["stone"])

# North support band.
wall_h(
    "support_south_wall",
    12,60,60,int_t,H,
    [(14.5,17.5),(22.5,25.5),(31,34),(43,46),(51,53.5)],
    COLORS["wall"]
)
for x,y1,y2,label in [
    (12,54,72,"stair_b_east"),
    (20,60,70,"restroom_divider_1"),
    (28,60,72,"restroom_divider_2"),
    (40,60,72,"support_divider"),
    (50,60,72,"it_service_divider"),
    (54,60,66,"janitor_east"),
    (60,54,72,"stair_a_west")
]:
    wall_v(label, x,y1,y2,int_t,H,color=COLORS["wall"])

wall_h("stair_b_south", 0,12,54,core_t,H,[(7.5,10.5)],COLORS["core"])
wall_h("stair_a_south", 60,72,54,core_t,H,[(61.5,64.5)],COLORS["core"])

# Elevator.
e = MANIFEST["fixed_core"]["elevator"]["bounds_ft"]
ex1,ey1,ex2,ey2 = e["x1"],e["y1"],e["x2"],e["y2"]
wall_h("elevator_south", ex1,ex2,ey1,core_t,H,color=COLORS["core"])
wall_h("elevator_north", ex1,ex2,ey2,core_t,H,color=COLORS["core"])
wall_v("elevator_east", ex2,ey1,ey2,core_t,H,color=COLORS["core"])
wall_v("elevator_west", ex1,ey1,ey2,core_t,H,[(37,41)],COLORS["core"])
add_box("elevator_door_panel_1", (53.88,37,54.02,39), 8.0, color=COLORS["core"])
add_box("elevator_door_panel_2", (53.88,39,54.02,41), 8.0, color=COLORS["core"])

# MEP reservation.
add_box("mep_riser_mass", (50,66,60,72), H, color=COLORS["service"])

# Simplified protected stair treads.
def stairs(prefix, x1,y1,x2,y2, count=9, rise=10.5):
    run = (y2-y1-3)/count
    for i in range(count):
        ya = y1 + 1.5 + i*run
        add_box(
            f"{prefix}_tread_{i+1}",
            (x1+1.3, ya, x2-1.3, ya+run*0.82),
            0.45,
            i*(rise/count),
            [90,90,88,255]
        )

stairs("stair_b", 0,54,12,72)
stairs("stair_a", 60,54,72,72)

# Canonical objects.
for obj in MANIFEST["canonical_objects"]:
    if obj["id"] == "reception_desk":
        b=obj["bounds_ft"]
        add_box(
            "reception_desk",
            (b["x1"],b["y1"],b["x2"],b["y2"]),
            3.5,
            color=COLORS["stone"]
        )
    if obj["id"] == "directory":
        b=obj["bounds_ft"]
        add_box(
            "directory",
            (b["x1"],b["y1"],b["x2"],b["y2"]),
            6.0,
            color=COLORS["core"]
        )

# Production defaults.
add_box("reception_accessible_counter", (30,44,33,47), 2.85, color=COLORS["stone"])
add_box("lounge_sofa", (3,14,10,17), 2.8, color=COLORS["seat"])
add_box("lounge_chair_1", (12,14,15,17), 2.8, color=COLORS["seat"])
add_box("lounge_chair_2", (12,22,15,25), 2.8, color=COLORS["seat"])
add_cyl("lounge_table", (9.5,20), 2.0, 1.4, color=COLORS["wood"])
add_box("intake_table", (6,36.5,12,39.5), 2.5, color=COLORS["wood"])
for i,(x,y) in enumerate([(5,38),(13,38),(8,35),(10,41)],1):
    add_cyl(f"intake_chair_{i}", (x,y), 0.9, 2.7, color=COLORS["seat"])
add_box("lounge_rug", (3,12.5,16.5,27), 0.06, 0.01, [58,56,55,255])
add_box("reception_red_reveal", (30,43.92,42,44.08), 0.22, 0.12, COLORS["accent"])

# Runtime hotspot anchors.
for hs in HOTSPOTS["hotspots"]:
    p = hs["position_ft"]
    sph = trimesh.creation.icosphere(subdivisions=2, radius=0.16)
    sph.apply_translation((p["x"]*FT,p["y"]*FT,p["z"]*FT))
    sph.visual.face_colors = COLORS["hotspot"]
    scene.add_geometry(
        sph,
        node_name=f'hotspot::{hs["id"]}',
        geom_name=f'hotspot::{hs["id"]}'
    )

# Canonical 360-camera anchor.
cam = next(
    c for c in CAMERAS["cameras"]
    if c["id"] == "canonical_360"
)["position_ft"]
marker = trimesh.creation.icosphere(subdivisions=2, radius=0.12)
marker.apply_translation((cam["x"]*FT,cam["y"]*FT,cam["z"]*FT))
marker.visual.face_colors = [255,255,255,30]
scene.add_geometry(
    marker,
    node_name="camera::canonical_360",
    geom_name="camera::canonical_360"
)

scene.metadata.update({
    "scene_id": MANIFEST["scene_id"],
    "version": "deterministic-v1",
    "not_for_construction": True,
    "source_units": "feet",
    "feet_to_meters": FT
})

data = scene.export(file_type="glb")
OUT.write_bytes(data)

REPORT.write_text(json.dumps({
    "scene_id": MANIFEST["scene_id"],
    "version": "deterministic-v1",
    "mesh_count": len(scene.geometry),
    "glb_bytes": len(data),
    "bounds_m": scene.bounds.tolist(),
    "extents_m": scene.extents.tolist(),
    "expected_plan_extents_ft": [72,72],
    "not_for_construction": True
}, indent=2))

print(f"Wrote {OUT}")
print(f"Wrote {REPORT}")
