"""Render the review set from EU_HQ_Interiors_v2.blend (Blender 4.2+, Cycles).

  blender -b EU_HQ_Interiors_v2.blend --python render_hq_interior_v2.py -- --outdir renders [--views F01_TOP,F06_EYE,...]
          [--samples 64] [--scale 100]

View ids: F0X_TOP (orthographic plan check, cut at 9.5 ft AFF, floors above and ceilings hidden),
F0X_EYE (canonical 360 datum (36,28) at 1.65 m, facing north, full stack visible),
F0X_BOARD (south elevated view matching the approved board's framing, floors above + ceilings hidden),
extra cameras (F06_HALO_SUITE, F01_ENTRY), and BEFORE_<view> which renders the same camera on the
unchanged official builder output (`_SOURCE_REFERENCE_readonly`) with the same ceiling lights.
The file is never saved by this script.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

FT = 0.3048
a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"outdir": "renders", "views": "", "samples": "64", "scale": "100"}
i = 0
while i < len(a):
    opt[a[i][2:]] = a[i + 1]
    i += 2
os.makedirs(opt["outdir"], exist_ok=True)
sc = bpy.context.scene
vl = bpy.context.view_layer
sc.cycles.samples = int(opt["samples"])
sc.cycles.use_denoising = True
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.04
sc.render.resolution_percentage = int(opt["scale"])
sc.render.image_settings.file_format = "PNG"
try:
    sc.cycles.device = "CPU"
except Exception:
    pass


def lc_of(c, lc=None):
    lc = lc or vl.layer_collection
    if lc.collection == c:
        return lc
    for ch in lc.children:
        r = lc_of(c, ch)
        if r:
            return r


FLOORS = {int(c["eu_floor"]): c for c in bpy.data.collections if "eu_floor" in c.keys()}
SRC = {int(c.name[5:7]): c for c in bpy.data.collections if c.name.startswith("SRC_F")}
SRCROOT = bpy.data.collections["_SOURCE_REFERENCE_readonly"]
B1 = bpy.data.collections["B1_CrewHub_existing_unchanged"]
sun = bpy.data.objects["SUN_afternoon_SW"]
sky = next(n for n in sc.world.node_tree.nodes if n.type == "TEX_SKY")
bg = sc.world.node_tree.nodes["Background"]


def all_objs(c):
    return list(c.all_objects)


def reset():
    for c in bpy.data.collections:
        c.hide_render = False
    for o in bpy.data.objects:
        o.hide_render = False
    lc_of(SRCROOT).exclude = True
    for c in SRC.values():
        lc_of(c).exclude = True
    bpy.data.collections["EU_Concept_Asset_Proxies"].hide_render = True
    set_daylight(24, 225, 3.2, (1.0, 0.88, 0.72), 0.35)
    sc.view_settings.exposure = 0.0


def set_daylight(elev, az, energy, color, sky_strength):
    e, z = math.radians(elev), math.radians(az)
    to_sun = Vector((math.sin(z) * math.cos(e), math.cos(z) * math.cos(e), math.sin(e)))
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    sun.data.energy = energy
    sun.data.color = color
    sky.sun_elevation = e
    sky.sun_rotation = z
    bg.inputs["Strength"].default_value = sky_strength


def members(c):
    """Objects in c and its children (resolved by name; avoids stale all_objects caches)."""
    names = set()
    stack = [c]
    while stack:
        x = stack.pop()
        names.update(o.name for o in x.objects)
        stack.extend(x.children)
    return [bpy.data.objects[n] for n in names]


def hide_ceilings(colls):
    for c in colls:
        for o in members(c):
            n = o.name.lower()
            if "ceiling" in n and "light" not in n and "canopy" not in n:
                o.hide_render = True


def setup(view):
    reset()
    before = view.startswith("BEFORE_")
    v = view[7:] if before else view
    f = int(v[1:3])
    kind = v[4:]
    cam = bpy.data.objects["CAM_" + v]
    sc.camera = cam
    cut = kind in ("TOP", "BOARD")
    if kind == "TOP":
        sc.render.resolution_x = sc.render.resolution_y = 1200
    else:
        sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    if before:
        lc_of(SRCROOT).exclude = False
        lc_of(bpy.data.collections["SRC_CoreV2_combined_chassis"]).exclude = True
        for g, c in SRC.items():
            lc_of(c).exclude = cut and g > f
        for g, c in FLOORS.items():
            for o in members(c):
                o.hide_render = not o.name.startswith(f"F{g:02d}_CeilingPanel") or (cut and g > f)
        if cut:
            hide_ceilings([SRC[f]])
    else:
        for g, c in FLOORS.items():
            if cut and g > f:
                for o in members(c):
                    o.hide_render = True
        if cut:
            hide_ceilings([FLOORS[f]])
    if f == 7:
        set_daylight(5, 250, 2.2, (1.0, 0.62, 0.42), 0.8)       # dusk, as the approved roof board
        sc.view_settings.exposure = 0.6
    elif kind == "TOP":
        set_daylight(48, 215, 2.6, (1.0, 0.9, 0.76), 0.4)       # high sun so the plan reads evenly
        sc.view_settings.exposure = -0.3
    elif kind == "BOARD":
        set_daylight(30, 230, 2.6, (1.0, 0.84, 0.64), 0.4)
        sc.view_settings.exposure = -0.35
    else:
        sc.view_settings.exposure = 0.0
    return view


views = [v for v in opt["views"].split(",") if v] or (
    [f"F{f:02d}_{k}" for f in range(1, 8) for k in ("TOP", "EYE", "BOARD")]
    + ["F06_HALO_SUITE", "F01_ENTRY"]
    + [f"BEFORE_F{f:02d}_{k}" for f in (1, 6) for k in ("TOP", "EYE", "BOARD")])
for v in views:
    setup(v)
    sc.render.filepath = os.path.join(opt["outdir"], v + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", v, flush=True)
os._exit(0)
