#!/usr/bin/env python3
"""
Repo-wide Equity Uprise source coverage validator.

This intentionally scans both paths AND file contents across the checked-out
repository so generic/shared files cannot escape classification merely because
their filenames do not begin with "eu-" or "equity-uprise".

A discovered source must be either:
  1. mapped to one or more canonical building capabilities; or
  2. explicitly classified support-only.

This validates repository-to-building semantic coverage. It does not validate
political claims, building-code compliance, or real-world construction.
"""
from pathlib import Path
import json, re, sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE_MAP = json.loads((HERE / "equity-uprise-repo-source-map-v2.json").read_text())
CAP_MAP = json.loads((HERE / "equity-uprise-capability-map-v2.json").read_text())

TEXT_EXTS = {
    "", ".html", ".htm", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".json", ".md", ".sql", ".sh", ".yml", ".yaml", ".toml", ".txt",
    ".csv", ".xml", ".css", ".py"
}
SKIP_PREFIXES = (
    ".git/",
    "docs/design/equity-uprise-building/",
)
SKIP_EXACT = {
    "docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md",
    "docs/design/EQUITY-UPRISE-REPO-AUDIT.md",
    "equity-uprise-building-core-v2-3d.html",
}
CONTENT_PATTERNS = [
    re.compile(r"equity[ _-]+uprise", re.I),
    re.compile(r"\beu_[a-z0-9_]+\b", re.I),
    re.compile(r"\beu-[a-z0-9][a-z0-9-]*\b", re.I),
]

# Shared sources can materially define an Equity Uprise capability even when
# they do not repeat the program name literally.
MANUAL_CANDIDATES = {
    "docs/music-platform.md",
}

def readable_text(path: Path) -> str:
    try:
        # Audit source/code/docs, not binaries or giant generated payloads.
        if path.suffix.lower() not in TEXT_EXTS:
            return ""
        if path.stat().st_size > 2_000_000:
            return ""
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

def is_candidate(rel: str, text: str) -> bool:
    if rel.startswith(SKIP_PREFIXES) or rel in SKIP_EXACT:
        return False

    low = rel.lower()
    base = low.split("/")[-1]

    # Strong path signals.
    if "equity-uprise" in low or "equity_uprise" in low:
        return True
    if base.startswith(("eu-", "eu_")):
        return True
    if rel.startswith("supabase/functions/eu-"):
        return True

    # Strong content signals, including generic/shared filenames.
    return any(p.search(text) for p in CONTENT_PATTERNS)

discovered = []
for p in ROOT.rglob("*"):
    if not p.is_file():
        continue
    rel = p.relative_to(ROOT).as_posix()
    text = readable_text(p)
    if is_candidate(rel, text) or rel in MANUAL_CANDIDATES:
        discovered.append(rel)
discovered = sorted(set(discovered))

entries = SOURCE_MAP.get("entries", [])
mapped_paths = [e.get("path", "") for e in entries]
known_caps = {c["id"] for c in CAP_MAP.get("capabilities", [])}

checks = []
def check(name, passed, detail=""):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})

check(
    "source-map paths unique",
    len(mapped_paths) == len(set(mapped_paths)),
    f"{len(mapped_paths)} entries",
)
check(
    "repo-wide discovered source set exactly classified",
    set(discovered) == set(mapped_paths),
    json.dumps(
        {
            "missing_from_map": sorted(set(discovered) - set(mapped_paths)),
            "stale_in_map": sorted(set(mapped_paths) - set(discovered)),
        }
    ),
)

for entry in entries:
    path = entry.get("path", "")
    ids = entry.get("capability_ids", [])
    support_only = entry.get("support_only") is True
    unknown = [x for x in ids if x not in known_caps]

    check(f"{path} capability ids known", not unknown, ", ".join(unknown))
    check(
        f"{path} classified",
        bool(ids) or support_only,
        f"classification={entry.get('classification')!r}",
    )
    check(
        f"{path} support-only semantics coherent",
        not (support_only and ids),
        "support-only sources must not also claim capability ownership",
    )
    if support_only:
        check(
            f"{path} support rationale present",
            bool(str(entry.get("rationale", "")).strip()),
        )

failed = [x for x in checks if not x["passed"]]
report = {
    "schema_version": "2.0.0",
    "scope": "Repo-wide Equity Uprise source-to-building-capability coverage",
    "candidate_count": len(discovered),
    "capability_source_count": sum(1 for e in entries if e.get("capability_ids")),
    "support_only_count": sum(1 for e in entries if e.get("support_only") is True),
    "checks_total": len(checks),
    "checks_passed": len(checks) - len(failed),
    "checks_failed": len(failed),
    "passed": not failed,
    "discovered_paths": discovered,
    "checks": checks,
}
out = HERE / "generated" / "equity-uprise-repo-source-coverage-report.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(report, indent=2) + "\n")

print(json.dumps({
    "candidate_count": report["candidate_count"],
    "capability_source_count": report["capability_source_count"],
    "support_only_count": report["support_only_count"],
    "checks_total": report["checks_total"],
    "checks_passed": report["checks_passed"],
    "checks_failed": report["checks_failed"],
    "passed": report["passed"],
}, indent=2))

if failed:
    for item in failed:
        print("FAIL:", item["name"], item["detail"], file=sys.stderr)
    sys.exit(1)
