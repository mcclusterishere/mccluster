#!/usr/bin/env python3
"""Build the detailed Equity Uprise exterior facade GLB.

Deterministic digital-twin / visualization geometry only.
NOT FOR CONSTRUCTION, FABRICATION, CODE APPROVAL, OR ENERGY COMPLIANCE.
"""
from pathlib import Path
import json, hashlib
from collections import Counter
import trimesh

HERE=Path(__file__).resolve().parent
INV_RAW=json.loads((HERE/"facade-module-inventory.json").read_text())
OUTDIR=HERE.parent/"generated"
OUTDIR.mkdir(parents=True,exist_ok=True)
OUT=OUTDIR/"equity-uprise-facade-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-facade-core-v2-report.json"
FT=.3048

C={
 "FAC-GLASS-01":[150,183,196,105],
 "FAC-GLASS-02":[132,157,168,165],
 "FAC-METAL-01":[42,45,48,255],
 "FAC-OPAQUE-01":[50,52,54,255],
 "FAC-MINERAL-01":[117,113,106,255],
 "FAC-WARM-01":[111,78,54,255],
 "FAC-SIGN-01":[232,219,188,255],
 "FAC-LOUVER-01":[61,64,67,255],
}
scene=trimesh.Scene()
modeled=set()
records=[]

def add_box(name,x1,y1,z1,x2,y2,z2,color,obj=None):
    if not (x2>x1 and y2>y1 and z2>z1):
        raise ValueError(f"invalid box {name}: {(x1,y1,z1,x2,y2,z2)}")
    m=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,(z2-z1)*FT))
    m.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,((z1+z2)/2)*FT))
    m.visual.face_colors=color
    scene.add_geometry(m,node_name=name,geom_name=name)
    records.append({"name":name,"bounds_ft":[x1,y1,z1,x2,y2,z2]})
    if obj: modeled.add(obj)
    return m

def panel(name,elev,a,b,z1,z2,depth,color,obj=None,extra_out=0.0):
    if b-a <= 1e-6 or z2-z1 <= 1e-6: return
    e=elev.lower(); d=depth
    if e=="south":
        add_box(name,a,-d-extra_out,z1,b,-extra_out,z2,color,obj)
    elif e=="north":
        add_box(name,a,72+extra_out,z1,b,72+d+extra_out,z2,color,obj)
    elif e=="west":
        add_box(name,-d-extra_out,a,z1,-extra_out,b,z2,color,obj)
    elif e=="east":
        add_box(name,72+extra_out,a,z1,72+d+extra_out,b,z2,color,obj)
    else:
        raise ValueError(elev)

def story_bands(level,z0):
    if level==1:
        return (z0,z0+.5,z0+11.0,z0+13.5)
    if level==6:
        return (z0,z0+1.0,z0+10.25,z0+13.5)
    return (z0,z0+1.5,z0+10.5,z0+13.5)

def build_module(m):
    obj=m["id"]; elev=m["elevation"]; a,b=m["span_ft"]; level=m["level"]; z0=m["z0_ft"]
    cls=m["classification"]; mat=m["material_id"]; inset=.12; aa=a+inset; bb=b-inset
    zbase,zvis1,zvis2,ztop=story_bands(level,z0)
    opaque=C["FAC-MINERAL-01"] if level==1 else C["FAC-OPAQUE-01"]
    glass=C["FAC-GLASS-02"] if cls=="privacy_vision" else C["FAC-GLASS-01"]

    if cls in ("clear_vision","privacy_vision"):
        panel(obj+"::lower",elev,aa,bb,zbase,zvis1,.24,opaque,obj)
        panel(obj+"::vision",elev,aa,bb,zvis1,zvis2,.18,glass)
        panel(obj+"::upper",elev,aa,bb,zvis2,ztop,.24,C["FAC-OPAQUE-01"])
    elif cls=="entrance_door":
        panel(obj+"::threshold",elev,aa,bb,z0,z0+.25,.25,C["FAC-MINERAL-01"],obj)
        panel(obj+"::door-glass",elev,aa,bb,z0+.25,z0+9.5,.20,C["FAC-GLASS-01"])
        panel(obj+"::header",elev,aa,bb,z0+9.5,ztop,.28,C["FAC-WARM-01"])
    elif cls in ("acoustic_opaque","service_opaque"):
        panel(obj+"::opaque",elev,aa,bb,zbase,ztop,.28,C["FAC-OPAQUE-01"],obj)
        # subtle inset shadow joint
        mid=(a+b)/2
        panel(obj+"::joint",elev,mid-.045,mid+.045,z0+.5,ztop-.5,.34,C["FAC-METAL-01"])
    elif cls=="stair_core_glazing":
        mid=(a+b)/2; sw=.8
        panel(obj+"::left",elev,aa,mid-sw,zbase,ztop,.28,C["FAC-OPAQUE-01"],obj)
        panel(obj+"::right",elev,mid+sw,bb,zbase,ztop,.28,C["FAC-OPAQUE-01"])
        panel(obj+"::sill",elev,mid-sw,mid+sw,zbase,z0+2.0,.28,C["FAC-OPAQUE-01"])
        panel(obj+"::slit",elev,mid-sw,mid+sw,z0+2.0,z0+11.3,.18,C["FAC-GLASS-02"])
        panel(obj+"::head",elev,mid-sw,mid+sw,z0+11.3,ztop,.28,C["FAC-OPAQUE-01"])
    elif cls in ("restroom_clerestory","support_clerestory"):
        panel(obj+"::lower-opaque",elev,aa,bb,zbase,z0+7.4,.28,C["FAC-OPAQUE-01"],obj)
        panel(obj+"::clerestory",elev,aa,bb,z0+7.4,z0+10.25,.18,C["FAC-GLASS-02"])
        panel(obj+"::upper-opaque",elev,aa,bb,z0+10.25,ztop,.28,C["FAC-OPAQUE-01"])
    elif cls=="louver_service":
        panel(obj+"::back",elev,aa,bb,zbase,ztop,.28,C["FAC-OPAQUE-01"],obj)
        # Visible louver blades live slightly outside the backing panel.
        for k in range(7):
            zz=z0+3.0+k*.95
            panel(obj+f"::louver-{k+1:02d}",elev,aa+.25,bb-.25,zz,zz+.16,.18,C["FAC-LOUVER-01"],extra_out=.30)
    else:
        raise ValueError(f"unknown facade classification {cls}")

# 288 canonical floor/elevation modules.
for module in INV_RAW["modules"]:
    build_module(module)

# Repeated mullion + transom family. This is deliberate geometry, not painted lines.
for level in range(1,7):
    z0=(level-1)*13.5
    _,v1,v2,_=story_bands(level,z0)
    for elev in ("south","east","north","west"):
        for x in range(0,73,6):
            a=max(0,x-.10);b=min(72,x+.10)
            if b>a: panel(f"FAC-MULLION-{elev.upper()}-F{level}-{x:02d}",elev,a,b,z0,z0+13.5,.38,C["FAC-METAL-01"])
        for idx,z in enumerate((v1,v2),1):
            panel(f"FAC-TRANSOM-{elev.upper()}-F{level}-{idx}",elev,0,72,z-.09,z+.09,.38,C["FAC-METAL-01"])

# Stronger 18 ft structural rhythm. South center fin starts above Floor 1 to keep the entry identity clear.
for elev in ("south","east","north","west"):
    for x in (18,36,54):
        z1=13.5 if (elev=="south" and x==36) else 0
        panel(f"FAC-PRIMARY-FIN-{elev.upper()}-{x:02d}",elev,x-.32,x+.32,z1,81,.68,C["FAC-METAL-01"],extra_out=.08)

# Four deliberate full-height corner piers.
for name,x1,y1,x2,y2 in [
    ("SW",-0.42,-0.42,.42,.42),("SE",71.58,-.42,72.42,.42),
    ("NW",-.42,71.58,.42,72.42),("NE",71.58,71.58,72.42,72.42)
]:
    add_box(f"FAC-CORNER-{name}",x1,y1,0,x2,y2,81,C["FAC-METAL-01"],"FAC-CORNER-PIERS-01" if name=="SW" else None)

# Floor 1 entrance portal + canopy.
add_box("FAC-ENTRY-PORTAL-01::west",24,-.55,0,25,.2,11.0,C["FAC-MINERAL-01"],"FAC-ENTRY-PORTAL-01")
add_box("FAC-ENTRY-PORTAL-01::east",47,-.55,0,48,.2,11.0,C["FAC-MINERAL-01"])
add_box("FAC-ENTRY-PORTAL-01::header",24,-.55,10.8,48,.2,13.5,C["FAC-WARM-01"])
add_box("FAC-ENTRY-CANOPY-01",24,-5.5,9.45,48,0,10.15,C["FAC-WARM-01"],"FAC-ENTRY-CANOPY-01")
add_box("FAC-ENTRY-CANOPY-SUPPORT-W",24.4,-5.0,0,25.0,-4.4,9.45,C["FAC-METAL-01"],"FAC-ENTRY-CANOPY-SUPPORT-W")
add_box("FAC-ENTRY-CANOPY-SUPPORT-E",47.0,-5.0,0,47.6,-4.4,9.45,C["FAC-METAL-01"],"FAC-ENTRY-CANOPY-SUPPORT-E")

# Crown cap wraps the occupied tower without pretending Level 7 is enclosed.
for elev in ("south","east","north","west"):
    panel(f"FAC-CROWN-CAP-01::{elev}",elev,0,72,80.55,81.0,.42,C["FAC-METAL-01"],"FAC-CROWN-CAP-01" if elev=="south" else None)

FONT={
 "A":["01110","10001","10001","11111","10001","10001","10001"],
 "E":["11111","10000","10000","11110","10000","10000","11111"],
 "I":["11111","00100","00100","00100","00100","00100","11111"],
 "P":["11110","10001","10001","11110","10000","10000","10000"],
 "Q":["01110","10001","10001","10001","10101","10010","01101"],
 "R":["11110","10001","10001","11110","10100","10010","10001"],
 "S":["01111","10000","10000","01110","00001","00001","11110"],
 "T":["11111","00100","00100","00100","00100","00100","00100"],
 "U":["10001","10001","10001","10001","10001","10001","01110"],
 "Y":["10001","10001","01010","00100","00100","00100","00100"],
 "=":["00000","00000","11111","00000","11111","00000","00000"],
 " ":["00000","00000","00000","00000","00000","00000","00000"],
}

def south_text(prefix,text,center_x,front_y,base_z,cell,color,obj):
    patterns=[FONT[ch] for ch in text]
    total_cells=sum(5 for _ in patterns)+max(0,len(patterns)-1)
    total_w=total_cells*cell
    x0=center_x-total_w/2
    cursor=0
    first=True
    for ci,pattern in enumerate(patterns):
        for r,row in enumerate(pattern):
            for col,val in enumerate(row):
                if val!="1": continue
                xx=x0+(cursor+col)*cell
                zz=base_z+(6-r)*cell
                add_box(f"{prefix}::{ci:02d}-{r:02d}-{col:02d}",xx,front_y-.20,zz,xx+cell*.88,front_y,zz+cell*.88,color,obj if first else None)
                first=False
        cursor+=6
    if first:
        modeled.add(obj)

south_text("FAC-BRAND-ENTRY-01","E=U",36,-.70,11.12,.28,C["FAC-SIGN-01"],"FAC-BRAND-ENTRY-01")
south_text("FAC-WORDMARK-ENTRY-01","EQUITY UPRISE",36,-5.56,9.48,.085,C["FAC-SIGN-01"],"FAC-WORDMARK-ENTRY-01")
south_text("FAC-BRAND-CROWN-01","E=U",36,-.48,78.22,.28,C["FAC-SIGN-01"],"FAC-BRAND-CROWN-01")

required_modules={x["id"] for x in INV_RAW["modules"]}
required_features={x["id"] for x in INV_RAW["features"]}
missing_modules=sorted(required_modules-modeled)
missing_features=sorted(required_features-modeled)
counts=Counter(x["classification"] for x in INV_RAW["modules"])
checks=[]
def ck(name,ok,detail=""): checks.append({"name":name,"passed":bool(ok),"detail":detail})

ck("288 facade modules",len(required_modules)==288,str(len(required_modules)))
ck("all facade modules modeled",not missing_modules,", ".join(missing_modules))
ck("all facade features modeled",not missing_features,", ".join(missing_features))
ck("72 modules per elevation",all(sum(1 for x in INV_RAW["modules"] if x["elevation"]==e)==72 for e in ("south","east","north","west")),str({e:sum(1 for x in INV_RAW["modules"] if x["elevation"]==e) for e in ("south","east","north","west")}))
ck("48 modules per occupied level",all(sum(1 for x in INV_RAW["modules"] if x["level"]==l)==48 for l in range(1,7)))
ck("module width exactly 6ft",all(abs((x["span_ft"][1]-x["span_ft"][0])-6)<1e-9 for x in INV_RAW["modules"]))
ck("two canonical Floor 1 entry modules",sum(1 for x in INV_RAW["modules"] if x["classification"]=="entrance_door")==2,str(counts["entrance_door"]))
ck("no upper-floor exterior doors",not any(x["classification"]=="entrance_door" and x["level"]>1 for x in INV_RAW["modules"]))
ck("Floor 4 acoustic facade exception modeled",counts["acoustic_opaque"]>=6,str(counts["acoustic_opaque"]))
ck("north louver service modules present",sum(1 for x in INV_RAW["modules"] if x["elevation"]=="north" and x["classification"]=="louver_service")==6)
ck("entry portal + canopy modeled",all(x in modeled for x in ("FAC-ENTRY-PORTAL-01","FAC-ENTRY-CANOPY-01","FAC-ENTRY-CANOPY-SUPPORT-W","FAC-ENTRY-CANOPY-SUPPORT-E")))
ck("entry identity modeled",all(x in modeled for x in ("FAC-BRAND-ENTRY-01","FAC-WORDMARK-ENTRY-01")))
ck("crown identity + cap modeled",all(x in modeled for x in ("FAC-BRAND-CROWN-01","FAC-CROWN-CAP-01")))
ck("corner piers modeled","FAC-CORNER-PIERS-01" in modeled)
ck("substantial real geometry",len(scene.geometry)>=1000,str(len(scene.geometry)))

scene.metadata.update({
 "scene_id":"equity-uprise-facade-core-v2",
 "version":"facade-current-pass-v1",
 "inventory_ref":"facade-module-inventory.json",
 "facade_module_ft":6,
 "structural_grid_ft":[0,18,36,54,72],
 "not_for_construction":True
})
data=scene.export(file_type="glb")
OUT.write_bytes(data)
sha=hashlib.sha256(data).hexdigest()
failed=[x for x in checks if not x["passed"]]
report={
 "schema_version":"1.0.0",
 "scene_id":"equity-uprise-facade-core-v2",
 "not_for_construction":True,
 "glb_bytes":len(data),
 "sha256":sha,
 "mesh_count":len(scene.geometry),
 "inventory_modules":len(required_modules),
 "inventory_modules_modeled":len(required_modules)-len(missing_modules),
 "inventory_features":len(required_features),
 "inventory_features_modeled":len(required_features)-len(missing_features),
 "classification_counts":dict(counts),
 "bounds_m":scene.bounds.tolist(),
 "checks_total":len(checks),
 "checks_passed":len(checks)-len(failed),
 "checks_failed":len(failed),
 "passed":not failed,
 "checks":checks
}
REPORT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","inventory_modules","inventory_modules_modeled","inventory_features","inventory_features_modeled","checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed: raise SystemExit(1)
