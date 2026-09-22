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
FINISH_RAW=json.loads((HERE/"facade-finish-inventory.json").read_text())
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
 "FAC-SHADOW-01":[24,27,29,255],
}
scene=trimesh.Scene()
modeled=set()
finish_modeled=set()
finish_counts=Counter()
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

def finish_mark(obj,count=1):
    if obj:
        finish_modeled.add(obj)
        finish_counts[obj]+=count

def finish_return(name,elev,a,b,z1,z2,outer_depth=.46,inner_depth=.06,color=None,obj=None):
    """Normal-depth return/reveal element from outer frame face toward recessed glazing."""
    if b-a <= 1e-6 or z2-z1 <= 1e-6: return
    color=color or C["FAC-METAL-01"]
    e=elev.lower()
    if e=="south":
        add_box(name,a,-outer_depth,z1,b,-inner_depth,z2,color)
    elif e=="north":
        add_box(name,a,72+inner_depth,z1,b,72+outer_depth,z2,color)
    elif e=="west":
        add_box(name,-outer_depth,a,z1,-inner_depth,b,z2,color)
    elif e=="east":
        add_box(name,72+inner_depth,a,z1,72+outer_depth,b,z2,color)
    else:
        raise ValueError(elev)
    finish_mark(obj)

def finish_face(name,elev,a,b,z1,z2,depth=.08,outset=.38,color=None,obj=None):
    """Thin face cap/reveal positioned proud of the control plane."""
    panel(name,elev,a,b,z1,z2,depth,color or C["FAC-METAL-01"],extra_out=outset)
    finish_mark(obj)

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
        panel(obj+"::vision",elev,aa,bb,zvis1,zvis2,.08,glass,extra_out=.02)
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
        panel(obj+"::slit",elev,mid-sw,mid+sw,z0+2.0,z0+11.3,.08,C["FAC-GLASS-02"],extra_out=.02)
        panel(obj+"::head",elev,mid-sw,mid+sw,z0+11.3,ztop,.28,C["FAC-OPAQUE-01"])
    elif cls in ("restroom_clerestory","support_clerestory"):
        panel(obj+"::lower-opaque",elev,aa,bb,zbase,z0+7.4,.28,C["FAC-OPAQUE-01"],obj)
        panel(obj+"::clerestory",elev,aa,bb,z0+7.4,z0+10.25,.08,C["FAC-GLASS-02"],extra_out=.02)
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

# -----------------------------------------------------------------------------
# Architectural finish Step 4: window assemblies + frame hierarchy + opaque/service
# detail + resolved corners + grounded base/plinth. Entry and crown finish remain
# intentionally deferred to later steps.
# -----------------------------------------------------------------------------
WINDOW_CLASSES={"clear_vision","privacy_vision","stair_core_glazing","restroom_clerestory","support_clerestory"}

def window_opening(m):
    a,b=m["span_ft"]; z0=m["z0_ft"]; level=m["level"]; cls=m["classification"]
    _,v1,v2,_=story_bands(level,z0)
    if cls in ("clear_vision","privacy_vision"):
        return a+.18,b-.18,v1+.10,v2-.10
    if cls=="stair_core_glazing":
        mid=(a+b)/2; sw=.8
        return mid-sw,mid+sw,z0+2.0,z0+11.3
    if cls in ("restroom_clerestory","support_clerestory"):
        return a+.18,b-.18,z0+7.4,z0+10.25
    return None

def assembly_finish_id(m):
    cls=m["classification"]; elev=m["elevation"]
    if cls=="clear_vision":
        return {"south":"FAC-WIN-ASSEMBLY-SOUTH-CLEAR-01","east":"FAC-WIN-ASSEMBLY-EAST-CLEAR-01","west":"FAC-WIN-ASSEMBLY-WEST-CLEAR-01"}.get(elev)
    if cls=="privacy_vision" and elev=="south": return "FAC-WIN-ASSEMBLY-SOUTH-PRIVACY-01"
    if cls=="stair_core_glazing": return "FAC-WIN-ASSEMBLY-EAST-STAIR-01" if elev=="east" else "FAC-WIN-ASSEMBLY-NORTH-STAIR-01"
    if cls=="restroom_clerestory": return "FAC-WIN-ASSEMBLY-NORTH-RESTROOM-CLERESTORY-01"
    if cls=="support_clerestory": return "FAC-WIN-ASSEMBLY-NORTH-SUPPORT-CLERESTORY-01"
    return None

def jamb_family_id(m):
    cls=m["classification"]
    if cls=="clear_vision": return "FAC-WIN-JAMB-CLEAR-01"
    if cls=="privacy_vision": return "FAC-WIN-JAMB-PRIVACY-01"
    return "FAC-WIN-JAMB-CORE-01"

finished_window_modules=0
for m in INV_RAW["modules"]:
    if m["classification"] not in WINDOW_CLASSES: continue
    opening=window_opening(m)
    if not opening: continue
    a,b,z1,z2=opening; elev=m["elevation"]; mod=m["id"]
    jw=.16; hh=.16
    finish_return(mod+"::finish-jamb-L",elev,a,a+jw,z1,z2,.48,.055,C["FAC-METAL-01"],jamb_family_id(m))
    finish_return(mod+"::finish-jamb-R",elev,b-jw,b,z1,z2,.48,.055,C["FAC-METAL-01"],jamb_family_id(m))
    finish_return(mod+"::finish-head",elev,a,b,z2-hh,z2,.48,.055,C["FAC-METAL-01"],"FAC-WIN-HEAD-01")
    finish_return(mod+"::finish-sill",elev,a,b,z1,z1+hh,.48,.055,C["FAC-METAL-01"],"FAC-WIN-SILL-01")
    finish_face(mod+"::finish-reveal-L",elev,a,a+.07,z1,z2,.055,.055,C["FAC-SHADOW-01"],"FAC-WIN-REVEAL-01")
    finish_face(mod+"::finish-reveal-R",elev,b-.07,b,z1,z2,.055,.055,C["FAC-SHADOW-01"],"FAC-WIN-REVEAL-01")
    finish_face(mod+"::finish-gasket-head",elev,a,b,z2-.055,z2,.035,.025,C["FAC-SHADOW-01"],"FAC-WIN-GASKET-01")
    finish_face(mod+"::finish-gasket-sill",elev,a,b,z1,z1+.055,.035,.025,C["FAC-SHADOW-01"],"FAC-WIN-GASKET-01")
    finish_mark(assembly_finish_id(m))
    finished_window_modules+=1

for m in INV_RAW["modules"]:
    a=m["span_ft"][0]; z0=m["z0_ft"]; elev=m["elevation"]
    aa=max(0,a-.075); bb=min(72,a+.075)
    if bb>aa:
        finish_face(m["id"]+"::secondary-mullion-finish",elev,aa,bb,z0,z0+13.5,.055,.39,C["FAC-METAL-01"],"FAC-MULLION-SECONDARY-FINISH-01")

for elev in ("south","east","north","west"):
    for grid in (0,18,36,54,72):
        a=max(0,grid-.16); b=min(72,grid+.16)
        if b<=a: continue
        z1=13.5 if (elev=="south" and grid==36) else 0
        finish_face(f"FAC-PRIMARY-FIN-FINISH-01::{elev}-{grid:02d}",elev,a,b,z1,81,.10,.70,C["FAC-METAL-01"],"FAC-PRIMARY-FIN-FINISH-01")

for level in range(1,7):
    z0=(level-1)*13.5; _,_,v2,_=story_bands(level,z0)
    for elev in ("south","east","north","west"):
        finish_face(f"FAC-SPANDREL-REVEAL-FINISH-01::{elev}-F{level}",elev,0,72,v2-.055,v2+.055,.06,.30,C["FAC-SHADOW-01"],"FAC-SPANDREL-REVEAL-FINISH-01")

opaque_finish_map={
    ("south",4,"acoustic_opaque"):"FAC-ACOUSTIC-OPAQUE-SOUTH-F4-01",
    ("west",4,"acoustic_opaque"):"FAC-ACOUSTIC-OPAQUE-WEST-F4-01",
    ("north",None,"service_opaque"):"FAC-SERVICE-OPAQUE-NORTH-01",
    ("west",None,"service_opaque"):"FAC-SERVICE-OPAQUE-WEST-01",
}
for m in INV_RAW["modules"]:
    cls=m["classification"]; elev=m["elevation"]; level=m["level"]
    fid=opaque_finish_map.get((elev,level,cls)) or opaque_finish_map.get((elev,None,cls))
    if not fid: continue
    a,b=m["span_ft"]; z0=m["z0_ft"]; _,_,_,ztop=story_bands(level,z0)
    finish_face(m["id"]+"::opaque-finish-face",elev,a+.16,b-.16,z0+.22,ztop-.22,.10,.31,C["FAC-OPAQUE-01"],fid)
    mid=(a+b)/2
    finish_face(m["id"]+"::opaque-finish-joint",elev,mid-.055,mid+.055,z0+.45,ztop-.45,.055,.43,C["FAC-SHADOW-01"])

for m in INV_RAW["modules"]:
    if m["classification"]!="louver_service": continue
    elev=m["elevation"]; a,b=m["span_ft"]; z0=m["z0_ft"]
    finish_return(m["id"]+"::louver-frame-L",elev,a+.18,a+.34,z0+2.65,z0+10.0,.55,.08,C["FAC-METAL-01"],"FAC-SERVICE-LOUVER-FINISH-01")
    finish_return(m["id"]+"::louver-frame-R",elev,b-.34,b-.18,z0+2.65,z0+10.0,.55,.08,C["FAC-METAL-01"],"FAC-SERVICE-LOUVER-FINISH-01")
    for k in range(8):
        zz=z0+3.0+k*.82
        finish_face(m["id"]+f"::finish-louver-{k+1:02d}",elev,a+.42,b-.42,zz,zz+.18,.10,.52,C["FAC-LOUVER-01"])

corner_finish_specs=[
    ("SW","FAC-CORNER-FINISH-SW-01",-.28,-.28,.28,.28,C["FAC-METAL-01"]),
    ("SE","FAC-CORNER-FINISH-SE-01",71.72,-.28,72.28,.28,C["FAC-METAL-01"]),
    ("NW","FAC-CORNER-FINISH-NW-01",-.46,71.54,.46,72.46,C["FAC-OPAQUE-01"]),
    ("NE","FAC-CORNER-FINISH-NE-01",71.54,71.54,72.46,72.46,C["FAC-OPAQUE-01"]),
]
for name,fid,x1,y1,x2,y2,color in corner_finish_specs:
    add_box(f"{fid}::pier",x1,y1,.08,x2,y2,80.92,color)
    finish_mark(fid)
    for level in range(1,7):
        z=(level-1)*13.5+13.22
        add_box(f"{fid}::collar-F{level}",x1-.06,y1-.06,z,x2+.06,y2+.06,z+.16,C["FAC-METAL-01"])

panel("FAC-BASE-PLINTH-SOUTH-01::west","south",0,30,.05,1.12,.52,C["FAC-MINERAL-01"])
panel("FAC-BASE-PLINTH-SOUTH-01::east","south",42,72,.05,1.12,.52,C["FAC-MINERAL-01"])
finish_mark("FAC-BASE-PLINTH-SOUTH-01")
panel("FAC-BASE-PLINTH-EAST-01","east",0,72,.05,1.12,.52,C["FAC-MINERAL-01"]); finish_mark("FAC-BASE-PLINTH-EAST-01")
panel("FAC-BASE-PLINTH-NORTH-01","north",0,72,.05,1.12,.52,C["FAC-MINERAL-01"]); finish_mark("FAC-BASE-PLINTH-NORTH-01")
panel("FAC-BASE-PLINTH-WEST-01","west",0,72,.05,1.12,.52,C["FAC-MINERAL-01"]); finish_mark("FAC-BASE-PLINTH-WEST-01")
for elev in ("south","east","north","west"):
    finish_face(f"FAC-BASE-REVEAL-01::{elev}",elev,0,72,1.12,1.24,.055,.48,C["FAC-SHADOW-01"],"FAC-BASE-REVEAL-01")

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

# V1 corner backing retained for compatibility; Step-4 finish assemblies above control the visible corner expression.
for name,x1,y1,x2,y2 in [
    ("SW",-0.20,-0.20,.20,.20),("SE",71.80,-.20,72.20,.20),
    ("NW",-.26,71.74,.26,72.26),("NE",71.74,71.74,72.26,72.26)
]:
    add_box(f"FAC-CORNER-{name}::backing",x1,y1,.05,x2,y2,80.95,C["FAC-METAL-01"],"FAC-CORNER-PIERS-01" if name=="SW" else None)

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
required_finish={x["id"] for x in FINISH_RAW["records"]}
step4_categories={"window_assembly","window_component_family","frame_finish","opaque_finish","service_finish","corner_finish","base_finish"}
step4_required={x["id"] for x in FINISH_RAW["records"] if x["category"] in step4_categories}
step4_missing=sorted(step4_required-finish_modeled)
future_finish=required_finish-step4_required
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
ck("finish inventory has 68 records",len(required_finish)==68,str(len(required_finish)))
ck("step 4 finish scope has 32 records",len(step4_required)==32,str(len(step4_required)))
ck("all step 4 finish records modeled",not step4_missing,", ".join(step4_missing))
ck("238 window-like modules detailed",finished_window_modules==238,str(finished_window_modules))
ck("all four finish corners resolved",all(x in finish_modeled for x in ("FAC-CORNER-FINISH-SW-01","FAC-CORNER-FINISH-SE-01","FAC-CORNER-FINISH-NW-01","FAC-CORNER-FINISH-NE-01")))
ck("all four base plinths + reveal modeled",all(x in finish_modeled for x in ("FAC-BASE-PLINTH-SOUTH-01","FAC-BASE-PLINTH-EAST-01","FAC-BASE-PLINTH-NORTH-01","FAC-BASE-PLINTH-WEST-01","FAC-BASE-REVEAL-01")))
ck("entry/crown finish intentionally deferred",not any(x in finish_modeled for x in future_finish),str(sorted(finish_modeled & future_finish)))
ck("substantial real geometry",len(scene.geometry)>=3000,str(len(scene.geometry)))

scene.metadata.update({
 "scene_id":"equity-uprise-facade-core-v2",
 "version":"facade-architectural-finish-step4-v1",
 "inventory_ref":"facade-module-inventory.json",
 "finish_inventory_ref":"facade-finish-inventory.json",
 "finish_step":"window-assembly-base-corners",
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
 "finish_inventory_records":len(required_finish),
 "finish_step4_records":len(step4_required),
 "finish_step4_modeled":len(step4_required)-len(step4_missing),
 "finish_step4_missing":step4_missing,
 "finish_records_modeled_total":len(finish_modeled),
 "finish_future_records_remaining":len(required_finish-finish_modeled),
 "finished_window_modules":finished_window_modules,
 "finish_geometry_counts":dict(finish_counts),
 "classification_counts":dict(counts),
 "bounds_m":scene.bounds.tolist(),
 "checks_total":len(checks),
 "checks_passed":len(checks)-len(failed),
 "checks_failed":len(failed),
 "passed":not failed,
 "checks":checks
}
REPORT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","inventory_modules","inventory_modules_modeled","inventory_features","inventory_features_modeled","finish_inventory_records","finish_step4_records","finish_step4_modeled","finish_future_records_remaining","finished_window_modules","checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed: raise SystemExit(1)
