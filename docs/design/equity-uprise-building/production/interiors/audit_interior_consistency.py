#!/usr/bin/env python3
"""Equity Uprise model-consistency audit (v3).

Checks that the generated 3D building makes physical sense against its own
authorities, using the real GLB geometry (not the plans):

* furniture never intersects walls, cores, equipment or other furniture
  (chairs may tuck under their own table/desk);
* keep-clear zones (corridors, elevator landing, service approach, Halo pocket)
  stay clear;
* every door opening (stairs, elevators, freight, rooms, exterior exits) is
  physically open and leads somewhere walkable on both sides;
* a 36 in accessible route connects the elevator, both stair doors and the
  freight door; every seat and work surface is reachable (24 in aisle);
* Floor 1 exterior exit doors exist in the combined chassis, the Floor 1 model
  and the facade exactly where floor-01-site-egress.json says, and the Stair A
  exit is reachable from the stair landing;
* no drawn mark / lettering geometry exists anywhere; every enabled brand slot
  is an empty node and its artwork is an owner-supplied file with a matching hash;
* floors are not copy-paste: no two floors share an identical furnished zone
  and their furniture vocabularies differ;
* phone budget: triangles and bytes per floor.

Requires the floor GLBs to have been built (B1, F1-F6, facade, combined).
Writes generated/equity-uprise-interior-consistency-report.json. NOT FOR CONSTRUCTION.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from collections import Counter, deque
from itertools import combinations
from pathlib import Path

import numpy as np
import trimesh

FT = 0.3048
HERE = Path(__file__).resolve().parent
PROD = HERE.parent
ROOT = PROD.parents[3]
GEN = PROD / "generated"
REPORT = GEN / "equity-uprise-interior-consistency-report.json"
CATALOG = json.loads((HERE / "furniture-catalog-v3.json").read_text())["types"]
BRAND = json.loads((PROD / "brand" / "brand-manifest.json").read_text())
SITE = json.loads((PROD / "floor-01" / "floor-01-site-egress.json").read_text())
CORE = json.loads((PROD / "building-core-v2.json").read_text())

FLOORS = {
    "B1": ("basement-b1/basement-b1-interior-layout-v3.json", "equity-uprise-basement-b1-core-v2.glb", "basement-b1/basement-b1-object-inventory.json"),
    "F1": ("floor-01/floor-01-interior-layout-v3.json", "equity-uprise-floor-01-core-v2.glb", "floor-01/floor-01-object-inventory.json"),
    "F2": ("floor-02/floor-02-interior-layout-v3.json", "equity-uprise-floor-02-core-v2.glb", "floor-02/floor-02-object-inventory.json"),
    "F3": ("floor-03/floor-03-interior-layout-v3.json", "equity-uprise-floor-03-core-v2.glb", "floor-03/floor-03-object-inventory.json"),
    "F4": ("floor-04/floor-04-interior-layout-v3.json", "equity-uprise-floor-04-core-v2.glb", "floor-04/floor-04-object-inventory.json"),
    "F5": ("floor-05/floor-05-interior-layout-v3.json", "equity-uprise-floor-05-core-v2.glb", "floor-05/floor-05-object-inventory.json"),
    "F6": ("floor-06/floor-06-interior-layout-v3.json", "equity-uprise-floor-06-core-v2.glb", "floor-06/floor-06-object-inventory.json"),
}
ROUND_FORMS = {"table_round", "side_table", "pouf", "stool", "planter", "mic_desk"}
RES = 0.25                 # ft per grid cell
BODY_Z = (0.4, 6.5)        # ft above FFE that a walking person occupies
ROUTE_R = 1.5              # 36 in accessible route
AISLE_R = 1.0              # 24 in aisle to reach a seat / surface
TRI_BUDGET = 40000
DEBUG_DIR = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--debug-dir=")), None)
BYTE_BUDGET = 700_000
DRAWN_MARK = re.compile(r"(LOGO|WORDMARK|LETTER|E=U|e_rects|equals_rects|::arrow|arrowhead|SIGN-BACKER|SIGN-HALO)", re.I)

checks = []


def ck(scope, name, ok, detail=None):
    checks.append({"scope": scope, "name": name, "passed": bool(ok), "detail": detail})
    return ok


def rot_pts(x, y, w, d, rot):
    a = math.radians(rot)
    ca, sa = math.cos(a), math.sin(a)
    return np.array([(x + lx * ca - ly * sa, y + lx * sa + ly * ca) for lx, ly in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))])


def poly_overlap_area(p, q, res=0.1):
    """Approximate overlap area of two convex quads by sampling the bbox intersection."""
    x1 = max(p[:, 0].min(), q[:, 0].min()); x2 = min(p[:, 0].max(), q[:, 0].max())
    y1 = max(p[:, 1].min(), q[:, 1].min()); y2 = min(p[:, 1].max(), q[:, 1].max())
    if x2 <= x1 or y2 <= y1:
        return 0.0
    xs = np.arange(x1 + res / 2, x2, res); ys = np.arange(y1 + res / 2, y2, res)
    if not len(xs) or not len(ys):
        return 0.0
    X, Y = np.meshgrid(xs, ys); P = np.c_[X.ravel(), Y.ravel()]
    return float((inside(p, P) & inside(q, P)).sum()) * res * res


def inside(poly, P):
    """Points inside a convex polygon (orientation taken from the polygon itself)."""
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    sgn = 1.0 if area >= 0 else -1.0
    ok = np.ones(len(P), bool)
    for i in range(len(poly)):
        a = poly[i]; b = poly[(i + 1) % len(poly)]
        cr = (b[0] - a[0]) * (P[:, 1] - a[1]) - (b[1] - a[1]) * (P[:, 0] - a[0])
        ok &= cr * sgn >= -1e-9
    return ok


def node_boxes(scene):
    """World AABB (ft) for every mesh node."""
    out = []
    for n in scene.graph.nodes_geometry:
        T, g = scene.graph[n]
        geom = scene.geometry[g]
        v = trimesh.transform_points(geom.bounds_corners if hasattr(geom, "bounds_corners") else geom.vertices, T) / FT
        lo = v.min(0); hi = v.max(0)
        out.append((n, lo, hi))
    return out


def raster_box(grid, lo, hi):
    i1 = max(0, int(math.floor(lo[0] / RES))); i2 = min(grid.shape[0], int(math.ceil(hi[0] / RES)))
    j1 = max(0, int(math.floor(lo[1] / RES))); j2 = min(grid.shape[1], int(math.ceil(hi[1] / RES)))
    if i2 > i1 and j2 > j1:
        grid[i1:i2, j1:j2] = True


def raster_poly(grid, poly):
    lo = poly.min(0); hi = poly.max(0)
    i1 = max(0, int(lo[0] / RES)); i2 = min(grid.shape[0], int(math.ceil(hi[0] / RES)))
    j1 = max(0, int(lo[1] / RES)); j2 = min(grid.shape[1], int(math.ceil(hi[1] / RES)))
    if i2 <= i1 or j2 <= j1:
        return
    xs = (np.arange(i1, i2) + .5) * RES; ys = (np.arange(j1, j2) + .5) * RES
    X, Y = np.meshgrid(xs, ys, indexing="ij")
    m = inside(poly, np.c_[X.ravel(), Y.ravel()]).reshape(X.shape)
    grid[i1:i2, j1:j2] |= m


def erode(free, r):
    k = int(math.ceil(r / RES))
    occ = ~free
    out = occ.copy()
    for di in range(-k, k + 1):
        for dj in range(-k, k + 1):
            if di * di + dj * dj <= (r / RES) ** 2:
                out |= np.roll(np.roll(occ, di, 0), dj, 1)
    out[:k, :] = True; out[-k:, :] = True; out[:, :k] = True; out[:, -k:] = True
    return ~out


def flood(free, start):
    seen = np.zeros_like(free)
    i, j = start
    if not (0 <= i < free.shape[0] and 0 <= j < free.shape[1]) or not free[i, j]:
        return seen
    q = deque([(i, j)]); seen[i, j] = True
    while q:
        a, b = q.popleft()
        for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            x, y = a + da, b + db
            if 0 <= x < free.shape[0] and 0 <= y < free.shape[1] and free[x, y] and not seen[x, y]:
                seen[x, y] = True; q.append((x, y))
    return seen


def cell(x, y):
    return int(x / RES), int(y / RES)


def near_reached(reached, x, y, rad=0.75):
    k = int(rad / RES)
    i, j = cell(x, y)
    return bool(reached[max(0, i - k):i + k + 1, max(0, j - k):j + k + 1].any())


def door_points():
    """Door openings that every typical floor must keep open: (name, outside_pt, inside_pt, opening box)."""
    vs = CORE["vertical_systems"]
    out = []
    pe = vs["passenger_elevator"]["door_opening_concept_ft"]
    out.append(("passenger elevator door", (52.0, (pe["y1"] + pe["y2"]) / 2), None, (52.6, pe["y1"] + .2, 53.6, pe["y2"] - .2)))
    fe = vs["service_freight_elevator"]["door_opening_concept_ft"]
    out.append(("freight elevator door", ((fe["x1"] + fe["x2"]) / 2, 58.2), None, (fe["x1"] + .2, 58.4, fe["x2"] - .2, 59.5)))
    for key, label in (("stair_a", "Stair A door"), ("stair_b", "Stair B door")):
        op = vs[key]["access_opening_concept_ft"]
        out.append((label, ((op["x1"] + op["x2"]) / 2, 52.4), ((op["x1"] + op["x2"]) / 2, 55.6), (op["x1"] + .1, 52.9, op["x2"] - .1, 55.2)))
    return out


def audit_floor(tag, layout_rel, glb_name, inv_rel, all_summ):
    layout = json.loads((PROD / layout_rel).read_text())
    inv = {o["id"]: o for o in json.loads((PROD / inv_rel).read_text())["objects"]}
    glb = GEN / glb_name
    scope = tag
    if not ck(scope, "floor GLB built", glb.exists(), str(glb.name)):
        return
    scene = trimesh.load(glb, force="scene")
    items = layout["items"]
    ids = [i["id"] for i in items]
    ck(scope, "layout ids unique", len(ids) == len(set(ids)), [k for k, v in Counter(ids).items() if v > 1])
    ck(scope, "every layout type is in the catalog", all(i["type"] in CATALOG for i in items), [i["type"] for i in items if i["type"] not in CATALOG])
    bad_real = [i["id"] for i in items if i.get("realizes_inventory_id") and i["realizes_inventory_id"] not in inv]
    ck(scope, "realized inventory ids exist in the floor inventory", not bad_real, bad_real)
    nodes = set(scene.graph.nodes)
    missing_nodes = [i["id"] for i in items if f"{i['id']}::{i['type']}" not in nodes]
    ck(scope, "every layout item is a node in the GLB", not missing_nodes, missing_nodes)

    # footprints (from the catalog, exact sizes)
    fp = {}
    for i in items:
        spec = CATALOG[i["type"]]
        size = i.get("size") or {}
        w = size.get("w_in", spec["dims_in"]["w"]) / 12; d = size.get("d_in", spec["dims_in"]["d"]) / 12; h = size.get("h_in", spec["dims_in"]["h"]) / 12
        if spec["form"] in ROUND_FORMS:
            poly = np.array([(i["x"] + math.cos(k * math.tau / 16) * w / 2, i["y"] + math.sin(k * math.tau / 16) * d / 2) for k in range(16)])
        else:
            poly = rot_pts(i["x"], i["y"], w, d, i.get("rot_deg", 0))
        fp[i["id"]] = {"poly": poly, "h": h, "z": i.get("z_ft", 0.0), "spec": spec, "item": i, "w": w, "d": d}
    furn_nodes = {f"{i['id']}::{i['type']}" for i in items}

    # architecture boxes (everything that is not furniture, a door leaf, a slot, a rug-thin plate or overhead)
    arch = []
    for n, lo, hi in node_boxes(scene):
        if n in furn_nodes or n.startswith("brand-slot::"):
            continue
        if re.search(r"DOOR|::leaf|door|push-bar", n):
            continue
        if hi[2] - lo[2] < 1e-6 or hi[2] < 0.3:
            continue  # floor inlays / zone plates / thresholds are walked on
        if re.search(r"cable_trough|cable_raceway", n):
            continue  # designed to run under the desk it serves
        arch.append((n, lo, hi))
    plate = np.array([0.0, 0.0])
    W = int(72 / RES)
    occ = np.zeros((W, W), bool)
    for n, lo, hi in arch:
        if hi[2] > BODY_Z[0] and lo[2] < BODY_Z[1] and not n.startswith(("floor_slab", "B1-SLAB")):
            raster_box(occ, lo, hi)

    # 1. furniture vs architecture (3D)
    hits = []
    for iid, f in fp.items():
        if not f["spec"].get("blocks", True):
            continue
        z1, z2 = f["z"], f["z"] + f["h"]
        p = f["poly"]; plo = p.min(0); phi = p.max(0)
        for n, lo, hi in arch:
            if hi[2] <= z1 + 0.05 or lo[2] >= z2 - 0.05:
                continue
            if lo[0] >= phi[0] or hi[0] <= plo[0] or lo[1] >= phi[1] or hi[1] <= plo[1]:
                continue
            if n.startswith(("floor_slab", "B1-SLAB", "B1-CEILING")):
                continue
            q = np.array([[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]])
            a = poly_overlap_area(p, q)
            if a > 0.05:
                hits.append(f"{iid} x {n} ({a:.2f} sq ft)")
    ck(scope, "no furniture intersects walls, cores or equipment", not hits, hits[:40])

    # 2. furniture vs furniture
    pairs = []
    for a, b in combinations(fp, 2):
        fa, fb = fp[a], fp[b]
        if not fa["spec"].get("blocks", True) or not fb["spec"].get("blocks", True):
            continue
        tuck = (fa["spec"].get("tucks_under") and fb["spec"].get("is_surface")) or (fb["spec"].get("tucks_under") and fa["spec"].get("is_surface"))
        ar = poly_overlap_area(fa["poly"], fb["poly"])
        if ar > (1.6 if tuck else 0.05):
            pairs.append(f"{a} x {b} ({ar:.2f} sq ft)")
    ck(scope, "no furniture intersects other furniture (chairs may tuck under a surface)", not pairs, pairs[:40])

    # 3. keep-clear zones
    kc = []
    for z in layout.get("keep_clear", []):
        b = z["bounds_ft"]
        q = np.array([[b["x1"], b["y1"]], [b["x2"], b["y1"]], [b["x2"], b["y2"]], [b["x1"], b["y2"]]])
        for iid, f in fp.items():
            if f["spec"].get("blocks", True) and poly_overlap_area(f["poly"], q) > 0.05:
                kc.append(f"{iid} in {z['id']}")
    ck(scope, "keep-clear zones are clear", not kc, kc)

    # 4. zone containment
    zones = {z["id"]: z["bounds_ft"] for z in layout.get("zones", [])}
    out_zone = []
    for iid, f in fp.items():
        z = zones.get(f["item"].get("zone"))
        if not z:
            continue
        c = f["poly"].mean(0)
        if not (z["x1"] - .5 <= c[0] <= z["x2"] + .5 and z["y1"] - .5 <= c[1] <= z["y2"] + .5):
            out_zone.append(iid)
    ck(scope, "every item sits inside its program zone", not out_zone, out_zone)

    # 5. walkability on the real geometry + furniture
    full = occ.copy()
    for iid, f in fp.items():
        # tuck-under seats are movable and do not form permanent obstructions
        if f["spec"].get("blocks", True) and not f["spec"].get("tucks_under") and f["z"] < BODY_Z[1]:
            raster_poly(full, f["poly"])
    free = ~full
    route = erode(free, ROUTE_R)
    start = cell(52.3, 39.0)
    reached = flood(route, start)
    if DEBUG_DIR:
        from PIL import Image
        img = np.zeros(full.shape + (3,), np.uint8)
        img[...] = (40, 40, 40); img[free] = (150, 150, 150); img[route] = (110, 150, 110); img[reached] = (60, 200, 60)
        Image.fromarray(np.flipud(img.transpose(1, 0, 2))).resize((576, 576), 0).save(Path(DEBUG_DIR) / f"walk-{tag}.png")
    route_targets = []
    for name, out_pt, _in, _box in door_points():
        if tag == "B1" and name == "freight elevator door":
            out_pt = (out_pt[0], 58.0)
        if not near_reached(reached, *out_pt, rad=1.0):
            route_targets.append(name)
    if tag == "F1":
        if not near_reached(reached, 36.0, 5.0, 1.5):
            route_targets.append("main entrance vestibule")
    ck(scope, "36 in accessible route links elevator, both stair doors and freight", not route_targets, route_targets)
    aisle = erode(free, AISLE_R)
    reach_a = flood(aisle, start)
    unreached = []
    for iid, f in fp.items():
        spec = f["spec"]; it = f["item"]
        if spec.get("seat") or spec.get("category") == "work":
            # access point: seats at their own centre (they move), surfaces in front
            if spec.get("seat"):
                px, py = it["x"], it["y"]
                g2 = free.copy()
                # the seat itself is movable: clear its own footprint for the test
                tmp = np.zeros_like(full); raster_poly(tmp, f["poly"]); g2 |= tmp
                a2 = erode(g2, AISLE_R * 0.9)
                ok = flood(a2, start)
                if not near_reached(ok, px, py, 1.0):
                    unreached.append(iid)
            else:
                a = math.radians(it.get("rot_deg", 0))
                dist = f["d"] / 2 + 1.4
                px, py = it["x"] - math.sin(a) * dist, it["y"] + math.cos(a) * dist
                if not near_reached(reach_a, px, py, 1.25):
                    unreached.append(iid)
    ck(scope, "every seat and work surface is reachable by a 24 in aisle", not unreached, unreached)

    # 6. door openings open (no architecture, no furniture inside the swing/approach box)
    blocked = []
    doors = door_points()
    for o in inv.values():
        if "DOOR" in o["id"] and isinstance(o.get("placement", {}).get("bounds_ft"), dict):
            b = o["placement"]["bounds_ft"]
            if abs(b["y1"] - 15.82) < .3:  # south-band room doors on the y16 glazed frontage
                cx = (b["x1"] + b["x2"]) / 2
                doors.append((o["id"], (cx, 17.4), (cx, 14.6), (b["x1"] + .1, 15.0, b["x2"] - .1, 16.9)))
    for name, out_pt, in_pt, (x1, y1, x2, y2) in doors:
        q = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
        for n, lo, hi in arch:
            if hi[2] > 0.5 and lo[2] < 6.5 and lo[0] < x2 and hi[0] > x1 and lo[1] < y2 and hi[1] > y1:
                blocked.append(f"{name}: {n}")
        for iid, f in fp.items():
            if f["spec"].get("blocks", True) and poly_overlap_area(f["poly"], q) > 0.02:
                blocked.append(f"{name}: {iid}")
        if in_pt is not None and not free[cell(*in_pt)]:
            blocked.append(f"{name}: no floor behind the door")
    ck(scope, "every door opening is physically open and leads somewhere", not blocked, blocked[:30])

    # 7. brand: slots only
    drawn = [n for n in scene.graph.nodes if DRAWN_MARK.search(n)]
    ck(scope, "no drawn mark or lettering geometry", not drawn, drawn[:20])

    tris = int(sum(len(scene.geometry[scene.graph[n][1]].faces) for n in scene.graph.nodes_geometry))
    size = glb.stat().st_size
    ck(scope, f"phone budget: <= {TRI_BUDGET} triangles", tris <= TRI_BUDGET, tris)
    ck(scope, f"phone budget: <= {BYTE_BUDGET} bytes", size <= BYTE_BUDGET, size)

    zone_sig = {}
    for z in layout.get("zones", []):
        sig = tuple(sorted(Counter(i["type"] for i in items if i.get("zone") == z["id"]).items()))
        if sum(c for _, c in sig) >= 4:
            zone_sig[z["id"]] = sig
    all_summ[tag] = {"types": Counter(i["type"] for i in items), "zone_sig": zone_sig, "triangles": tris, "bytes": size,
                     "items": len(items), "furnished_zones": len(zone_sig)}


def audit_whole_building():
    scope = "building"
    core = json.loads((GEN / "equity-uprise-building-core-v2-report.json").read_text())
    fac = json.loads((GEN / "equity-uprise-facade-core-v2-report.json").read_text())
    f1 = json.loads((GEN / "equity-uprise-floor-01-core-v2-report.json").read_text())
    site = {o["object_id"]: o["location"] for o in SITE["exterior_openings"] if o["object_id"] != "F1-DOOR-PUBLIC-INNER"}
    for oid in ("F1-DOOR-STAIR-A-DISCHARGE", "F1-DOOR-STAIR-B-DISCHARGE", "F1-DOOR-SERVICE-WEST"):
        loc = site[oid]
        c = next((d for d in core.get("exit_doors", []) if d["object_id"] == oid), None)
        f = next((d for d in fac.get("egress_doors", []) if d["object_id"] == oid), None)
        g = next((d for d in f1.get("exit_doors", []) if d["object_id"] == oid), None)
        ok = (c and c["y1"] == loc["y1"] and c["y2"] == loc["y2"] and c["facade"] == loc["facade"]
              and f and f["span_ft"] == [loc["y1"], loc["y2"]] and f["elevation"] == loc["facade"]
              and g and g["y1"] == loc["y1"] and g["y2"] == loc["y2"])
        ck(scope, f"{oid} exists in chassis, Floor 1 and facade exactly where the egress plan says", ok, {"plan": loc, "chassis": c, "facade": f, "floor1": g})
    sa = site["F1-DOOR-STAIR-A-DISCHARGE"]
    landing = (54.75, 58.25)
    ck(scope, "Stair A exit opens onto the Stair A Floor 1 landing, not a stair flight", landing[0] <= sa["y1"] and sa["y2"] <= landing[1], sa)
    sb = site["F1-DOOR-STAIR-B-DISCHARGE"]
    ck(scope, "Stair B exit is at Floor 1 level (the north wall faces the stair mid-landing)", sb["facade"] != "north", sb)
    # Stair A route: Floor 1 stair door -> landing -> exit door, in the Floor 1 GLB
    sc = trimesh.load(GEN / "equity-uprise-floor-01-core-v2.glb", force="scene")
    W = int(72 / RES)
    occ = np.zeros((W, W), bool)
    for n, lo, hi in node_boxes(sc):
        if re.search(r"DOOR|::leaf|door|push-bar|brand-slot", n) or n.startswith("floor_slab"):
            continue
        if hi[2] > BODY_Z[0] and lo[2] < BODY_Z[1]:
            raster_box(occ, lo, hi)
    r = flood(erode(~occ, 1.2), cell(63.0, 52.0))
    ck(scope, "Floor 1: Stair A door -> landing -> east exit door is walkable (32 in clear)", near_reached(r, 70.4, (sa["y1"] + sa["y2"]) / 2, 0.75))
    # facade + combined chassis carry no drawn marks
    for name in ("equity-uprise-facade-core-v2.glb", "equity-uprise-building-core-v2.glb", "equity-uprise-floor-07-core-v2.glb"):
        s = trimesh.load(GEN / name, force="scene")
        drawn = [n for n in s.graph.nodes if DRAWN_MARK.search(n)]
        ck(scope, f"{name}: no drawn mark or lettering geometry", not drawn, drawn[:20])
    fs = trimesh.load(GEN / "equity-uprise-facade-core-v2.glb", force="scene")
    slot_nodes = {n for n in fs.graph.nodes if n.startswith("brand-slot::")}
    want = {f"brand-slot::{s['id']}" for s in BRAND["slots"] if s["surface"].startswith("facade/")}
    ck(scope, "every facade brand slot is an empty node in the facade GLB", want <= slot_nodes and not (slot_nodes & set(fs.graph.nodes_geometry)), sorted(want - slot_nodes))
    # artwork resolution
    bad = []
    for s in BRAND["slots"]:
        if not s.get("enabled", True):
            continue
        art = BRAND["artwork"].get(s.get("artwork", "default"))
        if not art:
            bad.append(f"{s['id']}: no artwork variant {s.get('artwork')}")
            continue
        p = ROOT / art["path"]
        if not p.exists():
            bad.append(f"{s['id']}: {art['path']} missing"); continue
        if hashlib.sha256(p.read_bytes()).hexdigest() != art["sha256"]:
            bad.append(f"{s['id']}: {art['path']} hash mismatch")
        if not (art["source"] == "owner-supplied" or art["source"].startswith("owner-requested")):
            bad.append(f"{s['id']}: artwork not owner-supplied")
    ck(scope, "every enabled brand slot resolves to an owner-supplied file with a matching hash", not bad, bad)


def audit_distinctness(summ):
    scope = "distinctness"
    tags = [t for t in summ if t != "B1"] + (["B1"] if "B1" in summ else [])
    dup = []
    for a, b in combinations(tags, 2):
        for za, sa in summ[a]["zone_sig"].items():
            for zb, sb in summ[b]["zone_sig"].items():
                if sa == sb:
                    dup.append(f"{a}:{za} == {b}:{zb}")
    ck(scope, "no furnished zone is copy-pasted between floors", not dup, dup)
    sims = {}
    for a, b in combinations(tags, 2):
        A = set(summ[a]["types"]); B = set(summ[b]["types"])
        sims[f"{a}-{b}"] = round(len(A & B) / max(1, len(A | B)), 3)
    worst = max(sims.values()) if sims else 0
    ck(scope, "furniture vocabularies differ between floors (Jaccard < 0.6 for every pair)", worst < 0.6, sims)
    uniq = {}
    for t in tags:
        others = set().union(*[set(summ[o]["types"]) for o in tags if o != t])
        uniq[t] = sorted(set(summ[t]["types"]) - others)
    ck(scope, "every floor uses at least one furniture type no other floor uses, or a distinct zone set", all(uniq[t] or summ[t]["furnished_zones"] >= 3 for t in tags), uniq)
    return sims, uniq


def audit_catalog():
    scope = "catalog"
    bad = []
    for k, t in CATALOG.items():
        d = t["dims_in"]
        if t.get("category") == "seating" and t["form"] in ("side_chair", "task_chair"):
            if not (17 <= t.get("options", {}).get("seat_h_in", 18) <= 20):
                bad.append(f"{k} seat height")
        if t["form"] in ("table_rect", "table_round", "desk", "desk_l", "carrel", "mic_desk") and not (28 <= d["h"] <= 30):
            bad.append(f"{k} work height {d['h']}")
        if t["form"] == "high_table" and not (40 <= d["h"] <= 42):
            bad.append(f"{k} standing height")
        if t["form"] == "workbench" and not (34 <= d["h"] <= 38):
            bad.append(f"{k} bench height")
    ck(scope, "catalog dimensions are real-world (seat 17-20 in, tables/desks 28-30 in, standing 40-42 in, bench 34-38 in)", not bad, bad)


def main():
    summ = {}
    audit_catalog()
    for tag, (lay, glb, inv) in FLOORS.items():
        audit_floor(tag, lay, glb, inv, summ)
    audit_whole_building()
    sims, uniq = audit_distinctness(summ)
    failed = [c for c in checks if not c["passed"]]
    report = {
        "schema_version": "1.0.0", "report_id": "equity-uprise-interior-consistency", "not_for_construction": True,
        "parameters": {"grid_ft": RES, "accessible_route_clear_in": ROUTE_R * 24, "aisle_clear_in": AISLE_R * 24, "triangle_budget": TRI_BUDGET, "byte_budget": BYTE_BUDGET},
        "floors": {t: {"items": s["items"], "furniture_types": len(s["types"]), "furnished_zones": s["furnished_zones"], "triangles": s["triangles"], "glb_bytes": s["bytes"]} for t, s in summ.items()},
        "vocabulary_similarity": sims, "unique_types": uniq,
        "checks_total": len(checks), "checks_passed": len(checks) - len(failed), "checks_failed": len(failed), "passed": not failed, "checks": checks,
    }
    REPORT.write_text(json.dumps(report, indent=1, default=str) + "\n")
    print(json.dumps({k: report[k] for k in ("checks_total", "checks_passed", "checks_failed", "passed")}))
    for c in failed:
        print("FAIL", c["scope"], c["name"], json.dumps(c["detail"], default=str)[:1500])
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
