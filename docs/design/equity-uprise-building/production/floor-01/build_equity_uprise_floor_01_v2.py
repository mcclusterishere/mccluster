#!/usr/bin/env python3
"""Equity Uprise Floor 1 Core V2 volumetric GLB builder. NOT FOR CONSTRUCTION."""
from pathlib import Path
import json,hashlib,trimesh
FT=.3048;HERE=Path(__file__).resolve().parent;OUTDIR=HERE.parent/"generated";OUTDIR.mkdir(exist_ok=True)
OUT=OUTDIR/"equity-uprise-floor-01-core-v2.glb";REPORT=OUTDIR/"equity-uprise-floor-01-core-v2-report.json"
W=D=72.;H=11.;PASS=(54.,34.,62.,44.);FREIGHT=(0.,60.,8.,72.);SB=(8.,54.,18.,72.);SA=(60.,54.,72.,72.);MEP=(50.,66.,60.,72.)
C={"floor":[86,89,91,255],"wall":[43,42,41,255],"part":[66,65,63,255],"core":[48,51,56,255],"freight":[69,72,76,255],"stair":[105,104,100,255],"stone":[52,53,54,255],"glass":[196,220,228,92],"wood":[108,82,60,255],"seat":[71,69,68,255],"red":[133,26,29,255],"screen":[30,35,40,255],"light":[210,202,180,255],"plant":[74,91,72,255],"rug":[58,56,55,255]}
S=trimesh.Scene();records=[]
def box(n,b,h,z=0,c=None):
 x1,y1,x2,y2=map(float,b);m=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT));m.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z+h/2)*FT));m.visual.face_colors=c or C["part"];S.add_geometry(m,node_name=n,geom_name=n);records.append(n)
def cyl(n,xy,r,h,z=0,c=None):
 m=trimesh.creation.cylinder(radius=r*FT,height=h*FT,sections=32);m.apply_translation((xy[0]*FT,xy[1]*FT,(z+h/2)*FT));m.visual.face_colors=c or C["part"];S.add_geometry(m,node_name=n,geom_name=n);records.append(n)
def wh(n,x1,x2,y,t,h,g=None,c=None,z=0):
 cur=x1
 for i,(a,b) in enumerate(sorted(g or [])+[(x2,x2)]):
  if a>cur: box(f"{n}_{i+1}",(cur,y-t/2,a,y+t/2),h,z,c)
  cur=max(cur,b)
def wv(n,x,y1,y2,t,h,g=None,c=None,z=0):
 cur=y1
 for i,(a,b) in enumerate(sorted(g or [])+[(y2,y2)]):
  if a>cur: box(f"{n}_{i+1}",(x-t/2,cur,x+t/2,a),h,z,c)
  cur=max(cur,b)
def chair(n,x,y,r=0):
 box(n+"_seat",(x-.9,y-.9,x+.9,y+.9),.45,1.25,C["seat"])
 if r in(0,180):
  yy=y+.78 if r==0 else y-.78;box(n+"_back",(x-.9,yy-.12,x+.9,yy+.12),1.7,1.55,C["seat"])
 else:
  xx=x+.78 if r==90 else x-.78;box(n+"_back",(xx-.12,y-.9,xx+.12,y+.9),1.7,1.55,C["seat"])
def sofa(n,b):
 x1,y1,x2,y2=b;box(n+"_base",b,1.25,.35,C["seat"]);box(n+"_back",(x1,y2-.35,x2,y2),2.25,.75,C["seat"]);box(n+"_arm_w",(x1,y1,x1+.35,y2),1.8,.55,C["seat"]);box(n+"_arm_e",(x2-.35,y1,x2,y2),1.8,.55,C["seat"])
def terminal(n,b):
 x1,y1,x2,y2=b;box(n+"_plinth",b,3.2,0,C["core"]);box(n+"_screen",(x1-.1,y1+.25,x1+.1,y2-.25),3.,3.,C["screen"])
def stair(n,b,fw):
 x1,y1,x2,y2=b;margin=.75;west=(x1+margin,x1+margin+fw);east=(x2-margin-fw,x2-margin);sy=y1+.75;ny=y2-4.5;t=(ny-sy)/10;r=13.5/22
 box(n+"_lower_landing",(west[0],y1+.75,west[1],sy+2.5),.25,0,C["stair"])
 for i in range(10): box(f"{n}_flight1_{i+1:02d}",(west[0],sy+i*t,west[1],sy+(i+.92)*t),.22,(i+1)*r-.22,C["stair"])
 mid=11*r;box(n+"_mid_landing",(west[0],ny,east[1],y2-.75),.25,mid-.25,C["stair"])
 for i in range(10): box(f"{n}_flight2_{i+1:02d}",(east[0],ny-(i+.92)*t,east[1],ny-i*t),.22,mid+(i+1)*r-.22,C["stair"])
 box(n+"_upper_landing",(east[0],y1+.75,east[1],sy+2.5),.25,13.25,C["stair"])
# shell
box("floor_slab",(0,0,72,72),.5,-.5,C["floor"]);box("north_exterior_wall",(0,71.25,72,72),H,0,C["wall"]);box("west_exterior_wall",(0,0,.75,60),H,0,C["wall"]);box("east_exterior_wall",(71.25,0,72,72),H,0,C["wall"]);box("south_exterior_left",(0,0,29,.75),H,0,C["wall"]);box("south_exterior_right",(43,0,72,.75),H,0,C["wall"])
# vestibule
wv("vestibule_west_glass",29,0,9,.2,H,c=C["glass"]);wv("vestibule_east_glass",43,0,9,.2,H,c=C["glass"]);wh("vestibule_inner_glass",29,43,9,.2,H,[(32,40)],C["glass"]);wh("entry_glass_left",29,32,.36,.18,H,c=C["glass"]);wh("entry_glass_right",40,43,.36,.18,H,c=C["glass"])
for x in(29,32,40,43):box(f"entry_frame_{x}",(x-.08,0,x+.08,9),H,0,C["core"])
box("arrival_atrium_inset",(20,10,52,30),.07,.01,[94,95,95,255]);box("arrival_navigation_reveal",(34.8,9.05,37.2,9.2),.1,.02,C["red"])
# lounge
box("orientation_lounge_rug",(2.5,12.5,17.2,27.4),.05,.01,C["rug"]);sofa("orientation_sofa",(3,14,10,17));chair("orientation_chair_1",13.1,15.5,270);chair("orientation_chair_2",13.1,23,270);cyl("orientation_table",(9.6,20.2),2.1,1.35,0,C["wood"]);cyl("orientation_planter",(4,25.2),1.05,2.5,0,C["plant"])
# intake
wh("intake_south",2,16,32,.5,H,c=C["part"]);wh("intake_north",2,16,44,.5,H,c=C["part"]);wv("intake_west",2,32,44,.5,H,c=C["part"]);wv("intake_east_glass",16,32,44,.22,H,[(34,37)],C["glass"]);box("intake_meeting_table",(6,36.5,12,39.5),2.5,0,C["wood"])
for i,(x,y,r) in enumerate([(5,38,90),(13,38,270),(8,35,0),(10,41,180)],1):chair(f"intake_chair_{i}",x,y,r)
# passport studio
box("passport_table_a",(22,34,31.5,37.2),2.6,0,C["wood"]);box("passport_table_b",(35,39.2,44.5,42.4),2.6,0,C["wood"])
for i,(x,y,r) in enumerate([(23,32.8,0),(27,38.4,180),(31,32.8,0),(36,38,0),(40,43.5,180),(44,38,0)],1):chair(f"passport_chair_{i}",x,y,r)
for i,x in enumerate((24,34.5,45),1):box(f"passport_kiosk_{i}_body",(x,32.2,x+1.4,33),3.8,0,C["core"]);box(f"passport_kiosk_{i}_screen",(x+.1,32.08,x+1.3,32.2),2.2,3.3,C["screen"])
# journey/reception/directory
wh("journey_feature_wall",28,44,52.5,.7,10.5,c=C["stone"]);box("journey_red_reveal",(29,52.08,43,52.2),.18,.15,C["red"])
for i,x in enumerate((30,34.2,38.4,42),1):box(f"journey_display_{i}",(x,52.1,x+2.7,52.22),3.2,4.2,C["screen"])
box("reception_desk",(30,44,42,47),3.5,0,C["stone"]);box("reception_accessible_counter",(30,44,33,47),2.85,0,C["stone"]);box("reception_monitor",(35.2,44,37,44.35),1.8,3.5,C["screen"]);terminal("building_directory",(49,24,51,29))
# passenger elevator
x1,y1,x2,y2=PASS;wh("passenger_south",x1,x2,y1,.65,H,c=C["core"]);wh("passenger_north",x1,x2,y2,.65,H,c=C["core"]);wv("passenger_east",x2,y1,y2,.65,H,c=C["core"]);wv("passenger_west",x1,y1,y2,.65,H,[(37,41)],C["core"]);box("passenger_door_left",(x1-.08,37,x1+.08,39),8.5,0,C["freight"]);box("passenger_door_right",(x1-.08,39,x1+.08,41),8.5,0,C["freight"])
# freight elevator
x1,y1,x2,y2=FREIGHT;wh("freight_north",x1,x2,y2-.325,.65,H,c=C["freight"]);wv("freight_west",x1+.325,y1,y2,.65,H,c=C["freight"]);wv("freight_east",x2,y1,y2,.65,H,c=C["freight"]);wh("freight_south",x1,x2,y1,.65,H,[(1.5,6.5)],C["freight"]);box("freight_door_left",(1.5,y1-.1,4,y1+.1),9,0,C["core"]);box("freight_door_right",(4,y1-.1,6.5,y1+.1),9,0,C["core"])
# stairs
wh("stair_b_south",8,18,54,.65,H,[(14,17)],C["core"]);wh("stair_b_north",8,18,71.675,.65,H,c=C["core"]);wv("stair_b_west",8,54,72,.65,H,c=C["core"]);wv("stair_b_east",18,54,72,.65,H,c=C["core"]);stair("stair_b",SB,3.9)
wh("stair_a_south",60,72,54,.65,H,[(61.5,64.5)],C["core"]);wh("stair_a_north",60,72,71.675,.65,H,c=C["core"]);wv("stair_a_west",60,54,72,.65,H,c=C["core"]);wv("stair_a_east",71.675,54,72,.65,H,c=C["core"]);stair("stair_a",SA,4.8)
box("stair_b_b1_access_barrier",(13.9,54.25,17.1,54.45),3,0,C["red"]);box("stair_a_b1_access_barrier",(61.4,54.25,64.6,54.45),3,0,C["red"])
# north support
wh("support_south",18,60,60,.5,H,[(20,23),(27.5,30.5),(35.5,38.5),(43.5,46.5),(51,53.5)],C["part"])
for x,y1,y2,n in[(26,60,70,"restroom_divider"),(34,60,72,"ops_divider"),(42,60,72,"it_divider"),(50,60,72,"service_divider"),(54,60,66,"janitor_east")]:wv(n,x,y1,y2,.5,H,c=C["part"])
wh("restroom_a_north",18,26,70,.5,H,c=C["part"]);wh("restroom_b_north",26,34,70,.5,H,c=C["part"])
for i,(x,y) in enumerate([(21,66),(29,66)],1):box(f"restroom_vanity_{i}",(x-1.4,61.2,x+1.4,62.2),2.8,0,C["stone"]);box(f"restroom_fixture_{i}",(x-.8,67.2,x+.8,69),1.5,0,[210,210,206,255])
box("mep_riser",MEP,H,0,[69,72,74,255])
for ix,x in enumerate((10,22,34,46,58,68),1):
 for iy,y in enumerate((8,20,32,46),1):
  if not(53<x<63 and 33<y<45):box(f"ceiling_light_{ix}_{iy}",(x-1.25,y-.14,x+1.25,y+.14),.08,10.55,C["light"])
box("red_wayfinding_spine",(18.3,53.72,59.7,53.82),.12,.08,C["red"])
S.metadata.update({"scene_id":"equity-uprise-floor-01","version":"core-v2-volumetric-v1","not_for_construction":True,"source_units":"feet","feet_to_meters":FT,"floor_identity":"Arrival / Orientation / Intake","render_mode":"architectural-cutaway","vertical_systems":{"passenger_elevator":PASS,"service_freight_elevator":FREIGHT,"stair_b":SB,"stair_a":SA,"mep_riser":MEP}})
data=S.export(file_type="glb");OUT.write_bytes(data)
checks=[];ext=(S.extents/FT).tolist()
def check(n,p,a=None,e=None):checks.append({"name":n,"passed":bool(p),"actual":a,"expected":e})
check("72ft building width",abs(ext[0]-72)<.05,ext[0],72);check("72ft building depth",abs(ext[1]-72)<.05,ext[1],72)
names=set(S.graph.nodes_geometry)
for r in["floor_slab","reception_desk","building_directory_plinth","passenger_door_left","freight_door_left","stair_b_flight1_01","stair_a_flight1_01","orientation_sofa_base","intake_meeting_table","passport_table_a","journey_feature_wall_1"]:check(r+" exists",r in names,r,"present")
failed=[x for x in checks if not x["passed"]]
report={"scene_id":"equity-uprise-floor-01","version":"core-v2-volumetric-v1","not_for_construction":True,"mesh_count":len(S.geometry),"glb_bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"bounds_m":S.bounds.tolist(),"extents_ft":ext,"checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
REPORT.write_text(json.dumps(report,indent=2)+"\n");print(json.dumps({k:report[k] for k in["mesh_count","glb_bytes","sha256","checks_passed","checks_total","passed"]},indent=2))
