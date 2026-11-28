import bpy, csv, sys
from pathlib import Path
FT = 0.3048
ASSET_MAP = Path(__file__).resolve().with_name("asset-map.csv") if "__file__" in globals() else None
if "--" in sys.argv:
    ASSET_MAP = Path(sys.argv[sys.argv.index("--") + 1])
if ASSET_MAP is None or not ASSET_MAP.is_file():
    raise RuntimeError("Set ASSET_MAP to the asset-map.csv path")
with ASSET_MAP.open(encoding="utf-8-sig", newline="") as f:
    rows = list(csv.DictReader(f))
scene = bpy.context.scene
root = bpy.data.collections.get("EU_Concept_Asset_Proxies")
if root is None:
    root = bpy.data.collections.new("EU_Concept_Asset_Proxies")
if scene.collection.children.get(root.name) is None:
    scene.collection.children.link(root)
for row in rows:
    floor = int(row["floor"])
    name = "EU_CONCEPT_F%02d" % floor
    sub = root.children.get(name)
    if sub is None:
        sub = bpy.data.collections.new(name)
        root.children.link(sub)
    uid = "EU_PROP_%s_%s" % (row["tag"], row["asset_id"])
    if sub.objects.get(uid) is not None:
        continue
    obj = bpy.data.objects.new(uid, None)
    obj.empty_display_type = "CUBE"
    obj.empty_display_size = 1.0
    obj.scale = tuple(float(row[k])*FT/2 for k in ("width_ft","depth_ft","height_ft"))
    obj.location = (float(row["x_ft"])*FT,float(row["y_ft"])*FT,((floor-1)*13.5+(8.25 if row["asset_id"] == "HALO_GLOBE" else float(row["height_ft"])/2))*FT)
    obj["asset_id"], obj["material_hint"], obj["notes"] = row["asset_id"], row["material"], row["note"]
    sub.objects.link(obj)
print(f"Read {len(rows)} concept placements. No Blender file saved.")
