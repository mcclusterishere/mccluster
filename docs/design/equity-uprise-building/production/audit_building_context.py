#!/usr/bin/env python3
"""Audit the Equity Uprise building context/index before any building work."""
from __future__ import annotations
import argparse, json, re, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[4]
BUILDING=ROOT/"docs/design/equity-uprise-building"
INDEX=BUILDING/"BUILDING-FILE-INDEX.json"
BROOT="docs/design/equity-uprise-building/"
EXTERNAL_AUTHORITY={
    "docs/design/EQUITY-UPRISE-REPO-AUDIT.md",
    "docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md",
}
WORKFLOWS={
    ".github/workflows/equity-uprise-core-v2-ci.yml",
    ".github/workflows/deploy-pages.yml",
}
AGENT_ENTRYPOINTS={
    "AGENTS.md","CLAUDE.md","CODEX.md","GEMINI.md",
    ".cursorrules",".github/copilot-instructions.md",
}
VIEWER_RE=re.compile(r"^equity-uprise-(?:building-core-v2|floor-0[1-7])-3d\.html$")
CONTEXT_NAMES={
    "AGENTS.md","README.md","MASTER-INDEX.md","PROJECT-STATE.md",
    "HISTORICAL-REFERENCE-BUILDS.md","BUILD-PIPELINE.md","BUILDING-FILE-INDEX.json",
}

def git_files():
    out=subprocess.check_output(["git","ls-files"],cwd=ROOT,text=True)
    return sorted(x for x in out.splitlines() if x)

def relevant(p:str)->bool:
    return (
        p.startswith(BROOT) or p in EXTERNAL_AUTHORITY or p in WORKFLOWS
        or p in AGENT_ENTRYPOINTS or bool(VIEWER_RE.match(p))
    )

def category(p:str)->str:
    if p in AGENT_ENTRYPOINTS:return "agent_entrypoints"
    if p in WORKFLOWS:return "workflows"
    if VIEWER_RE.match(p):return "public_viewers"
    if p in EXTERNAL_AUTHORITY:return "external_authority"
    if p.startswith(BROOT):
        rel=p[len(BROOT):]
        if rel in CONTEXT_NAMES:return "context"
        if rel.startswith("production/generated/"):return "generated_artifacts"
        if rel.startswith("references/archive/"):return "historical_references"
        if rel.startswith("references/"):return "active_references"
        if rel.startswith("production/"):return "production_source"
        return "authority"
    return "other"

def discover():
    return sorted(p for p in git_files() if relevant(p))

def index_payload(paths):
    cats={}
    for p in paths:cats.setdefault(category(p),[]).append(p)
    return {
      "schema_version":"1.0.0",
      "purpose":"Exhaustive navigation index for all tracked Equity Uprise building/spatial files and required external entrypoints. Generated/validated by production/audit_building_context.py.",
      "discovery_rules":{
        "building_root":BROOT,
        "external_authority":sorted(EXTERNAL_AUTHORITY),
        "public_viewer_regex":VIEWER_RE.pattern,
        "workflows":sorted(WORKFLOWS),
        "agent_entrypoints":sorted(AGENT_ENTRYPOINTS),
      },
      "tracked_count":len(paths),
      "categories":{k:sorted(v) for k,v in sorted(cats.items())},
      "historical_reference_commits":[
        {"sha":"59af7f6386ee69edc023927971ea5918fffa6acc","role":"V1 Floor 1 deterministic GLB generator"},
        {"sha":"752c70444e12f44abdeacdd19697f7db88937d44","role":"V1 Floor 1 interactive interior viewer"},
        {"sha":"c674e07daf772ea739d93cc515657deb028e8b75","role":"Core V2 combined whole-building generator"},
        {"sha":"ef3fd47d543318fd3ed129fa3f58fc7fab5fabce","role":"Historical 667-mesh assembled Core V2 building GLB"},
        {"sha":"7ea458406cc862656b5952a350fe87bcdc16110b","role":"Historical fully stacked whole-building interactive viewer"},
      ],
    }

def flatten(payload):
    return sorted(p for values in payload.get("categories",{}).values() for p in values)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--write",action="store_true",help="rewrite BUILDING-FILE-INDEX.json from tracked files")
    args=ap.parse_args()
    paths=discover()
    if args.write:
        INDEX.write_text(json.dumps(index_payload(paths),indent=2)+"\n")
        print(f"Wrote {INDEX.relative_to(ROOT)} with {len(paths)} tracked building-context files.")
        return 0
    if not INDEX.exists():
        print("FAIL: missing BUILDING-FILE-INDEX.json",file=sys.stderr);return 1
    payload=json.loads(INDEX.read_text())
    indexed=flatten(payload)
    failures=[]
    if indexed!=paths:
        missing=sorted(set(paths)-set(indexed))
        stale=sorted(set(indexed)-set(paths))
        if missing:failures.append("UNINDEXED tracked files:\n  " + "\n  ".join(missing))
        if stale:failures.append("STALE indexed files:\n  " + "\n  ".join(stale))
    if payload.get("tracked_count")!=len(indexed):
        failures.append(f"tracked_count={payload.get('tracked_count')} but index contains {len(indexed)} paths")
    required=[
      "docs/design/equity-uprise-building/AGENTS.md",
      "docs/design/equity-uprise-building/README.md",
      "docs/design/equity-uprise-building/MASTER-INDEX.md",
      "docs/design/equity-uprise-building/PROJECT-STATE.md",
      "docs/design/equity-uprise-building/HISTORICAL-REFERENCE-BUILDS.md",
      "docs/design/equity-uprise-building/BUILD-PIPELINE.md",
      "docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md",
    ]
    for p in required:
        if p not in indexed:failures.append(f"required context file is not indexed: {p}")
        if not (ROOT/p).exists():failures.append(f"required context file is missing: {p}")
    root_agents=(ROOT/"AGENTS.md").read_text(errors="ignore")
    if "docs/design/equity-uprise-building/AGENTS.md" not in root_agents:
        failures.append("root AGENTS.md does not point agents to the local Equity Uprise building AGENTS.md")
    state=(BUILDING/"PROJECT-STATE.md").read_text(errors="ignore")
    for marker in ["## End goal","## NEXT APPROVED WORK","## Whole-building assembly","## Floor 1"]:
        if marker not in state:failures.append(f"PROJECT-STATE.md missing marker: {marker}")
    if failures:
        print("EQUITY UPRISE BUILDING CONTEXT AUDIT: FAIL",file=sys.stderr)
        for f in failures:print("\n"+f,file=sys.stderr)
        print("\nRun with --write after intentionally adding/moving/removing building files.",file=sys.stderr)
        return 1
    print("EQUITY UPRISE BUILDING CONTEXT AUDIT: PASS")
    print(f"Indexed {len(indexed)} tracked files across {len(payload.get('categories',{}))} categories.")
    for k,v in sorted(payload.get("categories",{}).items()):print(f"  {k}: {len(v)}")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
