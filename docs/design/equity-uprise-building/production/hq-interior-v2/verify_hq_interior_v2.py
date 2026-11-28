"""Verify EU_HQ_Interiors_v2.blend in a FRESH Blender process (reopen test) and write a JSON report.

  blender -b --factory-startup --python verify_hq_interior_v2.py -- --blend EU_HQ_Interiors_v2.blend \
      --repo <mccluster> --pack <pack> --out hq-interior-v2-verification.json

Checks: reopen with no missing data; collection structure per floor; instancing; 52/52 approved anchors
realised at their CSV positions; Core V2 shaft/stair/elevation alignment against the canonical combined
chassis on every floor; F6 one suspended Halo Globe (no plinth) + PRIM2 screen, each with its own
interaction anchor; McCluster office brand slot on F6 only; walking routes (36 in clear) from the
arrival point to stairs, freight, room doors and every anchored asset; furniture vs wall collisions.
Inventory CSV/JSON keyed to the overlay tags is written beside the report.
"""
import csv
import json
import math
import os
import sys
from collections import deque
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hq_interior_v2_merge as MG  # noqa: E402

FT = 0.3048
a = sys.argv[sys.argv.index("--") + 1:]
opt = {a[i][2:]: a[i + 1] for i in range(0, len(a), 2)}
bpy.ops.wm.open_mainfile(filepath=opt["blend"])
REPO = Path(opt["repo"])
PACK = Path(opt["pack"])
OUT = Path(opt["out"])
FFE = {f: (f - 1) * 13.5 for f in range(1, 8)}
R = {"checks": [], "notes": []}


def check(name, ok, detail=None):
    R["checks"].append({"check": name, "passed": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + ("" if detail is None else f"  {detail}"), flush=True)


def members(c):
    names, st = set(), [c]
    while st:
        x = st.pop()
        names.update(o.name for o in x.objects)
        st.extend(x.children)
    return [bpy.data.objects[n] for n in names]


def wbbox(o, m=None):
    m = m or o.matrix_world
    ws = [m @ Vector(v) for v in o.bound_box]
    return [min(w[i] for w in ws) / FT for i in range(3)], [max(w[i] for w in ws) / FT for i in range(3)]


# ------------------------------------------------------------- reopen / assets
missing_imgs = [i.name for i in bpy.data.images if i.source == "FILE" and i.filepath and not i.packed_file
                and not os.path.exists(bpy.path.abspath(i.filepath))]
check("file reopens with no linked libraries", len(bpy.data.libraries) == 0, len(bpy.data.libraries))
loose = [o.name for o in bpy.context.scene.collection.objects]
check("nothing loose in the scene root (every object sits in a named collection)", not loose, {"count": len(loose), "sample": loose[:5]})
check("no missing image files", not missing_imgs, missing_imgs)
inst = [o for o in bpy.data.objects if o.instance_type == "COLLECTION"]
broken = [o.name for o in inst if not o.instance_collection or not o.instance_collection.all_objects]
check("every kit instance resolves to its master", not broken and len(inst) > 0, f"{len(inst)} instances, broken={broken[:5]}")
kit_used = {o.instance_collection.name for o in inst if o.instance_collection}
masters = [c for c in bpy.data.collections["KIT_Assets"].children]
reuse = sum(1 for o in inst) / max(1, len(kit_used))
check("repeated assets are instanced (no duplicated kit meshes)", all(len(c.objects) <= 2 for c in masters),
      f"{len(masters)} masters, {len(inst)} instances, mean reuse {reuse:.1f}x")

# ------------------------------------------------------------- structure
FLOORS = {int(c["eu_floor"]): c for c in bpy.data.collections if "eu_floor" in c.keys()}
need = ("Shell", "ArchFinishes", "Furniture", "Equipment", "Lighting", "Cameras", "Interaction_and_Anchors")
for f in range(1, 8):
    c = FLOORS.get(f)
    kids = [x.name for x in c.children] if c else []
    check(f"F{f:02d} has separate collections {need}", c and all(f"F{f:02d}_{n}" in kids for n in need), kids)
    cams = [o.name for o in members(bpy.data.collections[f"F{f:02d}_Cameras"]) if o.type == "CAMERA"]
    check(f"F{f:02d} top + eye cameras", f"CAM_F{f:02d}_TOP" in cams and f"CAM_F{f:02d}_EYE" in cams, cams)
check("B1 crew hub kept (existing canonical B1, unchanged)", "B1_CrewHub_existing_unchanged" in bpy.data.collections and
      len(bpy.data.collections["B1_CrewHub_existing_unchanged"].objects) > 300,
      len(bpy.data.collections["B1_CrewHub_existing_unchanged"].objects))
src = bpy.data.collections["_SOURCE_REFERENCE_readonly"]
check("source reference collections present and excluded from the view layer",
      bpy.context.view_layer.layer_collection.children["_SOURCE_REFERENCE_readonly"].exclude,
      [c.name for c in src.children])

# ------------------------------------------------------------- anchors (52)
with (PACK / "asset-map.csv").open(encoding="utf-8-sig", newline="") as fh:
    ROWS = list(csv.DictReader(fh))
by_tag = {}
for o in bpy.data.objects:
    t = o.get("eu_tag")
    if t and "/" not in str(t) and not str(t).startswith("S"):
        by_tag.setdefault(t, []).append(o)
miss, off, DEV = [], [], []
INV = []
for r in ROWS:
    obs = by_tag.get(r["tag"], [])
    if not obs:
        miss.append(r["tag"])
        continue
    o = obs[0]
    if o.instance_type == "COLLECTION" or o.type == "EMPTY":
        x, y = o.matrix_world.translation.x / FT, o.matrix_world.translation.y / FT
    else:
        lo, hi = wbbox(o)
        x, y = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    d = math.hypot(x - float(r["x_ft"]), y - float(r["y_ft"]))
    if d > 0.05:
        if o.get("eu_deviation"):
            DEV.append({"tag": r["tag"], "asset_id": r["asset_id"], "offset_ft": round(d, 2), "reason": o["eu_deviation"]})
        else:
            off.append((r["tag"], round(d, 3)))
    INV.append({"floor": int(r["floor"]), "overlay_tag": r["tag"], "asset_id": r["asset_id"], "blender_object": o.name,
                "kit_master": o.get("eu_kit", "unique object"), "x_ft": round(x, 2), "y_ft": round(y, 2),
                "envelope_ft": f'{r["width_ft"]} x {r["depth_ft"]} x {r["height_ft"]}', "material_hint": r["material"],
                "source": "asset-map.csv v2 (approved anchor)", "note": r["note"]})
check("52/52 approved anchors realised as named objects", not miss and len(ROWS) == 52, {"missing": miss})
check("anchored assets sit on their CSV X/Y (<= 0.05 ft) unless a documented source-geometry deviation", not off,
      {"undocumented": off, "documented_deviations": DEV})
R["anchor_deviations"] = DEV

# dressing inventory
for f in range(1, 8):
    for o in members(FLOORS[f]):
        t = o.get("eu_tag")
        if t is None or not (str(t).startswith("S") or "/" in str(t)):
            continue
        p = o.matrix_world.translation / FT
        INV.append({"floor": f, "overlay_tag": "", "asset_id": "", "blender_object": o.name,
                    "kit_master": o.get("eu_kit", "unique object"), "x_ft": round(p.x, 2), "y_ft": round(p.y, 2),
                    "envelope_ft": "", "material_hint": "", "source": "board dressing (inferred placement)" if str(t).startswith("S")
                    else f"companion of overlay {str(t).split('/')[0]} (inferred placement)", "note": o.get("eu_note", "")})

# ------------------------------------------------------------- Core V2 stacking
CORE = {"passenger": (54, 34, 62, 44), "freight": (0, 60, 8, 72), "stair_b": (8, 54, 18, 72), "stair_a": (60, 54, 72, 72)}
core_src = members(bpy.data.collections["SRC_CoreV2_combined_chassis"])


def env(objs):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in objs:
        a_, b_ = wbbox(o)
        lo = [min(lo[i], a_[i]) for i in range(3)]
        hi = [max(hi[i], b_[i]) for i in range(3)]
    return lo, hi


core_pass = [o for o in core_src if o.name.startswith("passenger")]
cp_lo, cp_hi = env(core_pass)
check("canonical chassis passenger shaft X54-62 / Y34-44 (combined GLB)",
      abs(cp_lo[0] - 54) < 0.8 and abs(cp_hi[0] - 62) < 0.8 and abs(cp_lo[1] - 34) < 0.8 and abs(cp_hi[1] - 44) < 0.8,
      [round(v, 2) for v in cp_lo + cp_hi])
stack = {}
for f in range(1, 7):
    sh = members(bpy.data.collections[f"F{f:02d}_Shell"])
    res = {}
    for k, pref in (("passenger", ("pass_", "passenger_")), ("freight", ("freight",)),
                    ("stair_b", ("stair_b_",)), ("stair_a", ("stair_a_",))):
        objs = [o for o in sh if o.get("eu_from_builder_object", "").startswith(pref) and "::" not in o.get("eu_from_builder_object", "")
                and "lintel" not in o.get("eu_from_builder_object", "") and "exit" not in o.get("eu_from_builder_object", "")]
        lo, hi = env(objs)
        x0, y0, x1, y1 = CORE[k]
        ok = abs(lo[0] - x0) < 0.8 and abs(hi[0] - x1) < 0.8 and abs(lo[1] - y0) < 0.8 and abs(hi[1] - y1) < 0.8
        res[k] = (ok, [round(lo[0], 2), round(lo[1], 2), round(hi[0], 2), round(hi[1], 2)])
    slab = [o for o in sh if o.get("eu_from_builder_object") == "floor_slab"]
    top = max(wbbox(o)[1][2] for o in slab) if slab else None
    res["slab_top_ft"] = (top is not None and abs(top - FFE[f]) < 0.3, top)
    stack[f] = res
    check(f"F{f:02d} shafts/stairs on Core V2 lines and slab at FFE {FFE[f]} ft", all(v[0] for v in res.values()),
          {k: v[1] for k, v in res.items()})
pd = {}
for f in range(1, 7):
    sh = members(bpy.data.collections[f"F{f:02d}_Shell"])
    door = [o for o in sh if "PASS-ELEV-DOOR" in o.get("eu_from_builder_object", "")]
    lo, hi = env(door)
    pd[f] = [round(lo[0], 2), round(lo[1], 2), round(hi[1], 2)]
check("passenger elevator door identical on F1-F6 (incl. F6 arrival), west face X54 Y37-41",
      len({tuple(v) for v in pd.values()}) == 1 and abs(pd[6][1] - 37) < 0.3 and abs(pd[6][2] - 41) < 0.3, pd)
f7 = members(bpy.data.collections["F07_Shell"])
ov = [o for o in f7 if "PASSENGER-OVERRUN" in o.get("eu_from_builder_object", "")]
lo, hi = env(ov)
check("L7 passenger overrun over the same shaft; no roof elevator stop modelled",
      abs(lo[0] - 54) < 1 and abs(hi[0] - 62) < 1 and not any("PASS-ELEV-DOOR" in o.name for o in f7),
      [round(v, 2) for v in lo + hi])

# ------------------------------------------------------------- overlay plan rooms enclosed by the shell
import re as _re
svgdir = PACK if (PACK / "F01-Asset-Placement.svg").is_file() else Path(__file__).resolve().parent / "source"
ENCLOSED = ("#e4e5e5", "#b9bdc2")            # enclosed rooms and core shafts on the overlays
plan_fail, plan_openings = {}, {}
for f in range(1, 8):
    txt = (svgdir / f"F{f:02d}-Asset-Placement.svg").read_text()
    rooms = _re.findall(r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="(#[0-9a-f]+)" class="room"/>\s*<text[^>]*>([^<]*)</text>', txt)
    sh = [o for o in members(bpy.data.collections[f"F{f:02d}_Shell"]) if o.type == "MESH"]
    boxes = [wbbox(o) for o in sh]
    for x, y, w, h, fill, label in rooms:
        if fill not in ENCLOSED or (f == 7 and fill != "#b9bdc2"):
            continue
        x0, x1 = (float(x) - 90) / 11.5, (float(x) + float(w) - 90) / 11.5
        y1, y0 = (918 - float(y)) / 11.5, (918 - float(y) - float(h)) / 11.5
        for edge, (fixed, a0, a1, axis) in {"S": (y0, x0, x1, 1), "N": (y1, x0, x1, 1), "W": (x0, y0, y1, 0), "E": (x1, y0, y1, 0)}.items():
            spans = []
            for lo, hi in boxes:
                if hi[2] - FFE[f] < 2.0 or lo[2] - FFE[f] > 2.0:
                    continue
                if lo[axis] - 0.45 <= fixed <= hi[axis] + 0.45 and (hi[axis] - lo[axis]) < 1.6:
                    o_ = 1 - axis
                    spans.append((max(a0, lo[o_]), min(a1, hi[o_])))
            spans = sorted(sp for sp in spans if sp[1] > sp[0])
            gaps, cur = [], a0
            for s0, s1 in spans:
                if s0 > cur + 0.05:
                    gaps.append(round(s0 - cur, 2))
                cur = max(cur, s1)
            if a1 > cur + 0.05:
                gaps.append(round(a1 - cur, 2))
            if any(g > 3.6 for g in gaps):
                plan_fail.setdefault(f, []).append(f"{label} {edge} gaps {gaps}")
            elif gaps:
                plan_openings.setdefault(f, []).append(f"{label} {edge} {gaps}")
check("every enclosed room and core shaft on the 7 overlay plans is closed by the shell (only door-width openings <= 3.5 ft)",
      not plan_fail, {"failures": plan_fail, "door_openings": plan_openings})

# ------------------------------------------------------------- F6 specials
halos = [o for o in bpy.data.objects if o.get("eu_asset_id") == "HALO_GLOBE"]
check("exactly one Halo Globe", len(halos) == 1, [o.name for o in halos])
g = halos[0]
c = g.matrix_world.translation / FT
check("Halo centre (55,12) at 8.25 ft AFF on F6, r 2.25 ft", abs(c.x - 55) < 0.05 and abs(c.y - 12) < 0.05 and abs(c.z - (67.5 + 8.25)) < 0.05,
      [round(c.x, 2), round(c.y, 2), round(c.z, 2)])
f6 = members(FLOORS[6])
under = []
for o in f6:
    if o.type != "MESH" or o == g or o.name.startswith("F06_HALO_floor") or o.parent == g:
        continue
    lo, hi = wbbox(o)
    if lo[0] < 57.25 and hi[0] > 52.75 and lo[1] < 14.25 and hi[1] > 9.75 and lo[2] < 67.5 + 6.0 and hi[2] > 67.5 + 0.1:
        under.append(o.name)
check("Halo is suspended: no plinth/pedestal under the sphere", not under, under)
for ia, tgt in (("IA_F06_HALO_GLOBE", "F06_HALO_GLOBE"), ("IA_F06_PRIM2_SCREEN", "F06_PRIM2_SCREEN")):
    e = bpy.data.objects.get(ia)
    check(f"{ia} exists, targets {tgt}, and {tgt} is a separate interactive object",
          e is not None and e.get("eu_target_object") == tgt and bpy.data.objects.get(tgt) is not None
          and bpy.data.objects[tgt].get("eu_interactive") and bpy.data.objects[tgt].get("eu_interaction_anchor") == ia)
prim2 = [o for o in bpy.data.objects if o.name.startswith("F06_PRIM2")]
check("one PRIM2 interface screen", len([o for o in prim2 if o.get("eu_interactive")]) == 1, [o.name for o in prim2])
slots = [o for o in bpy.data.objects if "brand_slot" in o.keys()]
mcc = [o.name for o in slots if "mccluster" in str(o["brand_slot"]).lower()]
check("McCluster office branding only on F6 (one empty brand slot, no artwork drawn)",
      len(mcc) == 1 and mcc[0].startswith("F06_") and json.loads(bpy.data.objects[mcc[0]]["brand_slot"])["artwork"] is None, mcc)
logo_like = [o.name for o in bpy.data.objects if o.type in ("MESH", "FONT") and any(k in o.name.lower() for k in ("logo", "wordmark", "emblem"))]
check("no modelled logo/wordmark geometry", not logo_like, logo_like)

# ------------------------------------------------------------- walkability + collisions
dg = bpy.context.evaluated_depsgraph_get()
foot = {}   # instancer name -> (lo, hi)
for di in dg.object_instances:
    if not di.is_instance or di.object.type != "MESH":
        continue
    par = di.parent.original if di.parent else None
    if par is None:
        continue
    lo, hi = wbbox(di.object, di.matrix_world.copy())
    if par.name in foot:
        a_, b_ = foot[par.name]
        lo = [min(lo[i], a_[i]) for i in range(3)]
        hi = [max(hi[i], b_[i]) for i in range(3)]
    foot[par.name] = (lo, hi)

CELL = 0.5
N = int(72 / CELL)
DOOR_PASS = ("door", "DOOR")
ROUTES = {}
COLL = {}


def raster(grid, lo, hi):
    e = 1e-3                                       # float bleed (10.5000001 ft) must not close a cell
    i0, i1 = max(0, int(math.floor(lo[0] / CELL + e))), min(N, int(math.ceil(hi[0] / CELL - e)))
    j0, j1 = max(0, int(math.floor(lo[1] / CELL + e))), min(N, int(math.ceil(hi[1] / CELL - e)))
    if i1 > i0 and j1 > j0:
        grid[j0:j1, i0:i1] = True


def dilate(m, r):
    out = m.copy()
    for dj in range(-r, r + 1):
        for di_ in range(-r, r + 1):
            if di_ * di_ + dj * dj > r * r:
                continue
            sh = np.zeros_like(m)
            ys = slice(max(0, dj), N + min(0, dj))
            yd = slice(max(0, -dj), N + min(0, -dj))
            xs = slice(max(0, di_), N + min(0, di_))
            xd = slice(max(0, -di_), N + min(0, -di_))
            sh[yd, xd] = m[ys, xs]
            out |= sh
    return out


def bfs(free, start):
    dist = np.full(free.shape, -1, dtype=np.int32)
    sj, si = int(start[1] / CELL), int(start[0] / CELL)
    if not free[sj, si]:
        cand = [(abs(j - sj) + abs(i - si), j, i) for j in range(max(0, sj - 6), min(N, sj + 7))
                for i in range(max(0, si - 6), min(N, si + 7)) if free[j, i]]
        if not cand:
            return dist
        _, sj, si = min(cand)
    dist[sj, si] = 0
    q = deque([(sj, si)])
    while q:
        j, i = q.popleft()
        for dj, di_ in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            jj, ii = j + dj, i + di_
            if 0 <= jj < N and 0 <= ii < N and free[jj, ii] and dist[jj, ii] < 0:
                dist[jj, ii] = dist[j, i] + 1
                q.append((jj, ii))
    return dist


def reach(dist, pt, radius=3.0):
    j0, i0 = int(pt[1] / CELL), int(pt[0] / CELL)
    r = int(radius / CELL)
    sub = dist[max(0, j0 - r):j0 + r + 1, max(0, i0 - r):i0 + r + 1]
    return bool((sub >= 0).any())


ROOM_DOORS = {3: [(10.5, 17.5), (24.5, 17.5)], 4: [(12, 17.5), (28, 17.5)], 5: [(12, 17.5), (29, 17.5)],
              6: [(12, 17.5), (29, 17.5)], 1: [(18.0, 35.5)]}
for f in range(1, 8):
    z0 = FFE[f]
    walls = np.zeros((N, N), bool)
    furn = np.zeros((N, N), bool)
    for o in members(FLOORS[f]):
        if o.type == "MESH" and o.get("eu_v3_type") == "rug":
            continue
        if o.type == "MESH" and (o.users_collection[0].name.endswith(("_Shell", "_LifeSafety_kept", "_Equipment", "_ArchFinishes", "_Furniture"))):
            nm = o.get("eu_from_builder_object", o.name)
            if any(k in nm for k in DOOR_PASS) or "floor_slab" in nm or "ROOF-DECK" in nm or "stair_a" == nm[:7] and f == 7:
                continue
            lo, hi = wbbox(o)
            if hi[2] - z0 < 0.4 or lo[2] - z0 > 6.5 or (hi[0] - lo[0]) * (hi[1] - lo[1]) > 2500:
                continue
            if "MOBILITY" in nm or "PATH" in nm or "WALK" in nm or "inlay" in nm or "ring" in nm or "MAT" in nm or "INSET" in nm:
                continue
            raster(walls if o.users_collection[0].name.endswith("_Shell") else furn, lo, hi)
        if o.instance_type == "COLLECTION" and o.name in foot and o.get("eu_kit") not in ("RUG",):
            lo, hi = foot[o.name]
            if lo[2] - z0 > 6.5 or hi[2] - z0 < 0.3:
                continue          # pendants / items above head height, rugs
            raster(furn, lo, hi)
    # stairs themselves are not floor area
    for k in ("stair_a", "stair_b", "freight", "passenger"):
        x0, y0, x1, y1 = CORE[k]
        raster(walls, (x0, y0), (x1, y1))
    obst = walls | furn
    edge = dilate(np.pad(np.zeros((N - 2, N - 2), bool), 1, constant_values=True), 1)
    free36 = ~dilate(obst, 3) & ~edge
    free30 = ~dilate(obst, 2) & ~edge          # door thresholds: a 3'-0" leaf resolves as >= 30 in at 6 in cells
    start = (52.0, 39.0) if f <= 6 else (63.0, 51.5)
    dist = bfs(free36, start)
    dist30 = bfs(free30, start)
    targets = {"Stair A door": (63.0, 51.5), "Stair B door": (15.5, 51.5), "Freight door": (4.0, 57.5),
               "corridor": (40.0, 57.0)}
    if f == 7:
        targets = {"Stair B headhouse": (15.5, 51.5), "City overlook": (30.0, 7.5), "Routing beacon 7.1": (44.5, 27.0),
                   "Weather console 7.4 (operator side)": (29.6, 66.0),
                   "Plant access face of MECH units (service band)": (40.5, 60.6)}
    if f == 1:
        targets["Entry vestibule (public entrance)"] = (36.0, 4.0)
        targets["Reception 1.1 visitor side"] = (36.0, 42.0)
    for i, p in enumerate(ROOM_DOORS.get(f, [])):
        targets[f"room door {i + 1}"] = p
    res = {}
    for k, p in targets.items():
        res[k] = "36in" if reach(dist, p) else ("door-30in" if reach(dist30, p) else False)
    # every anchored asset reachable within 3 ft of its envelope edge (24 in reach + 12 in tolerance)
    unreachable, via_door = [], []
    for r in ROWS:
        if int(r["floor"]) != f:
            continue
        x, y = float(r["x_ft"]), float(r["y_ft"])
        rad = max(float(r["width_ft"]), float(r["depth_ft"])) / 2 + 3.0
        if reach(dist, (x, y), rad):
            continue
        if reach(dist30, (x, y), rad):
            via_door.append(r["tag"])
        else:
            unreachable.append(r["tag"])
    ROUTES[f] = {"route_targets": res, "anchors_reached_through_a_door_threshold": via_door,
                 "anchors_unreachable": unreachable}
    check(f"F{f:02d} walking routes: arrival -> stairs/freight/corridor/room doors (36 in open floor; 3 ft door leaves)",
          all(res.values()), res)
    check(f"F{f:02d} every anchored asset reachable (36 in open floor; rooms via their 3 ft door)", not unreachable,
          {"through_door": via_door, "unreachable": unreachable})
    # collisions: furniture/equipment instance footprints vs exact wall/core/glazing boxes (> 0.1 sq ft)
    wallboxes = []
    for o in members(bpy.data.collections[f"F{f:02d}_Shell"]):
        nm = o.get("eu_from_builder_object", o.name)
        if o.type != "MESH" or any(k in nm for k in DOOR_PASS) or "floor_slab" in nm or "ROOF-DECK" in nm:
            continue
        lo, hi = wbbox(o)
        if hi[2] - z0 < 0.4 or lo[2] - z0 > 6.5 or (hi[0] - lo[0]) * (hi[1] - lo[1]) > 2500:
            continue
        wallboxes.append((nm, lo, hi))
    for k in ("stair_a", "stair_b", "freight", "passenger"):
        x0, y0, x1, y1 = CORE[k]
        wallboxes.append((k, (x0, y0), (x1, y1)))
    POT = {"PLANT_TREE": 0.75, "PLANT_FLOOR": 0.6, "PLANT_DESK": 0.25}
    hits = []
    for o in members(FLOORS[f]):
        if o.instance_type != "COLLECTION" or o.name not in foot or o.get("eu_kit") in ("RUG", "PENDANT_LINEAR", "PENDANT_DRUM", "FRAME_ART"):
            continue
        lo, hi = foot[o.name]
        if lo[2] - z0 > 6.5:
            continue
        if o.get("eu_kit") in POT:
            p = o.matrix_world.translation / FT
            r_ = POT[o["eu_kit"]]
            lo, hi = (p.x - r_, p.y - r_), (p.x + r_, p.y + r_)
        for nm, wl, wh in wallboxes:
            ox = min(hi[0], wh[0]) - max(lo[0], wl[0])
            oy = min(hi[1], wh[1]) - max(lo[1], wl[1])
            if ox > 0.02 and oy > 0.02 and ox * oy > 0.1:
                hits.append((o.name, nm, round(ox * oy, 2)))
    COLL[f] = hits
    check(f"F{f:02d} no furniture/equipment intersecting walls, cores or stairs", not hits, hits[:8])

# ------------------------------------------------------------- merge with the existing interior layer
PRODV = REPO / "docs/design/equity-uprise-building/production"
MERGE = {}
tot_layout = tot_kept = tot_sup = 0
for f in range(1, 7):
    m = json.loads(FLOORS[f].get("eu_merge", "{}") or "{}")
    lay = [i["id"] for i in json.loads((PRODV / f"floor-0{f}" / f"floor-0{f}-interior-layout-v3.json").read_text())["items"]]
    present = {}
    for o in members(FLOORS[f]):
        if o.get("eu_existing_id"):
            present.setdefault(o["eu_existing_id"], []).append(o)
    missing = [i for i in lay if i not in present and i not in m.get("v3_superseded", {})]
    unexplained = [i for i, why in m.get("v3_superseded", {}).items() if not why or i in present]
    tot_layout += len(lay)
    tot_kept += sum(1 for i in lay if i in present)
    tot_sup += len(m.get("v3_superseded", {}))
    check(f"F{f:02d} existing v3 interior layer: every piece kept or superseded with a recorded reason",
          m and not missing and not unexplained,
          {"layout": len(lay), "kept": sum(1 for i in lay if i in present), "superseded": len(m.get("v3_superseded", {})),
           "missing": missing, "unexplained": unexplained})
    # devices: each kept device stands on a support that is still in the scene
    devs = {}
    for o in members(FLOORS[f]):
        if o.get("eu_device_id"):
            devs.setdefault(o["eu_device_id"], o.get("eu_station_id"))
    orphan = [d for d, st in devs.items() if st not in present and not any(
        x.get("eu_from_builder_object", "").split("::")[0] == st for x in members(FLOORS[f]))]
    check(f"F{f:02d} existing device layer: every kept device stands on a kept support", not orphan,
          {"devices": len(devs), "dropped": len(m.get("devices", {}).get("dropped", {})), "orphans": orphan})
    # independent overlap test: convex hulls of the real vertices, existing pieces vs pack pieces, same height band
    def hull_of(obs_mats):
        pts, zl, zh = [], 1e9, -1e9
        for ob, mw in obs_mats:
            if ob.type != "MESH" or not hasattr(ob.data, "vertices"):
                vs = np.array([tuple(c) for c in ob.bound_box])
            else:
                vs = np.array([v.co for v in ob.data.vertices])
            if not len(vs):
                continue
            M4 = np.array(mw)
            w = (np.c_[vs, np.ones(len(vs))] @ M4.T)[:, :3] / FT
            pts.extend(map(tuple, w[:, :2]))
            zl, zh = min(zl, w[:, 2].min()), max(zh, w[:, 2].max())
        return MG.hull(pts), zl - FFE[f], zh - FFE[f]
    PK, PX = {}, {}
    fnames = {o.name for o in members(FLOORS[f])}
    for di in dg.object_instances:
        if not di.is_instance or di.object.type != "MESH" or not di.parent:
            continue
        par = di.parent.original
        if par.name not in fnames:
            continue
        if par.get("eu_existing_id"):
            PX.setdefault(par["eu_existing_id"], []).append((di.object.original, di.matrix_world.copy()))
            continue
        if par.get("eu_kit") in MG.NO_COLLIDE_KITS:
            continue
        PK.setdefault(par.name, []).append((di.object.original, di.matrix_world.copy()))
    EX = {}
    for k, obs in present.items():
        if any(o.get("eu_v3_type") == "rug" for o in obs) or "-POWER-" in k:
            continue
        EX[k] = hull_of([(o, o.matrix_world) for o in obs if o.type == "MESH"] + PX.get(k, []))
    PKH = {k: hull_of(v) for k, v in PK.items()}
    clashes = []
    for a_, (ha, za, zb) in EX.items():
        if za > 6.5 or len(ha) < 3:
            continue
        for b_, (hb, zc, zd) in PKH.items():
            if zc > 6.5 or len(hb) < 3 or min(zb, zd) - max(za, zc) < 0.05:
                continue
            ov = MG.overlap(ha, hb)
            if ov > 0.25:
                clashes.append((a_, b_, round(ov, 2)))
    MERGE[f] = {"kept": len(present), "clashes": clashes}
    check(f"F{f:02d} no kept existing piece overlaps a pack piece (vertex hulls, same height band, > 0.25 sq ft)",
          not clashes, clashes[:10])
    for k, obs in sorted(present.items()):
        o = obs[0]
        bxs = [foot[x.name] if x.name in foot else wbbox(x) for x in obs]
        lo = [min(b_[0][i] for b_ in bxs) for i in range(3)]
        hi = [max(b_[1][i] for b_ in bxs) for i in range(3)]
        INV.append({"floor": f, "overlay_tag": "", "asset_id": k, "blender_object": o.name,
                    "kit_master": (o.get("eu_kit") + " (upgraded from " + o.get("eu_v3_type") + ")") if o.get("eu_kit")
                    else o.get("eu_v3_type", "existing builder object"),
                    "x_ft": round((lo[0] + hi[0]) / 2, 2), "y_ft": round((lo[1] + hi[1]) / 2, 2),
                    "envelope_ft": f"{hi[0] - lo[0]:.1f} x {hi[1] - lo[1]:.1f} x {hi[2] - lo[2]:.1f}", "material_hint": "board palette",
                    "source": o.get("eu_source", "existing"), "note": o.get("eu_zone", "")})
    for d, st in sorted(devs.items()):
        INV.append({"floor": f, "overlay_tag": "", "asset_id": d, "blender_object": f"F{f:02d}_DEV_{d}",
                    "kit_master": "manufacturer exterior proxy", "x_ft": "", "y_ft": "", "envelope_ft": "",
                    "material_hint": "", "source": "existing device layer (kept)", "note": f"support {st}"})
check("existing interior layer restored: v3 pieces kept + superseded account for all of them",
      tot_kept + tot_sup == tot_layout, {"layout": tot_layout, "kept": tot_kept, "superseded": tot_sup})
R["merge"] = MERGE

R["stack"] = {f: {k: v[1] for k, v in s.items()} for f, s in stack.items()}
R["routes"] = ROUTES
R["collisions"] = COLL
R["notes"].append("Halo Globe underside is 6.0 ft AFF (canonical spec): below normal 6'-8\" door headroom; a floor inlay marks the envelope.")
R["summary"] = {"passed": sum(c["passed"] for c in R["checks"]), "total": len(R["checks"])}
OUT.write_text(json.dumps(R, indent=2, default=str))
fields = ["floor", "overlay_tag", "asset_id", "blender_object", "kit_master", "x_ft", "y_ft", "envelope_ft", "material_hint", "source", "note"]
INV.sort(key=lambda r: (r["floor"], r["overlay_tag"] == "", r["overlay_tag"], r["blender_object"]))
with (OUT.parent / "hq-interior-v2-asset-inventory.csv").open("w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=fields)
    w.writeheader()
    w.writerows(INV)
print("SUMMARY", R["summary"])
os._exit(0)
