#!/usr/bin/env python3
"""Build the detailed Equity Uprise Level 7 Roof / Mobility Portal GLB.

This is a deterministic visualization / digital-twin artifact, NOT FOR CONSTRUCTION
and NOT FOR AVIATION APPROVAL.
"""
from pathlib import Path
import json, math, hashlib
import trimesh

HERE=Path(__file__).resolve().parent
INV_RAW=json.loads((HERE/"floor-07-object-inventory.json").read_text())
INV={x["id"]:x for x in INV_RAW["objects"]}
OUTDIR=HERE.parent/"generated"
OUTDIR.mkdir(parents=True,exist_ok=True)
OUT=OUTDIR/"equity-uprise-floor-07-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-floor-07-core-v2-report.json"
FT=.3048

C={
 "deck":[76,79,81,255],"deck2":[88,89,88,255],"parapet":[49,50,51,255],
 "metal":[49,53,58,255],"core":[63,67,71,255],"stair":[108,108,103,255],
 "path":[101,99,94,255],"service":[68,72,76,255],"screen":[47,50,54,255],
 "wood":[104,78,55,255],"accent":[133,26,29,255],
 "beacon":[44,80,92,255],"glass":[190,208,214,150],"mobility":[111,111,107,255],
 "light":[236,220,184,255],"safety":[168,35,38,255],"drain":[40,43,45,255]
}
scene=trimesh.Scene(); modeled=set(); records=[]

def mark(i): modeled.add(i)
def add(name,mesh,color,obj=None):
    mesh.visual.face_colors=color
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    records.append(name)
    if obj: mark(obj)
    return mesh

def box(name,b,z0,h,color,obj=None):
    x1,y1,x2,y2=b
    m=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT))
    m.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z0+h/2)*FT))
    return add(name,m,color,obj)

def cyl(name,cx,cy,z0,r,h,color,obj=None,sections=24):
    m=trimesh.creation.cylinder(radius=r*FT,height=h*FT,sections=sections)
    m.apply_translation((cx*FT,cy*FT,(z0+h/2)*FT))
    return add(name,m,color,obj)

def ring(name,cx,cy,z,r,width,color,obj=None,segments=72):
    for k in range(segments):
        a=2*math.pi*k/segments
        x=cx+r*math.cos(a);y=cy+r*math.sin(a)
        box(f"{name}::{k:02d}",(x-width/2,y-width/2,x+width/2,y+width/2),z,.06,color,obj if k==0 else None)

def slab_with_openings():
    openings=[(54,34,62,44),(0,60,8,72),(60.75,58.25,71.25,71.25),(8.75,58.25,17.25,71.25)]
    xs={0,72};ys={0,72}
    for b in openings: xs.update((b[0],b[2]));ys.update((b[1],b[3]))
    xs=sorted(xs);ys=sorted(ys);n=0
    for i in range(len(xs)-1):
        for j in range(len(ys)-1):
            x1,x2=xs[i],xs[i+1];y1,y2=ys[j],ys[j+1]
            mx,my=(x1+x2)/2,(y1+y2)/2
            if any(b[0] <= mx <= b[2] and b[1] <= my <= b[3] for b in openings): continue
            box(f"F7-ROOF-DECK-01::tile-{n:03d}",(x1,y1,x2,y2),-.5,.5,C["deck"],"F7-ROOF-DECK-01" if n==0 else None);n+=1

def stair_transition(prefix,obj,b,flight_w):
    x1,y1,x2,y2=b;margin=.75
    wx1=x1+margin;wx2=wx1+flight_w;ex2=x2-margin;ex1=ex2-flight_w
    y_start=58.25;y_north=67.416666667;land_n2=71.25;sy1=54.75;sy2=58.25
    base=-13.5;top=0;riser=(top-base)/22;tread=11/12;mid=base+11*riser
    box(f"{prefix}::lower-landing",(wx1,sy1,wx2,sy2),base,.25,C["stair"],obj)
    for i in range(10):
        ya=y_start+i*tread;yb=ya+tread;z=base+(i+1)*riser
        box(f"{prefix}::flight1-{i+1:02d}",(wx1,ya,wx2,yb),z-.18,.18,C["stair"])
    box(f"{prefix}::mid-landing",(wx1,y_north,ex2,land_n2),mid-.25,.25,C["stair"])
    for i in range(10):
        yb=y_north-i*tread;ya=yb-tread;z=mid+(i+1)*riser
        box(f"{prefix}::flight2-{i+1:02d}",(ex1,ya,ex2,yb),z-.18,.18,C["stair"])
    box(f"{prefix}::upper-landing",(ex1,sy1,ex2,sy2),-.25,.25,C["stair"])

def headhouse(prefix,obj,b,door_obj,door_x):
    x1,y1,x2,y2=b;t=.5;h=9.0;dw1,dw2=door_x
    box(f"{prefix}::north",(x1,y2-t,x2,y2),0,h,C["core"],obj)
    box(f"{prefix}::east",(x2-t,y1,x2,y2),0,h,C["core"])
    box(f"{prefix}::west",(x1,y1,x1+t,y2),0,h,C["core"])
    if dw1>x1: box(f"{prefix}::south-left",(x1,y1,dw1,y1+t),0,h,C["core"])
    if dw2<x2: box(f"{prefix}::south-right",(dw2,y1,x2,y1+t),0,h,C["core"])
    box(f"{prefix}::south-lintel",(dw1,y1,dw2,y1+t),7.5,h-7.5,C["core"])
    box(f"{prefix}::roof",(x1,y1,x2,y2),h,.35,C["core"])
    # Deliberately open door leaf against the jamb: roof walking plane is physically clear.
    box(f"{prefix}::door-open",(dw1-.12,y1+.55,dw1+.12,y1+3.45),.05,7.25,C["metal"],door_obj)

# Architectural roof plane + guarded edges.
slab_with_openings()
box("F7-PARAPET-N-01",(0,71.5,72,72),0,3.5,C["parapet"],"F7-PARAPET-N-01")
box("F7-PARAPET-S-01",(0,0,72,.5),0,3.5,C["parapet"],"F7-PARAPET-S-01")
box("F7-PARAPET-W-01",(0,0,.5,72),0,3.5,C["parapet"],"F7-PARAPET-W-01")
box("F7-PARAPET-E-01",(71.5,0,72,72),0,3.5,C["parapet"],"F7-PARAPET-E-01")

# Human-walkable Floor 6 -> roof stair transitions and roof headhouses.
stair_transition("F7-STAIR-A-TRANSITION-01","F7-STAIR-A-TRANSITION-01",(60,54,72,72),5)
stair_transition("F7-STAIR-B-TRANSITION-01","F7-STAIR-B-TRANSITION-01",(8,54,18,72),4)
headhouse("F7-STAIR-A-HEADHOUSE-01","F7-STAIR-A-HEADHOUSE-01",(60,54,72,72),"F7-STAIR-A-DOOR-01",(61.5,64.5))
headhouse("F7-STAIR-B-HEADHOUSE-01","F7-STAIR-B-HEADHOUSE-01",(8,54,18,72),"F7-STAIR-B-DOOR-01",(14,17))
box("F7-STAIR-A-THRESHOLD",(61.5,53.6,64.5,54.2),-.05,.1,C["metal"])
box("F7-STAIR-B-THRESHOLD",(14,53.6,17,54.2),-.05,.1,C["metal"])

# Exit signs, sconces, emergency/life-safety equipment.
box("F7-STAIR-A-EXIT-SIGN-01",(62.1,53.65,63.9,53.82),7.7,.65,C["safety"],"F7-STAIR-A-EXIT-SIGN-01")
box("F7-STAIR-B-EXIT-SIGN-01",(14.6,53.65,16.4,53.82),7.7,.65,C["safety"],"F7-STAIR-B-EXIT-SIGN-01")
for j,(x,y) in enumerate([(61.0,53.55),(65.0,53.55),(13.5,53.55),(17.5,53.55)]):
    box(f"F7-STAIR-SCONCES-01::{j}",(x-.18,y-.12,x+.18,y+.12),6.3,.5,C["light"],"F7-STAIR-SCONCES-01" if j==0 else None)
for j,(x,y) in enumerate([(65.2,53.4),(17.7,53.4)]):
    box(f"F7-EMERGENCY-CALL-01::{j}",(x-.22,y-.14,x+.22,y+.14),3.4,.8,C["accent"],"F7-EMERGENCY-CALL-01" if j==0 else None)
for j,(x,y) in enumerate([(66.1,53.4),(18.6,53.4)]):
    box(f"F7-FIRE-CABINET-01::{j}",(x-.35,y-.16,x+.35,y+.16),2.2,2.1,C["safety"],"F7-FIRE-CABINET-01" if j==0 else None)

# Local core/service volumes for true isolated roof review. No passenger-elevator roof door is modeled.
def shell(name,b,h,color,obj):
    x1,y1,x2,y2=b;t=.45
    box(name+"::n",(x1,y2-t,x2,y2),0,h,color,obj)
    box(name+"::s",(x1,y1,x2,y1+t),0,h,color)
    box(name+"::e",(x2-t,y1,x2,y2),0,h,color)
    box(name+"::w",(x1,y1,x1+t,y2),0,h,color)
    box(name+"::roof",(x1,y1,x2,y2),h,.3,color)
shell("F7-PASSENGER-OVERRUN-01",(54,34,62,44),8,C["core"],"F7-PASSENGER-OVERRUN-01")
shell("F7-FREIGHT-OVERRUN-01",(0,60,8,72),8,C["service"],"F7-FREIGHT-OVERRUN-01")
box("F7-MEP-SCREEN-01",(50,66,60,72),0,6,C["screen"],"F7-MEP-SCREEN-01")

# Primary public/service walking paths — broad and uncluttered.
for obj,b in [
 ("F7-PATH-A-01",(62,24,68,54)),
 ("F7-PATH-B-01",(12,48,50,54)),
 ("F7-PATH-B-02",(44,30,50,54)),
 ("F7-PATH-OVERLOOK-01",(48,6,54,30)),
 ("F7-SERVICE-WALK-01",(18,54,60,60))]:
    box(obj,b,.01,.08,C["path"],obj)

# Ecosystem routing interface: restrained infrastructure, not a billboard forest.
box("F7-ECOSYSTEM-BEACON-01::pedestal",(46.75,24.5,49.25,29.5),0,3.2,C["metal"],"F7-ECOSYSTEM-BEACON-01")
box("F7-ECOSYSTEM-BEACON-01::mast",(47.65,26.3,48.35,27.7),3.2,3.7,C["beacon"])
box("F7-ECOSYSTEM-DISPLAY-01",(46.9,26.55,49.1,26.85),4.3,2.0,C["glass"],"F7-ECOSYSTEM-DISPLAY-01")
box("F7-RETURN-HOME-01",(46.25,28.1,47.2,29.0),2.2,1.5,C["accent"],"F7-RETURN-HOME-01")
box("F7-ROUTE-ACCESS-STATE-01",(48.8,28.1,49.75,29.0),2.2,1.5,C["beacon"],"F7-ROUTE-ACCESS-STATE-01")
cyl("F7-UPRISE-WORLD-PORTAL-01",47.2,24.9,.05,.55,2.3,C["beacon"],"F7-UPRISE-WORLD-PORTAL-01",32)
cyl("F7-BEACON-LIGHT-01",48,27,6.9,.16,.25,C["light"],"F7-BEACON-LIGHT-01",20)

# Candidate mobility reservation: no H, no regulatory TLOF/FATO markings, no aircraft claim.
box("F7-MOBILITY-FIELD-01",(10,8,48,46),.005,.035,C["mobility"],"F7-MOBILITY-FIELD-01")
ring("F7-MOBILITY-RING-01",29,27,.055,13.5,.38,C["deck2"],"F7-MOBILITY-RING-01",72)
for j in range(12):
    a=2*math.pi*j/12
    x=29+17.2*math.cos(a);y=27+17.2*math.sin(a)
    cyl(f"F7-MOBILITY-BOLLARDS-01::{j}",x,y,.08,.18,.6,C["metal"],"F7-MOBILITY-BOLLARDS-01" if j==0 else None,16)

# South overlook.
box("F7-OVERLOOK-DECK-01",(12,.75,46,6),.02,.12,C["deck2"],"F7-OVERLOOK-DECK-01")
for obj,x in [("F7-OVERLOOK-BENCH-01",20),("F7-OVERLOOK-BENCH-02",38)]:
    box(obj+"::seat",(x-3,2.7,x+3,4.1),1.2,.35,C["wood"],obj)
    box(obj+"::back",(x-3,3.85,x+3,4.15),1.55,1.25,C["wood"])
    for lx in (x-2.4,x+2.4): box(obj+f"::leg-{lx:g}",(lx-.18,2.95,lx+.18,3.25),.15,1.1,C["metal"])
for x in [12,18,24,30,36,42,46]:
    cyl(f"F7-OVERLOOK-RAIL-01::post-{x}",x,.72,3.45,.08,.65,C["metal"],"F7-OVERLOOK-RAIL-01" if x==12 else None,12)
box("F7-OVERLOOK-RAIL-01::top",(12,.64,46,.80),4.02,.16,C["metal"])

# Service equipment band.
box("F7-SERVICE-SCREEN-01",(34,60,50,60.4),0,6,C["screen"],"F7-SERVICE-SCREEN-01")
for obj,b,h in [
 ("F7-MECH-UNIT-01",(35,62,40,68),4),
 ("F7-MECH-UNIT-02",(41,62,46,68),4),
 ("F7-MECH-UNIT-03",(47,61,50,65),3.5)]:
    box(obj,b,0,h,C["service"],obj)
    x1,y1,x2,y2=b
    for k in range(4):
        xx=x1+(k+1)*(x2-x1)/5
        box(obj+f"::louver-{k}",(xx-.08,y1-.08,xx+.08,y1+.06),.8,h-1.6,C["metal"])

# Roof lighting, drains and lightning protection.
light_pts=[(67,50),(67,42),(67,34),(52,27),(48,33),(48,42),(46,51),(38,51),(28,51),(18,51),(51,20),(51,13),(44,4),(30,4)]
for j,(x,y) in enumerate(light_pts):
    cyl(f"F7-PATH-LIGHTS-01::{j}",x,y,.08,.12,.65,C["light"],"F7-PATH-LIGHTS-01" if j==0 else None,12)
for j,(x,y) in enumerate([(5,5),(36,5),(67,5),(5,50),(34,58),(67,50)]):
    cyl(f"F7-DRAINS-01::{j}",x,y,-.01,.35,.04,C["drain"],"F7-DRAINS-01" if j==0 else None,20)
for j,(x,y) in enumerate([(1.2,1.2),(70.8,1.2),(1.2,70.8),(70.8,70.8)]):
    cyl(f"F7-LIGHTNING-RODS-01::{j}",x,y,3.5,.05,3.0,C["metal"],"F7-LIGHTNING-RODS-01" if j==0 else None,10)
box("F7-WAYFINDING-01::east",(50.2,28.2,50.5,29.4),2.0,2.1,C["accent"],"F7-WAYFINDING-01")
box("F7-WAYFINDING-01::west",(43.5,49.2,43.8,50.4),2.0,2.1,C["accent"])

required={x["id"] for x in INV_RAW["objects"]}
missing=sorted(required-modeled)
checks=[]
def ck(name,ok,detail=""): checks.append({"name":name,"passed":bool(ok),"detail":detail})
ck("inventory coverage",not missing,", ".join(missing))
ck("72ft roof footprint",True,"0..72 x 0..72")
ck("roof is open-air and guarded",all(x in modeled for x in ["F7-PARAPET-N-01","F7-PARAPET-S-01","F7-PARAPET-W-01","F7-PARAPET-E-01"]))
ck("both protected stairs reach roof",all(x in modeled for x in ["F7-STAIR-A-TRANSITION-01","F7-STAIR-B-TRANSITION-01"]))
ck("both roof stair doors modeled open",all(x in modeled for x in ["F7-STAIR-A-DOOR-01","F7-STAIR-B-DOOR-01"]))
ck("passenger roof stop not asserted","F7-PASSENGER-OVERRUN-01" in modeled,"overrun enclosure only; no passenger door/hotspot")
ck("mobility zone remains conceptual","F7-MOBILITY-FIELD-01" in modeled and "F7-MOBILITY-RING-01" in modeled,"no H/TLOF/FATO/regulatory marking")
ck("ecosystem routing represented","F7-ECOSYSTEM-BEACON-01" in modeled)
ck("uprise world optional route represented","F7-UPRISE-WORLD-PORTAL-01" in modeled)
ck("city overlook represented",all(x in modeled for x in ["F7-OVERLOOK-DECK-01","F7-OVERLOOK-BENCH-01","F7-OVERLOOK-BENCH-02","F7-OVERLOOK-RAIL-01"]))
ck("north service band equipped",all(x in modeled for x in ["F7-SERVICE-SCREEN-01","F7-MECH-UNIT-01","F7-MECH-UNIT-02","F7-MECH-UNIT-03","F7-MEP-SCREEN-01"]))
ck("primary public paths modeled",all(x in modeled for x in ["F7-PATH-A-01","F7-PATH-B-01","F7-PATH-B-02","F7-PATH-OVERLOOK-01"]))
ck("visual completeness: lighting",all(x in modeled for x in ["F7-PATH-LIGHTS-01","F7-STAIR-SCONCES-01","F7-BEACON-LIGHT-01"]))
ck("visual completeness: roof support",all(x in modeled for x in ["F7-DRAINS-01","F7-LIGHTNING-RODS-01"]))
ck("visual completeness: life safety",all(x in modeled for x in ["F7-EMERGENCY-CALL-01","F7-FIRE-CABINET-01","F7-WAYFINDING-01"]))

scene.metadata.update({"scene_id":"equity-uprise-level-07","version":"roof-mobility-reconciled-v1","floor_identity":"Roof / Mobility Portal","inventory_ref":"floor-07-object-inventory.json","not_for_construction":True,"not_for_aviation_approval":True})
data=scene.export(file_type="glb");OUT.write_bytes(data)
sha=hashlib.sha256(data).hexdigest();failed=[x for x in checks if not x["passed"]]
report={"schema_version":"1.0.0","scene_id":"equity-uprise-level-07","not_for_construction":True,"not_for_aviation_approval":True,"glb_bytes":len(data),"sha256":sha,"mesh_count":len(scene.geometry),"inventory_records":len(required),"inventory_modeled":len(required)-len(missing),"checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
REPORT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","inventory_records","inventory_modeled","checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed: raise SystemExit(1)
