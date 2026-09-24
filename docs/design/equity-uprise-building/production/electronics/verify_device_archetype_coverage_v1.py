#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
import build_device_archetype_coverage_v1 as coverage

HERE=Path(__file__).resolve().parent
OUT=HERE/"generated/equity-uprise-device-archetype-coverage-v1.json"
ARCH=HERE/"device-archetypes-v1.json"
REP=HERE/"generated/equity-uprise-electronics-step4a-report.json"

def load(path): return json.loads(Path(path).read_text())
def fail(message): raise SystemExit("EQUITY UPRISE STEP 4C PHYSICAL MATURITY COVERAGE: FAIL\n"+message)

actual=load(OUT)
expected=coverage.build_coverage()
arch=load(ARCH)
rep=load(REP)
contract=arch.get("coverage_contract",{})
order=contract.get("maturity_order",[])

if actual!=expected: fail("generated coverage report is stale; run build_device_archetype_coverage_v1.py")
if actual.get("status")!="step4c-physical-maturity-coverage": fail("unexpected coverage status")
if actual.get("passed") is not True: fail("coverage authority has missing or invalid entries")
summary=actual.get("summary",{})
if summary.get("missing_archetype_entries"): fail("installed physical asset type lacks an archetype")
if summary.get("invalid_expectation_entries"): fail("archetype expectation contract is incomplete")

rows=actual.get("rows",[])
if len(rows)!=summary.get("coverage_rows"): fail("coverage row count mismatch")
required=contract.get("required_expectation_fields",[])
for row in rows:
    key=row.get("coverage_key")
    entry=arch.get("archetypes",{}).get(key)
    if not entry: fail(f"{key} missing from archetype authority")
    for field in required:
        if not isinstance(row.get(field),list) or not row.get(field):
            fail(f"{key} missing required {field}")
    current=row.get("current_maturity")
    minimum=row.get("minimum_ci_maturity")
    target=row.get("target_maturity")
    if current not in order or minimum not in order or target not in order:
        fail(f"{key} uses unknown maturity level")
    if order.index(current)<order.index(minimum):
        fail(f"{key} maturity regressed below CI floor: {current} < {minimum}")
    should_complete=order.index(current)>=order.index(target)
    if (row.get("coverage_status")=="complete") != should_complete:
        fail(f"{key} completion status disagrees with maturity")
    if not isinstance(row.get("october_demo_required"),bool):
        fail(f"{key} missing october_demo_required boolean")

# Camera remains the Step 4C reference implementation. Its count is always
# derived from the generated electronics report rather than hard-coded.
camera=next((x for x in rows if x.get("coverage_key")=="camera"),None)
if not camera: fail("camera coverage row missing")
if camera.get("instance_count")!=int(rep.get("new_asset_type_counts",{}).get("camera",0)):
    fail("camera coverage count does not match generated electronics population")
if camera.get("current_maturity")!="lab_complete":
    fail("camera reference archetype must remain lab_complete")
for part in ("MOUNT_PLATE","BRACKET_ARM","HOUSING","LENS_BARREL","LENS_GLASS","IR_LED_RING","STATUS_LED","RJ45_POE_PORT","CABLE_ENTRY"):
    if part not in camera.get("expected_components",[]): fail(f"camera expectation missing {part}")
if "RJ45_POE_PORT" not in camera.get("expected_ports",[]): fail("camera expectation missing RJ45/PoE port")

print("EQUITY UPRISE STEP 4C PHYSICAL MATURITY COVERAGE: PASS")
print(" tracked coverage rows:",summary["coverage_rows"])
print(" current complete rows:",summary["complete_rows"])
print(" current incomplete rows:",summary["incomplete_rows"])
print(" october demo incomplete rows:",summary["october_demo_incomplete_rows"])
if actual.get("incomplete_coverage_keys"):
    print(" incomplete:",", ".join(actual["incomplete_coverage_keys"]))
