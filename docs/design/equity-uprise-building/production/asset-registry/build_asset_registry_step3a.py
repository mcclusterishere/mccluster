#!/usr/bin/env python3
from __future__ import annotations
import hashlib,json
from collections import Counter,defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
REG=HERE/"generated/equity-uprise-asset-registry-v1.json"
REP=HERE/"generated/equity-uprise-asset-registry-step3a-report.json"
SERVICES=ROOT/"docs/design/equity-uprise-building/production/building-services-core-v2.json"
RISERS=ROOT/"docs/design/equity-uprise-building/production/vertical-risers-core-v2.json"
SERVICES_REL="docs/design/equity-uprise-building/production/building-services-core-v2.json"
RISERS_REL="docs/design/equity-uprise-building/production/vertical-risers-core-v2.json"

def load(p): return json.loads(Path(p).read_text())
def write(p,data): p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(data,indent=2)+"\n")
def uniq(xs): return sorted(set(x for x in xs if x))
def rel_id(kind,a,b): return f"REL::STEP3A::{kind}::{a}::{b}"

registry=load(REG)
services=load(SERVICES)
risers=load(RISERS)
assets=registry["assets"]
by_id={a["asset_id"]:a for a in assets}
by_source=defaultdict(list)
for a in assets:
    srid=a["identity"].get("source_record_id")
    if srid: by_source[srid].append(a["asset_id"])
for k in by_source: by_source[k]=sorted(by_source[k])

service_ids={x["id"] for x in services.get("system_families",[])}
riser_map={x["id"]:x.get("system_id") for x in risers.get("sub_riser_envelopes_ft",[])}

relationships=[]
traces=[]
unresolved=[]
def add_relationship(kind,src,dst,criticality="operational",refs=None,notes=None):
    rid=rel_id(kind.upper().replace("_","-"),src,dst)
    relationships.append({
        "relationship_id":rid,
        "type":kind,
        "from_asset_id":src,
        "to_asset_id":dst,
        "direction":"directed",
        "criticality":criticality,
        "source_refs":uniq(refs or []),
        "notes":notes,
    })

# 1) Authority-backed B1 physical source assets -> semantic service family -> dedicated riser.
for conn in services.get("b1_source_connections",[]):
    sid=conn["system_id"]
    rid=conn["connection_target_riser"]
    if sid not in by_id or sid not in service_ids:
        unresolved.append({"kind":"missing_system_asset","system_id":sid})
        continue
    if rid not in by_id or riser_map.get(rid)!=sid:
        unresolved.append({"kind":"missing_or_mismatched_riser","system_id":sid,"riser_id":rid,"riser_system":riser_map.get(rid)})
        continue

    source_asset_ids=[]
    for source_ref in conn.get("source_equipment_refs",[]):
        resolved=by_source.get(source_ref,[])
        if not resolved and source_ref in by_id: resolved=[source_ref]
        if not resolved:
            unresolved.append({"kind":"missing_b1_source_asset","system_id":sid,"source_ref":source_ref})
            continue
        source_asset_ids.extend(resolved)

    source_asset_ids=uniq(source_asset_ids)
    for aid in source_asset_ids:
        a=by_id[aid]
        if a["location"].get("level_id")!="B1":
            unresolved.append({"kind":"source_not_b1","system_id":sid,"asset_id":aid,"level_id":a["location"].get("level_id")})
            continue
        add_relationship(
            "feeds",aid,sid,
            refs=[a["authority"]["source_path"],SERVICES_REL],
            notes=f"Authority-backed B1 source for {sid}; physical capacities and external utility boundaries remain unmodeled."
        )
        a["systems"]["system_families"]=uniq(a["systems"].get("system_families",[])+[sid])
        a["systems"]["downstream_asset_ids"]=uniq(a["systems"].get("downstream_asset_ids",[])+[sid])
        by_id[sid]["systems"]["upstream_asset_ids"]=uniq(by_id[sid]["systems"].get("upstream_asset_ids",[])+[aid])

    add_relationship(
        "routes_through",sid,rid,
        refs=[SERVICES_REL,RISERS_REL],
        notes=f"{sid} uses the dedicated conceptual digital-twin riser allocation {rid}; this is not construction shaft sizing."
    )
    by_id[sid]["systems"]["downstream_asset_ids"]=uniq(by_id[sid]["systems"].get("downstream_asset_ids",[])+[rid])
    by_id[rid]["systems"]["upstream_asset_ids"]=uniq(by_id[rid]["systems"].get("upstream_asset_ids",[])+[sid])

    for aid in source_asset_ids:
        if aid in by_id and by_id[aid]["location"].get("level_id")=="B1":
            traces.append({
                "source_asset_id":aid,
                "system_id":sid,
                "riser_id":rid,
                "path":[aid,sid,rid],
                "origin_zone":conn.get("origin_zone"),
                "external_boundary":conn.get("external_boundary"),
            })

# 2) Declared semantic system dependencies across all 14 service families.
dependency_edges=[]
for sf in services.get("system_families",[]):
    sid=sf["id"]
    if sid not in by_id:
        unresolved.append({"kind":"dependency_source_system_missing","system_id":sid})
        continue
    declared=sf.get("dependencies",[]) or []
    for dep in declared:
        if dep not in by_id or dep not in service_ids:
            unresolved.append({"kind":"dependency_target_system_missing","system_id":sid,"dependency_id":dep})
            continue
        add_relationship(
            "depends_on",sid,dep,
            refs=[SERVICES_REL],
            notes=f"Declared service-family dependency from building-services authority: {sid} depends on {dep}."
        )
        by_id[sid]["systems"]["dependency_asset_ids"]=uniq(by_id[sid]["systems"].get("dependency_asset_ids",[])+[dep])
        dependency_edges.append((sid,dep))

# 3) Ensure relationship IDs and semantic tuples are unique.
relationships.sort(key=lambda x:x["relationship_id"])
relationship_ids=[r["relationship_id"] for r in relationships]
relationship_tuples=[(r["type"],r["from_asset_id"],r["to_asset_id"]) for r in relationships]

# 4) Detect dependency cycles. Cycles would make lab causal tracing ambiguous.
dep_graph={sid:[] for sid in service_ids}
for a,b in dependency_edges: dep_graph.setdefault(a,[]).append(b)
visiting=set(); visited=set(); cycles=[]
def dfs(node,path):
    if node in visiting:
        if node in path:
            i=path.index(node); cycles.append(path[i:]+[node])
        return
    if node in visited:return
    visiting.add(node)
    for nxt in dep_graph.get(node,[]): dfs(nxt,path+[nxt])
    visiting.remove(node); visited.add(node)
for sid in sorted(service_ids): dfs(sid,[sid])

source_connections=services.get("b1_source_connections",[])
source_connected_systems=sorted({x["system_id"] for x in source_connections})
dedicated_riser_systems=sorted({r["system_id"] for r in relationships if r["type"]=="routes_through"})
all_systems=sorted(service_ids)
systems_without_dedicated_b1_source=sorted(service_ids-set(source_connected_systems))
feed_edges=[r for r in relationships if r["type"]=="feeds"]
riser_edges=[r for r in relationships if r["type"]=="routes_through"]
dep_edges=[r for r in relationships if r["type"]=="depends_on"]

checks=[]
def ck(name,passed,detail):
    checks.append({"name":name,"passed":bool(passed),"detail":detail})
ck("all Step 3A relationship endpoints exist",all(r["from_asset_id"] in by_id and r["to_asset_id"] in by_id for r in relationships),"")
ck("relationship IDs are unique",len(relationship_ids)==len(set(relationship_ids)),len(relationship_ids))
ck("relationship semantic tuples are unique",len(relationship_tuples)==len(set(relationship_tuples)),len(relationship_tuples))
ck("all nine authority B1 source systems are connected",len(source_connected_systems)==9 and set(source_connected_systems)==set(dedicated_riser_systems),source_connected_systems)
ck("all nine dedicated riser targets match their systems",len(riser_edges)==9,[(r["from_asset_id"],r["to_asset_id"]) for r in riser_edges])
ck("all declared source-equipment refs resolve to B1 asset identities",not [x for x in unresolved if x["kind"] in {"missing_b1_source_asset","source_not_b1"}],[x for x in unresolved if x["kind"] in {"missing_b1_source_asset","source_not_b1"}])
ck("all 14 service-family assets exist",len(service_ids)==14 and service_ids.issubset(by_id.keys()),sorted(service_ids))
ck("all declared system dependencies materialized",len(dep_edges)==sum(len(x.get("dependencies",[]) or []) for x in services.get("system_families",[])),len(dep_edges))
ck("system dependency graph is acyclic",not cycles,cycles)
ck("no unsupported relationship targets",not unresolved,unresolved)
ck("B1 source assets carry their authority-backed service-family membership",all(r["to_asset_id"] in by_id[r["from_asset_id"]]["systems"]["system_families"] for r in feed_edges),"")
ck("source-system-riser trace paths exist",len(traces)==len(feed_edges),len(traces))

passed=all(x["passed"] for x in checks)

registry["registry_version"]="step3a-b1-operational-graph-v1"
registry["relationships"]=relationships
registry.setdefault("metadata",{})["status"]="step3a-b1-operational-graph"
registry["metadata"]["step3a"]={
    "relationships_total":len(relationships),
    "feed_relationships":len(feed_edges),
    "riser_relationships":len(riser_edges),
    "dependency_relationships":len(dep_edges),
    "source_connected_systems":source_connected_systems,
    "systems_without_dedicated_b1_source":systems_without_dedicated_b1_source,
    "trace_paths_total":len(traces),
    "unresolved_relationships":len(unresolved),
}
write(REG,registry)

report={
    "schema_version":"1.0.0",
    "status":"step3a-b1-operational-graph",
    "registry_version":registry["registry_version"],
    "registry_assets_total":len(assets),
    "relationships_total":len(relationships),
    "relationship_type_counts":dict(sorted(Counter(r["type"] for r in relationships).items())),
    "b1_source_connections_authority_total":len(source_connections),
    "source_connected_systems_total":len(source_connected_systems),
    "source_connected_systems":source_connected_systems,
    "systems_without_dedicated_b1_source":systems_without_dedicated_b1_source,
    "b1_feed_relationships":len(feed_edges),
    "dedicated_riser_relationships":len(riser_edges),
    "declared_system_dependency_relationships":len(dep_edges),
    "trace_paths_total":len(traces),
    "trace_paths":traces,
    "dependency_cycles":cycles,
    "unresolved_relationships":unresolved,
    "checks_total":len(checks),
    "checks_passed":sum(1 for x in checks if x["passed"]),
    "checks_failed":sum(1 for x in checks if not x["passed"]),
    "checks":checks,
    "passed":passed,
}
write(REP,report)
print("EQUITY UPRISE ASSET REGISTRY STEP 3A")
print(" relationships:",len(relationships))
print(" feeds:",len(feed_edges))
print(" risers:",len(riser_edges))
print(" dependencies:",len(dep_edges))
print(" trace paths:",len(traces))
print(" source-connected systems:",len(source_connected_systems),"/ 9")
print(" checks:",report["checks_passed"],"/",report["checks_total"])
if not passed: raise SystemExit("asset registry Step 3A verification failed")
