#!/usr/bin/env python3
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
REG=HERE/"generated/equity-uprise-asset-registry-v1.json"
REP=HERE/"generated/equity-uprise-asset-registry-step3b-report.json"
SVC=ROOT/"docs/design/equity-uprise-building/production/generated/equity-uprise-building-services-core-v2-report.json"
def load(p): return json.loads(Path(p).read_text())
def fail(m): raise SystemExit("ASSET REGISTRY STEP 3B: FAIL\n"+m)
r=load(REG); rep=load(REP); svc=load(SVC)
if r.get("registry_version")!="step3b-floor-branch-endpoint-graph-v1": fail("registry version not Step 3B")
if rep.get("status")!="step3b-floor-branch-endpoint-graph" or rep.get("passed") is not True: fail("Step 3B report not passing")
if rep.get("services_branch_records_total")!=svc.get("floor_branch_records_total"): fail("services branch count mismatch")
if rep.get("services_branch_records_total")!=svc.get("floor_endpoints"): fail("services endpoints/branch records mismatch")
if rep.get("stale_inventory_refs"): fail("stale inventory refs remain")
assets={a["asset_id"]:a for a in r["assets"]}
rels=r.get("relationships",[])
if sum(1 for x in rels if x["relationship_id"].startswith("REL::STEP3A::"))!=61: fail("Step 3A graph not preserved")
new=[x for x in rels if x["relationship_id"].startswith("REL::STEP3B::")]
if len(new)!=rep.get("step3b_new_relationships"): fail("Step 3B relationship count mismatch")
if any(x["from_asset_id"] not in assets or x["to_asset_id"] not in assets for x in new): fail("Step 3B relationship references missing asset")
if any(x["type"]!="feeds" for x in new): fail("Step 3B relationship type must be feeds")
if set(rep.get("level_branch_counts",{}))!=set(str(x) for x in range(1,8)): fail("Step 3B does not cover F1-L7")
if rep.get("canonical_branch_records",0)+rep.get("semantic_only_branch_records",0)!=rep.get("services_branch_records_total"): fail("branch resolution partition mismatch")
if len(rep.get("lab_trace_records",[]))!=rep.get("services_branch_records_total"): fail("lab trace coverage incomplete")
if any(a["security"].get("live_control_allowed") for a in assets.values()): fail("Step 3B must not enable LIVE control")
if rep.get("checks_failed")!=0: fail("Step 3B checks failed")
print("EQUITY UPRISE ASSET REGISTRY STEP 3B: PASS")
print(" services branches:",rep["services_branch_records_total"])
print(" canonical branches:",rep["canonical_branch_records"])
print(" semantic-only branches:",rep["semantic_only_branch_records"])
print(" new endpoint relationships:",rep["step3b_new_relationships"])
print(" linked endpoint assets:",rep["linked_endpoint_assets_total"])
