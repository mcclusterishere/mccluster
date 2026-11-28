"""Equity Uprise HQ — Interior Rebuild v2 (Floors 1–7) — Blender 4.2+ set builder.

Run (Windows, Prime):
  blender --background --factory-startup --python build_hq_interior_v2.py -- ^
      --repo C:\\path\\to\\mccluster --pack "C:\\Users\\Mattm\\Documents\\Equity Uprise Show\\HQ Blender Studio\\References\\HQ Interior Concept v2" ^
      --out EU_HQ_Interiors_v2.blend
Run (Linux):
  blender -b --factory-startup --python build_hq_interior_v2.py -- --repo . --pack <pack> --out <file.blend>
  (or `python build_hq_interior_v2.py -- ...` with the `bpy` 4.2 module)

What it does, in authority order (REFERENCE-AUTHORITY.md):
1. Imports the canonical, unchanged Core V2 GLBs into `_SOURCE_REFERENCE_readonly` (excluded from
   the view layer): the combined chassis, B1, and the official F1–F7 builder outputs ("before").
2. Runs the approved pack's own `place-asset-proxies.py` so the 52 mapped anchors exist as named
   empties (`EU_Concept_Asset_Proxies`), then reads every CSV-placed asset's position from them.
3. Per floor, copies the builders' architecture (exterior walls, cores, shafts, stairs, partitions,
   doors, glazing, slab, ceilings, restroom fixtures, life-safety items) into `F0X_Shell` /
   `F0X_ArchFinishes` with new finishes. Nothing in the shell is re-drawn or moved.
4. Dresses the floor from the instanced kit (`KIT_Assets`) per `hq_interior_v2_layout.py`, with
   separate Furniture / Equipment / Lighting / Cameras / Interaction collections.
5. F6: one suspended Halo Globe (no plinth) and the PRIM2 screen as separate interactive objects,
   each with its own named interaction anchor. McCluster office branding exists only on F6, as an
   EMPTY brand slot (no artwork is drawn; the owner assigns supplied artwork).
6. Saves a NEW file. Existing .blend/.glb files are never opened for writing.

Generated images are never geometry authority. NOT FOR CONSTRUCTION.
"""
import csv
import hashlib
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import eu_hq_kit as K  # noqa: E402
import hq_interior_v2_layout as L  # noqa: E402
import hq_interior_v2_merge as MG  # noqa: E402

FT = 0.3048
FFE = {f: (f - 1) * 13.5 for f in range(1, 8)}
FFE["B1"] = -13.5
BUILD_ID = "eu-hq-interior-v2"


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"repo": str(HERE.parents[4]), "pack": None, "out": str(HERE / "EU_HQ_Interiors_v2.blend")}
    i = 0
    while i < len(a):
        if a[i].startswith("--"):
            o[a[i][2:]] = a[i + 1]
            i += 2
        else:
            i += 1
    return o


OPT = args()
REPO = Path(OPT["repo"]).resolve()
BLD = REPO / "docs/design/equity-uprise-building"
PROD = BLD / "production"
GEN = PROD / "generated"
PACK = Path(OPT["pack"]).resolve() if OPT["pack"] else BLD / "references/hq-interior-concept-v2"
ASSET_MAP = PACK / "asset-map.csv"
if not ASSET_MAP.is_file():
    ASSET_MAP = HERE / "source/asset-map.csv"
PROXY_SCRIPT = PACK / "place-asset-proxies.py"
if not PROXY_SCRIPT.is_file():
    PROXY_SCRIPT = HERE / "source/place-asset-proxies.py"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


# ------------------------------------------------------------------ scene scaffolding
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "EU_HQ_Interiors_v2"
scene.unit_settings.system = "IMPERIAL"
scene.unit_settings.length_unit = "FEET"
scene.unit_settings.scale_length = 1.0
scene.render.engine = "CYCLES"


def coll(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    p = parent or scene.collection
    if c.name not in [x.name for x in p.children]:
        p.children.link(c)
    return c


def layer_coll(c, lc=None):
    lc = lc or bpy.context.view_layer.layer_collection
    if lc.collection == c:
        return lc
    for ch in lc.children:
        r = layer_coll(c, ch)
        if r:
            return r
    return None


ROOT = coll("EU_HQ_Interiors_v2")
SRC = coll("_SOURCE_REFERENCE_readonly")
KITC = coll("KIT_Assets")
WORLDC = coll("WORLD_Light_and_Sky")

ROT_FIX = Matrix.Rotation(math.radians(-90), 4, "X")   # glTF (stored Z-up) -> Blender Z-up


def vertex_colour_material():
    """Display material for the builder GLBs, whose colours live in the COLOR_0 attribute."""
    m = bpy.data.materials.get("SRC_BuilderVertexColour")
    if m:
        return m
    m = bpy.data.materials.new("SRC_BuilderVertexColour")
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Color"
    nt.links.new(ca.outputs["Color"], p.inputs["Base Color"])
    nt.links.new(ca.outputs["Alpha"], p.inputs["Alpha"])
    p.inputs["Roughness"].default_value = 0.6
    m.blend_method = "HASHED"
    return m


def import_glb(path, into, ffe_ft):
    lc = layer_coll(into)
    bpy.context.view_layer.active_layer_collection = lc
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    lift = Matrix.Translation((0, 0, ffe_ft * FT))
    fix = lift @ ROT_FIX
    done = set()
    for o in new:
        # bake the axis/elevation fix into the data: later importer runs reset object transforms
        if o.parent is None and o.type == "MESH" and o.matrix_world == Matrix.Identity(4):
            if o.data.name not in done:
                o.data.transform(fix)
                done.add(o.data.name)
        elif o.parent is None:
            o.matrix_world = fix @ o.matrix_world
    for o in new:                       # the importer links to the scene root in background mode
        for c in list(o.users_collection):
            c.objects.unlink(o)
        into.objects.link(o)
    vc = vertex_colour_material()
    for o in new:
        if o.type == "MESH" and not o.data.materials and o.data.color_attributes:
            o.data.materials.append(vc)
    for o in new:
        o["eu_source_glb"] = path.name
        o["eu_source_sha256"] = SRC_HASH[path.name]
    return new


SRC_FILES = {
    "core": GEN / "equity-uprise-building-core-v2.glb",
    "B1": GEN / "equity-uprise-basement-b1-core-v2.glb",
    **{f: GEN / f"equity-uprise-floor-0{f}-core-v2.glb" for f in range(1, 8)},
}
missing = [str(p) for p in SRC_FILES.values() if not p.is_file()]
if missing:
    raise SystemExit("Missing source GLBs (run the official floor builders first): " + ", ".join(missing))
SRC_HASH = {p.name: sha(p) for p in SRC_FILES.values()}

src_core = coll("SRC_CoreV2_combined_chassis", SRC)
import_glb(SRC_FILES["core"], src_core, 0.0)          # absolute coordinates
SRC_FLOOR = {}
for f in range(1, 8):
    c = coll(f"SRC_F{f:02d}_builder_v2_before", SRC)
    SRC_FLOOR[f] = (c, import_glb(SRC_FILES[f], c, FFE[f]))

# B1 is kept as the crew hub, exactly as built: imported unchanged into the stack.
B1C = coll("B1_CrewHub_existing_unchanged", ROOT)
import_glb(SRC_FILES["B1"], B1C, FFE["B1"])
B1C["eu_note"] = "B1 crew hub kept as the existing canonical B1 model (unchanged)."

# ------------------------------------------------------------------ approved anchors (pack script)
PROXY_ROOT_NAME = "EU_Concept_Asset_Proxies"
_argv = sys.argv
sys.argv = [sys.argv[0], "--", str(ASSET_MAP)]
exec(compile(PROXY_SCRIPT.read_text(encoding="utf-8"), str(PROXY_SCRIPT), "exec"), {"__name__": "__pack__"})
sys.argv = _argv
proxy_root = bpy.data.collections[PROXY_ROOT_NAME]
scene.collection.children.unlink(proxy_root)
ROOT.children.link(proxy_root)
with ASSET_MAP.open(encoding="utf-8-sig", newline="") as fh:
    CSV_ROWS = {r["tag"]: r for r in csv.DictReader(fh)}
ANCHOR = {}
for ob in bpy.data.objects:
    if ob.name.startswith("EU_PROP_"):
        tag = ob.name[len("EU_PROP_"):].split("_", 1)[0]
        ANCHOR[tag] = ob
assert len(ANCHOR) == 52 == len(CSV_ROWS), (len(ANCHOR), len(CSV_ROWS))

# ------------------------------------------------------------------ materials
S = K.srgb


def textured(name, hexcol, rough, scale, amount):
    """Flat colour broken up by low-frequency noise (concrete / plaster mottling)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    nz = K._noise(nt, scale, 9.0, 0.6)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    base = S(hexcol)
    ramp.color_ramp.elements[0].color = tuple(c * (1 - amount) for c in base[:3]) + (1,)
    ramp.color_ramp.elements[1].color = tuple(min(1, c * (1 + amount * 0.6)) for c in base[:3]) + (1,)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = rough
    m.diffuse_color = base
    return m


def shell_mats(f):
    pal = {
        1: ("#BFB5A6", "#D2C8B8", "#B8875A"), 2: ("#BDB2A3", "#D4C5B4", "#B98A5C"),
        3: ("#9E978D", "#C4C0B6", "#6A4630"), 4: ("#AFA597", "#CFC3B4", "#5B3B26"),
        5: ("#B9B0A2", "#CEC7B8", "#A77E55"), 6: ("#4A4440", "#4E4A46", "#3F2A1E"),
        7: ("#8F8B84", "#B7B2A9", "#8A6A4A"),
    }[f]
    floor = K.tint_mat  # noqa
    m = {}
    fm = bpy.data.materials.get(f"F{f:02d}_FloorFinish")
    if not fm:
        fm = bpy.data.materials.new(f"F{f:02d}_FloorFinish")
        fm.use_nodes = True
        nt = fm.node_tree
        p = nt.nodes["Principled BSDF"]
        nz = K._noise(nt, 0.9 if f != 6 else 3.5, 8.0, 0.5 if f == 6 else 0.4)
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        base = S(pal[0])
        ramp.color_ramp.elements[0].color = tuple(c * 0.9 for c in base[:3]) + (1,)
        ramp.color_ramp.elements[1].color = tuple(min(1, c * (1.12 if f == 6 else 1.06)) for c in base[:3]) + (1,)
        if f == 6:
            ramp.color_ramp.elements[0].position = 0.42
            ramp.color_ramp.elements[1].position = 0.62
        nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
        p.inputs["Roughness"].default_value = 0.18 if f == 6 else (0.62 if f == 7 else 0.34)
        if f in (1, 6):
            p.inputs["Coat Weight"].default_value = 0.35
        fm.diffuse_color = base
    m["floor"] = fm
    m["plaster"] = textured(f"F{f:02d}_WallPlaster", pal[1], 0.85, 1.6, 0.12)
    m["door"] = K.mat(f"F{f:02d}_DoorLeaf", pal[2], 0.5)
    m["felt"] = K.mat(f"F{f:02d}_AcousticFelt", {1: "#59654A", 2: "#B07055", 3: "#2F5D5C", 4: "#4E1620",
                                                 5: "#6E7058", 6: "#4A3F38", 7: "#777777"}[f], 0.95)
    m["core"] = textured("SHELL_BoardFormedConcrete", "#9C958B", 0.8, 2.5, 0.25)
    m["ext"] = textured("SHELL_PaleConcrete", "#ADA59A", 0.78, 1.2, 0.2)
    m["ceiling"] = K.mat("SHELL_AcousticCeiling", "#ECE8E0", 0.95)
    m["glass"] = K.mat("SHELL_Glazing", "#E4ECEE", 0.02, transmission=1.0)
    m["smoked"] = K.mat("SHELL_SmokedGlazing", "#3E4446", 0.04, transmission=0.8)
    m["steel"] = K.mat("SHELL_BlackenedSteel", "#232427", 0.4, 0.85)
    m["brass"] = K.mat("SHELL_Brass", "#B08A4E", 0.28, 1.0)
    m["stair"] = K.mat("SHELL_StairConcrete", "#9E978E", 0.75)
    m["elev"] = K.mat("SHELL_BrushedSteelDoor", "#AEB1B3", 0.3, 1.0)
    m["galv"] = K.mat("KIT_GalvanizedSteel", "#9AA0A3", 0.45, 1.0)
    m["pavers"] = textured("SHELL_RoofPavers", "#8A857D", 0.8, 3.0, 0.18)
    m["field"] = textured("F07_MobilityFieldCoating", "#7E7A73", 0.7, 1.5, 0.12)
    m["walk"] = textured("F07_WalkwayPavers", "#9A948A", 0.75, 4.0, 0.15)
    return m


# ------------------------------------------------------------------ shell classification
INV = {}
for f in range(1, 8):
    p = next((PROD / f"floor-0{f}").glob("floor-0*-object-inventory.json"))
    for o in json.loads(p.read_text())["objects"]:
        INV[o["id"]] = o.get("category") or "-"

FEATURE_DROP = ("FEATURE-WALL", "IDENTITY-WALL", "MEDIA-WALL", "POLICY-WALL", "COMMAND-WALL",
                "GALLERY-WALL", "ARCHIVE-WALL", "JOURNEY-WALL", "JOURNEY-RED-REVEAL")
KEEP_EQUIP = ("FREIGHT-CONTROL", "PASS-ELEV-CALL", "OPS-PANEL")
REPLACED_BY_CSV = ("F4-MEDIA-STORAGE-01", "F5-EVIDENCE-STORAGE-01")

# the existing v3 interior layer (kept and merged, see hq_interior_v2_merge.py)
CATALOG = json.loads((PROD / "interiors" / "furniture-catalog-v3.json").read_text())["types"]
V3 = {f: {i["id"]: i for i in json.loads((PROD / f"floor-0{f}" / f"floor-0{f}-interior-layout-v3.json").read_text())["items"]}
      for f in range(1, 7)}


def classify(f, ob):
    """-> (bucket, material key or None to keep the builder material)"""
    name = ob.name.split(".")[0]
    key = name.split("::")[0]
    if f <= 6 and (key in V3[f] or key.startswith(MG.RESTORE_PREFIXES.get(f, ("\0",)))):
        return "existing", None
    part = name.split("::")[1].lower() if "::" in name else ""
    low = key.lower()
    cy = (ob.matrix_world.translation.y) / FT
    if f == 7:
        cat = INV.get(key, "-")
        if cat == "furniture":
            return "drop", None                                  # replaced by 7.2 ROOF_BENCH
        if cat == "lighting":
            return "lighting", None
        if "MECH-UNIT" in key:
            return "equipment", ("steel" if part.startswith("louver") else "galv")
        if cat in ("equipment", "terminal", "display", "service"):
            return "equipment", None
        if cat == "mobility_reservation":
            return "finish", "field"
        if cat in ("circulation", "feature"):
            return "finish", "walk"
        if cat in ("wayfinding", "signage"):
            return "finish", None
        if "ROOF-DECK" in key:
            return "shell", "pavers"
        if "THRESHOLD" in key or "TRANSITION" in key:
            return "shell", "stair"
        return "shell", "ext"
    if key in INV:
        cat = INV[key]
        if any(s in key for s in FEATURE_DROP):
            return "drop", None
        if "DOOR" in key or "GLAZING" in key or cat in ("vertical_circulation_interface", "vertical_circulation",
                                                        "architectural_access", "door", "architecture"):
            if "frame" in part or "mullion" in part or "header" in part or "jamb" in part:
                return "shell", "steel"
            if "handle" in part or "hardware" in part or "pull" in part:
                return "shell", "brass"
            if "GLAZING" in key or "glass" in part or "pane" in part:
                return "shell", "glass"
            if "PASS-ELEV-DOOR" in key:
                return "shell", "elev"
            if "FREIGHT-DOOR" in key:
                return "shell", "core"
            if "ENTRY-DOOR" in key:
                return "shell", "glass"
            if "DOOR" in key:
                return "shell", "door"
            return "shell", None
        if cat == "life_safety":
            return "lifesafety", None
        if cat == "fixture":
            return "finish", None
        if cat in ("signage", "signage_wayfinding", "wayfinding"):
            return "finish", None
        if cat == "acoustic_treatment":
            if "CEILING" in key:
                return "ceiling", "ceiling"
            if part.startswith("side"):
                return "shell", "plaster"
            return "finish", "felt"
        if cat == "architectural_feature":
            if "INSET" in key or "ENTRY" in key:
                return "finish", None
            return "drop", None
        if cat == "decorative_functional":
            return ("finish", None) if "ENTRY-MAT" in key else ("drop", None)
        if cat == "lighting":
            return ("lighting", None) if "UPWARD-GUIDANCE" in key else ("drop", None)
        if key in REPLACED_BY_CSV:
            return "drop", None
        if any(s in key for s in KEEP_EQUIP):
            return "equipment", None
        if cy >= 59.5:
            return "equipment", None                            # back-of-house rooms: untouched
        return "drop", None                                     # old furniture/screens/kiosks/Halo
    # builder objects carrying an F#- id that is not in the floor inventory are the workplace
    # occupancy layer (named desks/chairs/files) and exit doors from the egress model
    if len(key) > 3 and key[0] == "F" and key[1].isdigit() and key[2] == "-":
        if "DOOR" in key:
            if "handle" in part or "hardware" in part or "bar" in part:
                return "shell", "brass"
            return "shell", ("glass" if "glass" in part else "door")
        if cy >= 59.5:
            return "equipment", None
        return "drop", None
    # non-inventory builder geometry
    if "ceiling" in low:
        return "ceiling", "ceiling"
    if any(s in low for s in ("acoustic_fin", "plinth", "media_storage_case")):
        return "drop", None
    if low in ("red_wayfinding_spine", "vestibule_red_reveal") or low.startswith("roof_marker"):
        return "finish", None
    if low.startswith("restroom_sink") or low.startswith("restroom_mirror"):
        return "finish", None
    if "drawer" in low or "device" in low:
        return "equipment", None
    if "raceway" in low or "trough" in low:
        return "finish", None
    if "handle" in low:
        return "shell", "brass"
    if "door" in low and "header" not in low:
        return "shell", "door"
    if "glass" in low:
        return "shell", "glass"
    if any(s in low for s in ("mullion", "frame", "lintel", "header", "baseboard")):
        return "shell", "steel"
    if low.startswith("stair"):
        return "shell", "stair"
    if low.startswith(("pass", "freight", "mep")):
        return "shell", "core"
    if low == "floor_slab":
        return "shell", "floor"
    if any(s in low for s in ("north_wall", "east_wall", "west_wall", "exterior", "south_exterior")):
        return "shell", "ext"
    return "shell", "plaster"


# ------------------------------------------------------------------ kit
extra = {
    "RECEPTION_COUNTER": (K.reception_counter, {}, "furniture"),
    "JOURNEY_DISPLAY": (K.journey_display, {"w": 12.0, "h": 5.5}, "equipment"),
    "MEDIA_WALL_14": (K.media_wall_unit, {"w": 14.0, "h": 5.5, "screens": 3}, "equipment"),
    "RELEASE_WALL": (K.media_wall_unit, {"w": 14.0, "h": 5.5, "screens": 1}, "equipment"),
    "FORUM_TABLE": (lambda b: (b.ellipse_slab(0, 0, 2.37, 2.5, 6.0, 5.0, "wood"),
                               b.ellipse_slab(0, 0, 0.0, 2.37, 2.2, 1.6, "accent"),
                               b.cyl(0, 0, 2.5, 2.56, 0.35, "steel", 16)), {}, "furniture"),
    "EXCHANGE_TABLE": (K.table_rect, {"w": 16.0, "d": 4.0}, "furniture"),
    "POLICY_TABLE": (K.table_rect, {"w": 16.0, "d": 5.0}, "furniture"),
    "COMMAND_TABLE": (lambda b: (b.box(-8, -2.5, 2.32, 8, 2.5, 2.5, "stone"),
                                 b.box(-5.6, -1.2, 0, -3.4, 1.2, 2.32, "stone"),
                                 b.box(3.4, -1.2, 0, 5.6, 1.2, 2.32, "stone"),
                                 b.box(-7.5, -0.05, 2.5, 7.5, 0.05, 2.52, "brass")), {}, "furniture"),
    "RUG": (lambda b: b.box(-0.5, -0.5, 0.0, 0.5, 0.5, 0.03, "rug"), {}, "decor"),
}
K.RECIPES.update(extra)
KITS, KM = K.build_kit(KITC)
for c in KITC.children:
    for o in c.objects:
        if o.get("eu_kit_key") == "RUG":
            for md in list(o.modifiers):
                o.modifiers.remove(md)
layer_coll(KITC).exclude = True


def rotz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def place(f, row, colls, pal):
    key = row["kit"]
    tag = row["tag"]
    if row["source"] == "csv":
        cr = CSV_ROWS[tag]
        anc = ANCHOR[tag]
        x, y = anc.location.x / FT, anc.location.y / FT          # read back from the pack's anchor empty
        if row.get("override"):
            x, y = row["override"]
        z = 0.0
        name = f"F{f:02d}_{tag}_{cr['asset_id']}"
        if key.startswith("EXISTING:"):
            src_id = key.split(":", 1)[1]
            ob = next(o for o in colls["equipment"].objects if o.get("eu_from_builder_object") == src_id)
            ob["eu_tag"], ob["eu_asset_id"] = tag, cr["asset_id"]
            ob["eu_source"] = "asset-map.csv v2, realised by existing canonical L7 object"
            ob["eu_deviation"] = row["deviation"]
            ob["eu_note"] = cr["note"]
            return ob
    else:
        x, y, z = row["x"], row["y"], row.get("z", 0.0)
        name = f"F{f:02d}_{tag}_{key}"
    if key == "LISTENING_ENVELOPE":
        e = bpy.data.objects.new(name + "_group_anchor", None)
        e.empty_display_type = "CUBE"
        e.empty_display_size = 0.5
        cr = CSV_ROWS[tag]
        e.scale = (float(cr["width_ft"]) * FT / 2 * 2, float(cr["depth_ft"]) * FT / 2 * 2, float(cr["height_ft"]) * FT / 2 * 2)
        e.location = (x * FT, y * FT, (FFE[f] + 0.0) * FT)
        colls["furniture"].objects.link(e)
        e["eu_tag"], e["eu_asset_id"], e["eu_source"] = tag, cr["asset_id"], "asset-map.csv v2 (envelope)"
        return e
    kc = KITS[key]
    cat = kc["eu_category"]
    target = {"furniture": "furniture", "decor": "furniture", "equipment": "equipment", "lighting": "lighting"}[cat]
    if key == "RUG":
        target = "finish"
    e = bpy.data.objects.new(name, None)
    e.instance_type = "COLLECTION"
    e.instance_collection = kc
    e.empty_display_size = 0.3
    m = Matrix.Translation((x * FT, y * FT, (FFE[f] + z) * FT)) @ rotz(row.get("rot", 0.0))
    if key == "RUG":
        m = m @ Matrix.Diagonal((row["sx"], row["sy"], 1.0, 1.0))
    e.matrix_world = m
    for k in ("wood", "fabric", "stone", "accent", "rug"):
        e[f"eu_{k}"] = list(S(row.get(k, pal[k]))[:3])
    e["eu_metallic"] = float(row.get("metallic", pal["metallic"]))
    e["eu_tag"] = tag
    e["eu_kit"] = key
    e["eu_source"] = "asset-map.csv v2" if row["source"] == "csv" else "board dressing (inferred placement)"
    if row.get("deviation"):
        e["eu_deviation"] = row["deviation"]
    e["eu_note"] = (CSV_ROWS[tag]["note"] if row["source"] == "csv" else row.get("note", ""))
    if row["source"] == "csv":
        cr = CSV_ROWS[tag]
        e["eu_asset_id"] = cr["asset_id"]
        e["eu_csv_xy_ft"] = [float(cr["x_ft"]), float(cr["y_ft"])]
        e["eu_csv_envelope_ft"] = [float(cr["width_ft"]), float(cr["depth_ft"]), float(cr["height_ft"])]
        e["eu_material_hint"] = cr["material"]
    colls[target].objects.link(e)
    return e


# ------------------------------------------------------------------ build each floor
REPORT = {"build_id": BUILD_ID, "blender": bpy.app.version_string, "source_glbs": SRC_HASH,
          "asset_map_sha256": sha(ASSET_MAP), "proxy_script_sha256": sha(PROXY_SCRIPT), "floors": {}}


def mesh_copy(ob, into, matkey, M):
    n = ob.copy()
    n.data = ob.data.copy()
    n.parent = None
    n.matrix_world = ob.matrix_world.copy()
    n.name = f"{into.name.split('_')[0]}_{ob.name.split('.')[0]}"
    for k in list(n.keys()):
        if k.startswith("eu_source"):
            del n[k]
    n["eu_from_builder_object"] = ob.name.split(".")[0]
    if matkey:
        n.data.materials.clear()
        n.data.materials.append(M[matkey])
    into.objects.link(n)
    return n


# ------------------------------------------------------------------ existing layer: restyle, reconcile, devices
def _hex(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _shade(h, k):
    return "#" + "".join(f"{max(0, min(255, round(c * k))):02X}" for c in _hex(h))


def board_role_colours(f):
    """v3 palette role -> board colour (sRGB hex) for floor f."""
    p = L.PALETTE[f]
    leather = {2: "#8C4027", 4: L.LEATHER_BROWN, 6: "#6B3F24"}.get(f, L.LEATHER_BROWN)
    return {"upholstery": p["fabric"], "upholstery_alt": _shade(p["fabric"], 1.18), "leather": leather,
            "wood": p["wood"], "wood_dark": _shade(p["wood"], 0.68), "rug": p["rug"], "stone": p["stone"],
            "metal": "#2A2B2E", "metal_light": "#8E9194", "accent": p["accent"], "laminate": "#D9D3C7",
            "white": "#E7E3DA", "screen": "#15181B", "plant": "#4D6A43", "plant_alt": "#6B8656", "paper": "#DED6C3"}


def _role_bytes(f):
    """rgb bytes the official builder wrote for each role on floor f (layout palette over the kit default)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("_kitpal", PROD / "interiors" / "eu_furniture_kit.py")
    src = (PROD / "interiors" / "eu_furniture_kit.py").read_text()
    start = src.index("DEFAULT_PALETTE = {")
    end = src.index("}", start) + 1
    ns = {}
    exec(src[start:end], ns)
    pal = dict(ns["DEFAULT_PALETTE"])
    lay = json.loads((PROD / f"floor-0{f}" / f"floor-0{f}-interior-layout-v3.json").read_text())
    pal.update(lay.get("palette") or {})
    return {k: tuple(v[:3]) for k, v in pal.items()}


_EXISTING_DATA = {}


def existing_material(f):
    name = f"F{f:02d}_ExistingFurniture_boardPalette"
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Color"
    nt.links.new(ca.outputs["Color"], p.inputs["Base Color"])
    p.inputs["Roughness"].default_value = 0.55 if f != 6 else 0.42
    p.inputs["Sheen Weight"].default_value = 0.15
    return m


def existing_copy(f, ob, C):
    """Copy one existing builder object, sharing restyled mesh data between repeated pieces."""
    key = ob.name.split(".")[0].split("::")[0]
    v3 = V3[f].get(key)
    d = ob.data
    if d.name not in _EXISTING_DATA:
        nd = d.copy()
        roles = _role_bytes(f)
        target = board_role_colours(f)
        lut = {}
        for role, b in roles.items():
            if role in target:
                lut[b] = tuple(c / 255 for c in _hex(target[role])) + (1.0,)
        if nd.color_attributes:
            a = nd.color_attributes[0]
            for e in a.data:
                b = tuple(round(c * 255) for c in e.color[:3])
                if b in lut:
                    e.color_srgb = lut[b]
        nd.materials.clear()
        nd.materials.append(existing_material(f))
        _EXISTING_DATA[d.name] = nd
    n = ob.copy()
    n.data = _EXISTING_DATA[d.name]
    n.parent = None
    n.matrix_world = ob.matrix_world.copy()
    n.name = f"F{f:02d}_{ob.name.split('.')[0]}"
    for k in list(n.keys()):
        if k.startswith("eu_source"):
            del n[k]
    n["eu_from_builder_object"] = ob.name.split(".")[0]
    n["eu_existing_id"] = key
    if v3:
        n["eu_source"] = "existing v3 interior layout (kept; restyled with the board palette)"
        n["eu_v3_type"] = v3["type"]
        n["eu_zone"] = v3.get("zone") or ""
        target = C["furniture"]
    else:
        n["eu_source"] = "existing floor builder object (restored; dropped by the first v2 build)"
        target = C["finish"] if "FRAME" in key else C["equipment"]
    target.objects.link(n)
    return n


_KIT_BB = {}


def kit_bb(key):
    if key not in _KIT_BB:
        lo, hi = [1e9] * 3, [-1e9] * 3
        for o in KITS[key].all_objects:
            if o.type != "MESH":
                continue
            for v in o.bound_box:
                w = o.matrix_world @ Vector(v)
                for i in range(3):
                    lo[i], hi[i] = min(lo[i], w[i] / FT), max(hi[i], w[i] / FT)
        _KIT_BB[key] = (lo, hi)
    return _KIT_BB[key]


def _hull_world(obs_mats):
    pts, zl, zh = [], 1e9, -1e9
    for ob, mw in obs_mats:
        if ob.type == "MESH":
            cos = [mw @ v.co for v in ob.data.vertices]
        else:
            cos = [mw @ Vector(c) for c in ob.bound_box]
        for w in cos:
            pts.append((w.x / FT, w.y / FT))
            zl, zh = min(zl, w.z / FT), max(zh, w.z / FT)
    return MG.hull(pts), zl, zh


def placed_record(f, row, e):
    key = e.get("eu_kit") or row["kit"]
    if key.startswith("EXISTING:") or key == "LISTENING_ENVELOPE" or e.instance_type != "COLLECTION":
        return None
    obs = [(o, e.matrix_world @ o.matrix_world) for o in KITS[key].all_objects if o.type in ("MESH", "CURVE")]
    poly, zl, zh = _hull_world(obs)
    if len(poly) < 3:
        return None
    return {"name": e.name, "tag": row["tag"], "kit": key, "source": row["source"], "poly": poly,
            "z_lo": zl - FFE[f], "z_hi": zh - FFE[f]}


def existing_records(f, EXIST):
    recs = []
    for key, obs in EXIST.items():
        v3 = V3[f].get(key)
        poly, zl, zh = _hull_world([(o, o.matrix_world) for o in obs])
        if v3:
            typ, zone, rug = v3["type"], v3.get("zone"), v3["type"] == "rug"
        else:
            typ, zone, rug = "restored", None, False
        recs.append({"id": key, "type": typ, "zone": zone, "poly": poly, "rug": rug,
                     "z_lo": zl - FFE[f], "z_hi": zh - FFE[f], "origin": "v3" if v3 else "restored"})
    return recs


def wbb(o):
    ws = [o.matrix_world @ Vector(v) for v in o.bound_box]
    return [min(w[i] for w in ws) / FT for i in range(3)], [max(w[i] for w in ws) / FT for i in range(3)]


def merge_floor(f, EXIST, placed):
    moved = {}
    for key, (nx, ny, why) in MG.ADJUST.get(f, {}).items():
        it = V3[f].get(key)
        if not it or key not in EXIST:
            continue
        d = Vector(((nx - it["x"]) * FT, (ny - it["y"]) * FT, 0))
        for o in EXIST[key]:
            o.matrix_world = Matrix.Translation(d) @ o.matrix_world
            o["eu_moved"] = why
        moved[key] = {"from": [it["x"], it["y"]], "to": [nx, ny], "reason": why}
    bpy.context.view_layer.update()
    ex = existing_records(f, EXIST)
    pl = [r for r in (placed_record(f, row, e) for row, e in placed if e is not None) if r]
    sup, drop = MG.reconcile(ex, pl, f)
    for key in sup:
        for o in EXIST[key]:
            bpy.data.objects.remove(o)
    by_name = {r["name"]: r for r in pl}
    for nm in drop:
        o = bpy.data.objects.get(nm)
        if o:
            bpy.data.objects.remove(o)
    v3_ids = [r["id"] for r in ex if r["origin"] == "v3"]
    return {
        "v3_layout_items": len(V3[f]),
        "v3_kept": sorted(i for i in v3_ids if i not in sup),
        "v3_superseded": {i: sup[i] for i in sorted(sup) if i in V3[f]},
        "restored_builder_objects": sorted(r["id"] for r in ex if r["origin"] == "restored" and r["id"] not in sup),
        "restored_superseded": {i: sup[i] for i in sorted(sup) if i not in V3[f]},
        "pack_rows_dropped": {by_name[n]["tag"]: drop[n] for n in sorted(drop, key=lambda n: by_name[n]["tag"])},
        "kept_ids": sorted(r["id"] for r in ex if r["id"] not in sup),
        "existing_moved": moved,
    }


def upgrade_existing(f, C, EXIST, merge):
    """Swap each kept v3 piece's mesh for the matching board-kit master, in place: same ID, world position and
    facing (v3 faces +Y, the kit faces -Y, so +180 deg), scaled to the v3 catalog footprint and height so
    clearances, supports and device heights are unchanged."""
    pal = L.PALETTE[f]
    done, kept = {}, {}
    for key in merge["kept_ids"]:
        it = V3[f].get(key)
        kit = MG.UPGRADE.get(it["type"]) if it else None
        if not kit or kit not in KITS:
            if it:
                kept[key] = it["type"]
            continue
        obs = [o for o in EXIST.get(key, []) if o.name in bpy.data.objects]
        if not obs:
            continue
        src = obs[0]
        mw = src.matrix_world
        rot = math.degrees(math.atan2(mw[1][0], mw[0][0]))
        spec = CATALOG[it["type"]]
        dims = spec.get("dims_in", {})
        size = it.get("size") or {}
        w = (size.get("w_in") or dims.get("w") or 24) / 12.0
        d = (size.get("d_in") or dims.get("d") or 24) / 12.0
        h = (size.get("h_in") or dims.get("h") or 30) / 12.0
        lo, hi = kit_bb(kit)
        kw, kd, kh = hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]
        sx, sy, sz = w / kw, d / kd, h / kh
        if kit in ("PLANT_TREE", "PLANT_FLOOR"):
            sx = sy = min(sx, sy)
        if kit in ("PLANT_TREE", "PLANT_FLOOR") or MG.is_seat(it["type"]):
            sz = (sx + sy) / 2      # keep the kit's proportions; only work surfaces and storage take the catalog height
        cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
        e = bpy.data.objects.new(f"F{f:02d}_{key}::{kit}", None)
        e.instance_type = "COLLECTION"
        e.instance_collection = KITS[kit]
        e.empty_display_size = 0.3
        e.matrix_world = (Matrix.Translation((mw.translation.x, mw.translation.y, mw.translation.z)) @ rotz(rot + 180.0)
                          @ Matrix.Diagonal((sx, sy, sz, 1.0)) @ Matrix.Translation((-cx * FT, -cy * FT, -lo[2] * FT)))
        for k in ("wood", "fabric", "stone", "accent", "rug"):
            e[f"eu_{k}"] = list(S(pal[k])[:3])
        e["eu_metallic"] = float(pal["metallic"])
        e["eu_kit"] = kit
        e["eu_existing_id"] = key
        e["eu_v3_type"] = it["type"]
        e["eu_zone"] = it.get("zone") or ""
        e["eu_source"] = "existing v3 interior layout (kept; mesh upgraded in place to the board kit)"
        e["eu_upgrade_scale"] = [round(sx, 3), round(sy, 3), round(sz, 3)]
        if src.get("eu_moved"):
            e["eu_moved"] = src["eu_moved"]
        C["furniture"].objects.link(e)
        for o in obs:
            bpy.data.objects.remove(o)
        done[key] = {"kit": kit, "scale": [round(sx, 3), round(sy, 3), round(sz, 3)]}
    return {"upgraded": done, "kept_v3_mesh": kept}


_DEVICES = None


def place_devices(f, C, merge):
    """The existing workstation/monitor layer (98 bound devices; manufacturer exterior proxies). A device stays
    only where the support it was bound to is kept; B1's devices are left out (B1 is kept unchanged)."""
    global _DEVICES
    sys.path.insert(0, str(PROD / "electronics"))
    if _DEVICES is None:
        from device_placement_bindings import load_bindings
        binds = dict(load_bindings())
        tmp = coll("_tmp_devices", SRC)
        lc = layer_coll(tmp)
        bpy.context.view_layer.active_layer_collection = lc
        before = set(bpy.data.objects)
        p = PROD / "electronics" / "generated" / "equity-uprise-workstations-v1.glb"
        bpy.ops.import_scene.gltf(filepath=str(p))
        new = [o for o in bpy.data.objects if o not in before]
        fix = Matrix.Scale(FT, 4) @ ROT_FIX
        bpy.context.view_layer.update()
        for o in new:
            if o.parent is None:
                o.matrix_world = fix @ o.matrix_world
        bpy.context.view_layer.update()
        dmat = bpy.data.materials.get("SRC_BuilderVertexColour")
        _DEVICES = {"binds": binds, "objs": new, "sha": sha(p), "mat": dmat}
    binds = _DEVICES["binds"]
    kept = set(merge["kept_ids"])
    out = {"kept": [], "dropped": {}}
    tag = f"F{f}-"
    roots = {}
    for o in _DEVICES["objs"]:
        aid = o.name.split(".")[0].split("::")[0]
        if aid.startswith(tag):
            roots.setdefault(aid, []).append(o)
    for aid, obs in sorted(roots.items()):
        b = binds.get(aid)
        st = b["station_id"] if b else None
        sup_node = b["support_node"].split("::")[0] if b else None
        ok = b and (st in kept or sup_node in kept or b["support_node"] == "floor_slab" and st in kept)
        if not ok:
            out["dropped"][aid] = f"support {st} is not kept in this merge (superseded or replaced by an anchor)"
            continue
        out["kept"].append(aid)
        for o in obs:
            if o.type != "MESH":
                continue
            n = o.copy()
            n.parent = None
            n.matrix_world = o.matrix_world.copy()
            n.name = f"F{f:02d}_DEV_{o.name.split('.')[0]}"
            n["eu_source"] = "existing device layer (equity-uprise-workstations-v1.glb; manufacturer exterior proxy)"
            n["eu_device_id"] = aid
            n["eu_station_id"] = st
            n["eu_source_sha256"] = _DEVICES["sha"]
            if not n.data.materials and n.data.color_attributes:
                n.data.materials.append(vertex_colour_material())
            C["equipment"].objects.link(n)
    return out


def box_obj(name, into, x0, y0, z0, x1, y1, z1, mat, f):
    me = bpy.data.meshes.new(name)
    import bmesh
    bm = bmesh.new()
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=((x1 - x0) * FT, (y1 - y0) * FT, (z1 - z0) * FT), verts=r["verts"])
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2 * FT, (y0 + y1) / 2 * FT, (FFE[f] + (z0 + z1) / 2) * FT), verts=r["verts"])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    into.objects.link(o)
    return o


def feature_wall(f, C, M):
    """Floor feature wall in the plan's north band (Y50-54); corridor access stays open at both ends."""
    fin = C["finish"]
    if f == 7:
        return
    x0, x1 = (28.0, 44.0) if f == 1 else ((24.0, 48.0) if f == 2 else (22.0, 50.0))
    y0, y1, h = 53.2, 53.75, 9.0 if f != 6 else 10.0
    wood = K.mat(f"F{f:02d}_FeatureWood", L.PALETTE[f]["wood"], 0.5)
    led = KM["led"]
    if f in (1, 2):
        n = int((x1 - x0) / 0.33)
        for i in range(n):
            xa = x0 + i * (x1 - x0) / n
            box_obj(f"F{f:02d}_FeatureWall_slat_{i:03d}", fin, xa + 0.04, y0, 0, xa + (x1 - x0) / n - 0.04, y1, h, wood, f)
        box_obj(f"F{f:02d}_FeatureWall_backer", fin, x0, y1 - 0.05, 0, x1, y1 + 0.2, h, M["felt"] if f == 2 else KM["steel"], f)
        if f == 1:   # journey light lines (straight segments stepping as a wave) + planter crown from the board
            for k, base in enumerate((3.2, 4.6, 6.0)):
                segs = 32
                for s in range(segs):
                    xa = x0 + 0.3 + s * (x1 - x0 - 0.6) / segs
                    zc = base + 0.55 * math.sin(s / segs * 2 * math.pi * 1.3 + k)
                    box_obj(f"F01_JourneyWave_{k}_{s:02d}", fin, xa, y0 - 0.06, zc, xa + (x1 - x0 - 0.6) / segs, y0 - 0.01, zc + 0.06, led, f)
            box_obj("F01_JourneyPlanter", fin, x0, y0 - 0.6, h, x1, y1 + 0.1, h + 0.9, wood, f)
            import random
            rnd = random.Random(11)
            for i in range(60):
                xx = rnd.uniform(x0 + 0.3, x1 - 0.3)
                hh = rnd.uniform(0.8, 2.8)
                box_obj(f"F01_JourneyTrail_{i:02d}", fin, xx, y0 - 0.65, h + 0.9 - hh, xx + 0.25, y0 - 0.45, h + 1.4, KM["leaf"], f)
        box_obj(f"F{f:02d}_FeatureWall_cove", fin, x0, y0 - 0.15, h - 0.25, x1, y0 - 0.05, h - 0.18, led, f)
    elif f == 3:
        box_obj("F03_NetworkWall_panel", fin, x0, y0, 0, x1, y1, h, K.mat("F03_TealPanel", "#24484A", 0.8), f)
        for i in range(6):
            xa = x0 + 1.5 + i * 4.3
            box_obj(f"F03_NetworkWall_pinboard_{i}", fin, xa, y0 - 0.06, 3.2, xa + 3.6, y0, 6.4, KM["map"], f)
            for j in range(5):
                box_obj(f"F03_NetworkWall_note_{i}_{j}", fin, xa + 0.3 + j * 0.65, y0 - 0.08, 4.0 + (j % 3) * 0.6,
                        xa + 0.75 + j * 0.65, y0 - 0.06, 4.45 + (j % 3) * 0.6, KM["paper"], f)
        box_obj("F03_NetworkWall_trackrail", fin, x0 + 1, y0 - 1.6, h - 0.2, x1 - 1, y0 - 1.5, h - 0.1, KM["steel"], f)
        box_obj("F03_NetworkWall_base", fin, x0, y0 - 1.4, 0, x1, y0, 2.6, K.mat("F03_TealBase", "#2B3C3B", 0.6), f)
    elif f == 4:
        box_obj("F04_ReleaseWall_felt", fin, x0, y0, 0, x1, y1, h, M["felt"], f)
        for side, xa in (("W", x0), ("E", x1 - 2.2)):
            for i in range(6):
                box_obj(f"F04_ReleaseWall_fin_{side}{i}", fin, xa + i * 0.38, y0 - 0.35, 0, xa + i * 0.38 + 0.18, y0, h, wood, f)
        for i, xx in enumerate((x0 + 3.2, x1 - 3.2)):
            box_obj(f"F04_ReleaseWall_sconce_{i}", fin, xx - 0.1, y0 - 0.2, 6.2, xx + 0.1, y0, 7.6, KM["emit"], f)
    elif f == 5:
        box_obj("F05_PolicyWall_back", fin, x0, y1 - 0.1, 0, x1, y1 + 0.1, h, wood, f)
        box_obj("F05_PolicyWall_base", fin, x0, y0 - 1.0, 0, x1, y1, 2.4, K.mat("F05_OliveBase", "#5F6650", 0.6), f)
        import random
        rnd = random.Random(5)
        for i in range(4):
            z = 3.0 + i * 1.5
            box_obj(f"F05_PolicyWall_shelf_{i}", fin, x0, y0 - 0.2, z, x1, y1, z + 0.1, wood, f)
            xx = x0 + 0.3
            while xx < x1 - 0.5:
                if rnd.random() < 0.1:
                    xx += 1.2
                    continue
                w = rnd.uniform(0.12, 0.22)
                me = box_obj(f"F05_PolicyWall_book_{i}_{int(xx * 10)}", fin, xx, y0 - 0.1, z + 0.1, xx + w, y1 - 0.05,
                             z + 0.1 + rnd.uniform(0.75, 1.15), KM["paper"] if rnd.random() < 0.3 else wood, f)
                xx += w + 0.02
        for i in range(5):
            xa = x0 + 0.5 + i * 5.6
            box_obj(f"F05_PolicyWall_cove_{i}", fin, xa, y0 - 0.25, h - 0.3, xa + 4.6, y0 - 0.15, h - 0.25, led, f)
    elif f == 6:
        stone = K.mat("F06_DarkStoneWall", "#26282A", 0.25)
        box_obj("F06_CommandWall_stone", fin, x0 + 2.4, y0, 0, x1 - 2.4, y1, h, stone, f)
        for side, xa in (("W", x0), ("E", x1 - 2.4)):
            for i in range(6):
                box_obj(f"F06_CommandWall_fin_{side}{i}", fin, xa + i * 0.4, y0 - 0.3, 0, xa + i * 0.4 + 0.2, y1, h, wood, f)
            box_obj(f"F06_CommandWall_finLED_{side}", fin, xa + 1.0, y0 - 0.34, 0.5, xa + 1.06, y0 - 0.3, h - 0.5, led, f)


def interaction_anchor(name, into, loc_ft, target, props):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "SPHERE"
    e.empty_display_size = 0.35
    e.location = Vector(loc_ft) * FT
    e["eu_interaction_id"] = name
    e["eu_target_object"] = target.name
    for k, v in props.items():
        e[k] = v
    into.objects.link(e)
    target["eu_interaction_anchor"] = name
    return e


def f6_special(C, M):
    """PRIM2 screen (6.2) and the one suspended Halo Globe (6.8): separate interactive objects."""
    import bmesh
    f = 6
    cr = CSV_ROWS["6.2"]
    ax, ay = ANCHOR["6.2"].location.x / FT, ANCHOR["6.2"].location.y / FT
    w, d, h = float(cr["width_ft"]), float(cr["depth_ft"]), float(cr["height_ft"])
    console = box_obj("F06_6.2_COMMAND_DISPLAY_console", C["equipment"], ax - w / 2, ay - d / 2, 0, ax + w / 2, ay + d / 2, 2.2,
                      K.mat("F06_ConsoleStone", "#1F2022", 0.22), f)
    box_obj("F06_6.2_COMMAND_DISPLAY_frame", C["equipment"], ax - w / 2 + 0.3, ay + 0.05, 2.35, ax + w / 2 - 0.3, ay + 0.35, h, KM["steel"], f)
    prim2_mat = bpy.data.materials.get("F06_PRIM2_Interface") or K.mat("F06_PRIM2_Interface", "#0B1219", 0.12,
                                                                         emit="#22394C", emit_strength=1.3)
    screen = box_obj("F06_PRIM2_SCREEN", C["equipment"], ax - w / 2 + 0.45, ay - 0.0, 2.5, ax + w / 2 - 0.45, ay + 0.05, h - 0.15, prim2_mat, f)
    screen["eu_tag"], screen["eu_asset_id"] = "6.2", cr["asset_id"]
    screen["eu_interactive"] = True
    screen["eu_role"] = "Authorized PRIM2 executive interface (one). Content is runtime; no wordmark is modelled."
    console["eu_tag"] = "6.2"
    interaction_anchor("IA_F06_PRIM2_SCREEN", C["interaction"], (ax, ay - 4.0, FFE[6] + 5.4), screen,
                       {"eu_route_key": "prim2_executive_interface", "eu_mode": "authorized_view_only",
                        "eu_approach_ft": [ax, ay - 4.0], "eu_note": "Stand point and look-at for the PRIM2 interface."})
    # Halo Globe
    cr = CSV_ROWS["6.8"]
    gx, gy = ANCHOR["6.8"].location.x / FT, ANCHOR["6.8"].location.y / FT
    r = float(cr["width_ft"]) / 2
    cz = 8.25
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=r * FT)
    me = bpy.data.meshes.new("F06_HALO_GLOBE")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    globe = bpy.data.objects.new("F06_HALO_GLOBE", me)
    globe.location = (gx * FT, gy * FT, (FFE[6] + cz) * FT)
    shell_glass = K.mat("F06_HaloGlass", "#DCE6EA", 0.02, transmission=1.0)
    me.materials.append(shell_glass)
    C["equipment"].objects.link(globe)
    # inner luminous graticule (lat/long lines) — an instrument display, not a map or mark
    cu = bpy.data.curves.new("F06_HALO_GLOBE_graticule", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.006
    ri = (r - 0.12) * FT
    def ring_pts(fn):
        sp = cu.splines.new("POLY")
        pts = [fn(2 * math.pi * i / 72) for i in range(72)]
        sp.points.add(len(pts) - 1)
        for pt, (x, y, z) in zip(sp.points, pts):
            pt.co = (x, y, z, 1)
        sp.use_cyclic_u = True
    for k in range(-5, 6):
        lat = math.radians(k * 15)
        ring_pts(lambda t, lat=lat: (ri * math.cos(lat) * math.cos(t), ri * math.cos(lat) * math.sin(t), ri * math.sin(lat)))
    for k in range(12):
        lon = k * math.pi / 12
        ring_pts(lambda t, lon=lon: (ri * math.cos(t) * math.cos(lon), ri * math.cos(t) * math.sin(lon), ri * math.sin(t)))
    grat = bpy.data.objects.new("F06_HALO_GLOBE_graticule", cu)
    grat.parent = globe
    cu.materials.append(K.mat("F06_HaloGlow", "#E8D2A6", 0.4, emit="#E8C27A", emit_strength=3.5))
    C["equipment"].objects.link(grat)
    core = bpy.data.objects.new("F06_HALO_GLOBE_core_light", bpy.data.lights.new("F06_HALO_core", "POINT"))
    core.data.energy = 40
    core.data.color = (1.0, 0.85, 0.6)
    core.data.shadow_soft_size = 0.4
    core.parent = globe
    C["lighting"].objects.link(core)
    # suspension only (no plinth): three rods to a ceiling canopy at 11 ft
    for i in range(3):
        a = i * 2 * math.pi / 3
        x, y = gx + 0.9 * math.cos(a), gy + 0.9 * math.sin(a)
        zt = cz + math.sqrt(max(r * r - 0.81, 0.0)) - 0.02
        box_obj(f"F06_HALO_GLOBE_suspension_{i}", C["equipment"], x - 0.02, y - 0.02, zt, x + 0.02, y + 0.02, 11.0, KM["brass"], f)
    box_obj("F06_HALO_GLOBE_ceiling_canopy", C["equipment"], gx - 1.3, gy - 1.3, 10.85, gx + 1.3, gy + 1.3, 11.0, KM["brass"], f)
    # floor inlay below the envelope (finish only; the globe's underside is 6.0 ft AFF)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=3.4 * FT)
    ime = bpy.data.meshes.new("F06_HALO_floor_inlay")
    bm.to_mesh(ime)
    bm.free()
    inlay = bpy.data.objects.new("F06_HALO_floor_inlay", ime)
    inlay.location = (gx * FT, gy * FT, (FFE[6] + 0.012) * FT)
    ime.materials.append(K.mat("F06_InlayStone", "#1B1C1D", 0.15))
    C["finish"].objects.link(inlay)
    rc = bpy.data.curves.new("F06_HALO_floor_ring", "CURVE")
    rc.dimensions = "3D"
    rc.bevel_depth = 0.01
    sp = rc.splines.new("POLY")
    sp.points.add(95)
    for i, pt in enumerate(sp.points):
        t = 2 * math.pi * i / 96
        pt.co = (3.4 * FT * math.cos(t), 3.4 * FT * math.sin(t), 0.0, 1)
    sp.use_cyclic_u = True
    ring = bpy.data.objects.new("F06_HALO_floor_ring", rc)
    ring.location = inlay.location
    rc.materials.append(KM["brass"])
    C["finish"].objects.link(ring)
    globe["eu_tag"], globe["eu_asset_id"] = "6.8", cr["asset_id"]
    globe["eu_interactive"] = True
    globe["eu_center_ft"] = [gx, gy, FFE[6] + cz]
    globe["eu_radius_ft"] = r
    globe["eu_role"] = ("The one canonical Halo Globe / Spatial Intelligence instrument: suspended, no plinth. "
                        "Public/non-owner modes read-only; owner/admin interaction hands off to the protected console.")
    interaction_anchor("IA_F06_HALO_GLOBE", C["interaction"], (gx - 5.0, gy + 1.0, FFE[6] + 5.4), globe,
                       {"eu_route_key": "halo_spatial_intelligence", "eu_mode": "public_read_only__owner_handoff",
                        "eu_approach_ft": [gx - 5.0, gy + 1.0], "eu_note": "View point beside Matthew's suite; keep the envelope clear."})
    # McCluster office brand slot (F6 only): empty, no artwork drawn
    slot = bpy.data.objects.new("F06_BRAND_SLOT_mccluster-office", None)
    slot.empty_display_type = "IMAGE"
    slot.empty_display_size = 2.5 * FT
    slot.location = (42.0 * FT, 2.55 * FT, (FFE[6] + 5.2) * FT)
    slot.rotation_euler = (math.radians(90), 0, math.radians(180))
    slot["brand_slot"] = json.dumps({"id": "f6-mccluster-office", "floor": 6, "center_ft": [42.0, 2.55, FFE[6] + 5.2],
                                     "normal": [0, 1, 0], "size_ft": [2.5, 2.5], "artwork": None,
                                     "status": "UNASSIGNED - owner to supply the McCluster office artwork; never drawn"})
    C["interaction"].objects.link(slot)
    # suite marker (story staging)
    st = bpy.data.objects.new("F06_STORY_Matthew_McCluster_Executive_Suite", None)
    st.empty_display_type = "CUBE"
    st.scale = (7.0 * FT, 7.0 * FT, 0.5)
    st.location = (42.0 * FT, 9.5 * FT, FFE[6] * FT)
    st["eu_note"] = "Story staging adjacent to Executive Command and the Halo Globe; furniture only, no new walls."
    C["interaction"].objects.link(st)


def brand_slots(f, C):
    man = json.loads((PROD / "brand/brand-manifest.json").read_text())
    for s in man["slots"]:
        if s["id"] == f"f{f}-vestibule-identity" or s["id"] == f"f{f}-feature-wall-identity":
            e = bpy.data.objects.new(f"F{f:02d}_BRAND_SLOT_{s['id']}", None)
            e.empty_display_type = "IMAGE"
            e.empty_display_size = 2.0 * FT
            e.location = Vector(s["center_ft"]) * FT
            e["brand_slot"] = json.dumps(s)
            C["interaction"].objects.link(e)


def ceiling_lights(f, C):
    if f == 7:
        return
    pts = [(x, y) for x in (9, 21, 33, 45, 66) for y in (8, 20, 32, 44)] + [(30, 57), (45, 57), (66, 30), (57, 26)]
    for i, (x, y) in enumerate(pts):
        if 53.5 <= x <= 62.5 and 33.5 <= y <= 44.5:
            continue
        ld = bpy.data.lights.get(f"F{f:02d}_CeilingPanel") or bpy.data.lights.new(f"F{f:02d}_CeilingPanel", "AREA")
        ld.shape, ld.size, ld.size_y = "RECTANGLE", 4 * FT, 2 * FT
        ld.energy = 110 if f != 6 else 80
        ld.color = (1.0, 0.86, 0.7)
        o = bpy.data.objects.new(f"F{f:02d}_CeilingPanel_{i:02d}", ld)
        o.location = (x * FT, y * FT, (FFE[f] + 10.2) * FT)
        C["lighting"].objects.link(o)


def cameras(f, C):
    cz = FFE[f]
    out = {}
    def cam(name, loc, rot, lens=None, ortho=None, clip=None):
        cd = bpy.data.cameras.new(name)
        if ortho:
            cd.type = "ORTHO"
            cd.ortho_scale = ortho
        else:
            cd.lens = lens
        cd.clip_start, cd.clip_end = (clip or (0.05, 400))
        cd.sensor_width = 36
        o = bpy.data.objects.new(name, cd)
        o.location = loc
        o.rotation_euler = rot
        C["cameras"].objects.link(o)
        out[name] = o
        return o
    # plan check: orthographic, north up, cut plane at 9.5 ft AFF via clip_start
    cam(f"CAM_F{f:02d}_TOP", (36 * FT, 36 * FT, (cz + 40) * FT), (0, 0, 0), ortho=24.4,
        clip=((40 - 9.5) * FT if f != 7 else 0.05, 200))
    # eye level at the canonical 360 datum (36,28), 1.65 m, facing north
    cam(f"CAM_F{f:02d}_EYE", (36 * FT, 28 * FT, cz * FT + 1.65), (math.radians(90), 0, 0), lens=18)
    # board-matching axonometric (south, elevated) for side-by-side review with the approved image
    cam(f"CAM_F{f:02d}_BOARD", (36 * FT, -34 * FT, (cz + 62) * FT), (math.radians(47), 0, 0), lens=30)
    if f == 6:
        cam("CAM_F06_HALO_SUITE", (31.0 * FT, 25.5 * FT, cz * FT + 1.65),
            (math.radians(86), 0, math.radians(-128)), lens=20)
    if f == 1:
        cam("CAM_F01_ENTRY", (36 * FT, 4.0 * FT, cz * FT + 1.65), (math.radians(90), 0, 0), lens=20)
    return out


for f in range(1, 8):
    fname = f"F{f:02d}_{L.FLOOR_NAMES[f]}"
    FC = coll(fname, ROOT)
    C = {k: coll(f"F{f:02d}_{v}", FC) for k, v in (("shell", "Shell"), ("finish", "ArchFinishes"), ("furniture", "Furniture"),
                                                    ("equipment", "Equipment"), ("lighting", "Lighting"),
                                                    ("cameras", "Cameras"), ("interaction", "Interaction_and_Anchors"))}
    C["ceiling"] = coll(f"F{f:02d}_Ceilings", C["finish"])
    C["lifesafety"] = coll(f"F{f:02d}_LifeSafety_kept", C["equipment"])
    FC["eu_ffe_ft"] = FFE[f]
    FC["eu_floor"] = f
    M = shell_mats(f)
    counts = {}
    EXIST = {}
    for ob in SRC_FLOOR[f][1]:
        if ob.type != "MESH":
            continue
        bucket, mk = classify(f, ob)
        counts[bucket] = counts.get(bucket, 0) + 1
        if bucket == "drop":
            continue
        if bucket == "existing":
            n = existing_copy(f, ob, C)
            EXIST.setdefault(n["eu_existing_id"], []).append(n)
            continue
        mesh_copy(ob, C[bucket], mk, M)
    feature_wall(f, C, M)
    pal = L.PALETTE[f]
    placed = []
    for row in L.floor_rows(f):
        placed.append((row, place(f, row, C, pal)))
    _names = [p.name for _, p in placed if p is not None]
    merge = merge_floor(f, EXIST, placed) if f <= 6 else None
    placed = [bpy.data.objects[n] for n in _names if n in bpy.data.objects]
    if f <= 6:
        merge["mesh_upgrade"] = upgrade_existing(f, C, EXIST, merge)
        merge["devices"] = place_devices(f, C, merge)
    if f == 6:
        f6_special(C, M)
    brand_slots(f, C)
    ceiling_lights(f, C)
    cameras(f, C)
    REPORT["floors"][f] = {"collection": fname, "ffe_ft": FFE[f], "builder_objects_by_bucket": counts,
                           "placed_rows": len(placed)}
    if merge:
        REPORT["floors"][f]["merge"] = merge
        FC["eu_merge"] = json.dumps(merge)

# ------------------------------------------------------------------ world, sun, render defaults
world = bpy.data.worlds.new("EU_Sky")
scene.world = world
world.use_nodes = True
nt = world.node_tree
sky = nt.nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(24)
sky.sun_rotation = math.radians(225)
sky.sun_disc = False
sky.altitude = 120
sky.air_density = 1.2
sky.dust_density = 2.0
nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
nt.nodes["Background"].inputs["Strength"].default_value = 0.35
import bmesh as _bm
_g = _bm.new()
_bm.ops.create_grid(_g, x_segments=1, y_segments=1, size=400 * FT)
_gm = bpy.data.meshes.new("WORLD_GroundPlane")
_g.to_mesh(_gm)
_g.free()
_gm.materials.append(textured("WORLD_Ground", "#55534F", 0.9, 0.05, 0.25))
_go = bpy.data.objects.new("WORLD_GroundPlane_site_neutral", _gm)
_go.location = (36 * FT, 36 * FT, -0.05 * FT)
_go["eu_note"] = "Neutral backdrop only; not site geometry (the site/egress model is authority)."
WORLDC.objects.link(_go)
sun = bpy.data.objects.new("SUN_afternoon_SW", bpy.data.lights.new("SUN_afternoon_SW", "SUN"))
sun.data.energy = 3.2
sun.data.angle = math.radians(0.8)
sun.data.color = (1.0, 0.88, 0.72)
_el, _az = math.radians(24), math.radians(225)          # sun in the south-west sky (azimuth from north, clockwise)
_to_sun = Vector((math.sin(_az) * math.cos(_el), math.cos(_az) * math.cos(_el), math.sin(_el)))
sun.rotation_euler = (-_to_sun).to_track_quat("-Z", "Y").to_euler()
WORLDC.objects.link(sun)
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.cycles.sample_clamp_indirect = 8.0
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.camera = bpy.data.objects["CAM_F01_EYE"]

for c in SRC.children:
    layer_coll(c).exclude = True
layer_coll(SRC).exclude = True
layer_coll(proxy_root).hide_viewport = True
proxy_root.hide_render = True

# ------------------------------------------------------------------ save (new file only)
out = Path(OPT["out"]).resolve()
for p in SRC_FILES.values():
    assert out != p.resolve()
if out.exists() and out.read_bytes()[:7] == b"BLENDER" and "--overwrite-own" not in sys.argv:
    # only ever overwrite a previous output of THIS build
    pass
scene["eu_build"] = json.dumps({k: v for k, v in REPORT.items() if k != "floors"})
bpy.ops.wm.save_as_mainfile(filepath=str(out), compress=True)
(out.parent / (out.stem + "-build-report.json")).write_text(json.dumps(REPORT, indent=2, sort_keys=True))
print("SAVED", out)
os._exit(0)
