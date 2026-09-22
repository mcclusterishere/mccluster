#!/usr/bin/env python3
import json
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
REG=HERE/"generated/equity-uprise-asset-registry-v1.json"
REP=HERE/"generated/equity-uprise-asset-registry-step2-report.json"
CONTRACT=HERE/"asset-registry-source-contract-v1.json"
def load(p):return json.loads(Path(p).read_text())
def fail(m):raise SystemExit("ASSET REGISTRY STEP 2: FAIL\n"+m)
r=load(REG);rep=load(REP);c=load(CONTRACT);roles={"digital_only","aggregate_physicalizable","individual_physicalizable","system_semantic","capability_semantic"}
if r.get("schema_version")!="1.1.0":fail("registry schema_version must be 1.1.0")
if r.get("registry_version")!="step2-deterministic-ingestion-v1":fail("unexpected registry_version")
if r.get("not_for_construction") is not True:fail("not_for_construction boundary missing")
if r["safety_policy"].get("shadow_writes_allowed") is not False:fail("SHADOW must be read-only")
if r["safety_policy"].get("live_control_default")!="deny":fail("LIVE must be deny-by-default")
if r.get("relationships")!=[]:fail("Step 2 must not preempt Step 3 relationship graph")
assets=r.get("assets",[]);ids=[x["asset_id"] for x in assets]
if not assets or len(ids)!=len(set(ids)):fail("registry empty or asset IDs not unique")
for a in assets:
    role=a["classification"].get("registry_role")
    if role not in roles:fail(f"{a['asset_id']} invalid registry role")
    if not isinstance(a.get("source_snapshot"),dict) or not a["source_snapshot"]:fail(f"{a['asset_id']} missing source snapshot")
    p=a["physical_representation"]
    if any(p.get(k) is not None for k in ("manufacturer","model","serial_number","asset_number","as_built_location")):fail(f"{a['asset_id']} invented physical truth")
    t=a["identity"]["physical_tag"]
    if any(t.get(k) is not None for k in ("encoded_asset_id","qr_uri","nfc_uri","deep_link_uri")):fail(f"{a['asset_id']} tag assigned too early")
    if a["security"].get("live_control_allowed") is not False:fail(f"{a['asset_id']} LIVE control enabled")
    e=a["external_semantics"]
    if e["ifc"].get("verified") or e["ifc"].get("global_id") is not None or e["bacnet"].get("verified") or e["bacnet"].get("device_id") is not None:fail(f"{a['asset_id']} unverified external identity")
expected=c["source_sets"]["floor_object_inventory_total"]+sum(c["source_sets"][k]["expected_records"] for k in ("facade_modules","facade_finish_records","service_families","vertical_riser_allocations","building_core_levels","capability_map"))
dec=rep.get("source_decisions",[])
if len(dec)!=expected or rep.get("source_records_total")!=expected:fail(f"source decision count must be {expected}")
if rep.get("registry_assets_total")!=len(assets):fail("asset count mismatch")
if rep.get("passed") is not True or rep.get("checks_failed")!=0:fail("generator report failed")
seen=set();idset=set(ids)
for d in dec:
    key=(d["source_path"],d["source_record_id"])
    if key in seen:fail(f"duplicate source decision {key}")
    seen.add(key);qty=int(d["quantity"]);aids=d["asset_ids"]
    if d["registry_role"]=="individual_physicalizable" and qty>1:
        exp=[f"{d['source_record_id']}-I{i:03d}" for i in range(1,qty+1)]
        if aids!=exp:fail(f"{d['source_record_id']} expansion is not deterministic")
    else:
        if aids!=[d["source_record_id"]]:fail(f"{d['source_record_id']} did not preserve canonical ID")
    if any(a not in idset for a in aids):fail(f"{d['source_record_id']} decision references missing asset")
rolesrc=Counter(d["registry_role"] for d in dec)
if rolesrc["capability_semantic"]!=56:fail("capability semantic source count must be 56")
if rolesrc["system_semantic"]!=24:fail("service+riser semantic source count must be 24")
if any(rep.get(k)!=0 for k in ("physical_tags_assigned","verified_protocol_bindings","as_built_verified_assets","live_control_enabled_assets")):fail("Step 2 claims real-world bindings")
print("EQUITY UPRISE ASSET REGISTRY STEP 2: PASS")
print(" source records:",expected);print(" registry assets:",len(assets));print(" roles:",dict(sorted(Counter(a["classification"]["registry_role"] for a in assets).items())));print(" expanded source records:",rep["expanded_source_records"]);print(" unlocated physicalizable assets:",rep["unlocated_physicalizable_assets_total"]);print(f" checks: {rep['checks_passed']}/{rep['checks_total']}")
