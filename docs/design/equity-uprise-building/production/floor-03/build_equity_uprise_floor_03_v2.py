#!/usr/bin/env python3
"""Equity Uprise Floor 3 — Fellowship + Network hybrid GLB builder.

Historical Floor 3 composition + Core V2 chassis + reconciled program.
NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import hashlib, json, math
import trimesh

FT=.3048
HERE=Path(__file__).resolve().parent
OUTDIR=HERE.parent/"generated"; OUTDIR.mkdir(exist_ok=True)
OUT=OUTDIR/"equity-uprise-floor-03-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-floor-03-core-v2-report.json"
INV_PATH=HERE/"floor-03-object-inventory.json"
inventory=json.loads(INV_PATH.read_text()); INV={o["id"]:o for o in inventory["objects"]}
scene=trimesh.Scene(); names=[]; modeled=set()

H=11.0
PASS=(54.,34.,62.,44.); FREIGHT=(0.,60.,8.,72.); SB=(8.,54.,18.,72.); SA=(60.,54.,72.,72.); MEP=(50.,66.,60.,72.)
C={"floor":[86,89,91,255],"wall":[43,42,41,255],"part":[59,58,56,255],"core":[48,51,56,255],
"freight":[69,72,76,255],"stair":[103,102,98,255],"stone":[52,53,54,255],"stone_top":[70,71,72,255],
"glass":[196,220,228,92],"glass_priv":[170,188,194,130],"wood":[108,82,60,255],"seat":[71,69,68,255],
"seat_alt":[82,79,77,255],"red":[133,26,29,255],"screen":[24,29,34,255],"light":[231,217,187,255],
"plant":[73,91,72,255],"rug":[58,56,55,255],"white":[220,220,215,255],"safety":[156,40,43,255],
"acoustic":[54,55,56,255],"black":[24,25,26,255]}

def mark(i):
    if i:
        if i not in INV: raise KeyError(i)
        modeled.add(i)

def box(name,b,h,z=0,color=None,inv=None):
    x1,y1,x2,y2=map(float,b)
    m=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT))
    m.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z+h/2)*FT))
    m.visual.face_colors=color or C["part"]
    scene.add_geometry(m,node_name=name,geom_name=name); names.append(name); mark(inv); return m

def cyl(name,xy,r,h,z=0,color=None,inv=None,sections=28):
    m=trimesh.creation.cylinder(radius=r*FT,height=h*FT,sections=sections)
    m.apply_translation((xy[0]*FT,xy[1]*FT,(z+h/2)*FT)); m.visual.face_colors=color or C["part"]
    scene.add_geometry(m,node_name=name,geom_name=name); names.append(name); mark(inv); return m

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

def table(i,b,z=2.38,top=.22):
    x1,y1,x2,y2=b; box(i+"::top",b,top,z,C["wood"],i)
    for n,(x,y) in enumerate([(x1+.5,y1+.5),(x2-.5,y1+.5),(x1+.5,y2-.5),(x2-.5,y2-.5)],1):
        box(f"{i}::leg-{n}",(x-.09,y-.09,x+.09,y+.09),z,0,C["core"],i)

def round_table(i,xy,d,h):
    cyl(i+"::top",xy,d/2,.2,h-.2,C["wood"],i); cyl(i+"::stem",xy,.22,h-.28,.08,C["core"],i,20); cyl(i+"::base",xy,.75,.1,0,C["core"],i,24)

def chair(i,x,y,target=None):
    w=d=1.7; box(i+"::seat",(x-w/2,y-d/2,x+w/2,y+d/2),.35,1.42,C["seat"],i)
    tx,ty=target or (x,y+1); dx=x-tx; dy=y-ty
    if abs(dx)>abs(dy):
        xx=x+(w/2-.11)*(1 if dx>0 else -1); box(i+"::back",(xx-.11,y-d/2,xx+.11,y+d/2),1.8,1.7,C["seat_alt"],i)
    else:
        yy=y+(d/2-.11)*(1 if dy>0 else -1); box(i+"::back",(x-w/2,yy-.11,x+w/2,yy+.11),1.8,1.7,C["seat_alt"],i)
    for n,(lx,ly) in enumerate([(x-.58,y-.58),(x+.58,y-.58),(x-.58,y+.58),(x+.58,y+.58)],1):
        box(f"{i}::leg-{n}",(lx-.07,ly-.07,lx+.07,ly+.07),1.42,0,C["core"],i)

def sofa(i,b):
    x1,y1,x2,y2=b
    box(i+"::plinth",(x1+.15,y1+.15,x2-.15,y2-.15),.28,.22,C["black"],i)
    box(i+"::seat",(x1+.35,y1+.35,x2-.35,y2-.35),.55,1.05,C["seat"],i)
    box(i+"::back",(x1+.22,y2-.42,x2-.22,y2-.18),2.15,1.45,C["seat_alt"],i)
    box(i+"::arm1",(x1+.12,y1+.2,x1+.48,y2-.15),1.5,.72,C["seat"],i)
    box(i+"::arm2",(x2-.48,y1+.2,x2-.12,y2-.15),1.5,.72,C["seat"],i)

def plant(i,xy):
    cyl(i+"::pot",xy,.72,1.2,0,C["stone"],i,24)
    for n,(dx,dy,r,h) in enumerate([(-.25,0,.4,1.65),(.2,.1,.44,1.85),(0,-.23,.36,1.5)],1):
        cyl(f"{i}::leaf-{n}",(xy[0]+dx,xy[1]+dy),r,h,.95,C["plant"],i,18)

def screen(i,b,z=3.2,h=4.7):
    x1,y1,x2,y2=b; box(i+"::bezel",b,h,z,C["core"],i); box(i+"::screen",(x1+.08,y1-.025,x2-.08,y2+.025),h-.3,z+.15,C["screen"],i)

def cabinet(i,b,h,color=None):
    box(i+"::case",b,h,0,color or C["core"],i)
    x1,y1,x2,y2=b; box(i+"::cap",(x1-.03,y1-.03,x2+.03,y2+.03),.1,h,C["stone_top"],i)

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

# Shell
box("floor_slab",(0,0,72,72),.5,-.5,C["floor"])
box("north_wall",(0,71.25,72,72),H,0,C["wall"]); box("west_wall",(0,0,.75,60),H,0,C["wall"]); box("east_wall",(71.25,0,72,72),H,0,C["wall"])

# South glazing
for k in range(8): box(f"F3-SOUTH-GLAZING-01::pane-{k+1}",(k*9,.22,(k+1)*9,.42),H,0,C["glass"],"F3-SOUTH-GLAZING-01")
for x in range(0,73,9): box(f"south_mullion_{x}",(max(0,x-.08),0,min(72,x+.08),.68),H,0,C["core"])

# Opportunity Exchange
table("F3-OPPORTUNITY-TABLE-01",bounds("F3-OPPORTUNITY-TABLE-01"))
box("F3-OPPORTUNITY-POWER-01::module",(35.3,40.72,36.7,41.28),.12,2.58,C["core"],"F3-OPPORTUNITY-POWER-01")
for k in range(1,7):
    i=f"F3-OPPORTUNITY-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(36,41))
box("F3-IDENTITY-WALL-01::wall",(22,52.1,50,52.85),10.55,0,C["stone"],"F3-IDENTITY-WALL-01")
for i in ("F3-DISPLAY-MATCH","F3-DISPLAY-PEOPLE","F3-DISPLAY-APPLICATIONS"): screen(i,bounds(i),3.2,4.8)
box("F3-IDENTITY-SIGN-01::sign",(30,52.0,42,52.16),1.2,8.9,C["stone_top"],"F3-IDENTITY-SIGN-01")

# Lounge
sofa("F3-LOUNGE-SOFA-01",bounds("F3-LOUNGE-SOFA-01"))
for i in ("F3-LOUNGE-CHAIR-01","F3-LOUNGE-CHAIR-02"):
    b=bounds(i); chair(i,(b[0]+b[2])/2,(b[1]+b[3])/2,(9.5,27))
p=INV["F3-LOUNGE-TABLE-01"]["placement"]; round_table("F3-LOUNGE-TABLE-01",(p["center_ft"]["x"],p["center_ft"]["y"]),p["diameter_ft"],p["height_ft"])
box("F3-LOUNGE-RUG-01::rug",bounds("F3-LOUNGE-RUG-01"),.05,.01,C["rug"],"F3-LOUNGE-RUG-01")
plant("F3-LOUNGE-PLANT-01",center("F3-LOUNGE-PLANT-01")); plant("F3-LOUNGE-PLANT-02",center("F3-LOUNGE-PLANT-02"))
screen("F3-PEOPLE-DISPLAY-01",bounds("F3-PEOPLE-DISPLAY-01"),2.5,5.2)

# Interview rooms
for S,x1,x2 in (("A",2,14),("B",16,28)):
    # side/south walls and north glazed frontage with door gap
    box(f"interview_{S}_south",(x1,3.8,x2,4.2),H,0,C["part"])
    box(f"interview_{S}_west",(x1-.2,4,x1+.2,16),H,0,C["part"])
    box(f"interview_{S}_east",(x2-.2,4,x2+.2,16),H,0,C["part"])
    door=INV[f"F3-INTERVIEW-{S}-DOOR-01"]["placement"]["bounds_ft"]
    wh(f"F3-INTERVIEW-{S}-GLAZING-01::north",x1,x2,16,.18,H,[(door["x1"],door["x2"])],C["glass"])
    box(f"F3-INTERVIEW-{S}-GLAZING-01::privacy",(x1,15.82,x2,15.98),2.0,3.2,C["glass_priv"],f"F3-INTERVIEW-{S}-GLAZING-01")
    box(f"F3-INTERVIEW-{S}-DOOR-01::door",bounds(f"F3-INTERVIEW-{S}-DOOR-01"),8.5,0,C["core"],f"F3-INTERVIEW-{S}-DOOR-01")
    tb=bounds(f"F3-INTERVIEW-{S}-TABLE-01"); table(f"F3-INTERVIEW-{S}-TABLE-01",tb,2.3,.2)
    cx=(tb[0]+tb[2])/2; cy=(tb[1]+tb[3])/2
    for k in range(1,5):
        i=f"F3-INTERVIEW-{S}-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(cx,cy))
    screen(f"F3-INTERVIEW-{S}-DISPLAY-01",bounds(f"F3-INTERVIEW-{S}-DISPLAY-01"),4.0,2.6)
    box(f"F3-INTERVIEW-{S}-ACOUSTIC-01::ceiling",(x1+.4,4.4,x2-.4,15.5),.18,10.65,C["acoustic"],f"F3-INTERVIEW-{S}-ACOUSTIC-01")

# Check-in
cabinet("F3-MEMBER-CHECKIN-01",bounds("F3-MEMBER-CHECKIN-01"),4.0,C["core"])
box("F3-MEMBER-CHECKIN-01::screen",(48.88,25,49.05,28),3.0,2.0,C["screen"],"F3-MEMBER-CHECKIN-01")

# Passenger core
x1,y1,x2,y2=PASS
wh("pass_s",x1,x2,y1,.65,H,color=C["core"]); wh("pass_n",x1,x2,y2,.65,H,color=C["core"]); wv("pass_e",x2,y1,y2,.65,H,color=C["core"]); wv("pass_w",x1,y1,y2,.65,H,[(37,41)],C["core"])
box("F3-PASS-ELEV-DOOR-01::a",(53.88,37,54.04,39),8.5,0,C["freight"],"F3-PASS-ELEV-DOOR-01"); box("F3-PASS-ELEV-DOOR-01::b",(53.88,39,54.04,41),8.5,0,C["freight"],"F3-PASS-ELEV-DOOR-01")
panel("F3-PASS-ELEV-CALL-01",(53.68,35.7),.62,.14,1.5,3.6,C["core"]); box("F3-FLOOR-ID-01::sign",(51.7,33.7,53.5,33.85),1.1,6.2,C["stone"],"F3-FLOOR-ID-01")

# Freight/stairs
x1,y1,x2,y2=FREIGHT
wh("freight_n",x1,x2,y2-.325,.65,H,color=C["freight"]); wv("freight_w",x1+.325,y1,y2,.65,H,color=C["freight"]); wv("freight_e",x2,y1,y2,.65,H,color=C["freight"]); wh("freight_s",x1,x2,y1,.65,H,[(1.5,6.5)],C["freight"])
box("F3-FREIGHT-DOOR-01::a",(1.5,59.88,4,60.04),9,0,C["core"],"F3-FREIGHT-DOOR-01"); box("F3-FREIGHT-DOOR-01::b",(4,59.88,6.5,60.04),9,0,C["core"],"F3-FREIGHT-DOOR-01")
panel("F3-FREIGHT-CONTROL-01",(6.9,59.66),.8,.14,1.7,3.4,C["freight"])
wh("stair_b_s",8,18,54,.65,H,[(14,17)],C["core"]); wv("stair_b_w",8,54,72,.65,H,color=C["core"]); wv("stair_b_e",18,54,72,.65,H,color=C["core"]); wh("stair_b_n",8,18,71.675,.65,H,color=C["core"]); stair("stair_b",SB,4.0)
wh("stair_a_s",60,72,54,.65,H,[(61.5,64.5)],C["core"]); wv("stair_a_w",60,54,72,.65,H,color=C["core"]); wv("stair_a_e",71.675,54,72,.65,H,color=C["core"]); wh("stair_a_n",60,72,71.675,.65,H,color=C["core"]); stair("stair_a",SA,5.0)
box("F3-STAIR-B-DOOR-01::door",(14,53.88,17,54.04),8.5,0,C["core"],"F3-STAIR-B-DOOR-01"); box("F3-STAIR-A-DOOR-01::door",(61.5,53.88,64.5,54.04),8.5,0,C["core"],"F3-STAIR-A-DOOR-01")

# Current Core V2 support band
wh("support_south",18,60,60,.5,H,[(20,23),(27.5,30.5),(35.5,38.5),(43.5,46.5),(51,53.5)],C["part"])
for x,y1,y2,n in [(26,60,70,"rr_div1"),(34,60,72,"rr_div2"),(42,60,72,"records_div"),(50,60,72,"it_div"),(54,60,66,"jan_div")]: wv(n,x,y1,y2,.5,H,color=C["part"])
wh("rr_a_n",18,26,70,.5,H,color=C["part"]); wh("rr_b_n",26,34,70,.5,H,color=C["part"]); box("mep",MEP,H,0,C["freight"])
for i in ("F3-RR-A-VANITY-01","F3-RR-B-VANITY-01"): cabinet(i,bounds(i),2.7,C["stone"])
for i in ("F3-RR-A-WC-01","F3-RR-B-WC-01"):
    b=bounds(i); x=(b[0]+b[2])/2; y=(b[1]+b[3])/2; cyl(i+"::bowl",(x,y),.7,1.1,0,C["white"],i,28)
cabinet("F3-RECORDS-STORAGE-01",(34.7,63,40.8,69.5),6.3,C["part"]); cabinet("F3-NETWORK-IT-RACK-01",(43.2,63,48.6,69.5),7,C["black"]); cabinet("F3-JANITOR-STORAGE-01",(50.4,61,53.4,64.6),6,C["part"])

# Ceiling, acoustic and lights
box("F3-ACOUSTIC-CEILING-01::field",(1,17,59,53),.22,10.72,C["acoustic"],"F3-ACOUSTIC-CEILING-01")
for k,x in enumerate((30,34,38,42),1): box(f"F3-EXCHANGE-LIGHT-01::{k}",(x-.8,40.8,x+.8,41.0),.07,10.5,C["light"],"F3-EXCHANGE-LIGHT-01")
for k,(x,y) in enumerate([(8,8),(20,8),(32,8),(44,8),(56,8),(8,20),(20,20),(32,20),(44,20),(56,20),(20,32),(32,32),(44,32),(20,48),(32,48),(44,48)],1):
    box(f"F3-GENERAL-LIGHT-01::{k:02d}",(x-1.1,y-.08,x+1.1,y+.08),.06,10.55,C["light"],"F3-GENERAL-LIGHT-01")
for k,x in enumerate((6.5,10,13.5),1): box(f"F3-LOUNGE-LIGHT-01::{k}",(x-.7,25.2,x+.7,25.35),.06,10.5,C["light"],"F3-LOUNGE-LIGHT-01")

# Life safety
panel("F3-EGRESS-MAP-01",(52,29.4),1.6,.14,1.7,4,C["core"]); panel("F3-FE-WEST-01",(18.6,57),1,.16,1.3,3.3,C["safety"]); panel("F3-FE-EAST-01",(53,57),1,.16,1.3,3.3,C["safety"])
box("F3-EMERGENCY-LIGHT-01::bar",(25,59.75,47,59.9),.08,9.8,C["safety"],"F3-EMERGENCY-LIGHT-01")

scene.metadata.update({"scene_id":"equity-uprise-floor-03","version":"fellowship-network-hybrid-v1","floor_identity":"Fellowship + Network","inventory_ref":"floor-03-object-inventory.json","not_for_construction":True})
data=scene.export(file_type="glb"); OUT.write_bytes(data)
ext=(scene.extents/FT).tolist(); missing=sorted(set(INV)-modeled)
checks=[]
def ck(n,p,a=None,e=None): checks.append({"name":n,"passed":bool(p),"actual":a,"expected":e})
ck("72ft width",abs(ext[0]-72)<.05,ext[0],72); ck("72ft depth",abs(ext[1]-72)<.05,ext[1],72)
ck("63 inventory records",len(INV)==63,len(INV),63); ck("all inventory records modeled",not missing,len(modeled),len(INV))
ck("six opportunity chairs",all(f"F3-OPPORTUNITY-CHAIR-{i:02d}" in modeled for i in range(1,7)))
ck("two interview rooms",all(f"F3-INTERVIEW-{s}-TABLE-01" in modeled for s in ("A","B")))
ck("eight interview chairs",all(f"F3-INTERVIEW-{s}-CHAIR-{i:02d}" in modeled for s in ("A","B") for i in range(1,5)))
ck("identity wall modeled","F3-IDENTITY-WALL-01" in modeled); ck("people lounge modeled","F3-LOUNGE-SOFA-01" in modeled); ck("checkin modeled","F3-MEMBER-CHECKIN-01" in modeled)
ck("passenger interface","F3-PASS-ELEV-DOOR-01" in modeled); ck("freight interface","F3-FREIGHT-DOOR-01" in modeled); ck("both stair doors",all(x in modeled for x in ("F3-STAIR-A-DOOR-01","F3-STAIR-B-DOOR-01")))
failed=[x for x in checks if not x["passed"]]
report={"scene_id":"equity-uprise-floor-03","version":"fellowship-network-hybrid-v1","mesh_count":len(scene.geometry),"glb_bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"extents_ft":ext,"inventory_records":len(INV),"inventory_records_modeled":len(modeled),"inventory_records_missing":missing,"checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
REPORT.write_text(json.dumps(report,indent=2)+"\n"); print(json.dumps({k:report[k] for k in ("version","mesh_count","inventory_records","inventory_records_modeled","checks_passed","checks_total","passed")},indent=2))
if failed: raise SystemExit(1)
