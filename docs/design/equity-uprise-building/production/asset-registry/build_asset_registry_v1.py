#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json
from collections import Counter
from copy import deepcopy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
OUT=HERE/"generated"
SCHEMA=HERE/"asset-registry-schema-v1.json"
CONTRACT=HERE/"asset-registry-source-contract-v1.json"
REG=OUT/"equity-uprise-asset-registry-v1.json"
REP=OUT/"equity-uprise-asset-registry-step2-report.json"
ROLES={"digital_only","aggregate_physicalizable","individual_physicalizable","system_semantic","capability_semantic"}
PHYS={"aggregate_physicalizable","individual_physicalizable"}
PUB={"architecture","envelope","circulation","furniture","signage_wayfinding","decor","reservation_zone"}
RESTRICT={"security","life_safety","building_system"}
MAINT={"equipment","device","fixture","life_safety","security","lighting","service_support","display_terminal","vertical_transport"}

def load(rel): return json.loads((ROOT/rel).read_text())
def write(path,data): path.parent.mkdir(parents=True,exist_ok=True); path.write_text(json.dumps(data,indent=2)+"\n")
def canon(data): return json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
def lid(n): return "B1" if n==0 else ("L7" if n==7 else f"F{n}")
def viewer(n): return f"equity-uprise-building-core-v2-3d.html?floor={n}"

def digest(c):
    h=hashlib.sha256(); h.update(b"equity-uprise-asset-registry-step2-v1\0")
    rels=["docs/design/equity-uprise-building/production/asset-registry/asset-registry-schema-v1.json","docs/design/equity-uprise-building/production/asset-registry/asset-registry-source-contract-v1.json"]
    rels += [x["path"] for x in c["source_sets"]["floor_object_inventories"]]
    rels += [c["source_sets"][k]["path"] for k in ("facade_modules","facade_finish_records","service_families","vertical_riser_allocations","building_core_levels","capability_map")]
    for rel in sorted(set(rels)):
        h.update(rel.encode()); h.update(b"\0"); h.update(canon(load(rel))); h.update(b"\0")
    h.update(Path(__file__).read_bytes())
    return "sha256:"+h.hexdigest()

def bounds(v):
    if isinstance(v,dict) and all(k in v for k in ("x1","y1","x2","y2")): return [float(v["x1"]),float(v["y1"]),float(v["x2"]),float(v["y2"])]
    if isinstance(v,list) and len(v)>=4: return [float(x) for x in v[:6]]
def center(v):
    if isinstance(v,dict) and all(k in v for k in ("x","y")):
        a=[float(v["x"]),float(v["y"])]
        if "z" in v:a.append(float(v["z"]))
        return a
    if isinstance(v,list) and len(v)>=2:return [float(x) for x in v[:3]]
def place(p):
    if not isinstance(p,dict): return None,None
    b=bounds(p.get("bounds_ft")) or bounds(p.get("band_ft")); c=center(p.get("center_ft"))
    if c is None and "x_ft" in p and "y_ft" in p:c=[float(p["x_ft"]),float(p["y_ft"])]
    if c is None and "facade_x" in p and "y1" in p and "y2" in p:c=[float(p["facade_x"]),(float(p["y1"])+float(p["y2"]))/2]
    if c is None and "facade_y" in p and "x1" in p and "x2" in p:c=[(float(p["x1"])+float(p["x2"]))/2,float(p["facade_y"])]
    if c is None and "facade" in p and "x1" in p and "x2" in p:
        m=(float(p["x1"])+float(p["x2"]))/2; s=str(p["facade"]).lower()
        if s=="south": c=[m,0.0]; b=b or [float(p["x1"]),0.0,float(p["x2"]),0.0]
        elif s=="north": c=[m,72.0]; b=b or [float(p["x1"]),72.0,float(p["x2"]),72.0]
    if c is None and b:c=[(b[0]+b[2])/2,(b[1]+b[3])/2]
    return c,b

def aclass(cat,label):
    c=(cat or "").lower(); t=label.lower()
    if c in {"architecture","architectural_feature","acoustic_treatment"}:return "architecture"
    if c in {"vertical_circulation","vertical_circulation_interface","architectural_access","door","circulation"}:return "vertical_transport" if "elevator" in t else "circulation"
    if c in {"equipment","instrument"}:return "equipment"
    if c in {"interactive_terminal","terminal","display"}:return "display_terminal"
    if c=="fixture":return "fixture"
    if c=="furniture":return "furniture"
    if c=="life_safety":return "life_safety"
    if c=="security":return "security"
    if c=="lighting":return "lighting"
    if c in {"signage_wayfinding","wayfinding","signage"}:return "signage_wayfinding"
    if c in {"service","building_support","vertical_service"}:return "service_support"
    if c=="mobility_reservation":return "reservation_zone"
    if c in {"decorative_functional","feature"}:return "decor"
    return "other"

def role(o):
    c=str(o.get("category") or "").lower(); t=" ".join(str(o.get(k) or "") for k in ("label","purpose")).lower()
    if c=="mobility_reservation":return "digital_only","spatial reservation is semantic until a physical mobility system is specified"
    if c=="architectural_feature" and "glazing system" in t:return "digital_only","physical envelope identity is carried by facade-module inventory"
    if c in {"equipment","interactive_terminal","terminal","display","instrument","security","fixture","life_safety","door","architectural_access","vertical_service"}:
        return "individual_physicalizable","operational/maintainable item merits instance identity"
    if c=="lighting" and any(k in t for k in ("emergency","warning","beacon","path light","sconce")):
        return "individual_physicalizable","safety/service lighting merits individual inspection identity"
    if c=="building_support" and any(k in t for k in ("drain","lightning")):
        return "individual_physicalizable","inspectable building-support item merits instance identity"
    return "aggregate_physicalizable","record remains aggregate until independent tagging/state/maintenance is required"

def dstatus(impl,auth):
    s=f"{impl or ''} {auth or ''}".lower()
    if "verified" in s or "current_pass" in s:return "verified"
    if "modeled" in s or "implemented" in s or "required_" in s:return "modeled"
    return "conceptual"
def gstatus(r,d,stype):
    if r=="capability_semantic":return "non_geometric"
    if r=="system_semantic" or stype=="building_core_level":return "derived"
    return "verified" if d=="verified" else ("modeled" if d=="modeled" else "conceptual")
def sec(cls,r):
    if cls in RESTRICT or r=="system_semantic":return {"data_classification":"restricted","visibility":"operator","read_roles":["instructor","operator","admin","owner"],"command_roles":[],"live_control_allowed":False,"requires_human_confirmation":True,"audit_required":True}
    if cls in PUB and r!="individual_physicalizable":return {"data_classification":"public","visibility":"public","read_roles":["public","member","instructor","operator","admin","owner"],"command_roles":[],"live_control_allowed":False,"requires_human_confirmation":True,"audit_required":True}
    return {"data_classification":"internal","visibility":"member","read_roles":["member","instructor","operator","admin","owner"],"command_roles":[],"live_control_allowed":False,"requires_human_confirmation":True,"audit_required":True}

def asset(*,aid,label,srid,path,stype,snap,r,cls,cat,atype,zone,lev,ln,c,b,z,pa,qty,idx,rev,auth=None,impl=None,heritage=None,refs=None,scene=None,models=None,vuri=None,systems=None,caps=None,deps=None,stateful=None,why=None):
    physical=r in PHYS; ds=dstatus(impl,auth); pstat="unassigned" if physical else "not_applicable"; comm="not_started" if physical else "not_applicable"; tag="unassigned" if physical else "not_applicable"; operational=r in {"individual_physicalizable","system_semantic"}; refs=list(refs or [])
    return {"asset_id":aid,"label":label,"source_snapshot":deepcopy(snap),
      "identity":{"source_record_id":srid,"instance_index":idx,"instance_count":qty,"physical_tag":{"status":tag,"encoded_asset_id":None,"qr_uri":None,"nfc_uri":None,"deep_link_uri":None,"label_text":None}},
      "classification":{"asset_class":cls,"source_category":cat,"asset_type":atype,"subtype":stype,"physicalization":"deferred" if r=="individual_physicalizable" else ("optional" if r=="aggregate_physicalizable" else "not_applicable"),"registry_role":r},
      "location":{"level_id":lev,"level_number":ln,"zone_id":zone,"coordinate_frame":"core-v2-local-ft" if (ln is not None or c is not None or b is not None) else "non-spatial","placement_authority":pa,"center_ft":c,"bounds_ft":b,"elevation_ft":z,"access_path_ids":[]},
      "authority":{"source_path":path,"source_revision":rev,"authority_status":auth,"implementation_status":impl,"heritage_decision":heritage,"source_refs":refs,"provenance_notes":why,"not_for_construction":True},
      "digital_representation":{"scene_id":scene,"geometry_status":gstatus(r,ds,stype),"model_paths":list(models or []),"model_node_ids":[],"viewer_uri":vuri,"viewer_floor_focus":lev if ln is not None else None},
      "physical_representation":{"physical_status":pstat,"manufacturer":None,"model":None,"serial_number":None,"asset_number":None,"as_built_location":None,"commissioning_status":comm},
      "external_semantics":{"ifc":{"entity_type":None,"global_id":None,"verified":False},"bacnet":{"device_id":None,"object_type":None,"object_instance":None,"object_name":None,"verified":False},"other_bindings":[]},
      "systems":{"system_families":list(systems or []),"capability_ids":list(caps or []),"upstream_asset_ids":[],"downstream_asset_ids":[],"dependency_asset_ids":list(deps or [])},
      "state_model":{"availability_states":["unknown","available","unavailable","maintenance"] if operational else ["not_applicable"],"normal_state":"available" if operational else None,"operating_modes":["normal","maintenance"] if operational else [],"fault_states":[],"alarm_states":[],"state_variables":[]},
      "points":[],
      "training":{"lab_eligible":r in {"individual_physicalizable","system_semantic","capability_semantic"},"observable":bool(stateful),"controllable_modes":["SIMULATION"] if stateful else [],"scenario_refs":[stateful] if stateful else [],"learning_objectives":[],"inspection_steps":[],"failure_modes":[],"reset_behavior":"scenario_reset" if stateful else "not_applicable"},
      "security":sec(cls,r),
      "lifecycle":{"design_status":ds,"physical_status":pstat,"as_built_verified":False,"commissioning_status":comm,"last_verified_revision":rev if ds=="verified" else None},
      "operations":{"service_access_required":r=="individual_physicalizable" and cls in MAINT,"service_access_refs":[],"maintenance_procedure_refs":[],"documentation_refs":[path]+[x for x in refs if x!=path],"replacement_route_refs":[]}}

def decision(stype,path,srid,r,qty,aids,why):return {"source_type":stype,"source_path":path,"source_record_id":srid,"registry_role":r,"quantity":qty,"expanded":len(aids)>1,"asset_ids":aids,"rationale":why}

schema=json.loads(SCHEMA.read_text()); contract=json.loads(CONTRACT.read_text()); rev=digest(contract)
core=load(contract["source_sets"]["building_core_levels"]["path"]); levels={int(x["level"]):x for x in core["levels"]}
assets=[]; decisions=[]
building_glb="docs/design/equity-uprise-building/production/generated/equity-uprise-building-core-v2.glb"
facade_glb="docs/design/equity-uprise-building/production/generated/equity-uprise-facade-core-v2.glb"
services_glb="docs/design/equity-uprise-building/production/generated/equity-uprise-building-services-core-v2.glb"
whole="equity-uprise-building-core-v2-3d.html"

for cfg in contract["source_sets"]["floor_object_inventories"]:
    data=load(cfg["path"]); n=int(cfg["level_number"]); lev=cfg["level_id"]; ffe=float(levels[n]["finished_floor_elevation_ft"])
    for o in data["objects"]:
        rid=o["id"]; label=o.get("label") or rid; qty=int(o.get("quantity",1)); rr,why=role(o); cls=aclass(o.get("category"),label); c,b=place(o.get("placement"))
        common=dict(label=label,srid=rid,path=cfg["path"],stype="floor_object",snap=o,r=rr,cls=cls,cat=o.get("category"),atype=str(o.get("category") or "floor_object"),zone=o.get("zone_id"),lev=lev,ln=n,c=c,b=b,z=ffe,pa="inventory",qty=qty,rev=rev,auth=o.get("authority_status"),impl=o.get("implementation_status"),heritage=o.get("heritage_decision"),refs=o.get("source_refs") or [],scene=data.get("scene_id"),models=[building_glb],vuri=viewer(n),caps=[o["capability_id"]] if o.get("capability_id") else [],stateful=o.get("stateful_ref"),why=why)
        aids=[]
        if rr=="individual_physicalizable" and qty>1:
            for i in range(1,qty+1):
                aid=f"{rid}-I{i:03d}"; aids.append(aid); assets.append(asset(aid=aid,idx=i,**common))
        else:aids=[rid];assets.append(asset(aid=rid,idx=None,**common))
        decisions.append(decision("floor_object",cfg["path"],rid,rr,qty,aids,why))

cfg=contract["source_sets"]["facade_modules"]; data=load(cfg["path"])
for o in data[cfg["key"]]:
    rid=o["id"]; side=str(o.get("elevation") or "").lower(); a,b0=map(float,o.get("span_ft") or [0,0])
    if side=="south":c,b=[(a+b0)/2,0.0],[a,0.0,b0,0.0]
    elif side=="north":c,b=[(a+b0)/2,72.0],[a,72.0,b0,72.0]
    elif side=="east":c,b=[72.0,(a+b0)/2],[72.0,a,72.0,b0]
    elif side=="west":c,b=[0.0,(a+b0)/2],[0.0,a,0.0,b0]
    else:c,b=None,None
    n=int(o.get("level",1)); lev=o.get("level_id") or lid(n); why="facade module inventory is the individual physical envelope authority"
    assets.append(asset(aid=rid,label=f"{side.title()} facade module {o.get('module_index','')}".strip(),srid=rid,path=cfg["path"],stype="facade_module",snap=o,r="individual_physicalizable",cls="envelope",cat=o.get("classification"),atype=str(o.get("classification") or "facade_module"),zone=f"facade:{side}",lev=lev,ln=n,c=c,b=b,z=float(o.get("z0_ft",levels[n]["finished_floor_elevation_ft"])),pa="facade",qty=1,idx=None,rev=rev,auth=data.get("status"),impl="modeled_facade_module",refs=data.get("authority_refs") or [],scene=data.get("scene_id"),models=[facade_glb],vuri=whole,why=why))
    decisions.append(decision("facade_module",cfg["path"],rid,"individual_physicalizable",1,[rid],why))

cfg=contract["source_sets"]["facade_finish_records"]; data=load(cfg["path"])
for o in data[cfg["key"]]:
    rid=o["id"]; qty=int(o.get("quantity",1)); why="finish/assembly record remains aggregate; facade modules carry per-module identity"
    assets.append(asset(aid=rid,label=o.get("description") or rid,srid=rid,path=cfg["path"],stype="facade_finish_record",snap=o,r="aggregate_physicalizable",cls="envelope",cat=o.get("category"),atype=str(o.get("category") or "facade_finish"),zone=f"facade:{o.get('location') or 'building'}",lev="BUILDING",ln=None,c=None,b=None,z=None,pa="facade",qty=qty,idx=None,rev=rev,auth=o.get("authority_status") or data.get("status"),impl=o.get("implementation_status"),refs=data.get("authority_refs") or [],scene=data.get("scene_id"),models=[facade_glb],vuri=whole,why=why))
    decisions.append(decision("facade_finish_record",cfg["path"],rid,"aggregate_physicalizable",qty,[rid],why))

cfg=contract["source_sets"]["service_families"]; data=load(cfg["path"])
for o in data[cfg["key"]]:
    rid=o["id"]; why="service family is a semantic system identity; physical equipment remains separate assets"
    assets.append(asset(aid=rid,label=o.get("label") or rid,srid=rid,path=cfg["path"],stype="service_family",snap=o,r="system_semantic",cls="building_system",cat="service_family",atype="service_family",zone="building_services",lev="BUILDING",ln=None,c=None,b=None,z=None,pa="services",qty=1,idx=None,rev=rev,auth=data.get("status"),impl=data.get("current_implementation_phase"),refs=[x for x in (data.get("floor_addenda_ref"),data.get("services_report")) if x],scene="equity-uprise-building-services-core-v2",models=[services_glb],vuri=whole+"?services=1",systems=[rid],deps=list(o.get("dependencies") or []),why=why))
    decisions.append(decision("service_family",cfg["path"],rid,"system_semantic",1,[rid],why))

cfg=contract["source_sets"]["vertical_riser_allocations"]; data=load(cfg["path"])
for o in data[cfg["key"]]:
    rid=o["id"]; b=bounds(o.get("bounds")); c=[(b[0]+b[2])/2,(b[1]+b[3])/2] if b else None; sid=o.get("system_id"); why="riser allocation is a system-semantic reservation, not a fabricated installed assembly"
    assets.append(asset(aid=rid,label=o.get("role") or rid,srid=rid,path=cfg["path"],stype="riser_allocation",snap=o,r="system_semantic",cls="building_system",cat="riser_allocation",atype="riser_allocation",zone="shared_mep_service_reservation",lev="BUILDING",ln=None,c=c,b=b,z=None,pa="services",qty=1,idx=None,rev=rev,auth=data.get("status"),impl="modeled_service_reservation",scene="equity-uprise-building-services-core-v2",models=[services_glb],vuri=whole+"?services=1",systems=[sid] if sid else [],why=why))
    decisions.append(decision("riser_allocation",cfg["path"],rid,"system_semantic",1,[rid],why))

cfg=contract["source_sets"]["capability_map"]; data=load(cfg["path"])
for o in data[cfg["key"]]:
    rid=o["id"]; why="capability is program/application semantics; physical presence belongs to separately identified terminals or equipment"
    assets.append(asset(aid=rid,label=o.get("label") or rid,srid=rid,path=cfg["path"],stype="capability",snap=o,r="capability_semantic",cls="digital_capability",cat="capability",atype="equity_uprise_capability",zone=None,lev="BUILDING",ln=None,c=None,b=None,z=None,pa="capability",qty=1,idx=None,rev=rev,impl=o.get("status"),refs=o.get("source_refs") or [],caps=[rid],why=why))
    decisions.append(decision("capability",cfg["path"],rid,"capability_semantic",1,[rid],why))

cfg=contract["source_sets"]["building_core_levels"]
for o in core[cfg["key"]]:
    rid=o["id"]; n=int(o["level"]); lev=lid(n); why="level record is a spatial/location container, not a discrete taggable physical asset"
    assets.append(asset(aid=rid,label=o.get("name") or rid,srid=rid,path=cfg["path"],stype="building_core_level",snap=o,r="digital_only",cls="architecture",cat="building_level",atype="level_container",zone="whole_level",lev=lev,ln=n,c=[36.0,36.0],b=[0.0,0.0,72.0,72.0],z=float(o["finished_floor_elevation_ft"]),pa="core",qty=1,idx=None,rev=rev,auth=core.get("status"),impl="core_v2_authority",scene="equity-uprise-building-core-v2",models=[building_glb],vuri=viewer(n),why=why))
    decisions.append(decision("building_core_level",cfg["path"],rid,"digital_only",1,[rid],why))

assets.sort(key=lambda x:x["asset_id"]); decisions.sort(key=lambda x:(x["source_type"],x["source_path"],x["source_record_id"]))
ids=[x["asset_id"] for x in assets]
if len(ids)!=len(set(ids)):raise SystemExit("duplicate asset IDs: "+", ".join(sorted(k for k,v in Counter(ids).items() if v>1)[:20]))
rc=Counter(x["classification"]["registry_role"] for x in assets); sc=Counter(x["registry_role"] for x in decisions); cc=Counter(x["classification"]["asset_class"] for x in assets); lc=Counter(x["location"]["level_id"] for x in assets); tc=Counter(x["classification"]["subtype"] for x in assets)
unlocated=[x["asset_id"] for x in assets if x["classification"]["registry_role"] in PHYS and x["location"]["center_ft"] is None and x["location"]["bounds_ft"] is None]
expanded=[d for d in decisions if d["expanded"]]; stateful=[x["asset_id"] for x in assets if x["training"]["scenario_refs"]]
expected=contract["source_sets"]["floor_object_inventory_total"]+sum(contract["source_sets"][k]["expected_records"] for k in ("facade_modules","facade_finish_records","service_families","vertical_riser_allocations","building_core_levels","capability_map"))
checks=[]
def ck(n,p,d):checks.append({"name":n,"passed":bool(p),"detail":d})
ck("all canonical source records classified",len(decisions)==expected,{"actual":len(decisions),"expected":expected});ck("roles approved",set(rc).issubset(ROLES),sorted(rc));ck("asset IDs unique",len(ids)==len(set(ids)),len(ids));ck("56 capability sources semantic",sc["capability_semantic"]==56,sc["capability_semantic"]);ck("14 service + 10 riser sources semantic",sc["system_semantic"]==24,sc["system_semantic"]);ck("Step 3 relationship graph deferred",True,"relationships=[]");ck("no physical tags assigned",all(x["identity"]["physical_tag"]["encoded_asset_id"] is None for x in assets),"");ck("no physical truth invented",all(all(x["physical_representation"][k] is None for k in ("manufacturer","model","serial_number","asset_number","as_built_location")) for x in assets),"");ck("no IFC/BACnet identity invented",all(not x["external_semantics"]["ifc"]["verified"] and not x["external_semantics"]["bacnet"]["verified"] for x in assets),"");ck("no LIVE control enabled",all(not x["security"]["live_control_allowed"] for x in assets),"");ck("zero-loss source snapshots",all(isinstance(x["source_snapshot"],dict) and x["source_snapshot"] for x in assets),"")
passed=all(x["passed"] for x in checks)
registry={"schema_version":"1.1.0","registry_version":"step2-deterministic-ingestion-v1","registry_id":"equity-uprise-digital-physical-asset-registry","building_id":"equity-uprise-core-v2","source_revision":rev,"not_for_construction":True,"safety_policy":{"supported_modes":["SIMULATION","SHADOW","LIVE"],"shadow_writes_allowed":False,"live_control_default":"deny","live_requires_explicit_authorization":True,"simulation_isolated_from_physical_control":True},"assets":assets,"relationships":[],"metadata":{"status":"step2-deterministic-registry-ingestion","source_record_count":len(decisions),"asset_count":len(assets),"role_counts":dict(sorted(rc.items())),"source_role_counts":dict(sorted(sc.items())),"asset_class_counts":dict(sorted(cc.items())),"level_counts":dict(sorted(lc.items())),"source_type_counts":dict(sorted(tc.items())),"expanded_source_records":len(expanded),"unlocated_physicalizable_assets":len(unlocated),"stateful_assets":len(stateful)}}
report={"schema_version":"1.0.0","status":"step2-deterministic-registry-ingestion","source_revision":rev,"source_records_total":len(decisions),"expected_source_records_total":expected,"registry_assets_total":len(assets),"registry_roles":dict(sorted(rc.items())),"source_record_roles":dict(sorted(sc.items())),"asset_classes":dict(sorted(cc.items())),"levels":dict(sorted(lc.items())),"source_types":dict(sorted(tc.items())),"expanded_source_records":len(expanded),"expanded_asset_instances":sum(len(x["asset_ids"]) for x in expanded),"expansion_extra_assets":sum(len(x["asset_ids"])-1 for x in expanded),"unlocated_physicalizable_assets_total":len(unlocated),"unlocated_physicalizable_asset_ids":unlocated,"stateful_assets_total":len(stateful),"stateful_asset_ids":stateful,"physical_tags_assigned":0,"verified_protocol_bindings":0,"as_built_verified_assets":0,"live_control_enabled_assets":0,"relationships_total":0,"source_decisions":decisions,"checks_total":len(checks),"checks_passed":sum(1 for x in checks if x["passed"]),"checks_failed":sum(1 for x in checks if not x["passed"]),"checks":checks,"passed":passed}
write(REG,registry);write(REP,report)
print("EQUITY UPRISE ASSET REGISTRY STEP 2");print(" source records:",len(decisions));print(" registry assets:",len(assets));print(" roles:",dict(sorted(rc.items())));print(" expanded source records:",len(expanded));print(" unlocated physicalizable assets:",len(unlocated));print(f" checks: {report['checks_passed']}/{report['checks_total']}")
if not passed:raise SystemExit("asset registry Step 2 verification failed")
