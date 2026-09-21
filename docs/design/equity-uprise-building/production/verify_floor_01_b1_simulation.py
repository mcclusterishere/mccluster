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

checks=[]
def check(name, passed, detail=""):
    checks.append({"name":name,"passed":bool(passed),"detail":detail})

levels={x["level"]:x for x in CORE["levels"]}
check("B1 exists in core",0 in levels,str(sorted(levels)))
check("B1 elevation -13.5",levels.get(0,{}).get("finished_floor_elevation_ft")==-13.5,str(levels.get(0)))
check("Floor 1 is level of exit discharge",CORE.get("level_of_exit_discharge")==1,str(CORE.get("level_of_exit_discharge")))
check("B1 is not developmental",B1.get("developmental_stage") is None,str(B1.get("developmental_stage")))
check("B1 normal public access false",B1.get("normal_public_access") is False,str(B1.get("normal_public_access")))
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
check("Stair A down barrier exists","F1-BARRIER-STAIR-A-DOWN" in controls,str(controls))
check("Stair B down barrier exists","F1-BARRIER-STAIR-B-DOWN" in controls,str(controls))
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

# Floor 1 authority must point at the resolved site/B1 layers.
check("Floor 1 site ref",F1.get("site_egress_ref")=="floor-01-site-egress.json",str(F1.get("site_egress_ref")))
check("Floor 1 basement ref",F1.get("basement_ref")=="../basement-b1-program.json",str(F1.get("basement_ref")))
check("no unresolved geometry requirements","unresolved_geometry_requirements" not in F1,str(F1.get("unresolved_geometry_requirements")))
check("Floor 1 hides B1 from normal navigation",F1.get("underground_access_model",{}).get("public_directory_shows_b1") is False,str(F1.get("underground_access_model")))
check("Floor 1 ordinary EU admin cannot see B1",F1.get("underground_access_model",{}).get("ordinary_equity_uprise_admin_can_see_b1") is False,str(F1.get("underground_access_model")))
check("Floor 1 training goes to sandbox clone",F1.get("underground_access_model",{}).get("training",{}).get("destination")=="sandboxed B1/tunnel clone",str(F1.get("underground_access_model",{}).get("training")))
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
