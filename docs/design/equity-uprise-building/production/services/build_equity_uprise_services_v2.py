#!/usr/bin/env python3
"""
Build the visible Equity Uprise building-services / nervous-system layer.

Services Step 2 established the B1-to-roof vertical backbone. Services Step 3
adds representative B1 source/plant equipment plus source-to-riser distribution
paths that reuse the current detailed-B1 equipment coordinates.

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
B1INV=json.loads((PROD/"basement-b1"/"basement-b1-object-inventory.json").read_text())

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



def _mat(system_id):
    role=system_id if system_id in PBR else "SEPARATION"
    return trimesh.visual.TextureVisuals(material=PBR[role])

def add_cylinder(name,cx,cy,z0,radius,h,system_id,kind,level=0,sections=24,axis="z",extra=None):
    mesh=trimesh.creation.cylinder(radius=radius*FT,height=h*FT,sections=sections)
    if axis=="x":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,[0,1,0]))
        bounds=(cx-h/2,cy-radius,cx+h/2,cy+radius)
        zbase=z0-radius; zheight=radius*2
        mesh.apply_translation((cx*FT,cy*FT,z0*FT))
    elif axis=="y":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi/2,[1,0,0]))
        bounds=(cx-radius,cy-h/2,cx+radius,cy+h/2)
        zbase=z0-radius; zheight=radius*2
        mesh.apply_translation((cx*FT,cy*FT,z0*FT))
    else:
        bounds=(cx-radius,cy-radius,cx+radius,cy+radius)
        zbase=z0; zheight=h
        mesh.apply_translation((cx*FT,cy*FT,(z0+h/2)*FT))
    mesh.visual=_mat(system_id)
    scene.add_geometry(mesh,node_name=name,geom_name=name)
    rec={
        "name":name,"system_id":system_id,"kind":kind,"level":level,
        "bounds_ft":[float(v) for v in bounds],"z0_ft":float(zbase),"height_ft":float(zheight)
    }
    if extra: rec.update(extra)
    records.append(rec)

connection_paths={}
def add_route(system_id,points,z_center,style="pipe",width=.22,height=.22):
    if len(points)<2:
        raise ValueError(f"route {system_id} needs at least two points")
    connection_paths[system_id]=points
    for idx,(a,bb) in enumerate(zip(points[:-1],points[1:])):
        x1,y1=a; x2,y2=bb
        if x1!=x2 and y1!=y2:
            raise ValueError(f"route {system_id} segment {idx} is not orthogonal: {a}->{bb}")
        name=f"SVC-B1-DIST::{system_id}::{idx:02d}"
        if style=="pipe":
            if y1==y2:
                add_cylinder(name,(x1+x2)/2,y1,z_center,width/2,abs(x2-x1),system_id,"b1_distribution",0,20,"x",{"segment_from":a,"segment_to":bb})
            else:
                add_cylinder(name,x1,(y1+y2)/2,z_center,width/2,abs(y2-y1),system_id,"b1_distribution",0,20,"y",{"segment_from":a,"segment_to":bb})
        else:
            if y1==y2:
                bounds=(min(x1,x2),y1-width/2,max(x1,x2),y1+width/2)
            else:
                bounds=(x1-width/2,min(y1,y2),x1+width/2,max(y1,y2))
            add_box(name,bounds,z_center-height/2,height,system_id,"b1_distribution",0)

alloc=[x for x in RISERS["sub_riser_envelopes_ft"] if x["system_id"]]
alloc_by_system={x["system_id"]:x for x in alloc}
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


# SERVICES STEP 3 — B1 source/plant equipment + source-to-riser distribution.
# Coordinates intentionally match the current detailed B1 builder so this layer
# highlights the authoritative equipment locations instead of inventing a second
# basement arrangement.

# HVAC: AHUs/pumps plus rectangular overhead duct/header route.
for suffix,bounds in [("AHU-A",(5,8,13,14)),("AHU-B",(16,8,24,14))]:
    add_box(f"SVC-B1-SOURCE::HVAC-AIR::{suffix}",bounds,B1_Z+.1,4.4,"HVAC-AIR","source_equipment",0)
for j,x in enumerate((8,15,22)):
    add_cylinder(f"SVC-B1-SOURCE::HVAC-AIR::PUMP-{j+1}",x,20,B1_Z+.2,.9,2.2,"HVAC-AIR","source_equipment",0,24,"z",{"inventory_ref":"B1-MECH-PUMP-01"})
add_route("HVAC-AIR",[(24,12),(28,12),(28,60),(51.75,60),(51.75,69)],B1_Z+10.15,"duct",1.10,.72)

# Normal electrical: switchgear + distribution panel + distinct busway.
for k in range(6):
    add_box(f"SVC-B1-SOURCE::ELEC-NORMAL::SWITCHGEAR-{k+1}",(33+k*2.8,7,35.3+k*2.8,9.2),B1_Z+.1,7,"ELEC-NORMAL","source_equipment",0)
add_box("SVC-B1-SOURCE::ELEC-NORMAL::DISTRIBUTION-PANEL",(47,13,50.5,18),B1_Z+.7,6.2,"ELEC-NORMAL","source_equipment",0)
add_route("ELEC-NORMAL",[(49,9.2),(49,61.5),(57.25,61.5),(57.25,67.5)],B1_Z+10.4,"busway",.46,.40)

# Emergency power: UPS-backed equipment only; no generator is invented.
for suffix,bounds in [("UPS-A",(34,13,39,18)),("UPS-B",(40,13,45,18))]:
    add_box(f"SVC-B1-SOURCE::ELEC-EMERGENCY::{suffix}",bounds,B1_Z+.1,5.5,"ELEC-EMERGENCY","source_equipment",0)
add_route("ELEC-EMERGENCY",[(45,16),(47.5,16),(47.5,63),(57.25,63),(57.25,70.5)],B1_Z+9.72,"conduit",.30,.30)

# Structured data: racks, ladder-tray source, and backbone pathway.
for j,(x,y) in enumerate(((35,26),(39,26),(43,26),(47,26))):
    add_box(f"SVC-B1-SOURCE::DATA-STRUCTURED::RACK-{j+1}",(x-1.1,y-1.5,x+1.1,y+1.5),B1_Z+.1,7.5,"DATA-STRUCTURED","source_equipment",0)
add_box("SVC-B1-SOURCE::DATA-STRUCTURED::TRAY-L",(33,30.45,51,30.62),B1_Z+8.7,.35,"DATA-STRUCTURED","source_equipment",0)
add_box("SVC-B1-SOURCE::DATA-STRUCTURED::TRAY-R",(33,31.08,51,31.25),B1_Z+8.7,.35,"DATA-STRUCTURED","source_equipment",0)
for j,x in enumerate((34,37,40,43,46,49)):
    add_box(f"SVC-B1-SOURCE::DATA-STRUCTURED::TRAY-RUNG-{j}",(x-.08,30.55,x+.08,31.15),B1_Z+8.73,.18,"DATA-STRUCTURED","source_equipment",0)
add_route("DATA-STRUCTURED",[(51,30.85),(52.5,30.85),(52.5,62),(58.5,62),(58.5,67.5)],B1_Z+10.05,"cable_tray",.62,.28)

# BAS/controls: Building Systems Lab panel/gateway + controls raceway.
add_box("SVC-B1-SOURCE::BAS-CONTROLS::PANEL",(46,40.0,49,40.45),B1_Z+3.0,2.5,"BAS-CONTROLS","source_equipment",0)
add_box("SVC-B1-SOURCE::BAS-CONTROLS::GATEWAY",(48.6,38.1,50.0,39.4),B1_Z+2.7,1.3,"BAS-CONTROLS","source_equipment",0)
add_route("BAS-CONTROLS",[(49.2,40.25),(52.25,40.25),(52.25,64),(58.5,64),(58.5,70.5)],B1_Z+9.35,"controls_raceway",.20,.20)

# Fire protection: authorized pump/backflow/valve equipment + fire header.
add_box("SVC-B1-SOURCE::FIRE-PROTECTION::PUMP-BASE",(56,8,62,14),B1_Z+.15,.6,"FIRE-PROTECTION","source_equipment",0)
add_cylinder("SVC-B1-SOURCE::FIRE-PROTECTION::PUMP",59,11,B1_Z+.75,1.2,2.4,"FIRE-PROTECTION","source_equipment",0)
add_cylinder("SVC-B1-SOURCE::FIRE-PROTECTION::VALVE-A",64.2,11,B1_Z+3.2,.38,1.2,"FIRE-PROTECTION","source_equipment",0)
add_cylinder("SVC-B1-SOURCE::FIRE-PROTECTION::VALVE-B",66.0,11,B1_Z+3.2,.38,1.2,"FIRE-PROTECTION","source_equipment",0)
add_route("FIRE-PROTECTION",[(59,14),(52.4,14),(52.4,64.5),(54.25,64.5),(54.25,67.5)],B1_Z+9.15,"pipe",.34,.34)

# Domestic water: distinct blue backflow/manifold/header to its own riser.
add_cylinder("SVC-B1-SOURCE::WATER-DOMESTIC::BACKFLOW-BODY",66,11,B1_Z+.1,2.0,6.2,"WATER-DOMESTIC","source_equipment",0)
add_cylinder("SVC-B1-SOURCE::WATER-DOMESTIC::MANIFOLD",64.5,16,B1_Z+6.9,.24,4.0,"WATER-DOMESTIC","source_equipment",0,20,"x")
add_route("WATER-DOMESTIC",[(66,16),(52.8,16),(52.8,65.0),(54.25,65.0),(54.25,70.5)],B1_Z+8.55,"pipe",.26,.26)

# Sanitary/vent: internal B1 header only; no municipal/site connection.
add_cylinder("SVC-B1-SOURCE::SANITARY-VENT::B1-HEADER",48.5,52,B1_Z+8.1,.22,16.0,"SANITARY-VENT","source_equipment",0,20,"y")
add_route("SANITARY-VENT",[(48.5,60),(48.5,64),(55.75,64),(55.75,67.5)],B1_Z+8.1,"pipe",.44,.44)

# Storm/sump: current sump pumps + flood sensor interface; no external discharge.
for j,x in enumerate((58,66)):
    add_cylinder(f"SVC-B1-SOURCE::STORM-DRAINAGE::SUMP-PUMP-{j+1}",x,27,B1_Z+.1,.55,2.2,"STORM-DRAINAGE","source_equipment",0)
add_box("SVC-B1-SOURCE::STORM-DRAINAGE::FLOOD-SENSOR",(55.2,30,58,31.7),B1_Z+2.5,3.4,"STORM-DRAINAGE","source_equipment",0)
add_route("STORM-DRAINAGE",[(58,30),(52.1,30),(52.1,62.7),(55.75,62.7),(55.75,70.5)],B1_Z+7.55,"pipe",.38,.38)

# Small collars make the final source-to-riser handoff visually legible.
for sid,path in connection_paths.items():
    a=alloc_by_system[sid]["bounds"]
    cx=(a["x1"]+a["x2"])/2; cy=(a["y1"]+a["y2"])/2
    add_box(f"SVC-B1-CONNECTION::{sid}::RISER-COLLAR",(cx-.16,cy-.16,cx+.16,cy+.16),B1_Z+9.0,.9,sid,"b1_riser_connection",0)

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
ck("vertical service geometry stays west of Stair A boundary",max(a["bounds"]["x2"] for a in alloc)<60)
ck("seven story segments per system",riser_segments==9*7,riser_segments)
expected_takeoffs=sum(len(set(int(x) for x in SYSTEMS[a["system_id"]]["serves_levels"])) for a in alloc)
ck("all authorized floor handoff stubs modeled",takeoffs==expected_takeoffs,f"{takeoffs}/{expected_takeoffs}")
ck("B1 to roof level markers modeled",sum(1 for r in records if r["kind"]=="level_marker")==8)
ck("floor addenda cover B1 through L7",set(ADDENDA["levels"])=={"B1","F1","F2","F3","F4","F5","F6","L7"},sorted(ADDENDA["levels"]))
ck("source/route/endpoints authority retained",all("origin" in SYSTEMS[a["system_id"]] and "representative_endpoints" in SYSTEMS[a["system_id"]] for a in alloc))
ck("substantial visible nervous-system geometry",len(scene.geometry)>=190,len(scene.geometry))


required_systems={x["system_id"] for x in alloc}
ck("Step 3 authority covers all nine backbone systems",set(SOURCE_CONNECTIONS)==required_systems,sorted(SOURCE_CONNECTIONS))
inv_ids={x["id"] for x in B1INV["objects"]}
source_refs={ref for c in SOURCE_CONNECTIONS.values() for ref in c.get("source_equipment_refs",[])}
ck("Step 3 source equipment reuses authorized B1 inventory",source_refs<=inv_ids,sorted(source_refs-inv_ids))
modeled_source_systems={r["system_id"] for r in records if r["kind"]=="source_equipment"}
ck("required B1 source equipment families modeled",modeled_source_systems==required_systems,sorted(modeled_source_systems))
ck("all nine source-to-riser paths modeled",set(connection_paths)==required_systems,sorted(connection_paths))

def point_inside(bounds,pt):
    return bounds["x1"]<=pt[0]<=bounds["x2"] and bounds["y1"]<=pt[1]<=bounds["y2"]

ck("source-to-riser connection continuity",all(point_inside(alloc_by_system[sid]["bounds"],pts[-1]) for sid,pts in connection_paths.items()),{sid:pts[-1] for sid,pts in connection_paths.items()})

def bounds_overlap(a,bb):
    return min(a[2],bb[2])>max(a[0],bb[0]) and min(a[3],bb[3])>max(a[1],bb[1])

forbidden={
    "Stair A":(60,54,72,72),
    "Stair B":(8,54,18,72),
    "passenger elevator":(54,34,62,44),
    "freight/service elevator":(0,60,8,72),
}
b1_service=[r for r in records if r["kind"] in {"source_equipment","b1_distribution","b1_riser_connection"}]
clashes=[]
for r in b1_service:
    for label,bb in forbidden.items():
        if bounds_overlap(r["bounds_ft"],bb):
            clashes.append((r["name"],label))
ck("B1 services avoid protected stair/elevator zones",not clashes,clashes[:20])

sep_bounds=(sep["bounds"]["x1"],sep["bounds"]["y1"],sep["bounds"]["x2"],sep["bounds"]["y2"])
sep_hits=[r["name"] for r in b1_service if bounds_overlap(r["bounds_ft"],sep_bounds)]
ck("B1 service geometry does not enter Stair A separation band",not sep_hits,sep_hits)

route_bottoms=[r["z0_ft"]-B1_Z for r in records if r["kind"]=="b1_distribution"]
ck("B1 distribution remains overhead of primary circulation",min(route_bottoms)>=7.25,min(route_bottoms))
ck("telecom equipment connects to DATA",SOURCE_CONNECTIONS.get("DATA-STRUCTURED",{}).get("connection_target_riser")=="R-DATA" and "DATA-STRUCTURED" in connection_paths)
ck("BAS source connects to BAS-CONTROLS",SOURCE_CONNECTIONS.get("BAS-CONTROLS",{}).get("connection_target_riser")=="R-CONTROLS" and "BAS-CONTROLS" in connection_paths)
ck("normal and emergency power remain distinct",connection_paths.get("ELEC-NORMAL")!=connection_paths.get("ELEC-EMERGENCY") and SOURCE_CONNECTIONS.get("ELEC-NORMAL",{}).get("connection_target_riser")!=SOURCE_CONNECTIONS.get("ELEC-EMERGENCY",{}).get("connection_target_riser"))
ck("fire and domestic water remain distinguishable",SOURCE_CONNECTIONS.get("FIRE-PROTECTION",{}).get("connection_target_riser")=="R-FIRE" and SOURCE_CONNECTIONS.get("WATER-DOMESTIC",{}).get("connection_target_riser")=="R-WATER")
ck("storm/sump connects to STORM-DRAINAGE",SOURCE_CONNECTIONS.get("STORM-DRAINAGE",{}).get("connection_target_riser")=="R-STORM" and "STORM-DRAINAGE" in connection_paths)
ck("HVAC plant connects to HVAC-AIR",SOURCE_CONNECTIONS.get("HVAC-AIR",{}).get("connection_target_riser")=="R-HVAC" and "HVAC-AIR" in connection_paths)

viewer=HERE.parents[4]/"equity-uprise-building-core-v2-3d.html"
if viewer.exists():
    vt=viewer.read_text()
    ck("Services viewer still loads canonical asset","equity-uprise-building-services-core-v2.glb" in vt)
    ck("Services viewer exposes B1 source geometry","SVC-B1-" in vt and "requestedServices" in vt)

scene.metadata.update({
    "asset":"equity-uprise-building-services-core-v2",
    "version":"services-step3-b1-source-connected-v1",
    "not_for_construction":True,
    "shared_service_reservation_ft":SHARED,
    "systems":sorted(modeled_systems),
    "b1_source_systems":sorted(modeled_source_systems),
    "viewer_layer":"Services"
})

glb=scene.export(file_type="glb")
OUT.write_bytes(glb)
sha=hashlib.sha256(glb).hexdigest()

report={
    "schema_version":"1.1.0",
    "asset":"equity-uprise-building-services-core-v2",
    "status":"services-step3-b1-source-connected",
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
    "shared_reservation_ft":SHARED,
    "systems":sorted(modeled_systems),
    "checks_total":len(checks),
    "checks_passed":sum(x["passed"] for x in checks),
    "checks_failed":sum(not x["passed"] for x in checks),
    "checks":checks,
}
report["passed"]=report["checks_failed"]==0
REPORT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("glb_bytes","mesh_count","system_risers","riser_segments","floor_handoff_stubs","b1_source_equipment_meshes","b1_distribution_segments","b1_riser_connections","checks_total","checks_passed","checks_failed","passed")},indent=2))
if not report["passed"]:
    raise SystemExit("building services Step 3 verification failed")
