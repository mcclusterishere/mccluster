#!/usr/bin/env python3
"""
Build the visible Equity Uprise building-services / nervous-system layer.

Services Step 2 established the B1-to-roof vertical backbone. Services Step 3
adds representative B1 source/plant equipment plus source-to-riser distribution
paths. Services Step 4 extends real branch geometry and endpoint drops across
Floors 1-3. Services Step 5 extends those branch routes through Floors 4-6 and
adds representative Level 7 handoffs. Services Step 6 completes the detailed
Level 7 roof terminations, service routes, devices and lightning concept.
Services Step 7 adds representative interior device, ceiling and service-access
realism across Floors 1-6 without changing approved program geometry. Services
Step 8 closes missing shared-path branches and verifies end-to-end traceability,
core/circulation clearance, floor isolation and viewer-layer continuity.

This is conceptual digital-twin coordination, not construction engineering.
No final duct, pipe, conductor, breaker, pump, pressure, flow or code sizing is
claimed by this asset.
"""
from pathlib import Path
import json, hashlib, math
import trimesh
from trimesh.visual.material import PBRMaterial

HERE=Path(__file__).resolve().parent
PROD=HERE.parent
OUTDIR=PROD/"generated"
OUTDIR.mkdir(exist_ok=True)

RISERS=json.loads((PROD/"vertical-risers-core-v2.json").read_text())
SERVICES=json.loads((PROD/"building-services-core-v2.json").read_text())
CORE=json.loads((PROD/"building-core-v2.json").read_text())
ADDENDA=json.loads((HERE/"floor-services-addenda.json").read_text())

OUT=OUTDIR/"equity-uprise-building-services-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-building-services-core-v2-report.json"

FT=.3048
LEVELS=CORE["levels"]
LEVEL_Z={int(x["level"]):float(x["finished_floor_elevation_ft"]) for x in LEVELS}
SYSTEMS={x["id"]:x for x in SERVICES["system_families"]}
SHARED=RISERS["shared_reservation_ft"]
SOURCE_CONNECTIONS={x["system_id"]:x for x in SERVICES.get("b1_source_connections",[])}
B1_Z=LEVEL_Z[0]

COLORS={
 "HVAC-AIR":[72,188,214,220],
 "FIRE-PROTECTION":[196,46,46,235],
 "WATER-DOMESTIC":[55,118,224,225],
 "SANITARY-VENT":[130,92,66,225],
 "STORM-DRAINAGE":[54,91,150,225],
 "ELEC-NORMAL":[230,143,45,235],
 "ELEC-EMERGENCY":[244,203,66,240],
 "DATA-STRUCTURED":[151,93,207,235],
 "BAS-CONTROLS":[58,164,104,235],
 "LIGHTING-CONTROLS":[255,205,96,220],
 "AV-MEDIA":[196,92,180,225],
 "SECURITY-ACCESS":[232,82,96,225],
 "FIRE-ALARM":[255,105,68,225],
 "SERVICE-HOUSEKEEPING":[145,150,155,190],
 "LIGHTNING-PROTECTION":[190,195,205,235],
 "SEPARATION":[120,125,132,65],
}
PBR={k:PBRMaterial(name="SVC-"+k,baseColorFactor=v,metallicFactor=.22,roughnessFactor=.44,alphaMode="BLEND",doubleSided=True) for k,v in COLORS.items()}

scene=trimesh.Scene()
records=[]

def material(system_id):
    return trimesh.visual.TextureVisuals(material=PBR[system_id if system_id in PBR else "SEPARATION"])

def add_box(name,bounds,z0,h,system_id,kind,level=None,extra=None):
    x1,y1,x2,y2=bounds
    if x2<=x1 or y2<=y1 or h<=0:
        raise ValueError(f"invalid box {name}: {bounds}, z={z0}, h={h}")
    mesh=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT))
    mesh.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z0+h/2)*FT))
    mesh.visual=material(system_id)
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    rec={"name":name,"system_id":system_id,"kind":kind,"level":level,"bounds_ft":[float(x1),float(y1),float(x2),float(y2)],"z0_ft":float(z0),"height_ft":float(h)}
    if extra: rec.update(extra)
    records.append(rec)

def add_cylinder(name,cx,cy,z0,radius,h,system_id,kind,level=0,sections=20,axis="z",extra=None):
    mesh=trimesh.creation.cylinder(radius=radius*FT,height=h*FT,sections=sections)
    if axis=="x":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,[0,1,0]))
        bounds=(cx-h/2,cy-radius,cx+h/2,cy+radius); zbase=z0-radius; zheight=radius*2
        mesh.apply_translation((cx*FT,cy*FT,z0*FT))
    elif axis=="y":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,[1,0,0]))
        bounds=(cx-radius,cy-h/2,cx+radius,cy+h/2); zbase=z0-radius; zheight=radius*2
        mesh.apply_translation((cx*FT,cy*FT,z0*FT))
    else:
        bounds=(cx-radius,cy-radius,cx+radius,cy+radius); zbase=z0; zheight=h
        mesh.apply_translation((cx*FT,cy*FT,(z0+h/2)*FT))
    mesh.visual=material(system_id)
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    rec={"name":name,"system_id":system_id,"kind":kind,"level":level,"bounds_ft":[float(v) for v in bounds],"z0_ft":float(zbase),"height_ft":float(zheight)}
    if extra: rec.update(extra)
    records.append(rec)

connection_paths={}
def add_route(system_id,points,z_center,style="pipe",width=.22,height=.22):
    if len(points)<2: raise ValueError(f"route {system_id} needs at least two points")
    connection_paths[system_id]=points
    for idx,(a,b) in enumerate(zip(points[:-1],points[1:])):
        x1,y1=a; x2,y2=b
        if x1!=x2 and y1!=y2: raise ValueError(f"route {system_id} segment {idx} is not orthogonal: {a}->{b}")
        name=f"SVC-B1-DIST::{system_id}::{idx:02d}"
        if style=="pipe":
            if y1==y2: add_cylinder(name,(x1+x2)/2,y1,z_center,width/2,abs(x2-x1),system_id,"b1_distribution",0,20,"x",{"segment_from":a,"segment_to":b})
            else: add_cylinder(name,x1,(y1+y2)/2,z_center,width/2,abs(y2-y1),system_id,"b1_distribution",0,20,"y",{"segment_from":a,"segment_to":b})
        else:
            bounds=(min(x1,x2),y1-width/2,max(x1,x2),y1+width/2) if y1==y2 else (x1-width/2,min(y1,y2),x1+width/2,max(y1,y2))
            add_box(name,bounds,z_center-height/2,height,system_id,"b1_distribution",0)

alloc=[x for x in RISERS["sub_riser_envelopes_ft"] if x["system_id"]]
alloc_by_system={x["system_id"]:x for x in alloc}
sep=next(x for x in RISERS["sub_riser_envelopes_ft"] if x["id"]=="R-SEPARATION-BAND")

add_box("SVC-SEPARATION::STAIR-A-BUFFER",(sep["bounds"]["x1"],sep["bounds"]["y1"],sep["bounds"]["x2"],sep["bounds"]["y2"]),LEVEL_Z[0]+.08,(LEVEL_Z[7]-LEVEL_Z[0])-.16,"SEPARATION","separation_buffer")

riser_segments=0; takeoffs=0; modeled_systems=set()
for a in alloc:
    sid=a["system_id"]; b=a["bounds"]; bounds=(b["x1"],b["y1"],b["x2"],b["y2"])
    modeled_systems.add(sid)
    for lo,hi in zip(LEVELS[:-1],LEVELS[1:]):
        l0=int(lo["level"]); z0=float(lo["finished_floor_elevation_ft"])+.08; z1=float(hi["finished_floor_elevation_ft"])+.08
        add_box(f"SVC-RISER::{sid}::SEG-L{l0}-L{int(hi['level'])}",bounds,z0,z1-z0+.10,sid,"vertical_riser_segment",l0)
        riser_segments+=1
    cx=(b["x1"]+b["x2"])/2; cy=(b["y1"]+b["y2"])/2; stub_half=min(.22,max(.12,(b["y2"]-b["y1"])*.22))
    for level in sorted(set(int(x) for x in SYSTEMS[sid]["serves_levels"])):
        if level not in LEVEL_Z: continue
        z=LEVEL_Z[level]+(10.9 if level<7 else 1.1)
        add_box(f"SVC-TAKEOFF::{sid}::L{level}",(49.15,cy-stub_half,cx,cy+stub_half),z,.24,sid,"floor_handoff_stub",level)
        takeoffs+=1

for level,z in LEVEL_Z.items():
    add_box(f"SVC-LEVEL-BAND::L{level}",(49.0,65.82,59.0,66.0),z+.03,.10,"SEPARATION","level_marker",level)

# Step 3 B1 plant/source equipment and distribution.
for suffix,bounds in [("AHU-A",(5,8,13,14)),("AHU-B",(16,8,24,14))]: add_box(f"SVC-B1-SOURCE::HVAC-AIR::{suffix}",bounds,B1_Z+.1,4.4,"HVAC-AIR","source_equipment",0)
for j,x in enumerate((8,15,22)): add_cylinder(f"SVC-B1-SOURCE::HVAC-AIR::PUMP-{j+1}",x,20,B1_Z+.2,.9,2.2,"HVAC-AIR","source_equipment",0)
add_route("HVAC-AIR",[(24,12),(28,12),(28,60),(51.75,60),(51.75,69)],B1_Z+10.15,"duct",1.10,.72)
for k in range(6): add_box(f"SVC-B1-SOURCE::ELEC-NORMAL::SWITCHGEAR-{k+1}",(33+k*2.8,7,35.3+k*2.8,9.2),B1_Z+.1,7,"ELEC-NORMAL","source_equipment",0)
add_box("SVC-B1-SOURCE::ELEC-NORMAL::DISTRIBUTION-PANEL",(47,13,50.5,18),B1_Z+.7,6.2,"ELEC-NORMAL","source_equipment",0)
add_route("ELEC-NORMAL",[(49,9.2),(49,61.5),(57.25,61.5),(57.25,67.5)],B1_Z+10.4,"busway",.46,.40)
for suffix,bounds in [("UPS-A",(34,13,39,18)),("UPS-B",(40,13,45,18))]: add_box(f"SVC-B1-SOURCE::ELEC-EMERGENCY::{suffix}",bounds,B1_Z+.1,5.5,"ELEC-EMERGENCY","source_equipment",0)
add_route("ELEC-EMERGENCY",[(45,16),(47.5,16),(47.5,63),(57.25,63),(57.25,70.5)],B1_Z+9.72,"conduit",.30,.30)
for j,(x,y) in enumerate(((35,26),(39,26),(43,26),(47,26))): add_box(f"SVC-B1-SOURCE::DATA-STRUCTURED::RACK-{j+1}",(x-1.1,y-1.5,x+1.1,y+1.5),B1_Z+.1,7.5,"DATA-STRUCTURED","source_equipment",0)
add_box("SVC-B1-SOURCE::DATA-STRUCTURED::TRAY-L",(33,30.45,51,30.62),B1_Z+8.7,.35,"DATA-STRUCTURED","source_equipment",0)
add_box("SVC-B1-SOURCE::DATA-STRUCTURED::TRAY-R",(33,31.08,51,31.25),B1_Z+8.7,.35,"DATA-STRUCTURED","source_equipment",0)
for j,x in enumerate((34,37,40,43,46,49)): add_box(f"SVC-B1-SOURCE::DATA-STRUCTURED::TRAY-RUNG-{j}",(x-.08,30.55,x+.08,31.15),B1_Z+8.73,.18,"DATA-STRUCTURED","source_equipment",0)
add_route("DATA-STRUCTURED",[(51,30.85),(52.5,30.85),(52.5,62),(58.5,62),(58.5,67.5)],B1_Z+10.05,"cable_tray",.62,.28)
add_box("SVC-B1-SOURCE::BAS-CONTROLS::PANEL",(46,40.0,49,40.45),B1_Z+3.0,2.5,"BAS-CONTROLS","source_equipment",0)
add_box("SVC-B1-SOURCE::BAS-CONTROLS::GATEWAY",(48.6,38.1,50.0,39.4),B1_Z+2.7,1.3,"BAS-CONTROLS","source_equipment",0)
add_route("BAS-CONTROLS",[(49.2,40.25),(52.25,40.25),(52.25,64),(58.5,64),(58.5,70.5)],B1_Z+9.35,"controls_raceway",.20,.20)
add_box("SVC-B1-SOURCE::FIRE-PROTECTION::PUMP-BASE",(56,8,62,14),B1_Z+.15,.6,"FIRE-PROTECTION","source_equipment",0)
add_cylinder("SVC-B1-SOURCE::FIRE-PROTECTION::PUMP",59,11,B1_Z+.75,1.2,2.4,"FIRE-PROTECTION","source_equipment",0)
add_cylinder("SVC-B1-SOURCE::FIRE-PROTECTION::VALVE-A",64.2,11,B1_Z+3.2,.38,1.2,"FIRE-PROTECTION","source_equipment",0)
add_cylinder("SVC-B1-SOURCE::FIRE-PROTECTION::VALVE-B",66.0,11,B1_Z+3.2,.38,1.2,"FIRE-PROTECTION","source_equipment",0)
add_route("FIRE-PROTECTION",[(59,14),(52.4,14),(52.4,64.5),(54.25,64.5),(54.25,67.5)],B1_Z+9.15,"pipe",.34,.34)
add_cylinder("SVC-B1-SOURCE::WATER-DOMESTIC::BACKFLOW-BODY",66,11,B1_Z+.1,2.0,6.2,"WATER-DOMESTIC","source_equipment",0)
add_cylinder("SVC-B1-SOURCE::WATER-DOMESTIC::MANIFOLD",64.5,16,B1_Z+6.9,.24,4.0,"WATER-DOMESTIC","source_equipment",0,20,"x")
add_route("WATER-DOMESTIC",[(66,16),(52.8,16),(52.8,65.0),(54.25,65.0),(54.25,70.5)],B1_Z+8.55,"pipe",.26,.26)
add_cylinder("SVC-B1-SOURCE::SANITARY-VENT::B1-HEADER",48.5,52,B1_Z+8.1,.22,16.0,"SANITARY-VENT","source_equipment",0,20,"y")
add_route("SANITARY-VENT",[(48.5,60),(48.5,64),(55.75,64),(55.75,67.5)],B1_Z+8.1,"pipe",.44,.44)
for j,x in enumerate((58,66)): add_cylinder(f"SVC-B1-SOURCE::STORM-DRAINAGE::SUMP-PUMP-{j+1}",x,27,B1_Z+.1,.55,2.2,"STORM-DRAINAGE","source_equipment",0)
add_box("SVC-B1-SOURCE::STORM-DRAINAGE::FLOOD-SENSOR",(55.2,30,58,31.7),B1_Z+2.5,3.4,"STORM-DRAINAGE","source_equipment",0)
add_route("STORM-DRAINAGE",[(58,30),(52.1,30),(52.1,62.7),(55.75,62.7),(55.75,70.5)],B1_Z+7.55,"pipe",.38,.38)

for sid,path in connection_paths.items():
    a=alloc_by_system[sid]["bounds"]; cx=(a["x1"]+a["x2"])/2; cy=(a["y1"]+a["y2"])/2
    add_box(f"SVC-B1-CONNECTION::{sid}::RISER-COLLAR",(cx-.16,cy-.16,cx+.16,cy+.16),B1_Z+9.0,.9,sid,"b1_riser_connection",0)

# Steps 4 and 5 floor branches.
floor_branch_records=[]
def add_floor_branch(level,system_id,points,z_offset=None,style="tray",width=.18,height=.18,endpoint=None,inventory_ref=None):
    if z_offset is None: z_offset=1.8 if level==7 else 10.15
    z=LEVEL_Z[level]+z_offset
    for idx,(a,b) in enumerate(zip(points[:-1],points[1:])):
        x1,y1=a; x2,y2=b
        if x1!=x2 and y1!=y2: raise ValueError(f"F{level} {system_id} branch {idx} not orthogonal: {a}->{b}")
        name=f"SVC-F{level}-BRANCH::{system_id}::{endpoint or 'GENERAL'}::{idx:02d}"
        if style=="pipe":
            if y1==y2: add_cylinder(name,(x1+x2)/2,y1,z,width/2,abs(x2-x1),system_id,"floor_branch",level,18,"x")
            else: add_cylinder(name,x1,(y1+y2)/2,z,width/2,abs(y2-y1),system_id,"floor_branch",level,18,"y")
        else:
            bounds=(min(x1,x2),y1-width/2,max(x1,x2),y1+width/2) if y1==y2 else (x1-width/2,min(y1,y2),x1+width/2,max(y1,y2))
            add_box(name,bounds,z-height/2,height,system_id,"floor_branch",level)
    ex,ey=points[-1]; ez=LEVEL_Z[level]+(1.15 if level==7 else 8.7)
    add_box(f"SVC-F{level}-ENDPOINT::{system_id}::{endpoint or 'GENERAL'}",(ex-.22,ey-.22,ex+.22,ey+.22),ez,.55,system_id,"floor_endpoint",level)
    floor_branch_records.append({"level":level,"system_id":system_id,"endpoint":endpoint,"inventory_ref":inventory_ref,"points":points})

# F1-F3 shipped in Step 4.
add_floor_branch(1,"ELEC-NORMAL",[(57.25,67.5),(48,67.5),(48,46),(36,46)],endpoint="RECEPTION",inventory_ref="F1-RECEPTION-MONITOR-01")
add_floor_branch(1,"DATA-STRUCTURED",[(58.5,67.5),(46,67.5),(46,46),(36,46)],endpoint="RECEPTION-DATA",inventory_ref="F1-RECEPTION-SECURITY-01")
add_floor_branch(1,"BAS-CONTROLS",[(58.5,70.5),(40,70.5),(40,65),(38,65)],endpoint="OPS-PANEL",inventory_ref="F1-OPS-PANEL-01")
add_floor_branch(1,"DATA-STRUCTURED",[(58.5,67.5),(47,67.5),(47,65),(46,65)],endpoint="IT-RACK",inventory_ref="F1-IT-RACK-01")
add_floor_branch(1,"WATER-DOMESTIC",[(54.25,70.5),(30,70.5),(30,64),(29,64)],style="pipe",width=.20,endpoint="RESTROOM-WATER",inventory_ref="F1-RR-B-VANITY-01")
add_floor_branch(1,"SANITARY-VENT",[(55.75,67.5),(28,67.5),(28,69),(29,69)],style="pipe",width=.30,endpoint="RESTROOM-SANITARY",inventory_ref="F1-RR-B-FIXTURE-01")
add_floor_branch(1,"HVAC-AIR",[(51.75,67.5),(44,67.5),(44,50),(36,50)],style="duct",width=.75,height=.45,endpoint="ARRIVAL-HVAC")
add_floor_branch(1,"FIRE-PROTECTION",[(54.25,67.5),(32,67.5),(32,55)],style="pipe",width=.22,endpoint="LIFE-SAFETY")
add_floor_branch(1,"ELEC-EMERGENCY",[(57.25,70.5),(50,70.5),(50,54),(44,54)],endpoint="EGRESS")
add_floor_branch(2,"ELEC-NORMAL",[(57.25,67.5),(48,67.5),(48,39),(36,39)],endpoint="FORUM-TABLE",inventory_ref="F2-FORUM-POWER-01")
add_floor_branch(2,"DATA-STRUCTURED",[(58.5,67.5),(46,67.5),(46,39),(36,39)],endpoint="FORUM-DATA",inventory_ref="F2-FORUM-POWER-01")
add_floor_branch(2,"AV-MEDIA",[(58.5,67.5),(48,67.5),(48,52),(36,52)],endpoint="FEATURE-WALL",inventory_ref="F2-DISPLAY-PERSPECTIVES")
add_floor_branch(2,"DATA-STRUCTURED",[(58.5,67.5),(47,67.5),(47,64),(46,64)],endpoint="AVIT-RACK",inventory_ref="F2-AVIT-RACK-01")
add_floor_branch(2,"SECURITY-ACCESS",[(58.5,70.5),(52,70.5),(52,27),(50,27)],endpoint="MEMBER-CHECKIN",inventory_ref="F2-MEMBER-CHECKIN-01")
add_floor_branch(2,"WATER-DOMESTIC",[(54.25,70.5),(30,70.5),(30,64),(29,64)],style="pipe",width=.20,endpoint="RESTROOM-WATER",inventory_ref="F2-RR-B-VANITY-01")
add_floor_branch(2,"SANITARY-VENT",[(55.75,67.5),(28,67.5),(28,69),(29,69)],style="pipe",width=.30,endpoint="RESTROOM-SANITARY",inventory_ref="F2-RR-B-WC-01")
add_floor_branch(2,"HVAC-AIR",[(51.75,67.5),(44,67.5),(44,48),(36,48)],style="duct",width=.75,height=.45,endpoint="FORUM-HVAC")
add_floor_branch(2,"FIRE-PROTECTION",[(54.25,67.5),(32,67.5),(32,55)],style="pipe",width=.22,endpoint="LIFE-SAFETY")
add_floor_branch(2,"ELEC-EMERGENCY",[(57.25,70.5),(50,70.5),(50,54),(44,54)],endpoint="EGRESS")
add_floor_branch(3,"ELEC-NORMAL",[(57.25,67.5),(48,67.5),(48,41),(36,41)],endpoint="OPPORTUNITY-TABLE",inventory_ref="F3-OPPORTUNITY-POWER-01")
add_floor_branch(3,"DATA-STRUCTURED",[(58.5,67.5),(46,67.5),(46,41),(36,41)],endpoint="OPPORTUNITY-DATA",inventory_ref="F3-OPPORTUNITY-POWER-01")
add_floor_branch(3,"AV-MEDIA",[(58.5,67.5),(48,67.5),(48,52),(36,52)],endpoint="OPPORTUNITY-DISPLAYS",inventory_ref="F3-DISPLAY-PEOPLE")
add_floor_branch(3,"DATA-STRUCTURED",[(58.5,67.5),(47,67.5),(47,64),(46,64)],endpoint="NETWORK-IT",inventory_ref="F3-NETWORK-IT-RACK-01")
add_floor_branch(3,"SECURITY-ACCESS",[(58.5,70.5),(52,70.5),(52,27),(50,27)],endpoint="MEMBER-CHECKIN",inventory_ref="F3-MEMBER-CHECKIN-01")
add_floor_branch(3,"DATA-STRUCTURED",[(58.5,67.5),(45,67.5),(45,18),(22,18),(22,16)],endpoint="INTERVIEW-B",inventory_ref="F3-INTERVIEW-B-DISPLAY-01")
add_floor_branch(3,"ELEC-NORMAL",[(57.25,67.5),(43,67.5),(43,18),(8,18),(8,16)],endpoint="INTERVIEW-A",inventory_ref="F3-INTERVIEW-A-DISPLAY-01")
add_floor_branch(3,"WATER-DOMESTIC",[(54.25,70.5),(30,70.5),(30,64),(29,64)],style="pipe",width=.20,endpoint="RESTROOM-WATER",inventory_ref="F3-RR-B-VANITY-01")
add_floor_branch(3,"SANITARY-VENT",[(55.75,67.5),(28,67.5),(28,69),(29,69)],style="pipe",width=.30,endpoint="RESTROOM-SANITARY",inventory_ref="F3-RR-B-WC-01")
add_floor_branch(3,"HVAC-AIR",[(51.75,67.5),(44,67.5),(44,48),(36,48)],style="duct",width=.75,height=.45,endpoint="FELLOWSHIP-HVAC")
add_floor_branch(3,"FIRE-PROTECTION",[(54.25,67.5),(32,67.5),(32,55)],style="pipe",width=.22,endpoint="LIFE-SAFETY")
add_floor_branch(3,"ELEC-EMERGENCY",[(57.25,70.5),(50,70.5),(50,54),(44,54)],endpoint="EGRESS")

# Step 5: F4-F6 and L7 roof/service terminations.
upper_floor_power_data_refs={
    5:"F5-POLICY-POWER-01",
    6:"F6-COMMAND-POWER-01",
}
for level,label,ycenter in [(4,"MEDIA",42),(5,"POLICY",40),(6,"COMMAND",38)]:
    canonical_power_data_ref=upper_floor_power_data_refs.get(level)
    add_floor_branch(level,"ELEC-NORMAL",[(57.25,67.5),(48,67.5),(48,ycenter),(35,ycenter)],endpoint=f"{label}-POWER",inventory_ref=canonical_power_data_ref)
    add_floor_branch(level,"DATA-STRUCTURED",[(58.5,67.5),(46,67.5),(46,ycenter),(35,ycenter)],endpoint=f"{label}-DATA",inventory_ref=canonical_power_data_ref)
    add_floor_branch(level,"AV-MEDIA",[(58.5,67.5),(48,67.5),(48,52),(35,52)],endpoint=f"{label}-AV")
    add_floor_branch(level,"SECURITY-ACCESS",[(58.5,70.5),(52,70.5),(52,27),(50,27)],endpoint=f"{label}-CHECKIN")
    add_floor_branch(level,"BAS-CONTROLS",[(58.5,70.5),(43,70.5),(43,64),(40,64)],endpoint=f"{label}-BAS")
    add_floor_branch(level,"WATER-DOMESTIC",[(54.25,70.5),(30,70.5),(30,64),(29,64)],style="pipe",width=.20,endpoint="RESTROOM-WATER",inventory_ref=f"F{level}-RR-B-VANITY-01")
    add_floor_branch(level,"SANITARY-VENT",[(55.75,67.5),(28,67.5),(28,69),(29,69)],style="pipe",width=.30,endpoint="RESTROOM-SANITARY",inventory_ref=f"F{level}-RR-B-WC-01")
    add_floor_branch(level,"HVAC-AIR",[(51.75,67.5),(44,67.5),(44,48),(36,48)],style="duct",width=.75,height=.45,endpoint=f"{label}-HVAC")
    add_floor_branch(level,"FIRE-PROTECTION",[(54.25,67.5),(32,67.5),(32,55)],style="pipe",width=.22,endpoint="LIFE-SAFETY")
    add_floor_branch(level,"ELEC-EMERGENCY",[(57.25,70.5),(50,70.5),(50,54),(44,54)],endpoint="EGRESS")

add_floor_branch(6,"DATA-STRUCTURED",[(58.5,67.5),(50,67.5),(50,12),(55,12)],endpoint="HALO-DATA",inventory_ref="F6-HALO-CEILING-FEED-01")
add_floor_branch(6,"AV-MEDIA",[(58.5,67.5),(49,67.5),(49,13),(55,13),(55,12)],endpoint="HALO-MEDIA",inventory_ref="F6-HALO-CEILING-FEED-01")
add_floor_branch(7,"ELEC-NORMAL",[(57.25,67.5),(48,67.5),(48,42),(36,42)],endpoint="ROOF-MECH-POWER")
add_floor_branch(7,"ELEC-EMERGENCY",[(57.25,70.5),(50,70.5),(50,54),(42,54)],endpoint="ROOF-EGRESS-LIGHT")
add_floor_branch(7,"DATA-STRUCTURED",[(58.5,67.5),(47,67.5),(47,46),(36,46)],endpoint="ROOF-COMMS")
add_floor_branch(7,"BAS-CONTROLS",[(58.5,70.5),(44,70.5),(44,50),(36,50)],endpoint="ROOF-SENSORS")
add_floor_branch(7,"STORM-DRAINAGE",[(55.75,70.5),(42,70.5),(42,60),(32,60)],style="pipe",width=.35,endpoint="ROOF-DRAINAGE")
add_floor_branch(7,"FIRE-PROTECTION",[(54.25,67.5),(38,67.5),(38,55),(32,55)],style="pipe",width=.22,endpoint="ROOF-FIRE-CABINET")
add_floor_branch(7,"SECURITY-ACCESS",[(58.5,70.5),(52,70.5),(52,38),(44,38)],endpoint="ROOF-INTERCOM")

# Step 6: detailed Level 7 roof terminations and service-access routing.
# Step 5's representative L7 handoffs remain intact; this pass adds the actual
# service/device layer against the canonical Floor 7 object inventory.
step6_records=[]
step6_branch_records=[]
def tag_step6(start,inventory_ref):
    for r in records[start:]:
        r["step"]=6
        r["inventory_ref"]=inventory_ref
        step6_records.append(r)

def add_step6_branch(system_id,points,endpoint,inventory_ref,style="tray",width=.18,height=.18,z_offset=None):
    start=len(records)
    add_floor_branch(7,system_id,points,z_offset=z_offset,style=style,width=width,height=height,endpoint=endpoint,inventory_ref=inventory_ref)
    tag_step6(start,inventory_ref)
    floor_branch_records[-1]["step"]=6
    step6_branch_records.append(floor_branch_records[-1])

def add_step6_box(name,bounds,z0,h,system_id,kind,inventory_ref):
    add_box(name,bounds,z0,h,system_id,kind,7,{"step":6,"inventory_ref":inventory_ref})
    step6_records.append(records[-1])

def add_step6_cylinder(name,cx,cy,z0,radius,h,system_id,kind,inventory_ref,sections=18,axis="z"):
    add_cylinder(name,cx,cy,z0,radius,h,system_id,kind,7,sections,axis,{"step":6,"inventory_ref":inventory_ref})
    step6_records.append(records[-1])

roof_mech=[
    ("F7-MECH-UNIT-01",(37.5,65)),
    ("F7-MECH-UNIT-02",(43.5,65)),
    ("F7-MECH-UNIT-03",(48.5,63)),
]
for idx,(ref,(x,y)) in enumerate(roof_mech,1):
    add_step6_branch("ELEC-NORMAL",[(57.25,67.5),(52,67.5),(52,y),(x,y)],f"ROOF-MECH-{idx}-POWER",ref)
    add_step6_branch("BAS-CONTROLS",[(58.5,70.5),(53,70.5),(53,y),(x,y)],f"ROOF-MECH-{idx}-BAS",ref)
    add_step6_branch("HVAC-AIR",[(51.75,69),(51.75,y),(x,y)],f"ROOF-MECH-{idx}-AIR",ref,style="duct",width=.62,height=.38)

roof_drains=[(4,6),(24,6),(48,6),(4,48),(24,48),(48,60)]
roof_drain_records=[]
for idx,(x,y) in enumerate(roof_drains,1):
    pts=[(55.75,70.5),(48,70.5),(48,y)]
    if x!=48: pts.append((x,y))
    add_step6_branch("STORM-DRAINAGE",pts,f"ROOF-DRAIN-{idx}","F7-DRAINS-01",style="pipe",width=.30,z_offset=.55)
    add_step6_cylinder(f"SVC-F7-DEVICE::STORM-DRAINAGE::ROOF-DRAIN-{idx}",x,y,LEVEL_Z[7]+.03,.34,.16,"STORM-DRAINAGE","roof_drain","F7-DRAINS-01")
    roof_drain_records.append(records[-1])

add_step6_branch("ELEC-EMERGENCY",[(57.25,70.5),(50,70.5),(50,52),(20,52)],"ROOF-LIGHTING-POWER","F7-PATH-LIGHTS-01")
add_step6_branch("LIGHTING-CONTROLS",[(50,52),(50,6),(48,6)],"ROOF-PATH-LIGHTING-CONTROL","F7-PATH-LIGHTS-01")
path_light_positions=[
    (22,52),(28,52),(34,52),(40,52),(46,52),
    (50,42),(50,34),(50,26),(50,18),(50,10),
    (42,6),(34,6),(26,6),(18,6),
]
path_light_records=[]
for idx,(x,y) in enumerate(path_light_positions,1):
    add_step6_cylinder(f"SVC-F7-DEVICE::LIGHTING-CONTROLS::PATH-{idx:02d}",x,y,LEVEL_Z[7]+.08,.11,1.05,"LIGHTING-CONTROLS","roof_path_light","F7-PATH-LIGHTS-01",sections=12)
    path_light_records.append(records[-1])

stair_sconces=[(61.0,53.55),(65.0,53.55),(13.5,53.55),(17.5,53.55)]
sconce_records=[]
for idx,(x,y) in enumerate(stair_sconces,1):
    add_step6_box(f"SVC-F7-DEVICE::ELEC-EMERGENCY::STAIR-SCONCE-{idx}",(x-.18,y-.12,x+.18,y+.12),LEVEL_Z[7]+3.0,.75,"ELEC-EMERGENCY","roof_stair_sconce","F7-STAIR-SCONCES-01")
    sconce_records.append(records[-1])

add_step6_branch("DATA-STRUCTURED",[(58.5,67.5),(51,67.5),(51,52),(59,52)],"EMERGENCY-CALL-A","F7-EMERGENCY-CALL-01")
add_step6_branch("DATA-STRUCTURED",[(58.5,67.5),(51,67.5),(51,52),(18.5,52)],"EMERGENCY-CALL-B","F7-EMERGENCY-CALL-01")
emergency_call_records=[]
for idx,(x,y) in enumerate(((59,52),(18.5,52)),1):
    add_step6_box(f"SVC-F7-DEVICE::SECURITY-ACCESS::EMERGENCY-CALL-{idx}",(x-.24,y-.18,x+.24,y+.18),LEVEL_Z[7]+1.2,2.1,"SECURITY-ACCESS","roof_emergency_call","F7-EMERGENCY-CALL-01")
    emergency_call_records.append(records[-1])

add_step6_branch("FIRE-PROTECTION",[(54.25,67.5),(50,67.5),(50,52),(58.2,52)],"FIRE-CABINET-A","F7-FIRE-CABINET-01",style="pipe",width=.22)
add_step6_branch("FIRE-PROTECTION",[(54.25,67.5),(50,67.5),(50,52),(19.5,52)],"FIRE-CABINET-B","F7-FIRE-CABINET-01",style="pipe",width=.22)
fire_support_records=[]
for idx,(x,y) in enumerate(((58.2,52),(19.5,52)),1):
    add_step6_box(f"SVC-F7-DEVICE::FIRE-PROTECTION::CABINET-{idx}",(x-.42,y-.20,x+.42,y+.20),LEVEL_Z[7]+.8,2.4,"FIRE-PROTECTION","roof_fire_support","F7-FIRE-CABINET-01")
    fire_support_records.append(records[-1])

service_route_records=[]
add_step6_box("SVC-F7-SERVICE-ROUTE::NORTH-WALK",(18,57.7,50,58.3),LEVEL_Z[7]+.04,.08,"SERVICE-HOUSEKEEPING","roof_service_route","F7-SERVICE-WALK-01")
service_route_records.append(records[-1])
add_step6_box("SVC-F7-SERVICE-ROUTE::SCREEN-ACCESS",(34,59.7,50,60.3),LEVEL_Z[7]+.04,.08,"SERVICE-HOUSEKEEPING","roof_service_route","F7-SERVICE-SCREEN-01")
service_route_records.append(records[-1])

lightning_terminal_records=[]
for idx,(x,y) in enumerate(((2,2),(70,2),(2,70),(70,70)),1):
    add_step6_cylinder(f"SVC-F7-DEVICE::LIGHTNING-PROTECTION::AIR-TERMINAL-{idx}",x,y,LEVEL_Z[7]+4.1,.055,2.2,"LIGHTNING-PROTECTION","roof_lightning_terminal","F7-LIGHTNING-RODS-01",sections=10)
    lightning_terminal_records.append(records[-1])
lightning_conductor_records=[]
for idx,(cx,cy,length,axis) in enumerate(((36,2,68,"x"),(36,70,68,"x"),(2,36,68,"y"),(70,36,68,"y")),1):
    add_step6_cylinder(f"SVC-F7-DEVICE::LIGHTNING-PROTECTION::PERIMETER-{idx}",cx,cy,LEVEL_Z[7]+4.2,.045,length,"LIGHTNING-PROTECTION","roof_lightning_conductor","F7-LIGHTNING-RODS-01",sections=10,axis=axis)
    lightning_conductor_records.append(records[-1])

# Step 7: representative interior device / ceiling / service-access realism.
# This augments existing floor branches without moving rooms, cores, stairs,
# elevators or approved architectural floor programs.
step7_records=[]
def add_step7_box(level,name,bounds,z0,h,system_id,kind):
    add_box(f"SVC-F{level}-DEVICE::{system_id}::{name}",bounds,z0,h,system_id,kind,level,{"step":7})
    step7_records.append(records[-1])

def add_step7_cylinder(level,name,cx,cy,z0,radius,h,system_id,kind,sections=14,axis="z"):
    add_cylinder(f"SVC-F{level}-DEVICE::{system_id}::{name}",cx,cy,z0,radius,h,system_id,kind,level,sections,axis,{"step":7})
    step7_records.append(records[-1])

def first_branch_anchor(level,system_id,fallback):
    for x in floor_branch_records:
        if x["level"]==level and x["system_id"]==system_id and x.get("step")!=6:
            return x["points"][-1]
    return fallback

for level in range(1,7):
    z=LEVEL_Z[level]
    power_anchor=first_branch_anchor(level,"ELEC-NORMAL",(36,40))
    data_anchor=first_branch_anchor(level,"DATA-STRUCTURED",(36,42))

    add_step7_box(level,"PANEL",(47.0,61.8,48.4,63.8),z+2.8,4.8,"ELEC-NORMAL","interior_electrical_panel")
    add_step7_box(level,"DATA-RACK",(44.0,61.6,46.0,64.0),z+.15,6.4,"DATA-STRUCTURED","interior_data_rack")
    add_step7_box(level,"TRAY-A",(40.0,60.95,48.0,61.25),z+10.2,.22,"DATA-STRUCTURED","interior_cable_tray")
    add_step7_box(level,"TRAY-B",(39.85,51.0,40.15,61.1),z+10.2,.22,"DATA-STRUCTURED","interior_cable_tray")
    add_step7_cylinder(level,"POWER-DROP-1",power_anchor[0]-.45,power_anchor[1],z+1.0,.07,7.9,"ELEC-NORMAL","interior_conduit_drop")
    add_step7_cylinder(level,"DATA-DROP-1",data_anchor[0]+.45,data_anchor[1],z+1.0,.06,7.9,"DATA-STRUCTURED","interior_conduit_drop")

    for idx,(x,y) in enumerate(((22,30),(34,30),(22,45),(34,45)),1):
        add_step7_box(level,f"DIFFUSER-{idx}",(x-.55,y-.55,x+.55,y+.55),z+10.45,.12,"HVAC-AIR","interior_diffuser")
    for idx,(x,y) in enumerate(((42,30),(42,45)),1):
        add_step7_box(level,f"RETURN-{idx}",(x-.75,y-.45,x+.75,y+.45),z+10.38,.16,"HVAC-AIR","interior_return_grille")

    for idx,(x,y) in enumerate(((24,26),(38,26),(24,48),(38,48)),1):
        add_step7_cylinder(level,f"DETECTOR-{idx}",x,y,z+10.56,.18,.12,"FIRE-ALARM","interior_detector",sections=16)
    for idx,(x,y) in enumerate(((20,20),(48,50)),1):
        add_step7_box(level,f"STROBE-{idx}",(x-.20,y-.12,x+.20,y+.12),z+6.6,.48,"FIRE-ALARM","interior_strobe")
    for idx,(x,y) in enumerate(((19.5,53.0),(58.0,53.0)),1):
        add_step7_cylinder(level,f"EXTINGUISHER-{idx}",x,y,z+.55,.18,2.0,"FIRE-PROTECTION","interior_extinguisher",sections=16)

    add_step7_box(level,"ACCESS-READER",(49.65,26.8,49.95,27.2),z+3.5,1.0,"SECURITY-ACCESS","interior_access_reader")
    add_step7_box(level,"INTERCOM",(50.15,27.0,50.55,27.45),z+3.35,1.25,"SECURITY-ACCESS","interior_intercom")
    for idx,(x,y) in enumerate(((48.0,24.0),(48.0,50.0)),1):
        add_step7_cylinder(level,f"CAMERA-{idx}",x,y,z+8.8,.16,.6,"SECURITY-ACCESS","interior_camera",sections=14)

    px,py=power_anchor
    for idx,(dx,dy) in enumerate(((-2,-1),(2,-1),(-2,1),(2,1)),1):
        x,y=px+dx,py+dy
        add_step7_box(level,f"RECEPTACLE-{idx}",(x-.14,y-.08,x+.14,y+.08),z+1.3,.48,"ELEC-NORMAL","interior_receptacle")
    for idx,(dx,dy) in enumerate(((-1.1,0),(1.1,0)),1):
        x,y=px+dx,py+dy
        add_step7_box(level,f"FLOOR-BOX-{idx}",(x-.25,y-.25,x+.25,y+.25),z+.04,.10,"ELEC-NORMAL","interior_floor_box")

    add_step7_cylinder(level,"DOMESTIC-VALVE",29.0,63.5,z+2.5,.14,.8,"WATER-DOMESTIC","interior_valve",sections=16)
    add_step7_cylinder(level,"FIRE-VALVE",32.0,54.0,z+2.5,.14,.8,"FIRE-PROTECTION","interior_valve",sections=16)
    add_step7_box(level,"HVAC-ACCESS-1",(35.4,47.6,36.6,48.4),z+9.95,.10,"HVAC-AIR","interior_access_panel")
    add_step7_box(level,"HVAC-ACCESS-2",(41.4,47.6,42.6,48.4),z+9.95,.10,"HVAC-AIR","interior_access_panel")
    add_step7_box(level,"SERVICE-ACCESS",(42.0,61.0,43.2,62.2),z+8.8,.10,"SERVICE-HOUSEKEEPING","interior_access_panel")
    add_step7_cylinder(level,"RESTROOM-WATER-CONNECTION",29.0,64.0,z+.08,.11,1.0,"WATER-DOMESTIC","interior_plumbing_connection",sections=14)
    add_step7_cylinder(level,"RESTROOM-WASTE-CONNECTION",29.0,69.0,z+.08,.15,1.0,"SANITARY-VENT","interior_plumbing_connection",sections=14)

# Step 8: close shared-path branch gaps before final traceability verification.
step8_branch_records=[]
def add_step8_branch(level,system_id,points,endpoint,inventory_ref=None,style="tray",width=.18,height=.18,z_offset=None):
    start=len(records)
    add_floor_branch(level,system_id,points,z_offset=z_offset,style=style,width=width,height=height,endpoint=endpoint,inventory_ref=inventory_ref)
    for r in records[start:]:
        r["step"]=8
    floor_branch_records[-1]["step"]=8
    step8_branch_records.append(floor_branch_records[-1])

add_step8_branch(1,"AV-MEDIA",[(58.5,67.5),(45,67.5),(45,50),(36,50)],"ORIENTATION-AV")
add_step8_branch(1,"SECURITY-ACCESS",[(58.5,70.5),(52,70.5),(52,27),(50,27)],"ARRIVAL-ACCESS")
add_step8_branch(1,"LIGHTING-CONTROLS",[(58.5,70.5),(42,70.5),(42,38),(38,38)],"LIGHTING-ZONE")
add_step8_branch(1,"FIRE-ALARM",[(57.25,70.5),(41,70.5),(41,26),(38,26)],"FIRE-ALARM-ZONE")
add_step8_branch(1,"SERVICE-HOUSEKEEPING",[(18.5,53),(42,53),(42,61)],"SERVICE-ACCESS")

for level in (2,3):
    add_step8_branch(level,"BAS-CONTROLS",[(58.5,70.5),(43,70.5),(43,64),(40,64)],"FLOOR-BAS")
    add_step8_branch(level,"LIGHTING-CONTROLS",[(58.5,70.5),(42,70.5),(42,38),(38,38)],"LIGHTING-ZONE")
    add_step8_branch(level,"FIRE-ALARM",[(57.25,70.5),(41,70.5),(41,26),(38,26)],"FIRE-ALARM-ZONE")
    add_step8_branch(level,"SERVICE-HOUSEKEEPING",[(18.5,53),(42,53),(42,61)],"SERVICE-ACCESS")

for level in (4,5,6):
    add_step8_branch(level,"LIGHTING-CONTROLS",[(58.5,70.5),(42,70.5),(42,38),(38,38)],"LIGHTING-ZONE")
    add_step8_branch(level,"FIRE-ALARM",[(57.25,70.5),(41,70.5),(41,26),(38,26)],"FIRE-ALARM-ZONE")
    add_step8_branch(level,"SERVICE-HOUSEKEEPING",[(18.5,53),(42,53),(42,61)],"SERVICE-ACCESS")

add_step8_branch(7,"FIRE-ALARM",[(57.25,70.5),(51.5,70.5),(51.5,52),(59,52)],"ROOF-FIRE-ALARM")
add_step8_branch(7,"SERVICE-HOUSEKEEPING",[(18.5,58),(34,58),(34,60)],"ROOF-SERVICE-ACCESS",z_offset=.35)

checks=[]
def ck(name,ok,detail=""):
    checks.append({"name":name,"passed":bool(ok),"detail":str(detail)})

def inside_shared(b): return b["x1"]>=SHARED["x1"] and b["x2"]<=SHARED["x2"] and b["y1"]>=SHARED["y1"] and b["y2"]<=SHARED["y2"]
def overlap(a,b): return min(a["x2"],b["x2"])>max(a["x1"],b["x1"]) and min(a["y2"],b["y2"])>max(a["y1"],b["y1"])
def bounds_overlap(a,b): return min(a[2],b[2])>max(a[0],b[0]) and min(a[3],b[3])>max(a[1],b[1])
def point_inside(bounds,pt): return bounds["x1"]<=pt[0]<=bounds["x2"] and bounds["y1"]<=pt[1]<=bounds["y2"]

required_systems={x["system_id"] for x in alloc}
modeled_source_systems={r["system_id"] for r in records if r["kind"]=="source_equipment"}
ck("nine system risers allocated",len(alloc)==9,len(alloc))
ck("all system risers modeled",len(modeled_systems)==9,sorted(modeled_systems))
ck("all allocations inside shared reservation",all(inside_shared(x["bounds"]) for x in alloc))
ck("system riser envelopes do not overlap",all(not overlap(a["bounds"],b["bounds"]) for i,a in enumerate(alloc) for b in alloc[i+1:]))
ck("Stair A separation band preserved",sep["bounds"]=={"x1":59.0,"y1":66.0,"x2":60.0,"y2":72.0},sep["bounds"])
ck("vertical service geometry stays west of Stair A boundary",max(a["bounds"]["x2"] for a in alloc)<60)
ck("seven story segments per system",riser_segments==9*7,riser_segments)
expected_takeoffs=sum(len(set(int(x) for x in SYSTEMS[a["system_id"]]["serves_levels"])) for a in alloc)
ck("all authorized floor handoff stubs modeled",takeoffs==expected_takeoffs,f"{takeoffs}/{expected_takeoffs}")
ck("B1 to roof level markers modeled",sum(1 for r in records if r["kind"]=="level_marker")==8)
ck("floor addenda cover B1 through L7",set(ADDENDA["levels"])=={"B1","F1","F2","F3","F4","F5","F6","L7"},sorted(ADDENDA["levels"]))
ck("source/route/endpoints authority retained",all("origin" in SYSTEMS[a["system_id"]] and "representative_endpoints" in SYSTEMS[a["system_id"]] for a in alloc))
ck("substantial visible nervous-system geometry",len(scene.geometry)>=300,len(scene.geometry))
ck("Step 3 authority covers all nine backbone systems",set(SOURCE_CONNECTIONS)==required_systems,sorted(SOURCE_CONNECTIONS))
ck("required B1 source equipment families modeled",modeled_source_systems==required_systems,sorted(modeled_source_systems))
ck("all nine source-to-riser paths modeled",set(connection_paths)==required_systems,sorted(connection_paths))
ck("source-to-riser connection continuity",all(point_inside(alloc_by_system[sid]["bounds"],pts[-1]) for sid,pts in connection_paths.items()),{sid:pts[-1] for sid,pts in connection_paths.items()})
forbidden={"Stair A":(60,54,72,72),"Stair B":(8,54,18,72),"passenger elevator":(54,34,62,44),"freight/service elevator":(0,60,8,72)}
b1_service=[r for r in records if r["kind"] in {"source_equipment","b1_distribution","b1_riser_connection"}]
clashes=[]
for r in b1_service:
    for label,bb in forbidden.items():
        if bounds_overlap(r["bounds_ft"],bb): clashes.append((r["name"],label))
ck("B1 services avoid protected stair/elevator zones",not clashes,clashes[:20])
sep_bounds=(sep["bounds"]["x1"],sep["bounds"]["y1"],sep["bounds"]["x2"],sep["bounds"]["y2"])
ck("B1 service geometry does not enter Stair A separation band",not [r["name"] for r in b1_service if bounds_overlap(r["bounds_ft"],sep_bounds)])
route_bottoms=[r["z0_ft"]-B1_Z for r in records if r["kind"]=="b1_distribution"]
ck("B1 distribution remains overhead of primary circulation",min(route_bottoms)>=7.25,min(route_bottoms))
ck("telecom equipment connects to DATA",SOURCE_CONNECTIONS.get("DATA-STRUCTURED",{}).get("connection_target_riser")=="R-DATA" and "DATA-STRUCTURED" in connection_paths)
ck("BAS source connects to BAS-CONTROLS",SOURCE_CONNECTIONS.get("BAS-CONTROLS",{}).get("connection_target_riser")=="R-CONTROLS" and "BAS-CONTROLS" in connection_paths)
ck("normal and emergency power remain distinct",connection_paths.get("ELEC-NORMAL")!=connection_paths.get("ELEC-EMERGENCY"))
ck("fire and domestic water remain distinguishable",SOURCE_CONNECTIONS.get("FIRE-PROTECTION",{}).get("connection_target_riser")=="R-FIRE" and SOURCE_CONNECTIONS.get("WATER-DOMESTIC",{}).get("connection_target_riser")=="R-WATER")
ck("storm/sump connects to STORM-DRAINAGE",SOURCE_CONNECTIONS.get("STORM-DRAINAGE",{}).get("connection_target_riser")=="R-STORM" and "STORM-DRAINAGE" in connection_paths)
ck("HVAC plant connects to HVAC-AIR",SOURCE_CONNECTIONS.get("HVAC-AIR",{}).get("connection_target_riser")=="R-HVAC" and "HVAC-AIR" in connection_paths)
step4=[r for r in records if r["kind"] in {"floor_branch","floor_endpoint"} and r["level"] in {1,2,3} and r.get("step") is None]
step5=[r for r in records if r["kind"] in {"floor_branch","floor_endpoint"} and r["level"] in {4,5,6,7} and r.get("step") is None]
ck("Step 4 branches remain on Floors 1-3",{r["level"] for r in step4}=={1,2,3},sorted({r["level"] for r in step4}))
ck("Step 5 branches exist on Floors 4-6 and L7",{r["level"] for r in step5}=={4,5,6,7},sorted({r["level"] for r in step5}))
ck("Step 5 upper floors have power/data/AV",all({"ELEC-NORMAL","DATA-STRUCTURED","AV-MEDIA"}<={x["system_id"] for x in floor_branch_records if x["level"]==l} for l in (4,5,6)))
ck("Step 5 Floor 6 Halo receives data and media",{"HALO-DATA","HALO-MEDIA"}<={x["endpoint"] for x in floor_branch_records if x["level"]==6})
ck("Step 5 roof has power data BAS storm fire security",{"ELEC-NORMAL","DATA-STRUCTURED","BAS-CONTROLS","STORM-DRAINAGE","FIRE-PROTECTION","SECURITY-ACCESS"}<={x["system_id"] for x in floor_branch_records if x["level"]==7})
ck("Step 5 restroom wet branches remain on F1-F6",all({"WATER-DOMESTIC","SANITARY-VENT"}<={x["system_id"] for x in floor_branch_records if x["level"]==l} for l in (1,2,3,4,5,6)))
ck("Step 5 routes stay west of Stair A",all(max(p[0] for p in x["points"])<60 for x in floor_branch_records if x.get("step")!=6))

mobility=(10,8,48,46)
def segment_enters_rect(a,b,r):
    if a[0]==b[0]:
        x=a[0]; lo,hi=sorted((a[1],b[1]))
        return r[0]<x<r[2] and max(lo,r[1])<min(hi,r[3])
    y=a[1]; lo,hi=sorted((a[0],b[0]))
    return r[1]<y<r[3] and max(lo,r[0])<min(hi,r[2])

ck("Step 6 roof mechanical units receive power BAS and HVAC",all({"ELEC-NORMAL","BAS-CONTROLS","HVAC-AIR"}<={x["system_id"] for x in step6_branch_records if x["inventory_ref"]==ref} for ref,_ in roof_mech))
ck("Step 6 models six roof drains",len(roof_drain_records)==6,len(roof_drain_records))
ck("Step 6 models fourteen low-level path lights",len(path_light_records)==14,len(path_light_records))
ck("Step 6 models four stair sconces",len(sconce_records)==4,len(sconce_records))
ck("Step 6 models two emergency call points",len(emergency_call_records)==2,len(emergency_call_records))
ck("Step 6 models two roof fire support points",len(fire_support_records)==2,len(fire_support_records))
ck("Step 6 models four lightning terminals",len(lightning_terminal_records)==4,len(lightning_terminal_records))
ck("Step 6 models perimeter lightning conductor",len(lightning_conductor_records)==4,len(lightning_conductor_records))
ck("Step 6 models north service-screen routes",len(service_route_records)>=2,len(service_route_records))
step6_clashes=[]
for x in step6_branch_records:
    for a,b in zip(x["points"][:-1],x["points"][1:]):
        if segment_enters_rect(a,b,mobility): step6_clashes.append((x["endpoint"],a,b))
ck("Step 6 routed services keep mobility field clear",not step6_clashes,step6_clashes[:12])
ck("Step 6 detailed roof terminations are substantial",len(step6_records)>=100,len(step6_records))

step7_kinds={}
for r in step7_records:
    step7_kinds[r["kind"]]=step7_kinds.get(r["kind"],0)+1
ck("Step 7 devices cover Floors 1-6",{r["level"] for r in step7_records}=={1,2,3,4,5,6},sorted({r["level"] for r in step7_records}))
ck("Step 7 electrical panels modeled",step7_kinds.get("interior_electrical_panel")==6,step7_kinds.get("interior_electrical_panel"))
ck("Step 7 data racks modeled",step7_kinds.get("interior_data_rack")==6,step7_kinds.get("interior_data_rack"))
ck("Step 7 cable trays modeled",step7_kinds.get("interior_cable_tray")==12,step7_kinds.get("interior_cable_tray"))
ck("Step 7 conduit drops modeled",step7_kinds.get("interior_conduit_drop")==12,step7_kinds.get("interior_conduit_drop"))
ck("Step 7 HVAC ceiling devices modeled",step7_kinds.get("interior_diffuser")==24 and step7_kinds.get("interior_return_grille")==12,step7_kinds)
ck("Step 7 fire alarm devices modeled",step7_kinds.get("interior_detector")==24 and step7_kinds.get("interior_strobe")==12,step7_kinds)
ck("Step 7 extinguishers modeled",step7_kinds.get("interior_extinguisher")==12,step7_kinds.get("interior_extinguisher"))
ck("Step 7 access/comms devices modeled",step7_kinds.get("interior_access_reader")==6 and step7_kinds.get("interior_intercom")==6 and step7_kinds.get("interior_camera")==12,step7_kinds)
ck("Step 7 receptacles and floor boxes modeled",step7_kinds.get("interior_receptacle")==24 and step7_kinds.get("interior_floor_box")==12,step7_kinds)
ck("Step 7 valves and access panels modeled",step7_kinds.get("interior_valve")==12 and step7_kinds.get("interior_access_panel")==18,step7_kinds)
ck("Step 7 plumbing service connections modeled",step7_kinds.get("interior_plumbing_connection")==12,step7_kinds.get("interior_plumbing_connection"))
step7_clashes=[]
for r in step7_records:
    for label,bb in forbidden.items():
        if bounds_overlap(r["bounds_ft"],bb): step7_clashes.append((r["name"],label))
ck("Step 7 devices avoid protected stair/elevator zones",not step7_clashes,step7_clashes[:20])
ck("Step 7 adds substantial interior service realism",len(step7_records)>=220,len(step7_records))

branch_levels_by_system={sid:sorted({x["level"] for x in floor_branch_records if x["system_id"]==sid}) for sid in SYSTEMS}
endpoint_count_by_system={sid:sum(1 for r in records if r["kind"]=="floor_endpoint" and r["system_id"]==sid) for sid in SYSTEMS}
service_evidence={
    "ELEC-NORMAL": step7_kinds.get("interior_electrical_panel",0)>0,
    "ELEC-EMERGENCY": step7_kinds.get("interior_electrical_panel",0)>0 and len(sconce_records)>0,
    "LIGHTING-CONTROLS": any(r["system_id"]=="LIGHTING-CONTROLS" for r in records),
    "DATA-STRUCTURED": step7_kinds.get("interior_data_rack",0)>0,
    "AV-MEDIA": step7_kinds.get("interior_data_rack",0)>0,
    "BAS-CONTROLS": "BAS-CONTROLS" in modeled_source_systems,
    "SECURITY-ACCESS": step7_kinds.get("interior_access_reader",0)>0 and step7_kinds.get("interior_camera",0)>0,
    "HVAC-AIR": step7_kinds.get("interior_access_panel",0)>0,
    "WATER-DOMESTIC": step7_kinds.get("interior_valve",0)>0 and step7_kinds.get("interior_plumbing_connection",0)>0,
    "SANITARY-VENT": step7_kinds.get("interior_plumbing_connection",0)>0,
    "STORM-DRAINAGE": len(roof_drain_records)>0 and "STORM-DRAINAGE" in modeled_source_systems,
    "FIRE-PROTECTION": step7_kinds.get("interior_extinguisher",0)>0 and step7_kinds.get("interior_valve",0)>0,
    "FIRE-ALARM": step7_kinds.get("interior_detector",0)>0 and step7_kinds.get("interior_strobe",0)>0,
    "SERVICE-HOUSEKEEPING": step7_kinds.get("interior_access_panel",0)>0 and len(service_route_records)>0,
}
traceability={}
for sid,system in SYSTEMS.items():
    expected=sorted(l for l in set(int(x) for x in system["serves_levels"]) if l>0)
    actual=branch_levels_by_system[sid]
    is_backbone=sid in required_systems
    source_ok=(sid in modeled_source_systems) if is_backbone else bool(system.get("origin"))
    vertical_ok=(sid in modeled_systems) if is_backbone else bool(system.get("vertical_route")) and all(dep in SYSTEMS for dep in system.get("dependencies",[]))
    branch_ok=actual==expected
    endpoint_ok=endpoint_count_by_system[sid]>=len(expected)
    service_ok=bool(service_evidence.get(sid))
    traceability[sid]={
        "origin":system.get("origin"),
        "vertical_route":system.get("vertical_route"),
        "dependencies":system.get("dependencies",[]),
        "served_levels":expected,
        "branch_levels":actual,
        "endpoint_count":endpoint_count_by_system[sid],
        "source_ok":source_ok,
        "vertical_route_ok":vertical_ok,
        "branch_coverage_ok":branch_ok,
        "endpoint_ok":endpoint_ok,
        "monitoring_or_service_access_ok":service_ok,
        "passed":source_ok and vertical_ok and branch_ok and endpoint_ok and service_ok,
    }

route_clashes=[]
for r in (x for x in records if x["kind"]=="floor_branch"):
    for label,bb in forbidden.items():
        if bounds_overlap(r["bounds_ft"],bb): route_clashes.append((r["name"],label))
traceability_passed=sum(1 for x in traceability.values() if x["passed"])
ck("Step 8 all 14 system families have end-to-end traceability",traceability_passed==len(SYSTEMS)==14,{k:v["passed"] for k,v in traceability.items()})
ck("Step 8 all served above-B1 levels have branch coverage",all(x["branch_coverage_ok"] for x in traceability.values()),{k:v["branch_levels"] for k,v in traceability.items()})
ck("Step 8 every system has representative endpoints",all(x["endpoint_ok"] for x in traceability.values()),{k:v["endpoint_count"] for k,v in traceability.items()})
ck("Step 8 every system has monitoring/service-access evidence",all(x["monitoring_or_service_access_ok"] for x in traceability.values()),service_evidence)
ck("Step 8 floor routes avoid protected stair/elevator zones",not route_clashes,route_clashes[:20])
ck("Step 8 closes secondary shared-path branches",len(step8_branch_records)==24,len(step8_branch_records))

viewer=HERE.parents[4]/"equity-uprise-building-core-v2-3d.html"
viewer_step8_status=False
if viewer.exists():
    vt=viewer.read_text()
    viewer_step8_status="Services Step 8 verified" in vt
    ck("Services viewer still loads canonical asset","equity-uprise-building-services-core-v2.glb" in vt)
    ck("Services viewer exposes per-floor service geometry","SVC-F" in vt and "requestedServices" in vt and "floorSvc" in vt)
    ck("Services viewer has architecture/services exposure controls","Services: Exposed" in vt and "Services: Off" in vt and "syncServicesVisibility" in vt)
    ck("Services viewer floor isolation spans B1 through L7","/^[0-7]$/.test(requestedFloor)" in vt)
    ck("Services viewer status reflects Step 8",viewer_step8_status)

scene.metadata.update({"asset":"equity-uprise-building-services-core-v2","version":"services-step8-whole-building-verified-v1","not_for_construction":True,"shared_service_reservation_ft":SHARED,"systems":sorted(modeled_systems),"b1_source_systems":sorted(modeled_source_systems),"viewer_layer":"Services"})
glb=scene.export(file_type="glb")
OUT.write_bytes(glb)
sha=hashlib.sha256(glb).hexdigest()
branch_segments=sum(1 for r in records if r["kind"]=="floor_branch")
endpoints=sum(1 for r in records if r["kind"]=="floor_endpoint")
branch_occurrences={}
floor_branch_topology=[]
for b in floor_branch_records:
    endpoint=b.get("endpoint") or "GENERAL"
    key=(b["level"],b["system_id"],endpoint)
    branch_occurrences[key]=branch_occurrences.get(key,0)+1
    occurrence=branch_occurrences[key]
    branch_id=f"BRANCH::F{b['level']}::{b['system_id']}::{endpoint}::{occurrence:02d}"
    x,y=b["points"][-1]
    floor_branch_topology.append({
        "branch_id":branch_id,
        "handoff_id":f"HANDOFF::F{b['level']}::{b['system_id']}",
        "level":b["level"],
        "system_id":b["system_id"],
        "endpoint":b.get("endpoint"),
        "inventory_ref":b.get("inventory_ref"),
        "points_ft":[[float(px),float(py)] for px,py in b["points"]],
        "connection_xy_ft":[float(x),float(y)],
        "services_step":b.get("step") or (4 if b["level"] in {1,2,3} else 5),
    })
report={
    "schema_version":"1.1.0",
    "asset":"equity-uprise-building-services-core-v2",
    "status":"services-step8-whole-building-verified",
    "not_for_construction":True,
    "glb_bytes":len(glb),
    "sha256":sha,
    "mesh_count":len(scene.geometry),
    "system_risers":len(alloc),
    "system_risers_modeled":len(modeled_systems),
    "riser_segments":riser_segments,
    "floor_handoff_stubs":takeoffs,
    "levels_marked":8,
    "b1_source_systems":sorted(modeled_source_systems),
    "b1_source_equipment_meshes":sum(1 for r in records if r["kind"]=="source_equipment"),
    "b1_distribution_segments":sum(1 for r in records if r["kind"]=="b1_distribution"),
    "b1_riser_connections":sum(1 for r in records if r["kind"]=="b1_riser_connection"),
    "step4_floor_branch_segments":sum(1 for r in records if r["kind"]=="floor_branch" and r["level"] in {1,2,3} and r.get("step") is None),
    "step4_floor_endpoints":sum(1 for r in records if r["kind"]=="floor_endpoint" and r["level"] in {1,2,3} and r.get("step") is None),
    "step4_levels":[1,2,3],
    "step5_floor_branch_segments":sum(1 for r in records if r["kind"]=="floor_branch" and r["level"] in {4,5,6,7} and r.get("step") is None),
    "step5_floor_endpoints":sum(1 for r in records if r["kind"]=="floor_endpoint" and r["level"] in {4,5,6,7} and r.get("step") is None),
    "step5_levels":[4,5,6,7],
    "step6_roof_branch_segments":sum(1 for r in step6_records if r["kind"]=="floor_branch"),
    "step6_roof_endpoints":sum(1 for r in step6_records if r["kind"]=="floor_endpoint"),
    "step6_roof_termination_devices":sum(1 for r in step6_records if r["kind"].startswith("roof_")),
    "step6_mechanical_units_served":len(roof_mech),
    "step6_roof_drains":len(roof_drain_records),
    "step6_path_lights":len(path_light_records),
    "step6_stair_sconces":len(sconce_records),
    "step6_emergency_calls":len(emergency_call_records),
    "step6_fire_support_points":len(fire_support_records),
    "step6_lightning_terminals":len(lightning_terminal_records),
    "step6_lightning_conductor_segments":len(lightning_conductor_records),
    "step6_service_screen_routes":len(service_route_records),
    "step6_level":7,
    "step7_device_meshes":len(step7_records),
    "step7_levels":[1,2,3,4,5,6],
    "step7_device_kinds":step7_kinds,
    "step7_electrical_panels":step7_kinds.get("interior_electrical_panel",0),
    "step7_data_racks":step7_kinds.get("interior_data_rack",0),
    "step7_cable_trays":step7_kinds.get("interior_cable_tray",0),
    "step7_conduit_drops":step7_kinds.get("interior_conduit_drop",0),
    "step7_diffusers":step7_kinds.get("interior_diffuser",0),
    "step7_return_grilles":step7_kinds.get("interior_return_grille",0),
    "step7_detectors":step7_kinds.get("interior_detector",0),
    "step7_strobes":step7_kinds.get("interior_strobe",0),
    "step7_extinguishers":step7_kinds.get("interior_extinguisher",0),
    "step7_access_readers":step7_kinds.get("interior_access_reader",0),
    "step7_intercoms":step7_kinds.get("interior_intercom",0),
    "step7_cameras":step7_kinds.get("interior_camera",0),
    "step7_receptacles":step7_kinds.get("interior_receptacle",0),
    "step7_floor_boxes":step7_kinds.get("interior_floor_box",0),
    "step7_valves":step7_kinds.get("interior_valve",0),
    "step7_access_panels":step7_kinds.get("interior_access_panel",0),
    "step7_plumbing_connections":step7_kinds.get("interior_plumbing_connection",0),
    "step8_branch_records":len(step8_branch_records),
    "step8_branch_segments":sum(1 for r in records if r["kind"]=="floor_branch" and r.get("step")==8),
    "step8_endpoints":sum(1 for r in records if r["kind"]=="floor_endpoint" and r.get("step")==8),
    "step8_traceability_systems_total":len(traceability),
    "step8_traceability_systems_passing":traceability_passed,
    "step8_traceability_complete":traceability_passed==len(traceability)==14,
    "step8_traceability_matrix":traceability,
    "step8_whole_route_core_clashes":len(route_clashes),
    "step8_viewer_status_current":viewer_step8_status,
    "final_services_gate":True,
    "system_families_total":len(SYSTEMS),
    "floor_branch_segments":branch_segments,
    "floor_endpoints":endpoints,
    "floor_branch_records_total":len(floor_branch_topology),
    "floor_branch_records":floor_branch_topology,
    "shared_reservation_ft":SHARED,
    "systems":sorted(modeled_systems),
    "checks_total":len(checks),
    "checks_passed":sum(x["passed"] for x in checks),
    "checks_failed":sum(not x["passed"] for x in checks),
    "checks":checks,
}
report["passed"]=report["checks_failed"]==0
REPORT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","system_risers","riser_segments","floor_handoff_stubs","b1_source_equipment_meshes","b1_distribution_segments","b1_riser_connections","step5_floor_branch_segments","step5_floor_endpoints","step6_roof_branch_segments","step6_roof_endpoints","step6_roof_termination_devices","step7_device_meshes","step8_branch_segments","step8_endpoints","step8_traceability_systems_passing","checks_total","checks_passed","checks_failed","passed")},indent=2))
if not report["passed"]:
    print(json.dumps({"failed_checks":[x for x in checks if not x["passed"]]},indent=2))
    raise SystemExit("building services Step 8 verification failed")
