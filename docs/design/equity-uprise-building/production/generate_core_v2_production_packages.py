#!/usr/bin/env python3
"""
Generate Core V2 deterministic production packages for Equity Uprise levels 1–7.

Inputs:
  building-core-v2.json
  core-v2-floor-programs.json

Outputs under production/floor-XX:
  README.md
  floor-XX-scene-manifest.json
  floor-XX-materials.json
  floor-XX-lighting.json
  floor-XX-camera.json
  floor-XX-hotspots.json
  floor-XX-routing.json
  floor-XX-states.json
  floor-XX-geometry-notes.md

NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import json

HERE=Path(__file__).resolve().parent
BUILDING=HERE.parent
core=json.loads((HERE/"building-core-v2.json").read_text())
programs=json.loads((HERE/"core-v2-floor-programs.json").read_text())

ASSET_NAMES={
 1:"equity-uprise-floor-01-core-v2-schematic-v1",
 2:"equity-uprise-floor-02-public-forum-core-v2-schematic-v1",
 3:"equity-uprise-floor-03-fellowship-network-core-v2-schematic-v1",
 4:"equity-uprise-floor-04-media-culture-core-v2-schematic-v1",
 5:"equity-uprise-floor-05-policy-proof-core-v2-schematic-v1",
 6:"equity-uprise-floor-06-penthouse-command-core-v2-schematic-v1",
 7:"equity-uprise-level-07-roof-mobility-portal-core-v2-schematic-v1",
}
SPEC_NAMES={
 1:"FLOOR-01-LOBBY-INTAKE-360-SPEC.md",
 2:"FLOOR-02-PUBLIC-FORUM-360-SPEC.md",
 3:"FLOOR-03-FELLOWSHIP-NETWORK-360-SPEC.md",
 4:"FLOOR-04-MEDIA-CULTURE-360-SPEC.md",
 5:"FLOOR-05-POLICY-PROOF-360-SPEC.md",
 6:"FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md",
 7:"FLOOR-07-ROOF-MOBILITY-PORTAL-360-SPEC.md",
}
BASIS_NAMES={n:f"FLOOR-{n:02d}-SCHEMATIC-PLAN-BASIS.md" for n in range(1,8)}
BASIS_NAMES[7]="FLOOR-07-SCHEMATIC-PLAN-BASIS.md"

MATERIALS=[
 {"id":"floor_honed_gray","base_color":"#56595B","metalness":0,"roughness":0.68},
 {"id":"wall_charcoal_mineral","base_color":"#2B2A29","metalness":0,"roughness":0.86},
 {"id":"feature_wall_dark","base_color":"#353638","metalness":0,"roughness":0.62},
 {"id":"metal_gunmetal_brushed","base_color":"#303338","metalness":0.88,"roughness":0.42},
 {"id":"glass_arch","base_color":"#DCE5E7","metalness":0,"roughness":0.08,"transmission":0.88,"ior":1.5},
 {"id":"wood_warm_muted","base_color":"#6C523C","metalness":0,"roughness":0.62},
 {"id":"upholstery_charcoal","base_color":"#474544","metalness":0,"roughness":0.90},
 {"id":"service_core","base_color":"#45484B","metalness":0.35,"roughness":0.60},
 {"id":"screen_surface","base_color":"#1E2328","metalness":0.05,"roughness":0.32},
 {"id":"accent_red_navigation","base_color":"#851A1D","metalness":0.10,"roughness":0.55,"emissive":"#5A0F11","emissive_strength":0.35}
]

ROUTES={
 1:{"primary":"institutional_overview","secondary":"institutional_join"},
 2:{"primary":"current_issues","secondary":"conversation"},
 3:{"primary":"opportunities","secondary":"people_network"},
 4:{"primary":"media_archive","secondary":"creator_tools"},
 5:{"primary":"policy_workspace","secondary":"evidence_archive"},
 6:{"primary":"institutional_command","secondary":"roof_transition"},
 7:{"primary":"ecosystem_routes","secondary":"building_return"}
}

def bounds(d):
    return {"x1":d["x1"],"y1":d["y1"],"x2":d["x2"],"y2":d["y2"]}

def center(b):
    return {"x":(b["x1"]+b["x2"])/2,"y":(b["y1"]+b["y2"])/2}

def common_support(level):
    if level.get("roof"): return []
    c=programs["common_support"]
    a,b=level["support_names"]
    return [
      {"id":"north_corridor","label":"Public / Support Corridor","type":"circulation","bounds_ft":bounds(c["corridor"]["bounds_ft"])},
      {"id":"restroom_a","label":"Restroom A","type":"support","bounds_ft":bounds(c["restroom_a"]["bounds_ft"])},
      {"id":"restroom_b","label":"Restroom B","type":"support","bounds_ft":bounds(c["restroom_b"]["bounds_ft"])},
      {"id":"support_a","label":a,"type":"secure_support","bounds_ft":bounds(c["support_a"]["bounds_ft"])},
      {"id":"support_b","label":b,"type":"secure_support","bounds_ft":bounds(c["support_b"]["bounds_ft"])},
      {"id":"janitor","label":"Janitor","type":"service","bounds_ft":bounds(c["janitor"]["bounds_ft"])},
    ]

def route_config(n):
    floor_selector={
      "type":"floor_selector",
      "levels":[
        {"level":i,"scene_id":("equity-uprise-level-07" if i==7 else f"equity-uprise-floor-{i:02d}"),"enabled":True}
        for i in range(1,8)
      ],
      "note":"Core V2 guarantees stair continuity through Level 7. Passenger-elevator service to Level 7 is not assumed."
    }
    routes={
      "floor_selector":floor_selector,
      "building_return":{"type":"scene","scene_id":"equity-uprise-building-core-v2"},
      "institutional_overview":{"type":"url","url":"/equity-uprise.html"},
      "institutional_join":{"type":"url","url":"/equity-uprise.html","state_hint":"join"},
      "current_issues":{"type":"url","url":"/topics.html"},
      "conversation":{"type":"conversation","endpoint_hint":"eu-converse"},
      "opportunities":{"type":"url","url":"/fellowships.html"},
      "people_network":{"type":"url","url":"/profile.html"},
      "media_archive":{"type":"url","url":"/equity-uprise.html","state_hint":"media"},
      "creator_tools":{"type":"ui_state","target":"creator_tools"},
      "policy_workspace":{"type":"url","url":"/policy.html"},
      "evidence_archive":{"type":"url","url":"/docket-516.html"},
      "institutional_command":{"type":"url","url":"/equity-uprise.html","state_hint":"institutional"},
      "roof_transition":{"type":"scene","scene_id":"equity-uprise-level-07"},
      "ecosystem_routes":{"type":"ui_state","target":"ecosystem_routes"}
    }
    return {"schema_version":"2.0.0","scene_id":("equity-uprise-level-07" if n==7 else f"equity-uprise-floor-{n:02d}"),"routes":routes,
            "security":{"allowlisted_url_prefixes":["/"],"allow_arbitrary_external_redirects":False}}

for level in programs["levels"]:
    n=level["level"]
    floor_dir=HERE/f"floor-{n:02d}"
    floor_dir.mkdir(exist_ok=True)
    scene_id="equity-uprise-level-07" if n==7 else f"equity-uprise-floor-{n:02d}"
    elev=level["elevation_ft"]
    zones=[]
    for i,z in enumerate(level.get("zones",[]),1):
        zones.append({"id":f"zone_{i:02d}","label":z["label"],"type":z["kind"],"bounds_ft":bounds(z["bounds_ft"])})
    zones += common_support(level)

    refs=f"../../references/floor-{n:02d}/{ASSET_NAMES[n]}"
    manifest={
      "schema_version":"2.0.0",
      "scene_id":scene_id,
      "scene_name":f"Equity Uprise Level {n:02d} — {level['title']}",
      "status":"core-v2-migration",
      "not_for_construction":True,
      "shared_core_ref":"../building-core-v2.json",
      "floor_program_ref":"../core-v2-floor-programs.json",
      "authority":{
        "building_core":["../../BUILDING-CORE-V2-SPEC.md","../building-core-v2.json"],
        "spatial_authority":[f"../../{SPEC_NAMES[n]}",f"../../{BASIS_NAMES[n]}","../../REFERENCE-AUTHORITY.md"],
        "geometry_authority":[refs+".dxf",refs+".svg",refs+".png"],
        "rule":"Shared Core V2 vertical systems override floor-local geometry."
      },
      "units":{"authoring":"feet","gltf_conversion_meters_per_foot":0.3048},
      "coordinate_system":{"origin":"southwest_exterior_corner_floor_01","x_positive":"east","y_positive":"north","z_positive":"up"},
      "building_shell":{"width_ft":72,"depth_ft":72,"floor_to_floor_ft":13.5,"finished_floor_elevation_ft":elev},
      "inherited_vertical_systems":{
        "passenger_elevator":core["vertical_systems"]["passenger_elevator"],
        "service_freight_elevator":core["vertical_systems"]["service_freight_elevator"],
        "stair_a":core["vertical_systems"]["stair_a"],
        "stair_b":core["vertical_systems"]["stair_b"],
        "mep_riser":core["vertical_systems"]["mep_riser"]
      },
      "shared_slab_openings":core["slab_openings"],
      "zones":zones,
      "south_condition":level["south_condition"],
      "camera_ref":f"floor-{n:02d}-camera.json",
      "materials_ref":f"floor-{n:02d}-materials.json",
      "lighting_ref":f"floor-{n:02d}-lighting.json",
      "hotspots_ref":f"floor-{n:02d}-hotspots.json",
      "routing_ref":f"floor-{n:02d}-routing.json",
      "states_ref":f"floor-{n:02d}-states.json"
    }

    mats={"schema_version":"2.0.0","scene_id":scene_id,"pbr_convention":"metallic-roughness","materials":MATERIALS,
          "rules":["Exact Equity Uprise logo artwork must be used where specified.","Materials may not imply geometry changes."]}

    camera={
      "schema_version":"2.0.0","scene_id":scene_id,
      "cameras":[
        {"id":"canonical_360","type":"equirectangular",
         "position_ft_local":{"x":36,"y":28,"z":5.333},
         "position_ft_world":{"x":36,"y":28,"z":elev+5.333},
         "rotation_deg":{"yaw":0,"pitch":0,"roll":0},"authority":"canonical"},
        {"id":"floor_overview","type":"perspective",
         "position_ft_world":{"x":36,"y":15,"z":elev+18},
         "look_at_ft_world":{"x":36,"y":38,"z":elev+4},"fov_deg":60,"authority":"production_default"}
      ]
    }

    lighting={"schema_version":"2.0.0","scene_id":scene_id,"color_temperature_default_k":3000,
      "fixtures":[
        {"id":"general_fill","type":"ceiling_area_grid","temperature_k":3000,"intensity_relative":0.72,"height_ft_local":10.8},
        {"id":"program_focus","type":"soft_area","temperature_k":3000,"intensity_relative":0.62,"position_ft_local":{"x":36,"y":40,"z":10.5}}
      ],
      "rules":["Warm-white practical light is primary.","Red remains a restrained state/wayfinding accent."]
    }

    hotspots=[]
    for i,z in enumerate(zones[:min(6,len(zones))],1):
        p=center(z["bounds_ft"])
        hotspots.append({"id":f"hs_zone_{i:02d}","label":z["label"],
                         "position_ft_local":{"x":p["x"],"y":p["y"],"z":4.2},
                         "position_ft_world":{"x":p["x"],"y":p["y"],"z":elev+4.2},
                         "action":"focus_zone","zone_id":z["id"]})
    hotspots += [
      {"id":"hs_passenger_elevator","label":"Passenger Elevator","position_ft_world":{"x":53.5,"y":39,"z":elev+4.5},"action":"open_route","route_key":"floor_selector"},
      {"id":"hs_stair_a","label":"Stair A","position_ft_world":{"x":63,"y":56,"z":elev+4.5},"action":"vertical_transition","vertical_system_id":"stair-a-east"},
      {"id":"hs_stair_b","label":"Stair B","position_ft_world":{"x":15.5,"y":56,"z":elev+4.5},"action":"vertical_transition","vertical_system_id":"stair-b-west"}
    ]
    hotspot_file={"schema_version":"2.0.0","scene_id":scene_id,"hotspots":hotspots,
                  "rules":["Hotspots do not redefine geometry.","Service/freight elevator is not exposed as a normal public hotspot."]}

    states={"schema_version":"2.0.0","scene_id":scene_id,"default_state":"idle",
      "states":[
        {"id":"idle","label":"Idle"},
        {"id":"floor_focus","label":level["title"],"camera_id":"floor_overview"},
        {"id":"after_hours","label":"After Hours","lighting_multiplier":0.45}
      ]
    }

    notes=f"""# Level {n:02d} — Core V2 Deterministic Geometry Notes

Shared source of truth:
- `../building-core-v2.json`
- `../../BUILDING-CORE-V2-SPEC.md`

Finished-floor elevation: **+{elev:g} ft**.

Inherited vertical systems:
- passenger elevator X54–62 / Y34–44
- service/freight elevator X0–8 / Y60–72
- revised Stair B X8–18 / Y54–72
- Stair A X60–72 / Y54–72
- MEP X50–60 / Y66–72

The floor may define program zones but may not move these systems or cover shared slab openings.

Both stairs are modeled as continuous full-rise systems in the combined building generator. A per-floor isolated viewer is never vertical-continuity authority.

**NOT FOR CONSTRUCTION.**
"""

    readme=f"""# Level {n:02d} — {level['title']} — Core V2 Production Package

Status: **CORE V2 MIGRATION / NOT FOR CONSTRUCTION**

This package inherits the shared building core from:
- `../building-core-v2.json`
- `../../BUILDING-CORE-V2-SPEC.md`

Canonical branch geometry:
- `{refs}.dxf`
- `{refs}.svg`
- `{refs}.png`

Finished-floor elevation: **+{elev:g} ft**.

This package may operationalize floor program, cameras, hotspots, lighting, routing and states. It may **not** redefine passenger elevator, freight/service elevator, Stair A, Stair B, MEP or slab-opening geometry.

Per-floor scenes are derived views. The combined stacked building is the vertical-continuity authority.
"""

    files={
      "README.md":readme,
      f"floor-{n:02d}-scene-manifest.json":json.dumps(manifest,indent=2)+"\n",
      f"floor-{n:02d}-materials.json":json.dumps(mats,indent=2)+"\n",
      f"floor-{n:02d}-lighting.json":json.dumps(lighting,indent=2)+"\n",
      f"floor-{n:02d}-camera.json":json.dumps(camera,indent=2)+"\n",
      f"floor-{n:02d}-hotspots.json":json.dumps(hotspot_file,indent=2)+"\n",
      f"floor-{n:02d}-routing.json":json.dumps(route_config(n),indent=2)+"\n",
      f"floor-{n:02d}-states.json":json.dumps(states,indent=2)+"\n",
      f"floor-{n:02d}-geometry-notes.md":notes,
    }
    for name,data in files.items():
        (floor_dir/name).write_text(data)

print("Generated Core V2 production packages for levels 1–7")
