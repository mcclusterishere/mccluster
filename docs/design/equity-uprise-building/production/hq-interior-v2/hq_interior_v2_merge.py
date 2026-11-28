"""Equity Uprise HQ Interior v2 — merge the existing furnished floors with the approved concept pack.

The first v2 build dropped every piece of the existing v3 interior layer (286 placed, catalog-sized pieces with
stable IDs and program sources, the named staff desks, the room displays and gallery frames) and replaced them
with new board dressing. That breaks the building contract ("no destructive forgetting: apply new research to the
best existing design"). This module restores the existing layer and reconciles it with the pack, piece by piece:

  R1  An approved anchor (asset-map.csv) is always built at its CSV point. An existing piece whose footprint the
      anchor's main piece overlaps is SUPERSEDED by it (recorded, with the anchor tag).
  R2  Seats that belonged to a superseded existing table or desk (same zone, within 2.5 ft) go with it.
  R3  An anchor's companions (its chairs, screens, lamps; one group per anchor and kit) are dropped as a group
      when any of them collides with a kept existing piece: the existing composition wins (e.g. F3's six-seat
      exchange table keeps its six chairs instead of the board's ten).
  R4  Board dressing (S-tags, inferred from the images) is dropped, with its companions, when it collides with a
      kept existing piece. A companion group is dropped on its own when only it collides.
  R5  A board rug is dropped when an existing rug already covers 30 % of it.

Everything else that exists is KEPT and restyled with the floor's board palette. Every decision is written to the
build report and the asset inventory. Pure Python (no bpy, numpy or shapely) so it runs inside any Blender.

NOT FOR CONSTRUCTION.
"""
import math

# Existing builder objects that are not v3 furniture but are kept (the first build dropped them):
# room displays, gallery/archive frames, review surfaces, floor power boxes. Lighting, feature walls,
# check-in kiosks, directories and the old Halo stay replaced by the pack's anchored objects.
RESTORE_PREFIXES = {
    1: ("F1-INTAKE-DISPLAY-01", "F1-LOUNGE-DISPLAY-01"),
    2: ("F2-FORUM-POWER-01", "F2-TALK-INTERFACE-01"),
    3: ("F3-INTERVIEW-A-DISPLAY-01", "F3-INTERVIEW-B-DISPLAY-01", "F3-PEOPLE-DISPLAY-01", "F3-OPPORTUNITY-POWER-01"),
    4: ("F4-GALLERY-FRAME-", "F4-LISTENING-POWER-01"),
    5: ("F5-ARCHIVE-FRAME-", "F5-ARCHIVE-SEARCH-01", "F5-PUB-DISPLAY-01", "F5-PUB-WORKSTATION-01",
        "F5-SOURCE-DISPLAY-01", "F5-SOURCE-SECURE-SURFACE-01", "F5-POLICY-POWER-01"),
    6: ("F6-BRIEFING-DISPLAY-01", "F6-STRATEGY-DISPLAY-01", "F6-STRATEGY-SECURE-STORAGE-01", "F6-SALON-INFO-01",
        "F6-COMMAND-POWER-01"),
}

# Existing pieces moved (new centre, plan ft) because they block a room door once the walking routes count
# furniture; every move is recorded in the build report.
ADJUST = {
    3: {"F3-LOUNGE-PLANT-02": (4.6, 18.9, "trough planter stood 2.1 ft in front of the Interview A door (X9-12): moved west along the lounge edge"),
        "F3-INTERVIEW-B-PLANT-01": (26.4, 4.2, "planter stood inside the Interview B doorway (X23-26): moved to the room's south-east corner")},
    6: {"F6-SALON-PLANT-02": (19.5, 22.0, "planter pinched the approach to the strategy-room door to 2.4 ft between it and the room wall: moved north-east, clear of the door band")},
    4: {"F4-RECORDING-SCREEN-01": (6.4, 13.4, "acoustic screen left 1.1 ft of the recording-room door (X10.5-13.5) clear: moved west, still behind the vocal rig")},
}

# kits whose footprint is round (a polygon approximates the circle/ellipse)
ROUND_KITS = {"FORUM_TABLE", "CAFE_TABLE", "COFFEE_TABLE_ROUND", "ROUND_TABLE_4", "SIDE_TABLE", "POUF",
              "PLANT_TREE", "PLANT_FLOOR", "PLANT_DESK", "LAMP_FLOOR", "BOLLARD_LIGHT", "STOOL"}
POT_R = {"PLANT_TREE": 0.75, "PLANT_FLOOR": 0.6, "PLANT_DESK": 0.25, "LAMP_FLOOR": 0.6}
ROUND_TYPES = ("table_round", "coffee_table_round", "planter_tall", "planter_floor", "pouf", "side_table",
               "stool_bar", "stool_counter")
NO_COLLIDE_KITS = {"RUG", "PENDANT_LINEAR", "PENDANT_DRUM", "FRAME_ART", "MONITOR", "MONITOR_WIDE", "LAPTOP",
                   "LAMP_DESK", "PLANT_DESK", "DOC_STACK", "SPEAKER_PAIR"}
SEAT_TYPES = ("chair", "stool", "sofa", "bench", "banquette", "pouf", "armchair", "sectional")
SURFACE_TYPES = ("table", "desk", "carrel", "workbench", "counter")


# ------------------------------------------------------------------ geometry (convex polygons, feet)
def rect(cx, cy, w, d, rot_deg=0.0):
    a = math.radians(rot_deg)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]


def ellipse(cx, cy, a, b, rot_deg=0.0, n=24):
    r = math.radians(rot_deg)
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, y = a * math.cos(t), b * math.sin(t)
        pts.append((cx + x * math.cos(r) - y * math.sin(r), cy + x * math.sin(r) + y * math.cos(r)))
    return pts


def area(p):
    return abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p)))) / 2


def _ccw(p):
    s = sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p)))
    return p if s < 0 else p[::-1]   # shoelace with i,i-1 ordering is negative for CCW


def clip(subject, clipper):
    """Sutherland-Hodgman intersection of two convex polygons."""
    out = list(subject)
    c = _ccw(list(clipper))
    for i in range(len(c)):
        a, b = c[i - 1], c[i]
        inp, out = out, []
        if not inp:
            break
        def inside(p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9
        def cut(p, q):
            x1, y1, x2, y2 = p[0], p[1], q[0], q[1]
            x3, y3, x4, y4 = a[0], a[1], b[0], b[1]
            den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            if abs(den) < 1e-12:
                return q
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
            return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
        for j in range(len(inp)):
            p, q = inp[j - 1], inp[j]
            if inside(q):
                if not inside(p):
                    out.append(cut(p, q))
                out.append(q)
            elif inside(p):
                out.append(cut(p, q))
    return out


def overlap(p, q):
    r = clip(p, q)
    return area(r) if len(r) >= 3 else 0.0


def grow(p, d):
    cx = sum(x for x, _ in p) / len(p)
    cy = sum(y for _, y in p) / len(p)
    out = []
    for x, y in p:
        dx, dy = x - cx, y - cy
        L = math.hypot(dx, dy) or 1.0
        out.append((x + dx / L * d * 1.41, y + dy / L * d * 1.41))
    return out


# ------------------------------------------------------------------ records
def existing_poly(item, catalog):
    """Footprint of a v3 layout item from the shared catalog (inches) and the layout's size override."""
    t = catalog[item["type"]]
    dims = t.get("dims_in", {})
    size = item.get("size") or {}
    w = (size.get("w_in") or dims.get("w") or 24) / 12.0
    d = (size.get("d_in") or dims.get("d") or 24) / 12.0
    rot = float(item.get("rot_deg") or 0.0)
    if item["type"].startswith(ROUND_TYPES):
        return ellipse(item["x"], item["y"], w / 2, d / 2, rot, 16)
    return rect(item["x"], item["y"], w, d, rot)


def is_seat(type_or_kit):
    s = type_or_kit.lower()
    return any(k in s for k in SEAT_TYPES)


def is_surface(type_or_kit):
    s = type_or_kit.lower()
    return any(k in s for k in SURFACE_TYPES) and "coffee" not in s and "side_table" not in s


def anchor_of(tag):
    return tag.split("/")[0]


# Whole existing zones an owner requirement replaces (recorded as superseded, with the reason).
ZONE_SUPERSEDE = {6: {"command-preparation": "R0 zone replaced by Matthew McCluster's executive suite beside the "
                                             "Halo Globe (owner brief); the three preparation desks need a new home"}}
PRIORITY_BOARD = {}


def same_piece(e, m):
    """The anchor is a re-make of this existing piece: same centre (0.6 ft) and a similar envelope (2.5 ft)."""
    def box(p):
        xs, ys = [a for a, _ in p], [b for _, b in p]
        return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(xs) - min(xs), max(ys) - min(ys)
    ex, ey, ew, ed = box(e["poly"])
    mx, my, mw, md = box(m["poly"])
    return math.hypot(ex - mx, ey - my) <= 0.6 and abs(ew - mw) <= 2.5 and abs(ed - md) <= 2.5


def reconcile(existing, placed, floor=None):
    """existing: [{id, type, zone, poly, rug, z_lo, z_hi, origin}]  (origin: 'v3' | 'restored')
    placed:   [{name, tag, kit, source ('csv'|'board'), poly, z_lo, z_hi}]   (v2 rows as built)
    Returns (superseded {id: reason}, dropped {name: reason})."""
    sup, drop = {}, {}
    floorish = [p for p in placed if p["kit"] not in NO_COLLIDE_KITS and p["z_lo"] < 6.5 and p["kit"] != "LISTENING_ENVELOPE"]
    pri = PRIORITY_BOARD.get(floor, ())
    mains = [p for p in floorish if "/" not in p["tag"] and (p["source"] == "csv" or p["tag"].startswith(pri))]

    def hit(a, b):
        """plan overlap > 0.25 sq ft within a shared height band (a desk-top lamp does not hit a rug)."""
        if min(a["z_hi"], b["z_hi"]) - max(a["z_lo"], b["z_lo"]) < 0.05:
            return False
        return overlap(a["poly"], b["poly"]) > 0.25

    remade = set()
    for e in existing:
        z = ZONE_SUPERSEDE.get(floor, {}).get(e.get("zone"))
        if z:
            sup[e["id"]] = z
    # R1 anchors supersede what they sit on
    for e in existing:
        if e["id"] in sup or e["rug"] or e["z_lo"] > 6.5 or e["z_hi"] < 0.3 or "-POWER-" in e["id"]:
            continue
        for m in mains:
            if hit(e, m):
                if same_piece(e, m):
                    remade.add(e["id"])
                    sup[e["id"]] = f"R1 re-made as approved anchor {m['tag']} ({m['kit']}) at the same point; its seating is kept"
                    break
                why = "approved anchor" if m["source"] == "csv" else "owner-required staging"
                sup[e["id"]] = f"R1 superseded by {why} {m['tag']} ({m['kit']})"
                break
    # R2 seats of a superseded table/desk
    for t in [e for e in existing if e["id"] in sup and is_surface(e["type"]) and e["id"] not in remade]:
        g = grow(t["poly"], 2.5)
        for e in existing:
            if e["id"] in sup or not is_seat(e["type"]) or e.get("zone") != t.get("zone"):
                continue
            if overlap(e["poly"], g) > 0.05:
                sup[e["id"]] = f"R2 seat of {t['id']} ({sup[t['id']]})"
    kept = [e for e in existing if e["id"] not in sup and not e["rug"] and e["z_lo"] < 6.5 and e["z_hi"] >= 0.3
            and "-POWER-" not in e["id"]]
    kept_rugs = [e for e in existing if e["id"] not in sup and e["rug"]]

    def collides(p):
        for e in kept:
            if hit(e, p):
                return e["id"]
        return None

    # R3 / R4
    groups = {}
    for p in placed:
        if "/" not in p["tag"] and (p["source"] == "csv" or p["tag"].startswith(pri)):
            continue
        top = anchor_of(p["tag"])
        is_main = "/" not in p["tag"]
        key = (top, "main") if is_main else (top, p["kit"])
        groups.setdefault(key, []).append(p)
    board_main_dropped = {}
    for (top, kind), ps in groups.items():
        if kind != "main" or ps[0]["source"] != "board":
            continue
        p = ps[0]
        if p["kit"] == "RUG":
            for r in kept_rugs:
                o = overlap(r["poly"], p["poly"])
                if o > 0.3 * area(p["poly"]):
                    board_main_dropped[top] = f"R5 existing rug {r['id']} already covers it"
                    break
            continue
        if p in floorish:
            c = collides(p)
            if c:
                board_main_dropped[top] = f"R4 board dressing collides with kept existing {c}"
    for (top, kind), ps in groups.items():
        if top in board_main_dropped:
            for p in ps:
                drop[p["name"]] = board_main_dropped[top] if kind == "main" else f"companion of dropped {top}: " + board_main_dropped[top]
            continue
        if kind == "main":
            continue
        cs = [collides(p) for p in ps if p in floorish]
        cs = [c for c in cs if c]
        if not cs:
            # a companion on a desk top: collides via the desk's existing neighbour? check plan overlap with kept surfaces
            continue
        for p in ps:
            drop[p["name"]] = f"R3 {kind} companions of {top} give way to the existing composition ({cs[0]})"
    return sup, drop


def hull(points):
    """2D convex hull (monotone chain) of (x, y) points."""
    pts = sorted(set((round(x, 4), round(y, 4)) for x, y in points))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
