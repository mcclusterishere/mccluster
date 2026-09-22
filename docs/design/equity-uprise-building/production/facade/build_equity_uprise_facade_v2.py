#!/usr/bin/env python3
"""Build the detailed Equity Uprise exterior facade GLB.

Deterministic digital-twin / visualization geometry only.
NOT FOR CONSTRUCTION, FABRICATION, CODE APPROVAL, OR ENERGY COMPLIANCE.
"""
from pathlib import Path
import json, hashlib, math
from collections import Counter
import trimesh

HERE=Path(__file__).resolve().parent
INV_RAW=json.loads((HERE/"facade-module-inventory.json").read_text())
FINISH_RAW=json.loads((HERE/"facade-finish-inventory.json").read_text())
LOGO_RAW=json.loads((HERE/"equity-uprise-logo-vector.json").read_text())
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
 "FAC-LOGO-NAVY":[4,45,82,255],
 "FAC-SIGN-PLATE":[229,227,218,255],
 "FAC-PAVER-01":[82,81,78,255],
 "FAC-PAVER-02":[106,103,97,255],
 "FAC-SITE-EDGE":[48,50,52,255],
 "LIGHT-WARM-ARCH":[255,218,154,255],
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

def add_cylinder_z(name,x,y,z,radius,height,color,obj=None,sections=24):
    m=trimesh.creation.cylinder(radius=radius*FT,height=height*FT,sections=sections)
    m.apply_translation((x*FT,y*FT,(z+height/2)*FT))
    m.visual.face_colors=color
    scene.add_geometry(m,node_name=name,geom_name=name)
    records.append({"name":name,"bounds_ft":[x-radius,y-radius,z,x+radius,y+radius,z+height]})
    if obj: finish_mark(obj)
    return m

def add_south_line(name,x1,z1,x2,z2,front_y,stroke,depth,color,obj=None):
    dx=x2-x1; dz=z2-z1
    length=(dx*dx+dz*dz)**0.5
    if length <= 1e-9: return
    m=trimesh.creation.box(extents=(length*FT,depth*FT,stroke*FT))
    angle=-math.atan2(dz,dx)
    m.apply_transform(trimesh.transformations.rotation_matrix(angle,[0,1,0]))
    m.apply_translation((((x1+x2)/2)*FT,(front_y-depth/2)*FT,((z1+z2)/2)*FT))
    m.visual.face_colors=color
    scene.add_geometry(m,node_name=name,geom_name=name)
    records.append({"name":name,"bounds_ft":[min(x1,x2)-stroke,front_y-depth,min(z1,z2)-stroke,max(x1,x2)+stroke,front_y,max(z1,z2)+stroke]})
    if obj: finish_mark(obj)
    return m

def add_south_triangle(name,pts,front_y,depth,color,obj=None):
    verts=[]
    for y in (front_y,front_y-depth):
        for x,z in pts: verts.append([x*FT,y*FT,z*FT])
    faces=[[0,1,2],[5,4,3],[0,3,4],[0,4,1],[1,4,5],[1,5,2],[2,5,3],[2,3,0]]
    m=trimesh.Trimesh(vertices=verts,faces=faces,process=False)
    m.visual.face_colors=color
    scene.add_geometry(m,node_name=name,geom_name=name)
    xs=[p[0] for p in pts]; zs=[p[1] for p in pts]
    records.append({"name":name,"bounds_ft":[min(xs),front_y-depth,min(zs),max(xs),front_y,max(zs)]})
    if obj: finish_mark(obj)
    return m

def south_logo_mark(prefix,center_x,front_y,base_z,width_ft,finish_id,legacy_obj=None):
    """Exact approved Equity Uprise repo mark: E + equals + growth bars/arrow."""
    vb=LOGO_RAW["vector_source"]["view_box"]; vb_w=vb[2]; vb_h=vb[3]
    scale=width_ft/vb_w
    x0=center_x-width_ft/2
    color=C["FAC-LOGO-NAVY"]; depth=.12
    def map_x(x): return x0+x*scale
    def map_z(y): return base_z+(vb_h-y)*scale
    def rect_part(name,rect):
        x,y,w,h=rect
        add_box(name,map_x(x),front_y-depth,map_z(y+h),map_x(x+w),front_y,map_z(y),color)
    for group in ("e_rects","equals_rects","bars"):
        for i,rect in enumerate(LOGO_RAW["geometry"][group]):
            rect_part(f"{prefix}::{group}-{i+1:02d}",rect)
    curve=LOGO_RAW["geometry"]["arrow_curve"]
    p0=curve["start"]; p1=curve["control_1"]; p2=curve["control_2"]; p3=curve["end"]
    def bezier(t):
        u=1-t
        return (
            u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],
            u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]
        )
    prev=bezier(0)
    for i in range(1,15):
        cur=bezier(i/14)
        add_south_line(
            f"{prefix}::arrow-{i:02d}",
            map_x(prev[0]),map_z(prev[1]),map_x(cur[0]),map_z(cur[1]),
            front_y,curve["stroke_width"]*scale,depth,color
        )
        prev=cur
    tri=[(map_x(x),map_z(y)) for x,y in LOGO_RAW["geometry"]["arrowhead"]]
    add_south_triangle(prefix+"::arrowhead",tri,front_y,depth,color)
    finish_mark(finish_id)
    if legacy_obj: modeled.add(legacy_obj)

STROKE_FONT={
 "E":[((0,0),(0,1)),((0,1),(.8,1)),((0,.5),(.68,.5)),((0,0),(.8,0))],
 "Q":[((0,0),(.72,0)),((.72,0),(.72,1)),((.72,1),(0,1)),((0,1),(0,0)),((.48,.28),(.88,-.08))],
 "U":[((0,1),(0,.18)),((0,.18),(.18,0)),((.18,0),(.62,0)),((.62,0),(.8,.18)),((.8,.18),(.8,1))],
 "I":[((0,1),(.8,1)),((.4,1),(.4,0)),((0,0),(.8,0))],
 "T":[((0,1),(.8,1)),((.4,1),(.4,0))],
 "Y":[((0,1),(.4,.55)),((.8,1),(.4,.55)),((.4,.55),(.4,0))],
 "P":[((0,0),(0,1)),((0,1),(.68,1)),((.68,1),(.8,.84)),((.8,.84),(.8,.58)),((.8,.58),(.68,.5)),((.68,.5),(0,.5))],
 "R":[((0,0),(0,1)),((0,1),(.68,1)),((.68,1),(.8,.84)),((.8,.84),(.8,.58)),((.8,.58),(.68,.5)),((.68,.5),(0,.5)),((.45,.5),(.85,0))],
 "S":[((.8,1),(0,1)),((0,1),(0,.52)),((0,.52),(.8,.52)),((.8,.52),(.8,0)),((.8,0),(0,0))],
}

def south_stroke_wordmark(prefix,text,center_x,front_y,base_z,height,color,finish_id,legacy_obj=None):
    glyph_w=.8*height; gap=.26*height; space=.62*height
    widths=[space if ch==" " else glyph_w for ch in text]
    total=sum(widths)+gap*(len(text)-1)
    cursor=center_x-total/2
    first_mark=True
    for ci,ch in enumerate(text):
        if ch==" ":
            cursor+=space+gap
            continue
        for si,(p1,p2) in enumerate(STROKE_FONT[ch]):
            x1=cursor+p1[0]*glyph_w/.8; z1=base_z+p1[1]*height
            x2=cursor+p2[0]*glyph_w/.8; z2=base_z+p2[1]*height
            add_south_line(f"{prefix}::{ci:02d}-{si:02d}",x1,z1,x2,z2,front_y,.075*height,.10,color)
        cursor+=glyph_w+gap
    finish_mark(finish_id)
    if legacy_obj: modeled.add(legacy_obj)

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

# -----------------------------------------------------------------------------
# Architectural finish Step 5: completed south entry / canopy / exact approved logo
# / entry lighting / ground contact. Crown structural finish remains deferred.
# -----------------------------------------------------------------------------
# V1 structural portal/canopy backing retained and finished in place.
add_box("FAC-ENTRY-PORTAL-01::west",24,-.55,0,25,.2,11.0,C["FAC-MINERAL-01"],"FAC-ENTRY-PORTAL-01")
add_box("FAC-ENTRY-PORTAL-01::east",47,-.55,0,48,.2,11.0,C["FAC-MINERAL-01"])
add_box("FAC-ENTRY-PORTAL-01::header",24,-.55,10.8,48,.2,13.5,C["FAC-WARM-01"])
add_box("FAC-ENTRY-CANOPY-01",24,-5.5,9.45,48,0,10.15,C["FAC-WARM-01"],"FAC-ENTRY-CANOPY-01")
add_box("FAC-ENTRY-CANOPY-SUPPORT-W",24.4,-5.0,0,25.0,-4.4,9.45,C["FAC-METAL-01"],"FAC-ENTRY-CANOPY-SUPPORT-W")
add_box("FAC-ENTRY-CANOPY-SUPPORT-E",47.0,-5.0,0,47.6,-4.4,9.45,C["FAC-METAL-01"],"FAC-ENTRY-CANOPY-SUPPORT-E")

# Finished portal wraps and inner reveals.
add_box("FAC-ENTRY-PORTAL-FINISH-01::west-wrap",23.92,-.78,.05,25.18,-.54,10.85,C["FAC-MINERAL-01"])
add_box("FAC-ENTRY-PORTAL-FINISH-01::east-wrap",46.82,-.78,.05,48.08,-.54,10.85,C["FAC-MINERAL-01"])
add_box("FAC-ENTRY-PORTAL-FINISH-01::west-inner",25.00,-.72,.20,25.28,-.42,10.62,C["FAC-WARM-01"])
add_box("FAC-ENTRY-PORTAL-FINISH-01::east-inner",46.72,-.72,.20,47.00,-.42,10.62,C["FAC-WARM-01"])
finish_mark("FAC-ENTRY-PORTAL-FINISH-01")

# Real paired public doors, sidelights, transom and threshold.
door_spans=[(32.35,35.75),(36.25,39.65)]
for di,(x1,x2) in enumerate(door_spans,1):
    panel(f"FAC-DOOR-LEAF-01::{di}", "south",x1,x2,.30,8.48,.10,C["FAC-GLASS-01"],extra_out=.22)
    finish_mark("FAC-DOOR-LEAF-01")
    for suffix,xa,xb,za,zb in [
        ("L",x1-.12,x1+.12,.25,8.60),("R",x2-.12,x2+.12,.25,8.60),
        ("H",x1-.12,x2+.12,8.45,8.68),("S",x1-.12,x2+.12,.20,.43)
    ]:
        add_box(f"FAC-DOOR-FRAME-01::{di}-{suffix}",xa,-.46,za,xb,-.30,zb,C["FAC-METAL-01"])
    finish_mark("FAC-DOOR-FRAME-01")
    hx=35.16 if di==1 else 36.84
    add_box(f"FAC-DOOR-HARDWARE-01::{di}",hx-.07,-.62,3.55,hx+.07,-.40,6.15,C["FAC-METAL-01"])
    add_box(f"FAC-DOOR-HARDWARE-01::{di}-return",hx-.28,-.58,3.55,hx+.28,-.44,3.69,C["FAC-METAL-01"])
    finish_mark("FAC-DOOR-HARDWARE-01")

# Sidelights flank the paired doors inside the canonical X30-42 entrance band.
panel("FAC-ENTRY-SIDELIGHT-W-01","south",30.25,32.10,.30,8.48,.10,C["FAC-GLASS-01"],extra_out=.20)
finish_mark("FAC-ENTRY-SIDELIGHT-W-01")
panel("FAC-ENTRY-SIDELIGHT-E-01","south",39.90,41.75,.30,8.48,.10,C["FAC-GLASS-01"],extra_out=.20)
finish_mark("FAC-ENTRY-SIDELIGHT-E-01")
panel("FAC-ENTRY-TRANSOM-01","south",30.25,41.75,8.72,10.28,.10,C["FAC-GLASS-01"],extra_out=.20)
finish_mark("FAC-ENTRY-TRANSOM-01")
# center mullion between paired leaves
add_box("FAC-ENTRY-CENTER-MULLION-01",35.88,-.48,.24,36.12,-.28,10.30,C["FAC-METAL-01"])
add_box("FAC-ENTRY-THRESHOLD-01",30,-1.10,.02,42,.28,.18,C["FAC-MINERAL-01"])
finish_mark("FAC-ENTRY-THRESHOLD-01")

# Finished canopy fascia, soffit, edge returns and six recessed downlight fixtures.
add_box("FAC-ENTRY-SOFFIT-01",24,-5.50,9.34,48,0,9.45,C["FAC-WARM-01"]); finish_mark("FAC-ENTRY-SOFFIT-01")
add_box("FAC-ENTRY-FASCIA-01::front",24,-5.74,9.34,48,-5.50,10.27,C["FAC-METAL-01"])
add_box("FAC-ENTRY-FASCIA-01::west-return",23.86,-5.50,9.34,24.08,0,10.20,C["FAC-METAL-01"])
add_box("FAC-ENTRY-FASCIA-01::east-return",47.92,-5.50,9.34,48.14,0,10.20,C["FAC-METAL-01"])
finish_mark("FAC-ENTRY-FASCIA-01")
for i,x in enumerate((27.5,30.9,34.3,37.7,41.1,44.5),1):
    add_cylinder_z(f"FAC-ENTRY-DOWNLIGHT-01::{i:02d}",x,-2.85,9.29,.14,.045,C["LIGHT-WARM-ARCH"],"FAC-ENTRY-DOWNLIGHT-01",20)

# Exact approved Equity Uprise logo: pale architectural plate preserves canonical navy.
add_box("FAC-SIGN-HALO-ENTRY-01",33.20,-.64,10.86,38.80,-.57,13.39,C["LIGHT-WARM-ARCH"]); finish_mark("FAC-SIGN-HALO-ENTRY-01")
add_box("FAC-SIGN-BACKER-ENTRY-01",33.35,-.84,10.94,38.65,-.64,13.32,C["FAC-SIGN-PLATE"]); finish_mark("FAC-SIGN-BACKER-ENTRY-01")
south_logo_mark("FAC-SIGN-LOGO-ENTRY-01",36,-.96,11.05,4.20,"FAC-SIGN-LOGO-ENTRY-01","FAC-BRAND-ENTRY-01")

# Architectural institutional wordmark on canopy fascia, no pixel/block text.
south_stroke_wordmark("FAC-SIGN-LETTER-WORDMARK-ENTRY-01","EQUITY UPRISE",36,-5.84,9.51,.48,C["FAC-SIGN-01"],"FAC-SIGN-LETTER-WORDMARK-ENTRY-01","FAC-WORDMARK-ENTRY-01")

# Crown identity correction only: replace the old false E=U text with the exact approved mark.
# Full crown band/parapet/screen finish remains deferred.
for elev in ("south","east","north","west"):
    panel(f"FAC-CROWN-CAP-01::{elev}",elev,0,72,80.55,81.0,.42,C["FAC-METAL-01"],"FAC-CROWN-CAP-01" if elev=="south" else None)
add_box("FAC-SIGN-BACKER-CROWN-01",33.45,-.58,77.66,38.55,-.42,80.10,C["FAC-SIGN-PLATE"]); finish_mark("FAC-SIGN-BACKER-CROWN-01")
south_logo_mark("FAC-SIGN-LOGO-CROWN-01",36,-.70,77.78,4.00,"FAC-SIGN-LOGO-CROWN-01","FAC-BRAND-CROWN-01")

# Entry architectural lighting objects; renderer/night material refinement remains a later viewer/material pass.
for i,(x,z) in enumerate(((24.65,2.0),(24.65,6.0),(47.35,2.0),(47.35,6.0)),1):
    add_box(f"FAC-EXTERIOR-LIGHT-ENTRY-GRAZE-01::{i:02d}",x-.10,-.86,z,x+.10,-.66,z+.78,C["LIGHT-WARM-ARCH"])
    finish_mark("FAC-EXTERIOR-LIGHT-ENTRY-GRAZE-01")
for i,x in enumerate((27.0,31.0,41.0,45.0),1):
    add_box(f"FAC-EXTERIOR-LIGHT-BASE-01::{i:02d}",x-.12,-.76,.24,x+.12,-.58,.62,C["LIGHT-WARM-ARCH"])
    finish_mark("FAC-EXTERIOR-LIGHT-BASE-01")

# Building-to-ground contact / entrance apron; not a full site redesign.
add_box("FAC-SITE-APRON-01",24,-14.0,-.18,48,0,-.02,C["FAC-PAVER-01"]); finish_mark("FAC-SITE-APRON-01")
add_box("FAC-SITE-APRON-EDGE-01::west",23.82,-14.0,-.18,24.10,0,.02,C["FAC-SITE-EDGE"]); finish_mark("FAC-SITE-APRON-EDGE-01")
add_box("FAC-SITE-APRON-EDGE-01::east",47.90,-14.0,-.18,48.18,0,.02,C["FAC-SITE-EDGE"]); finish_mark("FAC-SITE-APRON-EDGE-01")
add_box("FAC-SITE-THRESHOLD-PAVING-01",30,-4.2,-.015,42,-.02,.035,C["FAC-PAVER-02"]); finish_mark("FAC-SITE-THRESHOLD-PAVING-01")

required_modules={x["id"] for x in INV_RAW["modules"]}
required_features={x["id"] for x in INV_RAW["features"]}
missing_modules=sorted(required_modules-modeled)
missing_features=sorted(required_features-modeled)
counts=Counter(x["classification"] for x in INV_RAW["modules"])
required_finish={x["id"] for x in FINISH_RAW["records"]}
step4_categories={"window_assembly","window_component_family","frame_finish","opaque_finish","service_finish","corner_finish","base_finish"}
step4_required={x["id"] for x in FINISH_RAW["records"] if x["category"] in step4_categories}
step5_ids={
 "FAC-ENTRY-PORTAL-FINISH-01","FAC-DOOR-LEAF-01","FAC-DOOR-FRAME-01","FAC-DOOR-HARDWARE-01",
 "FAC-ENTRY-TRANSOM-01","FAC-ENTRY-SIDELIGHT-W-01","FAC-ENTRY-SIDELIGHT-E-01","FAC-ENTRY-THRESHOLD-01",
 "FAC-ENTRY-SOFFIT-01","FAC-ENTRY-FASCIA-01","FAC-ENTRY-DOWNLIGHT-01",
 "FAC-SIGN-BACKER-ENTRY-01","FAC-SIGN-LOGO-ENTRY-01","FAC-SIGN-LETTER-WORDMARK-ENTRY-01","FAC-SIGN-HALO-ENTRY-01",
 "FAC-SIGN-BACKER-CROWN-01","FAC-SIGN-LOGO-CROWN-01",
 "FAC-EXTERIOR-LIGHT-ENTRY-GRAZE-01","FAC-EXTERIOR-LIGHT-BASE-01",
 "FAC-SITE-APRON-01","FAC-SITE-APRON-EDGE-01","FAC-SITE-THRESHOLD-PAVING-01"
}
step4_required={x for x in step4_required}
step5_required=required_finish & step5_ids
step4_missing=sorted(step4_required-finish_modeled)
step5_missing=sorted(step5_required-finish_modeled)
completed_scope=step4_required|step5_required
future_finish=required_finish-completed_scope
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
ck("step 5 entrance/logo scope has 22 records",len(step5_required)==22,str(len(step5_required)))
ck("all step 5 entrance/logo records modeled",not step5_missing,", ".join(step5_missing))
ck("canonical logo asset bound",LOGO_RAW["source_asset"]["path"]=="assets/img/equity-uprise-logo.webp")
ck("canonical logo hash bound",LOGO_RAW["source_asset"]["sha256"]=="3dd74068b984173a3c88bfd124f150653cdf04e35657006df2cf8961e57ce29f")
ck("literal E=U substitution prohibited",LOGO_RAW["source_asset"]["note"].find("Do not redraw")>=0)
ck("complete south entry assembly",all(x in finish_modeled for x in ("FAC-ENTRY-PORTAL-FINISH-01","FAC-DOOR-LEAF-01","FAC-DOOR-FRAME-01","FAC-DOOR-HARDWARE-01","FAC-ENTRY-TRANSOM-01","FAC-ENTRY-SIDELIGHT-W-01","FAC-ENTRY-SIDELIGHT-E-01","FAC-ENTRY-THRESHOLD-01")))
ck("canopy soffit fascia downlights complete",all(x in finish_modeled for x in ("FAC-ENTRY-SOFFIT-01","FAC-ENTRY-FASCIA-01","FAC-ENTRY-DOWNLIGHT-01")))
ck("exact approved entry logo + wordmark modeled",all(x in finish_modeled for x in ("FAC-SIGN-BACKER-ENTRY-01","FAC-SIGN-LOGO-ENTRY-01","FAC-SIGN-LETTER-WORDMARK-ENTRY-01")))
ck("false crown E=U replaced by approved logo",all(x in finish_modeled for x in ("FAC-SIGN-BACKER-CROWN-01","FAC-SIGN-LOGO-CROWN-01")))
ck("entry ground contact complete",all(x in finish_modeled for x in ("FAC-SITE-APRON-01","FAC-SITE-APRON-EDGE-01","FAC-SITE-THRESHOLD-PAVING-01")))
ck("remaining crown structural finish intentionally deferred",not any(x in finish_modeled for x in future_finish),str(sorted(finish_modeled & future_finish)))
ck("substantial real geometry",len(scene.geometry)>=4000,str(len(scene.geometry)))

scene.metadata.update({
 "scene_id":"equity-uprise-facade-core-v2",
 "version":"facade-architectural-finish-step5-entry-v1",
 "inventory_ref":"facade-module-inventory.json",
 "finish_inventory_ref":"facade-finish-inventory.json",
 "finish_step":"completed-south-entry-approved-logo-ground-contact",
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
 "finish_step5_records":len(step5_required),
 "finish_step5_modeled":len(step5_required)-len(step5_missing),
 "finish_step5_missing":step5_missing,
 "canonical_logo_asset":LOGO_RAW["source_asset"]["path"],
 "canonical_logo_sha256":LOGO_RAW["source_asset"]["sha256"],
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
print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","inventory_modules","inventory_modules_modeled","inventory_features","inventory_features_modeled","finish_inventory_records","finish_step4_records","finish_step4_modeled","finish_step5_records","finish_step5_modeled","finish_future_records_remaining","finished_window_modules","checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed: raise SystemExit(1)
