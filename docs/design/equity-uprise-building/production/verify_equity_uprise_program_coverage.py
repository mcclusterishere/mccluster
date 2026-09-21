#!/usr/bin/env python3
"""
Validate that the Equity Uprise Core V2 building still represents the
repo-grounded capability map and preserves public/private interaction boundaries.

This is semantic/program validation, not building-code validation.
NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import json, sys

HERE=Path(__file__).resolve().parent
CAP=json.loads((HERE/"equity-uprise-capability-map-v2.json").read_text())
PROGRAM=json.loads((HERE/"core-v2-floor-programs.json").read_text())

checks=[]

def check(name, passed, detail=""):
    checks.append({"name":name,"passed":bool(passed),"detail":detail})

caps=CAP["capabilities"]
cap_ids=[c["id"] for c in caps]
ROOT=HERE.parents[3]
check("capability ids unique",len(cap_ids)==len(set(cap_ids)),f"{len(cap_ids)} capabilities")

# Every repository path cited as evidence for a capability must still exist.
# This includes shared-platform dependencies whose filenames are not EU-prefixed.
for c in caps:
    for source in c.get("sources",[]):
        p=ROOT/source.rstrip("/")
        check(f"capability source exists: {c['id']} -> {source}",p.exists(),str(p))

levels={int(x["level"]):x for x in PROGRAM["levels"]}
check("levels 1-7 present",set(levels)==set(range(1,8)),str(sorted(levels)))

# Every declared capability must be represented on its primary floor and every
# declared secondary floor. No floor may claim a capability absent from the map.
for c in caps:
    cid=c["id"]
    pf=int(c["primary_floor"])
    check(f"{cid} primary floor {pf}",cid in levels[pf].get("feature_ids",[]))
    for sf in c.get("secondary_floors",[]):
        check(f"{cid} secondary floor {sf}",cid in levels[int(sf)].get("feature_ids",[]))

known=set(cap_ids)
for n,level in levels.items():
    unknown=[x for x in level.get("feature_ids",[]) if x not in known]
    check(f"floor {n} has no unknown capability ids",not unknown,", ".join(unknown))

# Floor program route keys must resolve to generated routing entries.
for n,level in levels.items():
    routing_path=HERE/f"floor-{n:02d}"/f"floor-{n:02d}-routing.json"
    hotspots_path=HERE/f"floor-{n:02d}"/f"floor-{n:02d}-hotspots.json"
    if not routing_path.exists() or not hotspots_path.exists():
        check(f"floor {n} production routing/hotspots exist",False)
        continue
    routing=json.loads(routing_path.read_text())
    hotspots=json.loads(hotspots_path.read_text())
    routes=routing.get("routes",{})

    required={z["route_key"] for z in level.get("zones",[]) if z.get("route_key")}
    missing=sorted(required-set(routes))
    check(f"floor {n} zone routes resolve",not missing,", ".join(missing))

    check(f"floor {n} arbitrary redirects disabled",
          routing.get("security",{}).get("allow_arbitrary_external_redirects") is False)

    freight_public=[h for h in hotspots.get("hotspots",[]) if "freight" in h.get("id","").lower() or "freight" in h.get("label","").lower()]
    check(f"floor {n} freight elevator has no public hotspot",not freight_public)

# Passenger elevator service: Floors 1-6 only. Roof must not imply a stop.
for n in range(1,7):
    h=json.loads((HERE/f"floor-{n:02d}"/f"floor-{n:02d}-hotspots.json").read_text())
    pe=[x for x in h.get("hotspots",[]) if x.get("id")=="hs_passenger_elevator"]
    check(f"floor {n} passenger elevator hotspot exists",len(pe)==1)
    if pe:
        check(f"floor {n} passenger elevator uses restricted selector",
              pe[0].get("route_key")=="passenger_elevator_selector")

roof_h=json.loads((HERE/"floor-07"/"floor-07-hotspots.json").read_text())
check("level 7 has no passenger elevator hotspot",
      not any(x.get("id")=="hs_passenger_elevator" for x in roof_h.get("hotspots",[])))

for n in range(1,8):
    routing=json.loads((HERE/f"floor-{n:02d}"/f"floor-{n:02d}-routing.json").read_text())
    pe=routing.get("routes",{}).get("passenger_elevator_selector",{})
    dest=[x.get("level") for x in pe.get("levels",[]) if x.get("enabled")]
    check(f"floor {n} passenger selector excludes roof",7 not in dest,str(dest))

# High-risk/private surfaces must never be declared public.
high_risk={"media_release_ops","publication_submission","admin_desk","control_plane"}
for n in range(1,8):
    routing=json.loads((HERE/f"floor-{n:02d}"/f"floor-{n:02d}-routing.json").read_text())
    routes=routing.get("routes",{})
    for key in high_risk:
        r=routes.get(key,{})
        check(f"floor {n} {key} is not public",r.get("access")!="public",str(r.get("access")))

failed=[x for x in checks if not x["passed"]]
report={
    "schema_version":"1.0.0",
    "not_for_construction":True,
    "capability_count":len(caps),
    "floor_feature_counts":{str(n):len(levels[n].get("feature_ids",[])) for n in levels},
    "checks_total":len(checks),
    "checks_passed":len(checks)-len(failed),
    "checks_failed":len(failed),
    "passed":not failed,
    "checks":checks
}
out=HERE/"generated"/"equity-uprise-program-coverage-report.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({k:report[k] for k in ("capability_count","floor_feature_counts","checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed:
    for x in failed:
        print("FAIL:",x["name"],x["detail"],file=sys.stderr)
    sys.exit(1)
