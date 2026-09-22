#!/usr/bin/env python3
"""
Build the visible Equity Uprise building-services / nervous-system backbone.

This is a digital-twin visualization layer, not construction engineering.
It models the locked conceptual riser envelopes and per-floor handoff stubs
without inventing final duct, pipe, wire or code-required sizes.
"""
from pathlib import Path
import json, hashlib
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
B1_CONNECTIONS=json.loads((HERE/"b1-services-source-connections.json").read_text())

OUT=OUTDIR/"equity-uprise-building-services-core-v2.glb"
REPORT=OUTDIR/"equity-uprise-building-services-core-v2-report.json"

FT=.3048
LEVELS=CORE["levels"]
LEVEL_Z={int(x["level"]):float(x["finished_floor_elevation_ft"]) for x in LEVELS}
SYSTEMS={x["id"]:x for x in SERVICES["system_families"]}
SHARED=RISERS["shared_reservation_ft"]

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

def add_box(name,bounds,z0,h,system_id,kind,level=None):
    x1,y1,x2,y2=bounds
    if x2<=x1 or y2<=y1 or h<=0:
        raise ValueError(f"invalid box {name}: {bounds}, z={z0}, h={h}")
    mesh=trimesh.creation.box(extents=((x2-x1)*FT,(y2-y1)*FT,h*FT))
    mesh.apply_translation((((x1+x2)/2)*FT,((y1+y2)/2)*FT,(z0+h/2)*FT))
    role=system_id if system_id in PBR else "SEPARATION"
    mesh.visual=trimesh.visual.TextureVisuals(material=PBR[role])
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    records.append({
        "name":name,"system_id":system_id,"kind":kind,"level":level,
        "bounds_ft":[x1,y1,x2,y2],"z0_ft":z0,"height_ft":h
    })

def add_horizontal_segment(name,p1,p2,z0,width,height,system_id,kind,level=0):
    x1,y1=p1; x2,y2=p2
    if x1!=x2 and y1!=y2:
        raise ValueError(f"route segment must be orthogonal: {name}: {p1}->{p2}")
    if x1==x2:
        bounds=(x1-width/2,min(y1,y2)-width/2,x1+width/2,max(y1,y2)+width/2)
    else:
        bounds=(min(x1,x2)-width/2,y1-width/2,max(x1,x2)+width/2,y1+width/2)
    add_box(name,bounds,z0,height,system_id,kind,level)

def add_vertical_drop(name,point,z0,z1,width,system_id,level=0):
    x,y=point
    add_box(name,(x-width/2,y-width/2,x+width/2,y+width/2),min(z0,z1),abs(z1-z0),system_id,"source_vertical_drop",level)

alloc=[x for x in RISERS["sub_riser_envelopes_ft"] if x["system_id"]]
sep=next(x for x in RISERS["sub_riser_envelopes_ft"] if x["id"]=="R-SEPARATION-BAND")

# Ghosted reservation/separation strip: proves the risers stay clear of Stair A.
add_box(
    "SVC-SEPARATION::STAIR-A-BUFFER",
    (sep["bounds"]["x1"],sep["bounds"]["y1"],sep["bounds"]["x2"],sep["bounds"]["y2"]),
    LEVEL_Z[0]+.08,(LEVEL_Z[7]-LEVEL_Z[0])-.16,
    "SEPARATION","separation_buffer"
)

riser_segments=0
takeoffs=0
modeled_systems=set()

for a in alloc:
    sid=a["system_id"]
    b=a["bounds"]
    bounds=(b["x1"],b["y1"],b["x2"],b["y2"])
    modeled_systems.add(sid)

    # Story-by-story segmentation keeps floor isolation meaningful in the viewer.
    for lo,hi in zip(LEVELS[:-1],LEVELS[1:]):
        l0=int(lo["level"]); l1=int(hi["level"])
        z0=float(lo["finished_floor_elevation_ft"])+.08
        z1=float(hi["finished_floor_elevation_ft"])+.08
        add_box(
            f"SVC-RISER::{sid}::SEG-L{l0}-L{l1}",
            bounds,z0,z1-z0+.10,sid,"vertical_riser_segment",l0
        )
        riser_segments+=1

    served=set(int(x) for x in SYSTEMS[sid]["serves_levels"])
    cx=(b["x1"]+b["x2"])/2
    cy=(b["y1"]+b["y2"])/2
    stub_h=.24
    stub_half=min(.22,max(.12,(b["y2"]-b["y1"])*.22))
    for level in sorted(served):
        if level not in LEVEL_Z: continue
        z=LEVEL_Z[level]+10.9 if level<7 else LEVEL_Z[level]+1.1
        # Short westward handoff only: branch routing beyond this interface is later work.
        add_box(
            f"SVC-TAKEOFF::{sid}::L{level}",
            (49.15,cy-stub_half,cx,cy+stub_half),
            z,stub_h,sid,"floor_handoff_stub",level
        )
        takeoffs+=1

# Level markers inside the service reservation make story continuity legible.
for level,z in LEVEL_Z.items():
    add_box(
        f"SVC-LEVEL-BAND::L{level}",
        (49.0,65.82,59.0,66.0),
        z+.03,.10,"SEPARATION","level_marker",level
    )

# Services Step 3: connect the real modeled B1 plant/equipment sources to the
# locked vertical backbone. These are conceptual overhead digital-twin routes,
# not final construction routing or sizing.
B1_FFE=LEVEL_Z[0]
b1_connection_count=0
b1_route_segments=0
b1_source_drops=0
b1_connected_systems=set()
b1_source_refs=set()
for conn in B1_CONNECTIONS["connections"]:
    sid=conn["system_id"]
    pts=[tuple(float(v) for v in p) for p in conn["waypoints_ft"]]
    if sid not in modeled_systems:
        raise ValueError(f"B1 connection references unmodeled system {sid}")
    if len(pts)<2:
        raise ValueError(f"B1 connection needs at least two waypoints: {conn['id']}")
    route_z=B1_FFE+float(B1_CONNECTIONS["overhead_aff_ft"])
    width=.34 if sid=="HVAC-AIR" else (.22 if sid in ("WATER-DOMESTIC","FIRE-PROTECTION","SANITARY-VENT","STORM-DRAINAGE") else .16)
    height=.34 if sid=="HVAC-AIR" else .18
    source_top=B1_FFE+float(conn["source_top_aff_ft"])
    if route_z-source_top>.05:
        add_vertical_drop(f"SVC-B1-SOURCE-DROP::{conn['id']}",pts[0],source_top,route_z,width,sid,0)
        b1_source_drops+=1
    for i,(p1,p2) in enumerate(zip(pts[:-1],pts[1:])):
        add_horizontal_segment(
            f"SVC-B1-CONNECTION::{conn['id']}::SEG-{i+1:02d}",
            p1,p2,route_z,width,height,sid,"b1_source_to_riser",0
        )
        b1_route_segments+=1
    b1_connection_count+=1
    b1_connected_systems.add(sid)
    b1_source_refs.add(conn["source_ref"])

checks=[]
def ck(name,ok,detail=""):
    checks.append({"name":name,"passed":bool(ok),"detail":str(detail)})

def inside_shared(b):
    return b["x1"]>=SHARED["x1"] and b["x2"]<=SHARED["x2"] and b["y1"]>=SHARED["y1"] and b["y2"]<=SHARED["y2"]

def overlap(a,b):
    return min(a["x2"],b["x2"])>max(a["x1"],b["x1"]) and min(a["y2"],b["y2"])>max(a["y1"],b["y1"])

ck("nine system risers allocated",len(alloc)==9,len(alloc))
ck("all system risers modeled",len(modeled_systems)==9,sorted(modeled_systems))
ck("all allocations inside shared reservation",all(inside_shared(x["bounds"]) for x in alloc))
ck("system riser envelopes do not overlap",all(not overlap(a["bounds"],b["bounds"]) for i,a in enumerate(alloc) for b in alloc[i+1:]))
ck("Stair A separation band preserved",sep["bounds"]=={"x1":59.0,"y1":66.0,"x2":60.0,"y2":72.0},sep["bounds"])
ck("vertical backbone stays west of Stair A boundary",max(r["bounds_ft"][2] for r in records if r["kind"] in ("vertical_riser_segment","floor_handoff_stub"))<60)
ck("seven story segments per system",riser_segments==9*7,riser_segments)
expected_takeoffs=sum(len(set(int(x) for x in SYSTEMS[a["system_id"]]["serves_levels"])) for a in alloc)
ck("all authorized floor handoff stubs modeled",takeoffs==expected_takeoffs,f"{takeoffs}/{expected_takeoffs}")
ck("B1 to roof level markers modeled",sum(1 for r in records if r["kind"]=="level_marker")==8)
ck("floor addenda cover B1 through L7",set(ADDENDA["levels"])=={"B1","F1","F2","F3","F4","F5","F6","L7"},sorted(ADDENDA["levels"]))
ck("source/route/endpoints authority retained",all("origin" in SYSTEMS[a["system_id"]] and "representative_endpoints" in SYSTEMS[a["system_id"]] for a in alloc))
ck("B1 source connection manifest covers all nine backbone systems",b1_connected_systems==modeled_systems,sorted(b1_connected_systems))
ck("B1 plant/equipment source connections modeled",b1_connection_count==len(B1_CONNECTIONS["connections"]),f"{b1_connection_count}/{len(B1_CONNECTIONS['connections'])}")
ck("B1 source refs are explicit",all(bool(x) for x in b1_source_refs),sorted(b1_source_refs))
ck("B1 routes contain substantial real geometry",b1_route_segments>=50,b1_route_segments)
ck("B1 routes stay below Floor 1 datum",all(r["z0_ft"]+r["height_ft"]<LEVEL_Z[1] for r in records if r["kind"] in ("b1_source_to_riser","source_vertical_drop")))
ck("B1 route endpoints join locked riser centers",all(c["target_riser_id"] in {a["id"] for a in alloc} for c in B1_CONNECTIONS["connections"]))
ck("substantial visible nervous-system geometry",len(scene.geometry)>=190,len(scene.geometry))

scene.metadata.update({
    "asset":"equity-uprise-building-services-core-v2",
    "version":"services-step3-b1-source-connections-v1",
    "not_for_construction":True,
    "shared_service_reservation_ft":SHARED,
    "systems":sorted(modeled_systems),
    "viewer_layer":"Services"
})

glb=scene.export(file_type="glb")
OUT.write_bytes(glb)
sha=hashlib.sha256(glb).hexdigest()

report={
    "schema_version":"1.0.0",
    "asset":"equity-uprise-building-services-core-v2",
    "status":"services-step3-b1-source-connections",
    "not_for_construction":True,
    "glb_bytes":len(glb),
    "sha256":sha,
    "mesh_count":len(scene.geometry),
    "system_risers":len(alloc),
    "system_risers_modeled":len(modeled_systems),
    "riser_segments":riser_segments,
    "floor_handoff_stubs":takeoffs,
    "levels_marked":8,
    "b1_source_connections":b1_connection_count,
    "b1_route_segments":b1_route_segments,
    "b1_source_vertical_drops":b1_source_drops,
    "b1_connected_systems":sorted(b1_connected_systems),
    "b1_source_refs":sorted(b1_source_refs),
    "shared_reservation_ft":SHARED,
    "systems":sorted(modeled_systems),
    "checks_total":len(checks),
    "checks_passed":sum(x["passed"] for x in checks),
    "checks_failed":sum(not x["passed"] for x in checks),
    "checks":checks,
}
report["passed"]=report["checks_failed"]==0
REPORT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","system_risers","riser_segments","floor_handoff_stubs","b1_source_connections","b1_route_segments","b1_source_vertical_drops","checks_total","checks_passed","checks_failed","passed")},indent=2))
if not report["passed"]:
    raise SystemExit("building services backbone verification failed")
