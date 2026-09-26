#!/usr/bin/env python3
from __future__ import annotations
import os, sys

# trimesh's GLB exporter traverses hash-backed scene structures. Pin the
# interpreter hash seed before importing/building the scene so generated GLB
# JSON ordering is reproducible across CI/local processes.
if os.environ.get("PYTHONHASHSEED") != "0":
    os.environ["PYTHONHASHSEED"] = "0"
    os.execv(sys.executable, [sys.executable, *sys.argv])

import hashlib,json,math
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
POLICY=HERE/"electronics-population-policy-v1.json"
DEVICE_ARCHETYPES=HERE/"device-archetypes-v1.json"
OUT=HERE/"generated"
REG=ROOT/"docs/design/equity-uprise-building/production/asset-registry/generated/equity-uprise-asset-registry-v1.json"
STEP3B=ROOT/"docs/design/equity-uprise-building/production/asset-registry/generated/equity-uprise-asset-registry-step3b-report.json"
CORE=ROOT/"docs/design/equity-uprise-building/production/building-core-v2.json"
MANIFEST=OUT/"equity-uprise-electronics-manifest-v1.json"
CONNECTIONS=OUT/"equity-uprise-electronics-connections-v1.json"
LABS=OUT/"equity-uprise-it-lab-catalog-v1.json"
REPORT=OUT/"equity-uprise-electronics-step4a-report.json"
GLB=OUT/"equity-uprise-electronics-fabric-v1.glb"
DEVICE_COMPONENTS=OUT/"equity-uprise-device-components-v1.json"
SOURCE_REL="docs/design/equity-uprise-building/production/electronics/electronics-population-policy-v1.json"
MODEL_REL="docs/design/equity-uprise-building/production/electronics/generated/equity-uprise-electronics-fabric-v1.glb"
FLOOR_INVENTORIES={
  0:"docs/design/equity-uprise-building/production/basement-b1/basement-b1-object-inventory.json",
  1:"docs/design/equity-uprise-building/production/floor-01/floor-01-object-inventory.json",
  2:"docs/design/equity-uprise-building/production/floor-02/floor-02-object-inventory.json",
  3:"docs/design/equity-uprise-building/production/floor-03/floor-03-object-inventory.json",
  4:"docs/design/equity-uprise-building/production/floor-04/floor-04-object-inventory.json",
  5:"docs/design/equity-uprise-building/production/floor-05/floor-05-object-inventory.json",
  6:"docs/design/equity-uprise-building/production/floor-06/floor-06-object-inventory.json",
  7:"docs/design/equity-uprise-building/production/floor-07/floor-07-object-inventory.json",
}

def load(p): return json.loads(Path(p).read_text())
def write(p,d): p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(d,indent=2)+"\n")
def uniq(xs): return sorted(set(x for x in xs if x))
def lid(n): return "B1" if n==0 else ("L7" if n==7 else f"F{n}")
def viewer(n): return f"_unfinished/equity-uprise/equity-uprise-building-core-v2-3d.html?floor={n}&services=1"
def clamp(v,a,b): return max(a,min(b,v))

policy=load(POLICY)
device_archetypes=load(DEVICE_ARCHETYPES)
registry=load(REG)
if registry.get("registry_version")!="step3b-floor-branch-endpoint-graph-v1":
    raise SystemExit("Step 4A requires the Step 3B registry")
step3b=load(STEP3B)
core=load(CORE)
levels={int(x["level"]):x for x in core["levels"]}
source_rev="sha256:"+hashlib.sha256(POLICY.read_bytes()).hexdigest()
assets=registry["assets"]
relationships=list(registry.get("relationships",[]))
by_id={a["asset_id"]:a for a in assets}
new_assets=[]
new_relationships=[]
connections=[]
wireless_links=[]
transient_profiles=[]
positions={}
device_component_records=[]
connection_counter=0
rel_counter=0

trace_xy={}
for t in step3b.get("lab_trace_records",[]):
    xy=t.get("modeled_connection_xy_ft")
    for aid in t.get("endpoint_asset_ids",[]):
        if xy and aid not in trace_xy: trace_xy[aid]=[float(xy[0]),float(xy[1])]

floor_objects={}
for n,path in FLOOR_INVENTORIES.items():
    floor_objects[n]=load(ROOT/path).get("objects",[])

def ffe(n): return float(levels[n]["finished_floor_elevation_ft"])
def pos(n,x,y,z=4.0): return [float(x),float(y),ffe(n)+float(z)]

# Step 4B installation anchors. These reference the approved floor inventories;
# no device may use an arbitrary whole-floor fallback when a real room/object
# anchor with geometry is available.
ANCHOR_IDS={
  0:{
    "work":["B1-TELECOM-CONSOLE-01","B1-LAB-TABLE-01","B1-OPS-DESK-01"],
    "security":["B1-OPS-GATE-01","B1-LOCK-PANEL-01","B1-EMERGENCY-COMMS-01"],
    "ceiling":["B1-TELECOM-ROOM-01","B1-LAB-ZONE-01","B1-OPS-ZONE-01","B1-STAGING-ZONE-01"],
    "av":["B1-LAB-DASHBOARD-01","B1-OPS-STATUS-01","B1-OPS-OCCUPANCY-01"],
    "fire":["B1-FIRE-RISER-01","B1-FIRE-PUMP-01"],
  },
  1:{
    "work":["F1-RECEPTION-MONITOR-01","F1-PASSPORT-TABLE-01","F1-PASSPORT-TABLE-02","F1-INTAKE-TABLE-01"],
    "security":["F1-ENTRY-DOOR-INNER","F1-RECEPTION-DESK-01","F1-PASS-ELEV-CALL-01","F1-STAIR-A-BARRIER-DOWN","F1-STAIR-B-BARRIER-DOWN"],
    "ceiling":["F1-ARRIVAL-INSET-01","F1-LOUNGE-RUG-01","F1-INTAKE-TABLE-01","F1-PASSPORT-TABLE-01"],
    "av":["F1-JOURNEY-DISPLAY-01","F1-JOURNEY-DISPLAY-02","F1-JOURNEY-DISPLAY-03","F1-JOURNEY-DISPLAY-04","F1-INTAKE-DISPLAY-01","F1-LOUNGE-DISPLAY-01"],
    "fire":["F1-FE-01","F1-FE-02"],
  },
  2:{
    "work":["F2-FORUM-TABLE-01","F2-MEMBER-CHECKIN-01","F2-LOUNGE-TABLE-01"],
    "security":["F2-MEMBER-CHECKIN-01","F2-FREIGHT-CONTROL-01"],
    "ceiling":["F2-FORUM-TABLE-01","F2-LOUNGE-RUG-01","F2-MEMBER-CHECKIN-01"],
    "av":["F2-DISPLAY-CURRENT-ISSUES","F2-DISPLAY-PERSPECTIVES","F2-DISPLAY-OPPORTUNITIES","F2-TALK-INTERFACE-01"],
    "fire":["F2-FE-WEST-01","F2-FE-EAST-01"],
  },
  3:{
    "work":["F3-OPPORTUNITY-TABLE-01","F3-INTERVIEW-A-TABLE-01","F3-INTERVIEW-B-TABLE-01","F3-MEMBER-CHECKIN-01"],
    "security":["F3-MEMBER-CHECKIN-01","F3-INTERVIEW-A-DOOR-01","F3-INTERVIEW-B-DOOR-01","F3-FREIGHT-CONTROL-01"],
    "ceiling":["F3-OPPORTUNITY-TABLE-01","F3-LOUNGE-RUG-01","F3-INTERVIEW-A-TABLE-01","F3-INTERVIEW-B-TABLE-01"],
    "av":["F3-DISPLAY-MATCH","F3-DISPLAY-PEOPLE","F3-DISPLAY-APPLICATIONS","F3-PEOPLE-DISPLAY-01","F3-INTERVIEW-A-DISPLAY-01","F3-INTERVIEW-B-DISPLAY-01"],
    "fire":["F3-FE-WEST-01","F3-FE-EAST-01"],
  },
  4:{
    "work":["F4-EDIT-DESK-01","F4-RECORDING-WORKSURFACE-01","F4-LISTENING-TABLE-01","F4-FLOOR-CONTROL-01"],
    "security":["F4-RECORDING-DOOR-01","F4-EDIT-DOOR-01","F4-FLOOR-CONTROL-01","F4-FREIGHT-CONTROL-01"],
    "ceiling":["F4-LISTENING-TABLE-01","F4-RECORDING-WORKSURFACE-01","F4-EDIT-DESK-01","F4-GALLERY-TABLE-01"],
    "av":["F4-DISPLAY-LISTEN","F4-DISPLAY-WATCH","F4-DISPLAY-ARCHIVE","F4-RECORDING-MONITOR-01","F4-EDIT-DISPLAY-01","F4-MIC-STAND-01"],
    "fire":["F4-FE-WEST-01","F4-FE-EAST-01"],
  },
  5:{
    "work":["F5-POLICY-TABLE-01","F5-SOURCE-TABLE-01","F5-PUB-TABLE-01","F5-PUB-WORKSTATION-01","F5-ARCHIVE-TABLE-01"],
    "security":["F5-SOURCE-DOOR-01","F5-PUB-DOOR-01","F5-NAVIGATOR-01","F5-FREIGHT-CONTROL-01"],
    "ceiling":["F5-POLICY-TABLE-01","F5-SOURCE-TABLE-01","F5-PUB-TABLE-01","F5-ARCHIVE-TABLE-01"],
    "av":["F5-DISPLAY-RESEARCH","F5-DISPLAY-EVIDENCE","F5-DISPLAY-RECORD","F5-SOURCE-DISPLAY-01","F5-PUB-DISPLAY-01","F5-ARCHIVE-SEARCH-01"],
    "fire":["F5-FE-WEST-01","F5-FE-EAST-01"],
  },
  6:{
    "work":["F6-COMMAND-TABLE-01","F6-STRATEGY-TABLE-01","F6-BRIEFING-TABLE-01","F6-ROOF-TRANSITION-01"],
    "security":["F6-STRATEGY-DOOR-01","F6-BRIEFING-DOOR-01","F6-ROOF-TRANSITION-01","F6-FREIGHT-CONTROL-01"],
    "ceiling":["F6-COMMAND-TABLE-01","F6-STRATEGY-TABLE-01","F6-BRIEFING-TABLE-01","F6-SALON-TABLE-01"],
    "av":["F6-DISPLAY-NOW","F6-DISPLAY-PAST","F6-DISPLAY-JOIN","F6-STRATEGY-DISPLAY-01","F6-BRIEFING-DISPLAY-01","F6-HALO-GLOBE-01"],
    "fire":["F6-FE-WEST-01","F6-FE-EAST-01"],
  },
  7:{
    "work":["F7-ECOSYSTEM-BEACON-01","F7-RETURN-HOME-01","F7-UPRISE-WORLD-PORTAL-01"],
    "security":["F7-STAIR-A-DOOR-01","F7-STAIR-B-DOOR-01","F7-PASSENGER-OVERRUN-01"],
    "ceiling":["F7-ROOF-DECK-01","F7-MEP-SCREEN-01","F7-MOBILITY-FIELD-01"],
    "av":["F7-ECOSYSTEM-DISPLAY-01","F7-ROUTE-ACCESS-STATE-01"],
    "fire":["F7-STAIR-A-HEADHOUSE-01","F7-STAIR-B-HEADHOUSE-01"],
  },
}
ANCHOR_OFFSETS=[(0,0),(1.2,0),(-1.2,0),(0,1.2),(0,-1.2),(1.2,1.2),(-1.2,1.2),(1.2,-1.2),(-1.2,-1.2)]

def placement_xy(obj):
    p=obj.get("placement",{}) or {}
    for key in ("center_ft","center"):
        v=p.get(key)
        if isinstance(v,dict) and "x" in v and "y" in v:return float(v["x"]),float(v["y"])
        if isinstance(v,(list,tuple)) and len(v)>=2:return float(v[0]),float(v[1])
    for key in ("bounds_ft","room_bounds_ft","band_ft"):
        b=p.get(key)
        if isinstance(b,dict) and all(k in b for k in ("x1","y1","x2","y2")):
            return .5*(float(b["x1"])+float(b["x2"])),.5*(float(b["y1"])+float(b["y2"]))
        if isinstance(b,(list,tuple)) and len(b)>=4:
            return .5*(float(b[0])+float(b[2])),.5*(float(b[1])+float(b[3]))
    if "x_ft" in p and "y_ft" in p:return float(p["x_ft"]),float(p["y_ft"])
    return None

def inventory_anchor(n,group,i=0):
    ids=ANCHOR_IDS.get(n,{}).get(group,[])
    if not ids:return None
    objs={o.get("id") or o.get("object_id"):o for o in floor_objects.get(n,[])}
    # Prefer the requested anchor, then any anchor in the same semantic group that
    # has actual geometric placement in the approved floor inventory.
    ordered=ids[i%len(ids):]+ids[:i%len(ids)]
    for aid in ordered:
        o=objs.get(aid)
        xy=placement_xy(o) if o else None
        if xy:return xy
    return None

def anchored_pos(n,group,i,z_aff,fallback_xy):
    xy=inventory_anchor(n,group,i)
    if not xy:xy=fallback_xy
    dx,dy=ANCHOR_OFFSETS[i%len(ANCHOR_OFFSETS)]
    return pos(n,xy[0]+dx,xy[1]+dy,z_aff)

def default_pos(n,kind,i=0,count=1):
    # Support equipment aligns with the Services Step 7 rack/panel zone.
    if kind in {"rack","switch","patch_panel","fiber_panel","ups","pdu","bas_controller","access_controller"}:
        return pos(n,45.0+(i%2)*.9,62.8+(i//2)*.55,1.2+0.65*(i%8))
    if kind=="electrical_panel": return pos(n,47.7+(i%2)*1.3,62.8,5.0)
    if kind=="wap": return anchored_pos(n,"ceiling",i,10.2,(24,24))
    if kind=="camera":
        if 1<=n<=6:
            x,y=((48.0,24.0),(48.0,50.0))[i%2]
            return pos(n,x,y,8.8)
        return anchored_pos(n,"security",i,8.8,(48,24))
    if kind=="reader":
        if 1<=n<=6:return pos(n,49.8,27.0,4.0)
        return anchored_pos(n,"security",i,4.2,(50,27))
    if kind=="intercom":
        if 1<=n<=6:return pos(n,50.35,27.225,4.0)
        return anchored_pos(n,"security",i,4.2,(50,27))
    if kind=="fire_detector":
        if 1<=n<=6:
            x,y=((24,26),(38,26),(24,48),(38,48))[i%4]
            return pos(n,x,y,10.56)
        return anchored_pos(n,"ceiling",i,9.7,(38,26))
    if kind=="fire_notification":
        if 1<=n<=6:
            x,y=((20,20),(48,50))[i%2]
            return pos(n,x,y,6.6)
        return anchored_pos(n,"fire",i,6.6,(38,26))
    if kind=="sensor": return anchored_pos(n,"ceiling",i,7.8,(36,39))
    if kind in {"workstation","phone","monitor"}:
        return anchored_pos(n,"work",i,3.15 if kind!="monitor" else 4.25,(36,40))
    if kind=="mfp": return anchored_pos(n,"work",i,3.0,(42,52))
    if kind in {"av_camera","av_mic","speaker"}:
        return anchored_pos(n,"av",i,7.4 if kind=="av_camera" else (4.6 if kind=="av_mic" else 8.5),(36,50))
    if kind=="fire": return anchored_pos(n,"fire",i,9.7,(38,26))
    if kind=="weather": return pos(n,48,63,6.0)
    return anchored_pos(n,"work",i,3.5,(36,40))

# B1 detailed builder is geometric authority for these current-pass objects even
# though the B1 inventory records themselves are semantic and omit placement.
# Coordinates are derived from the explicit boxes/racks in
# basement-b1/build_equity_uprise_basement_b1_v2.py.
B1_DETAILED_POSITIONS={
    "B1-ELEC-UPS-01-I001":[36.5,15.5,2.85],
    "B1-ELEC-UPS-01-I002":[42.5,15.5,2.85],
    "B1-TELECOM-CONSOLE-01":[37.5,24.0,3.15],
    "B1-LAB-CONSOLE-01":[47.5,39.25,3.2],
    "B1-LAB-DASHBOARD-01":[35.0,52.325,5.7],
    "B1-OPS-STATUS-01":[26.5,61.325,5.3],
    "B1-OPS-OCCUPANCY-01":[36.5,61.325,5.3],
    "B1-OPS-ROUTE-01":[44.25,58.7,3.25],
}

def existing_position(a):
    loc=a.get("location",{})
    n=loc.get("level_number")
    if n is None:
        lid_=loc.get("level_id")
        if lid_=="B1": n=0
        elif isinstance(lid_,str) and lid_.startswith(("F","L")):
            try:n=int(lid_[1:])
            except ValueError:n=None
    n=0 if n is None else int(n)
    c=loc.get("center_ft")
    if c:
        z=ffe(n)+4.0
        if len(c)>=3: z=ffe(n)+float(c[2])
        return [float(c[0]),float(c[1]),z]
    b=loc.get("bounds_ft")
    if b and len(b)>=4:
        return [0.5*(float(b[0])+float(b[2])),0.5*(float(b[1])+float(b[3])),ffe(n)+4.0]
    aid=a["asset_id"]
    if aid in B1_DETAILED_POSITIONS:
        p=B1_DETAILED_POSITIONS[aid]
        return [float(p[0]),float(p[1]),ffe(0)+float(p[2])]
    # Reconcile registry assets back to their approved floor-inventory geometry.
    obj=next((o for o in floor_objects.get(n,[]) if (o.get("id") or o.get("object_id"))==aid),None)
    xy=placement_xy(obj) if obj else None
    if xy:return [xy[0],xy[1],ffe(n)+4.2]
    # Some older canonical display/terminal records carry only semantic placement
    # rules. Bind them to another verified object in the same room/program group
    # rather than inventing a whole-floor fallback coordinate.
    label=(a.get("label","")+" "+a.get("classification",{}).get("asset_type","")).lower()
    group="av" if any(k in label for k in ("display","monitor","dashboard","globe")) else ("work" if any(k in label for k in ("terminal","kiosk","console","workstation")) else None)
    if group:
        idx=max(0,sum(ord(ch) for ch in aid)%max(1,len(ANCHOR_IDS.get(n,{}).get(group,[]))))
        xy=inventory_anchor(n,group,idx)
        if xy:return [xy[0],xy[1],ffe(n)+4.2]
    if aid in trace_xy:
        return [trace_xy[aid][0],trace_xy[aid][1],ffe(n)+4.0]
    return None

for a in assets:
    p=existing_position(a)
    if p: positions[a["asset_id"]]=p

def sim_binding():
    return [{"binding_type":"simulation","address":None,"read_only":False,"verified":False}]

def point(pid,ptype,name,value_type="number",units=None,alarmable=False,trendable=True):
    return {"point_id":pid,"point_type":ptype,"semantic_name":name,"value_type":value_type,"units":units,
            "writable_modes":[],"bindings":sim_binding(),"alarmable":alarmable,"trendable":trendable}

def telemetry(asset_type,aid):
    if "switch" in asset_type:
        return [point(aid+"::PORT-STATE","status","port/link state","json",None,True,True),
                point(aid+"::CPU","sensor","CPU utilization","number","percent",True,True),
                point(aid+"::TEMP","sensor","internal temperature","number","degC",True,True),
                point(aid+"::POE","meter","PoE draw","number","W",True,True)]
    if "firewall" in asset_type:
        return [point(aid+"::HA","status","HA state","enum",None,True,True),
                point(aid+"::SESSIONS","meter","active sessions","number","sessions",True,True),
                point(aid+"::CPU","sensor","CPU utilization","number","percent",True,True)]
    if "ups" in asset_type:
        return [point(aid+"::INPUT","status","AC input state","enum",None,True,True),
                point(aid+"::BATTERY","sensor","battery state of charge","number","percent",True,True),
                point(aid+"::LOAD","meter","UPS load","number","percent",True,True),
                point(aid+"::RUNTIME","calculated","estimated runtime","number","minutes",True,True)]
    if asset_type=="wireless_ap":
        return [point(aid+"::CLIENTS","meter","associated clients","number","clients",False,True),
                point(aid+"::RADIO","status","radio state","enum",None,True,True),
                point(aid+"::CHANNEL","status","RF channel","number","channel",False,True)]
    if "server" in asset_type or "host" in asset_type or "storage" in asset_type or "nas" in asset_type:
        return [point(aid+"::CPU","sensor","CPU utilization","number","percent",True,True),
                point(aid+"::MEM","sensor","memory utilization","number","percent",True,True),
                point(aid+"::DISK","status","storage health","enum",None,True,True)]
    if asset_type=="environment_sensor":
        return [point(aid+"::TEMP","sensor","space temperature","number","degC",True,True),
                point(aid+"::RH","sensor","relative humidity","number","percent",True,True),
                point(aid+"::CO2","sensor","CO2 concentration","number","ppm",True,True)]
    if asset_type in {"camera","intercom","ip_phone","av_camera","av_microphone","network_display_decoder","workstation","mfp"}:
        return [point(aid+"::ONLINE","status","network reachability","boolean",None,True,True)]
    return []

def make_asset(aid,label,asset_type,level=None,position=None,systems=None,logical=False,zone=None,notes=None,security="internal"):
    role="capability_semantic" if logical else "individual_physicalizable"
    cls="digital_capability" if logical else ("service_support" if asset_type in {"patch_panel","fiber_panel","wap_spare_jack","pdu"} else "equipment")
    ln=None if level is None else int(level)
    lev="BUILDING" if level is None else lid(ln)
    physical_status="not_applicable" if logical else "planned"
    commissioning="not_applicable" if logical else "not_started"
    tag_status="not_applicable" if logical else "unassigned"
    p=position
    a={
      "asset_id":aid,"label":label,
      "source_snapshot":{"source":"electronics_step4a_policy","asset_type":asset_type,"design_intent":True},
      "identity":{"source_record_id":aid,"instance_index":None,"instance_count":1,
                  "physical_tag":{"status":tag_status,"encoded_asset_id":None,"qr_uri":None,"nfc_uri":None,"deep_link_uri":None,"label_text":None}},
      "classification":{"asset_class":cls,"source_category":"electronics_step4a","asset_type":asset_type,"subtype":None,
                        "physicalization":"not_applicable" if logical else "deferred","registry_role":role},
      "location":{"level_id":lev,"level_number":ln,"zone_id":zone,"coordinate_frame":"non-spatial" if logical else "core-v2-local-ft",
                  "placement_authority":"unknown","center_ft":None if logical or not p else [p[0],p[1],p[2]-ffe(ln)],"bounds_ft":None,
                  "elevation_ft":None if logical or not p else p[2],"access_path_ids":[]},
      "authority":{"source_path":SOURCE_REL,"source_revision":source_rev,"authority_status":"design_intent_research_grounded",
                   "implementation_status":"planned_not_as_built","heritage_decision":None,"source_refs":[],
                   "provenance_notes":notes or "Step 4A electronics training/design-intent asset; verification required before physical use.","not_for_construction":True},
      "digital_representation":{"scene_id":"equity-uprise-electronics-fabric-v1","geometry_status":"non_geometric" if logical else "conceptual",
                                "model_paths":[] if logical else [MODEL_REL],"model_node_ids":[],"viewer_uri":None if logical else viewer(ln),
                                "viewer_floor_focus":None if logical else lev},
      "physical_representation":{"physical_status":physical_status,"manufacturer":None,"model":None,"serial_number":None,"asset_number":None,
                                 "as_built_location":None,"commissioning_status":commissioning},
      "external_semantics":{"ifc":{"entity_type":None,"global_id":None,"verified":False},
                            "bacnet":{"device_id":None,"object_type":None,"object_instance":None,"object_name":None,"verified":False},
                            "other_bindings":[]},
      "systems":{"system_families":uniq(systems or []),"capability_ids":[],"upstream_asset_ids":[],"downstream_asset_ids":[],"dependency_asset_ids":[]},
      "state_model":{"availability_states":["not_applicable"] if logical else ["unknown","available","degraded","unavailable","maintenance"],
                     "normal_state":None if logical else "available","operating_modes":[] if logical else ["normal","maintenance"],
                     "fault_states":[] if logical else ["offline","power_loss","link_loss","misconfigured"],"alarm_states":[],"state_variables":[]},
      "points":[] if logical else telemetry(asset_type,aid),
      "training":{"lab_eligible":True,"observable":not logical,"controllable_modes":[] if logical else ["SIMULATION"],
                  "scenario_refs":[],"learning_objectives":[],"inspection_steps":[],"failure_modes":[] if logical else ["power_loss","link_loss","misconfiguration"],
                  "reset_behavior":"not_applicable" if logical else "scenario_reset"},
      "security":{"data_classification":security,"visibility":"operator" if security in {"restricted","sensitive"} else "member",
                  "read_roles":["member","instructor","operator","admin","owner"] if security=="internal" else ["instructor","operator","admin","owner"],
                  "command_roles":[],"live_control_allowed":False,"requires_human_confirmation":True,"audit_required":True},
      "lifecycle":{"design_status":"conceptual","physical_status":physical_status,"as_built_verified":False,"commissioning_status":commissioning,"last_verified_revision":None},
      "operations":{"service_access_required":not logical,"service_access_refs":[],"maintenance_procedure_refs":[],"documentation_refs":[SOURCE_REL],"replacement_route_refs":[]}
    }
    return a

def add_asset(a):
    aid=a["asset_id"]
    if aid in by_id:
        # Rebuilds begin from the prior generated registry. Refresh the current
        # deterministic position from the newly authored candidate before
        # returning the existing identity; otherwise regenerated local cords can
        # lose both endpoints even though the current builder knows their layout.
        p=existing_position(a) or existing_position(by_id[aid])
        if p: positions[aid]=p
        return by_id[aid]
    assets.append(a); new_assets.append(a); by_id[aid]=a
    p=existing_position(a)
    if p: positions[aid]=p
    return a

def add_rel(kind,src,dst,criticality="operational",note=None):
    global rel_counter
    if src not in by_id or dst not in by_id: return
    key=(kind,src,dst)
    for r in relationships:
        if (r["type"],r["from_asset_id"],r["to_asset_id"])==key: return
    rel_counter+=1
    rid=f"REL::STEP4A::{rel_counter:05d}::{kind.upper()}::{src}::{dst}"
    r={"relationship_id":rid,"type":kind,"from_asset_id":src,"to_asset_id":dst,"direction":"directed","criticality":criticality,
       "source_refs":[SOURCE_REL],"notes":note}
    relationships.append(r); new_relationships.append(r)
    by_id[src]["systems"]["downstream_asset_ids"]=uniq(by_id[src]["systems"].get("downstream_asset_ids",[])+[dst])
    by_id[dst]["systems"]["upstream_asset_ids"]=uniq(by_id[dst]["systems"].get("upstream_asset_ids",[])+[src])

def add_conn(src,dst,cable_type,layer,protocols=None,from_port=None,to_port=None,power_transport=None,route=None,status="design_intent",metadata=None):
    global connection_counter
    connection_counter+=1
    cid=f"CABLE::STEP4A::{connection_counter:05d}"
    rec={"connection_id":cid,"from_asset_id":src,"to_asset_id":dst,"cable_type":cable_type,"layer":layer,
         "protocols":protocols or [],"from_port":from_port,"to_port":to_port,"power_transport":power_transport,
         "route":route or [],"status":status,"metadata":metadata or {}}
    connections.append(rec)
    if src in by_id and dst in by_id: add_rel("connects_to",src,dst,"operational",f"Physical/logical connection {cid} over {cable_type}")
    return rec

# logical network objects
for v in policy["vlans"]:
    add_asset(make_asset("LOGIC-"+v["id"],v["id"]+" "+v["purpose"],"vlan",logical=True,notes=f"Design-intent VLAN {v['vlan_id']}: {v['purpose']}"))
for s in policy["ssids"]:
    add_asset(make_asset("LOGIC-"+s["id"],s["id"],"ssid",logical=True,notes=f"{s['security']} -> {s['maps_to']}"))
for name in policy["logical_services"]:
    add_asset(make_asset("LOGIC-SVC-"+name,name.replace("-"," ")+" service","logical_service",logical=True,notes="Virtual/logical service; physical host relationship defined by Step 4A."))

# core physical assets
core_positions={
  "carrier_handoff":pos(0,32,62,4),"carrier_handoff_reserved":pos(0,33,62,4),"carrier_cpe":pos(0,40,64,3),
  "edge_router":pos(0,42,64,3),"firewall":pos(0,44,64,3),"collapsed_core_switch":pos(0,46,64,3),
  "virtualization_host":pos(0,48,64,3),"nas_storage":pos(0,48,62,3),"backup_appliance":pos(0,48,60,3),
  "vms_nvr":pos(0,46,60,3),"fire_alarm_control_panel":pos(0,38,60,4),"fire_alarm_read_only_gateway":pos(0,40,60,4)
}
core_ids=defaultdict(list)
for base,atype,qty in policy["core_physical_assets"]:
    for i in range(1,qty+1):
        aid=base if qty==1 else f"{base}-I{i:03d}"
        p=list(core_positions[atype]); p[0]+=0.7*(i-1)
        systems=["DATA-STRUCTURED"]
        if atype.startswith("fire_alarm"): systems=["FIRE-ALARM"]+(["DATA-STRUCTURED"] if atype.endswith("gateway") else [])
        sec="restricted" if atype in {"firewall","edge_router","collapsed_core_switch","virtualization_host","nas_storage","backup_appliance","vms_nvr","fire_alarm_read_only_gateway"} else "internal"
        add_asset(make_asset(aid,atype.replace("_"," ").title(),atype,0,p,systems,False,"telecom",security=sec))
        core_ids[atype].append(aid)

# reuse existing B1 UPS identities where available
b1_ups=sorted([a for a in by_id if a.startswith("B1-ELEC-UPS-01-I")])
if not b1_ups:
    for i in range(2):
        aid=f"B1-ICT-UPS-{i+1:02d}"
        add_asset(make_asset(aid,f"B1 ICT UPS {i+1}","rack_ups",0,default_pos(0,"ups",i),["ELEC-EMERGENCY"],False,"telecom",security="restricted"))
        b1_ups.append(aid)

# B1 rack PDUs anchored to existing 4 rack identities when present
b1_racks=sorted([a for a in by_id if a.startswith("B1-TELECOM-RACKS-01-I")])
if not b1_racks:
    for i in range(4):
        aid=f"B1-ICT-MDF-RACK-{i+1:02d}"
        add_asset(make_asset(aid,f"B1 MDF Rack {i+1}","rack",0,default_pos(0,"rack",i),["DATA-STRUCTURED"],False,"telecom",security="restricted"))
        b1_racks.append(aid)
for i,rack in enumerate(b1_racks):
    for side in ("A","B"):
        aid=f"B1-ICT-PDU-{i+1:02d}-{side}"
        add_asset(make_asset(aid,f"B1 Rack {i+1} PDU {side}","pdu",0,default_pos(0,"pdu",i*2+(0 if side=="A" else 1)),["ELEC-EMERGENCY"],False,"telecom",security="restricted"))
        up=b1_ups[(i+(0 if side=="A" else 1))%len(b1_ups)]
        add_conn(up,aid,"IEC-POWER","power",["AC"],metadata={"rack_id":rack})

# core data path
carrier_a=core_ids["carrier_handoff"][0]; carrier_b=core_ids["carrier_handoff_reserved"][0]
cpe=core_ids["carrier_cpe"][0]; edge=core_ids["edge_router"][0]
fws=core_ids["firewall"]; cores=core_ids["collapsed_core_switch"]
add_conn(carrier_a,cpe,"OS2-SM-DUPLEX","data",["carrier Ethernet"],metadata={"provider_boundary":True})
add_conn(cpe,edge,"OS2-SM-DUPLEX","data",["Ethernet/IP"])
for fw in fws: add_conn(edge,fw,"10G-DAC","data",["Ethernet/IP"])
for fw in fws:
    for coreid in cores: add_conn(fw,coreid,"10G-DAC","data",["Ethernet/IP","802.1Q"])
add_rel("depends_on",cpe,carrier_a)
for fw in fws: add_rel("depends_on",fw,edge)
for coreid in cores:
    for fw in fws: add_rel("depends_on",coreid,fw)

# service hosting
hosts=core_ids["virtualization_host"]
service_host_map={
 "DHCP":hosts[0],"DNS":hosts[0],"NTP":hosts[0],"AAA-RADIUS":hosts[1],"DIRECTORY-IDP":hosts[1],
 "SYSLOG-SIEM":hosts[2],"SNMP-NMS":hosts[2],"CONFIG-BACKUP":hosts[2],"WLAN-CONTROLLER":hosts[1],
 "BAS-SUPERVISOR":hosts[1],"AV-CONTROL":hosts[2],"FILE-SHARE":core_ids["nas_storage"][0],
 "BACKUP-SERVICE":core_ids["backup_appliance"][0],"VMS":core_ids["vms_nvr"][0],
 "VPN-REMOTE-ACCESS":fws[0]
}
for svc,host in service_host_map.items():
    sid="LOGIC-SVC-"+svc
    add_rel("contains",host,sid,"operational",f"{svc} is modeled as a logical service hosted on {host}")
    by_id[sid]["systems"]["dependency_asset_ids"]=uniq(by_id[sid]["systems"].get("dependency_asset_ids",[])+[host])
# logical dependencies
for a,b in [("VPN-REMOTE-ACCESS","AAA-RADIUS"),("VPN-REMOTE-ACCESS","DIRECTORY-IDP"),("WLAN-CONTROLLER","AAA-RADIUS"),
            ("DHCP","DNS"),("VMS","NTP"),("BAS-SUPERVISOR","NTP"),("AV-CONTROL","NTP")]:
    add_rel("depends_on","LOGIC-SVC-"+a,"LOGIC-SVC-"+b)

# server/core links and power
for dev in hosts+core_ids["nas_storage"]+core_ids["backup_appliance"]+core_ids["vms_nvr"]:
    for coreid in cores: add_conn(dev,coreid,"10G-DAC","data",["Ethernet/IP"],metadata={"dual_homed":True})
for dev in [cpe,edge]+fws+cores+hosts+core_ids["nas_storage"]+core_ids["backup_appliance"]+core_ids["vms_nvr"]:
    for side,pdu in enumerate(["B1-ICT-PDU-01-A","B1-ICT-PDU-01-B"]):
        if pdu in by_id: add_conn(pdu,dev,"IEC-POWER","power",["AC"],metadata={"feed":"A" if side==0 else "B"})

# fire alarm segregation
facp=core_ids["fire_alarm_control_panel"][0]; firegw=core_ids["fire_alarm_read_only_gateway"][0]
add_conn(facp,firegw,"CAT6A-PATCH","integration",["vendor/fire alarm gateway"],metadata={"direction":"read_only_monitoring"})
for coreid in cores: add_conn(firegw,coreid,"CAT6A-HORIZONTAL","data",["Ethernet/IP"],metadata={"read_only_gateway":True})

# discover rack anchors and existing fixed IT/AV endpoints
rack_anchor={}
for n in range(1,7):
    candidates=[]
    for a in assets:
        if a["location"].get("level_number")==n:
            t=(a["label"]+" "+a["classification"].get("asset_type","")).lower()
            if "rack" in t and a["classification"].get("registry_role")=="individual_physicalizable": candidates.append(a["asset_id"])
    if candidates:
        rack_anchor[n]=sorted(candidates)[0]
    else:
        aid=f"{lid(n)}-ICT-IDF-RACK-01"
        add_asset(make_asset(aid,f"{lid(n)} IDF Rack","rack",n,default_pos(n,"rack"),["DATA-STRUCTURED"],False,"support_b",security="restricted"))
        rack_anchor[n]=aid
rack_anchor[0]=b1_racks[0]
rack_anchor[7]=rack_anchor[6]

existing_fixed=defaultdict(list)
keywords=("display","monitor","kiosk","terminal","console","halo globe","workstation connection","dashboard")
for a in list(assets):
    n=a["location"].get("level_number")
    if n is None or n<0 or n>7: continue
    t=(a["label"]+" "+a["classification"].get("asset_type","")).lower()
    if any(k in t for k in keywords) and "rack" not in t and "power / data" not in t and "power/data" not in t:
        existing_fixed[n].append(a["asset_id"])

# create per-floor planned endpoints before access-switch sizing
net_endpoints=defaultdict(list)
spare_jacks=defaultdict(list)
power_local=[]
display_local=[]
bas_sensor_bus=[]
reader_bus=[]
speaker_bus=[]
fire_slc=[]
fire_nac=[]

def register_endpoint(aid,n,vlan,poe=False,serving_floor=None):
    net_endpoints[n if serving_floor is None else serving_floor].append({"asset_id":aid,"level":n,"vlan":vlan,"poe":poe})

for n in range(0,8):
    profile=policy["floor_profiles"][str(n)]
    lev=profile["level_id"]
    serving=6 if n==7 else n

    # floor rack power
    if n<=6:
        ups=f"{lev}-ICT-RACK-UPS-01"
        add_asset(make_asset(ups,f"{lev} IDF Rack UPS","rack_ups",n,default_pos(n,"ups"),["ELEC-EMERGENCY"],False,"support_b",security="restricted"))
        for side in ("A","B"):
            pdu=f"{lev}-ICT-RACK-PDU-{side}"
            add_asset(make_asset(pdu,f"{lev} IDF Rack PDU {side}","pdu",n,default_pos(n,"pdu",0 if side=="A" else 1),["ELEC-EMERGENCY"],False,"support_b",security="restricted"))
            add_conn(ups,pdu,"IEC-POWER","power",["AC"],metadata={"critical_network_power_design_intent":True})
        add_conn("ELEC-EMERGENCY",ups,"120VAC-BRANCH","power",["AC"],metadata={"owner_requirement_to_verify":True})

    # WAPs
    for i in range(profile["waps"]):
        aid=f"{lev}-NET-WAP-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} Wireless Access Point {i+1}","wireless_ap",n,default_pos(n,"wap",i,profile["waps"]),["DATA-STRUCTURED"],False,"floor_wide"))
        register_endpoint(aid,n,"LOGIC-VLAN-MGMT",True,serving)
        jack=f"{lev}-NET-WAP-SPARE-JACK-{i+1:02d}"
        add_asset(make_asset(jack,f"{lev} WAP Spare Cat6A Jack {i+1}","wap_spare_jack",n,default_pos(n,"wap",i,profile["waps"]),["DATA-STRUCTURED"],False,"floor_wide"))
        spare_jacks[serving].append({"asset_id":jack,"level":n})
    # workstations and monitors
    for i in range(profile["workstations"]):
        aid=f"{lev}-USER-WS-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} Workstation {i+1}","workstation",n,default_pos(n,"workstation",i,profile["workstations"]),["DATA-STRUCTURED"],False,"user_zone"))
        register_endpoint(aid,n,"LOGIC-VLAN-LAB" if n in {2,3,4,5} else "LOGIC-VLAN-STAFF",False,serving)
        add_conn("ELEC-NORMAL",aid,"120VAC-BRANCH","power",["AC"],metadata={"receptacle_required":True})
        for m in range(profile["monitor_per_workstation"]):
            mid=f"{lev}-USER-MON-{i+1:02d}-{m+1:02d}"
            mp=default_pos(n,"monitor",i,profile["workstations"]); mp[0]+=0.7*m
            add_asset(make_asset(mid,f"{lev} Workstation {i+1} Monitor {m+1}","monitor",n,mp,["ELEC-NORMAL"],False,"user_zone"))
            add_conn(aid,mid,"DISPLAYPORT","audio_video",["DisplayPort"],metadata={"local_patch":True})
            add_conn("ELEC-NORMAL",mid,"120VAC-BRANCH","power",["AC"],metadata={"receptacle_required":True})
    # phones
    for i in range(profile["phones"]):
        aid=f"{lev}-VOICE-PHONE-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} IP Phone {i+1}","ip_phone",n,default_pos(n,"phone",i,profile["phones"]),["DATA-STRUCTURED"],False,"user_zone"))
        register_endpoint(aid,n,"LOGIC-VLAN-VOICE",True,serving)
    # MFP
    for i in range(profile["mfp"]):
        aid=f"{lev}-PRINT-MFP-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} Managed MFP {i+1}","mfp",n,default_pos(n,"mfp",i),["DATA-STRUCTURED"],False,"support"))
        register_endpoint(aid,n,"LOGIC-VLAN-PRINTERS",False,serving)
        add_conn("ELEC-NORMAL",aid,"120VAC-BRANCH","power",["AC"])
    # cameras
    for i in range(profile["cameras"]):
        aid=f"{lev}-SEC-CAM-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} IP Camera {i+1}","camera",n,default_pos(n,"camera",i,profile["cameras"]),["SECURITY-ACCESS","DATA-STRUCTURED"],False,"security",security="restricted"))
        register_endpoint(aid,n,"LOGIC-VLAN-CCTV",True,serving)
    # access controller + readers
    ctrl=f"{lev}-SEC-ACCESS-CTRL-01"
    add_asset(make_asset(ctrl,f"{lev} Access Control Panel","access_controller",n,default_pos(n,"access_controller"),["SECURITY-ACCESS","DATA-STRUCTURED"],False,"support_b",security="restricted"))
    register_endpoint(ctrl,n,"LOGIC-VLAN-ACCESS",False,serving)
    add_conn("ELEC-EMERGENCY" if n<=6 else "ELEC-NORMAL",ctrl,"120VAC-BRANCH","power",["AC"],metadata={"battery_backup_expected":True})
    for i in range(profile["access_readers"]):
        aid=f"{lev}-SEC-READER-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} OSDP Reader {i+1}","access_reader",n,default_pos(n,"reader",i),["SECURITY-ACCESS"],False,"security",security="restricted"))
        reader_bus.append((ctrl,aid))
    # intercom
    for i in range(profile["intercoms"]):
        aid=f"{lev}-SEC-INTERCOM-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} IP Intercom {i+1}","intercom",n,default_pos(n,"intercom",i),["SECURITY-ACCESS","DATA-STRUCTURED"],False,"security",security="restricted"))
        register_endpoint(aid,n,"LOGIC-VLAN-ACCESS",True,serving)
    # BAS controller/sensors
    for i in range(profile["bas_controllers"]):
        ctrlid=f"{lev}-BAS-CTRL-{i+1:02d}"
        add_asset(make_asset(ctrlid,f"{lev} BAS Floor Controller {i+1}","bas_controller",n,default_pos(n,"bas_controller",i),["BAS-CONTROLS","DATA-STRUCTURED"],False,"support_b",security="restricted"))
        register_endpoint(ctrlid,n,"LOGIC-VLAN-BAS-OT",False,serving)
        add_conn("ELEC-EMERGENCY" if n<=6 else "ELEC-NORMAL",ctrlid,"120VAC-BRANCH","power",["AC"],metadata={"controls_power_design_intent":True})
        for s in range(profile["environment_sensors"]):
            sid=f"{lev}-BAS-ENV-{s+1:02d}"
            kind="weather" if n==7 else "sensor"
            add_asset(make_asset(sid,f"{lev} Environment Sensor {s+1}","environment_sensor",n,default_pos(n,kind,s),["BAS-CONTROLS"],False,"floor_wide",security="restricted"))
            bas_sensor_bus.append((ctrlid,sid))
    # AV control
    if profile["av_controller"]:
        avc=f"{lev}-AV-CTRL-01"; dsp=f"{lev}-AV-DSP-01"
        add_asset(make_asset(avc,f"{lev} AV Control Processor","av_controller",n,default_pos(n,"rack",3),["AV-MEDIA","DATA-STRUCTURED"],False,"av_it",security="restricted"))
        add_asset(make_asset(dsp,f"{lev} AV DSP / Amplifier","av_dsp",n,default_pos(n,"rack",4),["AV-MEDIA","DATA-STRUCTURED"],False,"av_it",security="restricted"))
        register_endpoint(avc,n,"LOGIC-VLAN-AV",False,serving); register_endpoint(dsp,n,"LOGIC-VLAN-AV",False,serving)
        for i in range(profile["av_cameras"]):
            aid=f"{lev}-AV-CAM-{i+1:02d}"
            add_asset(make_asset(aid,f"{lev} AV Camera {i+1}","av_camera",n,default_pos(n,"av_camera",i),["AV-MEDIA","DATA-STRUCTURED"],False,"av_zone"))
            register_endpoint(aid,n,"LOGIC-VLAN-AV",True,serving)
        for i in range(profile["av_mics"]):
            aid=f"{lev}-AV-MIC-{i+1:02d}"
            add_asset(make_asset(aid,f"{lev} Network Microphone {i+1}","av_microphone",n,default_pos(n,"av_mic",i),["AV-MEDIA","DATA-STRUCTURED"],False,"av_zone"))
            register_endpoint(aid,n,"LOGIC-VLAN-AV",True,serving)
        for i in range(profile["av_speakers"]):
            aid=f"{lev}-AV-SPKR-{i+1:02d}"
            add_asset(make_asset(aid,f"{lev} Speaker {i+1}","speaker",n,default_pos(n,"speaker",i),["AV-MEDIA"],False,"av_zone"))
            speaker_bus.append((dsp,aid))
    # fire devices: B1 + F1-F6; roof excluded from invented smoke/strobe pattern
    if n<=6:
        det_count=4 if n>=1 else 4
        strobe_count=2
        for i in range(det_count):
            aid=f"{lev}-FIRE-DET-{i+1:02d}"
            add_asset(make_asset(aid,f"{lev} Addressable Fire Detector {i+1}","fire_detector",n,default_pos(n,"fire_detector",i),["FIRE-ALARM"],False,"floor_wide",security="restricted"))
            fire_slc.append((facp,aid))
        for i in range(strobe_count):
            aid=f"{lev}-FIRE-STROBE-{i+1:02d}"
            add_asset(make_asset(aid,f"{lev} Fire Notification Appliance {i+1}","fire_notification",n,default_pos(n,"speaker",i),["FIRE-ALARM"],False,"floor_wide",security="restricted"))
            fire_nac.append((facp,aid))
    # transient wireless client profile
    transient_profiles.append({"level_id":lev,"level_number":n,"tablets_building_owned":profile["tablets"],
                               "estimated_concurrent_mobile_clients":profile["mobile_clients"],
                               "connection_modes":["WIFI-6E-RF","CELLULAR-RF"],"status":"training_load_profile_not_fixed_asset"})

# existing fixed display/terminal assets get networked through a decoder for displays, direct for kiosks/terminals
for n,ids in existing_fixed.items():
    serving=6 if n==7 else n
    for aid in sorted(set(ids)):
        if aid not in by_id: continue
        label=by_id[aid]["label"].lower()
        if any(k in label for k in ("display","monitor","surface","wall","globe")):
            did=f"{aid}::AV-DECODER"
            p=positions.get(aid) or default_pos(n,"rack",5)
            add_asset(make_asset(did,by_id[aid]["label"]+" AV-over-IP Decoder","network_display_decoder",n,p,["AV-MEDIA","DATA-STRUCTURED"],False,"av_endpoint"))
            register_endpoint(did,n,"LOGIC-VLAN-AV",True,serving)
            add_conn(did,aid,"HDMI","audio_video",["HDMI"],metadata={"existing_canonical_display":True})
            if aid in by_id: add_conn("ELEC-NORMAL",aid,"120VAC-BRANCH","power",["AC"])
        else:
            register_endpoint(aid,n,"LOGIC-VLAN-LAB" if n in {1,2,3,5,6,7} else "LOGIC-VLAN-AV",False,serving)
            add_conn("ELEC-NORMAL",aid,"120VAC-BRANCH","power",["AC"])

# field/control buses
for ctrl,sensor in bas_sensor_bus:
    add_conn(ctrl,sensor,"BACNET-MSTP-STP","control",["BACnet MS/TP"],metadata={"termination_and_biasing_require_controls_design":True})
for ctrl,reader in reader_bus:
    add_conn(ctrl,reader,"OSDP-RS485-STP","control",["OSDP"],power_transport="24VDC-CLASS2",metadata={"door_hardware_circuits_not_fully_modeled":True})
for dsp,spk in speaker_bus:
    add_conn(dsp,spk,"SPEAKER-PAIR","audio_video",["amplified audio"])
for src,dst in fire_slc:
    add_conn(src,dst,"FIRE-ALARM-SLC","life_safety",["listed fire-alarm signaling"],metadata={"not_general_lan":True})
for src,dst in fire_nac:
    add_conn(src,dst,"FIRE-ALARM-NAC","life_safety",["listed fire-alarm notification"],metadata={"not_general_lan":True})

# create IDF access layer sized to active demand, plus patch/fiber panels
switches_by_serving_floor=defaultdict(list)
panels_by_serving_floor=defaultdict(list)
fiber_panel_by_floor={}
for sf in range(0,7):
    active=len(net_endpoints[sf]); spare=len(spare_jacks[sf])
    sw_count=max(1,math.ceil(active/policy["design_basis"]["access_switch_design_fill"]))
    panel_count=max(sw_count,math.ceil((active+spare)/48))
    lev=lid(sf)
    fiber=f"{lev}-NET-FIBER-PANEL-01"
    add_asset(make_asset(fiber,f"{lev} Fiber Termination Panel","fiber_panel",sf,default_pos(sf,"fiber_panel"),["DATA-STRUCTURED"],False,"support_b",security="restricted"))
    fiber_panel_by_floor[sf]=fiber
    for i in range(sw_count):
        aid=f"{lev}-NET-ACCESS-SW-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} 48-Port PoE Access Switch {i+1}","access_switch",sf,default_pos(sf,"switch",i),["DATA-STRUCTURED"],False,"support_b",security="restricted"))
        switches_by_serving_floor[sf].append(aid)
        pdu=f"{lev}-ICT-RACK-PDU-{'A' if i%2==0 else 'B'}"
        if pdu in by_id: add_conn(pdu,aid,"IEC-POWER","power",["AC"],metadata={"rack_power":True})
        # dual core uplinks: B1 uses DAC, upper floors OS2
        media="10G-DAC" if sf==0 else "OS2-SM-DUPLEX"
        for ci,coreid in enumerate(cores):
            route=[] if sf==0 else [[46,66,ffe(sf)+8],[55,69,ffe(sf)+9],[55,69,ffe(0)+9],[46,64,ffe(0)+4]]
            add_conn(aid,coreid,media,"data",["Ethernet/IP","802.1Q"],from_port=f"UPLINK-{ci+1}",
                     to_port=f"ACCESS-{lev}-{i+1}",route=route,metadata={"dual_homed":True,"physical_path_diversity":False if sf>0 else True})
    for i in range(panel_count):
        aid=f"{lev}-NET-PATCH-PANEL-{i+1:02d}"
        add_asset(make_asset(aid,f"{lev} 48-Port Cat6A Patch Panel {i+1}","patch_panel",sf,default_pos(sf,"patch_panel",i),["DATA-STRUCTURED"],False,"support_b",security="restricted"))
        panels_by_serving_floor[sf].append(aid)

# allocate wired endpoints to switch/patch ports
for sf in range(0,7):
    eps=net_endpoints[sf]
    panels=panels_by_serving_floor[sf]; switches=switches_by_serving_floor[sf]
    for idx,ep in enumerate(eps):
        sw=switches[idx//policy["design_basis"]["access_switch_port_capacity"]]
        sw_port=(idx%policy["design_basis"]["access_switch_port_capacity"])+1
        panel=panels[idx//48]; panel_port=(idx%48)+1
        target=ep["asset_id"]
        add_conn(sw,panel,"CAT6A-PATCH","data",["Ethernet"],from_port=f"Gi1/0/{sw_port}",to_port=f"PORT-{panel_port:02d}",
                 power_transport="PoE" if ep["poe"] else None,metadata={"vlan":ep["vlan"],"patching":True})
        target_pos=positions.get(target)
        route=[]
        if target_pos:
            route=[[46,66,ffe(sf)+9],[target_pos[0],target_pos[1],ffe(ep["level"])+9],[target_pos[0],target_pos[1],target_pos[2]]]
        add_conn(panel,target,"CAT6A-HORIZONTAL","data",["Ethernet/IP"],from_port=f"PORT-{panel_port:02d}",to_port="ETH0",
                 power_transport="PoE" if ep["poe"] else None,route=route,metadata={"vlan":ep["vlan"],"serving_floor":sf})
        by_id[target]["systems"]["system_families"]=uniq(by_id[target]["systems"].get("system_families",[])+["DATA-STRUCTURED"])
        by_id[target]["systems"]["dependency_asset_ids"]=uniq(by_id[target]["systems"].get("dependency_asset_ids",[])+[sw])
    # spare WAP drops consume patch-panel ports but not switch ports
    start=len(eps)
    for j,sp in enumerate(spare_jacks[sf]):
        idx=start+j
        panel=panels[idx//48]; port=(idx%48)+1
        target=sp["asset_id"]; target_pos=positions.get(target)
        route=[]
        if target_pos:
            route=[[46,66,ffe(sf)+9],[target_pos[0],target_pos[1],ffe(sp["level"])+9],[target_pos[0],target_pos[1],target_pos[2]]]
        add_conn(panel,target,"CAT6A-WAP-SPARE","data",["reserved Ethernet/PoE"],from_port=f"PORT-{port:02d}",to_port="SPARE-JACK",route=route,
                 metadata={"not_patched_to_switch":True,"future_wap_capacity":True})

# Step 4B physical installation: turn the logical endpoint graph into a
# lab-able structured-cabling and electrical distribution plant.
#
# Passive terminations are explicit assets. Physical routes use the same locked
# service/riser coordinates as the Services authority. Exact conductor gauge,
# breaker sizing, conduit fill and stamped construction routing remain deferred.
def asset_type(aid):
    return by_id.get(aid,{}).get("classification",{}).get("asset_type")

def asset_level(aid):
    n=by_id.get(aid,{}).get("location",{}).get("level_number")
    return None if n is None else int(n)

def route_length_ft(points):
    total=0.0
    for a,b in zip(points[:-1],points[1:]):
        total+=math.sqrt(sum((float(b[i])-float(a[i]))**2 for i in range(3)))
    return round(total,3)

ROUTE=policy["physical_routing"]
R=ROUTE["riser_centers_ft"]
SUP=ROUTE["floor_support_points_ft"]
H=ROUTE["pathway_heights_aff_ft"]

def endpoint_outlet_position(aid):
    p=positions.get(aid)
    if not p:return None
    t=asset_type(aid)
    n=asset_level(aid)
    if n is None:return None
    # Desk/table loads use a floor-box style service point; wall/rack/display
    # loads use a local receptacle close to the equipment.
    if t in {"workstation","monitor"}:
        return [p[0]+.22,p[1]+.18,ffe(n)+.12]
    if t in {"network_display_decoder"}:
        return [p[0]+.18,p[1],max(ffe(n)+1.3,p[2]-.55)]
    if t in {"mfp"}:
        return [p[0]-.25,p[1],ffe(n)+1.3]
    if t in {"rack_ups","access_controller","bas_controller","av_controller","av_dsp"}:
        return [p[0]-.28,p[1],ffe(n)+1.5]
    return [p[0]+.18,p[1],ffe(n)+1.3]

def endpoint_jack_position(aid):
    p=positions.get(aid)
    if not p:return None
    t=asset_type(aid); n=asset_level(aid)
    if n is None:return None
    if t in {"wireless_ap","camera","av_camera","av_microphone"}:
        return [p[0]-.18,p[1],min(ffe(n)+10.0,p[2])]
    if t in {"intercom","access_controller","bas_controller"}:
        return [p[0]-.18,p[1],max(ffe(n)+1.4,min(p[2],ffe(n)+4.2))]
    return [p[0]-.22,p[1],ffe(n)+1.4]

# Physical floor panelboards align with the Services Step 7 panel zone. L7 is
# intentionally served from F6, matching the existing building-services authority.
power_panels={}
for n in range(0,7):
    lev=lid(n)
    normal=f"{lev}-ELEC-PANEL-N-01"
    emergency=f"{lev}-ELEC-PANEL-E-01"
    add_asset(make_asset(normal,f"{lev} Normal Power Panelboard","electrical_panel",n,default_pos(n,"electrical_panel",0),["ELEC-NORMAL"],False,"support_b",security="restricted"))
    add_asset(make_asset(emergency,f"{lev} Emergency / Critical Power Panelboard","electrical_panel",n,default_pos(n,"electrical_panel",1),["ELEC-EMERGENCY"],False,"support_b",security="restricted"))
    power_panels[n]={"normal":normal,"emergency":emergency}
power_panels[7]=power_panels[6]

# Feed every physical floor panel from the correct locked riser family.
for n in range(0,7):
    for mode,src in (("normal","ELEC-NORMAL"),("emergency","ELEC-EMERGENCY")):
        add_conn(src,power_panels[n][mode],"208Y120V-FEEDER","power",["AC distribution"],
                 metadata={"distribution_role":"floor_panel_feeder","served_level":lid(n),"engineering_required":True})

# Close power gaps that were acceptable in the Step 4A logical fabric but are
# not acceptable in a physical-installation model.
for aid in sorted(a["asset_id"] for a in new_assets if a["classification"]["asset_type"] in {"av_controller","av_dsp"}):
    if not any(x["to_asset_id"]==aid and x["cable_type"] in {"120VAC-BRANCH","IEC-POWER"} for x in connections):
        add_conn("ELEC-NORMAL",aid,"120VAC-BRANCH","power",["AC"],metadata={"receptacle_required":True,"step4b_power_completion":True})
for aid in (facp,firegw):
    if not any(x["to_asset_id"]==aid and x["cable_type"] in {"120VAC-BRANCH","IEC-POWER"} for x in connections):
        add_conn("ELEC-EMERGENCY",aid,"120VAC-BRANCH","power",["AC"],metadata={"dedicated_life_safety_power_design_intent":True,"step4b_power_completion":True})
for ctrl,sensor in bas_sensor_bus:
    add_conn(ctrl,sensor,"24VDC-CLASS2","power",["Class 2 low-voltage power"],
             from_port="24V-OUT",to_port="24V-IN",metadata={"controller_selection_must_verify_voltage":True})

# Split Cat6A permanent links at explicit work-area/ceiling jacks and split
# plug-connected power at explicit receptacle/floor-box assets.
JACK_TARGET_TYPES={
    "wireless_ap","workstation","mfp","camera","access_controller","intercom",
    "bas_controller","av_controller","av_dsp","av_camera","av_microphone",
    "network_display_decoder","ip_phone"
}
initial_connections=list(connections)
for conn in initial_connections:
    target=conn["to_asset_id"]
    t=asset_type(target)
    n=asset_level(target)

    if conn["cable_type"]=="CAT6A-HORIZONTAL" and t in JACK_TARGET_TYPES and n is not None and not target.endswith("::DATA-JACK"):
        jp=endpoint_jack_position(target)
        if jp:
            jack=target+"::DATA-JACK"
            add_asset(make_asset(jack,by_id[target]["label"]+" Data Jack","data_jack",n,jp,["DATA-STRUCTURED"],False,"work_area"))
            old_to_port=conn.get("to_port") or "ETH0"
            conn["to_asset_id"]=jack
            conn["to_port"]="RJ45"
            conn.setdefault("metadata",{})["termination_asset_id"]=jack
            conn["metadata"]["work_area_endpoint_id"]=target
            add_conn(jack,target,"CAT6A-PATCH","data",conn.get("protocols") or ["Ethernet/IP"],
                     from_port="RJ45",to_port=old_to_port,power_transport=conn.get("power_transport"),
                     metadata={"work_area_patch":True,"vlan":conn.get("metadata",{}).get("vlan")})

    if conn["cable_type"]=="120VAC-BRANCH" and n is not None and target in by_id:
        op=endpoint_outlet_position(target)
        if op:
            outlet=target+"::PWR-OUTLET"
            add_asset(make_asset(outlet,by_id[target]["label"]+" Power Outlet","receptacle",n,op,["ELEC-NORMAL"],False,"work_area"))
            original_source=conn["from_asset_id"]
            mode="emergency" if original_source=="ELEC-EMERGENCY" else "normal"
            panel_level=6 if n==7 else n
            panel=power_panels[panel_level][mode]
            conn["from_asset_id"]=panel
            conn["to_asset_id"]=outlet
            conn["from_port"]=None
            conn["to_port"]="LINE"
            conn.setdefault("metadata",{})["original_distribution_source"]=original_source
            conn["metadata"]["load_asset_id"]=target
            conn["metadata"]["branch_circuit_role"]="panel_to_receptacle"
            add_conn(outlet,target,"NEMA5-15-POWER-CORD","power",["120VAC"],
                     from_port="NEMA-5-15R",to_port="AC-IN",
                     metadata={"plug_connected_load":True,"served_by_panel":panel})

# The original add_conn calls generated connects_to relationships before the
# passive terminations above existed. Rebuild only the Step 4A/B physical
# connects_to edges from the final connection graph, then recompute upstream /
# downstream arrays from the complete relationship set.
relationships[:]=[x for x in relationships if not (x.get("type")=="connects_to" and str(x.get("relationship_id","")).startswith("REL::STEP4A::"))]
new_relationships[:]=[x for x in new_relationships if x.get("type")!="connects_to"]
for conn in connections:
    add_rel("connects_to",conn["from_asset_id"],conn["to_asset_id"],"operational",
            f"Physical/logical connection {conn['connection_id']} over {conn['cable_type']}")
for a in assets:
    a["systems"]["upstream_asset_ids"]=[]
    a["systems"]["downstream_asset_ids"]=[]
for rel in relationships:
    src,dst=rel.get("from_asset_id"),rel.get("to_asset_id")
    if src in by_id and dst in by_id:
        by_id[src]["systems"]["downstream_asset_ids"]=uniq(by_id[src]["systems"].get("downstream_asset_ids",[])+[dst])
        by_id[dst]["systems"]["upstream_asset_ids"]=uniq(by_id[dst]["systems"].get("upstream_asset_ids",[])+[src])


PATHWAYS=ROUTE["pathway_families"]
PATHWAY_VERSION=ROUTE["pathway_model_version"]
BUNDLE_LANES=[float(x) for x in ROUTE.get("bundle_lane_offsets_ft",[-.18,-.06,.06,.18])]

def _route_point(p):
    return [round(float(v),4) for v in p]

def _route_dist(a,b):
    return math.sqrt(sum((float(b[i])-float(a[i]))**2 for i in range(3)))

def _dedupe_route(points):
    out=[]
    for p in points:
        q=_route_point(p)
        if not out or _route_dist(q,out[-1])>.03:out.append(q)
    return out

def _soften_route(points,radius):
    pts=_dedupe_route(points)
    if len(pts)<3 or radius<=0:return pts
    out=[pts[0]]
    for i in range(1,len(pts)-1):
        a,p,b=pts[i-1],pts[i],pts[i+1]
        vin=[p[k]-a[k] for k in range(3)]
        vout=[b[k]-p[k] for k in range(3)]
        lin=math.sqrt(sum(v*v for v in vin));lout=math.sqrt(sum(v*v for v in vout))
        if lin<.06 or lout<.06:
            out.append(p);continue
        uin=[v/lin for v in vin];uout=[v/lout for v in vout]
        dot=sum(uin[k]*uout[k] for k in range(3))
        if dot>.998:
            out.append(p);continue
        r=min(float(radius),lin*.28,lout*.28)
        if r<.04:
            out.append(p);continue
        entry=[p[k]-uin[k]*r for k in range(3)]
        exit=[p[k]+uout[k]*r for k in range(3)]
        out.append(_route_point(entry))
        # Three points approximate a supported sweep instead of a zero-radius corner.
        for t in (.25,.5,.75):
            q=[(1-t)*(1-t)*entry[k]+2*(1-t)*t*p[k]+t*t*exit[k] for k in range(3)]
            out.append(_route_point(q))
        out.append(_route_point(exit))
    out.append(pts[-1])
    return _dedupe_route(out)

def pathway_family_for_cable(ctype):
    if ctype in {"CAT6A-HORIZONTAL","CAT6A-WAP-SPARE","OS2-SM-DUPLEX"}:return "telecommunications"
    if ctype in {"BACNET-MSTP-STP","OSDP-RS485-STP","24VDC-CLASS2"}:return "controls_security"
    if ctype in {"FIRE-ALARM-SLC","FIRE-ALARM-NAC"}:return "life_safety"
    if ctype=="120VAC-BRANCH":return "power_branch"
    if ctype=="208Y120V-FEEDER":return "power_feeder"
    if ctype=="SPEAKER-PAIR":return "av_audio"
    return "local_equipment"

def _lane_index(conn):
    raw=str(conn.get("connection_id","0")).split("::")[-1]
    try:n=int(raw)
    except ValueError:n=sum(ord(ch) for ch in raw)
    return n%len(BUNDLE_LANES) if BUNDLE_LANES else 0

def _lane_offset(conn):
    return BUNDLE_LANES[_lane_index(conn)] if BUNDLE_LANES else 0.0

def _pathway_height(n,family):
    spec=PATHWAYS[family]
    aff=spec.get("roof_height_aff_ft") if int(n)==7 and spec.get("roof_height_aff_ft") is not None else spec.get("height_aff_ft")
    return ffe(int(n))+float(aff or 0.0)

def _nearest_branch_x(x,family,lane=0.0):
    branches=[float(v) for v in PATHWAYS[family].get("branch_x_ft",[])]
    if not branches:return float(x)
    base=min(branches,key=lambda v:abs(v-float(x)))
    return base+lane*.35

def _route_metadata(conn,family,extra=None):
    spec=PATHWAYS[family]
    md=conn.setdefault("metadata",{})
    md["pathway_route_version"]=PATHWAY_VERSION
    md["pathway_family_id"]=family
    md["pathway_class"]=spec["pathway_class"]
    md["support_system"]=spec["support_system"]
    md["separation_group"]=spec["separation_group"]
    md["bundle_lane_index"]=_lane_index(conn)
    md["bundle_lane_offset_ft"]=round(_lane_offset(conn),3)
    md["visual_bend_radius_ft"]=float(spec.get("visual_bend_radius_ft",0.0))
    md["pathway_policy_ref"]="electronics-population-policy-v1.json::physical_routing"
    md["field_bend_radius_verification_required"]=family!="local_equipment"
    if extra:md.update(extra)
    return md

def _finalize_pathway_route(conn,base,family,extra=None):
    md=_route_metadata(conn,family,extra)
    return _soften_route(base,float(md["visual_bend_radius_ft"]))

def same_floor_route(conn,start,end,n,family):
    if not start or not end:return []
    spec=PATHWAYS[family];lane=_lane_offset(conn);z=_pathway_height(n,family)
    trunk_y=float(spec["trunk_y_ft"])+lane
    sx=_nearest_branch_x(start[0],family,lane);ex=_nearest_branch_x(end[0],family,lane)
    base=[start,[start[0],start[1],z],[sx,start[1],z]]
    if abs(sx-ex)<.04:
        base.append([sx,end[1],z])
    else:
        base.extend([[sx,trunk_y,z],[ex,trunk_y,z],[ex,end[1],z]])
    base.extend([[end[0],end[1],z],end])
    return _finalize_pathway_route(conn,base,family,{
        "pathway_trunk_y_ft":round(trunk_y,3),
        "pathway_branch_x_ft":[round(sx,3),round(ex,3)],
    })

def cross_floor_route(conn,start,end,src_level,dst_level,riser_xy,family):
    if not start or not end:return []
    spec=PATHWAYS[family];lane=_lane_offset(conn)
    z1=_pathway_height(src_level,family);z2=_pathway_height(dst_level,family)
    trunk_y=float(spec["trunk_y_ft"])+lane
    sx=_nearest_branch_x(start[0],family,lane);ex=_nearest_branch_x(end[0],family,lane)
    rx=float(riser_xy[0])+lane*.25;ry=float(riser_xy[1])
    base=[
        start,[start[0],start[1],z1],[sx,start[1],z1],[sx,trunk_y,z1],
        [rx,trunk_y,z1],[rx,ry,z1],[rx,ry,z2],
        [rx,trunk_y,z2],[ex,trunk_y,z2],[ex,end[1],z2],[end[0],end[1],z2],end
    ]
    return _finalize_pathway_route(conn,base,family,{
        "pathway_trunk_y_ft":round(trunk_y,3),
        "pathway_branch_x_ft":[round(sx,3),round(ex,3)],
        "riser_center_ft":[round(float(riser_xy[0]),3),round(float(riser_xy[1]),3)],
    })

def feeder_route(conn,start,end,n,mode):
    if not start or not end:return []
    family="power_feeder";lane=_lane_offset(conn)
    riser=R["emergency_power"] if mode=="emergency" else R["normal_power"]
    rx=float(riser[0])+lane*.22;ry=float(riser[1])
    zn=_pathway_height(n,"power_branch")
    panel_xy=SUP["emergency_panel"] if mode=="emergency" else SUP["normal_panel"]
    base=[
        start,[rx,ry,start[2]],[rx,ry,zn],
        [float(panel_xy[0]),float(panel_xy[1]),zn],
        [end[0],end[1],zn],end
    ]
    return _finalize_pathway_route(conn,base,family,{
        "riser_center_ft":[round(float(riser[0]),3),round(float(riser[1]),3)],
        "feeder_mode":mode,
    })

def local_equipment_route(conn,start,end):
    if not start or not end:return []
    # Keep patch/power cords local to racks/work areas. Device-center anchors can
    # legitimately coincide (stacked rack units, decoder on display, etc.); in
    # that case use a small deterministic service loop so the connection remains
    # physically traceable until the viewer snaps each end to its real component.
    d=_route_dist(start,end)
    lane=_lane_offset(conn)
    midz=(float(start[2])+float(end[2]))/2.0
    if d<.35:
        side=1.0 if _lane_index(conn)%2==0 else -1.0
        reach=.28+abs(lane)
        rise=.10+abs(lane)*.25
        base=[
            start,
            [float(start[0])+side*reach,float(start[1])+lane,midz+rise],
            [float(end[0])+side*reach,float(end[1])+lane,midz+rise],
            end,
        ]
        return _finalize_pathway_route(conn,base,"local_equipment",{
            "local_service_loop":True,
            "coincident_anchor_resolution":d<.03,
        })
    if d<=8.0:
        base=[start,[start[0],start[1]+lane,midz],[end[0],end[1]+lane,midz],end]
    else:
        base=[start,[start[0],start[1],midz],[end[0],start[1],midz],[end[0],end[1],midz],end]
    return _finalize_pathway_route(conn,base,"local_equipment",{"local_service_loop":False})

def connection_endpoint_position(aid):
    p=positions.get(aid)
    if p is not None:return p
    asset=by_id.get(aid)
    if asset:
        p=existing_position(asset)
        if p is not None:
            positions[aid]=p
            return p
    return None

def route_for_connection(conn):
    src,dst=conn["from_asset_id"],conn["to_asset_id"]
    a,b=connection_endpoint_position(src),connection_endpoint_position(dst)
    sa,sb=asset_level(src),asset_level(dst)
    ctype=conn["cable_type"]
    family=pathway_family_for_cable(ctype)

    # The building normal/emergency source is distribution authority rather than
    # a physical device. Feeders originate at the declared riser base when that
    # source intentionally has no equipment coordinate.
    if ctype=="208Y120V-FEEDER" and b is not None and sb is not None:
        mode="emergency" if src=="ELEC-EMERGENCY" else "normal"
        if a is None:
            riser=R["emergency_power"] if mode=="emergency" else R["normal_power"]
            a=[float(riser[0]),float(riser[1]),ffe(0)+8.6]
        return feeder_route(conn,a,b,sb,mode)

    if family=="local_equipment":
        if a is not None and b is not None:
            return local_equipment_route(conn,a,b)
        prior=conn.get("route") or []
        if len(prior)>=2:
            start=a if a is not None else prior[0]
            end=b if b is not None else prior[-1]
            return local_equipment_route(conn,start,end)
        return []

    if a is None or b is None:return []

    if ctype=="OS2-SM-DUPLEX":
        if sa is not None and sb is not None and sa!=sb:
            return cross_floor_route(conn,a,b,sa,sb,R["data"],family)
        return same_floor_route(conn,a,b,sa if sa is not None else (sb if sb is not None else 0),family)

    if ctype in {"CAT6A-HORIZONTAL","CAT6A-WAP-SPARE"}:
        n=sb if sb is not None else (sa if sa is not None else 0)
        return same_floor_route(conn,a,b,n,family)

    if ctype in {"BACNET-MSTP-STP","OSDP-RS485-STP","24VDC-CLASS2"}:
        if sa is not None and sb is not None and sa!=sb:
            return cross_floor_route(conn,a,b,sa,sb,R["controls"],family)
        return same_floor_route(conn,a,b,sb if sb is not None else (sa if sa is not None else 0),family)

    if ctype in {"FIRE-ALARM-SLC","FIRE-ALARM-NAC"}:
        if sa is not None and sb is not None and sa!=sb:
            return cross_floor_route(conn,a,b,sa,sb,R["fire"],family)
        return same_floor_route(conn,a,b,sb if sb is not None else (sa if sa is not None else 0),family)

    if ctype=="120VAC-BRANCH":
        if sa is not None and sb is not None and sa!=sb:
            mode="emergency" if "PANEL-E-" in src else "normal"
            riser=R["emergency_power"] if mode=="emergency" else R["normal_power"]
            return cross_floor_route(conn,a,b,sa,sb,riser,family)
        return same_floor_route(conn,a,b,sb if sb is not None else (sa if sa is not None else 0),family)

    if ctype=="SPEAKER-PAIR":
        return same_floor_route(conn,a,b,sb if sb is not None else (sa if sa is not None else 0),family)

    return local_equipment_route(conn,a,b)

def port_prefix(ctype):
    if "CAT6A" in ctype:return "RJ45"
    if "OS2" in ctype:return "LC"
    if "DAC" in ctype:return "SFP+"
    if "HDMI" in ctype:return "HDMI"
    if "DISPLAYPORT" in ctype:return "DP"
    if "POWER" in ctype or "VAC" in ctype:return "PWR"
    if "BACNET" in ctype:return "MSTP"
    if "OSDP" in ctype:return "OSDP"
    if "FIRE-ALARM" in ctype:return "FIRE"
    if "SPEAKER" in ctype:return "SPKR"
    return "PORT"

from_counts=defaultdict(int); to_counts=defaultdict(int)
for conn in connections:
    ctype=conn["cable_type"]
    route=route_for_connection(conn)
    conn["route"]=route
    conn.setdefault("metadata",{})["route_length_ft"]=route_length_ft(route) if len(route)>=2 else 0.0
    conn["metadata"]["concealment"]="concealed_above_ceiling_or_in_raceway" if pathway_family_for_cable(ctype)!="local_equipment" else "local_visible_or_equipment_internal"
    conn["metadata"]["lab_traceable"]=True
    pref=port_prefix(ctype)
    if not conn.get("from_port"):
        from_counts[(conn["from_asset_id"],pref)]+=1
        conn["from_port"]=f"{pref}-OUT-{from_counts[(conn['from_asset_id'],pref)]:02d}"
    if not conn.get("to_port"):
        to_counts[(conn["to_asset_id"],pref)]+=1
        conn["to_port"]=f"{pref}-IN-{to_counts[(conn['to_asset_id'],pref)]:02d}"

# wireless relationships: client pools to all APs on level
for profile in transient_profiles:
    n=profile["level_number"]; lev=profile["level_id"]
    aps=[a for a in by_id if a.startswith(f"{lev}-NET-WAP-")]
    for ap in aps:
        wireless_links.append({"wireless_link_id":f"RF::{lev}::{ap}","client_profile":lev+"-MOBILE-CLIENT-POOL","access_point_id":ap,
                               "medium":"WIFI-6E-RF","ssids":["SSID-EU-MEMBER","SSID-EU-STAFF","SSID-EU-GUEST"],
                               "estimated_concurrent_clients":profile["estimated_concurrent_mobile_clients"],"status":"design_intent_rf_survey_required"})

# logical VLAN relationships and security zones
vlan_for_prefix={
 "VOICE-PHONE":"LOGIC-VLAN-VOICE","SEC-CAM":"LOGIC-VLAN-CCTV","SEC-INTERCOM":"LOGIC-VLAN-ACCESS",
 "SEC-ACCESS-CTRL":"LOGIC-VLAN-ACCESS","BAS-CTRL":"LOGIC-VLAN-BAS-OT","AV-":"LOGIC-VLAN-AV",
 "PRINT-MFP":"LOGIC-VLAN-PRINTERS"
}
for sf,eps in net_endpoints.items():
    for ep in eps:
        if ep["asset_id"] in by_id and ep["vlan"] in by_id:
            add_rel("served_by",ep["asset_id"],ep["vlan"],"operational","Design-intent network segmentation")
# SSID -> VLAN
for s in policy["ssids"]:
    add_rel("served_by","LOGIC-"+s["id"],"LOGIC-"+s["maps_to"])

# lab catalog
labs=[]
def lab(lid_,tier,title,skills,faults,targets,tasks,success,reset):
    labs.append({"lab_id":lid_,"tier":tier,"title":title,"skills":skills,"fault_injection":faults,"target_selectors":targets,
                 "student_tasks":tasks,"success_criteria":success,"reset":reset,"mode":"SIMULATION","live_control_allowed":False})
foundation=[
 ("IT-LAB-001","Cable Media Identification",["identify copper/fiber/control/life-safety media"],["none"],["cable_type_catalog"],["classify representative links"],["all cable families correctly identified"]),
 ("IT-LAB-002","Patch Panel Trace",["MDF/IDF","patching"],["wrong_patch"],["patch_panel","access_switch"],["trace endpoint to switch port"],["correct physical path and port"]),
 ("IT-LAB-003","Copper Wiremap Fault",["wiremap","termination"],["open_pair","reversed_pair","split_pair"],["CAT6A-HORIZONTAL"],["diagnose wiremap"],["fault located and corrected"]),
 ("IT-LAB-004","Cat6A Certification",["NEXT","return loss","length"],["marginal_termination"],["CAT6A-HORIZONTAL"],["interpret certification result"],["correct pass/fail reasoning"]),
 ("IT-LAB-005","Fiber Polarity",["OS2","Tx/Rx"],["polarity_reversal"],["OS2-SM-DUPLEX"],["restore polarity"],["link restores"]),
 ("IT-LAB-006","Fiber OTDR Fault Location",["OTDR","loss events"],["fiber_bend","connector_loss"],["OS2-SM-DUPLEX"],["locate event distance"],["correct segment identified"]),
 ("IT-LAB-007","PoE Endpoint Bring-Up",["PoE","switch ports"],["poe_disabled"],["wireless_ap","ip_phone","camera"],["check PSE/PD state"],["endpoint powered without bypass"]),
 ("IT-LAB-008","Workstation Link Bring-Up",["Layer 1","DHCP"],["port_shutdown"],["workstation"],["restore switch port and address"],["client online"]),
]
for x in foundation: lab(x[0],"FOUNDATION",x[1],x[2],x[3],x[4],x[5],x[6],"restore baseline")
tech=[
 ("IT-LAB-009","Access VLAN Assignment",["802.1Q","access VLAN"],["wrong_vlan"],["workstation"],["identify VLAN mismatch"],["correct VLAN restored"]),
 ("IT-LAB-010","Trunk/Uplink Failure",["802.1Q trunk","fiber uplink"],["uplink_down"],["access_switch"],["trace IDF to core"],["floor connectivity restored"]),
 ("IT-LAB-011","Spanning-Tree Loop",["STP/RSTP"],["layer2_loop"],["access_switch"],["identify loop and blocked path"],["stable topology"]),
 ("IT-LAB-012","Dual-Uplink Failover",["redundancy"],["core_uplink_a_down"],["access_switch","collapsed_core_switch"],["verify surviving path"],["connectivity retained"]),
 ("IT-LAB-013","DHCP Failure",["DHCP","relay"],["dhcp_service_down"],["LOGIC-SVC-DHCP"],["differentiate link from addressing"],["lease restored"]),
 ("IT-LAB-014","DNS Failure",["DNS"],["dns_service_down"],["LOGIC-SVC-DNS"],["test IP vs name resolution"],["name resolution restored"]),
 ("IT-LAB-015","NTP Drift",["NTP","logs"],["ntp_service_down"],["LOGIC-SVC-NTP"],["correlate time drift"],["time sync restored"]),
 ("IT-LAB-016","IP Phone / Voice VLAN",["SIP","voice VLAN","PoE"],["voice_vlan_wrong"],["ip_phone"],["restore phone registration"],["voice endpoint registered"]),
 ("IT-LAB-017","Wi-Fi AP Offline",["WLAN","PoE"],["ap_link_down"],["wireless_ap"],["trace AP to switch/power"],["AP returns"]),
 ("IT-LAB-018","Wi-Fi Coverage / RF",["site survey","6 GHz"],["rf_attenuation"],["wireless_ap"],["compare predicted vs observed RF"],["appropriate AP/channel recommendation"]),
]
for x in tech: lab(x[0],"TECHNICIAN",x[1],x[2],x[3],x[4],x[5],x[6],"restore baseline")
admin=[
 ("IT-LAB-019","802.1X / RADIUS Authentication",["AAA","NAC"],["radius_policy_error"],["LOGIC-SVC-AAA-RADIUS"],["trace auth path"],["authorized endpoint succeeds"]),
 ("IT-LAB-020","Firewall ACL Block",["firewall","segmentation"],["acl_deny_error"],["firewall"],["identify denied flow"],["least-privilege rule repaired"]),
 ("IT-LAB-021","Remote-Access VPN",["VPN","MFA/AAA"],["vpn_auth_failure"],["LOGIC-SVC-VPN-REMOTE-ACCESS"],["trace VPN dependencies"],["secure tunnel established"]),
 ("IT-LAB-022","Virtualization Host Failure",["hypervisor","service placement"],["host_down"],["virtualization_host"],["map hosted logical services"],["services recovered/migrated"]),
 ("IT-LAB-023","Storage / NAS Failure",["storage","file service"],["nas_degraded"],["nas_storage"],["identify dependent services"],["storage healthy"]),
 ("IT-LAB-024","Backup Restore",["backup","recovery"],["deleted_config"],["backup_appliance","LOGIC-SVC-CONFIG-BACKUP"],["restore known-good config"],["validated restore"]),
 ("IT-LAB-025","Camera / VMS Loss",["CCTV","VMS"],["camera_link_down"],["camera","vms_nvr"],["trace PoE/network/storage"],["video restored"]),
 ("IT-LAB-026","Access Reader Failure",["OSDP","access control"],["reader_bus_fault"],["access_reader","access_controller"],["differentiate reader bus vs IP uplink"],["reader state restored"]),
]
for x in admin: lab(x[0],"ADMIN",x[1],x[2],x[3],x[4],x[5],x[6],"restore baseline")
advanced=[
 ("IT-LAB-027","BAS Controller Offline",["BAS","OT segmentation"],["bas_controller_offline"],["bas_controller"],["trace power/IP/field bus"],["controller restored"]),
 ("IT-LAB-028","BACnet Field-Bus Fault",["BACnet MS/TP"],["mstp_open"],["environment_sensor"],["locate field-bus break"],["sensor chain restored"]),
 ("IT-LAB-029","IT/OT Firewall Segmentation",["OT security"],["overpermissive_rule"],["LOGIC-VLAN-BAS-OT","firewall"],["reduce lateral access"],["required BAS flows only"]),
 ("IT-LAB-030","AV Multicast Flood",["IGMP","multicast"],["igmp_snooping_off"],["av_controller","network_display_decoder"],["identify flooded multicast"],["multicast constrained"]),
 ("IT-LAB-031","AV QoS Degradation",["QoS","AV-over-IP"],["qos_removed"],["av_camera","network_display_decoder"],["correlate loss/jitter"],["AV restored"]),
 ("IT-LAB-032","UPS / IDF Power Failure",["UPS","PoE dependencies"],["idf_ups_failure"],["rack_ups","access_switch"],["trace affected endpoints"],["network safely restored"]),
 ("IT-LAB-033","Backbone Fiber Cut",["fiber","redundancy"],["uplink_a_cut"],["OS2-SM-DUPLEX"],["locate cut and validate alternate link"],["service restored"]),
 ("IT-LAB-034","Whole-Floor Switch Failure",["fault propagation"],["access_switch_failed"],["access_switch"],["enumerate affected wired/PoE clients"],["correct switch replaced/reset"]),
]
for x in advanced: lab(x[0],"ADVANCED",x[1],x[2],x[3],x[4],x[5],x[6],"restore baseline")
expert=[
 ("IT-LAB-035","Firewall HA Failover",["HA","state synchronization"],["firewall_primary_down"],["firewall"],["validate session/path behavior"],["secondary active and stable"]),
 ("IT-LAB-036","Certificate / Identity Expiry",["PKI","WPA3-Enterprise","VPN"],["radius_cert_expired"],["LOGIC-SVC-AAA-RADIUS","LOGIC-SVC-VPN-REMOTE-ACCESS"],["identify certificate root cause"],["trusted auth restored"]),
 ("IT-LAB-037","Rogue Device / NAC",["802.1X","incident response"],["unauthorized_endpoint"],["LOGIC-VLAN-LAB"],["quarantine endpoint"],["rogue isolated"]),
 ("IT-LAB-038","SIEM Correlation",["syslog","SNMP","timeline"],["multi_device_alert"],["LOGIC-SVC-SYSLOG-SIEM"],["reconstruct incident"],["correct root cause/time sequence"]),
 ("IT-LAB-039","Cross-System Building Incident",["IT/OT","power","network"],["normal_power_loss","core_link_degraded","bas_alarm"],["whole_building"],["separate primary from secondary effects"],["safe restoration order"]),
 ("IT-LAB-040","Commissioning / As-Built Audit",["asset registry","cable certification","documentation"],["documentation_mismatch"],["whole_building"],["reconcile digital and physical evidence"],["registry/test records agree"])
]
for x in expert: lab(x[0],"EXPERT",x[1],x[2],x[3],x[4],x[5],x[6],"restore baseline")

# overlay geometry
scene=trimesh.Scene()
device_colors={
 "switch":[60,140,255,255],"firewall":[255,80,80,255],"server":[170,100,255,255],"wireless_ap":[255,255,255,255],
 "camera":[80,80,80,255],"workstation":[60,200,160,255],"monitor":[60,200,160,255],"ip_phone":[80,180,220,255],
 "bas":[80,220,100,255],"access":[255,180,60,255],"av":[80,220,220,255],"fire":[255,40,40,255],"default":[180,180,180,255]
}
def color_for_type(t):
    for k,c in device_colors.items():
        if k in t:return c
    return device_colors["default"]
def _align_z_to(direction):
    d=np.array(direction,dtype=float)
    norm=float(np.linalg.norm(d))
    if norm<1e-9:return np.eye(4)
    d=d/norm
    z=np.array([0.,0.,1.],dtype=float)
    axis=np.cross(z,d)
    axis_norm=float(np.linalg.norm(axis))
    if axis_norm<1e-9:
        if float(np.dot(z,d))<0:return trimesh.transformations.rotation_matrix(math.pi,[1,0,0])
        return np.eye(4)
    axis=axis/axis_norm
    angle=math.acos(clamp(float(np.dot(z,d)),-1,1))
    return trimesh.transformations.rotation_matrix(angle,axis)

def _place(mesh,center,direction=None):
    T=np.eye(4)
    if direction is not None:T=_align_z_to(direction)
    T[:3,3]=np.array(center,dtype=float)
    mesh.apply_transform(T)
    return mesh

def _component_mesh(asset_id,component_id,mesh,color,role,asset_type,metadata=None):
    mesh.visual.face_colors=color
    mesh.metadata={
        "asset_id":asset_id,
        "component_id":component_id,
        "component_role":role,
        "asset_type":asset_type,
        "installation_status":"step4c_device_component",
        **(metadata or {}),
    }
    return (component_id,mesh)

def camera_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    # Aim fixed cameras toward the occupied center of the floor. This is a
    # training orientation, not a security-design coverage certification.
    toward=np.array([36.0-p[0],36.0-p[1],0.0],dtype=float)
    if float(np.linalg.norm(toward))<1e-6:toward=np.array([-1.,0.,0.])
    toward=toward/float(np.linalg.norm(toward))
    side=np.array([-toward[1],toward[0],0.0],dtype=float)
    up=np.array([0.,0.,1.],dtype=float)

    body_center=p+toward*.14
    rear=body_center-toward*.42
    front=body_center+toward*.42
    mount_center=rear-toward*.28
    parts=[]

    mount=trimesh.creation.box(extents=[.42,.14,.52])
    parts.append(_component_mesh(aid,"MOUNT_PLATE",_place(mount,mount_center),[105,110,116,255],"mount","camera"))

    arm_start=mount_center+toward*.06
    arm_end=rear+toward*.05
    arm_vec=arm_end-arm_start
    arm=trimesh.creation.cylinder(radius=.075,height=float(np.linalg.norm(arm_vec)),sections=18)
    parts.append(_component_mesh(aid,"BRACKET_ARM",_place(arm,(arm_start+arm_end)/2,arm_vec),[95,100,106,255],"mount","camera"))

    housing=trimesh.creation.cylinder(radius=.235,height=.84,sections=28)
    parts.append(_component_mesh(aid,"HOUSING",_place(housing,body_center,toward),[224,228,232,255],"chassis","camera"))

    barrel_center=front+toward*.075
    barrel=trimesh.creation.cylinder(radius=.178,height=.18,sections=28)
    parts.append(_component_mesh(aid,"LENS_BARREL",_place(barrel,barrel_center,toward),[48,52,56,255],"optics","camera"))

    ir_center=front+toward*.175
    ir=trimesh.creation.cylinder(radius=.185,height=.022,sections=32)
    parts.append(_component_mesh(aid,"IR_LED_RING",_place(ir,ir_center,toward),[82,24,24,255],"illuminator","camera"))

    glass_center=front+toward*.19
    glass=trimesh.creation.cylinder(radius=.118,height=.028,sections=32)
    parts.append(_component_mesh(aid,"LENS_GLASS",_place(glass,glass_center,toward),[18,26,34,245],"optics","camera"))

    led_center=body_center+side*.205+up*.145
    led=trimesh.creation.icosphere(subdivisions=2,radius=.035)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,led_center),[40,220,95,255],"indicator","camera",{"state_driven":True}))

    port_center=rear-toward*.015-up*.125
    port=trimesh.creation.box(extents=[.15,.10,.11])
    parts.append(_component_mesh(aid,"RJ45_POE_PORT",_place(port,port_center),[35,105,175,255],"port","camera",{"connector":"8P8C/RJ45","services":["Ethernet/IP","PoE"]}))

    entry_center=mount_center-toward*.085-up*.12
    entry=trimesh.creation.cylinder(radius=.075,height=.10,sections=18)
    parts.append(_component_mesh(aid,"CABLE_ENTRY",_place(entry,entry_center,toward),[35,38,42,255],"cable_entry","camera"))

    archetype=device_archetypes["archetypes"]["camera"]
    device_component_records.append({
        "asset_id":aid,
        "label":a["label"],
        "asset_type":"camera",
        "archetype":"camera",
        "maturity":archetype["maturity"],
        "position_ft":[round(float(x),4) for x in p],
        "aim_vector":[round(float(x),6) for x in toward],
        "components":[{"component_id":cid,"mesh_name":aid if cid=="HOUSING" else f"{aid}::PART::{cid}","inspectable":True} for cid,_ in parts],
        "ports":archetype["ports"],
        "simulated_capabilities":archetype["simulated_capabilities"],
        "state_rules":archetype["state_rules"],
        "optics":archetype["optics"],
        "lab_behaviors":archetype["lab_behaviors"],
    })
    return parts


def _box_group(extents,centers):
    meshes=[]
    for center in centers:
        m=trimesh.creation.box(extents=extents)
        m.apply_translation(np.array(center,dtype=float))
        meshes.append(m)
    return trimesh.util.concatenate(meshes)

def _sphere_group(radius,centers):
    meshes=[]
    for center in centers:
        m=trimesh.creation.icosphere(subdivisions=1,radius=radius)
        m.apply_translation(np.array(center,dtype=float))
        meshes.append(m)
    return trimesh.util.concatenate(meshes)

def _cylinder_group(radius,height,centers,direction):
    meshes=[]
    for center in centers:
        m=trimesh.creation.cylinder(radius=radius,height=height,sections=16)
        meshes.append(_place(m,np.array(center,dtype=float),direction))
    return trimesh.util.concatenate(meshes)

PRIMARY_COMPONENT_BY_ARCHETYPE={
    "camera":"HOUSING",
    "access_switch":"RACK_CHASSIS",
    "patch_panel":"RACK_FRAME",
    "rack_ups":"RACK_CHASSIS",
    "pdu":"RACK_STRIP",
    "fiber_panel":"RACK_FRAME",
    "wireless_ap":"RADOME_HOUSING",
    "workstation":"CHASSIS",
    "monitor":"DISPLAY_PANEL",
    "ip_phone":"BASE",
    "mfp":"CHASSIS",
    "access_reader":"FACEPLATE",
    "intercom":"FACEPLATE",
    "access_controller":"ENCLOSURE",
    "electrical_panel":"ENCLOSURE",
    "bas_controller":"ENCLOSURE",
    "environment_sensor":"HOUSING",
    "av_controller":"RACK_CHASSIS",
    "av_dsp":"RACK_CHASSIS",
    "av_camera":"BODY",
    "av_microphone":"BODY",
    "network_display_decoder":"DECODER_CHASSIS",
    "speaker":"GRILLE_OR_CABINET",
    "fire_detector":"BASE",
    "fire_notification":"HOUSING",
    "fire_alarm_control_panel":"ENCLOSURE",
    "fire_alarm_read_only_gateway":"ENCLOSURE",
}
def _is_primary_component(archetype_key,component_id):
    return component_id==PRIMARY_COMPONENT_BY_ARCHETYPE.get(archetype_key)

def _record_componentized_device(a,archetype_key,parts):
    aid=a["asset_id"]; archetype=device_archetypes["archetypes"][archetype_key]
    record={
        "asset_id":aid,
        "label":a["label"],
        "asset_type":archetype_key,
        "archetype":archetype_key,
        "maturity":archetype["maturity"],
        "position_ft":[round(float(x),4) for x in positions[aid]],
        "components":[
            {
                "component_id":cid,
                "mesh_name":aid if _is_primary_component(archetype_key,cid) else f"{aid}::PART::{cid}",
                "inspectable":True,
            }
            for cid,_ in parts
        ],
        "ports":archetype.get("ports",[]),
        "simulated_capabilities":archetype.get("simulated_capabilities",[]),
        "planned_behaviors":archetype.get("planned_behaviors",[]),
    }
    device_component_records.append(record)

def access_switch_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.425
    rear_y=p[1]+.425

    chassis=trimesh.creation.box(extents=[1.72,.82,.32])
    parts.append(_component_mesh(aid,"RACK_CHASSIS",_place(chassis,p),[70,76,82,255],"chassis","access_switch"))

    jack_centers=[]
    for zoff in (-.048,.048):
        for col in range(24):
            xoff=-.70+(1.12/23.0)*col
            jack_centers.append([p[0]+xoff,front_y-.012,p[2]+zoff])
    jacks=_box_group([.040,.035,.042],jack_centers)
    parts.append(_component_mesh(aid,"RJ45_PORT_BANK",jacks,[28,32,36,255],"access_ports","access_switch",{
        "port_count":48,"connector":"8P8C/RJ45","label_scheme":"Gi1/0/1-48","poe_capable":True
    }))

    uplinks=_box_group([.070,.040,.082],[
        [p[0]+.575,front_y-.014,p[2]],
        [p[0]+.675,front_y-.014,p[2]],
    ])
    parts.append(_component_mesh(aid,"UPLINK_CAGES",uplinks,[118,124,132,255],"uplink_ports","access_switch",{
        "port_count":2,"connector":"SFP/SFP+","labels":["UPLINK-1","UPLINK-2"]
    }))

    power=trimesh.creation.box(extents=[.16,.045,.11])
    parts.append(_component_mesh(aid,"POWER_INPUT",_place(power,[p[0]+.63,rear_y+.012,p[2]]),[25,28,32,255],"power_port","access_switch",{
        "connector":"IEC rack power inlet"
    }))

    fans=_cylinder_group(.075,.026,[
        [p[0]-.24,rear_y+.012,p[2]],
        [p[0]-.04,rear_y+.012,p[2]],
    ],[0,1,0])
    parts.append(_component_mesh(aid,"FAN_BANK",fans,[42,46,50,255],"cooling","access_switch",{"fan_count":2}))

    leds=_sphere_group(.022,[
        [p[0]-.80,front_y-.028,p[2]+.075],
        [p[0]-.80,front_y-.028,p[2]+.025],
        [p[0]-.80,front_y-.028,p[2]-.025],
        [p[0]-.80,front_y-.028,p[2]-.075],
    ])
    parts.append(_component_mesh(aid,"STATUS_LEDS",leds,[50,220,105,255],"indicator","access_switch",{
        "state_driven":True,"indicators":["system","poe","uplink_a","uplink_b"]
    }))

    labels=_box_group([1.18,.018,.020],[
        [p[0]-.12,front_y-.030,p[2]+.125],
        [p[0]-.12,front_y-.030,p[2]-.125],
    ])
    parts.append(_component_mesh(aid,"PORT_LABELS",labels,[220,220,215,255],"labeling","access_switch",{
        "label_scheme":"Gi1/0/1-48 + UPLINK-1/2"
    }))

    _record_componentized_device(a,"access_switch",parts)
    return parts

def patch_panel_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.135
    rear_y=p[1]+.135

    frame=trimesh.creation.box(extents=[1.72,.24,.28])
    parts.append(_component_mesh(aid,"RACK_FRAME",_place(frame,p),[58,62,66,255],"frame","patch_panel"))

    front_centers=[]
    rear_centers=[]
    for zoff in (-.048,.048):
        for col in range(24):
            xoff=-.70+(1.40/23.0)*col
            front_centers.append([p[0]+xoff,front_y-.012,p[2]+zoff])
            rear_centers.append([p[0]+xoff,rear_y+.012,p[2]+zoff])
    front=_box_group([.046,.032,.044],front_centers)
    parts.append(_component_mesh(aid,"48x_FRONT_JACKS",front,[28,34,40,255],"front_ports","patch_panel",{
        "port_count":48,"connector":"8P8C/RJ45","label_scheme":"PORT-01-48"
    }))
    rear=_box_group([.042,.032,.038],rear_centers)
    parts.append(_component_mesh(aid,"REAR_TERMINATIONS",rear,[78,118,160,255],"rear_terminations","patch_panel",{
        "termination_count":48,"medium":"Cat6A permanent link"
    }))

    label=trimesh.creation.box(extents=[1.48,.018,.025])
    parts.append(_component_mesh(aid,"LABEL_STRIP",_place(label,[p[0],front_y-.030,p[2]+.115]),[225,225,218,255],"labeling","patch_panel",{
        "label_scheme":"PORT-01-48"
    }))

    manager=_box_group([1.46,.15,.050],[
        [p[0],front_y-.090,p[2]-.125],
    ])
    parts.append(_component_mesh(aid,"CABLE_MANAGEMENT",manager,[38,42,46,255],"cable_management","patch_panel",{
        "role":"horizontal_patch_cord_management"
    }))

    _record_componentized_device(a,"patch_panel",parts)
    return parts


def rack_ups_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.565
    rear_y=p[1]+.565

    chassis=trimesh.creation.box(extents=[1.72,1.08,.68])
    parts.append(_component_mesh(aid,"RACK_CHASSIS",_place(chassis,p),[58,62,68,255],"chassis","rack_ups"))

    display=trimesh.creation.box(extents=[.34,.025,.16])
    parts.append(_component_mesh(aid,"DISPLAY",_place(display,[p[0]-.42,front_y-.014,p[2]+.10]),[25,75,95,255],"operator_display","rack_ups",{
        "simulated":True,"shows":["input_state","battery_percent","load_percent","runtime_minutes"]
    }))

    batteries=_box_group([.34,.74,.18],[
        [p[0]-.28,p[1],p[2]-.16],
        [p[0]+.12,p[1],p[2]-.16],
        [p[0]+.52,p[1],p[2]-.16],
    ])
    parts.append(_component_mesh(aid,"BATTERY_MODULE",batteries,[42,46,50,255],"energy_storage","rack_ups",{
        "module_count":3,"training_only":True
    }))

    ac_in=trimesh.creation.box(extents=[.16,.035,.12])
    parts.append(_component_mesh(aid,"AC_INPUT",_place(ac_in,[p[0]-.60,rear_y+.010,p[2]+.08]),[28,30,34,255],"power_input","rack_ups",{
        "connector":"rack UPS AC input"
    }))

    outlets=_box_group([.11,.035,.08],[
        [p[0]-.20,rear_y+.010,p[2]+.11],
        [p[0]-.02,rear_y+.010,p[2]+.11],
        [p[0]+.16,rear_y+.010,p[2]+.11],
        [p[0]+.34,rear_y+.010,p[2]+.11],
        [p[0]-.20,rear_y+.010,p[2]-.03],
        [p[0]-.02,rear_y+.010,p[2]-.03],
        [p[0]+.16,rear_y+.010,p[2]-.03],
        [p[0]+.34,rear_y+.010,p[2]-.03],
    ])
    parts.append(_component_mesh(aid,"OUTPUT_BANK",outlets,[26,28,32,255],"protected_outputs","rack_ups",{
        "outlet_count":8,"service":"conditioned_backup_power"
    }))

    leds=_sphere_group(.025,[
        [p[0]+.55,front_y-.020,p[2]+.15],
        [p[0]+.55,front_y-.020,p[2]+.07],
        [p[0]+.55,front_y-.020,p[2]-.01],
    ])
    parts.append(_component_mesh(aid,"STATUS_LEDS",leds,[55,220,105,255],"indicator","rack_ups",{
        "state_driven":True,"indicators":["online","battery","alarm"]
    }))

    _record_componentized_device(a,"rack_ups",parts)
    return parts

def pdu_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.14
    rear_y=p[1]+.14

    strip=trimesh.creation.box(extents=[1.72,.24,.24])
    parts.append(_component_mesh(aid,"RACK_STRIP",_place(strip,p),[48,52,58,255],"distribution_chassis","pdu"))

    inlet=trimesh.creation.box(extents=[.15,.035,.10])
    parts.append(_component_mesh(aid,"POWER_INLET",_place(inlet,[p[0]-.70,rear_y+.010,p[2]]),[24,26,30,255],"power_input","pdu",{
        "connector":"IEC rack power inlet"
    }))

    outlet_centers=[]
    for i in range(8):
        outlet_centers.append([p[0]-.45+i*.13,front_y-.012,p[2]])
    outlets=_box_group([.085,.035,.10],outlet_centers)
    parts.append(_component_mesh(aid,"OUTLET_BANK",outlets,[24,28,32,255],"rack_outputs","pdu",{
        "outlet_count":8,"connector":"IEC rack outlets"
    }))

    breaker=trimesh.creation.box(extents=[.10,.035,.12])
    parts.append(_component_mesh(aid,"BREAKER_OR_PROTECTION",_place(breaker,[p[0]+.66,front_y-.012,p[2]]),[120,35,35,255],"overcurrent_protection","pdu",{
        "training_representation":True
    }))

    status=trimesh.creation.icosphere(subdivisions=1,radius=.027)
    parts.append(_component_mesh(aid,"STATUS_INDICATOR",_place(status,[p[0]+.78,front_y-.018,p[2]]),[50,220,105,255],"indicator","pdu",{
        "state_driven":True
    }))

    _record_componentized_device(a,"pdu",parts)
    return parts

def fiber_panel_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.20
    rear_y=p[1]+.20

    frame=trimesh.creation.box(extents=[1.72,.38,.30])
    parts.append(_component_mesh(aid,"RACK_FRAME",_place(frame,p),[62,66,72,255],"frame","fiber_panel"))

    adapter_centers=[]
    for row,zoff in enumerate((-.045,.045)):
        for col in range(6):
            adapter_centers.append([p[0]-.44+col*.17,front_y-.012,p[2]+zoff])
    adapters=_box_group([.070,.030,.045],adapter_centers)
    parts.append(_component_mesh(aid,"LC_ADAPTERS",adapters,[55,115,175,255],"fiber_adapters","fiber_panel",{
        "adapter_count":12,"connector":"LC duplex","medium":"OS2 single-mode"
    }))

    tray=trimesh.creation.box(extents=[1.18,.22,.10])
    parts.append(_component_mesh(aid,"SPLICE_TRAY",_place(tray,[p[0],p[1]+.04,p[2]-.08]),[42,46,52,255],"fiber_management","fiber_panel",{
        "training_representation":True
    }))

    entries=_cylinder_group(.045,.05,[
        [p[0]-.63,rear_y+.018,p[2]],
        [p[0]+.63,rear_y+.018,p[2]],
    ],[0,1,0])
    parts.append(_component_mesh(aid,"CABLE_ENTRY",entries,[32,36,42,255],"backbone_entry","fiber_panel",{
        "entry_count":2,"medium":"OS2 backbone"
    }))

    label=trimesh.creation.box(extents=[1.18,.018,.025])
    parts.append(_component_mesh(aid,"LABEL_STRIP",_place(label,[p[0],front_y-.028,p[2]+.12]),[225,225,218,255],"labeling","fiber_panel",{
        "label_scheme":"LC duplex backbone adapters"
    }))

    _record_componentized_device(a,"fiber_panel",parts)
    return parts


def data_jack_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.055
    rear_y=p[1]+.055

    plate=trimesh.creation.box(extents=[.28,.045,.38])
    parts.append(_component_mesh(aid,"FACEPLATE",_place(plate,p),[225,225,218,255],"mounting_faceplate","data_jack"))

    keystone=trimesh.creation.box(extents=[.115,.035,.105])
    parts.append(_component_mesh(aid,"KEYSTONE_JACK",_place(keystone,[p[0],front_y-.018,p[2]-.025]),[34,40,46,255],"front_connector","data_jack",{
        "connector":"8P8C/RJ45","service":"Cat6A Ethernet/PoE pass-through"
    }))

    label=trimesh.creation.box(extents=[.19,.018,.040])
    parts.append(_component_mesh(aid,"LABEL",_place(label,[p[0],front_y-.028,p[2]+.125]),[235,235,228,255],"identifier","data_jack",{
        "label_source":"asset_id"
    }))

    rear=trimesh.creation.box(extents=[.13,.045,.11])
    parts.append(_component_mesh(aid,"REAR_TERMINATION",_place(rear,[p[0],rear_y+.018,p[2]-.025]),[70,110,150,255],"permanent_link_termination","data_jack",{
        "medium":"Cat6A permanent link"
    }))

    _record_componentized_device(a,"data_jack",parts)
    return parts

def receptacle_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.055
    rear_y=p[1]+.055

    plate=trimesh.creation.box(extents=[.30,.045,.44])
    parts.append(_component_mesh(aid,"FACEPLATE",_place(plate,p),[232,230,220,255],"mounting_faceplate","receptacle"))

    duplex=_cylinder_group(.082,.032,[
        [p[0],front_y-.020,p[2]+.105],
        [p[0],front_y-.020,p[2]-.105],
    ],[0,1,0])
    parts.append(_component_mesh(aid,"DUPLEX_RECEPTACLE",duplex,[210,208,198,255],"load_connection","receptacle",{
        "connector":"2 x NEMA 5-15R","nominal_voltage":"120VAC"
    }))

    grounds=_cylinder_group(.024,.038,[
        [p[0],front_y-.040,p[2]+.125],
        [p[0],front_y-.040,p[2]-.085],
    ],[0,1,0])
    parts.append(_component_mesh(aid,"GROUND_CONTACT",grounds,[45,48,50,255],"equipment_ground","receptacle",{
        "contact_count":2
    }))

    rear=trimesh.creation.box(extents=[.18,.050,.20])
    parts.append(_component_mesh(aid,"REAR_BRANCH_TERMINATION",_place(rear,[p[0],rear_y+.020,p[2]]),[120,95,55,255],"branch_circuit_termination","receptacle",{
        "medium":"120VAC branch circuit","training_representation":True
    }))

    _record_componentized_device(a,"receptacle",parts)
    return parts

def wap_spare_jack_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]

    plate=trimesh.creation.box(extents=[.32,.32,.045])
    parts.append(_component_mesh(aid,"FACEPLATE_OR_CEILING_JACK",_place(plate,p),[225,225,218,255],"ceiling_mount","wap_spare_jack"))

    keystone=trimesh.creation.box(extents=[.115,.105,.035])
    parts.append(_component_mesh(aid,"KEYSTONE",_place(keystone,[p[0],p[1],p[2]-.040]),[34,40,46,255],"reserved_front_connector","wap_spare_jack",{
        "connector":"8P8C/RJ45","reserved":True
    }))

    label=trimesh.creation.box(extents=[.20,.055,.018])
    parts.append(_component_mesh(aid,"LABEL",_place(label,[p[0],p[1]+.105,p[2]-.034]),[235,235,228,255],"identifier","wap_spare_jack",{
        "label_source":"asset_id","reserved":True
    }))

    rear=trimesh.creation.box(extents=[.13,.11,.035])
    parts.append(_component_mesh(aid,"REAR_TERMINATION",_place(rear,[p[0],p[1],p[2]+.040]),[70,110,150,255],"reserved_permanent_link_termination","wap_spare_jack",{
        "medium":"Cat6A permanent link","reserved":True
    }))

    _record_componentized_device(a,"wap_spare_jack",parts)
    return parts


def wireless_ap_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]

    mount=trimesh.creation.cylinder(radius=.31,height=.035,sections=16)
    parts.append(_component_mesh(aid,"MOUNT",_place(mount,[p[0],p[1],p[2]+.055]),[160,165,170,255],"ceiling_mount","wireless_ap"))

    housing=trimesh.creation.cylinder(radius=.46,height=.15,sections=20)
    parts.append(_component_mesh(aid,"RADOME_HOUSING",_place(housing,[p[0],p[1],p[2]-.035]),[238,238,232,255],"radio_enclosure","wireless_ap",{
        "indoor_radio_enclosure":True
    }))

    led=trimesh.creation.icosphere(subdivisions=1,radius=.030)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0],p[1]-.39,p[2]-.105]),[50,210,105,255],"indicator","wireless_ap",{
        "state_driven":True
    }))

    rj45=trimesh.creation.box(extents=[.13,.08,.045])
    parts.append(_component_mesh(aid,"RJ45_POE_PORT",_place(rj45,[p[0],p[1]+.25,p[2]+.055]),[30,34,40,255],"network_power_port","wireless_ap",{
        "connector":"8P8C/RJ45","services":["Ethernet/IP","PoE"]
    }))

    entry=trimesh.creation.cylinder(radius=.055,height=.055,sections=12)
    parts.append(_component_mesh(aid,"CABLE_ENTRY",_place(entry,[p[0],p[1]+.35,p[2]+.055]),[60,64,70,255],"cable_entry","wireless_ap",{
        "medium":"Cat6A"
    }))

    _record_componentized_device(a,"wireless_ap",parts)
    return parts

def workstation_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.58
    rear_y=p[1]+.58

    chassis=trimesh.creation.box(extents=[.76,1.12,1.62])
    parts.append(_component_mesh(aid,"CHASSIS",_place(chassis,p),[52,56,62,255],"computer_chassis","workstation"))

    front_io=_box_group([.08,.035,.055],[
        [p[0]-.16,front_y-.010,p[2]+.48],
        [p[0]-.05,front_y-.010,p[2]+.48],
        [p[0]+.06,front_y-.010,p[2]+.48],
    ])
    parts.append(_component_mesh(aid,"FRONT_IO",front_io,[25,28,32,255],"user_io","workstation",{
        "modeled_ports":["USB","audio","service"]
    }))

    rear_io=trimesh.creation.box(extents=[.46,.035,.34])
    parts.append(_component_mesh(aid,"REAR_IO",_place(rear_io,[p[0],rear_y+.010,p[2]+.22]),[36,40,46,255],"rear_io","workstation"))

    psu=trimesh.creation.box(extents=[.30,.035,.25])
    parts.append(_component_mesh(aid,"POWER_SUPPLY",_place(psu,[p[0]+.18,rear_y+.018,p[2]-.48]),[28,30,34,255],"power_input","workstation",{
        "port_id":"AC_IN"
    }))

    nic=trimesh.creation.box(extents=[.115,.035,.085])
    parts.append(_component_mesh(aid,"NIC_PORT",_place(nic,[p[0]-.18,rear_y+.025,p[2]+.24]),[28,34,40,255],"network_port","workstation",{
        "port_id":"RJ45_ETH","connector":"8P8C/RJ45"
    }))

    display_ports=_box_group([.10,.035,.045],[
        [p[0]-.02,rear_y+.025,p[2]+.12],
        [p[0]+.12,rear_y+.025,p[2]+.12],
    ])
    parts.append(_component_mesh(aid,"DISPLAY_OUTPUTS",display_ports,[55,60,66,255],"video_outputs","workstation",{
        "port_id":"DISPLAY_OUT","connector":"DisplayPort"
    }))

    status=trimesh.creation.icosphere(subdivisions=1,radius=.028)
    parts.append(_component_mesh(aid,"STATUS_INDICATOR",_place(status,[p[0]+.22,front_y-.025,p[2]+.52]),[55,215,105,255],"indicator","workstation",{
        "state_driven":True
    }))

    _record_componentized_device(a,"workstation",parts)
    return parts

def monitor_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.105
    rear_y=p[1]+.105

    panel=trimesh.creation.box(extents=[1.72,.12,.98])
    parts.append(_component_mesh(aid,"DISPLAY_PANEL",_place(panel,[p[0],p[1],p[2]+.20]),[28,32,38,255],"display_surface","monitor"))

    bezel=_box_group([1.82,.05,.055],[
        [p[0],front_y-.020,p[2]+.705],
        [p[0],front_y-.020,p[2]-.305],
    ])
    bezel_side=_box_group([.055,.05,.96],[
        [p[0]-.88,front_y-.020,p[2]+.20],
        [p[0]+.88,front_y-.020,p[2]+.20],
    ])
    bezel=trimesh.util.concatenate([bezel,bezel_side])
    parts.append(_component_mesh(aid,"BEZEL",bezel,[18,20,24,255],"display_frame","monitor"))

    stand=_box_group([.11,.32,.62],[
        [p[0],p[1]+.08,p[2]-.58],
    ])
    base=trimesh.creation.box(extents=[.72,.48,.06])
    base.apply_translation([p[0],p[1]+.08,p[2]-.89])
    stand=trimesh.util.concatenate([stand,base])
    parts.append(_component_mesh(aid,"STAND_OR_MOUNT",stand,[65,68,72,255],"support","monitor"))

    power=trimesh.creation.box(extents=[.12,.035,.065])
    parts.append(_component_mesh(aid,"POWER_INPUT",_place(power,[p[0]+.55,rear_y+.020,p[2]-.20]),[26,28,32,255],"power_port","monitor",{
        "port_id":"AC_IN"
    }))

    video=trimesh.creation.box(extents=[.12,.035,.050])
    parts.append(_component_mesh(aid,"VIDEO_INPUT",_place(video,[p[0]+.34,rear_y+.020,p[2]-.20]),[45,50,56,255],"video_port","monitor",{
        "port_id":"DISPLAYPORT_IN","connector":"DisplayPort"
    }))

    led=trimesh.creation.icosphere(subdivisions=1,radius=.022)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0]+.78,front_y-.030,p[2]-.27]),[55,215,105,255],"indicator","monitor",{
        "state_driven":True
    }))

    _record_componentized_device(a,"monitor",parts)
    return parts

def ip_phone_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.25
    rear_y=p[1]+.25

    base=trimesh.creation.box(extents=[.74,.48,.16])
    parts.append(_component_mesh(aid,"BASE",_place(base,p),[42,46,52,255],"phone_base","ip_phone"))

    handset=_box_group([.12,.44,.10],[
        [p[0]-.27,p[1],p[2]+.16],
    ])
    earpieces=_box_group([.18,.12,.13],[
        [p[0]-.27,p[1]-.17,p[2]+.17],
        [p[0]-.27,p[1]+.17,p[2]+.17],
    ])
    handset=trimesh.util.concatenate([handset,earpieces])
    parts.append(_component_mesh(aid,"HANDSET",handset,[28,30,34,255],"handset","ip_phone"))

    keypad_centers=[]
    for row in range(4):
        for col in range(3):
            keypad_centers.append([p[0]+.06+col*.09,front_y-.012,p[2]+.10-row*.065])
    keypad=_box_group([.055,.025,.040],keypad_centers)
    parts.append(_component_mesh(aid,"KEYPAD",keypad,[82,86,92,255],"input_keys","ip_phone",{"key_count":12}))

    display=trimesh.creation.box(extents=[.28,.025,.12])
    parts.append(_component_mesh(aid,"DISPLAY",_place(display,[p[0]+.14,front_y-.016,p[2]+.16]),[25,70,88,255],"phone_display","ip_phone",{
        "simulated":True
    }))

    led=trimesh.creation.icosphere(subdivisions=1,radius=.018)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0]+.33,front_y-.020,p[2]+.17]),[55,215,105,255],"indicator","ip_phone",{
        "state_driven":True
    }))

    lan=trimesh.creation.box(extents=[.11,.035,.065])
    parts.append(_component_mesh(aid,"RJ45_LAN",_place(lan,[p[0]-.02,rear_y+.018,p[2]]),[28,34,40,255],"poe_network_port","ip_phone",{
        "services":["Ethernet/IP","PoE","voice"]
    }))

    pc=trimesh.creation.box(extents=[.11,.035,.065])
    parts.append(_component_mesh(aid,"RJ45_PC",_place(pc,[p[0]+.14,rear_y+.018,p[2]]),[28,34,40,255],"pc_passthrough_port","ip_phone",{
        "services":["Ethernet passthrough"]
    }))

    _record_componentized_device(a,"ip_phone",parts)
    return parts

def mfp_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.73
    rear_y=p[1]+.73

    chassis=trimesh.creation.box(extents=[1.50,1.40,2.65])
    parts.append(_component_mesh(aid,"CHASSIS",_place(chassis,p),[188,190,190,255],"printer_chassis","mfp"))

    adf=trimesh.creation.box(extents=[1.18,.86,.22])
    parts.append(_component_mesh(aid,"ADF",_place(adf,[p[0],p[1]+.08,p[2]+1.44]),[55,58,62,255],"automatic_document_feeder","mfp"))

    scanner=trimesh.creation.box(extents=[1.24,1.05,.12])
    parts.append(_component_mesh(aid,"SCANNER_BED",_place(scanner,[p[0],p[1],p[2]+1.23]),[36,42,48,255],"scanner_surface","mfp"))

    tray=trimesh.creation.box(extents=[.95,.45,.11])
    parts.append(_component_mesh(aid,"OUTPUT_TRAY",_place(tray,[p[0],front_y-.18,p[2]+.34]),[90,94,98,255],"paper_output","mfp"))

    panel=trimesh.creation.box(extents=[.48,.10,.22])
    parts.append(_component_mesh(aid,"CONTROL_PANEL",_place(panel,[p[0]+.42,front_y-.075,p[2]+.92]),[24,70,86,255],"operator_interface","mfp",{
        "simulated":True
    }))

    rj45=trimesh.creation.box(extents=[.115,.035,.075])
    parts.append(_component_mesh(aid,"RJ45_PORT",_place(rj45,[p[0]-.30,rear_y+.020,p[2]-.55]),[28,34,40,255],"network_port","mfp",{
        "port_id":"RJ45_ETH"
    }))

    power=trimesh.creation.box(extents=[.15,.035,.10])
    parts.append(_component_mesh(aid,"POWER_INLET",_place(power,[p[0]+.30,rear_y+.020,p[2]-.72]),[26,28,32,255],"power_port","mfp",{
        "port_id":"AC_IN"
    }))

    _record_componentized_device(a,"mfp",parts)
    return parts


def access_reader_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.105
    rear_y=p[1]+.105

    mount=trimesh.creation.box(extents=[.30,.12,.52])
    parts.append(_component_mesh(aid,"MOUNT",_place(mount,[p[0],rear_y-.02,p[2]]),[90,94,98,255],"mounting_backplate","access_reader"))

    face=trimesh.creation.box(extents=[.28,.12,.50])
    parts.append(_component_mesh(aid,"FACEPLATE",_place(face,p),[38,42,48,255],"reader_faceplate","access_reader"))

    zone=trimesh.creation.box(extents=[.20,.025,.22])
    parts.append(_component_mesh(aid,"READER_ZONE",_place(zone,[p[0],front_y-.015,p[2]+.03]),[30,72,92,255],"credential_read_zone","access_reader",{
        "sandbox_only":True
    }))

    led=trimesh.creation.icosphere(subdivisions=1,radius=.020)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0],front_y-.025,p[2]+.19]),[55,215,105,255],"indicator","access_reader",{"state_driven":True}))

    beeper=trimesh.creation.cylinder(radius=.035,height=.025,sections=12)
    parts.append(_component_mesh(aid,"BEEPER",_place(beeper,[p[0],front_y-.028,p[2]-.17],[0,1,0]),[70,74,78,255],"audible_indicator","access_reader"))

    terminal=trimesh.creation.box(extents=[.16,.035,.08])
    parts.append(_component_mesh(aid,"OSDP_TERMINAL",_place(terminal,[p[0],rear_y+.018,p[2]-.12]),[65,90,70,255],"reader_bus_terminal","access_reader",{
        "port_id":"OSDP_RS485"
    }))

    _record_componentized_device(a,"access_reader",parts)
    return parts

def intercom_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.13
    rear_y=p[1]+.13

    face=trimesh.creation.box(extents=[.42,.20,.62])
    parts.append(_component_mesh(aid,"FACEPLATE",_place(face,p),[72,76,82,255],"intercom_faceplate","intercom"))

    button=trimesh.creation.cylinder(radius=.065,height=.035,sections=16)
    parts.append(_component_mesh(aid,"CALL_BUTTON",_place(button,[p[0],front_y-.025,p[2]-.18],[0,1,0]),[45,100,130,255],"call_control","intercom",{
        "simulated":True
    }))

    mic=_cylinder_group(.022,.028,[
        [p[0]-.055,front_y-.025,p[2]+.18],
        [p[0],front_y-.025,p[2]+.18],
        [p[0]+.055,front_y-.025,p[2]+.18],
    ],[0,1,0])
    parts.append(_component_mesh(aid,"MICROPHONE",mic,[28,32,36,255],"audio_input","intercom"))

    speaker_centers=[]
    for row in range(3):
        for col in range(4):
            speaker_centers.append([p[0]-.09+col*.06,front_y-.025,p[2]-.01+row*.055])
    speaker=_cylinder_group(.016,.026,speaker_centers,[0,1,0])
    parts.append(_component_mesh(aid,"SPEAKER",speaker,[32,36,40,255],"audio_output","intercom"))

    led=trimesh.creation.icosphere(subdivisions=1,radius=.020)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0]+.14,front_y-.028,p[2]+.24]),[55,215,105,255],"indicator","intercom",{"state_driven":True}))

    rj45=trimesh.creation.box(extents=[.12,.035,.075])
    parts.append(_component_mesh(aid,"RJ45_POE_PORT",_place(rj45,[p[0],rear_y+.020,p[2]-.20]),[28,34,40,255],"network_power_port","intercom",{
        "services":["Ethernet/IP","PoE","intercom audio"]
    }))

    _record_componentized_device(a,"intercom",parts)
    return parts

def access_controller_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.24
    rear_y=p[1]+.24

    enclosure=trimesh.creation.box(extents=[1.22,.42,2.30])
    parts.append(_component_mesh(aid,"ENCLOSURE",_place(enclosure,p),[72,76,80,255],"secured_panel_enclosure","access_controller"))

    board=trimesh.creation.box(extents=[.82,.08,1.15])
    parts.append(_component_mesh(aid,"CONTROLLER_BOARD",_place(board,[p[0],front_y-.045,p[2]+.20]),[38,92,62,255],"access_controller_logic","access_controller",{
        "sandbox_only":True
    }))

    ethernet=trimesh.creation.box(extents=[.12,.035,.075])
    parts.append(_component_mesh(aid,"ETHERNET_PORT",_place(ethernet,[p[0]-.31,front_y-.095,p[2]-.28]),[28,34,40,255],"network_port","access_controller",{
        "port_id":"RJ45_ETH"
    }))

    terminals=_box_group([.09,.035,.07],[
        [p[0]-.12+i*.12,front_y-.095,p[2]-.48] for i in range(5)
    ])
    parts.append(_component_mesh(aid,"OSDP_TERMINALS",terminals,[65,95,70,255],"reader_bus_terminals","access_controller",{
        "port_id":"OSDP_BUSES","bus_count":5
    }))

    power=trimesh.creation.box(extents=[.16,.035,.10])
    parts.append(_component_mesh(aid,"POWER_INPUT",_place(power,[p[0]+.35,rear_y+.018,p[2]-.72]),[28,30,34,255],"power_input","access_controller",{
        "port_id":"AC_IN"
    }))

    battery=trimesh.creation.box(extents=[.72,.24,.52])
    parts.append(_component_mesh(aid,"BATTERY_ZONE",_place(battery,[p[0],p[1]+.05,p[2]-.72]),[45,48,52,255],"backup_battery_zone","access_controller",{
        "training_representation":True
    }))

    leds=_sphere_group(.022,[
        [p[0]+.35,front_y-.095,p[2]+.62],
        [p[0]+.35,front_y-.095,p[2]+.54],
        [p[0]+.35,front_y-.095,p[2]+.46],
    ])
    parts.append(_component_mesh(aid,"STATUS_LEDS",leds,[55,215,105,255],"indicators","access_controller",{
        "state_driven":True,"indicators":["panel","network","reader_bus"]
    }))

    _record_componentized_device(a,"access_controller",parts)
    return parts


def electrical_panel_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.20
    rear_y=p[1]+.20

    enclosure=trimesh.creation.box(extents=[1.34,.36,3.72])
    parts.append(_component_mesh(aid,"ENCLOSURE",_place(enclosure,p),[110,112,114,255],"panelboard_enclosure","electrical_panel"))

    deadfront=trimesh.creation.box(extents=[1.18,.045,3.48])
    parts.append(_component_mesh(aid,"DEADFRONT",_place(deadfront,[p[0],front_y-.025,p[2]]),[178,178,172,255],"protective_deadfront","electrical_panel"))

    main=trimesh.creation.box(extents=[.42,.055,.34])
    parts.append(_component_mesh(aid,"MAIN_BREAKER",_place(main,[p[0],front_y-.055,p[2]+1.35]),[52,56,60,255],"main_overcurrent_device","electrical_panel",{
        "port_id":"FEEDER_INPUT","state_driven":True
    }))

    breaker_centers=[]
    for row in range(10):
        breaker_centers.append([p[0]-.29,front_y-.055,p[2]+.92-row*.19])
        breaker_centers.append([p[0]+.29,front_y-.055,p[2]+.92-row*.19])
    breakers=_box_group([.22,.055,.12],breaker_centers)
    parts.append(_component_mesh(aid,"BRANCH_BREAKERS",breakers,[58,62,66,255],"branch_overcurrent_devices","electrical_panel",{
        "modeled_breaker_count":20,"port_id":"BRANCH_CIRCUIT_OUTPUTS","state_driven":True
    }))

    directory=trimesh.creation.box(extents=[.42,.035,.88])
    parts.append(_component_mesh(aid,"CIRCUIT_DIRECTORY",_place(directory,[p[0]+.37,front_y-.055,p[2]-1.25]),[232,230,218,255],"circuit_labeling","electrical_panel",{
        "sandbox_directory":True
    }))

    bars=_box_group([.08,.035,1.45],[
        [p[0]-.47,rear_y+.025,p[2]-.35],
        [p[0]+.47,rear_y+.025,p[2]-.35],
    ])
    parts.append(_component_mesh(aid,"NEUTRAL_GROUND_BARS",bars,[180,150,70,255],"neutral_ground_bars","electrical_panel",{
        "training_representation":True
    }))

    _record_componentized_device(a,"electrical_panel",parts)
    return parts

def bas_controller_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.24
    rear_y=p[1]+.24

    enclosure=trimesh.creation.box(extents=[1.18,.42,2.18])
    parts.append(_component_mesh(aid,"ENCLOSURE",_place(enclosure,p),[88,92,96,255],"controller_enclosure","bas_controller"))

    board=trimesh.creation.box(extents=[.82,.07,1.16])
    parts.append(_component_mesh(aid,"CONTROLLER_BOARD",_place(board,[p[0],front_y-.045,p[2]+.12]),[42,98,68,255],"bas_logic_board","bas_controller",{
        "sandbox_only":True
    }))

    eth=trimesh.creation.box(extents=[.12,.035,.075])
    parts.append(_component_mesh(aid,"ETHERNET_PORT",_place(eth,[p[0]-.30,front_y-.085,p[2]-.42]),[28,34,40,255],"network_port","bas_controller",{
        "port_id":"RJ45_ETH"
    }))

    terminals=_box_group([.08,.035,.065],[
        [p[0]-.14+i*.095,front_y-.085,p[2]-.62] for i in range(4)
    ])
    parts.append(_component_mesh(aid,"BACNET_TERMINALS",terminals,[70,105,75,255],"field_bus_terminals","bas_controller",{
        "port_id":"BACNET_MSTP"
    }))

    power=trimesh.creation.box(extents=[.14,.035,.09])
    parts.append(_component_mesh(aid,"POWER_INPUT",_place(power,[p[0]+.32,rear_y+.020,p[2]-.68]),[28,30,34,255],"power_input","bas_controller",{
        "port_id":"AC_IN"
    }))

    leds=_sphere_group(.021,[
        [p[0]+.33,front_y-.085,p[2]+.52],
        [p[0]+.33,front_y-.085,p[2]+.44],
        [p[0]+.33,front_y-.085,p[2]+.36],
    ])
    parts.append(_component_mesh(aid,"STATUS_LEDS",leds,[55,215,105,255],"indicators","bas_controller",{
        "state_driven":True,"indicators":["controller","network","field_bus"]
    }))

    _record_componentized_device(a,"bas_controller",parts)
    return parts

def environment_sensor_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.11
    rear_y=p[1]+.11

    housing=trimesh.creation.box(extents=[.34,.18,.34])
    parts.append(_component_mesh(aid,"HOUSING",_place(housing,p),[224,224,218,255],"sensor_housing","environment_sensor"))

    vent_centers=[]
    for row in range(3):
        for col in range(4):
            vent_centers.append([p[0]-.09+col*.06,front_y-.020,p[2]+.07-row*.06])
    vents=_cylinder_group(.012,.020,vent_centers,[0,1,0])
    parts.append(_component_mesh(aid,"SENSOR_VENTS",vents,[70,74,78,255],"air_sampling_vents","environment_sensor"))

    status=trimesh.creation.icosphere(subdivisions=1,radius=.018)
    parts.append(_component_mesh(aid,"STATUS_INDICATOR",_place(status,[p[0]+.12,front_y-.025,p[2]+.12]),[55,215,105,255],"indicator","environment_sensor",{
        "state_driven":True
    }))

    bacnet=trimesh.creation.box(extents=[.10,.035,.06])
    parts.append(_component_mesh(aid,"BACNET_TERMINAL",_place(bacnet,[p[0]-.08,rear_y+.018,p[2]-.10]),[70,105,75,255],"field_bus_terminal","environment_sensor",{
        "port_id":"BACNET_MSTP"
    }))

    power=trimesh.creation.box(extents=[.10,.035,.06])
    parts.append(_component_mesh(aid,"24V_TERMINAL",_place(power,[p[0]+.08,rear_y+.018,p[2]-.10]),[130,85,55,255],"class2_power_terminal","environment_sensor",{
        "port_id":"24VDC_CLASS2"
    }))

    _record_componentized_device(a,"environment_sensor",parts)
    return parts


def av_controller_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]; front_y=p[1]-.42; rear_y=p[1]+.42
    chassis=trimesh.creation.box(extents=[1.72,.80,.34])
    parts.append(_component_mesh(aid,"RACK_CHASSIS",_place(chassis,p),[62,66,72,255],"controller_chassis","av_controller"))
    status=_box_group([.055,.028,.055],[[p[0]-.62+i*.12,front_y-.020,p[2]] for i in range(5)])
    parts.append(_component_mesh(aid,"FRONT_STATUS",status,[55,210,105,255],"front_status_panel","av_controller",{"state_driven":True}))
    net=trimesh.creation.box(extents=[.12,.035,.075])
    parts.append(_component_mesh(aid,"NETWORK_PORT",_place(net,[p[0]-.52,rear_y+.018,p[2]]),[28,34,40,255],"network_port","av_controller",{"port_id":"RJ45_ETH"}))
    power=trimesh.creation.box(extents=[.15,.035,.10])
    parts.append(_component_mesh(aid,"POWER_INPUT",_place(power,[p[0]+.58,rear_y+.018,p[2]]),[26,28,32,255],"power_port","av_controller",{"port_id":"AC_IN"}))
    control=_box_group([.08,.035,.065],[[p[0]-.14+i*.10,rear_y+.018,p[2]] for i in range(4)])
    parts.append(_component_mesh(aid,"CONTROL_IO",control,[75,95,110,255],"control_io","av_controller",{"port_id":"CONTROL_IO"}))
    _record_componentized_device(a,"av_controller",parts); return parts

def av_dsp_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]; front_y=p[1]-.42; rear_y=p[1]+.42
    chassis=trimesh.creation.box(extents=[1.72,.80,.42])
    parts.append(_component_mesh(aid,"RACK_CHASSIS",_place(chassis,p),[56,60,66,255],"dsp_chassis","av_dsp"))
    meters=_box_group([.035,.025,.13],[[p[0]-.55+i*.10,front_y-.020,p[2]] for i in range(10)])
    parts.append(_component_mesh(aid,"FRONT_METERS",meters,[60,205,115,255],"audio_meters","av_dsp",{"state_driven":True}))
    net=trimesh.creation.box(extents=[.12,.035,.075])
    parts.append(_component_mesh(aid,"NETWORK_PORT",_place(net,[p[0]-.60,rear_y+.018,p[2]+.08]),[28,34,40,255],"network_port","av_dsp",{"port_id":"RJ45_ETH"}))
    audio=_box_group([.08,.035,.065],[[p[0]-.30+i*.10,rear_y+.018,p[2]+.08] for i in range(5)])
    parts.append(_component_mesh(aid,"AUDIO_IO",audio,[75,95,110,255],"audio_io","av_dsp",{"port_id":"AUDIO_IO"}))
    spk=_box_group([.08,.035,.065],[[p[0]-.25+i*.12,rear_y+.018,p[2]-.08] for i in range(5)])
    parts.append(_component_mesh(aid,"SPEAKER_OUTPUTS",spk,[120,80,55,255],"speaker_outputs","av_dsp",{"port_id":"SPEAKER_OUT"}))
    power=trimesh.creation.box(extents=[.15,.035,.10])
    parts.append(_component_mesh(aid,"POWER_INPUT",_place(power,[p[0]+.60,rear_y+.018,p[2]-.06]),[26,28,32,255],"power_port","av_dsp",{"port_id":"AC_IN"}))
    _record_componentized_device(a,"av_dsp",parts); return parts

def av_camera_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    mount=trimesh.creation.cylinder(radius=.16,height=.10,sections=16)
    parts.append(_component_mesh(aid,"MOUNT",_place(mount,[p[0],p[1],p[2]+.25]),[110,114,118,255],"camera_mount","av_camera"))
    body=trimesh.creation.box(extents=[.42,.38,.28])
    parts.append(_component_mesh(aid,"BODY",_place(body,p),[70,74,80,255],"camera_body","av_camera"))
    lens=trimesh.creation.cylinder(radius=.095,height=.14,sections=18)
    parts.append(_component_mesh(aid,"LENS",_place(lens,[p[0],p[1]-.24,p[2]],[0,1,0]),[24,28,34,255],"optics","av_camera"))
    led=trimesh.creation.icosphere(subdivisions=1,radius=.020)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0]+.14,p[1]-.21,p[2]+.08]),[55,215,105,255],"indicator","av_camera",{"state_driven":True}))
    port=trimesh.creation.box(extents=[.11,.035,.07])
    parts.append(_component_mesh(aid,"RJ45_POE_PORT",_place(port,[p[0],p[1]+.21,p[2]-.06]),[28,34,40,255],"network_power_port","av_camera",{"port_id":"RJ45_POE_PORT"}))
    _record_componentized_device(a,"av_camera",parts); return parts

def av_microphone_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    mount=trimesh.creation.cylinder(radius=.12,height=.05,sections=16)
    parts.append(_component_mesh(aid,"MOUNT",_place(mount,[p[0],p[1],p[2]+.22]),[115,118,122,255],"mount","av_microphone"))
    body=trimesh.creation.cylinder(radius=.18,height=.28,sections=18)
    parts.append(_component_mesh(aid,"BODY",_place(body,p),[64,68,74,255],"microphone_body","av_microphone"))
    capsules=_sphere_group(.035,[[p[0]+dx,p[1]+dy,p[2]-.12] for dx,dy in [(-.07,0),(.07,0),(0,-.07),(0,.07)]])
    parts.append(_component_mesh(aid,"CAPSULE_OR_ARRAY",capsules,[30,34,38,255],"microphone_array","av_microphone"))
    led=trimesh.creation.icosphere(subdivisions=1,radius=.018)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0]+.13,p[1],p[2]-.12]),[55,215,105,255],"indicator","av_microphone",{"state_driven":True}))
    port=trimesh.creation.box(extents=[.11,.07,.035])
    parts.append(_component_mesh(aid,"RJ45_POE_PORT",_place(port,[p[0],p[1]+.10,p[2]+.17]),[28,34,40,255],"network_power_port","av_microphone",{"port_id":"RJ45_POE_PORT"}))
    _record_componentized_device(a,"av_microphone",parts); return parts

def network_display_decoder_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]; front_y=p[1]-.16; rear_y=p[1]+.16
    chassis=trimesh.creation.box(extents=[.56,.28,.20])
    parts.append(_component_mesh(aid,"DECODER_CHASSIS",_place(chassis,p),[62,66,72,255],"decoder_chassis","network_display_decoder"))
    rj=trimesh.creation.box(extents=[.11,.035,.065])
    parts.append(_component_mesh(aid,"RJ45_POE_PORT",_place(rj,[p[0]-.14,rear_y+.018,p[2]]),[28,34,40,255],"network_power_port","network_display_decoder",{"port_id":"RJ45_POE_PORT"}))
    hdmi=trimesh.creation.box(extents=[.11,.035,.045])
    parts.append(_component_mesh(aid,"HDMI_OUTPUT",_place(hdmi,[p[0]+.08,rear_y+.018,p[2]]),[45,50,56,255],"video_output","network_display_decoder",{"port_id":"HDMI_OUT"}))
    led=trimesh.creation.icosphere(subdivisions=1,radius=.018)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0]+.20,front_y-.020,p[2]]),[55,215,105,255],"indicator","network_display_decoder",{"state_driven":True}))
    _record_componentized_device(a,"network_display_decoder",parts); return parts

def speaker_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    cabinet=trimesh.creation.cylinder(radius=.32,height=.24,sections=18)
    parts.append(_component_mesh(aid,"GRILLE_OR_CABINET",_place(cabinet,p),[222,222,216,255],"speaker_enclosure","speaker"))
    driver=trimesh.creation.cylinder(radius=.22,height=.045,sections=18)
    parts.append(_component_mesh(aid,"DRIVER",_place(driver,[p[0],p[1],p[2]-.14]),[40,44,48,255],"audio_driver","speaker"))
    mount=trimesh.creation.cylinder(radius=.18,height=.05,sections=16)
    parts.append(_component_mesh(aid,"MOUNT",_place(mount,[p[0],p[1],p[2]+.15]),[115,118,122,255],"mount","speaker"))
    terminals=_box_group([.06,.06,.035],[[p[0]-.05,p[1]+.18,p[2]+.04],[p[0]+.05,p[1]+.18,p[2]+.04]])
    parts.append(_component_mesh(aid,"SPEAKER_TERMINALS",terminals,[120,80,55,255],"speaker_pair_terminals","speaker",{"port_id":"SPEAKER_PAIR"}))
    _record_componentized_device(a,"speaker",parts); return parts


def fire_detector_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    base=trimesh.creation.cylinder(radius=.21,height=.05,sections=18)
    parts.append(_component_mesh(aid,"BASE",_place(base,[p[0],p[1],p[2]+.07]),[215,215,208,255],"detector_base","fire_detector"))
    chamber=trimesh.creation.cylinder(radius=.17,height=.13,sections=18)
    parts.append(_component_mesh(aid,"SENSING_CHAMBER",_place(chamber,[p[0],p[1],p[2]-.03]),[235,235,228,255],"sensing_chamber","fire_detector",{"training_representation":True}))
    led=trimesh.creation.icosphere(subdivisions=1,radius=.016)
    parts.append(_component_mesh(aid,"STATUS_LED",_place(led,[p[0],p[1]-.16,p[2]-.07]),[210,45,45,255],"indicator","fire_detector",{"state_driven":True}))
    terminals=_box_group([.065,.04,.045],[
        [p[0]-.045,p[1]+.14,p[2]+.075],
        [p[0]+.045,p[1]+.14,p[2]+.075],
    ])
    parts.append(_component_mesh(aid,"SLC_TERMINALS",terminals,[90,60,45,255],"signaling_line_terminals","fire_detector",{"port_id":"FIRE_ALARM_SLC"}))
    _record_componentized_device(a,"fire_detector",parts)
    return parts

def fire_notification_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.11
    rear_y=p[1]+.11
    housing=trimesh.creation.box(extents=[.42,.18,.48])
    parts.append(_component_mesh(aid,"HOUSING",_place(housing,p),[205,45,45,255],"notification_housing","fire_notification"))
    strobe=trimesh.creation.box(extents=[.24,.04,.12])
    parts.append(_component_mesh(aid,"STROBE",_place(strobe,[p[0],front_y-.025,p[2]+.12]),[235,235,220,255],"visual_notification","fire_notification",{"training_only":True}))
    sounder=trimesh.creation.cylinder(radius=.105,height=.035,sections=14)
    parts.append(_component_mesh(aid,"SOUNDER",_place(sounder,[p[0],front_y-.03,p[2]-.10],[0,1,0]),[90,20,20,255],"audible_notification","fire_notification",{"training_only":True}))
    terminals=_box_group([.065,.04,.045],[
        [p[0]-.045,rear_y+.018,p[2]-.14],
        [p[0]+.045,rear_y+.018,p[2]-.14],
    ])
    parts.append(_component_mesh(aid,"NAC_TERMINALS",terminals,[90,60,45,255],"notification_circuit_terminals","fire_notification",{"port_id":"FIRE_ALARM_NAC"}))
    _record_componentized_device(a,"fire_notification",parts)
    return parts

def fire_alarm_control_panel_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.24
    rear_y=p[1]+.24
    enclosure=trimesh.creation.box(extents=[1.28,.42,2.50])
    parts.append(_component_mesh(aid,"ENCLOSURE",_place(enclosure,p),[135,38,38,255],"panel_enclosure","fire_alarm_control_panel"))
    display=trimesh.creation.box(extents=[.58,.035,.24])
    parts.append(_component_mesh(aid,"DISPLAY",_place(display,[p[0],front_y-.04,p[2]+.68]),[24,62,70,255],"read_only_training_display","fire_alarm_control_panel",{"training_only":True}))
    keypad_centers=[]
    for row in range(3):
        for col in range(4):
            keypad_centers.append([p[0]-.18+col*.12,front_y-.045,p[2]+.30-row*.10])
    keypad=_box_group([.07,.025,.055],keypad_centers)
    parts.append(_component_mesh(aid,"KEYPAD",keypad,[80,82,86,255],"training_panel_input","fire_alarm_control_panel",{"training_only":True}))
    leds=_sphere_group(.022,[
        [p[0]-.34,front_y-.05,p[2]+.50],
        [p[0]-.26,front_y-.05,p[2]+.50],
        [p[0]-.18,front_y-.05,p[2]+.50],
    ])
    parts.append(_component_mesh(aid,"STATUS_LEDS",leds,[220,80,55,255],"indicators","fire_alarm_control_panel",{"state_driven":True}))
    slc=_box_group([.08,.035,.06],[[p[0]-.18+i*.10,rear_y+.02,p[2]-.50] for i in range(4)])
    parts.append(_component_mesh(aid,"SLC_TERMINALS",slc,[90,60,45,255],"signaling_line_terminals","fire_alarm_control_panel",{"port_id":"SLC"}))
    nac=_box_group([.08,.035,.06],[[p[0]-.18+i*.10,rear_y+.02,p[2]-.67] for i in range(4)])
    parts.append(_component_mesh(aid,"NAC_TERMINALS",nac,[110,65,45,255],"notification_circuit_terminals","fire_alarm_control_panel",{"port_id":"NAC"}))
    power=trimesh.creation.box(extents=[.64,.18,.42])
    parts.append(_component_mesh(aid,"POWER_SECTION",_place(power,[p[0],p[1]+.05,p[2]-.92]),[45,48,52,255],"panel_power_section","fire_alarm_control_panel",{"port_id":"AC_IN","training_representation":True}))
    _record_componentized_device(a,"fire_alarm_control_panel",parts)
    return parts

def fire_alarm_read_only_gateway_component_meshes(a):
    aid=a["asset_id"]; p=np.array(positions[aid],dtype=float)
    parts=[]
    front_y=p[1]-.22
    rear_y=p[1]+.22
    enclosure=trimesh.creation.box(extents=[1.10,.38,1.72])
    parts.append(_component_mesh(aid,"ENCLOSURE",_place(enclosure,p),[82,86,92,255],"gateway_enclosure","fire_alarm_read_only_gateway"))
    fire_if=trimesh.creation.box(extents=[.30,.035,.12])
    parts.append(_component_mesh(aid,"FIRE_INTERFACE",_place(fire_if,[p[0]-.22,front_y-.035,p[2]+.20]),[120,55,45,255],"read_only_fire_interface","fire_alarm_read_only_gateway",{"port_id":"FIRE_INTERFACE","read_only":True}))
    rj45=trimesh.creation.box(extents=[.12,.035,.075])
    parts.append(_component_mesh(aid,"RJ45_PORT",_place(rj45,[p[0]+.18,front_y-.035,p[2]+.20]),[28,34,40,255],"read_only_network_port","fire_alarm_read_only_gateway",{"port_id":"RJ45_ETH","read_only":True}))
    power=trimesh.creation.box(extents=[.15,.035,.10])
    parts.append(_component_mesh(aid,"POWER_INPUT",_place(power,[p[0]+.28,rear_y+.018,p[2]-.48]),[28,30,34,255],"power_input","fire_alarm_read_only_gateway",{"port_id":"AC_IN"}))
    leds=_sphere_group(.021,[
        [p[0]-.20,front_y-.04,p[2]+.52],
        [p[0]-.12,front_y-.04,p[2]+.52],
        [p[0]-.04,front_y-.04,p[2]+.52],
    ])
    parts.append(_component_mesh(aid,"STATUS_LEDS",leds,[55,190,105,255],"indicators","fire_alarm_read_only_gateway",{"state_driven":True}))
    _record_componentized_device(a,"fire_alarm_read_only_gateway",parts)
    return parts

def physical_meshes_for_asset(a):
    p=positions.get(a["asset_id"])
    if not p:return []
    t=a["classification"]["asset_type"]
    color=color_for_type(t)
    if t=="camera":
        return camera_component_meshes(a)
    if t=="access_switch":
        return access_switch_component_meshes(a)
    if t=="patch_panel":
        return patch_panel_component_meshes(a)
    if t=="rack_ups":
        return rack_ups_component_meshes(a)
    if t=="pdu":
        return pdu_component_meshes(a)
    if t=="fiber_panel":
        return fiber_panel_component_meshes(a)
    if t=="data_jack":
        return data_jack_component_meshes(a)
    if t=="receptacle":
        return receptacle_component_meshes(a)
    if t=="wap_spare_jack":
        return wap_spare_jack_component_meshes(a)
    if t=="wireless_ap":
        return wireless_ap_component_meshes(a)
    if t=="workstation":
        return workstation_component_meshes(a)
    if t=="monitor":
        return monitor_component_meshes(a)
    if t=="ip_phone":
        return ip_phone_component_meshes(a)
    if t=="mfp":
        return mfp_component_meshes(a)
    if t=="access_reader":
        return access_reader_component_meshes(a)
    if t=="intercom":
        return intercom_component_meshes(a)
    if t=="access_controller":
        return access_controller_component_meshes(a)
    if t=="electrical_panel":
        return electrical_panel_component_meshes(a)
    if t=="bas_controller":
        return bas_controller_component_meshes(a)
    if t=="environment_sensor":
        return environment_sensor_component_meshes(a)
    if t=="av_controller":
        return av_controller_component_meshes(a)
    if t=="av_dsp":
        return av_dsp_component_meshes(a)
    if t=="av_camera":
        return av_camera_component_meshes(a)
    if t=="av_microphone":
        return av_microphone_component_meshes(a)
    if t=="network_display_decoder":
        return network_display_decoder_component_meshes(a)
    if t=="speaker":
        return speaker_component_meshes(a)
    if t=="fire_detector":
        return fire_detector_component_meshes(a)
    if t=="fire_notification":
        return fire_notification_component_meshes(a)
    if t=="fire_alarm_control_panel":
        return fire_alarm_control_panel_component_meshes(a)
    if t=="fire_alarm_read_only_gateway":
        return fire_alarm_read_only_gateway_component_meshes(a)
    if t in {"wireless_ap","fire_detector","environment_sensor"}:
        radius=.48 if t=="wireless_ap" else (.20 if t=="fire_detector" else .16)
        height=.14 if t=="wireless_ap" else .18
        m=trimesh.creation.cylinder(radius=radius,height=height,sections=18)
    elif t=="av_camera":
        m=trimesh.creation.cylinder(radius=.24,height=.34,sections=16)
    elif t=="speaker":
        m=trimesh.creation.cylinder(radius=.32,height=.28,sections=16)
    else:
        size=[.8,.8,.5]
        if t in {"rack","rack_ups"}: size=[2.0,2.2,6.2]
        elif t in {"access_switch","collapsed_core_switch","firewall","edge_router","carrier_cpe","virtualization_host","nas_storage","backup_appliance","vms_nvr","patch_panel","fiber_panel","pdu","av_controller","av_dsp"}: size=[1.5,.8,.45]
        elif t=="workstation": size=[.75,1.2,1.7]
        elif t=="monitor": size=[1.8,.20,1.15]
        elif t=="ip_phone": size=[.72,.48,.22]
        elif t=="mfp": size=[1.55,1.45,2.9]
        elif t in {"access_reader","intercom","data_jack","receptacle","wap_spare_jack"}: size=[.32,.18,.55 if t=="intercom" else .32]
        elif t=="electrical_panel": size=[1.35,.36,3.8]
        elif t=="network_display_decoder": size=[.55,.28,.18]
        elif t=="av_microphone": size=[.22,.22,.55]
        elif t in {"fire_notification"}: size=[.42,.18,.48]
        elif t in {"access_controller","bas_controller","fire_alarm_control_panel","fire_alarm_read_only_gateway"}: size=[1.25,.42,2.4]
        m=trimesh.creation.box(extents=size)
    m.apply_translation(p)
    m.visual.face_colors=color
    m.metadata={"asset_id":a["asset_id"],"asset_type":t,"installation_status":"step4b_physical_design_intent"}
    return [("BODY",m)]

for a in new_assets:
    if a["classification"]["registry_role"]=="capability_semantic": continue
    for component_id,mesh in physical_meshes_for_asset(a):
        name=a["asset_id"] if _is_primary_component(a["classification"]["asset_type"],component_id) else f"{a['asset_id']}::PART::{component_id}"
        scene.add_geometry(mesh,node_name=name,geom_name=name)

cable_colors={
 "CAT6A-HORIZONTAL":[40,120,255,180],"CAT6A-WAP-SPARE":[80,150,255,130],"OS2-SM-DUPLEX":[220,80,255,210],
 "10G-DAC":[120,120,120,200],"BACNET-MSTP-STP":[40,220,80,180],"OSDP-RS485-STP":[255,170,40,180],
 "FIRE-ALARM-SLC":[255,40,40,210],"FIRE-ALARM-NAC":[255,80,40,210],"120VAC-BRANCH":[255,210,50,150],
 "SPEAKER-PAIR":[80,220,220,180],"HDMI":[80,80,80,180],"DISPLAYPORT":[80,80,80,180],"IEC-POWER":[255,210,50,120],
 "CAT6A-PATCH":[40,120,255,100],"24VDC-CLASS2":[255,145,40,170],
 "208Y120V-FEEDER":[255,220,60,190],"NEMA5-15-POWER-CORD":[255,210,50,110]
}
def cyl_between(a,b,radius,color):
    # Quantize the design-intent cable primitive so identical authority inputs
    # export byte-identical GLBs across runner CPUs/BLAS implementations.
    a=np.array([round(float(x),6) for x in a],dtype=float)
    b=np.array([round(float(x),6) for x in b],dtype=float)
    v=b-a
    L=round(math.sqrt(sum(float(x)*float(x) for x in v)),9)
    if L<0.05:return None
    z=np.array([0.,0.,1.],dtype=float)
    direction=np.array([round(float(x)/L,12) for x in v],dtype=float)
    axis=np.cross(z,direction)
    axis_norm=round(math.sqrt(sum(float(x)*float(x) for x in axis)),12)
    if axis_norm<1e-8:
        T=np.eye(4)
        if round(float(np.dot(z,direction)),12)<0:
            T[:3,:3]=trimesh.transformations.rotation_matrix(math.pi,[1,0,0])[:3,:3]
    else:
        axis=np.array([round(float(x)/axis_norm,12) for x in axis],dtype=float)
        dot=clamp(round(float(np.dot(z,direction)),12),-1,1)
        angle=round(math.acos(dot),12)
        T=trimesh.transformations.rotation_matrix(angle,axis)
    T=np.round(T,12)
    T[:3,3]=np.round((a+b)/2,6)
    m=trimesh.creation.cylinder(radius=round(float(radius),6),height=L,sections=8,transform=T)
    m.vertices=np.round(m.vertices,6)
    # trimesh exports primitive metadata as GLTF extras; pin it too.
    m.metadata={"shape":"cylinder","height":L,"radius":round(float(radius),6),"sections":8}
    m.visual.face_colors=color
    return m
for c in connections:
    ctype=c["cable_type"]
    if ctype not in cable_colors: continue
    route=c.get("route") or []
    if not route:
        a=positions.get(c["from_asset_id"]); b=positions.get(c["to_asset_id"])
        if a and b: route=[a,b]
    if len(route)<2: continue
    for i in range(len(route)-1):
        radius=.055 if ctype=="208Y120V-FEEDER" else (.045 if "OS2" in ctype else (.025 if ctype in {"CAT6A-PATCH","NEMA5-15-POWER-CORD","DISPLAYPORT","HDMI"} else .035))
        m=cyl_between(route[i],route[i+1],radius,cable_colors[ctype])
        if m is not None: scene.add_geometry(m,node_name=f"{c['connection_id']}::{i}")

OUT.mkdir(parents=True,exist_ok=True)
glb=scene.export(file_type="glb")
GLB.write_bytes(glb if isinstance(glb,(bytes,bytearray)) else bytes(glb))
glb_sha=hashlib.sha256(GLB.read_bytes()).hexdigest()

# update registry
registry["registry_version"]="step4b-physical-installation-fabric-v1"
registry["assets"]=sorted(assets,key=lambda x:x["asset_id"])
registry["relationships"]=sorted(relationships,key=lambda x:x["relationship_id"])
registry.setdefault("metadata",{})["status"]="step4b-physical-installation-fabric"
registry["metadata"]["step4b"]={
    "new_assets":len(new_assets),
    "new_relationships":len(new_relationships),
    "physical_connections":len(connections),
    "routed_connections":sum(1 for x in connections if len(x.get("route") or [])>=2),
    "port_complete_connections":sum(1 for x in connections if x.get("from_port") and x.get("to_port")),
    "wireless_links":len(wireless_links),
    "lab_scenarios":len(labs),
    "overlay_glb":MODEL_REL,
    "physical_routing_authority":"electronics-population-policy-v1.json::physical_routing",
}
write(REG,registry)

manifest={
 "schema_version":"1.1.0","status":"step4b-physical-installation-fabric","not_for_construction":True,
 "design_basis":policy["design_basis"],"physical_routing":policy["physical_routing"],
 "floor_profiles":policy["floor_profiles"],"cable_type_catalog":policy["cable_types"],
 "new_asset_ids":sorted(a["asset_id"] for a in new_assets),"transient_client_profiles":transient_profiles,
 "vlans":policy["vlans"],"ssids":policy["ssids"],"logical_services":policy["logical_services"],
 "device_archetype_authority":"docs/design/equity-uprise-building/production/electronics/device-archetypes-v1.json",
 "device_component_catalog":"docs/design/equity-uprise-building/production/electronics/generated/equity-uprise-device-components-v1.json",
 "step4c_componentized_devices_total":len(device_component_records),
 "overlay_glb":MODEL_REL,"overlay_sha256":glb_sha
}
write(MANIFEST,manifest)
write(CONNECTIONS,{"schema_version":"1.1.0","status":"step4b-physical-installation-connections","connections":connections,"wireless_links":wireless_links})
write(LABS,{"schema_version":"1.0.0","status":"step4a-it-lab-catalog","labs":labs})
write(DEVICE_COMPONENTS,{
 "schema_version":"1.0.0",
 "status":"step4c-device-components",
 "archetype_authority":"docs/design/equity-uprise-building/production/electronics/device-archetypes-v1.json",
 "devices":sorted(device_component_records,key=lambda x:x["asset_id"]),
})

asset_types=Counter(a["classification"]["asset_type"] for a in new_assets)
cable_types=Counter(c["cable_type"] for c in connections)
pathway_families=Counter(c.get("metadata",{}).get("pathway_family_id","unclassified") for c in connections)
level_assets=Counter(a["location"]["level_id"] for a in new_assets if a["location"].get("level_id"))
checks=[]
def ck(name,ok,detail=""):checks.append({"name":name,"passed":bool(ok),"detail":detail})
allids={a["asset_id"] for a in assets}
physical_connections=[x for x in connections if x["cable_type"] not in {"WIFI-6E-RF","CELLULAR-RF"}]
routed=[x for x in physical_connections if len(x.get("route") or [])>=2]
port_complete=[x for x in physical_connections if x.get("from_port") and x.get("to_port")]
jacks=[a for a in new_assets if a["classification"]["asset_type"]=="data_jack"]
outlets=[a for a in new_assets if a["classification"]["asset_type"]=="receptacle"]
panelboards=[a for a in new_assets if a["classification"]["asset_type"]=="electrical_panel"]
modeled_cameras=[a for a in new_assets if a["classification"]["asset_type"]=="camera"]
modeled_access_switches=[a for a in new_assets if a["classification"]["asset_type"]=="access_switch"]
modeled_patch_panels=[a for a in new_assets if a["classification"]["asset_type"]=="patch_panel"]
camera_component_records=[x for x in device_component_records if x.get("archetype")=="camera"]
access_switch_component_records=[x for x in device_component_records if x.get("archetype")=="access_switch"]
patch_panel_component_records=[x for x in device_component_records if x.get("archetype")=="patch_panel"]
modeled_rack_ups=[a for a in new_assets if a["classification"]["asset_type"]=="rack_ups"]
modeled_pdus=[a for a in new_assets if a["classification"]["asset_type"]=="pdu"]
modeled_fiber_panels=[a for a in new_assets if a["classification"]["asset_type"]=="fiber_panel"]
rack_ups_component_records=[x for x in device_component_records if x.get("archetype")=="rack_ups"]
pdu_component_records=[x for x in device_component_records if x.get("archetype")=="pdu"]
fiber_panel_component_records=[x for x in device_component_records if x.get("archetype")=="fiber_panel"]
modeled_data_jacks=[a for a in new_assets if a["classification"]["asset_type"]=="data_jack"]
modeled_receptacles=[a for a in new_assets if a["classification"]["asset_type"]=="receptacle"]
modeled_wap_spare_jacks=[a for a in new_assets if a["classification"]["asset_type"]=="wap_spare_jack"]
data_jack_component_records=[x for x in device_component_records if x.get("archetype")=="data_jack"]
receptacle_component_records=[x for x in device_component_records if x.get("archetype")=="receptacle"]
wap_spare_jack_component_records=[x for x in device_component_records if x.get("archetype")=="wap_spare_jack"]
modeled_wireless_aps=[a for a in new_assets if a["classification"]["asset_type"]=="wireless_ap"]
modeled_workstations=[a for a in new_assets if a["classification"]["asset_type"]=="workstation"]
modeled_monitors=[a for a in new_assets if a["classification"]["asset_type"]=="monitor"]
modeled_ip_phones=[a for a in new_assets if a["classification"]["asset_type"]=="ip_phone"]
modeled_mfps=[a for a in new_assets if a["classification"]["asset_type"]=="mfp"]
wireless_ap_component_records=[x for x in device_component_records if x.get("archetype")=="wireless_ap"]
workstation_component_records=[x for x in device_component_records if x.get("archetype")=="workstation"]
monitor_component_records=[x for x in device_component_records if x.get("archetype")=="monitor"]
ip_phone_component_records=[x for x in device_component_records if x.get("archetype")=="ip_phone"]
mfp_component_records=[x for x in device_component_records if x.get("archetype")=="mfp"]
modeled_access_readers=[a for a in new_assets if a["classification"]["asset_type"]=="access_reader"]
modeled_intercoms=[a for a in new_assets if a["classification"]["asset_type"]=="intercom"]
modeled_access_controllers=[a for a in new_assets if a["classification"]["asset_type"]=="access_controller"]
access_reader_component_records=[x for x in device_component_records if x.get("archetype")=="access_reader"]
intercom_component_records=[x for x in device_component_records if x.get("archetype")=="intercom"]
access_controller_component_records=[x for x in device_component_records if x.get("archetype")=="access_controller"]
modeled_electrical_panels=[a for a in new_assets if a["classification"]["asset_type"]=="electrical_panel"]
modeled_bas_controllers=[a for a in new_assets if a["classification"]["asset_type"]=="bas_controller"]
modeled_environment_sensors=[a for a in new_assets if a["classification"]["asset_type"]=="environment_sensor"]
electrical_panel_component_records=[x for x in device_component_records if x.get("archetype")=="electrical_panel"]
bas_controller_component_records=[x for x in device_component_records if x.get("archetype")=="bas_controller"]
environment_sensor_component_records=[x for x in device_component_records if x.get("archetype")=="environment_sensor"]
modeled_av_controllers=[a for a in new_assets if a["classification"]["asset_type"]=="av_controller"]
modeled_av_dsps=[a for a in new_assets if a["classification"]["asset_type"]=="av_dsp"]
modeled_av_cameras=[a for a in new_assets if a["classification"]["asset_type"]=="av_camera"]
modeled_av_microphones=[a for a in new_assets if a["classification"]["asset_type"]=="av_microphone"]
modeled_display_decoders=[a for a in new_assets if a["classification"]["asset_type"]=="network_display_decoder"]
modeled_speakers=[a for a in new_assets if a["classification"]["asset_type"]=="speaker"]
av_controller_component_records=[x for x in device_component_records if x.get("archetype")=="av_controller"]
av_dsp_component_records=[x for x in device_component_records if x.get("archetype")=="av_dsp"]
av_camera_component_records=[x for x in device_component_records if x.get("archetype")=="av_camera"]
av_microphone_component_records=[x for x in device_component_records if x.get("archetype")=="av_microphone"]
display_decoder_component_records=[x for x in device_component_records if x.get("archetype")=="network_display_decoder"]
speaker_component_records=[x for x in device_component_records if x.get("archetype")=="speaker"]
modeled_fire_detectors=[a for a in new_assets if a["classification"]["asset_type"]=="fire_detector"]
modeled_fire_notifications=[a for a in new_assets if a["classification"]["asset_type"]=="fire_notification"]
modeled_facps=[a for a in new_assets if a["classification"]["asset_type"]=="fire_alarm_control_panel"]
modeled_fire_gateways=[a for a in new_assets if a["classification"]["asset_type"]=="fire_alarm_read_only_gateway"]
fire_detector_component_records=[x for x in device_component_records if x.get("archetype")=="fire_detector"]
fire_notification_component_records=[x for x in device_component_records if x.get("archetype")=="fire_notification"]
facp_component_records=[x for x in device_component_records if x.get("archetype")=="fire_alarm_control_panel"]
fire_gateway_component_records=[x for x in device_component_records if x.get("archetype")=="fire_alarm_read_only_gateway"]

ck("new asset IDs unique",len(new_assets)==len({a["asset_id"] for a in new_assets}),len(new_assets))
ck("all physical connection endpoints exist",all(c["from_asset_id"] in allids and c["to_asset_id"] in allids for c in connections),"")
ck("approved cable types only",set(cable_types).issubset(policy["cable_types"]),sorted(cable_types))
ck("all modeled physical connections have deterministic route geometry",len(routed)==len(physical_connections),f"{len(routed)}/{len(physical_connections)}")
ck("all non-root physical connection endpoints resolve deterministic positions",all(
    connection_endpoint_position(c["from_asset_id"]) is not None or c["from_asset_id"] in {"ELEC-NORMAL","ELEC-EMERGENCY"}
    for c in physical_connections
) and all(
    connection_endpoint_position(c["to_asset_id"]) is not None
    for c in physical_connections
), "")
ck("all modeled physical connections have endpoint port identifiers",len(port_complete)==len(physical_connections),f"{len(port_complete)}/{len(physical_connections)}")
ck("all modeled routes expose pathway and length metadata",all(
    c.get("metadata",{}).get("pathway_class") and c.get("metadata",{}).get("route_length_ft",0)>=0
    for c in physical_connections
), "")
ck("all modeled routes use pathway-first v1 metadata",all(
    c.get("metadata",{}).get("pathway_route_version")==PATHWAY_VERSION
    and c.get("metadata",{}).get("pathway_family_id") in PATHWAYS
    and c.get("metadata",{}).get("support_system")
    for c in physical_connections
), "")
long_run_types={"CAT6A-HORIZONTAL","CAT6A-WAP-SPARE","OS2-SM-DUPLEX","BACNET-MSTP-STP","OSDP-RS485-STP","24VDC-CLASS2","FIRE-ALARM-SLC","FIRE-ALARM-NAC","120VAC-BRANCH","SPEAKER-PAIR"}
ck("long-run cabling has supported bend-aware pathway routes",all(
    len(c.get("route") or [])>=6
    and c.get("metadata",{}).get("visual_bend_radius_ft",0)>0
    and c.get("metadata",{}).get("field_bend_radius_verification_required") is True
    for c in physical_connections if c["cable_type"] in long_run_types
), "")
ck("legacy single tray-turn routing is eliminated",not any(
    any(abs(float(p[0])-float(SUP["tray_turn"][0]))<.01 and abs(float(p[1])-float(SUP["tray_turn"][1]))<.01 for p in (c.get("route") or [])[1:-1])
    for c in physical_connections if c["cable_type"] in long_run_types
), "")
ck("local equipment cords remain non-zero and traceable",all(
    len(c.get("route") or [])>=2 and c.get("metadata",{}).get("route_length_ft",0)>.03
    for c in physical_connections if c.get("metadata",{}).get("pathway_family_id")=="local_equipment"
), "")
ck("all Cat6A permanent links remain within 90 m design limit",all(
    c.get("metadata",{}).get("route_length_ft",0)<=295.276
    for c in connections if c["cable_type"] in {"CAT6A-HORIZONTAL","CAT6A-WAP-SPARE"}
), max([c.get("metadata",{}).get("route_length_ft",0) for c in connections if c["cable_type"] in {"CAT6A-HORIZONTAL","CAT6A-WAP-SPARE"}] or [0]))
ck("all active WAPs terminate through jack plus PoE patch",all(
    any(c["to_asset_id"]==a["asset_id"]+"::DATA-JACK" and c["cable_type"]=="CAT6A-HORIZONTAL" for c in connections)
    and any(c["from_asset_id"]==a["asset_id"]+"::DATA-JACK" and c["to_asset_id"]==a["asset_id"] and c["cable_type"]=="CAT6A-PATCH" and c.get("power_transport")=="PoE" for c in connections)
    for a in new_assets if a["classification"]["asset_type"]=="wireless_ap"
), "")
ck("all WAPs have spare jack assets",sum(1 for a in new_assets if a["classification"]["asset_type"]=="wap_spare_jack")==sum(1 for a in new_assets if a["classification"]["asset_type"]=="wireless_ap"),"")
ck("all access switches have two core uplinks",all(sum(1 for c in connections if c["from_asset_id"]==a["asset_id"] and c["to_asset_id"] in cores)>=2 for a in new_assets if a["classification"]["asset_type"]=="access_switch"),"")
ck("all plug-connected 120V branches terminate at outlets",not any(
    c["cable_type"]=="120VAC-BRANCH" and asset_type(c["to_asset_id"]) not in {"receptacle","electrical_panel"}
    for c in connections
), "")
ck("every generated receptacle serves a physical load with power cord",all(
    any(c["from_asset_id"]==a["asset_id"] and c["cable_type"]=="NEMA5-15-POWER-CORD" for c in connections)
    for a in outlets
), f"{len(outlets)} outlets")
ck("floor panelboards receive riser feeders",all(
    any(c["to_asset_id"]==a["asset_id"] and c["cable_type"]=="208Y120V-FEEDER" for c in connections)
    for a in panelboards
), f"{len(panelboards)} panelboards")
ck("fire-alarm field devices are not direct LAN endpoints",not any(c["cable_type"].startswith("CAT6A") and (by_id[c["to_asset_id"]]["classification"]["asset_type"] in {"fire_detector","fire_notification"}) for c in connections if c["to_asset_id"] in by_id),"")
ck("BAS sensors use field bus and Class 2 power",all(
    any(c["to_asset_id"]==a["asset_id"] and c["cable_type"]=="BACNET-MSTP-STP" for c in connections)
    and any(c["to_asset_id"]==a["asset_id"] and c["cable_type"]=="24VDC-CLASS2" for c in connections)
    for a in new_assets if a["classification"]["asset_type"]=="environment_sensor"
), "")
ck("access readers use OSDP",all(any(c["to_asset_id"]==a["asset_id"] and c["cable_type"]=="OSDP-RS485-STP" for c in connections) for a in new_assets if a["classification"]["asset_type"]=="access_reader"),"")
ck("logical services are non-physical",all(a["physical_representation"]["physical_status"]=="not_applicable" for a in new_assets if a["classification"]["asset_type"] in {"logical_service","vlan","ssid"}),"")
ck("LIVE control remains disabled",not any(a["security"].get("live_control_allowed") for a in assets),"")
ck("all security cameras use Step 4C component assemblies",len(camera_component_records)==len(modeled_cameras),f"{len(camera_component_records)}/{len(modeled_cameras)}")
ck("camera assemblies expose functional components",all(
    {x["component_id"] for x in record["components"]}.issuperset({"MOUNT_PLATE","BRACKET_ARM","HOUSING","LENS_BARREL","LENS_GLASS","IR_LED_RING","STATUS_LED","RJ45_POE_PORT","CABLE_ENTRY"})
    for record in camera_component_records
), "")
ck("camera archetype exposes PoE/Ethernet port and state rules",all(
    any("PoE" in port.get("services",[]) and "Ethernet/IP" in port.get("services",[]) for port in record.get("ports",[]))
    and "unavailable" in record.get("state_rules",{})
    for record in camera_component_records
), "")
ck("all access switches use Step 4C component assemblies",len(access_switch_component_records)==len(modeled_access_switches),f"{len(access_switch_component_records)}/{len(modeled_access_switches)}")
ck("access switch assemblies expose chassis, ports, uplinks, power, cooling, indicators, and labels",all(
    {x["component_id"] for x in record["components"]}.issuperset({"RACK_CHASSIS","RJ45_PORT_BANK","UPLINK_CAGES","POWER_INPUT","FAN_BANK","STATUS_LEDS","PORT_LABELS"})
    and record.get("maturity")=="componentized"
    for record in access_switch_component_records
), "")
ck("access switch archetype exposes 48 access ports and dual uplinks",all(
    {"48x_RJ45_POE","2x_UPLINK"}.issubset({p.get("id") for p in record.get("ports",[])})
    for record in access_switch_component_records
), "")
ck("all patch panels use Step 4C component assemblies",len(patch_panel_component_records)==len(modeled_patch_panels),f"{len(patch_panel_component_records)}/{len(modeled_patch_panels)}")
ck("patch panel assemblies expose front jacks, rear terminations, labels, and cable management",all(
    {x["component_id"] for x in record["components"]}.issuperset({"RACK_FRAME","48x_FRONT_JACKS","REAR_TERMINATIONS","LABEL_STRIP","CABLE_MANAGEMENT"})
    and record.get("maturity")=="componentized"
    for record in patch_panel_component_records
), "")
ck("patch panel archetype exposes front and rear 48-port terminations",all(
    {"48x_RJ45_FRONT","48x_REAR_TERMINATION"}.issubset({p.get("id") for p in record.get("ports",[])})
    for record in patch_panel_component_records
), "")
ck("all rack UPS assets use Step 4C component assemblies",len(rack_ups_component_records)==len(modeled_rack_ups),f"{len(rack_ups_component_records)}/{len(modeled_rack_ups)}")
ck("rack UPS assemblies expose chassis, display, battery, input, outputs, and status",all(
    {x["component_id"] for x in record["components"]}.issuperset({"RACK_CHASSIS","DISPLAY","BATTERY_MODULE","AC_INPUT","OUTPUT_BANK","STATUS_LEDS"})
    and record.get("maturity")=="componentized"
    for record in rack_ups_component_records
), "")
ck("all rack PDUs use Step 4C component assemblies",len(pdu_component_records)==len(modeled_pdus),f"{len(pdu_component_records)}/{len(modeled_pdus)}")
ck("rack PDU assemblies expose strip, inlet, outlet bank, protection, and status",all(
    {x["component_id"] for x in record["components"]}.issuperset({"RACK_STRIP","POWER_INLET","OUTLET_BANK","BREAKER_OR_PROTECTION","STATUS_INDICATOR"})
    and record.get("maturity")=="componentized"
    for record in pdu_component_records
), "")
ck("all fiber panels use Step 4C component assemblies",len(fiber_panel_component_records)==len(modeled_fiber_panels),f"{len(fiber_panel_component_records)}/{len(modeled_fiber_panels)}")
ck("fiber panel assemblies expose frame, LC adapters, splice tray, cable entry, and labels",all(
    {x["component_id"] for x in record["components"]}.issuperset({"RACK_FRAME","LC_ADAPTERS","SPLICE_TRAY","CABLE_ENTRY","LABEL_STRIP"})
    and record.get("maturity")=="componentized"
    for record in fiber_panel_component_records
), "")
ck("all Cat6A data jacks use Step 4C component assemblies",len(data_jack_component_records)==len(modeled_data_jacks),f"{len(data_jack_component_records)}/{len(modeled_data_jacks)}")
ck("data jack assemblies expose faceplate, keystone, label, and rear termination",all(
    {x["component_id"] for x in record["components"]}.issuperset({"FACEPLATE","KEYSTONE_JACK","LABEL","REAR_TERMINATION"})
    and record.get("maturity")=="componentized"
    for record in data_jack_component_records
), "")
ck("all receptacles use Step 4C component assemblies",len(receptacle_component_records)==len(modeled_receptacles),f"{len(receptacle_component_records)}/{len(modeled_receptacles)}")
ck("receptacle assemblies expose faceplate, duplex body, ground contacts, and rear branch termination",all(
    {x["component_id"] for x in record["components"]}.issuperset({"FACEPLATE","DUPLEX_RECEPTACLE","GROUND_CONTACT","REAR_BRANCH_TERMINATION"})
    and record.get("maturity")=="componentized"
    for record in receptacle_component_records
), "")
ck("all reserved WAP jacks use Step 4C component assemblies",len(wap_spare_jack_component_records)==len(modeled_wap_spare_jacks),f"{len(wap_spare_jack_component_records)}/{len(modeled_wap_spare_jacks)}")
ck("reserved WAP jack assemblies expose ceiling jack, keystone, label, and rear termination",all(
    {x["component_id"] for x in record["components"]}.issuperset({"FACEPLATE_OR_CEILING_JACK","KEYSTONE","LABEL","REAR_TERMINATION"})
    and record.get("maturity")=="componentized"
    for record in wap_spare_jack_component_records
), "")
ck("all wireless APs use Step 4C component assemblies",len(wireless_ap_component_records)==len(modeled_wireless_aps),f"{len(wireless_ap_component_records)}/{len(modeled_wireless_aps)}")
ck("wireless AP assemblies expose mount, radome, LED, PoE port, and cable entry",all(
    {x["component_id"] for x in record["components"]}.issuperset({"MOUNT","RADOME_HOUSING","STATUS_LED","RJ45_POE_PORT","CABLE_ENTRY"})
    and record.get("maturity")=="componentized"
    for record in wireless_ap_component_records
), "")
ck("all workstations use Step 4C component assemblies",len(workstation_component_records)==len(modeled_workstations),f"{len(workstation_component_records)}/{len(modeled_workstations)}")
ck("workstation assemblies expose chassis, IO, power, NIC, display outputs, and status",all(
    {x["component_id"] for x in record["components"]}.issuperset({"CHASSIS","FRONT_IO","REAR_IO","POWER_SUPPLY","NIC_PORT","DISPLAY_OUTPUTS","STATUS_INDICATOR"})
    and record.get("maturity")=="componentized"
    for record in workstation_component_records
), "")
ck("all monitors use Step 4C component assemblies",len(monitor_component_records)==len(modeled_monitors),f"{len(monitor_component_records)}/{len(modeled_monitors)}")
ck("monitor assemblies expose panel, bezel, support, power, video, and status",all(
    {x["component_id"] for x in record["components"]}.issuperset({"DISPLAY_PANEL","BEZEL","STAND_OR_MOUNT","POWER_INPUT","VIDEO_INPUT","STATUS_LED"})
    and record.get("maturity")=="componentized"
    for record in monitor_component_records
), "")
ck("all IP phones use Step 4C component assemblies",len(ip_phone_component_records)==len(modeled_ip_phones),f"{len(ip_phone_component_records)}/{len(modeled_ip_phones)}")
ck("IP phone assemblies expose base, handset, keypad, display, status, LAN, and PC ports",all(
    {x["component_id"] for x in record["components"]}.issuperset({"BASE","HANDSET","KEYPAD","DISPLAY","STATUS_LED","RJ45_LAN","RJ45_PC"})
    and record.get("maturity")=="componentized"
    for record in ip_phone_component_records
), "")
ck("all MFPs use Step 4C component assemblies",len(mfp_component_records)==len(modeled_mfps),f"{len(mfp_component_records)}/{len(modeled_mfps)}")
ck("MFP assemblies expose chassis, ADF, scanner, output, control, network, and power",all(
    {x["component_id"] for x in record["components"]}.issuperset({"CHASSIS","ADF","SCANNER_BED","OUTPUT_TRAY","CONTROL_PANEL","RJ45_PORT","POWER_INLET"})
    and record.get("maturity")=="componentized"
    for record in mfp_component_records
), "")
ck("all access readers use Step 4C component assemblies",len(access_reader_component_records)==len(modeled_access_readers),f"{len(access_reader_component_records)}/{len(modeled_access_readers)}")
ck("access reader assemblies expose faceplate, reader zone, status, beeper, OSDP terminal, and mount",all(
    {x["component_id"] for x in record["components"]}.issuperset({"FACEPLATE","READER_ZONE","STATUS_LED","BEEPER","OSDP_TERMINAL","MOUNT"})
    and record.get("maturity")=="componentized"
    for record in access_reader_component_records
), "")
ck("all intercoms use Step 4C component assemblies",len(intercom_component_records)==len(modeled_intercoms),f"{len(intercom_component_records)}/{len(modeled_intercoms)}")
ck("intercom assemblies expose faceplate, call button, mic, speaker, status, and PoE port",all(
    {x["component_id"] for x in record["components"]}.issuperset({"FACEPLATE","CALL_BUTTON","MICROPHONE","SPEAKER","STATUS_LED","RJ45_POE_PORT"})
    and record.get("maturity")=="componentized"
    for record in intercom_component_records
), "")
ck("all access controllers use Step 4C component assemblies",len(access_controller_component_records)==len(modeled_access_controllers),f"{len(access_controller_component_records)}/{len(modeled_access_controllers)}")
ck("access controller assemblies expose enclosure, board, Ethernet, OSDP, power, battery, and status",all(
    {x["component_id"] for x in record["components"]}.issuperset({"ENCLOSURE","CONTROLLER_BOARD","ETHERNET_PORT","OSDP_TERMINALS","POWER_INPUT","BATTERY_ZONE","STATUS_LEDS"})
    and record.get("maturity")=="componentized"
    for record in access_controller_component_records
), "")
ck("all electrical panels use Step 4C component assemblies",len(electrical_panel_component_records)==len(modeled_electrical_panels),f"{len(electrical_panel_component_records)}/{len(modeled_electrical_panels)}")
ck("electrical panel assemblies expose enclosure, deadfront, main, branches, directory, and bars",all(
    {x["component_id"] for x in record["components"]}.issuperset({"ENCLOSURE","DEADFRONT","MAIN_BREAKER","BRANCH_BREAKERS","CIRCUIT_DIRECTORY","NEUTRAL_GROUND_BARS"})
    and record.get("maturity")=="componentized"
    for record in electrical_panel_component_records
), "")
ck("all BAS controllers use Step 4C component assemblies",len(bas_controller_component_records)==len(modeled_bas_controllers),f"{len(bas_controller_component_records)}/{len(modeled_bas_controllers)}")
ck("BAS controller assemblies expose enclosure, board, Ethernet, BACnet, power, and status",all(
    {x["component_id"] for x in record["components"]}.issuperset({"ENCLOSURE","CONTROLLER_BOARD","ETHERNET_PORT","BACNET_TERMINALS","POWER_INPUT","STATUS_LEDS"})
    and record.get("maturity")=="componentized"
    for record in bas_controller_component_records
), "")
ck("all environment sensors use Step 4C component assemblies",len(environment_sensor_component_records)==len(modeled_environment_sensors),f"{len(environment_sensor_component_records)}/{len(modeled_environment_sensors)}")
ck("environment sensor assemblies expose housing, vents, status, BACnet, and Class 2 power",all(
    {x["component_id"] for x in record["components"]}.issuperset({"HOUSING","SENSOR_VENTS","STATUS_INDICATOR","BACNET_TERMINAL","24V_TERMINAL"})
    and record.get("maturity")=="componentized"
    for record in environment_sensor_component_records
), "")
ck("all AV controllers use Step 4C component assemblies",len(av_controller_component_records)==len(modeled_av_controllers),f"{len(av_controller_component_records)}/{len(modeled_av_controllers)}")
ck("all AV DSPs use Step 4C component assemblies",len(av_dsp_component_records)==len(modeled_av_dsps),f"{len(av_dsp_component_records)}/{len(modeled_av_dsps)}")
ck("all AV cameras use Step 4C component assemblies",len(av_camera_component_records)==len(modeled_av_cameras),f"{len(av_camera_component_records)}/{len(modeled_av_cameras)}")
ck("all AV microphones use Step 4C component assemblies",len(av_microphone_component_records)==len(modeled_av_microphones),f"{len(av_microphone_component_records)}/{len(modeled_av_microphones)}")
ck("all display decoders use Step 4C component assemblies",len(display_decoder_component_records)==len(modeled_display_decoders),f"{len(display_decoder_component_records)}/{len(modeled_display_decoders)}")
ck("all speakers use Step 4C component assemblies",len(speaker_component_records)==len(modeled_speakers),f"{len(speaker_component_records)}/{len(modeled_speakers)}")
ck("AV component assemblies expose required physical subcomponents",all([
    all({x["component_id"] for x in r["components"]}.issuperset({"RACK_CHASSIS","FRONT_STATUS","NETWORK_PORT","POWER_INPUT","CONTROL_IO"}) for r in av_controller_component_records),
    all({x["component_id"] for x in r["components"]}.issuperset({"RACK_CHASSIS","FRONT_METERS","NETWORK_PORT","AUDIO_IO","SPEAKER_OUTPUTS","POWER_INPUT"}) for r in av_dsp_component_records),
    all({x["component_id"] for x in r["components"]}.issuperset({"MOUNT","BODY","LENS","STATUS_LED","RJ45_POE_PORT"}) for r in av_camera_component_records),
    all({x["component_id"] for x in r["components"]}.issuperset({"BODY","CAPSULE_OR_ARRAY","STATUS_LED","RJ45_POE_PORT","MOUNT"}) for r in av_microphone_component_records),
    all({x["component_id"] for x in r["components"]}.issuperset({"DECODER_CHASSIS","RJ45_POE_PORT","HDMI_OUTPUT","STATUS_LED"}) for r in display_decoder_component_records),
    all({x["component_id"] for x in r["components"]}.issuperset({"GRILLE_OR_CABINET","DRIVER","MOUNT","SPEAKER_TERMINALS"}) for r in speaker_component_records),
]), "")
ck("all fire detectors use Step 4C component assemblies",len(fire_detector_component_records)==len(modeled_fire_detectors),f"{len(fire_detector_component_records)}/{len(modeled_fire_detectors)}")
ck("fire detector assemblies expose base, chamber, status, and SLC terminals",all(
    {x["component_id"] for x in r["components"]}.issuperset({"BASE","SENSING_CHAMBER","STATUS_LED","SLC_TERMINALS"})
    and r.get("maturity")=="componentized" for r in fire_detector_component_records
), "")
ck("all fire notification appliances use Step 4C component assemblies",len(fire_notification_component_records)==len(modeled_fire_notifications),f"{len(fire_notification_component_records)}/{len(modeled_fire_notifications)}")
ck("fire notification assemblies expose housing, strobe, sounder, and NAC terminals",all(
    {x["component_id"] for x in r["components"]}.issuperset({"HOUSING","STROBE","SOUNDER","NAC_TERMINALS"})
    and r.get("maturity")=="componentized" for r in fire_notification_component_records
), "")
ck("fire alarm control panel uses Step 4C component assembly",len(facp_component_records)==len(modeled_facps),f"{len(facp_component_records)}/{len(modeled_facps)}")
ck("fire alarm control panel exposes enclosure, display, keypad, indicators, SLC, NAC, and power",all(
    {x["component_id"] for x in r["components"]}.issuperset({"ENCLOSURE","DISPLAY","KEYPAD","STATUS_LEDS","SLC_TERMINALS","NAC_TERMINALS","POWER_SECTION"})
    and r.get("maturity")=="componentized" for r in facp_component_records
), "")
ck("fire alarm read-only gateway uses Step 4C component assembly",len(fire_gateway_component_records)==len(modeled_fire_gateways),f"{len(fire_gateway_component_records)}/{len(modeled_fire_gateways)}")
ck("fire gateway exposes enclosure, fire interface, network, power, and indicators",all(
    {x["component_id"] for x in r["components"]}.issuperset({"ENCLOSURE","FIRE_INTERFACE","RJ45_PORT","POWER_INPUT","STATUS_LEDS"})
    and r.get("maturity")=="componentized" for r in fire_gateway_component_records
), "")
ck("all physical Step 4B assets have spatial positions",all(
    a["asset_id"] in positions for a in new_assets if a["classification"]["registry_role"]!="capability_semantic"
), "")
ck("all eight levels represented in electronics population",set(level_assets).issuperset({"B1","F1","F2","F3","F4","F5","F6","L7"}),sorted(level_assets))
ck("lab ladder spans five tiers",set(x["tier"] for x in labs)==set(policy["lab_tiers"]),sorted(set(x["tier"] for x in labs)))
ck("at least forty IT labs generated",len(labs)>=40,len(labs))
ck("overlay GLB generated",GLB.exists() and GLB.stat().st_size>1000,GLB.stat().st_size if GLB.exists() else 0)
passed=all(x["passed"] for x in checks)
report={
 "schema_version":"1.1.0","status":"step4b-physical-installation-fabric","registry_assets_total":len(assets),
 "step4b_new_assets":len(new_assets),"step4b_new_relationships":len(new_relationships),"physical_connections_total":len(connections),
 "routed_connections_total":len(routed),"port_complete_connections_total":len(port_complete),
 "data_jacks_total":len(jacks),"receptacles_total":len(outlets),"electrical_panelboards_total":len(panelboards),
 "step4c_componentized_devices_total":len(device_component_records),"step4c_componentized_camera_total":len(camera_component_records),
 "step4c_componentized_access_switch_total":len(access_switch_component_records),"step4c_componentized_patch_panel_total":len(patch_panel_component_records),
 "step4c_componentized_rack_ups_total":len(rack_ups_component_records),"step4c_componentized_pdu_total":len(pdu_component_records),
 "step4c_componentized_fiber_panel_total":len(fiber_panel_component_records),
 "step4c_componentized_data_jack_total":len(data_jack_component_records),"step4c_componentized_receptacle_total":len(receptacle_component_records),
 "step4c_componentized_wap_spare_jack_total":len(wap_spare_jack_component_records),
 "step4c_componentized_wireless_ap_total":len(wireless_ap_component_records),"step4c_componentized_workstation_total":len(workstation_component_records),
 "step4c_componentized_monitor_total":len(monitor_component_records),"step4c_componentized_ip_phone_total":len(ip_phone_component_records),
 "step4c_componentized_mfp_total":len(mfp_component_records),
 "step4c_componentized_access_reader_total":len(access_reader_component_records),"step4c_componentized_intercom_total":len(intercom_component_records),
 "step4c_componentized_access_controller_total":len(access_controller_component_records),
 "step4c_componentized_electrical_panel_total":len(electrical_panel_component_records),"step4c_componentized_bas_controller_total":len(bas_controller_component_records),
 "step4c_componentized_environment_sensor_total":len(environment_sensor_component_records),
 "step4c_componentized_av_controller_total":len(av_controller_component_records),"step4c_componentized_av_dsp_total":len(av_dsp_component_records),
 "step4c_componentized_av_camera_total":len(av_camera_component_records),"step4c_componentized_av_microphone_total":len(av_microphone_component_records),
 "step4c_componentized_network_display_decoder_total":len(display_decoder_component_records),"step4c_componentized_speaker_total":len(speaker_component_records),
 "step4c_componentized_fire_detector_total":len(fire_detector_component_records),"step4c_componentized_fire_notification_total":len(fire_notification_component_records),
 "step4c_componentized_fire_alarm_control_panel_total":len(facp_component_records),"step4c_componentized_fire_alarm_read_only_gateway_total":len(fire_gateway_component_records),
 "wireless_links_total":len(wireless_links),"lab_scenarios_total":len(labs),"new_asset_type_counts":dict(sorted(asset_types.items())),
 "cable_type_counts":dict(sorted(cable_types.items())),"pathway_family_counts":dict(sorted(pathway_families.items())),"new_assets_by_level":dict(sorted(level_assets.items())),
 "transient_client_profiles":transient_profiles,"overlay_glb_bytes":GLB.stat().st_size,"overlay_glb_sha256":glb_sha,
 "checks_total":len(checks),"checks_passed":sum(1 for x in checks if x["passed"]),"checks_failed":sum(1 for x in checks if not x["passed"]),
 "checks":checks,"passed":passed
}
write(REPORT,report)
print("EQUITY UPRISE ELECTRONICS STEP 4B PHYSICAL INSTALLATION")
print(" new/derived electronics assets:",len(new_assets))
print(" physical connections:",len(connections))
print(" routed connections:",len(routed))
print(" port-complete connections:",len(port_complete))
print(" data jacks:",len(jacks),"receptacles:",len(outlets),"panelboards:",len(panelboards))
print(" Step 4C componentized devices:",len(device_component_records))
print("  cameras:",len(camera_component_records),"access switches:",len(access_switch_component_records),"patch panels:",len(patch_panel_component_records))
print("  rack UPS:",len(rack_ups_component_records),"PDUs:",len(pdu_component_records),"fiber panels:",len(fiber_panel_component_records))
print("  data jacks:",len(data_jack_component_records),"receptacles:",len(receptacle_component_records),"WAP spare jacks:",len(wap_spare_jack_component_records))
print("  APs:",len(wireless_ap_component_records),"workstations:",len(workstation_component_records),"monitors:",len(monitor_component_records),"IP phones:",len(ip_phone_component_records),"MFPs:",len(mfp_component_records))
print("  access readers:",len(access_reader_component_records),"intercoms:",len(intercom_component_records),"access controllers:",len(access_controller_component_records))
print("  electrical panels:",len(electrical_panel_component_records),"BAS controllers:",len(bas_controller_component_records),"environment sensors:",len(environment_sensor_component_records))
print("  AV controllers:",len(av_controller_component_records),"DSPs:",len(av_dsp_component_records),"AV cameras:",len(av_camera_component_records),"mics:",len(av_microphone_component_records),"decoders:",len(display_decoder_component_records),"speakers:",len(speaker_component_records))
print("  fire detectors:",len(fire_detector_component_records),"notification appliances:",len(fire_notification_component_records),"FACP:",len(facp_component_records),"read-only gateways:",len(fire_gateway_component_records))
print(" wireless links:",len(wireless_links))
print(" labs:",len(labs))
print(" cable types:",dict(sorted(cable_types.items())))
print(" pathway families:",dict(sorted(pathway_families.items())))
print(" checks:",report["checks_passed"],"/",report["checks_total"])
if not passed:
    print(" failed checks:")
    for item in checks:
        if not item["passed"]:print("  -",item["name"],"::",item.get("detail",""))
    unrouted=[x for x in physical_connections if len(x.get("route") or [])<2]
    if unrouted:
        print(" unrouted examples:")
        for x in unrouted[:40]:print("  -",x["connection_id"],x["cable_type"],x["from_asset_id"],"->",x["to_asset_id"])
    raise SystemExit("Step 4B electronics physical-installation verification failed")
