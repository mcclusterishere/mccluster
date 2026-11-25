#!/usr/bin/env python3
from __future__ import annotations
import json, re
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=Path(__file__).resolve().parents[3]
CAT=HERE/"FEDERAL-TRAINING-CATALOG.json"
BIND=HERE/"FEDERAL-TRAINING-BINDINGS.json"
COMP=HERE/"competency-rubrics.json"
LABS=ROOT/"docs/design/equity-uprise-building/production/electronics/generated/equity-uprise-it-lab-catalog-v1.json"
REG=ROOT/"docs/design/equity-uprise-building/production/asset-registry/generated/equity-uprise-asset-registry-v1.json"
F1=ROOT/"docs/design/equity-uprise-building/production/floor-01/floor-01-digital-twin-program.json"
F1OBJ=ROOT/"docs/design/equity-uprise-building/production/floor-01/floor-01-simulation-objects.json"
SITE=ROOT/"docs/design/equity-uprise-building/production/floor-01/floor-01-site-egress.json"
HSEEP=ROOT/"docs/design/equity-uprise-building/production/lab-runtime/hseep-building-safety-scenario-pack-v1.json"

def load(p): return json.loads(p.read_text())
def fail(msg): raise SystemExit("FEDERAL TRAINING CATALOG: FAIL\n"+msg)

cat=load(CAT); bind=load(BIND); comp=load(COMP); labs=load(LABS); reg=load(REG); f1=load(F1); f1obj=load(F1OBJ); site=load(SITE)
records=cat.get("records",[])
if cat.get("status")!="canonical-federal-training-catalog-v1": fail("unexpected catalog status")
if cat.get("credential_is_not_competency", True) is not True:
    fail("credential/competency separation missing")
ids=[r.get("catalog_id") for r in records]
if len(ids)!=len(set(ids)) or None in ids: fail("catalog IDs missing/duplicated")

required={"catalog_id","record_type","agency","program","course_code","official_title","official_url","last_verified","free_status","active_status","delivery_mode","duration","award_type","prerequisites","annual_refresh","expiration_rules","eligibility","competency_ids","building_asset_ids","building_space_ids","floor_ids","scenario_ids","lab_ids","hands_on_level","current_lab_readiness","real_lab_requirements","simulation_only_boundary","provenance","stale_retired_aliases","credential_is_not_competency"}
for r in records:
    miss=sorted(required-set(r))
    if miss: fail(f"{r.get('catalog_id')} missing fields: {miss}")
    if r["credential_is_not_competency"] is not True: fail(f"{r['catalog_id']} conflates credential and competency")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}",r["last_verified"]): fail(f"{r['catalog_id']} bad last_verified")
    if r["active_status"].startswith("active") and not str(r["official_url"]).startswith("https://"): fail(f"{r['catalog_id']} active without https issuer URL")

# Discover canonical competency IDs without assuming JSON layout.
comp_ids=set()
def walk(v):
    if isinstance(v,dict):
        cid=v.get("competency_id") or v.get("id")
        if isinstance(cid,str) and re.fullmatch(r"(?:CORE|SHR|PSC|MED|OPS)-\d{2}",cid): comp_ids.add(cid)
        for x in v.values(): walk(x)
    elif isinstance(v,list):
        for x in v: walk(x)
walk(comp)
lab_ids={x["lab_id"] for x in labs.get("labs",[])}
asset_ids={x["asset_id"] for x in reg.get("assets",[])}
asset_ids.update(x["object_id"] for x in f1obj.get("objects",[]) if x.get("object_id"))
asset_ids.update(x["object_id"] for x in site.get("exterior_openings",[]) if x.get("object_id"))
asset_ids.update(x["object_id"] for x in site.get("floor1_discharge_controls",[]) if x.get("object_id"))
space_ids={x["id"] for x in f1.get("spaces",[]) if x.get("id")}
space_ids.update(x["id"] for x in f1.get("support_spaces",[]) if x.get("id"))
scenario_ids={x["id"] for x in f1.get("scenarios",[])}
allowed_floors={"B1","F1","F2","F3","F4","F5","F6","L7","BUILDING"}

for r in records:
    unknown=set(r["competency_ids"])-comp_ids
    if unknown: fail(f"{r['catalog_id']} unknown competency IDs: {sorted(unknown)}")
    unknown=set(r["lab_ids"])-lab_ids
    if unknown: fail(f"{r['catalog_id']} unknown lab IDs: {sorted(unknown)}")
    unknown=set(r["building_asset_ids"])-asset_ids
    if unknown: fail(f"{r['catalog_id']} unknown building asset IDs: {sorted(unknown)}")
    unknown=set(r["building_space_ids"])-space_ids
    if unknown: fail(f"{r['catalog_id']} unknown building space IDs: {sorted(unknown)}")
    unknown=set(r["scenario_ids"])-scenario_ids
    if unknown: fail(f"{r['catalog_id']} unknown Floor 1 scenario IDs: {sorted(unknown)}")
    unknown=set(r["floor_ids"])-allowed_floors
    if unknown: fail(f"{r['catalog_id']} unknown floor IDs: {sorted(unknown)}")
    if "B1" in r["floor_ids"] and "sandbox" not in r["simulation_only_boundary"].lower():
        fail(f"{r['catalog_id']} B1 binding lacks sandbox boundary")

brows=bind.get("bindings",[])
if {b["catalog_id"] for b in brows}!=set(ids): fail("binding catalog IDs do not exactly match catalog records")
for b in brows:
    if b.get("live_control_allowed") is not False: fail(f"{b['binding_id']} enables live control")
    r=next(x for x in records if x["catalog_id"]==b["catalog_id"])
    for k in ("competency_ids","floor_ids","building_asset_ids","building_space_ids","scenario_ids","lab_ids","hseep_scenario_ids"):
        if b.get(k)!=r.get(k): fail(f"{b['binding_id']} drifted from catalog field {k}")

agencies=set()
for r in records: agencies.add(r["agency"])
for expected in ("FEMA","IRS","EPA/ENERGY STAR","HHS/OHRP","CISA","DOE/FEMP","NOAA","NASA","CDC/NCEH + FEMA","ATSDR/CDC"):
    if expected not in agencies: fail(f"missing expected agency/program coverage: {expected}")

refs={x["reference_id"]:x for x in cat.get("reference_materials",[])}
for rid in ("REF-OSHA-1910-38","REF-OSHA-1926-800","REF-FHWA-TUNNEL-LIBRARY","REF-NIST-SP800-82R3","REF-NVD","REF-CISA-KEV"):
    if rid not in refs: fail(f"missing non-course reference: {rid}")
    if refs[rid].get("credential_awarded") is not False: fail(f"{rid} incorrectly awards credential")

is100=next((r for r in records if r["catalog_id"]=="FEMA-IS-100-C"),None)
if not is100 or is100["course_code"]!="IS-100.C": fail("FEMA IS-100.C normalization missing")
is238=next((r for r in records if r["catalog_id"]=="FEMA-IS-238"),None)
if not is238 or is238["official_title"]!="Critical Concepts of Supply Chain Flow and Resilience": fail("FEMA IS-238 title not normalized")

# --- 2026-11-03 cleanup invariants (HSEEP drills, rebinding, currency) ---
hseep=load(HSEEP)
hseep_ids={x["scenario_id"] for x in hseep["scenarios"]}
by_id={r["catalog_id"]:r for r in records}
for r in records:
    if not isinstance(r.get("hseep_scenario_ids"),list): fail(f"{r['catalog_id']} missing hseep_scenario_ids")
    unknown=set(r["hseep_scenario_ids"])-hseep_ids
    if unknown: fail(f"{r['catalog_id']} unknown HSEEP scenario IDs: {sorted(unknown)}")
for sc in hseep["scenarios"]:
    for cid in sc["federal_training_ids"]:
        if cid not in by_id: fail(f"{sc['scenario_id']} cites unknown catalog ID {cid}")
for r in records:
    for sid in r["hseep_scenario_ids"]:
        sc=next(x for x in hseep["scenarios"] if x["scenario_id"]==sid)
        if r["catalog_id"] not in sc["federal_training_ids"]: fail(f"{r['catalog_id']} binds {sid} but the pack does not cite it")
    for sc in hseep["scenarios"]:
        if r["catalog_id"] in sc["federal_training_ids"] and sc["scenario_id"] not in r["hseep_scenario_ids"]:
            fail(f"{sc['scenario_id']} cites {r['catalog_id']} but the binding is missing")
blob=json.dumps(cat)
retired={x["course_code"] for x in cat.get("retired_do_not_cite",[])}
if "IS-139.A" not in retired: fail("IS-139.A must be listed as retired_do_not_cite")
for r in records:
    if (r["course_code"] or "").upper() in retired: fail(f"{r['catalog_id']} cites a retired course")
if "network_checkin_outage" in sum((by_id[c]["scenario_ids"] for c in by_id if c.startswith("CISA-")),[]):
    fail("CISA Industrial Control Systems courses must not bind the IT check-in outage")
if "public_service_surge" in by_id["FEMA-IS-238"]["scenario_ids"]: fail("IS-238 (supply chain) must not bind the queue surge")
if set(by_id["FEMA-IS-235-C"]["scenario_ids"]) & {"basic_evacuation","blocked_stair_a","passenger_elevator_outage"}:
    fail("IS-235.C is community EOP planning; it must not be presented as workplace evacuation training")
for need in ("FEMA-IS-700-B","FEMA-IS-800-D","FEMA-IS-317-A","FEMA-IS-907-A","CISA-ICS-100W","CISA-ICS-210W"):
    if need not in by_id: fail(f"missing required course record {need}")
pds=next((p for p in cat.get("credential_programs",[]) if p["program_id"]=="FEMA-PDS"),None)
if not pds or len(pds["required_catalog_ids"])!=7 or any(c not in by_id for c in pds["required_catalog_ids"]):
    fail("FEMA PDS program must list its seven courses, all cataloged")
nfpa=refs.get("REF-NFPA-1660")
if not nfpa or "NFPA 1600" not in nfpa.get("stale_retired_aliases",[]): fail("NFPA 1660 (2024) must supersede NFPA 1600")
for r in records:
    if r["catalog_id"].startswith("IRS-VITA-") and not r.get("refresh_due"): fail(f"{r['catalog_id']} needs an annual refresh flag")
for r in records:
    if re.search(r"(?i)\bcertified\b",r.get("binding_notes","")): fail(f"{r['catalog_id']} binding note claims certification")

print("FEDERAL TRAINING CATALOG: PASS")
print(" records:",len(records))
print(" bindings:",len(brows))
print(" reference-only items:",len(refs))
print(" bound Step 4A labs:",len(set(x for r in records for x in r["lab_ids"])))
print(" bound competencies:",len(set(x for r in records for x in r["competency_ids"])))
print(" bound HSEEP scenarios:",len(set(x for r in records for x in r["hseep_scenario_ids"])))
