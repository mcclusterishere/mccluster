#!/usr/bin/env python3
"""Generate the restricted B1 Core V2 scene package. NOT FOR CONSTRUCTION."""
from pathlib import Path
import json

HERE=Path(__file__).resolve().parent
OUT=HERE/"basement-b1"
OUT.mkdir(exist_ok=True)

core=json.loads((HERE/"building-core-v2.json").read_text())
b1=json.loads((HERE/"basement-b1-program.json").read_text())
tunnel=json.loads((HERE/"underground-tunnel-network.json").read_text())

SCENE="equity-uprise-basement-b1"
ELEV=b1["elevation_ft"]

def center(bounds):
    return {
        "x":(bounds["x1"]+bounds["x2"])/2,
        "y":(bounds["y1"]+bounds["y2"])/2
    }

zones=[]
for i,z in enumerate(b1.get("zones",[]),1):
    zones.append({
        "id":z["id"],
        "label":z["label"],
        "type":z.get("kind","zone"),
        "bounds_ft":z["bounds_ft"],
        "live_access":z.get("live_access",b1["access"]),
        "training_mode":z.get("training_mode"),
        "systems":z.get("systems",[]),
        "hazard_class":z.get("hazard_class")
    })

manifest={
    "schema_version":"1.0.0",
    "scene_id":SCENE,
    "scene_name":f"Equity Uprise B1 — {b1['title']}",
    "status":"core-v2-active-restricted",
    "not_for_construction":True,
    "public_navigation":False,
    "shared_core_ref":"../building-core-v2.json",
    "basement_program_ref":"../basement-b1-program.json",
    "tunnel_network_ref":"../underground-tunnel-network.json",
    "authority":{
        "building_core":["../../BUILDING-CORE-V2-SPEC.md","../building-core-v2.json"],
        "basement":["../../BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md","../basement-b1-program.json"],
        "tunnel":["../../UNDERGROUND-TUNNEL-NETWORK-SPEC.md","../underground-tunnel-network.json"],
        "code_reference":"../../SIMULATION-CODE-REFERENCE-PROFILE.md"
    },
    "finished_floor_elevation_ft":ELEV,
    "building_shell":{"width_ft":72,"depth_ft":72,"floor_to_floor_ft":13.5},
    "inherited_vertical_systems":{
        "passenger_elevator":core["vertical_systems"]["passenger_elevator"],
        "service_freight_elevator":core["vertical_systems"]["service_freight_elevator"],
        "stair_a":core["vertical_systems"]["stair_a"],
        "stair_b":core["vertical_systems"]["stair_b"],
        "mep_riser":core["vertical_systems"]["mep_riser"]
    },
    "zones":zones,
    "live_access":b1["live_access"],
    "training_access":b1["training_access"],
    "camera_ref":"basement-b1-camera.json",
    "materials_ref":"basement-b1-materials.json",
    "lighting_ref":"basement-b1-lighting.json",
    "hotspots_ref":"basement-b1-hotspots.json",
    "routing_ref":"basement-b1-routing.json",
    "states_ref":"basement-b1-states.json"
}

materials={
    "schema_version":"1.0.0","scene_id":SCENE,
    "materials":[
        {"id":"b1_concrete","base_color":"#4C5054","metalness":0.05,"roughness":0.90},
        {"id":"b1_service_metal","base_color":"#333940","metalness":0.78,"roughness":0.48},
        {"id":"b1_safety_marking","base_color":"#A57B2A","metalness":0.05,"roughness":0.58},
        {"id":"b1_screen","base_color":"#172229","metalness":0.08,"roughness":0.30},
        {"id":"b1_restricted_accent","base_color":"#851A1D","metalness":0.10,"roughness":0.55}
    ],
    "rules":["Industrial/technical rather than theatrical bunker styling.","Restricted access is conveyed by systems and state, not fantasy weaponization."]
}

lighting={
    "schema_version":"1.0.0","scene_id":SCENE,
    "fixtures":[
        {"id":"b1_general","type":"industrial_linear","temperature_k":4000,"intensity_relative":0.72},
        {"id":"b1_emergency","type":"emergency_path","temperature_k":5000,"intensity_relative":0.38},
        {"id":"b1_ops","type":"task_area","temperature_k":4200,"intensity_relative":0.62,"zone_id":"b1-tunnel-ops-concourse"}
    ],
    "rules":["Emergency-path lighting remains legible during simulated normal-power loss.","Tunnel operations lighting remains functional, not cinematic."]
}

camera={
    "schema_version":"1.0.0","scene_id":SCENE,
    "cameras":[
        {"id":"b1_overview","type":"perspective","position_ft_world":{"x":36,"y":12,"z":ELEV+15},"look_at_ft_world":{"x":36,"y":40,"z":ELEV+4},"fov_deg":62},
        {"id":"b1_ops_focus","type":"perspective","position_ft_world":{"x":34,"y":48,"z":ELEV+7},"look_at_ft_world":{"x":34,"y":60,"z":ELEV+4},"fov_deg":58}
    ]
}

route_by_zone={
    "b1-systems-lab":"building_systems_training_sandbox",
    "b1-tunnel-ops-concourse":"underground_operations",
    "b1-tunnel-transfer-lock":"tunnel_network"
}
hotspots=[]
for z in zones:
    p=center(z["bounds_ft"])
    route=route_by_zone.get(z["id"])
    h={
        "id":"hs_"+z["id"],"label":z["label"],
        "position_ft_world":{"x":p["x"],"y":p["y"],"z":ELEV+4.2},
        "zone_id":z["id"],
        "action":"open_route" if route else "focus_zone"
    }
    if route: h["route_key"]=route
    hotspots.append(h)
hotspots += [
    {"id":"hs_b1_passenger_elevator","label":"Passenger Elevator — Restricted B1 Stop","position_ft_world":{"x":53.5,"y":39,"z":ELEV+4.5},"action":"open_route","route_key":"authorized_floor1_return"},
    {"id":"hs_b1_stair_a","label":"Stair A — Egress Up","position_ft_world":{"x":63,"y":56,"z":ELEV+4.5},"action":"vertical_transition","vertical_system_id":"stair-a-east","target_level":1},
    {"id":"hs_b1_stair_b","label":"Stair B — Egress Up","position_ft_world":{"x":15.5,"y":56,"z":ELEV+4.5},"action":"vertical_transition","vertical_system_id":"stair-b-west","target_level":1}
]
hotspot_file={
    "schema_version":"1.0.0","scene_id":SCENE,"hotspots":hotspots,
    "rules":[
        "B1 is omitted from ordinary participant navigation.",
        "Live operational hotspots require house-owner or underground-operations-admin authority.",
        "Learner/instructor work uses sandbox routes and never unlocks live B1/tunnel controls.",
        "B1-to-Floor-1 egress remains available according to scenario rules."
    ]
}

routing={
    "schema_version":"1.0.0","scene_id":SCENE,
    "routes":{
        "building_return":{"type":"scene","scene_id":"equity-uprise-building-core-v2","access":"authorized"},
        "authorized_floor1_return":{"type":"scene","scene_id":"equity-uprise-floor-01","access":"mccluster-house-owner-or-underground-operations-admin"},
        "underground_operations":{"type":"ui_state","target":"underground_operations","access":"mccluster-house-owner-or-underground-operations-admin","live_b1_access":True},
        "tunnel_network":{"type":"ui_state","target":"underground_tunnel_network","access":"mccluster-house-owner-or-underground-operations-admin","live_tunnel_access":True},
        "building_systems_training_sandbox":{"type":"ui_state","target":"b1_tunnel_training_clone","access":"authorized-learner-or-instructor","simulation":True,"live_b1_access":False,"live_tunnel_access":False}
    },
    "normal_floor_selector_visible":False,
    "security":{
        "ordinary_equity_uprise_admin_sufficient":False,
        "competency_sufficient":False,
        "live_access_authorities":["mccluster_house_owner","underground_operations_admin"]
    }
}

states={
    "schema_version":"1.0.0","scene_id":SCENE,"default_state":"idle",
    "states":[
        {"id":"idle","label":"Restricted Idle","access":"mccluster-house-owner-or-underground-operations-admin"},
        {"id":"operations_overview","label":"Underground Operations Overview","camera_id":"b1_overview","access":"mccluster-house-owner-or-underground-operations-admin"},
        {"id":"tunnel_operations","label":"Tunnel Operations","camera_id":"b1_ops_focus","route_key":"underground_operations","access":"mccluster-house-owner-or-underground-operations-admin"},
        {"id":"systems_training_sandbox","label":"Building Systems Training Sandbox","route_key":"building_systems_training_sandbox","access":"authorized-learner-or-instructor","live_b1_access":False},
        {"id":"incident_mode","label":"Underground Incident Mode","access":"mccluster-house-owner-or-underground-operations-admin"},
        {"id":"after_hours","label":"After Hours","access":"mccluster-house-owner-or-underground-operations-admin","lighting_multiplier":0.45}
    ]
}

readme=f"""# B1 — {b1['title']} — Core V2 Restricted Production Package

Status: **ACTIVE CORE V2 RESTRICTED DERIVED PACKAGE / NOT FOR CONSTRUCTION**

Live access requires McCluster house-owner or explicitly delegated underground-operations-admin authority.

Ordinary Equity Uprise admin/staff roles and competency status do not unlock live B1.

Learner/instructor building-systems work uses a sandboxed clone and cannot expose live underground occupancy, route/security state, utilities, vehicles, or tunnel controls.

Authority:
- `../building-core-v2.json`
- `../basement-b1-program.json`
- `../underground-tunnel-network.json`
- `../../BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md`
- `../../UNDERGROUND-TUNNEL-NETWORK-SPEC.md`

Canonical plan:
- `../../references/basement-b1/equity-uprise-basement-b1-core-v2-schematic-v1.dxf`
- `../../references/basement-b1/equity-uprise-basement-b1-core-v2-schematic-v1.svg`
- `../../references/basement-b1/equity-uprise-basement-b1-core-v2-schematic-v1.png`
"""

notes=f"""# B1 — Deterministic Geometry / Interaction Notes

FFE: **{ELEV:+g} ft**

B1 is a restricted support/operations level, not an E-Q-U-I-T-Y developmental floor.

Shared vertical systems are inherited from `../building-core-v2.json`.

The north Tunnel Portal / Transfer Lock is the building-side boundary. Tunnel geometry beyond the 72' × 72' shell is future campus/ecosystem authority and must not be invented by this package.

Learner/instructor training uses a sandboxed clone. Live B1 and live tunnel controls remain authorization-gated.

**NOT FOR CONSTRUCTION.**
"""

files={
    "README.md":readme,
    "basement-b1-scene-manifest.json":json.dumps(manifest,indent=2)+"\n",
    "basement-b1-materials.json":json.dumps(materials,indent=2)+"\n",
    "basement-b1-lighting.json":json.dumps(lighting,indent=2)+"\n",
    "basement-b1-camera.json":json.dumps(camera,indent=2)+"\n",
    "basement-b1-hotspots.json":json.dumps(hotspot_file,indent=2)+"\n",
    "basement-b1-routing.json":json.dumps(routing,indent=2)+"\n",
    "basement-b1-states.json":json.dumps(states,indent=2)+"\n",
    "basement-b1-geometry-notes.md":notes
}
for name,data in files.items():
    (OUT/name).write_text(data)

print("Generated restricted B1 Core V2 production package")
