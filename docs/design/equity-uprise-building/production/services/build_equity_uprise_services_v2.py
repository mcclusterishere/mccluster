#!/usr/bin/env python3
"""
Build the visible Equity Uprise building-services / nervous-system layer.

Services Step 2 established the deterministic B1->L7 vertical backbone.
Services Step 3 reuses the already-modeled B1 plant/source equipment and adds
representative physical distribution interfaces from those sources to the
backbone. This remains conceptual digital-twin coordination, not construction
engineering, and intentionally does not claim final sizes/capacities/code.
"""
from pathlib import Path
import json, hashlib
import numpy as np
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
B1_CONNECTIONS=json.loads((HERE/"b1-source-connections.json").read_text())
B1_INVENTORY=json.loads((PROD/"basement-b1"/"basement-b1-object-inventory.json").read_text())
ROOT=HERE.parents[4]
VIEWER=ROOT/"equity-uprise-building-core-v2-3d.html"

OUT=OUTDIR/"equity-uprise-building-services-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-building-services-core-v2-report.json"

FT=.3048
LEVELS=CORE["levels"]
LEVEL_Z={int(x["level"]):float(x["finished_floor_elevation_ft"]) for x in LEVELS}
SYSTEMS={x["id"]:x for x in SERVICES["system_families"]}
SHARED=RISERS["shared_reservation_ft"]
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
 "SEPARATION":[120,125,132,65],
}
PBR={}
for key,rgba in COLORS.items():
    PBR[key]=PBRMaterial(
        name="SVC-"+key,
        baseColorFactor=rgba,
        metallicFactor=.18 if key not in ("ELEC-NORMAL","ELEC-EMERGENCY") else .38,
        roughnessFactor=.38 if key not in ("SANITARY-VENT","SEPARATION") else .62,
        alphaMode="BLEND",
        doubleSided=True
    )

scene=trimesh.Scene()
records=[]

def record_mesh(name,mesh,system_id,kind,level=None,extra=None):
    role=system_id if system_id in PBR else "SEPARATION"
    mesh.visual=trimesh.visual.TextureVisuals(material=PBR[role])
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    b=np.asarray(mesh.bounds,dtype=float)/FT
    rec={
        "name":name,"system_id":system_id,"kind":kind,"level":level,
        "bounds_ft":[float(b[0][0]),float(b[0][1]),float(b[1][0]),float(b[1][1])],
        "z0_ft":float(b[0][2]),"height_ft":float(b[1][2]-b[0][2])
    }
    if extra: rec.update(extra)
    records.append(rec)

def add_box(name,bounds,z0,h,system_id,kind,level=None,material_key=None):
    x1,y1,x2,y2=bounds
    if x2<=x1 or y2<=y1 or h<=0:
        raise ValueError(f"invalid box {name}: {bounds}, z={z0}, h={h}")
    mesh=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT))
    mesh.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z0+h/2)*FT))
    role=material_key or (system_id if system_id in PBR else "SEPARATION")
    mesh.visual=trimesh.visual.TextureVisuals(material=PBR[role])
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    records.append({
        "name":name,"system_id":system_id,"kind":kind,"level":level,
        "bounds_ft":[x1,y1,x2,y2],"z0_ft":z0,"height_ft":h
    })

def vec3(p): return np.asarray(p,dtype=float)

def add_oriented_box(name,p1,p2,width_ft,height_ft,system_id,kind,level=0):
    a=vec3(p1);b=vec3(p2);d=b-a;length=float(np.linalg.norm(d))
    if length<=1e-6: return
    mesh=trimesh.creation.box(extents=(length*FT,width_ft*FT,height_ft*FT))
    T=trimesh.geometry.align_vectors([1,0,0],d/length)
    if T is not None: mesh.apply_transform(T)
    mesh.apply_translation(((a+b)/2)*FT)
    record_mesh(name,mesh,system_id,kind,level,{"p1_ft":a.tolist(),"p2_ft":b.tolist()})

def add_pipe_segment(name,p1,p2,radius_ft,system_id,kind,level=0):
    a=vec3(p1)*FT;b=vec3(p2)*FT
    if np.linalg.norm(b-a)<=1e-7: return
    mesh=trimesh.creation.cylinder(radius=radius_ft*FT,segment=np.array([a,b]),sections=18)
    record_mesh(name,mesh,system_id,kind,level,{"p1_ft":vec3(p1).tolist(),"p2_ft":vec3(p2).tolist()})

def add_pipe_path(prefix,points,radius_ft,system_id,kind):
    for i,(a,b) in enumerate(zip(points[:-1],points[1:])):
        add_pipe_segment(f"{prefix}::SEG-{i:02d}::L0",a,b,radius_ft,system_id,kind)
    for i,p in enumerate(points[1:-1],1):
        mesh=trimesh.creation.icosphere(subdivisions=1,radius=max(radius_ft*1.12,.09)*FT)
        mesh.apply_translation(vec3(p)*FT)
        record_mesh(f"{prefix}::JOINT-{i:02d}::L0",mesh,system_id,kind,0)

def add_box_path(prefix,points,section,system_id,kind):
    w,h=section
    for i,(a,b) in enumerate(zip(points[:-1],points[1:])):
        add_oriented_box(f"{prefix}::SEG-{i:02d}::L0",a,b,w,h,system_id,kind,0)
        if i<len(points)-2:
            p=vec3(b)
            add_box(f"{prefix}::FLANGE-{i:02d}::L0",(p[0]-w*.58,p[1]-w*.58,p[0]+w*.58,p[1]+w*.58),p[2]-h*.58,h*1.16,system_id,kind,0)

def add_conduit_bundle(prefix,points,radius,count,spacing,system_id):
    center=(count-1)/2
    for j in range(count):
        dy=(j-center)*spacing
        shifted=[[p[0],p[1]+dy,p[2]] for p in points]
        add_pipe_path(f"{prefix}::C{j+1}",shifted,radius,system_id,"b1_emergency_conduit")

def add_cable_tray(prefix,points,width,rail,system_id):
    for i,(a0,b0) in enumerate(zip(points[:-1],points[1:])):
        a=vec3(a0);b=vec3(b0);d=b-a;L=float(np.linalg.norm(d))
        if L<=1e-6: continue
        direction=d/L
        perp=np.cross(direction,[0,0,1.0])
        if np.linalg.norm(perp)<1e-5: perp=np.array([1.0,0,0])
        perp=perp/np.linalg.norm(perp)
        for side in (-1,1):
            off=perp*(width/2-rail/2)*side
            add_oriented_box(f"{prefix}::SEG-{i:02d}::RAIL-{side:+d}::L0",a+off,b+off,rail,rail,system_id,"b1_data_cable_tray",0)
        rung_count=max(1,min(8,int(L/2.0)))
        for r in range(1,rung_count+1):
            t=r/(rung_count+1);p=a+d*t
            p1=p-perp*(width/2);p2=p+perp*(width/2)
            add_oriented_box(f"{prefix}::SEG-{i:02d}::RUNG-{r:02d}::L0",p1,p2,rail*.8,rail*.65,system_id,"b1_data_cable_tray",0)

def add_valve(name,p,system_id,radius_ft):
    p=vec3(p)
    body=trimesh.creation.icosphere(subdivisions=1,radius=radius_ft*1.45*FT)
    body.apply_translation(p*FT)
    record_mesh(name+"::BODY::L0",body,system_id,"b1_valve",0)
    add_oriented_box(name+"::HANDLE::L0",p+[-radius_ft*2.2,0,radius_ft*2],p+[radius_ft*2.2,0,radius_ft*2],radius_ft*.45,radius_ft*.45,system_id,"b1_valve",0)

def add_gateway(name,spec,system_id):
    b=spec["bounds"]
    add_box(name+"::CABINET::L0",tuple(b),B1_Z+spec["z0_ft"],spec["height_ft"],system_id,"b1_gateway",0)
    add_box(name+"::STATUS::L0",(b[0]+.16,b[1]-.08,b[2]-.16,b[1]+.06),B1_Z+spec["z0_ft"]+.55,spec["height_ft"]-.9,system_id,"b1_gateway",0)

def globalize(points): return [[p[0],p[1],B1_Z+p[2]] for p in points]

alloc=[x for x in RISERS["sub_riser_envelopes_ft"] if x["system_id"]]
alloc_by_system={x["system_id"]:x for x in alloc}
sep=next(x for x in RISERS["sub_riser_envelopes_ft"] if x["id"]=="R-SEPARATION-BAND")

add_box(
    "SVC-SEPARATION::STAIR-A-BUFFER",
    (sep["bounds"]["x1"],sep["bounds"]["y1"],sep["bounds"]["x2"],sep["bounds"]["y2"]),
    LEVEL_Z[0]+.08,(LEVEL_Z[7]-LEVEL_Z[0])-.16,
    "SEPARATION","separation_buffer"
)

riser_segments=0
takeoffs=0
modeled_systems=set()
handoff_points={}
for a in alloc:
    sid=a["system_id"]
    b=a["bounds"]
    bounds=(b["x1"],b["y1"],b["x2"],b["y2"])
    modeled_systems.add(sid)
    for lo,hi in zip(LEVELS[:-1],LEVELS[1:]):
        l0=int(lo["level"]);l1=int(hi["level"])
        z0=float(lo["finished_floor_elevation_ft"])+.08
        z1=float(hi["finished_floor_elevation_ft"])+.08
        add_box(f"SVC-RISER::{sid}::SEG-L{l0}-L{l1}",bounds,z0,z1-z0+.10,sid,"vertical_riser_segment",l0)
        riser_segments+=1
    served=set(int(x) for x in SYSTEMS[sid]["serves_levels"])
    cx=(b["x1"]+b["x2"])/2;cy=(b["y1"]+b["y2"])/2
    stub_h=.24;stub_half=min(.22,max(.12,(b["y2"]-b["y1"])*.22))
    for level in sorted(served):
        if level not in LEVEL_Z: continue
        z=LEVEL_Z[level]+10.9 if level<7 else LEVEL_Z[level]+1.1
        add_box(f"SVC-TAKEOFF::{sid}::L{level}",(49.15,cy-stub_half,cx,cy+stub_half),z,stub_h,sid,"floor_handoff_stub",level)
        if level==0: handoff_points[sid]=[49.15,cy,z-LEVEL_Z[0]]
        takeoffs+=1

for level,z in LEVEL_Z.items():
    add_box(f"SVC-LEVEL-BAND::L{level}",(49.0,65.82,59.0,66.0),z+.03,.10,"SEPARATION","level_marker",level)

source_connections=0
source_equipment_ids=set()
connection_systems=set()
for conn in B1_CONNECTIONS["connections"]:
    sid=conn["system_id"]
    if sid in connection_systems:
        raise ValueError(f"duplicate B1 source connection for {sid}")
    connection_systems.add(sid)
    source_equipment_ids.update(conn["source_equipment_ids"])
    for path in conn["paths"]:
        pts=globalize(path["points_ft"])
        prefix=f"SVC-B1-DIST::{sid}::{path['id']}"
        g=path["geometry"]
        if g in ("duct","busway"):
            add_box_path(prefix,pts,path["section_ft"],sid,"b1_"+g)
        elif g=="cable_tray":
            add_cable_tray(prefix,pts,path["width_ft"],path["rail_ft"],sid)
        elif g=="conduit_bundle":
            add_conduit_bundle(prefix,pts,path["radius_ft"],path["count"],path["spacing_ft"],sid)
        elif g in ("pipe","control_conduit"):
            add_pipe_path(prefix,pts,path["radius_ft"],sid,"b1_"+g)
        else:
            raise ValueError(f"unknown Step 3 geometry family {g}")
        p=vec3(pts[0]);r=max(float(path.get("radius_ft",.12)),.12)
        if g in ("duct","busway","cable_tray"):
            w=float(path.get("width_ft",path.get("section_ft",[.4])[0]))
            add_box(f"SVC-B1-SOURCE::{sid}::{path['id']}::INTERFACE::L0",(p[0]-w*.35,p[1]-w*.35,p[0]+w*.35,p[1]+w*.35),p[2]-.15,.3,sid,"b1_source_interface",0)
        else:
            m=trimesh.creation.icosphere(subdivisions=1,radius=r*1.35*FT);m.apply_translation(p*FT)
            record_mesh(f"SVC-B1-SOURCE::{sid}::{path['id']}::INTERFACE::L0",m,sid,"b1_source_interface",0)
    for i,b in enumerate(conn.get("service_clearances_ft",[])):
        add_box(f"SVC-B1-CLEARANCE::{sid}::{i+1}::L0",tuple(b),B1_Z+.04,.08,sid,"b1_service_clearance",0,"SEPARATION")
    for i,p in enumerate(conn.get("valves_ft",[])):
        radius=max(x.get("radius_ft",.14) for x in conn["paths"] if x["geometry"]=="pipe")
        add_valve(f"SVC-B1-VALVE::{sid}::{i+1}",[p[0],p[1],B1_Z+p[2]],sid,radius)
    if "gateway_panel_ft" in conn:
        add_gateway(f"SVC-B1-GATEWAY::{sid}",conn["gateway_panel_ft"],sid)
    source_connections+=1

checks=[]
def ck(name,ok,detail=""): checks.append({"name":name,"passed":bool(ok),"detail":str(detail)})

def inside_shared(b):
    return b["x1"]>=SHARED["x1"] and b["x2"]<=SHARED["x2"] and b["y1"]>=SHARED["y1"] and b["y2"]<=SHARED["y2"]

def overlap_bounds(a,b):
    return min(a[2],b[2])>max(a[0],b[0]) and min(a[3],b[3])>max(a[1],b[1])

def close3(a,b,tol=.03): return all(abs(float(x)-float(y))<=tol for x,y in zip(a,b))

ck("nine system risers allocated",len(alloc)==9,len(alloc))
ck("all system risers modeled",len(modeled_systems)==9,sorted(modeled_systems))
ck("all allocations inside shared reservation",all(inside_shared(x["bounds"]) for x in alloc))
ck("system riser envelopes do not overlap",all(not overlap_bounds([a["bounds"]["x1"],a["bounds"]["y1"],a["bounds"]["x2"],a["bounds"]["y2"]],[b["bounds"]["x1"],b["bounds"]["y1"],b["bounds"]["x2"],b["bounds"]["y2"]]) for i,a in enumerate(alloc) for b in alloc[i+1:]))
ck("Stair A separation band preserved",sep["bounds"]=={"x1":59.0,"y1":66.0,"x2":60.0,"y2":72.0},sep["bounds"])
ck("vertical service geometry stays west of Stair A boundary",max(r["bounds_ft"][2] for r in records if r["kind"] in ("vertical_riser_segment","floor_handoff_stub"))<60)
ck("seven story segments per system",riser_segments==9*7,riser_segments)
expected_takeoffs=sum(len(set(int(x) for x in SYSTEMS[a["system_id"]]["serves_levels"])) for a in alloc)
ck("all authorized floor handoff stubs modeled",takeoffs==expected_takeoffs,f"{takeoffs}/{expected_takeoffs}")
ck("B1 to roof level markers modeled",sum(1 for r in records if r["kind"]=="level_marker")==8)
ck("floor addenda cover B1 through L7",set(ADDENDA["levels"])=={"B1","F1","F2","F3","F4","F5","F6","L7"},sorted(ADDENDA["levels"]))
ck("source/route/endpoints authority retained",all("origin" in SYSTEMS[a["system_id"]] and "representative_endpoints" in SYSTEMS[a["system_id"]] for a in alloc))

authorized_systems=set(alloc_by_system)
ck("nine B1 source/connection strategies modeled",connection_systems==authorized_systems,sorted(connection_systems))
inv_ids={x["id"] for x in B1_INVENTORY["objects"]}
missing_source_ids=sorted(source_equipment_ids-inv_ids)
ck("all Step 3 source equipment IDs exist in B1 inventory",not missing_source_ids,missing_source_ids)

continuity=[]
for conn in B1_CONNECTIONS["connections"]:
    sid=conn["system_id"]
    last=conn["paths"][-1]["points_ft"][-1]
    riser=alloc_by_system[sid]["bounds"]
    cx=(riser["x1"]+riser["x2"])/2;cy=(riser["y1"]+riser["y2"])/2
    if conn["handoff_mode"]=="step2_floor_handoff":
        target=handoff_points.get(sid)
        continuity.append(bool(target) and close3(last,target))
    elif conn["handoff_mode"]=="stack_base":
        continuity.append(abs(last[0]-cx)<=.03 and abs(last[1]-cy)<=.03 and -.05<=last[2]<=.35)
    else:
        continuity.append(False)
ck("source-to-riser connection continuity",all(continuity),f"{sum(continuity)}/{len(continuity)}")

step3_records=[r for r in records if r["kind"].startswith("b1_")]
sep_bounds=[sep["bounds"]["x1"],sep["bounds"]["y1"],sep["bounds"]["x2"],sep["bounds"]["y2"]]
ck("no Step 3 geometry enters Stair A separation band",all(not overlap_bounds(r["bounds_ft"],sep_bounds) for r in step3_records))
protected=B1_CONNECTIONS["protected_plan_zones_ft"]
clashes=[]
for r in step3_records:
    for z in protected:
        if overlap_bounds(r["bounds_ft"],z["bounds"]): clashes.append(f"{r['name']}->{z['id']}")
ck("no Step 3 geometry blocks protected stair/elevator/tunnel circulation zones",not clashes,clashes[:12])

ck("telecom equipment connects to DATA",next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="DATA-STRUCTURED")["riser_id"]=="R-DATA")
ck("BAS source connects to BAS-CONTROLS",next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="BAS-CONTROLS")["riser_id"]=="R-CONTROLS")
normal=next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="ELEC-NORMAL")
emergency=next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="ELEC-EMERGENCY")
ck("normal and emergency power remain distinct",normal["source_equipment_ids"]!=emergency["source_equipment_ids"] and normal["paths"][0]["geometry"]!=emergency["paths"][0]["geometry"])
fire=next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="FIRE-PROTECTION")
water=next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="WATER-DOMESTIC")
ck("fire and domestic water remain distinguishable",fire["paths"][0]["radius_ft"]!=water["paths"][0]["radius_ft"] and COLORS["FIRE-PROTECTION"]!=COLORS["WATER-DOMESTIC"])
ck("storm/sump connects to STORM-DRAINAGE",next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="STORM-DRAINAGE")["riser_id"]=="R-STORM")
ck("HVAC plant connects to HVAC-AIR",next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="HVAC-AIR")["riser_id"]=="R-HVAC")
ck("sanitary remains an internal boundary-only stack connection",B1_CONNECTIONS.get("no_external_site_connections") is True and next(c for c in B1_CONNECTIONS["connections"] if c["system_id"]=="SANITARY-VENT")["handoff_mode"]=="stack_base")
ck("Step 3 adds substantial B1 distribution geometry",len(step3_records)>=70,len(step3_records))
ck("substantial visible nervous-system geometry",len(scene.geometry)>=200,len(scene.geometry))
viewer_text=VIEWER.read_text() if VIEWER.exists() else ""
ck("Services viewer still loads services GLB","equity-uprise-building-services-core-v2.glb" in viewer_text)
ck("Services viewer preserves B1 source equipment during ghost mode","markB1ServiceSources(b1)" in viewer_text and "o.userData.serviceSource" in viewer_text)
ck("direct B1 + Services query remains supported","requestedServices=params.get('services')==='1'" in viewer_text and "requestedFloor=params.get('floor')" in viewer_text)

scene.metadata.update({
    "asset":"equity-uprise-building-services-core-v2",
    "version":"services-step3-b1-plant-v1",
    "not_for_construction":True,
    "shared_service_reservation_ft":SHARED,
    "systems":sorted(modeled_systems),
    "b1_source_connections":sorted(connection_systems),
    "viewer_layer":"Services"
})

glb=scene.export(file_type="glb")
OUT.write_bytes(glb)
sha=hashlib.sha256(glb).hexdigest()
report={
    "schema_version":"1.0.0",
    "asset":"equity-uprise-building-services-core-v2",
    "status":"services-step3-b1-plant-connections",
    "not_for_construction":True,
    "glb_bytes":len(glb),"sha256":sha,"mesh_count":len(scene.geometry),
    "system_risers":len(alloc),"system_risers_modeled":len(modeled_systems),
    "riser_segments":riser_segments,"floor_handoff_stubs":takeoffs,"levels_marked":8,
    "b1_source_connections":source_connections,
    "b1_distribution_meshes":len(step3_records),
    "source_equipment_ids":sorted(source_equipment_ids),
    "shared_reservation_ft":SHARED,"systems":sorted(modeled_systems),
    "checks_total":len(checks),"checks_passed":sum(x["passed"] for x in checks),
    "checks_failed":sum(not x["passed"] for x in checks),"checks":checks,
}
report["passed"]=report["checks_failed"]==0
REPORT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","system_risers","riser_segments","floor_handoff_stubs","b1_source_connections","b1_distribution_meshes","checks_total","checks_passed","checks_failed","passed")},indent=2))
if not report["passed"]:
    raise SystemExit("building services Step 3 verification failed")
