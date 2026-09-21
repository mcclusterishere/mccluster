#!/usr/bin/env python3
"""
Fail if an Equity Uprise-specific repo source appears without either:
  1. one or more canonical building capability bindings; or
  2. an explicit support-only classification.

This validates repository-to-building semantic coverage. It does not validate
political claims, building-code compliance, or real-world construction.
"""
from pathlib import Path
import json, sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE_MAP = json.loads((HERE / "equity-uprise-repo-source-map-v2.json").read_text())
CAP_MAP = json.loads((HERE / "equity-uprise-capability-map-v2.json").read_text())

KNOWN_PAGES = {
    "equity-uprise.html",
    "equity-uprise-fellowship.html",
    "topics.html",
    "fellowships.html",
    "fellowship.html",
    "profile.html",
    "dashboard.html",
    "uprise-admin.html",
    "verify.html",
    "docket-516.html",
    "policy.html",
    "policy-memo-dna.html",
    "walls/eu-rally.html",
    "docs/equity-uprise-platform.md",
    "docs/music-platform.md",
}

def is_candidate(path: str) -> bool:
    if path.startswith("docs/design/equity-uprise-building/"):
        return False
    if path in {
        "docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md",
        "docs/design/EQUITY-UPRISE-REPO-AUDIT.md",
    }:
        return False
    if path.startswith(("redirects/", "_unfinished/", "docs/uprise-world/")):
        return False
    if path.startswith(".github/workflows/equity-uprise-"):
        return False
    if path == "equity-uprise-building-core-v2-3d.html":
        return False
    if path.startswith("equity-uprise-floor-") and path.endswith("-3d.html"):
        return False
    if path in KNOWN_PAGES:
        return True

    low = path.lower()
    parts = low.split("/")
    base = parts[-1]

    if "equity-uprise" in low or "equity_uprise" in low:
        return True
    if base.startswith("eu-") or base.startswith("eu_"):
        return True
    if path.startswith("supabase/functions/eu-"):
        return True
    if (
        path.startswith("supabase/migrations/")
        or path.startswith("supabase/replay_migrations/")
    ) and "equity_uprise" in low:
        return True
    return False

discovered = sorted(
    p.relative_to(ROOT).as_posix()
    for p in ROOT.rglob("*")
    if p.is_file() and ".git/" not in p.as_posix()
    and is_candidate(p.relative_to(ROOT).as_posix())
)

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
    "discovered source set exactly classified",
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
    "schema_version": "1.0.0",
    "scope": "Equity Uprise repo-source to building-capability coverage",
    "candidate_count": len(discovered),
    "capability_source_count": sum(
        1 for e in entries if e.get("capability_ids")
    ),
    "support_only_count": sum(
        1 for e in entries if e.get("support_only") is True
    ),
    "checks_total": len(checks),
    "checks_passed": len(checks) - len(failed),
    "checks_failed": len(failed),
    "passed": not failed,
    "checks": checks,
}
out = HERE / "generated" / "equity-uprise-repo-source-coverage-report.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(report, indent=2) + "\n")

print(
    json.dumps(
        {
            k: report[k]
            for k in (
                "candidate_count",
                "capability_source_count",
                "support_only_count",
                "checks_total",
                "checks_passed",
                "checks_failed",
                "passed",
            )
        },
        indent=2,
    )
)

if failed:
    for item in failed:
        print("FAIL:", item["name"], item["detail"], file=sys.stderr)
    sys.exit(1)
