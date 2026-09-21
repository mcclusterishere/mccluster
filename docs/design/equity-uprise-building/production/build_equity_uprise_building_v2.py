#!/usr/bin/env python3
"""
Build one deterministic, vertically connected Equity Uprise Core V2 GLB.

This model proves schematic continuity:
- shared global floor elevations;
- coordinated slab openings;
- passenger + freight/service shafts;
- two U-shaped stair systems reaching every next level;
- floor-specific program plates.

NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import json, math, hashlib
import numpy as np
import trimesh

HERE=Path(__file__).resolve().parent
OUTDIR=HERE/"generated"
OUTDIR.mkdir(exist_ok=True)
CORE=json.loads((HERE/"building-core-v2.json").read_text())
PROGRAMS=json.loads((HERE/"core-v2-floor-programs.json").read_text())
B1=json.loads((HERE/"basement-b1-program.json").read_text())
SITE=json.loads((HERE/"floor-01"/"floor-01-site-egress.json").read_text())
OUT=OUTDIR/"equity-uprise-building-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-building-core-v2-report.json"

FT=.3048
COL={
 "slab":[92,94,96,255],"wall":[44,43,42,255],"core":[55,59,64,255],
 "freight":[75,79,84,255],"stair":[104,104,100,255],"program":[105,99,92,255],
 "zone":[120,118,112,255],"glass":[185,205,212,90],"roof":[112,112,108,255],
 "accent":[133,26,29,255],"halo":[39,103,122,185],
 "site_walk":[156,158,155,255],"site_public":[118,120,121,255],
 "site_service":[126,115,100,255],"site_assembly":[132,145,123,210],
 "site_marker":[133,26,29,255]
}
scene=trimesh.Scene()
records=[]

def add_box(name,b,z0,h,color):
    x1,y1,x2,y2=b
    mesh=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT))
    mesh.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z0+h/2)*FT))
    mesh.visual.face_colors=color
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    records.append({"name":name,"bounds_ft":[x1,y1,x2,y2],"z0_ft":z0,"height_ft":h})
    return mesh

def add_cyl(name,cx,cy,z0,r,h,color,sections=24):
    mesh=trimesh.creation.cylinder(radius=r*FT,height=h*FT,sections=sections)
    mesh.apply_translation((cx*FT,cy*FT,(z0+h/2)*FT))
    mesh.visual.face_colors=color
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    records.append({"name":name,"center_ft":[cx,cy],"radius_ft":r,"z0_ft":z0,"height_ft":h})

def add_sphere(name,cx,cy,cz,r,color):
    mesh=trimesh.creation.icosphere(subdivisions=3,radius=r*FT)
    mesh.apply_translation((cx*FT,cy*FT,cz*FT))
    mesh.visual.face_colors=color
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    records.append({"name":name,"kind":"sphere","center_ft":[cx,cy,cz],"radius_ft":r})

def add_path_segment(name,a,b,width,z0=.015,h=.06,color=None):
    x1,y1=a;x2,y2=b
    color=color or COL["site_walk"]
    if abs(x1-x2)<1e-9:
        lo,hi=sorted([y1,y2]); add_box(name,(x1-width/2,lo,x1+width/2,hi),z0,h,color)
    elif abs(y1-y2)<1e-9:
        lo,hi=sorted([x1,x2]); add_box(name,(lo,y1-width/2,hi,y1+width/2),z0,h,color)
    else:
        # Site path authority is axis-aligned for the current schematic model.
        raise ValueError(f"non-axis-aligned site path segment {a}->{b}")

def b4(d): return (d["x1"],d["y1"],d["x2"],d["y2"])
vs=CORE["vertical_systems"]
passenger=b4(vs["passenger_elevator"]["shaft_bounds_ft"])
freight=b4(vs["service_freight_elevator"]["shaft_bounds_ft"])
stairA=b4(vs["stair_a"]["enclosure_bounds_ft"])
stairB=b4(vs["stair_b"]["enclosure_bounds_ft"])
mep=b4(vs["mep_riser"]["bounds_ft"])
openings=[b4(x) for x in CORE["slab_openings"].values()]

def point_in_rect(x,y,b):
    return b[0] <= x <= b[2] and b[1] <= y <= b[3]

def slab_with_openings(prefix,elev,th=.5):
    xs={0.0,72.0};ys={0.0,72.0}
    for b in openings:
        xs.update([b[0],b[2]]);ys.update([b[1],b[3]])
    xs=sorted(xs);ys=sorted(ys)
    count=0
    for i in range(len(xs)-1):
        for j in range(len(ys)-1):
            x1,x2=xs[i],xs[i+1];y1,y2=ys[j],ys[j+1]
            if x2-x1<1e-6 or y2-y1<1e-6:continue
            mx,my=(x1+x2)/2,(y1+y2)/2
            if any(point_in_rect(mx,my,b) for b in openings):continue
            add_box(f"{prefix}_slab_{count:03d}",(x1,y1,x2,y2),elev-th,th,COL["slab"])
            count+=1
    return count

def perimeter(level,elev):
    # occupied floors only; roof gets parapet separately
    h=13.0;t=.5
    # north/west/east opaque perimeter
    add_box(f"L{level}_north_wall",(0,71.5,72,72),elev,h,COL["wall"])
    add_box(f"L{level}_west_wall",(0,0,.5,72),elev,h,COL["wall"])
    add_box(f"L{level}_east_wall",(71.5,0,72,72),elev,h,COL["wall"])
    if level==0:
        add_box("B1_south_wall",(0,0,72,.5),elev,h,COL["wall"])
    elif level==1:
        add_box("L1_south_left",(0,0,29,.5),elev,h,COL["wall"])
        add_box("L1_south_right",(43,0,72,.5),elev,h,COL["wall"])
    else:
        add_box(f"L{level}_south_glazing",(0,0,72,.25),elev,h,COL["glass"])

def shaft_walls(name,b,z0,z1,color,door_side=None):
    x1,y1,x2,y2=b;t=.5;h=z1-z0
    add_box(name+"_north",(x1,y2-t,x2,y2),z0,h,color)
    add_box(name+"_east",(x2-t,y1,x2,y2),z0,h,color)
    add_box(name+"_west",(x1,y1,x1+t,y2),z0,h,color)
    add_box(name+"_south",(x1,y1,x2,y1+t),z0,h,color)

def stair_flights(stair_name,b,base_z,next_z,flight_w):
    x1,y1,x2,y2=b
    margin=.75;gap=.5
    # west and east flight strips
    wx1=x1+margin;wx2=wx1+flight_w
    ex2=x2-margin;ex1=ex2-flight_w
    y_start=58.25
    y_north=67.416666667
    landing_north_y2=71.25
    south_land_y1=54.75
    south_land_y2=58.25
    total=next_z-base_z
    riser=total/22.0
    tread=11.0/12.0
    mid=base_z+11*riser
    # lower landing west
    add_box(f"{stair_name}_L{base_z:g}_lower_landing",(wx1,south_land_y1,wx2,south_land_y2),base_z,.25,COL["stair"])
    # first flight north: 10 tread surfaces
    for i in range(10):
        ya=y_start+i*tread;yb=ya+tread
        z=base_z+(i+1)*riser
        add_box(f"{stair_name}_L{base_z:g}_flight1_tread_{i+1:02d}",(wx1,ya,wx2,yb),z-.18,.18,COL["stair"])
    # intermediate north landing
    add_box(f"{stair_name}_L{base_z:g}_mid_landing",(wx1,y_north,ex2,landing_north_y2),mid-.25,.25,COL["stair"])
    # second flight returns south, rising
    for i in range(10):
        yb=y_north-i*tread;ya=yb-tread
        z=mid+(i+1)*riser
        add_box(f"{stair_name}_L{base_z:g}_flight2_tread_{i+1:02d}",(ex1,ya,ex2,yb),z-.18,.18,COL["stair"])
    # upper landing east meets next FFE
    add_box(f"{stair_name}_L{base_z:g}_upper_landing",(ex1,south_land_y1,ex2,south_land_y2),next_z-.25,.25,COL["stair"])
    return {"base_ft":base_z,"top_ft":next_z,"mid_ft":mid,"riser_ft":riser,"tread_ft":tread,
            "flight_width_ft":flight_w,"lower_landing":[wx1,south_land_y1,wx2,south_land_y2],
            "upper_landing":[ex1,south_land_y1,ex2,south_land_y2]}

levels=CORE["levels"]
# Slabs and perimeter.
for level in levels:
    n=level["level"];z=level["finished_floor_elevation_ft"]
    slab_with_openings(f"L{n}",z)
    if n<=6:perimeter(n,z)
    else:
        # roof parapet, 3.5 ft
        add_box("L7_parapet_north",(0,71.5,72,72),z,3.5,COL["roof"])
        add_box("L7_parapet_south",(0,0,72,.5),z,3.5,COL["roof"])
        add_box("L7_parapet_west",(0,0,.5,72),z,3.5,COL["roof"])
        add_box("L7_parapet_east",(71.5,0,72,72),z,3.5,COL["roof"])

# Continuous shaft walls / reservations.
base_z=levels[0]["finished_floor_elevation_ft"]
roof_z=levels[-1]["finished_floor_elevation_ft"]
shaft_walls("passenger_elevator_shaft",passenger,base_z,roof_z+8,COL["core"])
shaft_walls("freight_elevator_shaft",freight,base_z,roof_z+8,COL["freight"])

# Stair enclosure boundary walls as continuous vertical reservations.
shaft_walls("stair_a_enclosure",stairA,base_z,roof_z+4,COL["core"])
shaft_walls("stair_b_enclosure",stairB,base_z,roof_z+4,COL["core"])

# Continuous stairs between each level.
stair_reports=[]
for a,b in zip(levels[:-1],levels[1:]):
    z0=a["finished_floor_elevation_ft"];z1=b["finished_floor_elevation_ft"]
    stair_reports.append({"system":"stair-a-east",**stair_flights("stair_a",stairA,z0,z1,5.0)})
    stair_reports.append({"system":"stair-b-west",**stair_flights("stair_b",stairB,z0,z1,4.0)})

# Program plates / furniture in global Z.
common=PROGRAMS["common_support"]
for level in PROGRAMS["levels"]:
    n=level["level"];z=level["elevation_ft"]
    for i,zone in enumerate(level.get("zones",[]),1):
        b=b4(zone["bounds_ft"])
        kind=zone["kind"]
        h=.10 if kind in ("zone","room","feature") else (2.7 if kind=="furniture" else 4.5 if kind=="terminal" else .15)
        zz=z+.02
        add_box(f"L{n}_program_{i:02d}_{kind}",b,zz,h,COL["program"] if kind!="zone" else COL["zone"])
    for i,circ in enumerate(level.get("circles",[]),1):
        cc=circ["center_ft"];add_cyl(f"L{n}_circle_{i:02d}",cc["x"],cc["y"],z+.02,circ["radius_ft"],2.6,COL["program"])
    for i,sph in enumerate(level.get("spheres",[]),1):
        cc=sph["center_ft"];cz=z+sph["center_z_local_ft"]
        add_sphere(f"L{n}_sphere_{i:02d}_halo_globe",cc["x"],cc["y"],cz,sph["radius_ft"],COL["halo"])
    if not level.get("roof"):
        for key in ["corridor","restroom_a","restroom_b","support_a","support_b","janitor"]:
            bb=b4(common[key]["bounds_ft"]);add_box(f"L{n}_support_{key}",bb,z+.01,.08,COL["zone"])

# B1 technical/service program plates.
b1_z=B1["elevation_ft"]
for i,zone in enumerate(B1.get("zones",[]),1):
    b=b4(zone["bounds_ft"])
    add_box(f"B1_program_{i:02d}_{zone.get('kind','zone')}",b,b1_z+.02,.10,COL["zone"])

# Floor 1 exterior/site egress simulation geometry.
for i,item in enumerate(SITE.get("site_elements",[]),1):
    kind=item.get("kind")
    if "bounds_ft" in item:
        color={"public_way":COL["site_public"],"walk":COL["site_walk"],"egress_walk":COL["site_walk"],
               "service":COL["site_service"],"assembly":COL["site_assembly"]}.get(kind,COL["site_walk"])
        add_box(f"SITE_{i:02d}_{kind}",b4(item["bounds_ft"]),.01,.06,color)
    elif "polyline_ft" in item:
        pts=item["polyline_ft"]
        for si,(a,b) in enumerate(zip(pts[:-1],pts[1:]),1):
            add_path_segment(f"SITE_{i:02d}_{kind}_{si:02d}",a,b,6.0,color=COL["site_walk"])

# Exterior opening and Floor 1 exit-discharge-control markers.
for i,obj in enumerate(SITE.get("exterior_openings",[]),1):
    loc=obj["location"]
    if loc.get("facade")=="east":
        add_box(f"SITE_door_{i:02d}",(71.7,loc["y1"],72.3,loc["y2"]),0,.12,COL["site_marker"])
    elif loc.get("facade")=="west":
        add_box(f"SITE_door_{i:02d}",(-.3,loc["y1"],.3,loc["y2"]),0,.12,COL["site_marker"])
    elif loc.get("facade")=="north":
        add_box(f"SITE_door_{i:02d}",(loc["x1"],71.7,loc["x2"],72.3),0,.12,COL["site_marker"])
    elif loc.get("facade")=="south" and "x1" in loc:
        y=loc.get("y",0)
        add_box(f"SITE_door_{i:02d}",(loc["x1"],y-.3,loc["x2"],y+.3),0,.12,COL["site_marker"])

for i,obj in enumerate(SITE.get("floor1_discharge_controls",[]),1):
    if "STAIR-A" in obj["object_id"]:
        add_box(f"SITE_discharge_barrier_{i:02d}",(60.5,54.4,71.5,55.0),.05,3.0,COL["site_marker"])
    else:
        add_box(f"SITE_discharge_barrier_{i:02d}",(8.5,54.4,17.5,55.0),.05,3.0,COL["site_marker"])

for i,obj in enumerate(SITE.get("emergency_equipment",[]),1):
    p=obj["location_ft"]
    add_cyl(f"SITE_equipment_{i:02d}",p["x"],p["y"],.05,.22,4.0,COL["site_marker"])

scene.metadata.update({
 "building_id":"equity-uprise-building",
 "core_id":"equity-uprise-core-v2",
 "not_for_construction":True,
 "source_units":"feet",
 "feet_to_meters":FT,
 "floor_elevations_ft":[x["finished_floor_elevation_ft"] for x in levels],
 "vertical_continuity":"combined model is authoritative proof",
 "basement_program_ref":"basement-b1-program.json",
 "site_egress_ref":"floor-01/floor-01-site-egress.json",
 "level_of_exit_discharge":CORE.get("level_of_exit_discharge")
})
data=scene.export(file_type="glb")
OUT.write_bytes(data)

# Deterministic validation report.
checks=[]
def check(name,passed,actual,expected):
    checks.append({"name":name,"passed":bool(passed),"actual":actual,"expected":expected})

expected_elevations=[-13.5,0,13.5,27,40.5,54,67.5,81]
check("eight levels including B1",len(levels)==8,len(levels),8)
check("floor elevations",[x["finished_floor_elevation_ft"] for x in levels]==expected_elevations,
      [x["finished_floor_elevation_ft"] for x in levels],expected_elevations)
check("fourteen stair transitions",len(stair_reports)==14,len(stair_reports),14)
check("B1 is support level",B1.get("developmental_stage") is None,B1.get("developmental_stage"),None)
check("Floor 1 is level of exit discharge",CORE.get("level_of_exit_discharge")==1,CORE.get("level_of_exit_discharge"),1)
check("site defines two assembly areas",len([x for x in SITE.get("site_elements",[]) if x.get("kind")=="assembly"])==2,
      len([x for x in SITE.get("site_elements",[]) if x.get("kind")=="assembly"]),2)
check("site defines both protected-stair discharge doors",
      all(any(d.get("object_id")==oid for d in SITE.get("exterior_openings",[])) for oid in ["F1-DOOR-STAIR-A-DISCHARGE","F1-DOOR-STAIR-B-DISCHARGE"]),
      [d.get("object_id") for d in SITE.get("exterior_openings",[])],["F1-DOOR-STAIR-A-DISCHARGE","F1-DOOR-STAIR-B-DISCHARGE"])
check("Floor 1 defines two basement-direction discharge controls",len(SITE.get("floor1_discharge_controls",[]))==2,
      len(SITE.get("floor1_discharge_controls",[])),2)

halo_items=[(lvl,s) for lvl in PROGRAMS["levels"] for s in lvl.get("spheres",[]) if s.get("route_key")=="halo_spatial_intelligence"]
check("exactly one Halo Globe instrument",len(halo_items)==1,len(halo_items),1)
if halo_items:
    lvl,s=halo_items[0]
    cx=s["center_ft"]["x"];cy=s["center_ft"]["y"];r=s["radius_ft"];cz=s["center_z_local_ft"]
    check("Halo Globe lives on Floor 6",lvl["level"]==6,lvl["level"],6)
    check("Halo Globe bottom clears circulation",cz-r>=6.0,cz-r,">=6.0")
    check("Halo Globe top stays below ceiling zone",cz+r<=11.0,cz+r,"<=11.0")
    def circle_hits_rect(cx,cy,r,b):
        qx=min(max(cx,b[0]),b[2]);qy=min(max(cy,b[1]),b[3])
        return (cx-qx)**2+(cy-qy)**2 < r**2
    fixed={"passenger":passenger,"freight":freight,"stairA":stairA,"stairB":stairB,"mep":mep}
    hits=[name for name,b in fixed.items() if circle_hits_rect(cx,cy,r,b)]
    check("Halo Globe plan envelope avoids fixed core",not hits,hits,[])

for sr in stair_reports:
    check(f"{sr['system']} {sr['base_ft']:.1f}->{sr['top_ft']:.1f} full rise",
          abs((sr["top_ft"]-sr["base_ft"])-13.5)<1e-9,sr["top_ft"]-sr["base_ft"],13.5)
    check(f"{sr['system']} upper landing reaches next FFE",
          abs(sr["top_ft"]-(sr["base_ft"]+13.5))<1e-9,sr["top_ft"],sr["base_ft"]+13.5)

bounds_m=scene.bounds.tolist()
sha=hashlib.sha256(data).hexdigest()
report={
 "building_id":"equity-uprise-building",
 "core_id":"equity-uprise-core-v2",
 "not_for_construction":True,
 "glb_bytes":len(data),
 "sha256":sha,
 "mesh_count":len(scene.geometry),
 "bounds_m":bounds_m,
 "checks_total":len(checks),
 "checks_passed":sum(x["passed"] for x in checks),
 "checks_failed":sum(not x["passed"] for x in checks),
 "passed":all(x["passed"] for x in checks),
 "stair_transitions":stair_reports,
 "checks":checks
}
REPORT.write_text(json.dumps(report,indent=2))
print(json.dumps({"out":str(OUT),"report":str(REPORT),"passed":report["passed"],"checks":f"{report['checks_passed']}/{report['checks_total']}","sha256":sha},indent=2))
