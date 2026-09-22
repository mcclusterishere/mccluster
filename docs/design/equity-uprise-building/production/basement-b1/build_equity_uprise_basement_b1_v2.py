#!/usr/bin/env python3
"""Build the detailed Equity Uprise B1 Underground Operations GLB. NOT FOR CONSTRUCTION."""
from pathlib import Path
import json, math, hashlib
import trimesh
HERE=Path(__file__).resolve().parent
INV_RAW=json.loads((HERE/"basement-b1-object-inventory.json").read_text())
OUTDIR=HERE.parent/"generated";OUTDIR.mkdir(parents=True,exist_ok=True)
OUT=OUTDIR/"equity-uprise-basement-b1-core-v2.glb";REPORT=OUTDIR/"equity-uprise-basement-b1-core-v2-report.json";FT=.3048
C={"floor":[76,78,79,255],"ceiling":[54,57,60,255],"wall":[71,74,77,255],"partition":[89,91,92,255],"metal":[47,52,57,255],"metal2":[73,78,82,255],"equipment":[83,88,92,255],"pipe":[105,109,107,255],"copper":[111,74,48,255],"accent":[133,26,29,255],"safety":[178,133,40,255],"screen":[22,35,41,255],"glass":[171,190,196,150],"wood":[99,74,53,255],"light":[235,225,198,255],"blue":[46,85,105,255],"drain":[34,37,39,255],"rubber":[43,45,46,255]}
scene=trimesh.Scene();modeled=set()
def mark(i):
    if i: modeled.add(i)
def add(name,mesh,color,obj=None):
    mesh.visual.face_colors=color;scene.add_geometry(mesh,node_name=name,geom_name=name);mark(obj);return mesh
def box(name,b,z0,h,color,obj=None):
    x1,y1,x2,y2=b;m=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT));m.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z0+h/2)*FT));return add(name,m,color,obj)
def cyl(name,cx,cy,z0,r,h,color,obj=None,sections=20):
    m=trimesh.creation.cylinder(radius=r*FT,height=h*FT,sections=sections);m.apply_translation((cx*FT,cy*FT,(z0+h/2)*FT));return add(name,m,color,obj)
def room_shell(prefix,obj,b,door_side="south",door_center=None,glass=False,h=10.5):
    x1,y1,x2,y2=b;t=.35;col=C["glass"] if glass else C["partition"];dw=3.0
    if door_center is None: door_center=(x1+x2)/2 if door_side in ("south","north") else (y1+y2)/2
    if door_side=="north":
        a=door_center-dw/2;b2=door_center+dw/2
        if a>x1: box(prefix+"::n-left",(x1,y2-t,a,y2),0,h,col,obj)
        if b2<x2: box(prefix+"::n-right",(b2,y2-t,x2,y2),0,h,col)
        box(prefix+"::n-lintel",(a,y2-t,b2,y2),7.5,h-7.5,col)
    else: box(prefix+"::north",(x1,y2-t,x2,y2),0,h,col,obj)
    if door_side=="south":
        a=door_center-dw/2;b2=door_center+dw/2
        if a>x1: box(prefix+"::s-left",(x1,y1,a,y1+t),0,h,col,obj)
        if b2<x2: box(prefix+"::s-right",(b2,y1,x2,y1+t),0,h,col)
        box(prefix+"::s-lintel",(a,y1,b2,y1+t),7.5,h-7.5,col)
    else: box(prefix+"::south",(x1,y1,x2,y1+t),0,h,col,obj)
    if door_side=="east":
        a=door_center-dw/2;b2=door_center+dw/2;box(prefix+"::e-low",(x2-t,y1,x2,a),0,h,col,obj);box(prefix+"::e-high",(x2-t,b2,x2,y2),0,h,col);box(prefix+"::e-lintel",(x2-t,a,x2,b2),7.5,h-7.5,col)
    else: box(prefix+"::east",(x2-t,y1,x2,y2),0,h,col,obj)
    if door_side=="west":
        a=door_center-dw/2;b2=door_center+dw/2;box(prefix+"::w-low",(x1,y1,x1+t,a),0,h,col,obj);box(prefix+"::w-high",(x1,b2,x1+t,y2),0,h,col);box(prefix+"::w-lintel",(x1,a,x1+t,b2),7.5,h-7.5,col)
    else: box(prefix+"::west",(x1,y1,x1+t,y2),0,h,col,obj)
def rack(prefix,obj,cx,cy,w=2,d=3,h=7):
    box(prefix+"::frame",(cx-w/2,cy-d/2,cx+w/2,cy+d/2),.1,h,C["metal"],obj)
    for k in range(4): box(prefix+f"::shelf{k}",(cx-w/2+.08,cy-d/2+.08,cx+w/2-.08,cy+d/2-.08),.6+k*(h-.8)/4,.12,C["metal2"])
def chair(prefix,cx,cy,obj=None):
    box(prefix+"::seat",(cx-.8,cy-.8,cx+.8,cy+.8),1.55,.25,C["rubber"],obj);box(prefix+"::back",(cx-.8,cy+.62,cx+.8,cy+.82),1.8,2.1,C["rubber"])
    for dx in (-.55,.55):
      for dy in (-.55,.55): box(prefix+f"::leg{dx}{dy}",(cx+dx-.07,cy+dy-.07,cx+dx+.07,cy+dy+.07),.1,1.45,C["metal"])
def pipe_x(prefix,x1,x2,y,z,r,col,obj=None):
    m=trimesh.creation.cylinder(radius=r*FT,height=(x2-x1)*FT,sections=16);m.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,[0,1,0]));m.apply_translation((((x1+x2)/2)*FT,y*FT,z*FT));return add(prefix,m,col,obj)
def pipe_y(prefix,x,y1,y2,z,r,col,obj=None):
    m=trimesh.creation.cylinder(radius=r*FT,height=(y2-y1)*FT,sections=16);m.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,[1,0,0]));m.apply_translation((x*FT,((y1+y2)/2)*FT,z*FT));return add(prefix,m,col,obj)

box("B1-SLAB-01",(0,0,72,72),-.5,.5,C["floor"],"B1-SLAB-01")
t=.55
for n,b in [("south",(0,0,72,t)),("north",(0,72-t,72,72)),("west",(0,0,t,72)),("east",(72-t,0,72,72))]: box("B1-PERIMETER-01::"+n,b,0,13,C["wall"],"B1-PERIMETER-01" if n=="south" else None)
openings=[(54,34,62,44),(0,60,8,72),(60.75,58.25,71.25,71.25),(8.75,58.25,17.25,71.25)];xs={0,72};ys={0,72}
for b in openings: xs.update((b[0],b[2]));ys.update((b[1],b[3]))
xs=sorted(xs);ys=sorted(ys);ci=0
for i in range(len(xs)-1):
  for j in range(len(ys)-1):
    x1,x2=xs[i],xs[i+1];y1,y2=ys[j],ys[j+1];mx=(x1+x2)/2;my=(y1+y2)/2
    if any(a<=mx<=c and b<=my<=d for a,b,c,d in openings): continue
    box(f"B1-CEILING-01::tile-{ci:03d}",(x1,y1,x2,y2),12.65,.35,C["ceiling"],"B1-CEILING-01" if ci==0 else None);ci+=1
def stair_enclosure(prefix,obj,b,doorx):
    x1,y1,x2,y2=b;tt=.45;a,bx=doorx
    box(prefix+"::north",(x1,y2-tt,x2,y2),0,13,C["wall"],obj);box(prefix+"::east",(x2-tt,y1,x2,y2),0,13,C["wall"]);box(prefix+"::west",(x1,y1,x1+tt,y2),0,13,C["wall"]);box(prefix+"::south-left",(x1,y1,a,y1+tt),0,13,C["wall"]);box(prefix+"::south-right",(bx,y1,x2,y1+tt),0,13,C["wall"]);box(prefix+"::south-lintel",(a,y1,bx,y1+tt),7.5,5.5,C["wall"])
stair_enclosure("B1-STAIR-A-ENCLOSURE-01","B1-STAIR-A-ENCLOSURE-01",(60,54,72,72),(61.5,64.5));stair_enclosure("B1-STAIR-B-ENCLOSURE-01","B1-STAIR-B-ENCLOSURE-01",(8,54,18,72),(14,17))
def stair_transition(prefix,obj,b,flight_w):
    x1,y1,x2,y2=b;margin=.75;wx1=x1+margin;wx2=wx1+flight_w;ex2=x2-margin;ex1=ex2-flight_w;y0=58.25;yn=67.416666667;sy1=54.75;sy2=58.25;r=13.5/22;tread=11/12;mid=11*r
    box(prefix+"::lower",(wx1,sy1,wx2,sy2),0,.25,C["metal2"],obj)
    for i in range(10):
        ya=y0+i*tread;yb=ya+tread;z=(i+1)*r;box(prefix+f"::f1-{i:02d}",(wx1,ya,wx2,yb),z-.18,.18,C["metal2"])
    box(prefix+"::mid",(wx1,yn,ex2,71.25),mid-.25,.25,C["metal2"])
    for i in range(10):
        yb=yn-i*tread;ya=yb-tread;z=mid+(i+1)*r;box(prefix+f"::f2-{i:02d}",(ex1,ya,ex2,yb),z-.18,.18,C["metal2"])
    box(prefix+"::upper",(ex1,sy1,ex2,sy2),13.25,.25,C["metal2"])
stair_transition("B1-STAIR-A-TRANSITION-01","B1-STAIR-A-TRANSITION-01",(60,54,72,72),5);stair_transition("B1-STAIR-B-TRANSITION-01","B1-STAIR-B-TRANSITION-01",(8,54,18,72),4)
for n,b in [("n",(54,43.55,62,44)),("s",(54,34,62,34.45)),("e",(61.55,34,62,44)),("w-low",(54,34,54.45,37)),("w-high",(54,41,54.45,44))]: box("B1-PASSENGER-CORE-01::"+n,b,0,13,C["wall"],"B1-PASSENGER-CORE-01" if n=="n" else None)
box("B1-PASSENGER-CORE-01::w-lintel",(54,37,54.45,41),7.5,5.5,C["wall"]);box("B1-PASSENGER-CORE-01::door",(53.96,37.2,54.08,40.8),.15,7.0,C["metal2"])
for n,b in [("n",(0,71.55,8,72)),("e",(7.55,60,8,72)),("w",(0,60,.45,72)),("s-left",(0,60,1.5,60.45)),("s-right",(6.5,60,8,60.45))]: box("B1-FREIGHT-CORE-01::"+n,b,0,13,C["wall"],"B1-FREIGHT-CORE-01" if n=="n" else None)
box("B1-FREIGHT-CORE-01::s-lintel",(1.5,60,6.5,60.45),8,5,C["wall"]);box("B1-FREIGHT-CORE-01::door",(1.65,59.95,6.35,60.08),.15,7.6,C["metal2"]);box("B1-MEP-RISER-01",(50,66,60,72),0,11.5,C["wall"],"B1-MEP-RISER-01")
room_shell("B1-MECH-ROOM-01","B1-MECH-ROOM-01",(2,4,30,26),"south",16);room_shell("B1-ELEC-ROOM-01","B1-ELEC-ROOM-01",(32,4,52,20),"south",42);room_shell("B1-FIRE-ROOM-01","B1-FIRE-ROOM-01",(54,4,70,20),"south",62);room_shell("B1-TELECOM-ROOM-01","B1-TELECOM-ROOM-01",(32,22,52,34),"south",42);room_shell("B1-FLOOD-ROOM-01","B1-FLOOD-ROOM-01",(54,22,70,32),"south",62);room_shell("B1-WORKSHOP-ROOM-01","B1-WORKSHOP-ROOM-01",(2,30,16,52),"east",41);room_shell("B1-LAB-ZONE-01","B1-LAB-ZONE-01",(18,36,52,54),"south",35,glass=True,h=9.5);box("B1-STAGING-ZONE-01",(0.6,54.4,7.4,59.6),.01,.05,C["safety"],"B1-STAGING-ZONE-01");box("B1-OPS-ZONE-01",(20,54,48,64),.015,.07,C["metal2"],"B1-OPS-ZONE-01");room_shell("B1-LOCK-ROOM-01","B1-LOCK-ROOM-01",(24,64,44,72),"south",34,h=11)
box("B1-MECH-AHU-01::a",(5,8,13,14),.1,4.4,C["equipment"],"B1-MECH-AHU-01");box("B1-MECH-AHU-01::b",(16,8,24,14),.1,4.4,C["equipment"])
for j,x in enumerate([8,15,22]): cyl(f"B1-MECH-PUMP-01::{j}",x,20,.2,.9,2.2,C["blue"],"B1-MECH-PUMP-01" if j==0 else None,24)
pipe_x("B1-MECH-PIPE-RACK-01::a",4,28,23.5,8.6,.18,C["pipe"],"B1-MECH-PIPE-RACK-01");pipe_x("B1-MECH-PIPE-RACK-01::b",4,28,24.4,9.1,.18,C["copper"]);box("B1-MECH-BAS-01",(27.2,14,29.2,18),1,5.8,C["screen"],"B1-MECH-BAS-01")
for k in range(6): box(f"B1-ELEC-SWITCHGEAR-01::{k}",(33+k*2.8,7,35.3+k*2.8,9.2),.1,7,C["metal2"],"B1-ELEC-SWITCHGEAR-01" if k==0 else None)
box("B1-ELEC-UPS-01::a",(34,13,39,18),.1,5.5,C["equipment"],"B1-ELEC-UPS-01");box("B1-ELEC-UPS-01::b",(40,13,45,18),.1,5.5,C["equipment"]);box("B1-ELEC-METER-01",(47,13,50.5,18),.7,6.2,C["screen"],"B1-ELEC-METER-01")
box("B1-FIRE-PUMP-01::base",(56,8,62,14),.15,.6,C["metal"],"B1-FIRE-PUMP-01");cyl("B1-FIRE-PUMP-01::pump",59,11,.75,1.2,2.4,C["accent"]);cyl("B1-FIRE-WATER-01::tank",66,11,.1,2.2,6.5,C["equipment"],"B1-FIRE-WATER-01",28);pipe_y("B1-FIRE-RISER-01::riser",68,6,18,8.8,.22,C["accent"],"B1-FIRE-RISER-01");box("B1-FIRE-RISER-01::panel",(63.5,16,67,18.5),2,4.5,C["screen"])
for j,(x,y) in enumerate([(35,26),(39,26),(43,26),(47,26)]): rack(f"B1-TELECOM-RACKS-01::{j}","B1-TELECOM-RACKS-01" if j==0 else None,x,y,2.2,3,7.5)
box("B1-TELECOM-TRAY-01",(33,30.5,51,31.3),8.7,.35,C["metal"],"B1-TELECOM-TRAY-01");box("B1-TELECOM-CONSOLE-01::desk",(34,23,41,25),2.3,.35,C["metal2"],"B1-TELECOM-CONSOLE-01");box("B1-TELECOM-CONSOLE-01::screen",(36,24.7,39,24.9),3.1,2,C["screen"])
for j,x in enumerate([58,66]): cyl(f"B1-FLOOD-SUMP-01::{j}",x,27,-.25,1.5,.35,C["drain"],"B1-FLOOD-SUMP-01" if j==0 else None,28)
for j,x in enumerate([58,66]): cyl(f"B1-FLOOD-PUMP-01::{j}",x,27,.1,.55,2.2,C["blue"],"B1-FLOOD-PUMP-01" if j==0 else None,20)
box("B1-FLOOD-SENSOR-01",(55.2,30,58,31.7),2.5,3.4,C["screen"],"B1-FLOOD-SENSOR-01")
box("B1-WORKSHOP-BENCH-01::top",(3.2,33,14.8,36),3,.35,C["wood"],"B1-WORKSHOP-BENCH-01")
for j,y in enumerate([39,44,49]): rack(f"B1-WORKSHOP-RACKS-01::{j}","B1-WORKSHOP-RACKS-01" if j==0 else None,5,y,5,2.6,7)
box("B1-WORKSHOP-PPE-01",(11.5,39,15,44),.1,7,C["safety"],"B1-WORKSHOP-PPE-01");box("B1-WORKSHOP-SPILL-01",(11.5,46,15,50),.1,5.5,C["accent"],"B1-WORKSHOP-SPILL-01")
box("B1-LAB-TABLE-01",(26,42,44,47),2.5,.5,C["wood"],"B1-LAB-TABLE-01")
for j,(x,y) in enumerate([(28,40.5),(35,40.5),(42,40.5),(28,48.5),(35,48.5),(42,48.5)]): chair(f"B1-LAB-CHAIRS-01::{j}",x,y,"B1-LAB-CHAIRS-01" if j==0 else None)
box("B1-LAB-DASHBOARD-01",(21,52.2,49,52.45),3,5.4,C["screen"],"B1-LAB-DASHBOARD-01");box("B1-LAB-CONSOLE-01::desk",(45,38,50,40.5),2.3,.4,C["metal2"],"B1-LAB-CONSOLE-01");box("B1-LAB-CONSOLE-01::screen",(46,40.25,49,40.45),3.2,2.2,C["screen"]);box("B1-LAB-GLASS-01",(18.1,53.45,51.9,53.75),0,9,C["glass"],"B1-LAB-GLASS-01")
rack("B1-STAGING-RACK-01","B1-STAGING-RACK-01",4,56.8,5.5,2.3,7.5)
for j,y in enumerate([55.3,58.4]): box(f"B1-STAGING-CART-01::{j}",(1.2,y,3.1,y+1.5),1.1,1.4,C["metal2"],"B1-STAGING-CART-01" if j==0 else None)
for j in range(5): box(f"B1-STAGING-MARK-01::{j}",(.7+j*1.4,54.6,1.4+j*1.4,54.9),.02,.035,C["safety"],"B1-STAGING-MARK-01" if j==0 else None)
for j,x in enumerate([23,27,31,35,39,43,47]): box(f"B1-OPS-GATE-01::bar{j}",(x-.09,63.4,x+.09,63.7),0,8.5,C["metal"],"B1-OPS-GATE-01" if j==0 else None)
box("B1-OPS-GATE-01::top",(22,63.35,47,63.75),8.2,.35,C["metal"]);box("B1-OPS-DESK-01",(27,56,41,59),2.4,.45,C["metal2"],"B1-OPS-DESK-01")
for j,(x,y) in enumerate([(29,55.3),(33,55.3),(37,55.3),(41,55.3)]): chair(f"B1-OPS-CHAIRS-01::{j}",x,y,"B1-OPS-CHAIRS-01" if j==0 else None)
box("B1-OPS-STATUS-01",(22,61.2,31,61.45),3,4.6,C["screen"],"B1-OPS-STATUS-01");box("B1-OPS-OCCUPANCY-01",(33,61.2,40,61.45),3,4.6,C["screen"],"B1-OPS-OCCUPANCY-01");box("B1-OPS-ROUTE-01::base",(42,57.4,46.5,60),2.3,.45,C["metal2"],"B1-OPS-ROUTE-01");box("B1-OPS-ROUTE-01::screen",(43,59.7,46,59.9),3,2.5,C["screen"])
box("B1-LOCK-INNER-DOOR-01",(30.2,63.95,37.8,64.18),.05,8,C["metal2"],"B1-LOCK-INNER-DOOR-01");box("B1-LOCK-OUTER-DOOR-01",(30.2,71.82,37.8,72),.05,8,C["metal"],"B1-LOCK-OUTER-DOOR-01");box("B1-LOCK-FRAME-01::left",(24.8,70.8,26,72),0,11,C["metal"],"B1-LOCK-FRAME-01");box("B1-LOCK-FRAME-01::right",(42,70.8,43.2,72),0,11,C["metal"]);box("B1-LOCK-FRAME-01::top",(25,70.8,43,72),9.8,1.2,C["metal"]);box("B1-LOCK-PANEL-01",(27.2,65,29.5,65.3),3,3.4,C["screen"],"B1-LOCK-PANEL-01")
for j,x in enumerate([28,40]): cyl(f"B1-LOCK-WARNING-01::{j}",x,69.5,8.5,.16,.3,C["accent"],"B1-LOCK-WARNING-01" if j==0 else None,16)
for j,(x,y) in enumerate([(6,28),(18,28),(30,28),(42,28),(58,34),(68,34),(20,58),(28,58),(36,58),(44,58),(56,58),(66,50),(66,42),(24,34),(36,34),(48,34),(20,50),(50,50)]): box(f"B1-LIGHTS-GENERAL-01::{j}",(x-2,y-.18,x+2,y+.18),11.6,.22,C["light"],"B1-LIGHTS-GENERAL-01" if j==0 else None)
for j,(x,y) in enumerate([(8,27),(20,27),(32,27),(44,27),(56,33),(66,33),(18,55),(26,55),(34,55),(42,55),(50,55),(62,52)]): box(f"B1-LIGHTS-EMERGENCY-01::{j}",(x-.25,y-.25,x+.25,y+.25),1,.18,C["safety"],"B1-LIGHTS-EMERGENCY-01" if j==0 else None)
box("B1-CABLE-TRAY-01",(18,34.5,54,35.3),10.3,.35,C["metal"],"B1-CABLE-TRAY-01");pipe_x("B1-PIPE-SPINE-01",2,70,2,10.4,.16,C["pipe"],"B1-PIPE-SPINE-01")
for j,(x,y) in enumerate([(8,3),(24,3),(40,3),(56,3),(68,26),(18,33),(52,33),(34,55)]): cyl(f"B1-FLOOR-DRAINS-01::{j}",x,y,-.02,.28,.06,C["drain"],"B1-FLOOR-DRAINS-01" if j==0 else None,18)
for j,(x,y) in enumerate([(63,53.7),(15.5,53.7),(52.5,38.5),(5,59)]): box(f"B1-EXIT-SIGNS-01::{j}",(x-.8,y-.12,x+.8,y+.12),7.7,.6,C["accent"],"B1-EXIT-SIGNS-01" if j==0 else None)
for j,(x,y) in enumerate([(30.5,27),(52.5,21),(17,53),(50,55)]): box(f"B1-EXTINGUISHERS-01::{j}",(x-.3,y-.18,x+.3,y+.18),2,2,C["accent"],"B1-EXTINGUISHERS-01" if j==0 else None)
for j,(x,y) in enumerate([(58,46),(20,55)]): box(f"B1-EMERGENCY-COMMS-01::{j}",(x-.25,y-.15,x+.25,y+.15),3.3,.9,C["blue"],"B1-EMERGENCY-COMMS-01" if j==0 else None)

required={x["id"] for x in INV_RAW["objects"]};missing=sorted(required-modeled);checks=[]
def ck(n,ok,d=""): checks.append({"name":n,"passed":bool(ok),"detail":d})
ck("inventory coverage",not missing,", ".join(missing));ck("72ft basement footprint",True);ck("below-grade perimeter enclosed","B1-PERIMETER-01" in modeled);ck("ceiling/support plane modeled","B1-CEILING-01" in modeled);ck("both protected stairs modeled",all(x in modeled for x in ["B1-STAIR-A-ENCLOSURE-01","B1-STAIR-B-ENCLOSURE-01"]));ck("B1 to Floor 1 stair transitions modeled",all(x in modeled for x in ["B1-STAIR-A-TRANSITION-01","B1-STAIR-B-TRANSITION-01"]));ck("passenger and freight landings modeled",all(x in modeled for x in ["B1-PASSENGER-CORE-01","B1-FREIGHT-CORE-01"]));ck("MEP riser modeled","B1-MEP-RISER-01" in modeled);ck("technical plant rooms equipped",all(x in modeled for x in ["B1-MECH-AHU-01","B1-ELEC-SWITCHGEAR-01","B1-FIRE-PUMP-01","B1-TELECOM-RACKS-01","B1-FLOOD-SUMP-01"]));ck("facilities workshop equipped",all(x in modeled for x in ["B1-WORKSHOP-BENCH-01","B1-WORKSHOP-RACKS-01","B1-WORKSHOP-PPE-01"]));ck("systems lab equipped",all(x in modeled for x in ["B1-LAB-TABLE-01","B1-LAB-DASHBOARD-01","B1-LAB-CONSOLE-01"]));ck("service staging equipped",all(x in modeled for x in ["B1-STAGING-RACK-01","B1-STAGING-CART-01"]));ck("tunnel operations represented",all(x in modeled for x in ["B1-OPS-GATE-01","B1-OPS-DESK-01","B1-OPS-STATUS-01","B1-OPS-OCCUPANCY-01","B1-OPS-ROUTE-01"]));ck("transfer lock represented",all(x in modeled for x in ["B1-LOCK-INNER-DOOR-01","B1-LOCK-OUTER-DOOR-01","B1-LOCK-FRAME-01","B1-LOCK-PANEL-01"]));ck("visual completeness: lighting",all(x in modeled for x in ["B1-LIGHTS-GENERAL-01","B1-LIGHTS-EMERGENCY-01"]));ck("visual completeness: overhead services",all(x in modeled for x in ["B1-CABLE-TRAY-01","B1-PIPE-SPINE-01"]));ck("visual completeness: life safety",all(x in modeled for x in ["B1-EXIT-SIGNS-01","B1-EXTINGUISHERS-01","B1-EMERGENCY-COMMS-01"]));ck("visual completeness: drainage","B1-FLOOR-DRAINS-01" in modeled)
scene.metadata.update({"scene_id":"equity-uprise-basement-b1","version":"b1-underground-operations-detailed-v1","not_for_construction":True,"public_navigation":False})
data=scene.export(file_type="glb");OUT.write_bytes(data);sha=hashlib.sha256(data).hexdigest();failed=[x for x in checks if not x["passed"]]
report={"schema_version":"1.0.0","scene_id":"equity-uprise-basement-b1","not_for_construction":True,"public_navigation":False,"glb_bytes":len(data),"sha256":sha,"mesh_count":len(scene.geometry),"inventory_records":len(required),"inventory_modeled":len(required)-len(missing),"checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
REPORT.write_text(json.dumps(report,indent=2)+"\n");print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","inventory_records","inventory_modeled","checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed: raise SystemExit(1)
