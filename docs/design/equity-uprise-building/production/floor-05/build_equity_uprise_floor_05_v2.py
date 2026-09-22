#!/usr/bin/env python3
"""Equity Uprise Floor 5 — Policy + Proof hybrid GLB builder.

Historical Policy + Proof composition + Core V2 chassis + reconciled research/evidence/publication program.
NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import hashlib, json, math
import trimesh

FT=.3048
HERE=Path(__file__).resolve().parent
OUTDIR=HERE.parent/"generated"; OUTDIR.mkdir(exist_ok=True)
OUT=OUTDIR/"equity-uprise-floor-05-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-floor-05-core-v2-report.json"
INV_PATH=HERE/"floor-05-object-inventory.json"
inventory=json.loads(INV_PATH.read_text()); INV={o["id"]:o for o in inventory["objects"]}
scene=trimesh.Scene(); modeled=set()

H=11.0
PASS=(54.,34.,62.,44.); FREIGHT=(0.,60.,8.,72.); SB=(8.,54.,18.,72.); SA=(60.,54.,72.,72.); MEP=(50.,66.,60.,72.)
C={"floor":[86,89,91,255],"wall":[43,42,41,255],"part":[59,58,56,255],"core":[48,51,56,255],
"freight":[69,72,76,255],"stair":[103,102,98,255],"stone":[52,53,54,255],"stone_top":[70,71,72,255],
"glass":[196,220,228,92],"glass_priv":[170,188,194,132],"wood":[108,82,60,255],"seat":[71,69,68,255],
"seat_alt":[82,79,77,255],"red":[133,26,29,255],"screen":[24,29,34,255],"light":[234,224,204,255],
"plant":[73,91,72,255],"rug":[58,56,55,255],"white":[220,220,215,255],"safety":[156,40,43,255],
"acoustic":[54,55,56,255],"black":[24,25,26,255],"paper":[205,201,188,255],"archive":[64,60,55,255]}

def mark(i):
    if i:
        if i not in INV: raise KeyError(i)
        modeled.add(i)

def box(name,b,h,z=0,color=None,inv=None):
    x1,y1,x2,y2=map(float,b)
    m=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT))
    m.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z+h/2)*FT))
    m.visual.face_colors=color or C["part"]
    scene.add_geometry(m,node_name=name,geom_name=name); mark(inv); return m

def cyl(name,xy,r,h,z=0,color=None,inv=None,sections=28):
    m=trimesh.creation.cylinder(radius=r*FT,height=h*FT,sections=sections)
    m.apply_translation((xy[0]*FT,xy[1]*FT,(z+h/2)*FT)); m.visual.face_colors=color or C["part"]
    scene.add_geometry(m,node_name=name,geom_name=name); mark(inv); return m

def wh(name,x1,x2,y,t,h,gaps=None,color=None,z=0):
    cur=x1
    for i,(a,b) in enumerate(sorted(gaps or [])+[(x2,x2)]):
        if a>cur: box(f"{name}_{i+1}",(cur,y-t/2,a,y+t/2),h,z,color)
        cur=max(cur,b)

def wv(name,x,y1,y2,t,h,gaps=None,color=None,z=0):
    cur=y1
    for i,(a,b) in enumerate(sorted(gaps or [])+[(y2,y2)]):
        if a>cur: box(f"{name}_{i+1}",(x-t/2,cur,x+t/2,a),h,z,color)
        cur=max(cur,b)

def bounds(i):
    p=INV[i]["placement"]; b=p.get("bounds_ft") or p.get("band_ft")
    return (b["x1"],b["y1"],b["x2"],b["y2"])

def center(i):
    p=INV[i]["placement"]["center_ft"]; return (p["x"],p["y"])

def table(i,b,z=2.35,top=.22,color=None):
    x1,y1,x2,y2=b; box(i+"::top",b,top,z,color or C["wood"],i)
    for n,(x,y) in enumerate([(x1+.5,y1+.5),(x2-.5,y1+.5),(x1+.5,y2-.5),(x2-.5,y2-.5)],1):
        box(f"{i}::leg-{n}",(x-.09,y-.09,x+.09,y+.09),z,0,C["core"],i)

def chair(i,x,y,target=None):
    w=d=1.7; box(i+"::seat",(x-w/2,y-d/2,x+w/2,y+d/2),.35,1.42,C["seat"],i)
    tx,ty=target or (x,y+1); dx=x-tx; dy=y-ty
    if abs(dx)>abs(dy):
        xx=x+(w/2-.11)*(1 if dx>0 else -1); box(i+"::back",(xx-.11,y-d/2,xx+.11,y+d/2),1.8,1.7,C["seat_alt"],i)
    else:
        yy=y+(d/2-.11)*(1 if dy>0 else -1); box(i+"::back",(x-w/2,yy-.11,x+w/2,yy+.11),1.8,1.7,C["seat_alt"],i)
    for n,(lx,ly) in enumerate([(x-.58,y-.58),(x+.58,y-.58),(x-.58,y+.58),(x+.58,y+.58)],1):
        box(f"{i}::leg-{n}",(lx-.07,ly-.07,lx+.07,ly+.07),1.42,0,C["core"],i)

def cabinet(i,b,h,color=None):
    box(i+"::case",b,h,0,color or C["archive"],i)
    x1,y1,x2,y2=b; box(i+"::cap",(x1-.03,y1-.03,x2+.03,y2+.03),.1,h,C["stone_top"],i)

def screen(i,b,z=3.2,h=4.7):
    x1,y1,x2,y2=b; box(i+"::bezel",b,h,z,C["core"],i); box(i+"::screen",(x1+.08,y1-.025,x2-.08,y2+.025),h-.3,z+.15,C["screen"],i)

def panel(i,xy,w=1.05,d=.16,h=1.35,z=3.4,color=None):
    x,y=xy; box(i+"::body",(x-w/2,y-d/2,x+w/2,y+d/2),h,z,color or C["white"],i)
    box(i+"::mark",(x-w*.28,y-d/2-.03,x+w*.28,y+d/2+.03),.14,z+h-.24,C["safety"],i)

def stair(name,b,fw):
    x1,y1,x2,y2=b; margin=.75; wx1=x1+margin; wx2=wx1+fw; ex2=x2-margin; ex1=ex2-fw
    sy=58.25; ny=67.416666667; rise=13.5/22; tread=11/12; mid=11*rise
    box(name+"::lower",(wx1,54.75,wx2,58.25),.25,0,C["stair"])
    for k in range(10):
        ya=sy+k*tread; box(name+f"::f1-{k+1:02d}",(wx1,ya,wx2,ya+tread*.92),.18,(k+1)*rise-.18,C["stair"])
    box(name+"::mid",(wx1,ny,ex2,71.25),.25,mid-.25,C["stair"])
    for k in range(10):
        yb=ny-k*tread; box(name+f"::f2-{k+1:02d}",(ex1,yb-tread*.92,ex2,yb),.18,mid+(k+1)*rise-.18,C["stair"])
    box(name+"::upper",(ex1,54.75,ex2,58.25),.25,13.25,C["stair"])

# Shell.
box("floor_slab",(0,0,72,72),.5,-.5,C["floor"])
box("north_wall",(0,71.25,72,72),H,0,C["wall"]); box("west_wall",(0,0,.75,60),H,0,C["wall"]); box("east_wall",(71.25,0,72,72),H,0,C["wall"])

# Sealed south glazing.
for k in range(8): box(f"F5-SOUTH-GLAZING-01::pane-{k+1}",(k*9,.22,(k+1)*9,.42),H,0,C["glass"],"F5-SOUTH-GLAZING-01")
for x in range(0,73,9): box(f"south_mullion_{x}",(max(0,x-.08),0,min(72,x+.08),.68),H,0,C["core"])

# Policy wall and central lab.
box("F5-POLICY-WALL-01::wall",(22,52.1,50,52.85),10.55,0,C["stone"],"F5-POLICY-WALL-01")
for i in ("F5-DISPLAY-RESEARCH","F5-DISPLAY-EVIDENCE","F5-DISPLAY-RECORD"): screen(i,bounds(i),3.2,4.8)
box("F5-IDENTITY-SIGN-01::sign",(30,52.0,42,52.16),1.2,8.9,C["stone_top"],"F5-IDENTITY-SIGN-01")
box("policy_wall_plinth",(22,51.72,50,52.05),.55,0,C["black"])
for n,x0 in enumerate((22.6,25.2,47.3,49.0),1): box(f"policy_wall_acoustic_fin_{n}",(x0,51.86,x0+.16,52.08),7.4,1.0,C["acoustic"])

table("F5-POLICY-TABLE-01",bounds("F5-POLICY-TABLE-01"),2.38,.22)
box("F5-POLICY-POWER-01::module",(35.2,40.72,36.8,41.28),.12,2.58,C["core"],"F5-POLICY-POWER-01")
for k in range(1,9):
    i=f"F5-POLICY-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(36,41))
box("F5-POLICY-ACOUSTIC-01::ceiling",(22,28,50,50),.18,10.65,C["acoustic"],"F5-POLICY-ACOUSTIC-01")
for n,x0 in enumerate((23,30,43,49),1): box(f"F5-POLICY-ACOUSTIC-01::wall-{n}",(x0,50.0,x0+1.1,50.18),4.0,2.0,C["acoustic"],"F5-POLICY-ACOUSTIC-01")

# Evidence + Proof Archive.
box("F5-ARCHIVE-WALL-01::wall",bounds("F5-ARCHIVE-WALL-01"),9.2,0,C["stone"],"F5-ARCHIVE-WALL-01")
for k in range(1,6):
    i=f"F5-ARCHIVE-FRAME-{k:02d}"; b=bounds(i)
    box(i+"::frame",b,2.6,4.0,C["core"],i)
    x1,y1,x2,y2=b
    box(i+"::record",(x1-.018,y1+.10,x2+.018,y2-.10),2.28,4.16,C["paper"],i)
    box(i+"::caption",(x1-.025,y1+.24,x2+.025,y1+.56),.22,3.74,C["red"],i)
screen("F5-ARCHIVE-SEARCH-01",bounds("F5-ARCHIVE-SEARCH-01"),2.7,4.5)
for k in range(1,4):
    i=f"F5-ARCHIVE-CABINET-{k:02d}"; cabinet(i,bounds(i),3.4,C["archive"])
    b=bounds(i)
    for n in range(3): box(f"{i}::drawer-{n+1}",(b[0]+.18,b[1]+.18+n*.95,b[2]-.18,b[1]+.72+n*.95),.18,.55+n*.85,C["stone_top"],i)
table("F5-ARCHIVE-TABLE-01",bounds("F5-ARCHIVE-TABLE-01"),2.3,.2)
for k in range(1,5):
    i=f"F5-ARCHIVE-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(12,32))
box("F5-ARCHIVE-RUG-01::rug",bounds("F5-ARCHIVE-RUG-01"),.05,.01,C["rug"],"F5-ARCHIVE-RUG-01")
for k,y0 in enumerate((20,23.7,27.4,31.1,34.8),1): box(f"F5-ARCHIVE-LIGHT-01::{k}",(2.0,y0-.22,3.2,y0+.22),.08,9.7,C["light"],"F5-ARCHIVE-LIGHT-01")
box("archive_ceiling",(1,17,18,41),.16,10.5,C["acoustic"])

# Review rooms: Source + Publication.
rooms=[
 ("source",2,15,"F5-SOURCE-GLAZING-01","F5-SOURCE-DOOR-01"),
 ("pub",17,32,"F5-PUB-GLAZING-01","F5-PUB-DOOR-01")
]
for name,x1,x2,glassid,doorid in rooms:
    box(name+"_south",(x1,3.8,x2,4.2),H,0,C["part"])
    box(name+"_west",(x1-.2,4,x1+.2,16),H,0,C["part"])
    box(name+"_east",(x2-.2,4,x2+.2,16),H,0,C["part"])
    db=INV[doorid]["placement"]["bounds_ft"]
    wh(glassid+"::north",x1,x2,16,.18,H,[(db["x1"],db["x2"])],C["glass"])
    box(glassid+"::privacy",(x1,15.82,x2,15.98),1.8,3.25,C["glass_priv"],glassid)
    box(doorid+"::door",bounds(doorid),8.5,0,C["core"],doorid)
    box(name+"_door_header",(db["x1"]-.15,15.72,db["x2"]+.15,15.9),.45,8.5,C["core"])

# Source room.
table("F5-SOURCE-TABLE-01",bounds("F5-SOURCE-TABLE-01"),2.3,.2)
for k in range(1,5):
    i=f"F5-SOURCE-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(7.5,10))
screen("F5-SOURCE-DISPLAY-01",bounds("F5-SOURCE-DISPLAY-01"),4.0,2.6)
cabinet("F5-SOURCE-SECURE-SURFACE-01",bounds("F5-SOURCE-SECURE-SURFACE-01"),3.6,C["archive"])
box("F5-SOURCE-ACOUSTIC-01::ceiling",(2.5,4.5,14.5,15.5),.18,10.65,C["acoustic"],"F5-SOURCE-ACOUSTIC-01")
for n,y0 in enumerate((6,10,13.5),1): box(f"F5-SOURCE-ACOUSTIC-01::side-{n}",(2.18,y0,2.34,y0+1.6),4.2,2.0,C["acoustic"],"F5-SOURCE-ACOUSTIC-01")
box("F5-SOURCE-LIGHT-01::bar",(5,10,11,10.2),.07,10.42,C["light"],"F5-SOURCE-LIGHT-01")

# Publication room.
table("F5-PUB-TABLE-01",bounds("F5-PUB-TABLE-01"),2.3,.2)
for k in range(1,7):
    i=f"F5-PUB-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(23.5,10))
screen("F5-PUB-DISPLAY-01",bounds("F5-PUB-DISPLAY-01"),4.0,2.6)
cabinet("F5-PUB-WORKSTATION-01",bounds("F5-PUB-WORKSTATION-01"),4.4,C["core"])
box("F5-PUB-WORKSTATION-01::screen",(19.35,6.2,19.52,8.9),2.2,2.0,C["screen"],"F5-PUB-WORKSTATION-01")
box("F5-PUB-ACOUSTIC-01::ceiling",(17.5,4.5,31.5,15.5),.18,10.65,C["acoustic"],"F5-PUB-ACOUSTIC-01")
for n,y0 in enumerate((6,10,13.5),1): box(f"F5-PUB-ACOUSTIC-01::side-{n}",(31.66,y0,31.82,y0+1.6),4.2,2.0,C["acoustic"],"F5-PUB-ACOUSTIC-01")
box("F5-PUB-LIGHT-01::bar",(20,10,29,10.2),.07,10.42,C["light"],"F5-PUB-LIGHT-01")

# Navigator.
cabinet("F5-NAVIGATOR-01",bounds("F5-NAVIGATOR-01"),4.1,C["core"])
box("F5-NAVIGATOR-01::screen",(48.88,25,49.05,28),3.0,2.0,C["screen"],"F5-NAVIGATOR-01")

# Passenger elevator.
x1,y1,x2,y2=PASS
wh("pass_s",x1,x2,y1,.65,H,color=C["core"]); wh("pass_n",x1,x2,y2,.65,H,color=C["core"]); wv("pass_e",x2,y1,y2,.65,H,color=C["core"]); wv("pass_w",x1,y1,y2,.65,H,[(37,41)],C["core"])
box("F5-PASS-ELEV-DOOR-01::a",(53.88,37,54.04,39),8.5,0,C["freight"],"F5-PASS-ELEV-DOOR-01"); box("F5-PASS-ELEV-DOOR-01::b",(53.88,39,54.04,41),8.5,0,C["freight"],"F5-PASS-ELEV-DOOR-01")
panel("F5-PASS-ELEV-CALL-01",(53.68,35.7),.62,.14,1.5,3.6,C["core"])
box("F5-FLOOR-ID-01::sign",(51.7,33.7,53.5,33.85),1.1,6.2,C["stone"],"F5-FLOOR-ID-01")

# Freight / stairs.
x1,y1,x2,y2=FREIGHT
wh("freight_n",x1,x2,y2-.325,.65,H,color=C["freight"]); wv("freight_w",x1+.325,y1,y2,.65,H,color=C["freight"]); wv("freight_e",x2,y1,y2,.65,H,color=C["freight"]); wh("freight_s",x1,x2,y1,.65,H,[(1.5,6.5)],C["freight"])
box("F5-FREIGHT-DOOR-01::a",(1.5,59.88,4,60.04),9,0,C["core"],"F5-FREIGHT-DOOR-01"); box("F5-FREIGHT-DOOR-01::b",(4,59.88,6.5,60.04),9,0,C["core"],"F5-FREIGHT-DOOR-01")
panel("F5-FREIGHT-CONTROL-01",(6.9,59.66),.8,.14,1.7,3.4,C["freight"])
wh("stair_b_s",8,18,54,.65,H,[(14,17)],C["core"]); wv("stair_b_w",8,54,72,.65,H,color=C["core"]); wv("stair_b_e",18,54,72,.65,H,color=C["core"]); wh("stair_b_n",8,18,71.675,.65,H,color=C["core"]); stair("stair_b",SB,4.0)
wh("stair_a_s",60,72,54,.65,H,[(61.5,64.5)],C["core"]); wv("stair_a_w",60,54,72,.65,H,color=C["core"]); wv("stair_a_e",71.675,54,72,.65,H,color=C["core"]); wh("stair_a_n",60,72,71.675,.65,H,color=C["core"]); stair("stair_a",SA,5.0)
box("F5-STAIR-B-DOOR-01::door",(14,53.88,17,54.04),8.5,0,C["core"],"F5-STAIR-B-DOOR-01"); box("F5-STAIR-A-DOOR-01::door",(61.5,53.88,64.5,54.04),8.5,0,C["core"],"F5-STAIR-A-DOOR-01")

# North support band.
wh("support_south",18,60,60,.5,H,[(20,23),(27.5,30.5),(35.5,38.5),(43.5,46.5),(51,53.5)],C["part"])
for x,y1,y2,n in [(26,60,70,"rr_div1"),(34,60,72,"rr_div2"),(42,60,72,"evidence_div"),(50,60,72,"research_div"),(54,60,66,"jan_div")]: wv(n,x,y1,y2,.5,H,color=C["part"])
wh("rr_a_n",18,26,70,.5,H,color=C["part"]); wh("rr_b_n",26,34,70,.5,H,color=C["part"]); box("mep",MEP,H,0,C["freight"])
for i in ("F5-RR-A-VANITY-01","F5-RR-B-VANITY-01"): cabinet(i,bounds(i),2.7,C["stone"])
for i in ("F5-RR-A-WC-01","F5-RR-B-WC-01"):
    b=bounds(i); x=(b[0]+b[2])/2; y=(b[1]+b[3])/2; cyl(i+"::bowl",(x,y),.7,1.1,0,C["white"],i,28)
for x0,name in ((20.2,"a"),(28.2,"b")):
    box(f"restroom_mirror_{name}",(x0,61.0,x0+2.0,61.10),2.5,4.0,C["glass"])
    cyl(f"restroom_sink_{name}",(x0+1.0,61.65),.48,.24,2.75,C["white"],sections=24)

cabinet("F5-EVIDENCE-STORAGE-01",(34.7,62.3,40.8,69.5),6.5,C["archive"])
for n,z0 in enumerate((1.0,2.0,3.0,4.0,5.0),1): box(f"evidence_storage_drawer_{n}",(35.1,63.0,40.4,64.0),.4,z0,C["stone_top"],"F5-EVIDENCE-STORAGE-01")
cabinet("F5-RESEARCH-SYSTEMS-01",(43.2,62.8,48.6,69.5),7,C["black"])
for n,z0 in enumerate((.8,1.7,2.6,3.5,4.4,5.3),1): box(f"research_system_device_{n}",(43.6,63.15,48.2,63.55),.45,z0,C["core"],"F5-RESEARCH-SYSTEMS-01")
cabinet("F5-JANITOR-STORAGE-01",(50.4,61,53.4,64.6),6,C["part"])

for x1,x2,label in ((20,23,"rr_a"),(27.5,30.5,"rr_b"),(35.5,38.5,"evidence"),(43.5,46.5,"research"),(51,53.5,"janitor")):
    box(f"support_door_{label}",(x1,59.82,x2,60.08),8.3,0,C["core"])
    box(f"support_handle_{label}",(x2-.28,59.70,x2-.12,59.78),.55,3.3,C["stone_top"])

# Floor-wide ceilings / lighting.
box("F5-ACOUSTIC-CEILING-01::field",(1,17,59,53),.22,10.72,C["acoustic"],"F5-ACOUSTIC-CEILING-01")
box("support_ceiling_west",(18,60,50,72),.18,10.74,C["acoustic"])
box("support_ceiling_east",(50,60,72,72),.18,10.74,C["acoustic"])
box("north_corridor_ceiling",(18,54,60,60),.18,10.74,C["acoustic"])
box("elevator_lobby_ceiling",(48,24,64,53),.16,10.48,C["acoustic"])
for k,x in enumerate((29,33,37,41,45),1): box(f"F5-POLICY-LIGHT-01::{k}",(x-.8,40.8,x+.8,41.0),.07,10.48,C["light"],"F5-POLICY-LIGHT-01")
for k,(x,y) in enumerate([(8,8),(20,8),(32,8),(44,8),(56,8),(8,20),(20,20),(32,20),(44,20),(56,20),(20,32),(32,32),(44,32),(20,48),(32,48),(44,48)],1):
    box(f"F5-GENERAL-LIGHT-01::{k:02d}",(x-1.1,y-.08,x+1.1,y+.08),.06,10.55,C["light"],"F5-GENERAL-LIGHT-01")

# Life safety.
panel("F5-EGRESS-MAP-01",(52,29.4),1.6,.14,1.7,4,C["core"]); panel("F5-FE-WEST-01",(18.6,57),1,.16,1.3,3.3,C["safety"]); panel("F5-FE-EAST-01",(53,57),1,.16,1.3,3.3,C["safety"])
box("F5-EMERGENCY-LIGHT-01::bar",(25,59.75,47,59.9),.08,9.8,C["safety"],"F5-EMERGENCY-LIGHT-01")

scene.metadata.update({"scene_id":"equity-uprise-floor-05","version":"policy-proof-hybrid-v1","floor_identity":"Policy + Proof","inventory_ref":"floor-05-object-inventory.json","not_for_construction":True})
data=scene.export(file_type="glb"); OUT.write_bytes(data)
ext=(scene.extents/FT).tolist(); missing=sorted(set(INV)-modeled)
gkeys=list(scene.geometry.keys())
checks=[]
def ck(n,p,a=None,e=None): checks.append({"name":n,"passed":bool(p),"actual":a,"expected":e})
ck("72ft width",abs(ext[0]-72)<.05,ext[0],72); ck("72ft depth",abs(ext[1]-72)<.05,ext[1],72)
ck("inventory summary matches records",inventory["summary"]["object_records"]==len(INV),len(INV),inventory["summary"]["object_records"])
ck("all inventory records modeled",not missing,len(modeled),len(INV))
ck("eight policy chairs",all(f"F5-POLICY-CHAIR-{i:02d}" in modeled for i in range(1,9)))
ck("policy wall modeled","F5-POLICY-WALL-01" in modeled and all(x in modeled for x in ("F5-DISPLAY-RESEARCH","F5-DISPLAY-EVIDENCE","F5-DISPLAY-RECORD")))
ck("five verified archive frames",all(f"F5-ARCHIVE-FRAME-{i:02d}" in modeled for i in range(1,6)))
ck("archive reading area complete","F5-ARCHIVE-TABLE-01" in modeled and all(f"F5-ARCHIVE-CHAIR-{i:02d}" in modeled for i in range(1,5)))
ck("source review room complete",all(x in modeled for x in ("F5-SOURCE-GLAZING-01","F5-SOURCE-DOOR-01","F5-SOURCE-DISPLAY-01","F5-SOURCE-SECURE-SURFACE-01")))
ck("publication review room complete",all(x in modeled for x in ("F5-PUB-GLAZING-01","F5-PUB-DOOR-01","F5-PUB-DISPLAY-01","F5-PUB-WORKSTATION-01")))
ck("navigator modeled","F5-NAVIGATOR-01" in modeled)
ck("passenger and freight interfaces",all(x in modeled for x in ("F5-PASS-ELEV-DOOR-01","F5-FREIGHT-DOOR-01")))
ck("both stair doors",all(x in modeled for x in ("F5-STAIR-A-DOOR-01","F5-STAIR-B-DOOR-01")))
# Visual-completeness gate.
ck("policy wall architectural surround",any("policy_wall_plinth" in x for x in gkeys) and sum("policy_wall_acoustic_fin" in x for x in gkeys)>=4)
ck("archive visibly furnished",sum("F5-ARCHIVE-CABINET" in x for x in gkeys)>=3 and any("archive_ceiling" in x for x in gkeys))
ck("source room acoustic enclosure",sum("F5-SOURCE-ACOUSTIC-01::side" in x for x in gkeys)>=3 and any("source_door_header" in x for x in gkeys))
ck("publication room acoustic enclosure",sum("F5-PUB-ACOUSTIC-01::side" in x for x in gkeys)>=3 and any("pub_door_header" in x for x in gkeys))
ck("support rooms have doors",sum("support_door_" in x for x in gkeys)>=5)
ck("restrooms have mirrors and sinks",sum("restroom_mirror_" in x for x in gkeys)>=2 and sum("restroom_sink_" in x for x in gkeys)>=2)
ck("evidence storage visibly equipped",sum("evidence_storage_drawer_" in x for x in gkeys)>=5)
ck("research systems visibly equipped",sum("research_system_device_" in x for x in gkeys)>=6)
ck("support ceilings modeled",all(any(tag in x for x in gkeys) for tag in ("support_ceiling_west","support_ceiling_east","north_corridor_ceiling","elevator_lobby_ceiling")))
failed=[x for x in checks if not x["passed"]]
report={"scene_id":"equity-uprise-floor-05","version":"policy-proof-hybrid-v1","mesh_count":len(scene.geometry),"glb_bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"extents_ft":ext,"inventory_records":len(INV),"inventory_records_modeled":len(modeled),"inventory_records_missing":missing,"visual_completion_gate":"policy-proof-architectural-room-and-support-detail-v1","checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
REPORT.write_text(json.dumps(report,indent=2)+"\n"); print(json.dumps({k:report[k] for k in ("version","mesh_count","inventory_records","inventory_records_modeled","checks_passed","checks_total","passed")},indent=2))
if failed: raise SystemExit(1)
