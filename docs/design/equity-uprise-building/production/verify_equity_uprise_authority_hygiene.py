#!/usr/bin/env python3
from pathlib import Path
import json, re, sys
HERE=Path(__file__).resolve().parent;BUILDING=HERE.parent;ROOT=HERE.parents[3];GENERATED=HERE/"generated"
sys.path.insert(0,str(HERE))
from audit_building_context import AGENT_ENTRYPOINTS
canonical_f1=BUILDING/"FLOOR-01-ARRIVAL-ORIENTATION-INTAKE-360-SPEC.md";canonical_b1=BUILDING/"BASEMENT-B1-UNDERGROUND-OPERATIONS-PROGRAM.md";stub_f1=BUILDING/"FLOOR-01-LOBBY-INTAKE-360-SPEC.md";stub_b1=BUILDING/"BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md"
rel=lambda p:p.relative_to(ROOT).as_posix()
checks=[]
def check(name,passed,detail=""): checks.append({"name":name,"passed":bool(passed),"detail":detail})
check("canonical Floor 1 authority exists",canonical_f1.exists(),rel(canonical_f1));check("canonical B1 authority exists",canonical_b1.exists(),rel(canonical_b1))
check("deprecated Floor 1 path is stub",stub_f1.exists() and "DEPRECATED COMPATIBILITY PATH" in stub_f1.read_text(),rel(stub_f1));check("deprecated B1 path is stub",stub_b1.exists() and "DEPRECATED COMPATIBILITY PATH" in stub_b1.read_text(),rel(stub_b1))
# Pointer model: every agent entry file (the root law plus every vendor adapter) sends building work to the local
# contract and REFERENCE-AUTHORITY.md. Program status, per-floor file lists and the deprecated Floor 1 path never
# live in an entry file; AGENTS.md may cite Floor 1 only by its canonical authority.
ENTRYPOINTS=sorted(set(AGENT_ENTRYPOINTS)|{".cursor/rules/mccluster.mdc",".github/instructions/mccluster.instructions.md"})
STALE=("locked six-floor","architecture/equity-uprise-core-v2","only Floor 1 is currently program-reconciled","remain provisional until",stub_f1.name,stub_b1.name)
for agent in ENTRYPOINTS:
    txt=(ROOT/agent).read_text(errors="ignore")
    for old in STALE: check(f"{agent} no stale authority wording :: {old}",old not in txt,old)
    check(f"{agent} points to REFERENCE-AUTHORITY.md","docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md" in txt)
    check(f"{agent} points to the local building contract","docs/design/equity-uprise-building/AGENTS.md" in txt)
    if agent=="AGENTS.md":
        cited=sorted(set(re.findall(r"FLOOR-01-[A-Z0-9-]+-360-SPEC\.md",txt)))
        check("AGENTS.md Floor 1 citation is the canonical authority",set(cited)<={canonical_f1.name},", ".join(cited) or "none")
        check("AGENTS.md B1 sandbox boundary","sandboxed clone" in txt and "B1" in txt)
    else:
        check(f"{agent} carries no per-floor file list","FLOOR-0" not in txt)
# Generated reports are evidence outputs, not active authority inputs; exclude them from recursive stale-reference scanning.
intentional_compatibility_checkers={
    HERE/"verify_equity_uprise_authority_hygiene.py",
    HERE/"verify_floor_01_b1_simulation.py",
}
control_metadata={BUILDING/"BUILDING-FILE-INDEX.json"}
for p in sorted(BUILDING.rglob("*"), key=lambda path: path.as_posix()):
    if not p.is_file() or p.suffix.lower() not in {".md",".json",".py"} or "references/archive" in p.as_posix() or GENERATED in p.parents or p in {stub_f1,stub_b1} or p in intentional_compatibility_checkers or p in control_metadata: continue
    txt=p.read_text(errors="ignore")
    for old in ("FLOOR-01-LOBBY-INTAKE-360-SPEC.md","BASEMENT-B1-TECHNICAL-SERVICE-PROGRAM.md"): check(f"no deprecated authority ref: {p.relative_to(ROOT)} :: {old}",old not in txt,old)
programs=json.loads((HERE/"core-v2-floor-programs.json").read_text())
levels={x["level"]:x for x in programs["levels"]}
for n in range(1,8):
    level=levels[n]
    label=f"Floor {n}" if n<=6 else "Level 7"
    check(f"{label} reconciled",level.get("design_maturity")=="reconciled-current-iterative-pass",str(level.get("design_maturity")))

failed=[x for x in checks if not x["passed"]];report={"schema_version":"1.0.0","scope":"Equity Uprise active authority hygiene","checks_total":len(checks),"checks_passed":len(checks)-len(failed),"checks_failed":len(failed),"passed":not failed,"checks":checks}
GENERATED.mkdir(exist_ok=True);(GENERATED/"equity-uprise-authority-hygiene-report.json").write_text(json.dumps(report,indent=2)+"\n");print(json.dumps({k:report[k] for k in ("checks_total","checks_passed","checks_failed","passed")},indent=2))
if failed:
    [print("FAIL:",x["name"],x["detail"],file=sys.stderr) for x in failed];sys.exit(1)
