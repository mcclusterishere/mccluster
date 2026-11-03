#!/usr/bin/env python3
"""Verify LEARNING-PATHWAYS.json and INDUSTRY-CERTIFICATION-MAP.json against the catalog, packs and PRIM3 objective ledgers."""
from __future__ import annotations
import json, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3]
def load(p): return json.loads(Path(p).read_text())
def fail(msg): raise SystemExit("LEARNING PATHWAYS: FAIL\n" + msg)

cat = load(HERE / "FEDERAL-TRAINING-CATALOG.json")
ind = load(HERE / "INDUSTRY-CERTIFICATION-MAP.json")
pw = load(HERE / "LEARNING-PATHWAYS.json")
labs = load(ROOT / "docs/design/equity-uprise-building/production/electronics/generated/equity-uprise-it-lab-catalog-v1.json")
f1 = load(ROOT / "docs/design/equity-uprise-building/production/floor-01/floor-01-digital-twin-program.json")
aplus = load(ROOT / "docs/prim3/APLUS-PRECURSOR-MAP.json")
netplus = load(ROOT / "docs/prim3/NETWORK-PLUS-TOPIC-LEDGER.json")
secplus = load(ROOT / "docs/prim3/SECURITY-PLUS-TOPIC-LEDGER.json")
CLAIM = re.compile(r"(?i)\bcertified\b|\bearn(?:s|ed)? (?:your|a|the) (?:fema|cisa|comptia|irs|bicsi)\b|\bcertificate (?:is )?issued here\b")

# ---- industry map ----
if ind.get("credential_is_not_competency") is not True: fail("industry map must keep credential/competency separate")
certs = {c["cert_id"]: c for c in ind["certifications"]}
for c in certs.values():
    if "federal" in c["issuer_type"].lower() and "not federal" not in c["issuer_type"].lower(): fail(f"{c['cert_id']} must not be presented as federal")
    if not c["official_url"].startswith("https://"): fail(f"{c['cert_id']} needs an https issuer URL")
sec = certs["COMPTIA-SECPLUS"]
if sec.get("exam_transition", {}).get("next_version") != "V8" or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", sec["exam_transition"].get("expected_launch", "")):
    fail("Security+ V8 transition must be flagged with an expected date")
objectives = {
    ("COMPTIA-APLUS", "220-1201"): set(aplus["exams"][0]["objectives"]),
    ("COMPTIA-APLUS", "220-1202"): set(aplus["exams"][1]["objectives"]),
    ("COMPTIA-NETPLUS", "N10-009"): set(netplus["objectives"]),
    ("COMPTIA-SECPLUS", "SY0-701"): set(secplus["objectives"]),
}
for c in certs.values():
    for e in c["exams"]:
        if "domains" in e: objectives[(c["cert_id"], e["exam_code"])] = set(e["domains"])
lab_ids = {l["lab_id"] for l in labs["labs"]}
mapped = {m["lab_id"] for m in ind["lab_alignments"]}
if mapped != lab_ids: fail(f"every IT lab must be mapped exactly once; missing {sorted(lab_ids - mapped)} extra {sorted(mapped - lab_ids)}")
def check_alignments(owner, alignments):
    if not alignments: fail(f"{owner} has no alignment")
    for a in alignments:
        key = (a["cert_id"], a["exam_code"])
        if key not in objectives: fail(f"{owner} cites unknown exam {key}")
        bad = set(a["objectives"]) - objectives[key]
        if bad: fail(f"{owner} cites unknown objectives {sorted(bad)} for {key}")
for m in ind["lab_alignments"]: check_alignments(m["lab_id"], m["alignments"])
f1_scenarios = {s["id"] for s in f1["scenarios"]}
for s in ind["scenario_alignments"]:
    if s["scenario_id"] not in f1_scenarios: fail(f"unknown scenario {s['scenario_id']}")
    check_alignments(s["scenario_id"], s["alignments"])
for need in ("COMPTIA-APLUS", "COMPTIA-NETPLUS", "COMPTIA-SECPLUS", "COMPTIA-SERVERPLUS", "BICSI-INST1"):
    if not any(a["cert_id"] == need for m in ind["lab_alignments"] for a in m["alignments"]): fail(f"{need} maps no lab")

# ---- pathways ----
if not re.fullmatch(r"\d+\.\d+\.\d+", pw.get("pathways_version", "")): fail("pathways must be versioned")
records = {r["catalog_id"]: r for r in cat["records"]}
programs = {p["program_id"]: p for p in cat.get("credential_programs", [])}
retired = {x["course_code"] for x in cat.get("retired_do_not_cite", [])}
pack_ids = {}
for pid, spec in pw["packs"].items():
    data = load(ROOT / spec["file"])
    items = data.get(spec.get("list_field", "scenarios"), [])
    pack_ids[pid] = {x[spec["id_field"]] for x in items}
    if not data.get(spec["version_field"]): fail(f"pack {pid} has no {spec['version_field']}")
expected = ["building-safety-basics", "exercise-evaluator", "incident-command-building-ops", "community-responder",
            "it-support-network-security", "building-ot-cyber", "public-service-intake"]
if [p["pathway_id"] for p in pw["pathways"]] != expected: fail("the seven pathways are missing or out of order")
def check_unlock(owner, u):
    if u["pack_id"] not in pack_ids: fail(f"{owner} unlocks unknown pack {u['pack_id']}")
    if u["scenario_id"] not in pack_ids[u["pack_id"]]: fail(f"{owner} unlocks unknown scenario {u['pack_id']}/{u['scenario_id']}")
for p in pw["pathways"]:
    ids = [s["step_id"] for s in p["steps"]]
    if len(ids) != len(set(ids)): fail(f"{p['pathway_id']} duplicate step IDs")
    for u in p.get("open_unlocks", []): check_unlock(p["pathway_id"], u)
    for i, s in enumerate(p["steps"]):
        for r in s["requires"]:
            if r not in ids[:i]: fail(f"{p['pathway_id']}/{s['step_id']} requires a later or unknown step {r}")
        for u in s["unlocks"]: check_unlock(s["step_id"], u)
        ev = s["evidence_required"]
        if s["kind"] == "official_course":
            cid = s["catalog_id"]
            if cid in records:
                r = records[cid]
                if s["official_url"] != r["official_url"]: fail(f"{s['step_id']} URL drifted from the catalog")
                if (r["course_code"] or "") in retired: fail(f"{s['step_id']} uses a retired course")
                if cid.startswith("IRS-VITA-") and not r.get("refresh_due"): fail(f"{cid} must carry its refresh flag")
            elif cid in programs:
                if s["official_url"] != programs[cid]["official_url"]: fail(f"{s['step_id']} URL drifted")
            elif cid in certs:
                if s["official_url"] != certs[cid]["official_url"]: fail(f"{s['step_id']} URL drifted")
            else:
                fail(f"{s['step_id']} cites unknown catalog ID {cid}")
            if ev["type"] != "external_credential" or ev["catalog_id"] != cid: fail(f"{s['step_id']} evidence must be the uploaded credential")
            if not s["learner_copy"].startswith("Prepares you for"): fail(f"{s['step_id']} must say 'Prepares you for'")
        if s["kind"] == "drill":
            for sc in ev["scenarios"]: check_unlock(s["step_id"], sc)
        if s["kind"] == "reviewer" and ev.get("reviewer_required") is not True: fail(f"{s['step_id']} must need a human reviewer")
        if CLAIM.search(json.dumps(s)): fail(f"{s['step_id']} learner copy claims certification")
    if CLAIM.search(json.dumps({k: p[k] for k in ("title", "summary")})): fail(f"{p['pathway_id']} claims certification")
if "IS-139" in json.dumps(pw): fail("retired IS-139.A must never appear in a pathway")

print("LEARNING PATHWAYS: PASS")
print(" pathways:", len(pw["pathways"]))
print(" steps:", sum(len(p["steps"]) for p in pw["pathways"]))
print(" IT labs mapped:", len(mapped))
print(" industry certifications:", len(certs))
