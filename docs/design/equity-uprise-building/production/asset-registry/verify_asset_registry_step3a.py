#!/usr/bin/env python3
import json
from collections import Counter,defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
REG=HERE/"generated/equity-uprise-asset-registry-v1.json"
REP=HERE/"generated/equity-uprise-asset-registry-step3a-report.json"
SERVICES=ROOT/"docs/design/equity-uprise-building/production/building-services-core-v2.json"
RISERS=ROOT/"docs/design/equity-uprise-building/production/vertical-risers-core-v2.json"
def load(p):return json.loads(Path(p).read_text())
def fail(m):raise SystemExit("ASSET REGISTRY STEP 3A: FAIL\n"+m)
r=load(REG); rep=load(REP); svc=load(SERVICES); ris=load(RISERS)
if r.get("registry_version")!="step3a-b1-operational-graph-v1":fail("registry_version not Step 3A")
if rep.get("status")!="step3a-b1-operational-graph" or rep.get("passed") is not True:fail("Step 3A report not passing")
assets={a["asset_id"]:a for a in r.get("assets",[])}
rels=r.get("relationships",[])
if len(rels)!=rep.get("relationships_total"):fail("relationship total mismatch")
if len({x["relationship_id"] for x in rels})!=len(rels):fail("duplicate relationship IDs")
if len({(x["type"],x["from_asset_id"],x["to_asset_id"]) for x in rels})!=len(rels):fail("duplicate semantic relationships")
if any(x["from_asset_id"] not in assets or x["to_asset_id"] not in assets for x in rels):fail("relationship references missing assets")
by_type=Counter(x["type"] for x in rels)
if by_type["routes_through"]!=9:fail("must have 9 dedicated system-to-riser relationships")
declared=sum(len(x.get("dependencies",[]) or []) for x in svc.get("system_families",[]))
if by_type["depends_on"]!=declared:fail(f"dependency edge count {by_type['depends_on']} != authority {declared}")
source_map=defaultdict(list)
for a in assets.values():
    srid=a["identity"].get("source_record_id")
    if srid:source_map[srid].append(a["asset_id"])
expected_feeds=set()
expected_routes=set()
for conn in svc.get("b1_source_connections",[]):
    sid=conn["system_id"]; rid=conn["connection_target_riser"]
    expected_routes.add((sid,rid))
    for source_ref in conn.get("source_equipment_refs",[]):
        resolved=source_map.get(source_ref,[]) or ([source_ref] if source_ref in assets else [])
        if not resolved:fail(f"unresolved source ref {source_ref}")
        for aid in resolved:
            if assets[aid]["location"].get("level_id")!="B1":fail(f"{aid} is not B1")
            expected_feeds.add((aid,sid))
actual_feeds={(x["from_asset_id"],x["to_asset_id"]) for x in rels if x["type"]=="feeds"}
actual_routes={(x["from_asset_id"],x["to_asset_id"]) for x in rels if x["type"]=="routes_through"}
if actual_feeds!=expected_feeds:fail("feed graph does not exactly match authority-backed B1 source expansion")
if actual_routes!=expected_routes:fail("riser graph does not exactly match B1 source connection authority")
riser_map={x["id"]:x.get("system_id") for x in ris.get("sub_riser_envelopes_ft",[])}
for sid,rid in actual_routes:
    if riser_map.get(rid)!=sid:fail(f"{sid}->{rid} riser system mismatch")
expected_deps={(x["id"],d) for x in svc.get("system_families",[]) for d in (x.get("dependencies",[]) or [])}
actual_deps={(x["from_asset_id"],x["to_asset_id"]) for x in rels if x["type"]=="depends_on"}
if actual_deps!=expected_deps:fail("dependency graph differs from building-services authority")
for aid,sid in actual_feeds:
    if sid not in assets[aid]["systems"].get("system_families",[]):fail(f"{aid} missing system-family membership {sid}")
    if sid not in assets[aid]["systems"].get("downstream_asset_ids",[]):fail(f"{aid} missing downstream system {sid}")
    if aid not in assets[sid]["systems"].get("upstream_asset_ids",[]):fail(f"{sid} missing upstream source {aid}")
for sid,rid in actual_routes:
    if rid not in assets[sid]["systems"].get("downstream_asset_ids",[]):fail(f"{sid} missing downstream riser {rid}")
    if sid not in assets[rid]["systems"].get("upstream_asset_ids",[]):fail(f"{rid} missing upstream system {sid}")
for sid,dep in actual_deps:
    if dep not in assets[sid]["systems"].get("dependency_asset_ids",[]):fail(f"{sid} missing dependency {dep}")
if rep.get("dependency_cycles"):fail("dependency cycle detected")
if rep.get("unresolved_relationships"):fail("unresolved Step 3A relationships remain")
if rep.get("checks_failed")!=0:fail("Step 3A report contains failed checks")
if any(a["security"].get("live_control_allowed") for a in assets.values()):fail("Step 3A must not enable LIVE control")
print("EQUITY UPRISE ASSET REGISTRY STEP 3A: PASS")
print(" relationships:",len(rels))
print(" feeds:",len(actual_feeds))
print(" risers:",len(actual_routes))
print(" dependencies:",len(actual_deps))
print(" trace paths:",rep.get("trace_paths_total"))
print(" source-connected systems:",rep.get("source_connected_systems_total"),"/ 9")
