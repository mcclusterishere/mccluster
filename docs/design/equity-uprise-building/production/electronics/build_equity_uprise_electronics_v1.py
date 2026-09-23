#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json,math
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np
import trimesh

ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
POLICY=HERE/"electronics-population-policy-v1.json"
OUT=HERE/"generated"
REG=ROOT/"docs/design/equity-uprise-building/production/asset-registry/generated/equity-uprise-asset-registry-v1.json"
STEP3B=ROOT/"docs/design/equity-uprise-building/production/asset-registry/generated/equity-uprise-asset-registry-step3b-report.json"
CORE=ROOT/"docs/design/equity-uprise-building/production/building-core-v2.json"
MANIFEST=OUT/"equity-uprise-electronics-manifest-v1.json"
CONNECTIONS=OUT/"equity-uprise-electronics-connections-v1.json"
LABS=OUT/"equity-uprise-it-lab-catalog-v1.json"
REPORT=OUT/"equity-uprise-electronics-step4a-report.json"
GLB=OUT/"equity-uprise-electronics-fabric-v1.glb"
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
def viewer(n): return f"equity-uprise-building-core-v2-3d.html?floor={n}&services=1"
def clamp(v,a,b): return max(a,min(b,v))

policy=load(POLICY)
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
def default_pos(n,kind,i=0,count=1):
    if kind in {"rack","switch","patch_panel","fiber_panel","ups","pdu","bas_controller","access_controller"}:
        return pos(n,46.0+(i%2)*1.1,66.0+(i//2)*0.8,2.0+0.7*(i%8))
    if kind=="wap":
        arr=[(24,24),(48,48),(24,48),(48,24)]
        x,y=arr[i%len(arr)]; return pos(n,x,y,10.2)
    if kind=="camera":
        arr=[(8,8),(64,8),(8,64),(64,64)]
        x,y=arr[i%4]; return pos(n,x,y,9.5)
    if kind in {"reader","intercom"}:
        arr=[(52,34),(59,55),(18,55),(49,30)]
        x,y=arr[i%len(arr)]; return pos(n,x,y,4.0)
    if kind=="sensor":
        arr=[(18,18),(54,18),(18,54),(54,54)]
        x,y=arr[i%len(arr)]; return pos(n,x,y,7.0)
    if kind in {"workstation","phone","monitor"}:
        cols=max(1,int(math.ceil(math.sqrt(max(count,1)))))
        row=i//cols; col=i%cols
        return pos(n,27+col*5.0,34+row*5.0,3.1 if kind!="monitor" else 4.2)
    if kind=="mfp": return pos(n,20,58,3.0)
    if kind in {"av_camera","av_mic","speaker"}:
        arr=[(24,28),(48,28),(24,48),(48,48),(36,28),(36,48),(28,38),(44,38)]
        x,y=arr[i%len(arr)]; return pos(n,x,y,8.5 if kind!="speaker" else 8.0)
    if kind=="weather": return pos(n,36,42,6.0)
    return pos(n,36+(i%5)*2,40+(i//5)*2,3.5)

def existing_position(a):
    loc=a.get("location",{})
    c=loc.get("center_ft")
    if c:
        z=ffe(loc.get("level_number") or 0)+4.0
        if len(c)>=3: z=ffe(loc.get("level_number") or 0)+float(c[2])
        return [float(c[0]),float(c[1]),z]
    b=loc.get("bounds_ft")
    if b and len(b)>=4:
        return [0.5*(float(b[0])+float(b[2])),0.5*(float(b[1])+float(b[3])),ffe(loc.get("level_number") or 0)+4.0]
    aid=a["asset_id"]
    if aid in trace_xy:
        n=loc.get("level_number") or 0
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
    if a["asset_id"] in by_id: return by_id[a["asset_id"]]
    assets.append(a); new_assets.append(a); by_id[a["asset_id"]]=a
    p=existing_position(a)
    if p: positions[a["asset_id"]]=p
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
            add_asset(make_asset(aid,f"{lev} Addressable Fire Detector {i+1}","fire_detector",n,default_pos(n,"sensor",i),["FIRE-ALARM"],False,"floor_wide",security="restricted"))
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
for a in new_assets:
    if a["classification"]["registry_role"]=="capability_semantic": continue
    p=positions.get(a["asset_id"])
    if not p: continue
    t=a["classification"]["asset_type"]
    size=[0.8,0.8,0.5]
    if t in {"rack","access_switch","collapsed_core_switch","firewall","virtualization_host","nas_storage","backup_appliance","vms_nvr","patch_panel","fiber_panel","pdu","rack_ups"}: size=[1.5,0.8,0.5]
    if t=="wireless_ap": size=[1.0,1.0,0.15]
    mesh=trimesh.creation.box(extents=size)
    mesh.apply_translation(p)
    mesh.visual.face_colors=color_for_type(t)
    scene.add_geometry(mesh,node_name=a["asset_id"],geom_name=a["asset_id"])

cable_colors={
 "CAT6A-HORIZONTAL":[40,120,255,180],"CAT6A-WAP-SPARE":[80,150,255,130],"OS2-SM-DUPLEX":[220,80,255,210],
 "10G-DAC":[120,120,120,200],"BACNET-MSTP-STP":[40,220,80,180],"OSDP-RS485-STP":[255,170,40,180],
 "FIRE-ALARM-SLC":[255,40,40,210],"FIRE-ALARM-NAC":[255,80,40,210],"120VAC-BRANCH":[255,210,50,150],
 "SPEAKER-PAIR":[80,220,220,180],"HDMI":[80,80,80,180],"DISPLAYPORT":[80,80,80,180],"IEC-POWER":[255,210,50,120],
 "CAT6A-PATCH":[40,120,255,100]
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
        m=cyl_between(route[i],route[i+1],0.035 if "OS2" not in ctype else 0.045,cable_colors[ctype])
        if m is not None: scene.add_geometry(m,node_name=f"{c['connection_id']}::{i}")

OUT.mkdir(parents=True,exist_ok=True)
glb=scene.export(file_type="glb")
GLB.write_bytes(glb if isinstance(glb,(bytes,bytearray)) else bytes(glb))
glb_sha=hashlib.sha256(GLB.read_bytes()).hexdigest()

# update registry
registry["registry_version"]="step4a-whole-building-electronics-fabric-v1"
registry["assets"]=sorted(assets,key=lambda x:x["asset_id"])
registry["relationships"]=sorted(relationships,key=lambda x:x["relationship_id"])
registry.setdefault("metadata",{})["status"]="step4a-whole-building-electronics-fabric"
registry["metadata"]["step4a"]={"new_assets":len(new_assets),"new_relationships":len(new_relationships),"physical_connections":len(connections),
                                "wireless_links":len(wireless_links),"lab_scenarios":len(labs),"overlay_glb":MODEL_REL}
write(REG,registry)

manifest={
 "schema_version":"1.0.0","status":"step4a-whole-building-electronics-fabric","not_for_construction":True,
 "design_basis":policy["design_basis"],"floor_profiles":policy["floor_profiles"],"cable_type_catalog":policy["cable_types"],
 "new_asset_ids":sorted(a["asset_id"] for a in new_assets),"transient_client_profiles":transient_profiles,
 "vlans":policy["vlans"],"ssids":policy["ssids"],"logical_services":policy["logical_services"],
 "overlay_glb":MODEL_REL,"overlay_sha256":glb_sha
}
write(MANIFEST,manifest)
write(CONNECTIONS,{"schema_version":"1.0.0","status":"step4a-electronics-connections","connections":connections,"wireless_links":wireless_links})
write(LABS,{"schema_version":"1.0.0","status":"step4a-it-lab-catalog","labs":labs})

asset_types=Counter(a["classification"]["asset_type"] for a in new_assets)
cable_types=Counter(c["cable_type"] for c in connections)
level_assets=Counter(a["location"]["level_id"] for a in new_assets if a["location"].get("level_id"))
checks=[]
def ck(name,ok,detail=""):checks.append({"name":name,"passed":bool(ok),"detail":detail})
allids={a["asset_id"] for a in assets}
ck("new asset IDs unique",len(new_assets)==len({a["asset_id"] for a in new_assets}),len(new_assets))
ck("all physical connection endpoints exist",all(c["from_asset_id"] in allids and c["to_asset_id"] in allids for c in connections),"")
ck("approved cable types only",set(cable_types).issubset(policy["cable_types"]),sorted(cable_types))
ck("all active WAPs have one horizontal data link",all(sum(1 for c in connections if c["to_asset_id"]==a["asset_id"] and c["cable_type"]=="CAT6A-HORIZONTAL")==1 for a in new_assets if a["classification"]["asset_type"]=="wireless_ap"),"")
ck("all WAPs have spare jack assets",sum(1 for a in new_assets if a["classification"]["asset_type"]=="wap_spare_jack")==sum(1 for a in new_assets if a["classification"]["asset_type"]=="wireless_ap"),"")
ck("all access switches have two core uplinks",all(sum(1 for c in connections if c["from_asset_id"]==a["asset_id"] and c["to_asset_id"] in cores)>=2 for a in new_assets if a["classification"]["asset_type"]=="access_switch"),"")
ck("fire-alarm field devices are not direct LAN endpoints",not any(c["cable_type"].startswith("CAT6A") and (by_id[c["to_asset_id"]]["classification"]["asset_type"] in {"fire_detector","fire_notification"}) for c in connections if c["to_asset_id"] in by_id),"")
ck("BAS sensors use field bus",all(any(c["from_asset_id"].startswith(a["location"]["level_id"]+"-BAS-CTRL") and c["to_asset_id"]==a["asset_id"] and c["cable_type"]=="BACNET-MSTP-STP" for c in connections) for a in new_assets if a["classification"]["asset_type"]=="environment_sensor"),"")
ck("access readers use OSDP",all(any(c["to_asset_id"]==a["asset_id"] and c["cable_type"]=="OSDP-RS485-STP" for c in connections) for a in new_assets if a["classification"]["asset_type"]=="access_reader"),"")
ck("logical services are non-physical",all(a["physical_representation"]["physical_status"]=="not_applicable" for a in new_assets if a["classification"]["asset_type"] in {"logical_service","vlan","ssid"}),"")
ck("LIVE control remains disabled",not any(a["security"].get("live_control_allowed") for a in assets),"")
ck("all eight levels represented in electronics population",set(level_assets).issuperset({"B1","F1","F2","F3","F4","F5","F6","L7"}),sorted(level_assets))
ck("lab ladder spans five tiers",set(x["tier"] for x in labs)==set(policy["lab_tiers"]),sorted(set(x["tier"] for x in labs)))
ck("at least forty IT labs generated",len(labs)>=40,len(labs))
ck("overlay GLB generated",GLB.exists() and GLB.stat().st_size>1000,GLB.stat().st_size if GLB.exists() else 0)
passed=all(x["passed"] for x in checks)
report={
 "schema_version":"1.0.0","status":"step4a-whole-building-electronics-fabric","registry_assets_total":len(assets),
 "step4a_new_assets":len(new_assets),"step4a_new_relationships":len(new_relationships),"physical_connections_total":len(connections),
 "wireless_links_total":len(wireless_links),"lab_scenarios_total":len(labs),"new_asset_type_counts":dict(sorted(asset_types.items())),
 "cable_type_counts":dict(sorted(cable_types.items())),"new_assets_by_level":dict(sorted(level_assets.items())),
 "transient_client_profiles":transient_profiles,"overlay_glb_bytes":GLB.stat().st_size,"overlay_glb_sha256":glb_sha,
 "checks_total":len(checks),"checks_passed":sum(1 for x in checks if x["passed"]),"checks_failed":sum(1 for x in checks if not x["passed"]),
 "checks":checks,"passed":passed
}
write(REPORT,report)
print("EQUITY UPRISE ELECTRONICS STEP 4A")
print(" new assets:",len(new_assets))
print(" physical connections:",len(connections))
print(" wireless links:",len(wireless_links))
print(" labs:",len(labs))
print(" cable types:",dict(sorted(cable_types.items())))
print(" checks:",report["checks_passed"],"/",report["checks_total"])
if not passed: raise SystemExit("Step 4A electronics verification failed")
