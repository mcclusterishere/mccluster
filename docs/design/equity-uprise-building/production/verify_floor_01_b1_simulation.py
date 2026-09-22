#!/usr/bin/env python3
"""Validate Floor 1 + B1 digital-twin simulation authority. NOT FOR CONSTRUCTION."""
from pathlib import Path
import json, sys

HERE=Path(__file__).resolve().parent
CORE=json.loads((HERE/"building-core-v2.json").read_text())
B1=json.loads((HERE/"basement-b1-program.json").read_text())
SITE=json.loads((HERE/"floor-01"/"floor-01-site-egress.json").read_text())
F1=json.loads((HERE/"floor-01"/"floor-01-digital-twin-program.json").read_text())
TUNNEL=json.loads((HERE/"underground-tunnel-network.json").read_text())
PROGRAMS=json.loads((HERE/"core-v2-floor-programs.json").read_text())
CAPABILITY_MAP=json.loads((HERE/"equity-uprise-capability-map-v2.json").read_text())
SOURCE_MAP=json.loads((HERE/"equity-uprise-repo-source-map-v2.json").read_text())
DEV_DIR=HERE.parent.parent/"equity-uprise-development"
STAGE_MAP=json.loads((DEV_DIR/"stage-competency-map.json").read_text())
COMPETENCY_CATALOG=json.loads((DEV_DIR/"competency-catalog.json").read_text())
F1_MANIFEST=json.loads((HERE/"floor-01"/"floor-01-scene-manifest.json").read_text())
F1_ROUTING=json.loads((HERE/"floor-01"/"floor-01-routing.json").read_text())
F1_STATES=json.loads((HERE/"floor-01"/"floor-01-states.json").read_text())
SIM_OBJECTS=json.loads((HERE/"floor-01"/"floor-01-simulation-objects.json").read_text())
B1_DIR=HERE/"basement-b1"

checks=[]
def check(name, passed, detail=""):
    checks.append({"name":name,"passed":bool(passed),"detail":detail})

levels={x["level"]:x for x in CORE["levels"]}
check("B1 exists in core",0 in levels,str(sorted(levels)))
check("B1 elevation -13.5",levels.get(0,{}).get("finished_floor_elevation_ft")==-13.5,str(levels.get(0)))
check("Floor 1 is level of exit discharge",CORE.get("level_of_exit_discharge")==1,str(CORE.get("level_of_exit_discharge")))
check("B1 is not developmental",B1.get("developmental_stage") is None,str(B1.get("developmental_stage")))
check("B1 normal public access false",B1.get("normal_public_access") is False,str(B1.get("normal_public_access")))
check("B1 title matches shared core",levels.get(0,{}).get("name")==B1.get("title"),f"{levels.get(0,{}).get('name')} != {B1.get('title')}")
check("canonical maps are branch-agnostic","branch" not in CAPABILITY_MAP and "branch" not in SOURCE_MAP,str({"capability_branch":CAPABILITY_MAP.get("branch"),"source_branch":SOURCE_MAP.get("branch")}))
check("B1 live access is restricted",B1.get("access")=="mccluster-house-owner-or-underground-operations-admin",str(B1.get("access")))
check("B1 training is sandbox only",B1.get("training_access",{}).get("mode")=="sandboxed_clone_only",str(B1.get("training_access")))
check("ordinary EU admin cannot unlock live B1",B1.get("live_access",{}).get("ordinary_equity_uprise_admin_sufficient") is False,str(B1.get("live_access")))
check("tunnel is not publicly visible",TUNNEL.get("public_visibility") is False,str(TUNNEL.get("public_visibility")))
check("tunnel training clone has no live access",TUNNEL.get("training_access",{}).get("live_tunnel_access") is False,str(TUNNEL.get("training_access")))
check("tunnel has future reserved branches only",all(x.get("destination") is None for x in TUNNEL.get("backbone",{}).get("future_connections",[])),str(TUNNEL.get("backbone",{}).get("future_connections")))

for key in ("passenger_elevator","service_freight_elevator","stair_a","stair_b","mep_riser"):
    serves=CORE["vertical_systems"][key]["serves_levels"]
    check(f"{key} serves B1",0 in serves,str(serves))

# B1 program zones must stay inside shell and clear of fixed core reservations.
shell=(0,0,72,72)
fixed={
 "passenger":CORE["vertical_systems"]["passenger_elevator"]["shaft_bounds_ft"],
 "freight":CORE["vertical_systems"]["service_freight_elevator"]["shaft_bounds_ft"],
 "stair_a":CORE["vertical_systems"]["stair_a"]["enclosure_bounds_ft"],
 "stair_b":CORE["vertical_systems"]["stair_b"]["enclosure_bounds_ft"],
 "mep":CORE["vertical_systems"]["mep_riser"]["bounds_ft"],
}
def rect(d): return (d["x1"],d["y1"],d["x2"],d["y2"])
def overlaps(a,b):
    return not (a[2] <= b[0] or a[0] >= b[2] or a[3] <= b[1] or a[1] >= b[3])
for z in B1.get("zones",[]):
    b=rect(z["bounds_ft"])
    inside=(b[0]>=0 and b[1]>=0 and b[2]<=72 and b[3]<=72)
    check(f"B1 zone inside shell: {z['id']}",inside,str(b))
    hits=[name for name,d in fixed.items() if overlaps(b,rect(d))]
    check(f"B1 zone clear of fixed core: {z['id']}",not hits,str(hits))

# Floor 1 site / egress essentials.
doors={x.get("object_id"):x for x in SITE.get("exterior_openings",[])}
for oid in ("F1-DOOR-STAIR-A-DISCHARGE","F1-DOOR-STAIR-B-DISCHARGE","F1-DOOR-SERVICE-WEST"):
    check(f"site opening exists: {oid}",oid in doors,str(sorted(doors)))
controls={x.get("object_id") for x in SITE.get("floor1_discharge_controls",[])}
check("Stair A down barrier exists","F1-BARRIER-STAIR-A-DOWN" in controls,str(sorted(controls)))
check("Stair B down barrier exists","F1-BARRIER-STAIR-B-DOWN" in controls,str(sorted(controls)))
site_kinds=[x.get("kind") for x in SITE.get("site_elements",[])]
check("public way modeled","public_way" in site_kinds,str(site_kinds))
check("public accessible approach modeled","walk" in site_kinds,str(site_kinds))
check("service apron modeled","service" in site_kinds,str(site_kinds))
check("two assembly areas modeled",site_kinds.count("assembly")==2,str(site_kinds.count("assembly")))

equip={x.get("label") for x in SITE.get("emergency_equipment",[])}
for required in ("AED","First Aid Kit","Fire Extinguisher Cabinet — Lobby","You Are Here / Egress Map","Emergency Two-Way Communication Concept"):
    check(f"emergency equipment: {required}",required in equip,str(sorted(equip)))

eap=SITE.get("emergency_action_plan_model",{})
for key in ("report_emergency","evacuation","critical_operations","accountability","rescue_medical","contacts"):
    check(f"EAP component: {key}",bool(eap.get(key)),str(eap.get(key)))

# Floor 1 development-program binding.
f1_program=next(x for x in PROGRAMS["levels"] if x["level"]==1)
f1_capability=next(x for x in CAPABILITY_MAP["floors"] if x["level"]==1)
stage1=next(x for x in STAGE_MAP["stages"] if x["stage"]==1)
catalog_ids={x["id"] for x in COMPETENCY_CATALOG["competencies"]}
EXPECTED_F1_TITLE="Arrival / Orientation / Intake"
check("Floor 1 working stage is enter",f1_program.get("working_development_stage")=="enter",str(f1_program.get("working_development_stage")))
check("Floor 1 shared core title current",levels.get(1,{}).get("name")==EXPECTED_F1_TITLE,str(levels.get(1,{}).get("name")))
check("Floor 1 program title current",f1_program.get("title")==EXPECTED_F1_TITLE,str(f1_program.get("title")))
check("Floor 1 program identity current",f1_program.get("program_identity")==EXPECTED_F1_TITLE,str(f1_program.get("program_identity")))
check("Floor 1 capability-map title current",f1_capability.get("title")==EXPECTED_F1_TITLE,str(f1_capability.get("title")))
expected_surfaces={"Entry Vestibule","Arrival Atrium","Orientation Lounge","Intake / Verification Consultation","Development Passport Studio","Journey Wall","Reception / Concierge / Security Desk","Next Action / Building Directory"}
check("Floor 1 capability-map public surfaces current",expected_surfaces.issubset(set(f1_capability.get("public_surfaces",[]))),str(f1_capability.get("public_surfaces")))
old_f1_terms=("Lobby + Intake","Arrival / Identity Wall","Arrival / Routing Directory","Visitor Lounge")
capability_text=json.dumps(f1_capability)
check("Floor 1 capability-map has no stale identity terms",not any(x in capability_text for x in old_f1_terms),capability_text)
check("Floor 1 primary competencies match canonical stage 1",f1_program.get("primary_competency_ids")==stage1.get("primary_competencies"),str(f1_program.get("primary_competency_ids")))
check("Floor 1 all primary competencies exist",all(x in catalog_ids for x in f1_program.get("primary_competency_ids",[])),str(f1_program.get("primary_competency_ids")))
check("Floor 1 all secondary competencies exist",all(x in catalog_ids for x in f1_program.get("secondary_competency_ids",[])),str(f1_program.get("secondary_competency_ids")))
check("Floor 1 maturity reconciled",f1_program.get("design_maturity")=="reconciled-current-iterative-pass",str(f1_program.get("design_maturity")))
f2_program=next(x for x in PROGRAMS["levels"] if x["level"]==2)
check("Floor 2 maturity reconciled",f2_program.get("design_maturity")=="reconciled-current-iterative-pass",str(f2_program.get("design_maturity")))
f3_program=next(x for x in PROGRAMS["levels"] if x["level"]==3)
check("Floor 3 maturity reconciled",f3_program.get("design_maturity")=="reconciled-current-iterative-pass",str(f3_program.get("design_maturity")))
f4_program=next(x for x in PROGRAMS["levels"] if x["level"]==4)
check("Floor 4 maturity reconciled",f4_program.get("design_maturity")=="reconciled-current-iterative-pass",str(f4_program.get("design_maturity")))
f5_program=next(x for x in PROGRAMS["levels"] if x["level"]==5)
check("Floor 5 maturity reconciled",f5_program.get("design_maturity")=="reconciled-current-iterative-pass",str(f5_program.get("design_maturity")))
f6_program=next(x for x in PROGRAMS["levels"] if x["level"]==6)
check("Floor 6 maturity reconciled",f6_program.get("design_maturity")=="reconciled-current-iterative-pass",str(f6_program.get("design_maturity")))
check("Level 7 remains explicitly provisional",all(x.get("design_maturity")=="pre-iterative-program-rewrite" for x in PROGRAMS["levels"] if x["level"]>=7),str([(x["level"],x.get("design_maturity")) for x in PROGRAMS["levels"] if x["level"]>=7]))

# Floor 1 authority must point at the resolved site/B1 layers.
check("Floor 1 site ref",F1.get("site_egress_ref")=="floor-01-site-egress.json",str(F1.get("site_egress_ref")))
check("Floor 1 basement ref",F1.get("basement_ref")=="../basement-b1-program.json",str(F1.get("basement_ref")))
check("no unresolved geometry requirements","unresolved_geometry_requirements" not in F1,str(F1.get("unresolved_geometry_requirements")))
check("Floor 1 hides B1 from normal navigation",F1.get("underground_access_model",{}).get("public_directory_shows_b1") is False,str(F1.get("underground_access_model")))
check("Floor 1 ordinary EU admin cannot see B1",F1.get("underground_access_model",{}).get("ordinary_equity_uprise_admin_can_see_b1") is False,str(F1.get("underground_access_model")))
check("Floor 1 training goes to sandbox clone",F1.get("underground_access_model",{}).get("training",{}).get("destination")=="sandboxed B1/tunnel clone",str(F1.get("underground_access_model",{}).get("training")))
# Derived Floor 1 package must match current authority, not stale migration metadata.
check("Floor 1 manifest active",F1_MANIFEST.get("status")=="core-v2-active",str(F1_MANIFEST.get("status")))
check("Floor 1 manifest current name",F1_MANIFEST.get("scene_name")=="Equity Uprise Level 01 — Arrival / Orientation / Intake",str(F1_MANIFEST.get("scene_name")))
check("Floor 1 manifest digital-twin ref",F1_MANIFEST.get("digital_twin_program_ref")=="floor-01-digital-twin-program.json",str(F1_MANIFEST.get("digital_twin_program_ref")))
activity_refs=F1_MANIFEST.get("authority",{}).get("activity_simulation_authority",[])
check("Floor 1 manifest activity refs resolve",activity_refs==["../../FLOOR-01-DIGITAL-TWIN-PROGRAM.md","floor-01-digital-twin-program.json"],str(activity_refs))
lab=F1_ROUTING.get("routes",{}).get("building_systems_lab",{})
underground=F1_ROUTING.get("routes",{}).get("underground_operations",{})
check("Floor 1 building systems route sandbox only",lab.get("live_b1_access") is False,str(lab))
check("Floor 1 underground route hidden live access",underground.get("hidden_from_normal_navigation") is True and underground.get("live_b1_access") is True,str(underground))
state_ids={x.get("id") for x in F1_STATES.get("states",[])}
check("Floor 1 states include underground access","underground_operations_access" in state_ids,str(sorted(state_ids)))
floor_focus=next((x for x in F1_STATES.get("states",[]) if x.get("id")=="floor_focus"),{})
check("Floor 1 state label current",floor_focus.get("label")==EXPECTED_F1_TITLE,str(floor_focus))
sim_ids={x.get("object_id") for x in SIM_OBJECTS.get("objects",[])}
required_sim_ids={x["object_id"] for x in SITE.get("exterior_openings",[])} | {x["object_id"] for x in SITE.get("floor1_discharge_controls",[])} | {x["object_id"] for x in SITE.get("emergency_equipment",[])} | {x["id"] for x in SITE.get("site_elements",[])}
check("Floor 1 simulation-object set covers site authority",required_sim_ids.issubset(sim_ids),str(sorted(required_sim_ids-sim_ids)))
check("canonical Floor 1 long-form authority exists",(HERE.parent/"FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md").exists(),str(HERE.parent/"FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md"))
check("canonical B1 long-form authority exists",(HERE.parent/"BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md").exists(),str(HERE.parent/"BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md"))
old_f1=(HERE.parent/"FLOOR-01-LOBBY-INTAKE-360-SPEC.md");old_b1=(HERE.parent/"BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md")
check("old Floor 1 authority is compatibility stub",old_f1.exists() and "DEPRECATED COMPATIBILITY PATH" in old_f1.read_text(),str(old_f1))
check("old B1 authority is compatibility stub",old_b1.exists() and "DEPRECATED COMPATIBILITY PATH" in old_b1.read_text(),str(old_b1))

# Restricted B1 derived package is required for future render/admin operation.
b1_required=[
 "README.md","basement-b1-scene-manifest.json","basement-b1-materials.json",
 "basement-b1-lighting.json","basement-b1-camera.json","basement-b1-hotspots.json",
 "basement-b1-routing.json","basement-b1-states.json","basement-b1-geometry-notes.md"
]
for name in b1_required:
    check(f"B1 package file exists: {name}",(B1_DIR/name).exists(),str(B1_DIR/name))
if (B1_DIR/"basement-b1-scene-manifest.json").exists():
    b1m=json.loads((B1_DIR/"basement-b1-scene-manifest.json").read_text())
    check("B1 scene manifest active restricted",b1m.get("status")=="core-v2-active-restricted",str(b1m.get("status")))
    check("B1 scene title current",b1m.get("scene_name")==f"Equity Uprise B1 — {B1['title']}",str(b1m.get("scene_name")))
    check("B1 scene hidden from public navigation",b1m.get("public_navigation") is False,str(b1m.get("public_navigation")))
    check("B1 scene tunnel authority ref",b1m.get("tunnel_network_ref")=="../underground-tunnel-network.json",str(b1m.get("tunnel_network_ref")))
if (B1_DIR/"basement-b1-routing.json").exists():
    b1r=json.loads((B1_DIR/"basement-b1-routing.json").read_text())
    routes=b1r.get("routes",{})
    check("B1 sandbox cannot reach live B1",routes.get("building_systems_training_sandbox",{}).get("live_b1_access") is False,str(routes.get("building_systems_training_sandbox")))
    check("B1 sandbox cannot reach live tunnel",routes.get("building_systems_training_sandbox",{}).get("live_tunnel_access") is False,str(routes.get("building_systems_training_sandbox")))
    check("B1 ordinary EU admin insufficient",b1r.get("security",{}).get("ordinary_equity_uprise_admin_sufficient") is False,str(b1r.get("security")))

resolved={x["id"]:x.get("status") for x in F1.get("resolved_geometry_requirements",[])}
for rid in ("f1-stair-a-exit-discharge","f1-stair-b-exit-discharge","f1-secure-service-entrance","f1-exterior-assembly-area","f1-basement-discharge-direction-controls"):
    check(f"resolved geometry: {rid}",rid in resolved,str(resolved.get(rid)))

failed=[x for x in checks if not x["passed"]]
report={
 "schema_version":"1.0.0",
 "not_for_construction":True,
 "scope":"Floor 1 + B1 digital-twin simulation authority",
 "checks_total":len(checks),
 "checks_passed":len(checks)-len(failed),
 "checks_failed":len(failed),
 "passed":not failed,
 "checks":checks
}
out=HERE/"generated"/"equity-uprise-floor-01-b1-simulation-report.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed:
    for item in failed:
        print("FAIL:",item["name"],item["detail"],file=sys.stderr)
    sys.exit(1)
