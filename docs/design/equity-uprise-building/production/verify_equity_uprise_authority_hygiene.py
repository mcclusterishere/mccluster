#!/usr/bin/env python3
from pathlib import Path
import json, sys
HERE=Path(__file__).resolve().parent;BUILDING=HERE.parent;ROOT=HERE.parents[3];GENERATED=HERE/"generated"
canonical_f1=BUILDING/"FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md";canonical_b1=BUILDING/"BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md";stub_f1=BUILDING/"FLOOR-01-LOBBY-INTAKE-360-SPEC.md";stub_b1=BUILDING/"BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md"
checks=[]
def check(name,passed,detail=""): checks.append({"name":name,"passed":bool(passed),"detail":detail})
check("canonical Floor 1 authority exists",canonical_f1.exists(),str(canonical_f1));check("canonical B1 authority exists",canonical_b1.exists(),str(canonical_b1))
check("deprecated Floor 1 path is stub",stub_f1.exists() and "DEPRECATED COMPATIBILITY PATH" in stub_f1.read_text(),str(stub_f1));check("deprecated B1 path is stub",stub_b1.exists() and "DEPRECATED COMPATIBILITY PATH" in stub_b1.read_text(),str(stub_b1))
for agent in ("CLAUDE.md","CODEX.md","GEMINI.md"):
    txt=(ROOT/agent).read_text(errors="ignore");check(f"{agent} no locked six-floor wording","locked six-floor building inventory" not in txt);check(f"{agent} no old migration branch","architecture/equity-uprise-core-v2" not in txt);check(f"{agent} current Floor 1 authority","FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md" in txt);check(f"{agent} B1 sandbox boundary","sandboxed clone" in txt and "B1" in txt)
# Generated reports are evidence outputs, not active authority inputs; exclude them from recursive stale-reference scanning.
intentional_compatibility_checkers={
    HERE/"verify_equity_uprise_authority_hygiene.py",
    HERE/"verify_floor_01_b1_simulation.py",
}
control_metadata={BUILDING/"BUILDING-FILE-INDEX.json"}
for p in BUILDING.rglob("*"):
    if not p.is_file() or p.suffix.lower() not in {".md",".json",".py"} or "references/archive" in p.as_posix() or GENERATED in p.parents or p in {stub_f1,stub_b1} or p in intentional_compatibility_checkers or p in control_metadata: continue
    txt=p.read_text(errors="ignore")
    for old in ("FLOOR-01-LOBBY-INTAKE-360-SPEC.md","BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md"): check(f"no deprecated authority ref: {p.relative_to(ROOT)} :: {old}",old not in txt,old)
programs=json.loads((HERE/"core-v2-floor-programs.json").read_text());f1=next(x for x in programs["levels"] if x["level"]==1);f2=next(x for x in programs["levels"] if x["level"]==2);f3=next(x for x in programs["levels"] if x["level"]==3)
check("Floor 1 reconciled",f1.get("design_maturity")=="reconciled-current-iterative-pass",str(f1.get("design_maturity")));check("Floor 2 reconciled",f2.get("design_maturity")=="reconciled-current-iterative-pass",str(f2.get("design_maturity")));check("Floor 3 reconciled",f3.get("design_maturity")=="reconciled-current-iterative-pass",str(f3.get("design_maturity")));check("Floors 4-7 provisional",all(x.get("design_maturity")=="pre-iterative-program-rewrite" for x in programs["levels"] if x["level"]>=4))
failed=[x for x in checks if not x["passed"]];report={"schema_version":"1.0.0","scope":"Equity Uprise active authority hygiene","checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
GENERATED.mkdir(exist_ok=True);(GENERATED/"equity-uprise-authority-hygiene-report.json").write_text(json.dumps(report,indent=2)+"\n");print(json.dumps({k:report[k] for k in ("checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed:
    [print("FAIL:",x["name"],x["detail"],file=sys.stderr) for x in failed];sys.exit(1)
