#!/usr/bin/env python3
from __future__ import annotations
import json
from collections import Counter,defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
REG=HERE/"generated/equity-uprise-asset-registry-v1.json"
REP=HERE/"generated/equity-uprise-asset-registry-step3b-report.json"
SERVICES_REPORT=ROOT/"docs/design/equity-uprise-building/production/generated/equity-uprise-building-services-core-v2-report.json"
SERVICES_REL="docs/design/equity-uprise-building/production/generated/equity-uprise-building-services-core-v2-report.json"

def load(p): return json.loads(Path(p).read_text())
def write(p,d): p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(d,indent=2)+"\n")
def uniq(xs): return sorted(set(x for x in xs if x))
def rel_id(kind,a,b,branch): return f"REL::STEP3B::{kind.upper()}::{a}::{b}::{branch}"

registry=load(REG)
if registry.get("registry_version")!="step3a-b1-operational-graph-v1":
    raise SystemExit("Step 3B requires the Step 3A registry")
services_report=load(SERVICES_REPORT)
branches=services_report.get("floor_branch_records",[])
if not branches:
    raise SystemExit("services report missing floor_branch_records; rebuild services before Step 3B")

assets=registry["assets"]
by_id={a["asset_id"]:a for a in assets}
by_source=defaultdict(list)
for a in assets:
    srid=a["identity"].get("source_record_id")
    if srid: by_source[srid].append(a["asset_id"])
for k in by_source: by_source[k]=sorted(by_source[k])

relationships=list(registry.get("relationships",[]))
existing_ids={r["relationship_id"] for r in relationships}
riser_by_system={r["from_asset_id"]:r["to_asset_id"] for r in relationships if r["type"]=="routes_through"}
source_by_system=defaultdict(list)
for r in relationships:
    if r["type"]=="feeds" and r["to_asset_id"] in by_id and by_id[r["to_asset_id"]]["classification"].get("registry_role")=="system_semantic":
        source_by_system[r["to_asset_id"]].append(r["from_asset_id"])

def resolve_ref(ref):
    if not ref: return []
    if ref in by_source: return by_source[ref]
    if ref in by_id: return [ref]
    return []

branch_groups=defaultdict(list)
for b in branches:
    if b.get("inventory_ref"): branch_groups[b["inventory_ref"]].append(b)

branch_target_map={}
stale_inventory_refs=[]
for ref,group in branch_groups.items():
    targets=resolve_ref(ref)
    if not targets:
        stale_inventory_refs.append(ref)
        for b in group: branch_target_map[b["branch_id"]]=[]
        continue
    ordered_branches=sorted(group,key=lambda x:x["branch_id"])
    ordered_targets=sorted(targets)
    if len(ordered_branches)==len(ordered_targets) and len(ordered_targets)>1:
        for b,t in zip(ordered_branches,ordered_targets):
            branch_target_map[b["branch_id"]]=[t]
    else:
        for b in ordered_branches:
            branch_target_map[b["branch_id"]]=ordered_targets

new_relationships=[]
trace_records=[]
semantic_only=[]
canonical_branches=[]
linked_assets=set()
linked_assets_without_exact_location=set()
for b in branches:
    sid=b["system_id"]
    if sid not in by_id:
        raise SystemExit(f"branch system asset missing: {sid}")
    upstream=riser_by_system.get(sid,sid)
    if upstream not in by_id:
        raise SystemExit(f"branch upstream asset missing: {upstream}")
    targets=branch_target_map.get(b["branch_id"],[])
    ref=b.get("inventory_ref")
    connection=b.get("connection_xy_ft")
    source_ids=uniq(source_by_system.get(sid,[]))
    trace={
        "branch_id":b["branch_id"],
        "handoff_id":b["handoff_id"],
        "level":b["level"],
        "system_id":sid,
        "riser_id":riser_by_system.get(sid),
        "endpoint":b.get("endpoint"),
        "inventory_ref":ref,
        "endpoint_asset_ids":targets,
        "source_asset_ids":source_ids,
        "modeled_connection_xy_ft":connection,
        "services_step":b.get("services_step"),
        "resolution":"canonical_asset" if targets else ("semantic_only" if not ref else "stale_inventory_ref"),
        "path_asset_ids":source_ids+[sid]+([riser_by_system[sid]] if sid in riser_by_system else [])+targets,
    }
    trace_records.append(trace)
    if not targets:
        semantic_only.append(b["branch_id"])
        continue
    canonical_branches.append(b["branch_id"])
    for target in targets:
        linked_assets.add(target)
        a=by_id[target]
        loc=a.get("location",{})
        if not loc.get("center_ft") and not loc.get("bounds_ft"):
            linked_assets_without_exact_location.add(target)
        rid=rel_id("FEEDS",upstream,target,b["branch_id"])
        if rid in existing_ids: continue
        criticality="safety_related" if sid in {"ELEC-EMERGENCY","FIRE-PROTECTION","FIRE-ALARM"} else "operational"
        rel={
            "relationship_id":rid,
            "type":"feeds",
            "from_asset_id":upstream,
            "to_asset_id":target,
            "direction":"directed",
            "criticality":criticality,
            "source_refs":uniq([SERVICES_REL,a["authority"]["source_path"]]),
            "notes":f"Step 3B modeled floor branch {b['branch_id']} / {b['handoff_id']} at conceptual service connection XY {connection}; not an as-built asset center.",
        }
        relationships.append(rel); new_relationships.append(rel); existing_ids.add(rid)
        a["systems"]["system_families"]=uniq(a["systems"].get("system_families",[])+[sid])
        a["systems"]["upstream_asset_ids"]=uniq(a["systems"].get("upstream_asset_ids",[])+[upstream])
        by_id[upstream]["systems"]["downstream_asset_ids"]=uniq(by_id[upstream]["systems"].get("downstream_asset_ids",[])+[target])

relationships.sort(key=lambda x:x["relationship_id"])
registry["registry_version"]="step3b-floor-branch-endpoint-graph-v1"
registry["relationships"]=relationships
registry.setdefault("metadata",{})["status"]="step3b-floor-branch-endpoint-graph"
registry["metadata"]["step3b"]={
    "services_branch_records_total":len(branches),
    "canonical_branch_records":len(canonical_branches),
    "semantic_only_branch_records":len(semantic_only),
    "new_endpoint_relationships":len(new_relationships),
    "linked_endpoint_assets":len(linked_assets),
    "linked_assets_without_exact_location":len(linked_assets_without_exact_location),
    "stale_inventory_refs":len(stale_inventory_refs),
}
write(REG,registry)

checks=[]
def ck(name,ok,detail=""): checks.append({"name":name,"passed":bool(ok),"detail":detail})
ck("services branch topology count matches endpoint count",len(branches)==services_report.get("floor_endpoints"),[len(branches),services_report.get("floor_endpoints")])
ck("branch IDs are unique",len({b["branch_id"] for b in branches})==len(branches),len(branches))
ck("all above-B1 levels represented",set(b["level"] for b in branches)==set(range(1,8)),sorted(set(b["level"] for b in branches)))
ck("all branch systems resolve to canonical service assets",all(b["system_id"] in by_id for b in branches),"")
ck("no stale non-null inventory refs remain",not stale_inventory_refs,sorted(set(stale_inventory_refs)))
ck("canonical branches resolve to canonical endpoint assets",all(branch_target_map.get(bid) for bid in canonical_branches),len(canonical_branches))
ck("semantic-only branches stay explicit",len(canonical_branches)+len(semantic_only)==len(branches),[len(canonical_branches),len(semantic_only)])
ck("new endpoint relationships have valid assets",all(r["from_asset_id"] in by_id and r["to_asset_id"] in by_id for r in new_relationships),len(new_relationships))
ck("linked endpoint assets carry service-family membership",all(any(t["system_id"] in by_id[aid]["systems"].get("system_families",[]) for t in trace_records if aid in t["endpoint_asset_ids"]) for aid in linked_assets),len(linked_assets))
ck("every branch has a lab trace record",len(trace_records)==len(branches),len(trace_records))
ck("modeled connection points preserved without claiming as-built placement",all(t["modeled_connection_xy_ft"] and len(t["modeled_connection_xy_ft"])==2 for t in trace_records),len(trace_records))
ck("Step 3A relationships preserved",sum(1 for r in relationships if r["relationship_id"].startswith("REL::STEP3A::"))==61,sum(1 for r in relationships if r["relationship_id"].startswith("REL::STEP3A::")))
ck("LIVE control remains disabled",not any(a["security"].get("live_control_allowed") for a in assets),"")
passed=all(x["passed"] for x in checks)
report={
    "schema_version":"1.0.0",
    "status":"step3b-floor-branch-endpoint-graph",
    "registry_version":registry["registry_version"],
    "registry_assets_total":len(assets),
    "relationships_total":len(relationships),
    "step3b_new_relationships":len(new_relationships),
    "services_branch_records_total":len(branches),
    "canonical_branch_records":len(canonical_branches),
    "semantic_only_branch_records":len(semantic_only),
    "linked_endpoint_assets_total":len(linked_assets),
    "linked_endpoint_assets":sorted(linked_assets),
    "linked_assets_without_exact_location_total":len(linked_assets_without_exact_location),
    "linked_assets_without_exact_location":sorted(linked_assets_without_exact_location),
    "stale_inventory_refs":sorted(set(stale_inventory_refs)),
    "semantic_only_branch_ids":sorted(semantic_only),
    "relationship_type_counts":dict(sorted(Counter(r["type"] for r in relationships).items())),
    "level_branch_counts":dict(sorted(Counter(str(b["level"]) for b in branches).items())),
    "system_branch_counts":dict(sorted(Counter(b["system_id"] for b in branches).items())),
    "lab_trace_records":trace_records,
    "checks_total":len(checks),
    "checks_passed":sum(1 for x in checks if x["passed"]),
    "checks_failed":sum(1 for x in checks if not x["passed"]),
    "checks":checks,
    "passed":passed,
}
write(REP,report)
print("EQUITY UPRISE ASSET REGISTRY STEP 3B")
print(" services branches:",len(branches))
print(" canonical branches:",len(canonical_branches))
print(" semantic-only branches:",len(semantic_only))
print(" endpoint relationships:",len(new_relationships))
print(" linked endpoint assets:",len(linked_assets))
print(" stale refs:",len(stale_inventory_refs))
print(" checks:",report["checks_passed"],"/",report["checks_total"])
if not passed: raise SystemExit("asset registry Step 3B verification failed")
