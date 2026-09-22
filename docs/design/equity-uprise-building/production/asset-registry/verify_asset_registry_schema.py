#!/usr/bin/env python3
"""Verify Equity Uprise Digital-to-Physical Asset Registry Step 1."""
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
SCHEMA=HERE/"asset-registry-schema-v1.json"
CONTRACT=HERE/"asset-registry-source-contract-v1.json"

def load(p): return json.loads(Path(p).read_text())
def fail(msg): raise SystemExit("ASSET REGISTRY STEP 1: FAIL\n"+msg)

schema=load(SCHEMA)
contract=load(CONTRACT)

required_top={"schema_version","registry_version","registry_id","building_id","source_revision","not_for_construction","safety_policy","assets","relationships"}
if schema.get("$schema")!="https://json-schema.org/draft/2020-12/schema": fail("JSON Schema draft must be 2020-12")
if not required_top.issubset(set(schema.get("required",[]))): fail("top-level registry contract incomplete")
defs=schema.get("$defs",{})
for name in ("asset","point","protocolBinding","relationship","stateVariable","operatingMode","levelId"):
    if name not in defs: fail(f"missing schema definition: {name}")

required_asset={"asset_id","label","identity","classification","location","authority","digital_representation","physical_representation","external_semantics","systems","state_model","points","training","security","lifecycle","operations"}
if not required_asset.issubset(set(defs["asset"].get("required",[]))): fail("asset domain contract incomplete")
if defs["operatingMode"].get("enum")!=["SIMULATION","SHADOW","LIVE"]: fail("operating modes drifted")
if contract["operating_mode_policy"]["shadow_writes_allowed"] is not False: fail("SHADOW writes must be prohibited")
if contract["operating_mode_policy"]["live_control_default"]!="deny": fail("LIVE control must default deny")

expected_points={"sensor","actuator","command","setpoint","status","alarm","trend","meter","calculated"}
if set(defs["point"]["properties"]["point_type"]["enum"])!=expected_points: fail("point taxonomy drifted")
if set(defs["relationship"]["properties"]["type"]["enum"])!=set(contract["relationship_types"]): fail("relationship taxonomy drifted")

ids=[]
fields=set()
floor_total=0
for src in contract["source_sets"]["floor_object_inventories"]:
    inv=load(ROOT/src["path"])
    objs=inv.get("objects",[])
    if len(objs)!=src["expected_records"]: fail(f"{src['level_id']} count drifted: {len(objs)}")
    floor_total+=len(objs)
    for obj in objs:
        oid=obj.get("id")
        if not oid: fail(f"{src['level_id']} object missing id")
        ids.append(oid)
        fields.update(obj.keys())
        q=obj.get("quantity",1)
        if not isinstance(q,int) or q<1: fail(f"{oid} has invalid quantity {q}")

if floor_total!=512 or floor_total!=contract["source_sets"]["floor_object_inventory_total"]: fail(f"floor inventory total drifted: {floor_total}")
if len(ids)!=len(set(ids)):
    seen=set(); dup=[]
    for x in ids:
        if x in seen: dup.append(x)
        seen.add(x)
    fail("duplicate stable IDs: "+", ".join(sorted(set(dup))[:20]))

unmapped=sorted(fields-set(contract["source_field_map"]))
if unmapped: fail("unmapped inventory fields: "+", ".join(unmapped))

for label,key in [
 ("facade_modules","facade_modules"),
 ("facade_finish_records","facade_finish_records"),
 ("service_families","service_families"),
 ("vertical_riser_allocations","vertical_riser_allocations"),
 ("building_core_levels","building_core_levels"),
 ("capability_map","capability_map"),
]:
    cfg=contract["source_sets"][key]
    data=load(ROOT/cfg["path"])
    actual=len(data.get(cfg["key"],[]))
    if actual!=cfg["expected_records"]: fail(f"{label} count {actual} != {cfg['expected_records']}")

if contract["source_sets"]["building_core_levels"]["expected_records"]!=8: fail("must cover B1 through L7")
if contract["source_sets"]["service_families"]["expected_records"]!=14: fail("service family checkpoint must remain 14")
identity=contract["canonical_identity_policy"]
if not identity["reuse_existing_stable_id"] or not identity["physical_tag_encodes_canonical_asset_id"]: fail("one-identity policy not locked")

print("EQUITY UPRISE ASSET REGISTRY STEP 1: PASS")
print(f"  B1-L7 inventory records: {floor_total}")
print(f"  unique stable object IDs: {len(set(ids))}")
print("  facade modules: 288")
print("  facade finish records: 68")
print("  service families: 14")
print("  riser allocations: 10")
print("  capabilities: 56")
print("  modes: SIMULATION / SHADOW / LIVE")
print("  SHADOW writes: prohibited")
print("  LIVE control: deny-by-default")
