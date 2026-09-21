#!/usr/bin/env python3
"""Equity Uprise Floor 4 — Media + Culture hybrid GLB builder.

Historical Media + Culture composition + Core V2 chassis + reconciled program.
NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import hashlib, json, math
import trimesh

FT=.3048
HERE=Path(__file__).resolve().parent
OUTDIR=HERE.parent/"generated"; OUTDIR.mkdir(exist_ok=True)
OUT=OUTDIR/"equity-uprise-floor-04-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-floor-04-core-v2-report.json"
INV_PATH=HERE/"floor-04-object-inventory.json"
inventory=json.loads(INV_PATH.read_text()); INV={o["id"]:o for o in inventory["objects"]}
scene=trimesh.Scene(); modeled=set()

H=11.0
PASS=(54.,34.,62.,44.); FREIGHT=(0.,60.,8.,72.); SB=(8.,54.,18.,72.); SA=(60.,54.,72.,72.); MEP=(50.,66.,60.,72.)
C={"floor":[86,89,91,255],"wall":[43,42,41,255],"part":[59,58,56,255],"core":[48,51,56,255],
"freight":[69,72,76,255],"stair":[103,102,98,255],"stone":[52,53,54,255],"stone_top":[70,71,72,255],
"glass":[196,220,228,92],"glass_priv":[170,188,194,130],"wood":[108,82,60,255],"seat":[71,69,68,255],
"seat_alt":[82,79,77,255],"red":[133,26,29,255],"screen":[24,29,34,255],"light":[231,217,187,255],
"plant":[73,91,72,255],"rug":[58,56,55,255],"white":[220,220,215,255],"safety":[156,40,43,255],
"acoustic":[54,55,56,255],"black":[24,25,26,255],"speaker":[35,36,38,255]}

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

def sectional(i,b):
    x1,y1,x2,y2=b
    sofa(i,(x1,y1,x2-2.2,y2))
    # return/chase
    box(i+"::chaise-seat",(x2-2.5,y1+.3,x2-.25,y2-.25),.52,1.05,C["seat"],i)
    box(i+"::chaise-back",(x2-.55,y1+.3,x2-.25,y2-.25),1.9,1.45,C["seat_alt"],i)

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
for k in range(8): box(f"F4-SOUTH-GLAZING-01::pane-{k+1}",(k*9,.22,(k+1)*9,.42),H,0,C["glass"],"F4-SOUTH-GLAZING-01")
for x in range(0,73,9): box(f"south_mullion_{x}",(max(0,x-.08),0,min(72,x+.08),.68),H,0,C["core"])

# Media wall / central listening
box("F4-MEDIA-WALL-01::wall",(22,52.1,50,52.85),10.55,0,C["stone"],"F4-MEDIA-WALL-01")
for i in ("F4-DISPLAY-LISTEN","F4-DISPLAY-WATCH","F4-DISPLAY-ARCHIVE"): screen(i,bounds(i),3.2,4.8)
box("F4-IDENTITY-SIGN-01::sign",(30,52.0,42,52.16),1.2,8.9,C["stone_top"],"F4-IDENTITY-SIGN-01")
# Architectural finish around playback wall so it reads as a room, not three floating screens.
box("media_wall_plinth",(22,51.72,50,52.05),.55,0,C["black"])
for n,x0 in enumerate((22.6,25.1,27.6,47.4,49.0),1):
    box(f"media_wall_acoustic_fin_{n}",(x0,51.86,x0+.16,52.08),7.5,1.0,C["acoustic"])
sectional("F4-LISTENING-SECTIONAL-01",bounds("F4-LISTENING-SECTIONAL-01"))
for i in ("F4-LISTENING-CHAIR-01","F4-LISTENING-CHAIR-02"):
    b=bounds(i); chair(i,(b[0]+b[2])/2,(b[1]+b[3])/2,(36,41))
p=INV["F4-LISTENING-TABLE-01"]["placement"]; round_table("F4-LISTENING-TABLE-01",(p["center_ft"]["x"],p["center_ft"]["y"]),p["diameter_ft"],p["height_ft"])
box("F4-LISTENING-RUG-01::rug",bounds("F4-LISTENING-RUG-01"),.05,.01,C["rug"],"F4-LISTENING-RUG-01")
box("F4-LISTENING-POWER-01::floorbox",(35.4,40.5,36.6,41.1),.10,.01,C["core"],"F4-LISTENING-POWER-01")

# Gallery
box("F4-GALLERY-WALL-01::wall",bounds("F4-GALLERY-WALL-01"),9.3,0,C["stone"],"F4-GALLERY-WALL-01")
for i in range(1,7):
    inv=f"F4-GALLERY-FRAME-{i:02d}"; b=bounds(inv)
    box(inv+"::frame",b,2.8,3.8,C["core"],inv)
    x1,y1,x2,y2=b; box(inv+"::surface",(x1-.02,y1+.08,x2+.02,y2-.08),2.45,3.98,C["screen"],inv)
sofa("F4-GALLERY-SOFA-01",bounds("F4-GALLERY-SOFA-01"))
for i in ("F4-GALLERY-CHAIR-01","F4-GALLERY-CHAIR-02"):
    b=bounds(i); chair(i,(b[0]+b[2])/2,(b[1]+b[3])/2,(9.5,28))
p=INV["F4-GALLERY-TABLE-01"]["placement"]; round_table("F4-GALLERY-TABLE-01",(p["center_ft"]["x"],p["center_ft"]["y"]),p["diameter_ft"],p["height_ft"])
box("F4-GALLERY-RUG-01::rug",bounds("F4-GALLERY-RUG-01"),.05,.01,C["rug"],"F4-GALLERY-RUG-01")
plant("F4-GALLERY-PLANT-01",center("F4-GALLERY-PLANT-01"))

# Creator Recording Room
for name,x1,x2,doorid,glassid in [
    ("recording",2,15,"F4-RECORDING-DOOR-01","F4-RECORDING-GLAZING-01"),
    ("edit",17,31,"F4-EDIT-DOOR-01","F4-EDIT-GLAZING-01")
]:
    box(name+"_south",(x1,3.8,x2,4.2),H,0,C["part"])
    box(name+"_west",(x1-.2,4,x1+.2,16),H,0,C["part"])
    box(name+"_east",(x2-.2,4,x2+.2,16),H,0,C["part"])
    db=INV[doorid]["placement"]["bounds_ft"]
    wh(glassid+"::north",x1,x2,16,.18,H,[(db["x1"],db["x2"])],C["glass"])
    box(glassid+"::privacy",(x1,15.82,x2,15.98),1.7,3.3,C["glass_priv"],glassid)
    box(doorid+"::door",bounds(doorid),8.5,0,C["core"],doorid)

table("F4-RECORDING-WORKSURFACE-01",bounds("F4-RECORDING-WORKSURFACE-01"),2.3,.2)
for i in ("F4-RECORDING-CHAIR-01","F4-RECORDING-CHAIR-02"):
    x,y=center(i); chair(i,x,y,(6.5,7.2))
x,y=center("F4-MIC-STAND-01")
cyl("F4-MIC-STAND-01::base",(x,y),.55,.12,0,C["core"],"F4-MIC-STAND-01",24)
cyl("F4-MIC-STAND-01::pole",(x,y),.06,4.45,.12,C["black"],"F4-MIC-STAND-01",16)
cyl("F4-MIC-STAND-01::mic",(x,y),.15,.7,4.5,C["black"],"F4-MIC-STAND-01",18)
screen("F4-RECORDING-MONITOR-01",bounds("F4-RECORDING-MONITOR-01"),3.0,2.0)
box("F4-RECORDING-ACOUSTIC-01::ceiling",(2.5,4.5,14.5,15.5),.18,10.65,C["acoustic"],"F4-RECORDING-ACOUSTIC-01")
for n,x0 in enumerate((3.0,8.5,13.0),1): box(f"F4-RECORDING-ACOUSTIC-01::panel-{n}",(x0,4.18,x0+1.5,4.34),4.0,2.0,C["acoustic"],"F4-RECORDING-ACOUSTIC-01")
# Recording-room completeness details: side absorption, cable trough and door frame.
for n,y0 in enumerate((6.0,10.0,13.5),1):
    box(f"recording_acoustic_side_{n}",(2.18,y0,2.34,y0+1.6),4.2,2.0,C["acoustic"])
box("recording_cable_trough",(4.2,6.05,8.8,6.18),.20,.35,C["black"])
box("recording_door_header",(10.35,15.72,13.65,15.9),.45,8.5,C["core"])

# Edit suite
table("F4-EDIT-DESK-01",bounds("F4-EDIT-DESK-01"),2.3,.22)
for i in ("F4-EDIT-CHAIR-01","F4-EDIT-CHAIR-02","F4-EDIT-VISITOR-CHAIR-01","F4-EDIT-VISITOR-CHAIR-02"):
    x,y=center(i); chair(i,x,y,(23,8.5))
screen("F4-EDIT-DISPLAY-01",bounds("F4-EDIT-DISPLAY-01"),3.1,2.6)
for n,x0 in enumerate((20.0,26.0),1):
    box(f"F4-EDIT-SPEAKER-01::{n}",(x0-.45,9.45,x0+.45,10.05),1.2,3.0,C["speaker"],"F4-EDIT-SPEAKER-01")
box("F4-EDIT-ACOUSTIC-01::ceiling",(17.5,4.5,30.5,15.5),.18,10.65,C["acoustic"],"F4-EDIT-ACOUSTIC-01")
for n,x0 in enumerate((18.0,23.0,28.0),1): box(f"F4-EDIT-ACOUSTIC-01::panel-{n}",(x0,4.18,x0+1.5,4.34),4.0,2.0,C["acoustic"],"F4-EDIT-ACOUSTIC-01")
# Edit-suite completeness details: side treatment, desk cable raceway and display backing.
for n,y0 in enumerate((6.0,10.0,13.5),1):
    box(f"edit_acoustic_side_{n}",(30.66,y0,30.82,y0+1.6),4.2,2.0,C["acoustic"])
box("edit_cable_raceway",(19.3,7.1,26.7,7.24),.18,.45,C["black"])
box("edit_display_backer",(19.6,9.68,26.4,9.82),3.2,2.7,C["stone"])

# Floor control
cabinet("F4-FLOOR-CONTROL-01",bounds("F4-FLOOR-CONTROL-01"),4.0,C["core"])
box("F4-FLOOR-CONTROL-01::screen",(48.88,25,49.05,28),3.0,2.0,C["screen"],"F4-FLOOR-CONTROL-01")

# Passenger core
x1,y1,x2,y2=PASS
wh("pass_s",x1,x2,y1,.65,H,color=C["core"]); wh("pass_n",x1,x2,y2,.65,H,color=C["core"]); wv("pass_e",x2,y1,y2,.65,H,color=C["core"]); wv("pass_w",x1,y1,y2,.65,H,[(37,41)],C["core"])
box("F4-PASS-ELEV-DOOR-01::a",(53.88,37,54.04,39),8.5,0,C["freight"],"F4-PASS-ELEV-DOOR-01"); box("F4-PASS-ELEV-DOOR-01::b",(53.88,39,54.04,41),8.5,0,C["freight"],"F4-PASS-ELEV-DOOR-01")
panel("F4-PASS-ELEV-CALL-01",(53.68,35.7),.62,.14,1.5,3.6,C["core"]); box("F4-FLOOR-ID-01::sign",(51.7,33.7,53.5,33.85),1.1,6.2,C["stone"],"F4-FLOOR-ID-01")

# Freight / stairs
x1,y1,x2,y2=FREIGHT
wh("freight_n",x1,x2,y2-.325,.65,H,color=C["freight"]); wv("freight_w",x1+.325,y1,y2,.65,H,color=C["freight"]); wv("freight_e",x2,y1,y2,.65,H,color=C["freight"]); wh("freight_s",x1,x2,y1,.65,H,[(1.5,6.5)],C["freight"])
box("F4-FREIGHT-DOOR-01::a",(1.5,59.88,4,60.04),9,0,C["core"],"F4-FREIGHT-DOOR-01"); box("F4-FREIGHT-DOOR-01::b",(4,59.88,6.5,60.04),9,0,C["core"],"F4-FREIGHT-DOOR-01")
panel("F4-FREIGHT-CONTROL-01",(6.9,59.66),.8,.14,1.7,3.4,C["freight"])
wh("stair_b_s",8,18,54,.65,H,[(14,17)],C["core"]); wv("stair_b_w",8,54,72,.65,H,color=C["core"]); wv("stair_b_e",18,54,72,.65,H,color=C["core"]); wh("stair_b_n",8,18,71.675,.65,H,color=C["core"]); stair("stair_b",SB,4.0)
wh("stair_a_s",60,72,54,.65,H,[(61.5,64.5)],C["core"]); wv("stair_a_w",60,54,72,.65,H,color=C["core"]); wv("stair_a_e",71.675,54,72,.65,H,color=C["core"]); wh("stair_a_n",60,72,71.675,.65,H,color=C["core"]); stair("stair_a",SA,5.0)
box("F4-STAIR-B-DOOR-01::door",(14,53.88,17,54.04),8.5,0,C["core"],"F4-STAIR-B-DOOR-01"); box("F4-STAIR-A-DOOR-01::door",(61.5,53.88,64.5,54.04),8.5,0,C["core"],"F4-STAIR-A-DOOR-01")

# Current Core V2 support band
wh("support_south",18,60,60,.5,H,[(20,23),(27.5,30.5),(35.5,38.5),(43.5,46.5),(51,53.5)],C["part"])
for x,y1,y2,n in [(26,60,70,"rr_div1"),(34,60,72,"rr_div2"),(42,60,72,"storage_div"),(50,60,72,"it_div"),(54,60,66,"jan_div")]: wv(n,x,y1,y2,.5,H,color=C["part"])
wh("rr_a_n",18,26,70,.5,H,color=C["part"]); wh("rr_b_n",26,34,70,.5,H,color=C["part"]); box("mep",MEP,H,0,C["freight"])
for i in ("F4-RR-A-VANITY-01","F4-RR-B-VANITY-01"): cabinet(i,bounds(i),2.7,C["stone"])
for i in ("F4-RR-A-WC-01","F4-RR-B-WC-01"):
    b=bounds(i); x=(b[0]+b[2])/2; y=(b[1]+b[3])/2; cyl(i+"::bowl",(x,y),.7,1.1,0,C["white"],i,28)
cabinet("F4-MEDIA-STORAGE-01",(34.7,62.5,40.8,69.5),6.4,C["part"])
for n,y0 in enumerate((63.0,65.4,67.8),1): box(f"F4-MEDIA-STORAGE-01::shelf-{n}",(35.0,y0,40.5,y0+.12),.12,2.0+n*.75,C["stone_top"],"F4-MEDIA-STORAGE-01")
# Media cases / charging docks on shelving.
for n,(x0,y0) in enumerate(((35.4,63.35),(37.2,63.35),(39.0,63.35),(35.4,66.0),(37.2,66.0),(39.0,66.0)),1):
    box(f"media_storage_case_{n}",(x0,y0,x0+1.1,y0+.7),.75,2.2,C["black"])
cabinet("F4-MEDIA-IT-RACK-01",(43.2,62.8,48.6,69.5),7,C["black"])
for n,z0 in enumerate((.8,1.7,2.6,3.5,4.4,5.3),1):
    box(f"media_it_device_{n}",(43.6,63.15,48.2,63.55),.45,z0,C["core"])
cabinet("F4-JANITOR-STORAGE-01",(50.4,61,53.4,64.6),6,C["part"])

# Support-room doors, hardware and restroom detail.
for n,(x1,x2,label) in enumerate(((20,23,"rr_a"),(27.5,30.5,"rr_b"),(35.5,38.5,"storage"),(43.5,46.5,"it"),(51,53.5,"janitor")),1):
    box(f"support_door_{label}",(x1,59.82,x2,60.08),8.3,0,C["core"])
    box(f"support_door_handle_{label}",(x2-.28,59.70,x2-.12,59.78),.55,3.3,C["stone_top"])
for x0,name in ((20.2,"a"),(28.2,"b")):
    box(f"restroom_mirror_{name}",(x0,61.0,x0+2.0,61.10),2.5,4.0,C["glass"])
    cyl(f"restroom_sink_{name}",(x0+1.0,61.65),.48,.24,2.75,C["white"],sections=24)
# Full support-band ceiling fields complete the rooms while preserving removable cutaway semantics.
box("support_ceiling_west",(18,60,50,72),.18,10.74,C["acoustic"])
box("support_ceiling_east",(50,60,72,72),.18,10.74,C["acoustic"])
box("north_corridor_ceiling",(18,54,60,60),.18,10.74,C["acoustic"])

# Ceiling / lighting
box("F4-ACOUSTIC-CEILING-01::field",(1,17,59,53),.22,10.72,C["acoustic"],"F4-ACOUSTIC-CEILING-01")
box("gallery_ceiling",(1,17,18,39),.16,10.48,C["acoustic"])
box("elevator_lobby_ceiling",(48,24,64,53),.16,10.48,C["acoustic"])
for k,x in enumerate((29,33,37,41,45),1): box(f"F4-MEDIA-LIGHT-01::{k}",(x-.8,40.7,x+.8,40.9),.07,10.5,C["light"],"F4-MEDIA-LIGHT-01")
for k,y0 in enumerate((20,23,26,29,32,35),1): box(f"F4-GALLERY-LIGHT-01::{k}",(2.0,y0-.25,3.2,y0+.25),.08,9.8,C["light"],"F4-GALLERY-LIGHT-01")
box("F4-RECORDING-LIGHT-01::bar",(5,10,12,10.2),.07,10.45,C["light"],"F4-RECORDING-LIGHT-01")
box("F4-EDIT-LIGHT-01::bar",(20,10,28,10.2),.07,10.45,C["light"],"F4-EDIT-LIGHT-01")
for k,(x,y) in enumerate([(8,8),(20,8),(32,8),(44,8),(56,8),(8,20),(20,20),(32,20),(44,20),(56,20),(20,32),(32,32),(44,32),(20,48),(32,48),(44,48)],1):
    box(f"F4-GENERAL-LIGHT-01::{k:02d}",(x-1.1,y-.08,x+1.1,y+.08),.06,10.55,C["light"],"F4-GENERAL-LIGHT-01")

# Life safety
panel("F4-EGRESS-MAP-01",(52,29.4),1.6,.14,1.7,4,C["core"]); panel("F4-FE-WEST-01",(18.6,57),1,.16,1.3,3.3,C["safety"]); panel("F4-FE-EAST-01",(53,57),1,.16,1.3,3.3,C["safety"])
box("F4-EMERGENCY-LIGHT-01::bar",(25,59.75,47,59.9),.08,9.8,C["safety"],"F4-EMERGENCY-LIGHT-01")

scene.metadata.update({"scene_id":"equity-uprise-floor-04","version":"media-culture-hybrid-v2","floor_identity":"Media + Culture","inventory_ref":"floor-04-object-inventory.json","not_for_construction":True})
data=scene.export(file_type="glb"); OUT.write_bytes(data)
ext=(scene.extents/FT).tolist(); missing=sorted(set(INV)-modeled)
checks=[]
def ck(n,p,a=None,e=None): checks.append({"name":n,"passed":bool(p),"actual":a,"expected":e})
ck("72ft width",abs(ext[0]-72)<.05,ext[0],72); ck("72ft depth",abs(ext[1]-72)<.05,ext[1],72)
ck("inventory summary matches records",inventory["summary"]["object_records"]==len(INV),len(INV),inventory["summary"]["object_records"])
ck("all inventory records modeled",not missing,len(modeled),len(INV))
ck("media wall modeled","F4-MEDIA-WALL-01" in modeled); ck("listening zone modeled","F4-LISTENING-SECTIONAL-01" in modeled)
ck("six gallery frames",all(f"F4-GALLERY-FRAME-{i:02d}" in modeled for i in range(1,7)))
ck("recording room modeled",all(x in modeled for x in ("F4-RECORDING-GLAZING-01","F4-MIC-STAND-01","F4-RECORDING-WORKSURFACE-01")))
ck("edit suite modeled",all(x in modeled for x in ("F4-EDIT-DESK-01","F4-EDIT-DISPLAY-01","F4-EDIT-SPEAKER-01")))
ck("floor control modeled","F4-FLOOR-CONTROL-01" in modeled); ck("passenger interface","F4-PASS-ELEV-DOOR-01" in modeled)
ck("freight interface","F4-FREIGHT-DOOR-01" in modeled); ck("both stair doors",all(x in modeled for x in ("F4-STAIR-A-DOOR-01","F4-STAIR-B-DOOR-01")))
# Visual-completeness gate: inventory presence alone is not enough.
gkeys=list(scene.geometry.keys())
ck("media wall architectural surround",any("media_wall_plinth" in x for x in gkeys) and sum("media_wall_acoustic_fin" in x for x in gkeys)>=5)
ck("recording room detailed enclosure",any("recording_door_header" in x for x in gkeys) and sum("recording_acoustic_side" in x for x in gkeys)>=3)
ck("edit suite detailed enclosure",any("edit_display_backer" in x for x in gkeys) and sum("edit_acoustic_side" in x for x in gkeys)>=3)
ck("support rooms have doors",sum("support_door_" in x and "handle" not in x for x in gkeys)>=5)
ck("restrooms have mirrors and sinks",sum("restroom_mirror_" in x for x in gkeys)>=2 and sum("restroom_sink_" in x for x in gkeys)>=2)
ck("media storage visibly equipped",sum("media_storage_case_" in x for x in gkeys)>=6)
ck("media IT rack visibly equipped",sum("media_it_device_" in x for x in gkeys)>=6)
ck("support and corridor ceilings modeled",all(any(tag in x for x in gkeys) for tag in ("support_ceiling_west","support_ceiling_east","north_corridor_ceiling")))
ck("gallery and elevator-lobby ceilings modeled",all(any(tag in x for x in gkeys) for tag in ("gallery_ceiling","elevator_lobby_ceiling")))
failed=[x for x in checks if not x["passed"]]
report={"scene_id":"equity-uprise-floor-04","version":"media-culture-hybrid-v2","mesh_count":len(scene.geometry),"glb_bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"extents_ft":ext,"inventory_records":len(INV),"inventory_records_modeled":len(modeled),"inventory_records_missing":missing,"visual_completion_gate":"architectural-room-and-support-detail-v1","checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
REPORT.write_text(json.dumps(report,indent=2)+"\n"); print(json.dumps({k:report[k] for k in ("version","mesh_count","inventory_records","inventory_records_modeled","checks_passed","checks_total","passed")},indent=2))
if failed: raise SystemExit(1)
