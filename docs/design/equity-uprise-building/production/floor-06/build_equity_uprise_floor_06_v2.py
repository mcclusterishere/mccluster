#!/usr/bin/env python3
"""Equity Uprise Floor 6 — Penthouse Command hybrid GLB builder.

Historical Penthouse Command composition + Core V2 chassis + reconciled institutional/roof-transition program.
NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import hashlib, json, math
import numpy as np
import trimesh

FT=.3048
HERE=Path(__file__).resolve().parent
OUTDIR=HERE.parent/"generated"; OUTDIR.mkdir(exist_ok=True)
OUT=OUTDIR/"equity-uprise-floor-06-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-floor-06-core-v2-report.json"
INV_PATH=HERE/"floor-06-object-inventory.json"
inventory=json.loads(INV_PATH.read_text()); INV={o["id"]:o for o in inventory["objects"]}
scene=trimesh.Scene(); modeled=set()

H=11.0
PASS=(54.,34.,62.,44.); FREIGHT=(0.,60.,8.,72.); SB=(8.,54.,18.,72.); SA=(60.,54.,72.,72.); MEP=(50.,66.,60.,72.)
C={"floor":[78,81,84,255],"wall":[40,40,39,255],"part":[56,55,54,255],"core":[45,48,52,255],
"freight":[67,70,74,255],"stair":[103,102,98,255],"stone":[49,50,51,255],"stone_top":[74,74,74,255],
"glass":[196,220,228,92],"glass_priv":[155,174,182,135],"wood":[116,86,62,255],"seat":[68,67,66,255],
"seat_alt":[81,78,76,255],"red":[132,28,30,255],"screen":[22,28,34,255],"light":[238,228,206,255],
"plant":[73,91,72,255],"rug":[53,52,51,255],"white":[222,222,216,255],"safety":[158,41,44,255],
"acoustic":[50,51,52,255],"black":[22,23,24,255],"halo":[118,153,171,180],"halo_ring":[170,194,206,225]}

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
    m.apply_translation((xy[0]*FT,xy[1]*FT,(z+h/2)*FT))
    m.visual.face_colors=color or C["part"]
    scene.add_geometry(m,node_name=name,geom_name=name); mark(inv); return m

def sphere(name,xyz,r,color=None,inv=None,subdiv=3):
    m=trimesh.creation.icosphere(subdivisions=subdiv,radius=r*FT)
    m.apply_translation((xyz[0]*FT,xyz[1]*FT,xyz[2]*FT))
    m.visual.face_colors=color or C["halo"]
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
    for n,(x,y) in enumerate([(x1+.55,y1+.55),(x2-.55,y1+.55),(x1+.55,y2-.55),(x2-.55,y2-.55)],1):
        box(f"{i}::leg-{n}",(x-.09,y-.09,x+.09,y+.09),z,0,C["core"],i)

def round_table(i,xy,d,h):
    cyl(i+"::top",xy,d/2,.2,h-.2,C["wood"],i); cyl(i+"::stem",xy,.22,h-.28,.08,C["core"],i,20); cyl(i+"::base",xy,.78,.1,0,C["core"],i,24)

def chair(i,x,y,target=None):
    w=d=1.72
    box(i+"::seat",(x-w/2,y-d/2,x+w/2,y+d/2),.35,1.42,C["seat"],i)
    tx,ty=target or (x,y+1); dx=x-tx; dy=y-ty
    if abs(dx)>abs(dy):
        xx=x+(w/2-.11)*(1 if dx>0 else -1); box(i+"::back",(xx-.11,y-d/2,xx+.11,y+d/2),1.9,1.7,C["seat_alt"],i)
    else:
        yy=y+(d/2-.11)*(1 if dy>0 else -1); box(i+"::back",(x-w/2,yy-.11,x+w/2,yy+.11),1.9,1.7,C["seat_alt"],i)
    for n,(lx,ly) in enumerate([(x-.58,y-.58),(x+.58,y-.58),(x-.58,y+.58),(x+.58,y+.58)],1):
        box(f"{i}::leg-{n}",(lx-.07,ly-.07,lx+.07,ly+.07),1.42,0,C["core"],i)

def sofa(i,b):
    x1,y1,x2,y2=b
    box(i+"::plinth",(x1+.15,y1+.15,x2-.15,y2-.15),.28,.22,C["black"],i)
    box(i+"::seat",(x1+.35,y1+.35,x2-.35,y2-.35),.55,1.05,C["seat"],i)
    box(i+"::back",(x1+.22,y2-.42,x2-.22,y2-.18),2.18,1.45,C["seat_alt"],i)
    box(i+"::arm1",(x1+.12,y1+.2,x1+.48,y2-.15),1.52,.72,C["seat"],i)
    box(i+"::arm2",(x2-.48,y1+.2,x2-.12,y2-.15),1.52,.72,C["seat"],i)

def plant(i,xy):
    cyl(i+"::pot",xy,.72,1.2,0,C["stone"],i,24)
    for n,(dx,dy,r,h) in enumerate([(-.25,0,.4,1.65),(.2,.1,.44,1.85),(0,-.23,.36,1.5)],1):
        cyl(f"{i}::leaf-{n}",(xy[0]+dx,xy[1]+dy),r,h,.95,C["plant"],i,18)

def cabinet(i,b,h,color=None):
    box(i+"::case",b,h,0,color or C["core"],i)
    x1,y1,x2,y2=b; box(i+"::cap",(x1-.03,y1-.03,x2+.03,y2+.03),.1,h,C["stone_top"],i)

def screen(i,b,z=3.2,h=4.7):
    x1,y1,x2,y2=b
    box(i+"::bezel",b,h,z,C["core"],i)
    box(i+"::screen",(x1+.08,y1-.025,x2-.08,y2+.025),h-.3,z+.15,C["screen"],i)

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
box("north_wall",(0,71.25,72,72),H,0,C["wall"])
box("west_wall",(0,0,.75,60),H,0,C["wall"])
box("east_wall",(71.25,0,72,72),H,0,C["wall"])

# South glazing
for k in range(8): box(f"F6-SOUTH-GLAZING-01::pane-{k+1}",(k*9,.22,(k+1)*9,.42),H,0,C["glass"],"F6-SOUTH-GLAZING-01")
for x in range(0,73,9): box(f"south_mullion_{x}",(max(0,x-.08),0,min(72,x+.08),.68),H,0,C["core"])

# Command wall / table
box("F6-COMMAND-WALL-01::wall",(22,52.1,50,52.85),10.55,0,C["stone"],"F6-COMMAND-WALL-01")
for i in ("F6-DISPLAY-NOW","F6-DISPLAY-PAST","F6-DISPLAY-JOIN"): screen(i,bounds(i),3.2,4.8)
box("F6-IDENTITY-SIGN-01::sign",(29.5,52.0,42.5,52.16),1.2,8.9,C["stone_top"],"F6-IDENTITY-SIGN-01")
box("command_wall_plinth",(22,51.72,50,52.05),.55,0,C["black"])
for n,x0 in enumerate((22.6,25.1,47.3,49.0),1): box(f"command_wall_acoustic_fin_{n}",(x0,51.86,x0+.16,52.08),7.5,1.0,C["acoustic"])

table("F6-COMMAND-TABLE-01",bounds("F6-COMMAND-TABLE-01"),2.38,.22)
box("F6-COMMAND-POWER-01::module",(35.25,40.72,36.75,41.28),.12,2.58,C["core"],"F6-COMMAND-POWER-01")
for k in range(1,7):
    i=f"F6-COMMAND-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(36,41))
box("F6-COMMAND-ACOUSTIC-01::ceiling",(21.5,27.5,50.5,50.5),.18,10.65,C["acoustic"],"F6-COMMAND-ACOUSTIC-01")
for n,x0 in enumerate((22.5,29.0,43.0,49.0),1): box(f"F6-COMMAND-ACOUSTIC-01::wall-{n}",(x0,50.0,x0+1.2,50.18),4.1,2.0,C["acoustic"],"F6-COMMAND-ACOUSTIC-01")

# Halo globe
hp=INV["F6-HALO-GLOBE-01"]["placement"]["center_ft"]; hr=INV["F6-HALO-GLOBE-01"]["placement"]["radius_ft"]
sphere("F6-HALO-GLOBE-01::sphere",(hp["x"],hp["y"],hp["z"]),hr,C["halo"],"F6-HALO-GLOBE-01",3)
# Equatorial ring as segmented boxes
for k in range(36):
    a=2*math.pi*k/36
    x=hp["x"]+math.cos(a)*(hr+0.18); y=hp["y"]+math.sin(a)*(hr+0.18)
    box(f"F6-HALO-GLOBE-01::ring-{k:02d}",(x-.12,y-.12,x+.12,y+.12),.08,hp["z"]-.04,C["halo_ring"],"F6-HALO-GLOBE-01")
# tiny cardinal beacons
for k,(dx,dy) in enumerate(((hr,0),(-hr,0),(0,hr),(0,-hr)),1):
    sphere(f"F6-HALO-GLOBE-01::beacon-{k}",(hp["x"]+dx,hp["y"]+dy,hp["z"]),.12,C["red"],"F6-HALO-GLOBE-01",2)
cyl("F6-HALO-CEILING-FEED-01::suspension",(hp["x"],hp["y"]),.08,10.9-hp["z"],hp["z"],C["core"],"F6-HALO-CEILING-FEED-01",16)
box("F6-HALO-CEILING-FEED-01::ceiling-node",(hp["x"]-.35,hp["y"]-.35,hp["x"]+.35,hp["y"]+.35),.18,10.72,C["core"],"F6-HALO-CEILING-FEED-01")

# Salon
sofa("F6-SALON-SOFA-01",bounds("F6-SALON-SOFA-01"))
for i in ("F6-SALON-CHAIR-01","F6-SALON-CHAIR-02"):
    b=bounds(i); chair(i,(b[0]+b[2])/2,(b[1]+b[3])/2,(9.5,29))
p=INV["F6-SALON-TABLE-01"]["placement"]; round_table("F6-SALON-TABLE-01",(p["center_ft"]["x"],p["center_ft"]["y"]),p["diameter_ft"],p["height_ft"])
box("F6-SALON-RUG-01::rug",bounds("F6-SALON-RUG-01"),.05,.01,C["rug"],"F6-SALON-RUG-01")
plant("F6-SALON-PLANT-01",center("F6-SALON-PLANT-01")); plant("F6-SALON-PLANT-02",center("F6-SALON-PLANT-02"))
screen("F6-SALON-INFO-01",bounds("F6-SALON-INFO-01"),2.6,4.8)
box("salon_ceiling",(1,17,18,39),.16,10.52,C["acoustic"])

# Strategy and briefing rooms
rooms=[("strategy",2,15,"F6-STRATEGY-GLAZING-01","F6-STRATEGY-DOOR-01"),("briefing",17,32,"F6-BRIEFING-GLAZING-01","F6-BRIEFING-DOOR-01")]
for name,x1,x2,glassid,doorid in rooms:
    box(name+"_south",(x1,3.8,x2,4.2),H,0,C["part"])
    box(name+"_west",(x1-.2,4,x1+.2,16),H,0,C["part"])
    box(name+"_east",(x2-.2,4,x2+.2,16),H,0,C["part"])
    db=INV[doorid]["placement"]["bounds_ft"]
    wh(glassid+"::north",x1,x2,16,.18,H,[(db["x1"],db["x2"])],C["glass"])
    box(glassid+"::privacy",(x1,15.82,x2,15.98),1.8,3.25,C["glass_priv"],glassid)
    box(doorid+"::door",bounds(doorid),8.5,0,C["core"],doorid)
    box(name+"_door_header",(db["x1"]-.15,15.72,db["x2"]+.15,15.9),.45,8.5,C["core"])

table("F6-STRATEGY-TABLE-01",bounds("F6-STRATEGY-TABLE-01"),2.3,.2)
for k in range(1,5):
    i=f"F6-STRATEGY-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(7.5,10))
screen("F6-STRATEGY-DISPLAY-01",bounds("F6-STRATEGY-DISPLAY-01"),4.0,2.6)
cabinet("F6-STRATEGY-SECURE-STORAGE-01",bounds("F6-STRATEGY-SECURE-STORAGE-01"),3.8,C["black"])
box("F6-STRATEGY-ACOUSTIC-01::ceiling",(2.5,4.5,14.5,15.5),.18,10.65,C["acoustic"],"F6-STRATEGY-ACOUSTIC-01")
for n,y0 in enumerate((6,10,13.5),1): box(f"F6-STRATEGY-ACOUSTIC-01::side-{n}",(2.18,y0,2.34,y0+1.6),4.2,2,C["acoustic"],"F6-STRATEGY-ACOUSTIC-01")
box("F6-STRATEGY-LIGHT-01::bar",(5,10,11,10.2),.07,10.42,C["light"],"F6-STRATEGY-LIGHT-01")

table("F6-BRIEFING-TABLE-01",bounds("F6-BRIEFING-TABLE-01"),2.3,.2)
for k in range(1,7):
    i=f"F6-BRIEFING-CHAIR-{k:02d}"; x,y=center(i); chair(i,x,y,(23.5,10))
screen("F6-BRIEFING-DISPLAY-01",bounds("F6-BRIEFING-DISPLAY-01"),4.0,2.6)
cabinet("F6-BRIEFING-CREDENZA-01",bounds("F6-BRIEFING-CREDENZA-01"),2.7,C["wood"])
box("F6-BRIEFING-ACOUSTIC-01::ceiling",(17.5,4.5,31.5,15.5),.18,10.65,C["acoustic"],"F6-BRIEFING-ACOUSTIC-01")
for n,y0 in enumerate((6,10,13.5),1): box(f"F6-BRIEFING-ACOUSTIC-01::side-{n}",(31.66,y0,31.82,y0+1.6),4.2,2,C["acoustic"],"F6-BRIEFING-ACOUSTIC-01")
box("F6-BRIEFING-LIGHT-01::bar",(20,10,29,10.2),.07,10.42,C["light"],"F6-BRIEFING-LIGHT-01")

# Roof transition terminal / wayfinding
cabinet("F6-ROOF-TRANSITION-01",bounds("F6-ROOF-TRANSITION-01"),4.1,C["core"])
box("F6-ROOF-TRANSITION-01::screen",(48.88,25,49.05,28),3.0,2.0,C["screen"],"F6-ROOF-TRANSITION-01")
box("F6-ROOF-WAYFINDING-01::sign",(51.0,29.8,53.6,29.98),1.35,6.3,C["stone"],"F6-ROOF-WAYFINDING-01")
# upward chevron stack toward protected stair route
for k in range(3):
    box(f"F6-ROOF-WAYFINDING-01::chevron-{k}",(52.05+k*.12,29.68,52.35+k*.12,29.82),.25,6.65+k*.35,C["red"],"F6-ROOF-WAYFINDING-01")

# Passenger core
x1,y1,x2,y2=PASS
wh("pass_s",x1,x2,y1,.65,H,color=C["core"]); wh("pass_n",x1,x2,y2,.65,H,color=C["core"]); wv("pass_e",x2,y1,y2,.65,H,color=C["core"]); wv("pass_w",x1,y1,y2,.65,H,[(37,41)],C["core"])
box("F6-PASS-ELEV-DOOR-01::a",(53.88,37,54.04,39),8.5,0,C["freight"],"F6-PASS-ELEV-DOOR-01"); box("F6-PASS-ELEV-DOOR-01::b",(53.88,39,54.04,41),8.5,0,C["freight"],"F6-PASS-ELEV-DOOR-01")
panel("F6-PASS-ELEV-CALL-01",(53.68,35.7),.62,.14,1.5,3.6,C["core"])
box("F6-FLOOR-ID-01::sign",(51.7,33.7,53.5,33.85),1.1,6.2,C["stone"],"F6-FLOOR-ID-01")

# Freight and stairs; stairs rise the full level toward roof
x1,y1,x2,y2=FREIGHT
wh("freight_n",x1,x2,y2-.325,.65,H,color=C["freight"]); wv("freight_w",x1+.325,y1,y2,.65,H,color=C["freight"]); wv("freight_e",x2,y1,y2,.65,H,color=C["freight"]); wh("freight_s",x1,x2,y1,.65,H,[(1.5,6.5)],C["freight"])
box("F6-FREIGHT-DOOR-01::a",(1.5,59.88,4,60.04),9,0,C["core"],"F6-FREIGHT-DOOR-01"); box("F6-FREIGHT-DOOR-01::b",(4,59.88,6.5,60.04),9,0,C["core"],"F6-FREIGHT-DOOR-01")
panel("F6-FREIGHT-CONTROL-01",(6.9,59.66),.8,.14,1.7,3.4,C["freight"])
wh("stair_b_s",8,18,54,.65,H,[(14,17)],C["core"]); wv("stair_b_w",8,54,72,.65,H,color=C["core"]); wv("stair_b_e",18,54,72,.65,H,color=C["core"]); wh("stair_b_n",8,18,71.675,.65,H,color=C["core"]); stair("stair_b",SB,4.0)
wh("stair_a_s",60,72,54,.65,H,[(61.5,64.5)],C["core"]); wv("stair_a_w",60,54,72,.65,H,color=C["core"]); wv("stair_a_e",71.675,54,72,.65,H,color=C["core"]); wh("stair_a_n",60,72,71.675,.65,H,color=C["core"]); stair("stair_a",SA,5.0)
box("F6-STAIR-B-DOOR-01::door",(14,53.88,17,54.04),8.5,0,C["core"],"F6-STAIR-B-DOOR-01")
box("F6-STAIR-A-DOOR-01::door",(61.5,53.88,64.5,54.04),8.5,0,C["core"],"F6-STAIR-A-DOOR-01")
# roof direction markers above each protected stair door
box("roof_marker_b",(14.4,53.65,16.6,53.82),.55,8.7,C["red"])
box("roof_marker_a",(61.9,53.65,64.1,53.82),.55,8.7,C["red"])

# North support band
wh("support_south",18,60,60,.5,H,[(20,23),(27.5,30.5),(35.5,38.5),(43.5,46.5),(51,53.5)],C["part"])
for x,y1,y2,n in [(26,60,70,"rr_div1"),(34,60,72,"rr_div2"),(42,60,72,"audit_div"),(50,60,72,"systems_div"),(54,60,66,"jan_div")]: wv(n,x,y1,y2,.5,H,color=C["part"])
wh("rr_a_n",18,26,70,.5,H,color=C["part"]); wh("rr_b_n",26,34,70,.5,H,color=C["part"]); box("mep",MEP,H,0,C["freight"])

for i in ("F6-RR-A-VANITY-01","F6-RR-B-VANITY-01"): cabinet(i,bounds(i),2.7,C["stone"])
for i in ("F6-RR-A-WC-01","F6-RR-B-WC-01"):
    b=bounds(i); x=(b[0]+b[2])/2; y=(b[1]+b[3])/2; cyl(i+"::bowl",(x,y),.7,1.1,0,C["white"],i,28)
for x0,name in ((20.2,"a"),(28.2,"b")):
    box(f"restroom_mirror_{name}",(x0,61.0,x0+2.0,61.10),2.5,4.0,C["glass"])
    cyl(f"restroom_sink_{name}",(x0+1.0,61.65),.48,.24,2.75,C["white"],sections=24)

cabinet("F6-AUDIT-STORAGE-01",(34.7,62.3,40.8,69.5),6.5,C["black"])
for n,z0 in enumerate((1.0,2.0,3.0,4.0,5.0),1): box(f"audit_drawer_{n}",(35.1,63.0,40.4,64.0),.4,z0,C["stone_top"],"F6-AUDIT-STORAGE-01")
cabinet("F6-DESK-SYSTEMS-01",(43.2,62.8,48.6,69.5),7,C["black"])
for n,z0 in enumerate((.8,1.7,2.6,3.5,4.4,5.3),1): box(f"desk_system_device_{n}",(43.6,63.15,48.2,63.55),.45,z0,C["core"],"F6-DESK-SYSTEMS-01")
cabinet("F6-JANITOR-STORAGE-01",(50.4,61,53.4,64.6),6,C["part"])

for x1,x2,label in ((20,23,"rr_a"),(27.5,30.5,"rr_b"),(35.5,38.5,"audit"),(43.5,46.5,"systems"),(51,53.5,"janitor")):
    box(f"support_door_{label}",(x1,59.82,x2,60.08),8.3,0,C["core"])
    box(f"support_handle_{label}",(x2-.28,59.70,x2-.12,59.78),.55,3.3,C["stone_top"])

# Ceilings / lighting
box("F6-ACOUSTIC-CEILING-01::field",(1,17,59,53),.22,10.72,C["acoustic"],"F6-ACOUSTIC-CEILING-01")
box("support_ceiling_west",(18,60,50,72),.18,10.74,C["acoustic"])
box("support_ceiling_east",(50,60,72,72),.18,10.74,C["acoustic"])
box("north_corridor_ceiling",(18,54,60,60),.18,10.74,C["acoustic"])
box("elevator_lobby_ceiling",(48,24,64,53),.16,10.48,C["acoustic"])
for k,x in enumerate((29,33,37,41,45),1): box(f"F6-COMMAND-LIGHT-01::{k}",(x-.8,40.8,x+.8,41.0),.07,10.48,C["light"],"F6-COMMAND-LIGHT-01")
for k,x in enumerate((6.5,10,13.5),1): box(f"F6-SALON-LIGHT-01::{k}",(x-.7,27.2,x+.7,27.35),.06,10.44,C["light"],"F6-SALON-LIGHT-01")
for k,(x,y) in enumerate([(8,8),(20,8),(32,8),(44,8),(56,8),(8,20),(20,20),(32,20),(44,20),(56,20),(20,32),(32,32),(44,32),(20,48),(32,48),(44,48)],1):
    box(f"F6-GENERAL-LIGHT-01::{k:02d}",(x-1.1,y-.08,x+1.1,y+.08),.06,10.55,C["light"],"F6-GENERAL-LIGHT-01")
for k in range(3): box(f"F6-UPWARD-GUIDANCE-01::{k}",(54.8+k*1.3,53.2,55.5+k*1.3,53.35),.06,9.7+k*.2,C["red"],"F6-UPWARD-GUIDANCE-01")

# Life safety
panel("F6-EGRESS-MAP-01",(52,29.4),1.6,.14,1.7,4,C["core"])
panel("F6-FE-WEST-01",(18.6,57),1,.16,1.3,3.3,C["safety"])
panel("F6-FE-EAST-01",(53,57),1,.16,1.3,3.3,C["safety"])
box("F6-EMERGENCY-LIGHT-01::bar",(25,59.75,47,59.9),.08,9.8,C["safety"],"F6-EMERGENCY-LIGHT-01")

scene.metadata.update({"scene_id":"equity-uprise-floor-06","version":"penthouse-command-hybrid-v1","floor_identity":"Penthouse Command","inventory_ref":"floor-06-object-inventory.json","not_for_construction":True})
data=scene.export(file_type="glb"); OUT.write_bytes(data)
ext=(scene.extents/FT).tolist(); missing=sorted(set(INV)-modeled); gkeys=list(scene.geometry.keys())
checks=[]
def ck(n,p,a=None,e=None): checks.append({"name":n,"passed":bool(p),"actual":a,"expected":e})
ck("72ft width",abs(ext[0]-72)<.05,ext[0],72)
ck("72ft depth",abs(ext[1]-72)<.05,ext[1],72)
ck("inventory summary matches records",inventory["summary"]["object_records"]==len(INV),len(INV),inventory["summary"]["object_records"])
ck("all inventory records modeled",not missing,len(modeled),len(INV))
ck("six command chairs",all(f"F6-COMMAND-CHAIR-{i:02d}" in modeled for i in range(1,7)))
ck("command wall modeled","F6-COMMAND-WALL-01" in modeled and all(x in modeled for x in ("F6-DISPLAY-NOW","F6-DISPLAY-PAST","F6-DISPLAY-JOIN")))
ck("Halo globe modeled","F6-HALO-GLOBE-01" in modeled and "F6-HALO-CEILING-FEED-01" in modeled)
ck("Halo within canonical vertical envelope",abs(hp["z"]-8.25)<.01 and abs(hr-2.25)<.01 and hp["z"]-hr>=6.0 and hp["z"]+hr<=10.5)
ck("salon complete",all(x in modeled for x in ("F6-SALON-SOFA-01","F6-SALON-CHAIR-01","F6-SALON-CHAIR-02","F6-SALON-INFO-01")))
ck("strategy room complete",all(x in modeled for x in ("F6-STRATEGY-GLAZING-01","F6-STRATEGY-DOOR-01","F6-STRATEGY-DISPLAY-01","F6-STRATEGY-SECURE-STORAGE-01")))
ck("briefing room complete",all(x in modeled for x in ("F6-BRIEFING-GLAZING-01","F6-BRIEFING-DOOR-01","F6-BRIEFING-DISPLAY-01","F6-BRIEFING-CREDENZA-01")))
ck("roof transition terminal modeled","F6-ROOF-TRANSITION-01" in modeled and "F6-ROOF-WAYFINDING-01" in modeled)
ck("passenger and freight interfaces",all(x in modeled for x in ("F6-PASS-ELEV-DOOR-01","F6-FREIGHT-DOOR-01")))
ck("both stair doors",all(x in modeled for x in ("F6-STAIR-A-DOOR-01","F6-STAIR-B-DOOR-01")))
# Visual completeness
ck("command wall architectural surround",any("command_wall_plinth" in x for x in gkeys) and sum("command_wall_acoustic_fin" in x for x in gkeys)>=4)
ck("Halo visually instrumented",sum("F6-HALO-GLOBE-01::ring" in x for x in gkeys)>=36 and sum("F6-HALO-GLOBE-01::beacon" in x for x in gkeys)>=4)
ck("strategy acoustic enclosure",sum("F6-STRATEGY-ACOUSTIC-01::side" in x for x in gkeys)>=3 and any("strategy_door_header" in x for x in gkeys))
ck("briefing acoustic enclosure",sum("F6-BRIEFING-ACOUSTIC-01::side" in x for x in gkeys)>=3 and any("briefing_door_header" in x for x in gkeys))
ck("support rooms have doors",sum("support_door_" in x for x in gkeys)>=5)
ck("restrooms have mirrors and sinks",sum("restroom_mirror_" in x for x in gkeys)>=2 and sum("restroom_sink_" in x for x in gkeys)>=2)
ck("audit storage visibly equipped",sum("audit_drawer_" in x for x in gkeys)>=5)
ck("desk systems visibly equipped",sum("desk_system_device_" in x for x in gkeys)>=6)
ck("support ceilings modeled",all(any(tag in x for x in gkeys) for tag in ("support_ceiling_west","support_ceiling_east","north_corridor_ceiling","elevator_lobby_ceiling")))
ck("roof direction physically visible",all(any(tag in x for x in gkeys) for tag in ("roof_marker_a","roof_marker_b")))
failed=[x for x in checks if not x["passed"]]
report={"scene_id":"equity-uprise-floor-06","version":"penthouse-command-hybrid-v1","mesh_count":len(scene.geometry),"glb_bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"extents_ft":ext,"inventory_records":len(INV),"inventory_records_modeled":len(modeled),"inventory_records_missing":missing,"visual_completion_gate":"penthouse-command-halo-roof-transition-detail-v1","checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
REPORT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("version","mesh_count","inventory_records","inventory_records_modeled","checks_passed","checks_total","passed")},indent=2))
if failed: raise SystemExit(1)
