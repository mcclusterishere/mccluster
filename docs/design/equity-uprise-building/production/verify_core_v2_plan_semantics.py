#!/usr/bin/env python3
"""
Validate generated Core V2 DXF/SVG/PNG plan references against the canonical
floor program. This is semantic/artifact validation, not building-code review.

NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import json, sys

HERE = Path(__file__).resolve().parent
BUILDING = HERE.parent
REFS = BUILDING / "references"
PROGRAM = json.loads((HERE / "core-v2-floor-programs.json").read_text())
B1 = json.loads((HERE / "basement-b1-program.json").read_text())
SITE = json.loads((HERE / "floor-01" / "floor-01-site-egress.json").read_text())
PLAN_LEVELS = [B1] + PROGRAM["levels"]
SITE_OUT_NAME = "equity-uprise-floor-01-site-egress-core-v2-schematic-v1"

OUT_NAMES = {
    0: "equity-uprise-basement-b1-core-v2-schematic-v1",
    1: "equity-uprise-floor-01-core-v2-schematic-v1",
    2: "equity-uprise-floor-02-public-forum-core-v2-schematic-v1",
    3: "equity-uprise-floor-03-fellowship-network-core-v2-schematic-v1",
    4: "equity-uprise-floor-04-media-culture-core-v2-schematic-v1",
    5: "equity-uprise-floor-05-policy-proof-core-v2-schematic-v1",
    6: "equity-uprise-floor-06-penthouse-command-core-v2-schematic-v1",
    7: "equity-uprise-level-07-roof-mobility-portal-core-v2-schematic-v1",
}

STALE_LABELS = [
    "LOBBY + INTAKE",
    "ARRIVAL / IDENTITY WALL",
    "ARRIVAL / ROUTING DIRECTORY",
    "VISITOR LOUNGE",
    "INTERVIEW ROOM A",
    "INTERVIEW ROOM B",
    "IDENTITY / OPPORTUNITY WALL",
    "MEMBER / INTERVIEW CHECK-IN",
    "MEDIA / IDENTITY WALL",
    "MEDIA CONTROL",
    "POLICY + PROOF WALL",
    "RESEARCH NAVIGATION",
    "NOW / PAST WORK / JOIN WALL",
    "FELLOWSHIP SUPPORT / RECORDS",
    "MEDIA / MUSIC IT",
    "RESEARCH / POLICY IT",
    "COMMAND SUPPORT / SECURE RECORDS",
    "OPERATIONS / SYSTEMS SUPPORT",
]

checks = []

def check(name, passed, detail=""):
    checks.append({"name": name, "passed": bool(passed), "detail": detail})

common = PROGRAM["common_support"]

def support_labels(level):
    if level.get("roof"):
        return ["MEP / ROOF SERVICES"]
    if level.get("basement"):
        return ["MEP / RISERS"]
    a, b = level["support_names"]
    return [
        "PUBLIC / SUPPORT CORRIDOR",
        "RESTROOM A",
        "RESTROOM B",
        a.upper(),
        b.upper(),
        "JANITOR",
        "MEP / RISERS",
    ]

core_labels = [
    "FREIGHT / SERVICE ELEVATOR",
    "STAIR B",
    "PASSENGER ELEVATOR",
    "STAIR A",
]

for level in PLAN_LEVELS:
    n = int(level["level"])
    floor_dir = (REFS / "basement-b1") if level.get("basement") else (REFS / f"floor-{n:02d}")
    base = OUT_NAMES[n]
    svg = floor_dir / f"{base}.svg"
    dxf = floor_dir / f"{base}.dxf"
    png = floor_dir / f"{base}.png"
    readme = floor_dir / "README.md"

    check(f"L{n} README exists",readme.exists(),str(readme))
    if readme.exists():
        readme_text=readme.read_text(errors="ignore")
        check(f"L{n} README authoritative title",level["title"] in readme_text,level["title"])
        check(f"L{n} README generated-only warning","generated-only" in readme_text.lower(),readme_text[:160])
        if level.get("basement"):
            check(f"L{n} README restricted support status","RESTRICTED CORE V2 PLAN REFERENCE" in readme_text,readme_text[:220])
        elif level.get("design_maturity")=="reconciled-current-iterative-pass":
            check(f"L{n} README active current-pass status","ACTIVE CORE V2 PLAN REFERENCE" in readme_text,readme_text[:220])
        else:
            check(f"L{n} README provisional program status","PROVISIONAL CORE V2 CHASSIS PLAN" in readme_text,readme_text[:220])
        expected_maturity=level.get("design_maturity","support-level" if level.get("basement") else "unspecified")
        check(f"L{n} README design maturity",expected_maturity in readme_text,expected_maturity)

    for p in (svg, dxf, png):
        check(f"L{n} {p.suffix} exists", p.exists(), str(p))

    if not (svg.exists() and dxf.exists() and png.exists()):
        continue

    svg_text = svg.read_text(errors="ignore")
    dxf_text = dxf.read_text(errors="ignore")

    title_prefix = "BASEMENT B1" if level.get("basement") else f"LEVEL {n:02d}"
    expected_title = f"EQUITY UPRISE — {title_prefix} — {level['title'].upper()}"
    check(f"L{n} SVG authoritative title", expected_title in svg_text, expected_title)
    check(f"L{n} DXF authoritative title", level["title"].upper() in dxf_text, level["title"].upper())

    if level.get("basement"):
        expected_status="RESTRICTED SUPPORT / UNDERGROUND OPERATIONS"
    elif level.get("design_maturity")=="reconciled-current-iterative-pass":
        expected_status="PROGRAM RECONCILED — BASIC RENDER READY"
    else:
        expected_status="PROGRAM PROVISIONAL — CHASSIS ONLY"
    check(f"L{n} SVG program-status watermark",expected_status in svg_text,expected_status)
    check(f"L{n} DXF program-status watermark",expected_status in dxf_text,expected_status)

    expected = [z["label"].upper() for z in level.get("zones", [])]
    expected += [s["label"].upper() for s in level.get("spheres", [])]
    expected += support_labels(level)
    expected += core_labels

    for label in sorted(set(expected)):
        check(
            f"L{n} SVG label {label}",
            label in svg_text,
        )
        check(
            f"L{n} DXF label {label}",
            label in dxf_text,
        )

    stale_svg = [x for x in STALE_LABELS if x in svg_text]
    stale_dxf = [x for x in STALE_LABELS if x in dxf_text]
    check(f"L{n} SVG has no stale labels", not stale_svg, ", ".join(stale_svg))
    check(f"L{n} DXF has no stale labels", not stale_dxf, ", ".join(stale_dxf))

    raw = png.read_bytes()
    check(
        f"L{n} PNG signature",
        raw[:8] == b"\x89PNG\r\n\x1a\n",
        f"bytes={len(raw)}",
    )
    check(f"L{n} PNG nontrivial size", len(raw) > 10000, f"bytes={len(raw)}")

    active = sorted(
        p.name
        for p in floor_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".dxf", ".svg", ".png"}
    )
    expected_active = [f"{base}.dxf", f"{base}.svg", f"{base}.png"]
    if n == 1:
        expected_active += [f"{SITE_OUT_NAME}.dxf", f"{SITE_OUT_NAME}.svg", f"{SITE_OUT_NAME}.png"]
        for label in ["STAIR A EXIT DISCHARGE","STAIR B EXIT DISCHARGE","SECURE SERVICE / DELIVERY ENTRANCE"]:
            check(f"L1 main SVG exterior opening {label}",label in svg_text,label)
            check(f"L1 main DXF exterior opening {label}",label in dxf_text,label)
    if level.get("basement"):
        marker="TO FUTURE UNDERGROUND NETWORK"
        check("B1 SVG tunnel continuation marker",marker in svg_text,marker)
        check("B1 DXF tunnel continuation marker",marker in dxf_text,marker)
    check(
        f"L{n} active generated plan set only",
        active == sorted(expected_active),
        json.dumps(active),
    )

manifest_path = REFS / "core-v2-plan-generation-manifest.json"
check("generation manifest exists", manifest_path.exists())
if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text())
    levels = [int(x["level"]) for x in manifest]
    check("generation manifest covers B1 and levels 1-7", levels == list(range(0, 8)), str(levels))
    for row in manifest:
        n = int(row["level"])
        expected_base = OUT_NAMES[n]
        expected_level = next(x for x in PLAN_LEVELS if int(x["level"]) == n)
        check(
            f"L{n} manifest title matches authority",
            row.get("title") == expected_level["title"],
            f"{row.get('title')} != {expected_level['title']}",
        )
        expected_maturity=expected_level.get("design_maturity","support-level" if expected_level.get("basement") else None)
        check(
            f"L{n} manifest maturity matches authority",
            row.get("design_maturity") == expected_maturity,
            f"{row.get('design_maturity')} != {expected_maturity}",
        )
        check(
            f"L{n} manifest render readiness matches authority",
            row.get("render_readiness") == expected_level.get("render_readiness"),
            f"{row.get('render_readiness')} != {expected_level.get('render_readiness')}",
        )
        files = row.get("files", {})
        check(
            f"L{n} manifest DXF points at Core V2",
            files.get("dxf", "").endswith(expected_base + ".dxf"),
            files.get("dxf", ""),
        )
        check(
            f"L{n} manifest SVG points at Core V2",
            files.get("svg", "").endswith(expected_base + ".svg"),
            files.get("svg", ""),
        )
        check(
            f"L{n} manifest PNG points at Core V2",
            files.get("png", "").endswith(expected_base + ".png"),
            files.get("png", ""),
        )
        if n == 1:
            site_files=row.get("site_plan_files",{})
            for ext in ("dxf","svg","png"):
                check(
                    f"L1 manifest site {ext.upper()} points at generated site plan",
                    site_files.get(ext,"").endswith(SITE_OUT_NAME + "." + ext),
                    site_files.get(ext,""),
                )
            check(
                "L1 manifest site authority",
                row.get("site_plan_authority")=="production/floor-01/floor-01-site-egress.json",
                str(row.get("site_plan_authority")),
            )

site_dir=REFS/"floor-01"
site_svg=site_dir/f"{SITE_OUT_NAME}.svg"
site_dxf=site_dir/f"{SITE_OUT_NAME}.dxf"
site_png=site_dir/f"{SITE_OUT_NAME}.png"
for p in (site_svg,site_dxf,site_png):
    check(f"Floor 1 site plan {p.suffix} exists",p.exists(),str(p))
if site_svg.exists() and site_dxf.exists():
    st=site_svg.read_text(errors="ignore"); dt=site_dxf.read_text(errors="ignore")
    required_site_labels=[
        "SOUTH PUBLIC WAY / STREET EDGE",
        "PUBLIC / ACCESSIBLE APPROACH",
        "EAST EXIT DISCHARGE WALK",
        "NORTH / REAR EXIT DISCHARGE WALK",
        "SECURE SERVICE / DELIVERY APRON",
        "ASSEMBLY AREA A",
        "ASSEMBLY AREA B",
        "STAIR A EXIT DISCHARGE",
        "STAIR B EXIT DISCHARGE",
        "SECURE SERVICE / DELIVERY ENTRANCE",
        "AED",
        "EMERGENCY TWO-WAY COMMUNICATION CONCEPT",
    ]
    for label in required_site_labels:
        check(f"Floor 1 site SVG label {label}",label in st,label)
        check(f"Floor 1 site DXF label {label}",label in dt,label)
if site_png.exists():
    raw=site_png.read_bytes()
    check("Floor 1 site PNG signature",raw[:8]==b"\x89PNG\r\n\x1a\n")
    check("Floor 1 site PNG nontrivial size",len(raw)>10000,f"bytes={len(raw)}")

sheet = REFS / "equity-uprise-core-v2-plan-contact-sheet.png"
check("contact sheet exists", sheet.exists())
if sheet.exists():
    raw = sheet.read_bytes()
    check("contact sheet PNG signature", raw[:8] == b"\x89PNG\r\n\x1a\n")
    check("contact sheet nontrivial size", len(raw) > 20000, f"bytes={len(raw)}")

failed = [x for x in checks if not x["passed"]]
report = {
    "schema_version": "1.0.0",
    "not_for_construction": True,
    "scope": "Core V2 generated plan semantic/artifact validation",
    "checks_total": len(checks),
    "checks_passed": len(checks) - len(failed),
    "checks_failed": len(failed),
    "passed": not failed,
    "checks": checks,
}
out = HERE / "generated" / "equity-uprise-core-v2-plan-semantics-report.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(report, indent=2) + "\n")

print(
    json.dumps(
        {
            k: report[k]
            for k in ("checks_total", "checks_passed", "checks_failed", "passed")
        },
        indent=2,
    )
)
if failed:
    for item in failed:
        print("FAIL:", item["name"], item["detail"], file=sys.stderr)
    sys.exit(1)
