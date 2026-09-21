#!/usr/bin/env python3
"""Build the real Floor 2 Public Forum hybrid GLB.

V1 Public Forum composition + Core V2 geometry + reconciled program/inventory.
NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import hashlib, json, math
import trimesh

FT=.3048
HERE=Path(__file__).resolve().parent
OUTDIR=HERE.parent/"generated";OUTDIR.mkdir(exist_ok=True)
OUT=OUTDIR/"equity-uprise-floor-02-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-floor-02-core-v2-report.json"
INV_PATH=HERE/"floor-02-object-inventory.json"
inventory=json.loads(INV_PATH.read_text())
INV={o["id"]:o for o in inventory["objects"]}
scene=trimesh.Scene(); records=[]; modeled=set()

W=D=72.0;H=11.0
PASS=(54.0,34.0,62.0,44.0);FREIGHT=(0.0,60.0,8.0,72.0);SB=(8.0,54.0,18.0,72.0);SA=(60.0,54.0,72.0,72.0);MEP=(50.0,66.0,60.0,72.0)
C={
"floor":[86,89,91,255],"floor_alt":[99,102,104,255],"wall":[43,42,41,255],"part":[59,58,56,255],
"core":[48,51,56,255],"freight":[69,72,76,255],"stair":[103,102,98,255],"stone":[52,53,54,255],
"stone_top":[70,71,72,255],"glass":[196,220,228,92],"wood":[108,82,60,255],"seat":[71,69,68,255],
"seat_alt":[82,79,77,255],"red":[133,26,29,255],"screen":[24,29,34,255],"light":[231,217,187,255],
"plant":[73,91,72,255],"rug":[58,56,55,255],"white":[220,220,215,255],"safety":[156,40,43,255],
"acoustic":[54,55,56,255],"black":[24,25,26,255]
}

def mark(i):
    if i:
        if i not in INV: raise KeyError(i)
        modeled.add(i)

def box(name,b,h,z=0,color=None,inv=None):
    x1,y1,x2,y2=map(float,b)
    m=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT))
    m.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z+h/2)*FT))
    m.visual.face_colors=color or C["part"]
    scene.add_geometry(m,node_name=name,geom_name=name);records.append(name);mark(inv);return m

def cyl(name,xy,r,h,z=0,color=None,inv=None,sections=32):
    m=trimesh.creation.cylinder(radius=r*FT,height=h*FT,sections=sections)
    m.apply_translation((xy[0]*FT,xy[1]*FT,(z+h/2)*FT))
    m.visual.face_colors=color or C["part"]
    scene.add_geometry(m,node_name=name,geom_name=name);records.append(name);mark(inv);return m

def wh(name,x1,x2,y,t,h,gaps=None,color=None,z=0):
    cur=x1
    for i,(a,b) in enumerate(sorted(gaps or [])+[(x2,x2)]):
        if a>cur:box(f"{name}_{i+1}",(cur,y-t/2,a,y+t/2),h,z,color)
        cur=max(cur,b)

def wv(name,x,y1,y2,t,h,gaps=None,color=None,z=0):
    cur=y1
    for i,(a,b) in enumerate(sorted(gaps or [])+[(y2,y2)]):
        if a>cur:box(f"{name}_{i+1}",(x-t/2,cur,x+t/2,a),h,z,color)
        cur=max(cur,b)

def bounds(inv):
    p=INV[inv]["placement"]
    b=p.get("bounds_ft") or p.get("band_ft")
    return (b["x1"],b["y1"],b["x2"],b["y2"])

def center(inv):
    p=INV[inv]["placement"]["center_ft"];return (p["x"],p["y"])

def chair(inv,x,y,angle_to=None):
    w,d=1.75,1.75
    box(inv+"::seat",(x-w/2,y-d/2,x+w/2,y+d/2),.38,1.42,C["seat"],inv)
    # Back placed away from table when center is supplied.
    if angle_to:
        tx,ty=angle_to;dx=x-tx;dy=y-ty
        if abs(dx)>abs(dy):
            xx=x+(w/2-.12)*(1 if dx>0 else -1)
            box(inv+"::back",(xx-.12,y-d/2,xx+.12,y+d/2),1.85,1.72,C["seat_alt"],inv)
        else:
            yy=y+(d/2-.12)*(1 if dy>0 else -1)
            box(inv+"::back",(x-w/2,yy-.12,x+w/2,yy+.12),1.85,1.72,C["seat_alt"],inv)
    for i,(lx,ly) in enumerate([(x-.6,y-.6),(x+.6,y-.6),(x-.6,y+.6),(x+.6,y+.6)],1):
        box(f"{inv}::leg-{i}",(lx-.07,ly-.07,lx+.07,ly+.07),1.42,0,C["core"],inv)

def sofa(inv,b):
    x1,y1,x2,y2=b
    box(inv+"::plinth",(x1+.15,y1+.15,x2-.15,y2-.15),.28,.22,C["black"],inv)
    box(inv+"::seat",(x1+.35,y1+.35,x2-.35,y2-.35),.55,1.05,C["seat"],inv)
    box(inv+"::back",(x1+.22,y2-.42,x2-.22,y2-.18),2.15,1.45,C["seat_alt"],inv)
    box(inv+"::arm-a",(x1+.12,y1+.2,x1+.48,y2-.15),1.5,.72,C["seat"],inv)
    box(inv+"::arm-b",(x2-.48,y1+.2,x2-.12,y2-.15),1.5,.72,C["seat"],inv)

def table_round(inv,xy,diam,h):
    cyl(inv+"::top",xy,diam/2,.22,h-.22,C["wood"],inv)
    cyl(inv+"::stem",xy,.26,h-.3,.1,C["core"],inv,24)
    cyl(inv+"::base",xy,1.0,.12,0,C["core"],inv,32)

def plant(inv,xy):
    cyl(inv+"::pot",xy,.72,1.25,0,C["stone"],inv,24)
    for i,(dx,dy,r,h) in enumerate([(-.25,0,.42,1.7),(.22,.12,.46,1.9),(0,-.25,.38,1.55)],1):
        cyl(f"{inv}::leaf-{i}",(xy[0]+dx,xy[1]+dy),r,h,1.0,C["plant"],inv,18)

def screen(inv,b,z=3.2,h=4.8):
    box(inv+"::bezel",b,h,z,C["core"],inv)
    x1,y1,x2,y2=b
    box(inv+"::surface",(x1+.08,y1-.03,x2-.08,y2+.03),h-.28,z+.14,C["screen"],inv)

def cabinet(inv,b,h=5.5,color=None):
    box(inv+"::body",b,h,0,color or C["core"],inv)
    x1,y1,x2,y2=b
    box(inv+"::cap",(x1-.03,y1-.03,x2+.03,y2+.03),.1,h,C["stone_top"],inv)

def panel(inv,xy,w=1.1,d=.16,h=1.4,z=3.4,color=None):
    x,y=xy
    box(inv+"::body",(x-w/2,y-d/2,x+w/2,y+d/2),h,z,color or C["white"],inv)
    box(inv+"::mark",(x-w*.28,y-d/2-.03,x+w*.28,y+d/2+.03),.15,z+h-.25,C["safety"],inv)

def stair(name,b,fw):
    x1,y1,x2,y2=b;margin=.75
    wx1=x1+margin;wx2=wx1+fw;ex2=x2-margin;ex1=ex2-fw
    sy=58.25;ny=67.416666667;rise=13.5/22;tread=11/12;mid=11*rise
    box(name+"::lower",(wx1,54.75,wx2,58.25),.25,0,C["stair"])
    for i in range(10):
        ya=sy+i*tread;box(name+f"::f1-{i+1:02d}",(wx1,ya,wx2,ya+tread*.92),.18,(i+1)*rise-.18,C["stair"])
    box(name+"::mid",(wx1,ny,ex2,71.25),.25,mid-.25,C["stair"])
    for i in range(10):
        yb=ny-i*tread;box(name+f"::f2-{i+1:02d}",(ex1,yb-tread*.92,ex2,yb),.18,mid+(i+1)*rise-.18,C["stair"])
    box(name+"::upper",(ex1,54.75,ex2,58.25),.25,13.25,C["stair"])

# Shell
box("floor_slab",(0,0,72,72),.5,-.5,C["floor"])
box("north_wall",(0,71.25,72,72),H,0,C["wall"])
box("west_wall",(0,0,.75,60),H,0,C["wall"])
box("east_wall",(71.25,0,72,72),H,0,C["wall"])

# Sealed south glazing: eight bays, no door.
for i in range(8):
    x1=i*9;x2=(i+1)*9
    box(f"F2-SOUTH-GLAZING-01::pane-{i+1}",(x1,.22,x2,.42),H,0,C["glass"],"F2-SOUTH-GLAZING-01")
for x in range(0,73,9):
    box(f"south_mullion_{x}",(max(0,x-.08),0,min(72,x+.08),.68),H,0,C["core"])

# Feature wall / displays / acoustic integration.
box("F2-FEATURE-WALL-01::wall",(24,52.15,48,52.85),10.6,0,C["stone"],"F2-FEATURE-WALL-01")
for inv in ("F2-DISPLAY-CURRENT-ISSUES","F2-DISPLAY-PERSPECTIVES","F2-DISPLAY-OPPORTUNITIES"):
    screen(inv,bounds(inv),3.2,4.8)
box("F2-IDENTITY-SIGN-01::identity",(30,52.02,42,52.16),1.2,8.9,C["stone_top"],"F2-IDENTITY-SIGN-01")
for i,x in enumerate((24.6,35.2,45.8),1):
    box(f"F2-ACOUSTIC-WALL-01::{i}",(x,51.85,x+1.6,52.05),6.4,2.0,C["acoustic"],"F2-ACOUSTIC-WALL-01")

# Forum table / power / chairs.
p=INV["F2-FORUM-TABLE-01"]["placement"];table_round("F2-FORUM-TABLE-01",(p["center_ft"]["x"],p["center_ft"]["y"]),p["diameter_ft"],p["height_ft"])
cyl("F2-FORUM-POWER-01::hub",(36,39),.55,.16,2.56,C["core"],"F2-FORUM-POWER-01",24)
for i in range(1,9):
    inv=f"F2-FORUM-CHAIR-{i:02d}";xy=center(inv);chair(inv,xy[0],xy[1],(36,39))

# Lounge.
sofa("F2-LOUNGE-SOFA-01",bounds("F2-LOUNGE-SOFA-01"))
for inv in ("F2-LOUNGE-CHAIR-01","F2-LOUNGE-CHAIR-02"):
    b=bounds(inv);chair(inv,(b[0]+b[2])/2,(b[1]+b[3])/2,(9.5,23))
p=INV["F2-LOUNGE-TABLE-01"]["placement"];table_round("F2-LOUNGE-TABLE-01",(p["center_ft"]["x"],p["center_ft"]["y"]),p["diameter_ft"],p["height_ft"])
box("F2-LOUNGE-RUG-01::rug",bounds("F2-LOUNGE-RUG-01"),.05,.01,C["rug"],"F2-LOUNGE-RUG-01")
plant("F2-LOUNGE-PLANT-01",center("F2-LOUNGE-PLANT-01"));plant("F2-LOUNGE-PLANT-02",center("F2-LOUNGE-PLANT-02"))
screen("F2-TALK-INTERFACE-01",bounds("F2-TALK-INTERFACE-01"),2.5,5.0)

# Member terminal.
b=bounds("F2-MEMBER-CHECKIN-01");cabinet("F2-MEMBER-CHECKIN-01",b,4.0,C["core"])
box("F2-MEMBER-CHECKIN-01::screen",(48.88,25.0,49.05,28.0),3.0,2.0,C["screen"],"F2-MEMBER-CHECKIN-01")

# Passenger core.
x1,y1,x2,y2=PASS
wh("pass_s",x1,x2,y1,.65,H,color=C["core"]);wh("pass_n",x1,x2,y2,.65,H,color=C["core"]);wv("pass_e",x2,y1,y2,.65,H,color=C["core"]);wv("pass_w",x1,y1,y2,.65,H,[(37,41)],C["core"])
box("F2-PASS-ELEV-DOOR-01::a",(53.88,37,54.04,39),8.5,0,C["freight"],"F2-PASS-ELEV-DOOR-01");box("F2-PASS-ELEV-DOOR-01::b",(53.88,39,54.04,41),8.5,0,C["freight"],"F2-PASS-ELEV-DOOR-01")
panel("F2-PASS-ELEV-CALL-01",(53.68,35.7),.62,.14,1.5,3.6,C["core"])
box("F2-FLOOR-ID-01::sign",(51.7,33.7,53.5,33.85),1.1,6.2,C["stone"],"F2-FLOOR-ID-01")

# Freight + stairs.
x1,y1,x2,y2=FREIGHT
wh("freight_n",x1,x2,y2-.325,.65,H,color=C["freight"]);wv("freight_w",x1+.325,y1,y2,.65,H,color=C["freight"]);wv("freight_e",x2,y1,y2,.65,H,color=C["freight"]);wh("freight_s",x1,x2,y1,.65,H,[(1.5,6.5)],C["freight"])
box("F2-FREIGHT-DOOR-01::a",(1.5,59.88,4.0,60.04),9,0,C["core"],"F2-FREIGHT-DOOR-01");box("F2-FREIGHT-DOOR-01::b",(4.0,59.88,6.5,60.04),9,0,C["core"],"F2-FREIGHT-DOOR-01")
panel("F2-FREIGHT-CONTROL-01",(6.9,59.66),.8,.14,1.7,3.4,C["freight"])
wh("stair_b_s",8,18,54,.65,H,[(14,17)],C["core"]);wv("stair_b_w",8,54,72,.65,H,color=C["core"]);wv("stair_b_e",18,54,72,.65,H,color=C["core"]);wh("stair_b_n",8,18,71.675,.65,H,color=C["core"]);stair("stair_b",SB,4.0)
wh("stair_a_s",60,72,54,.65,H,[(61.5,64.5)],C["core"]);wv("stair_a_w",60,54,72,.65,H,color=C["core"]);wv("stair_a_e",71.675,54,72,.65,H,color=C["core"]);wh("stair_a_n",60,72,71.675,.65,H,color=C["core"]);stair("stair_a",SA,5.0)
box("F2-STAIR-B-DOOR-01::door",(14,53.88,17,54.04),8.5,0,C["core"],"F2-STAIR-B-DOOR-01");box("F2-STAIR-A-DOOR-01::door",(61.5,53.88,64.5,54.04),8.5,0,C["core"],"F2-STAIR-A-DOOR-01")

# Support band.
wh("support_south",18,60,60,.5,H,[(20,23),(27.5,30.5),(35.5,38.5),(43.5,46.5),(51,53.5)],C["part"])
for x,y1,y2,n in [(26,60,70,"rr_div1"),(34,60,72,"rr_div2"),(42,60,72,"storage_div"),(50,60,72,"avit_div"),(54,60,66,"jan_div")]:
    wv(n,x,y1,y2,.5,H,color=C["part"])
wh("rr_a_n",18,26,70,.5,H,color=C["part"]);wh("rr_b_n",26,34,70,.5,H,color=C["part"]);box("mep",MEP,H,0,C["freight"])
for inv in ("F2-RR-A-VANITY-01","F2-RR-B-VANITY-01"):cabinet(inv,bounds(inv),2.7,C["stone"])
for inv in ("F2-RR-A-WC-01","F2-RR-B-WC-01"):
    b=bounds(inv);x=(b[0]+b[2])/2;y=(b[1]+b[3])/2;cyl(inv+"::bowl",(x,y),.7,1.1,0,C["white"],inv,28)
cabinet("F2-STORAGE-SHELVING-01",(34.7,63,40.8,69.5),6.2,C["part"]);cabinet("F2-AVIT-RACK-01",(43.2,63,48.6,69.5),7,C["black"]);cabinet("F2-JANITOR-STORAGE-01",(50.4,61,53.4,64.6),6,C["part"])

# Ceiling/acoustics/lights.
box("F2-ACOUSTIC-CEILING-01::field",(1,1,59,53),.22,10.72,C["acoustic"],"F2-ACOUSTIC-CEILING-01")
# Forum halo-style architectural fixture: restrained, not a hologram.
for i in range(24):
    a=i*math.tau/24;x=36+math.cos(a)*5.5;y=39+math.sin(a)*5.5
    cyl(f"F2-FORUM-LIGHT-01::{i:02d}",(x,y),.10,.08,10.36,C["light"],"F2-FORUM-LIGHT-01",12)
for i,(x,y) in enumerate([(8,8),(20,8),(32,8),(44,8),(56,8),(8,20),(20,20),(32,20),(44,20),(56,20),(20,32),(32,32),(44,32),(20,48),(32,48),(44,48)],1):
    box(f"F2-GENERAL-LIGHT-01::{i:02d}",(x-1.1,y-.08,x+1.1,y+.08),.06,10.55,C["light"],"F2-GENERAL-LIGHT-01")
for i,x in enumerate((6.5,10,13.5),1):box(f"F2-LOUNGE-LIGHT-01::{i}",(x-.7,21.2,x+.7,21.35),.06,10.5,C["light"],"F2-LOUNGE-LIGHT-01")

# Life safety.
panel("F2-EGRESS-MAP-01",(52,29.4),1.6,.14,1.7,4.0,C["core"])
panel("F2-FE-WEST-01",(18.6,57),1,.16,1.3,3.3,C["safety"]);panel("F2-FE-EAST-01",(53,57),1,.16,1.3,3.3,C["safety"])
box("F2-EMERGENCY-LIGHT-01::bar",(25,59.75,47,59.9),.08,9.8,C["safety"],"F2-EMERGENCY-LIGHT-01")

scene.metadata.update({"scene_id":"equity-uprise-floor-02","version":"public-forum-hybrid-v1","floor_identity":"Public Forum","inventory_ref":"floor-02-object-inventory.json","not_for_construction":True})
data=scene.export(file_type="glb");OUT.write_bytes(data)
ext=(scene.extents/FT).tolist();missing=sorted(set(INV)-modeled)
checks=[]
def ck(n,p,a=None,e=None):checks.append({"name":n,"passed":bool(p),"actual":a,"expected":e})
ck("72ft width",abs(ext[0]-72)<.05,ext[0],72);ck("72ft depth",abs(ext[1]-72)<.05,ext[1],72)
ck("48 inventory records",len(INV)==48,len(INV),48);ck("all inventory records modeled",not missing,len(modeled),len(INV))
ck("forum table modeled","F2-FORUM-TABLE-01" in modeled);ck("8 forum chairs modeled",all(f"F2-FORUM-CHAIR-{i:02d}" in modeled for i in range(1,9)))
ck("feature wall modeled","F2-FEATURE-WALL-01" in modeled);ck("listening lounge modeled","F2-LOUNGE-SOFA-01" in modeled)
ck("member checkin modeled","F2-MEMBER-CHECKIN-01" in modeled);ck("passenger elevator modeled","F2-PASS-ELEV-DOOR-01" in modeled)
ck("freight modeled","F2-FREIGHT-DOOR-01" in modeled);ck("Stair A door modeled","F2-STAIR-A-DOOR-01" in modeled);ck("Stair B door modeled","F2-STAIR-B-DOOR-01" in modeled)
failed=[x for x in checks if not x["passed"]]
report={"scene_id":"equity-uprise-floor-02","version":"public-forum-hybrid-v1","mesh_count":len(scene.geometry),"glb_bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"extents_ft":ext,"inventory_records":len(INV),"inventory_records_modeled":len(modeled),"inventory_records_missing":missing,"checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
REPORT.write_text(json.dumps(report,indent=2)+"\n");print(json.dumps({k:report[k] for k in ("version","mesh_count","inventory_records","inventory_records_modeled","checks_passed","checks_total","passed")},indent=2))
if failed:raise SystemExit(1)
