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
 {"id":"accent_red_navigation","base_color":"#851A1D","metalness":0.10,"roughness":0.55,"emissive":"#5A0F11","emissive_strength":0.35},
 {"id":"halo_globe_translucent","base_color":"#18343F","metalness":0.18,"roughness":0.28,"transmission":0.35,"emissive":"#123D4A","emissive_strength":0.22}
]

ROUTES={
 1:{"primary":"institutional_overview","secondary":"verification"},
 2:{"primary":"current_issues","secondary":"conversation"},
 3:{"primary":"opportunities","secondary":"people_network"},
 4:{"primary":"media_catalogue","secondary":"rally_archive"},
 5:{"primary":"policy_workspace","secondary":"evidence_archive"},
 6:{"primary":"institutional_command","secondary":"initiative_portfolio"},
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
    scene_id="equity-uprise-level-07" if n==7 else f"equity-uprise-floor-{n:02d}"

    # Generic building navigation may reach every level because the two
    # protected stairs are continuous through Level 7.
    floor_selector={
      "type":"floor_selector",
      "levels":[
        {"level":i,"scene_id":("equity-uprise-level-07" if i==7 else f"equity-uprise-floor-{i:02d}"),"enabled":True}
        for i in range(1,8)
      ],
      "note":"Building-level selector. Level 7 is reachable through protected stairs; this selector is not an elevator-service claim."
    }

    # Passenger elevator is intentionally restricted to Floors 1–6 until
    # professional design resolves an actual roof stop.
    passenger_elevator_selector={
      "type":"floor_selector",
      "vertical_system_id":"passenger-elevator-a",
      "levels":[
        {"level":i,"scene_id":f"equity-uprise-floor-{i:02d}","enabled":True}
        for i in range(1,7)
      ],
      "note":"Passenger-elevator destinations only. Direct Level 7 service is not assumed."
    }

    routes={
      "floor_selector":floor_selector,
      "passenger_elevator_selector":passenger_elevator_selector,
      "building_return":{"type":"scene","scene_id":"equity-uprise-building-core-v2"},

      # Public / member program routes.
      "institutional_overview":{"type":"url","url":"/equity-uprise.html","access":"public"},
      "institutional_join":{"type":"url","url":"/equity-uprise.html","state_hint":"join","access":"public"},
      "verification":{"type":"url","url":"/verify.html","access":"public","completion":"human-reviewed"},
      "current_issues":{"type":"url","url":"/topics.html","access":"public"},
      "conversation":{"type":"conversation","endpoint_hint":"eu-converse","access":"public-with-thread-ownership"},
      "member_dashboard":{"type":"url","url":"/dashboard.html","access":"authenticated-member"},
      "opportunities":{"type":"url","url":"/fellowships.html","access":"public"},
      "fellowship_record":{"type":"url","url":"/equity-uprise-fellowship.html","access":"public-record-with-consent"},
      "people_network":{"type":"url","url":"/profile.html","access":"public-self-controlled"},
      "meeting_workspace":{"type":"ui_state","target":"meeting_workspace","endpoint_hints":["eu-calendar"],"access":"authenticated-member-or-staff"},
      "enterprise_program":{
        "type":"url","url":"/sites-details.html#equity",
        "access":"public-program-information",
        "fit_review":"required-before-participation",
        "agreement":"required",
        "approval_gated":True,
        "note":"Program information only. Pricing is not architectural authority and participation is never implied by entering this route."
      },

      # Media + culture.
      "media_catalogue":{"type":"url","url":"/album.html?album=equity-uprise","access":"public"},
      "rally_archive":{"type":"url","url":"/walls/eu-rally.html","access":"public"},
      "creator_studio":{"type":"url","url":"/creator.html","access":"authenticated-for-write"},
      "creator_licensing":{"type":"url","url":"/music-creator-terms.html","access":"public-terms-authenticated-checkout"},
      "media_derivatives":{"type":"ui_state","target":"media_derivatives","endpoint_hints":["eu-derivatives"],"access":"authorized-editor-or-admin"},
      "media_release_ops":{"type":"ui_state","target":"media_release_ops","endpoint_hints":["eu-music","eu-ddex-worker"],"access":"authorized-admin","approval_gated":True},

      # Policy + proof.
      "policy_workspace":{"type":"url","url":"/policy.html","access":"public-record-with-private-workspace"},
      "evidence_archive":{"type":"url","url":"/docket-516.html","access":"public"},
      "publication_submission":{"type":"ui_state","target":"publication_submission","endpoint_hints":["eu-publish","eu-government"],"access":"authorized-researcher-editor-admin","approval_gated":True},
      "research_publication":{"type":"ui_state","target":"research_publication","endpoint_hints":["eu-workspace","eu-publish","eu-monitor"],"access":"authorized-researcher-editor-admin"},

      # Institutional command / private Desk.
      "institutional_command":{"type":"url","url":"/equity-uprise.html","state_hint":"institutional","access":"public-summary-with-authenticated-operations"},
      "initiative_portfolio":{"type":"ui_state","target":"initiative_portfolio","access":"authorized-staff"},
      "partner_briefing":{"type":"url","url":"/equity-uprise.html","state_hint":"join","access":"public-contact-private-follow-through"},
      "program_support":{
        "type":"url","url":"/give.html",
        "access":"public-support-pathway",
        "detail_state":"quiet-until-governance",
        "note":"Detailed per-program fund meters, reserve/custody/accounting state and internal finance remain non-public until governance is publishable."
      },
      "admin_desk":{"type":"url","url":"/uprise-admin.html","access":"editor-or-admin"},
      "control_plane":{"type":"ui_state","target":"control_plane","endpoint_hints":["eu-control","eu-status"],"access":"authorized-admin","approval_gated":True},
      "halo_spatial_intelligence":{
        "type":"ui_state",
        "target":"halo_spatial_intelligence",
        "public_projection_endpoint":"https://api.mccluster.org/v1/equity-uprise/halo-globe",
        "owner_surface":"https://api.mccluster.org/internal/seek-first",
        "access":"public-sanitized-read-only-role-scoped-owner-admin",
        "public_read_only":True,
        "owner_auth_required":True,
        "note":"The Equity Uprise globe is a permissioned viewport into the shared Hitman's Halo / Seek First spatial plane. It is not a second spatial backend."
      },

      # Roof / ecosystem.
      "roof_transition":{"type":"scene","scene_id":"equity-uprise-level-07","access":"via-protected-stairs-unless-later-elevator-design"},
      "ecosystem_routes":{"type":"ui_state","target":"ecosystem_routes","access":"public"}
    }
    return {
      "schema_version":"2.1.0",
      "scene_id":scene_id,
      "capability_map_ref":"../equity-uprise-capability-map-v2.json",
      "routes":routes,
      "security":{
        "allowlisted_url_prefixes":["/"],
        "allow_arbitrary_external_redirects":False,
        "private_routes_require_declared_access":True
      }
    }

for level in programs["levels"]:
    n=level["level"]
    floor_dir=HERE/f"floor-{n:02d}"
    floor_dir.mkdir(exist_ok=True)
    scene_id="equity-uprise-level-07" if n==7 else f"equity-uprise-floor-{n:02d}"
    elev=level["elevation_ft"]
    zones=[]
    for i,z in enumerate(level.get("zones",[]),1):
        item={"id":f"zone_{i:02d}","label":z["label"],"type":z["kind"],"bounds_ft":bounds(z["bounds_ft"])}
        if z.get("route_key"): item["route_key"]=z["route_key"]
        zones.append(item)
    zones += common_support(level)
    spheres=[]
    for i,s in enumerate(level.get("spheres",[]),1):
        item={
          "id":f"sphere_{i:02d}",
          "label":s["label"],
          "type":s.get("kind","instrument"),
          "center_ft":{"x":s["center_ft"]["x"],"y":s["center_ft"]["y"]},
          "radius_ft":s["radius_ft"],
          "center_z_local_ft":s["center_z_local_ft"]
        }
        if s.get("route_key"): item["route_key"]=s["route_key"]
        if s.get("access"): item["access"]=s["access"]
        if s.get("note"): item["note"]=s["note"]
        spheres.append(item)

    refs=f"../../references/floor-{n:02d}/{ASSET_NAMES[n]}"
    manifest={
      "schema_version":"2.0.0",
      "scene_id":scene_id,
      "scene_name":f"Equity Uprise Level {n:02d} — {level['title']}",
      "status":"core-v2-migration",
      "not_for_construction":True,
      "shared_core_ref":"../building-core-v2.json",
      "floor_program_ref":"../core-v2-floor-programs.json",
      "capability_map_ref":"../equity-uprise-capability-map-v2.json",
      "feature_ids":level.get("feature_ids",[]),
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
      "spheres":spheres,
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

    fixtures=[
      {"id":"general_fill","type":"ceiling_area_grid","temperature_k":3000,"intensity_relative":0.72,"height_ft_local":10.8},
      {"id":"program_focus","type":"soft_area","temperature_k":3000,"intensity_relative":0.62,"position_ft_local":{"x":36,"y":40,"z":10.5}}
    ]
    if n==6:
        fixtures.append({"id":"halo_globe_soft_emission","type":"object_emission","temperature_k":5200,"intensity_relative":0.18,"position_ft_local":{"x":24.5,"y":34.5,"z":8.25},"rule":"Subtle only; must not turn Penthouse Command into a tactical command center."})
    lighting={"schema_version":"2.0.0","scene_id":scene_id,"color_temperature_default_k":3000,
      "fixtures":fixtures,
      "rules":["Warm-white practical light is primary.","Red remains a restrained state/wayfinding accent.","Halo emission on Floor 6 remains subordinate to architectural lighting."]
    }

    hotspots=[]
    # Floor program zones become routed interactions when the program source
    # declares a route_key; otherwise they remain camera/focus targets.
    for i,z in enumerate(zones[:min(7,len(zones))],1):
        p=center(z["bounds_ft"])
        h={"id":f"hs_zone_{i:02d}","label":z["label"],
           "position_ft_local":{"x":p["x"],"y":p["y"],"z":4.2},
           "position_ft_world":{"x":p["x"],"y":p["y"],"z":elev+4.2},
           "zone_id":z["id"]}
        if z.get("route_key"):
            h.update({"action":"open_route","route_key":z["route_key"]})
        else:
            h.update({"action":"focus_zone"})
        hotspots.append(h)

    for s in spheres:
        p=s["center_ft"]
        hotspots.append({
          "id":f"hs_{s['id']}",
          "label":s["label"],
          "position_ft_local":{"x":p["x"],"y":p["y"],"z":s["center_z_local_ft"]},
          "position_ft_world":{"x":p["x"],"y":p["y"],"z":elev+s["center_z_local_ft"]},
          "sphere_id":s["id"],
          "action":"open_route" if s.get("route_key") else "focus_zone",
          **({"route_key":s["route_key"]} if s.get("route_key") else {})
        })

    # Passenger elevator is public on Floors 1–6 only and uses a selector
    # that deliberately excludes Level 7. The roof has no passenger-elevator
    # hotspot until direct roof service is professionally resolved.
    if n <= 6:
        hotspots.append({
          "id":"hs_passenger_elevator","label":"Passenger Elevator",
          "position_ft_world":{"x":53.5,"y":39,"z":elev+4.5},
          "action":"open_route","route_key":"passenger_elevator_selector"
        })

    hotspots += [
      {"id":"hs_stair_a","label":"Stair A","position_ft_world":{"x":63,"y":56,"z":elev+4.5},"action":"vertical_transition","vertical_system_id":"stair-a-east"},
      {"id":"hs_stair_b","label":"Stair B","position_ft_world":{"x":15.5,"y":56,"z":elev+4.5},"action":"vertical_transition","vertical_system_id":"stair-b-west"}
    ]
    hotspot_file={
      "schema_version":"2.1.0",
      "scene_id":scene_id,
      "capability_map_ref":"../equity-uprise-capability-map-v2.json",
      "hotspots":hotspots,
      "rules":[
        "Hotspots do not redefine geometry.",
        "Service/freight elevator is not exposed as a normal public hotspot.",
        "Level 7 does not expose passenger-elevator service unless later professional design resolves an actual roof stop.",
        "Private routes preserve the source product's access-control boundary."
      ]
    }
    state_list=[
      {"id":"idle","label":"Idle"},
      {"id":"floor_focus","label":level["title"],"camera_id":"floor_overview"},
      {"id":"after_hours","label":"After Hours","lighting_multiplier":0.45}
    ]
    if n==6:
        state_list += [
          {"id":"halo_ambient","label":"Halo Ambient","route_key":"halo_spatial_intelligence","access":"public","read_only":True},
          {"id":"halo_public","label":"Halo Public","route_key":"halo_spatial_intelligence","access":"public-sanitized","read_only":True},
          {"id":"halo_member","label":"Halo Member","route_key":"halo_spatial_intelligence","access":"authenticated-role-scoped","read_only":True},
          {"id":"halo_staff","label":"Halo Staff","route_key":"halo_spatial_intelligence","access":"authorized-staff","read_only":True},
          {"id":"halo_owner","label":"Halo Owner / Admin","route_key":"halo_spatial_intelligence","access":"house-owner","read_only":False,"owner_handoff_required":True},
          {"id":"approvals","label":"Approvals","route_key":"control_plane","access":"authorized-admin"},
          {"id":"jobs","label":"Jobs / Workflow Queue","route_key":"control_plane","access":"authorized-admin"},
          {"id":"integrations","label":"Connections / Integrations","route_key":"control_plane","access":"authorized-admin"},
          {"id":"outreach","label":"Outreach / Consent / Contact State","route_key":"control_plane","access":"authorized-admin"}
        ]
    states={"schema_version":"2.1.0","scene_id":scene_id,"default_state":"idle","states":state_list}

    notes=f"""# Level {n:02d} — Core V2 Deterministic Geometry Notes

Shared source of truth:
- `../building-core-v2.json`
- `../equity-uprise-capability-map-v2.json`
- `../../BUILDING-CORE-V2-SPEC.md`

Finished-floor elevation: **+{elev:g} ft**.

Inherited vertical systems:
- passenger elevator X54–62 / Y34–44
- service/freight elevator X0–8 / Y60–72
- revised Stair B X8–18 / Y54–72
- Stair A X60–72 / Y54–72
- MEP X50–60 / Y66–72

The floor may define program zones but may not move these systems or cover shared slab openings.

Floor 6 additionally reserves one suspended Halo Globe / Spatial Intelligence sphere at (24.5,34.5), radius 2.25 ft, center 8.25 ft AFF. Its footprint is coordination-only and may not obstruct circulation or the fixed core.

Both stairs are modeled as continuous full-rise systems in the combined building generator. A per-floor isolated viewer is never vertical-continuity authority.

**NOT FOR CONSTRUCTION.**
"""

    readme=f"""# Level {n:02d} — {level['title']} — Core V2 Production Package

Status: **CORE V2 MIGRATION / NOT FOR CONSTRUCTION**

This package inherits the shared building/program authority from:
- `../building-core-v2.json`
- `../equity-uprise-capability-map-v2.json`
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
