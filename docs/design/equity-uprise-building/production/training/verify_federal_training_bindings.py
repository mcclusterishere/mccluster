#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parents[5]
CAT=ROOT/"docs/design/equity-uprise-development/federal-training-catalog.json"
BIND=ROOT/"docs/design/equity-uprise-building/production/training/federal-training-building-bindings-v1.json"
COMP=ROOT/"docs/design/equity-uprise-development/competency-catalog.json"
LABS=ROOT/"docs/design/equity-uprise-building/production/electronics/generated/equity-uprise-it-lab-catalog-v1.json"
F1=ROOT/"docs/design/equity-uprise-building/production/floor-01/floor-01-digital-twin-program.json"
EVID=ROOT/"docs/design/equity-uprise-development/EVIDENCE-ASSESSMENT-ARCHITECTURE.md"
RUB=ROOT/"docs/design/equity-uprise-development/competency-rubrics.json"

def load(p): return json.loads(p.read_text())
def fail(msg): raise SystemExit("FEDERAL TRAINING CATALOG: FAIL\n"+msg)

cat=load(CAT); bind=load(BIND); comp=load(COMP); labs=load(LABS); f1=load(F1)
records=cat.get("records",[])
ids=[x["course_id"] for x in records]
if len(ids)!=len(set(ids)): fail("duplicate course_id")
by_id={x["course_id"]:x for x in records}
allowed_status={"canonical_active","canonical_annual_revalidation","candidate_selection_required","reference_only"}
if any(x.get("status") not in allowed_status for x in records): fail("unknown catalog status")
allowed_domains=("training.fema.gov","apps.irs.gov","irs.gov","www.hhs.gov","hhs.gov","www.cisa.gov","cisa.gov","www.energy.gov","energy.gov","www.coast.noaa.gov","coast.noaa.gov","www.earthdata.nasa.gov","earthdata.nasa.gov","www.osha.gov","osha.gov","www.fhwa.dot.gov","fhwa.dot.gov")
for r in records:
    u=urlparse(r.get("official_url",""))
    if u.scheme!="https" or u.netloc not in allowed_domains: fail(f"non-federal/unapproved URL for {r['course_id']}: {r.get('official_url')}")
    for p in r.get("prerequisites",[]):
        if p not in by_id: fail(f"unknown prerequisite {p} for {r['course_id']}")
    if r["status"].startswith("canonical") and not r.get("award_type"): fail(f"canonical training missing award semantics: {r['course_id']}")
    if r["status"]=="reference_only" and r.get("award_type"): fail(f"reference-only record claims award: {r['course_id']}")
    if r["status"]=="canonical_annual_revalidation":
        if r.get("revalidation_cadence")!="annual" or r.get("reverify_before_enrollment") is not True: fail(f"annual revalidation contract incomplete: {r['course_id']}")

comp_ids={x["id"] for x in comp.get("competencies",[])}
lab_ids={x["lab_id"] for x in labs.get("labs",[])}
scenario_ids={x["id"] for x in f1.get("scenarios",[])}
mode_ids={x["id"] for x in f1.get("operating_modes",[])}
seen=set()
for b in bind.get("bindings",[]):
    cid=b.get("course_id")
    if cid not in by_id: fail(f"binding references unknown course {cid}")
    if cid in seen: fail(f"duplicate binding for {cid}")
    seen.add(cid)
    rec=by_id[cid]
    if b.get("activation_state")=="active" and rec["status"] not in {"canonical_active","canonical_annual_revalidation"}:
        fail(f"non-canonical course activated: {cid}")
    if b.get("activation_state")!="active" and rec["status"] in {"canonical_active","canonical_annual_revalidation"}:
        fail(f"canonical course unexpectedly non-active: {cid}")
    bad=[x for x in b.get("competency_ids",[]) if x not in comp_ids]
    if bad: fail(f"{cid} unknown competency IDs: {bad}")
    bad=[x for x in b.get("electronics_lab_ids",[]) if x not in lab_ids]
    if bad: fail(f"{cid} unknown electronics lab IDs: {bad}")
    bad=[x for x in b.get("floor1_scenario_ids",[]) if x not in scenario_ids]
    if bad: fail(f"{cid} unknown Floor1 scenarios: {bad}")
    bad=[x for x in b.get("floor1_operating_modes",[]) if x not in mode_ids]
    if bad: fail(f"{cid} unknown Floor1 modes: {bad}")
    if not b.get("safety_boundary"): fail(f"{cid} missing safety boundary")

required={"FEMA-IS-100-C","FEMA-IS-120-C","FEMA-IS-130-A","FEMA-IS-200-C","FEMA-IS-201-A","FEMA-IS-235-C","FEMA-IS-238","IRS-VITA-LINK-LEARN-2025","HHS-OHRP-HRP-FOUNDATIONAL","HHS-OHRP-INFORMED-CONSENT"}
if not required.issubset(seen): fail("missing active canonical binding(s): "+", ".join(sorted(required-seen)))
if "FEMA ICS-100" in EVID.read_text(): fail("stale FEMA ICS-100 label remains in evidence authority")
rub=RUB.read_text()
for stale in ("CISA or comparable federal training","NOAA/NASA or comparable training","DOE/EPA or comparable work"):
    if stale in rub: fail("stale broad federal-training rubric phrase remains: "+stale)
print("FEDERAL TRAINING CATALOG: PASS")
print(" catalog records:",len(records))
print(" active canonical:",sum(1 for x in records if x["status"] in {"canonical_active","canonical_annual_revalidation"}))
print(" candidates:",sum(1 for x in records if x["status"]=="candidate_selection_required"))
print(" reference-only:",sum(1 for x in records if x["status"]=="reference_only"))
print(" building bindings:",len(bind.get("bindings",[])))
