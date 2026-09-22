#!/usr/bin/env python3
"""Audit schematic human-walkable vertical circulation from B1 through Level 7.

This validates geometry/coordination logic in the deterministic digital twin.
It is NOT a building-code or construction certification.
"""
from pathlib import Path
import json, math, sys

HERE=Path(__file__).resolve().parent
CORE=json.loads((HERE/"building-core-v2.json").read_text())
PROGRAM=json.loads((HERE/"core-v2-floor-programs.json").read_text())
INV=json.loads((HERE/"floor-07"/"floor-07-object-inventory.json").read_text())
ROUTING=json.loads((HERE/"floor-07"/"floor-07-routing.json").read_text())
BUILDER=(HERE/"build_equity_uprise_building_v2.py").read_text()
OUT=HERE/"generated"/"equity-uprise-vertical-circulation-walkability-report.json"
checks=[]

def ck(name,ok,detail=""):
    checks.append({"name":name,"passed":bool(ok),"detail":detail})

levels=CORE["levels"]
nums=[x["level"] for x in levels]
elev=[x["finished_floor_elevation_ft"] for x in levels]
expected_nums=list(range(0,8))
expected_elev=[-13.5,0,13.5,27,40.5,54,67.5,81]
ck("levels B1 through 7 are present",nums==expected_nums,str(nums))
ck("finished-floor elevations are exact",elev==expected_elev,str(elev))
ck("every adjacent floor rise is 13.5 ft",all(abs((b-a)-13.5)<1e-9 for a,b in zip(elev[:-1],elev[1:])),str([b-a for a,b in zip(elev[:-1],elev[1:])]))

vs=CORE["vertical_systems"]
slab=CORE["slab_openings"]
for key,label in [("stair_a","Stair A"),("stair_b","Stair B")]:
    s=vs[key]
    b=s["enclosure_bounds_ft"];o=slab[key];d=s["access_opening_concept_ft"]
    ck(f"{label} serves B1 through Level 7",s.get("serves_levels")==expected_nums,str(s.get("serves_levels")))
    ck(f"{label} rise per level is 13.5 ft",abs(s.get("rise_per_level_ft",0)-13.5)<1e-9,str(s.get("rise_per_level_ft")))
    ck(f"{label} has 22 conceptual risers",s.get("riser_count_per_level_concept")==22,str(s.get("riser_count_per_level_concept")))
    ck(f"{label} riser math closes exactly",abs(s.get("riser_height_ft_concept",0)*22-13.5)<1e-7,f"{s.get('riser_height_ft_concept')} ft")
    ck(f"{label} conceptual tread is 11 in",abs(s.get("tread_depth_ft_concept",0)*12-11)<1e-6,f"{s.get('tread_depth_ft_concept',0)*12:g} in")
    ck(f"{label} south access is on enclosure face",abs(d.get("facade_y",999)-b["y1"])<1e-9,f"door y={d.get('facade_y')} enclosure y1={b['y1']}")
    ck(f"{label} roof/floor door clear width is 3 ft",abs(d.get("clear_width_ft",0)-3)<1e-9,str(d.get("clear_width_ft")))
    ck(f"{label} door lies inside enclosure",b["x1"] <= d["x1"] < d["x2"] <= b["x2"],str(d))
    ck(f"{label} slab opening lies inside enclosure",b["x1"] <= o["x1"] < o["x2"] <= b["x2"] and b["y1"] <= o["y1"] < o["y2"] <= b["y2"],str(o))
    ck(f"{label} southern landing meets slab opening edge",abs(o["y1"]-58.25)<1e-9,f"opening y1={o['y1']}")
    ck(f"{label} top transition lands exactly at roof",abs(expected_elev[-2]+s["rise_per_level_ft"]-expected_elev[-1])<1e-9,f"{expected_elev[-2]} + {s['rise_per_level_ft']} = {expected_elev[-1]}")

ck("combined builder has level-by-level stair-door logic","stair_enclosure_with_doors" in BUILDER)
ck("combined builder consumes canonical access opening coordinates","access_opening_concept_ft" in BUILDER)
ck("combined builder no longer uses sealed stair shaft walls",'shaft_walls("stair_a_enclosure"' not in BUILDER and 'shaft_walls("stair_b_enclosure"' not in BUILDER)

objects={x["id"]:x for x in INV["objects"]}
for oid in ["F7-STAIR-A-DOOR-01","F7-STAIR-B-DOOR-01"]:
    ck(f"{oid} exists",oid in objects)
    if oid in objects:
        ck(f"{oid} is modeled open",objects[oid].get("placement",{}).get("state")=="modeled_open",str(objects[oid].get("placement",{}).get("state")))
for oid in ["F7-PATH-A-01","F7-PATH-B-01","F7-PATH-B-02","F7-PATH-OVERLOOK-01"]:
    ck(f"{oid} circulation path exists",oid in objects)

l7=next(x for x in PROGRAM["levels"] if x["level"]==7)
ck("Level 7 owns exactly three audited capabilities",set(l7.get("feature_ids",[]))=={"ecosystem-routing","roof-mobility","uprise-world"},str(l7.get("feature_ids")))
ck("Level 7 is reconciled",l7.get("design_maturity")=="reconciled-current-iterative-pass",str(l7.get("design_maturity")))
pe=ROUTING.get("routes",{}).get("passenger_elevator_selector",{})
dest=[x.get("level") for x in pe.get("levels",[]) if x.get("enabled")]
ck("passenger elevator selector excludes Level 7",7 not in dest,str(dest))
ck("Level 7 has building-return route",ROUTING.get("routes",{}).get("building_return",{}).get("scene_id")=="equity-uprise-building-core-v2")
ck("Level 7 ecosystem route remains public navigation",ROUTING.get("routes",{}).get("ecosystem_routes",{}).get("access")=="public")

failed=[x for x in checks if not x["passed"]]
report={
    "schema_version":"1.0.0",
    "scope":"B1 through Level 7 schematic human-walkable vertical circulation",
    "not_for_construction":True,
    "levels":nums,
    "elevations_ft":elev,
    "floor_to_floor_ft":13.5,
    "checks_total":len(checks),
    "checks_passed":len(checks)-len(failed),
    "checks_failed":len(failed),
    "passed":not failed,
    "checks":checks
}
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed:
    for x in failed: print("FAIL:",x["name"],x["detail"],file=sys.stderr)
    raise SystemExit(1)
