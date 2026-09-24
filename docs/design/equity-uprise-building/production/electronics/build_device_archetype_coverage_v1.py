#!/usr/bin/env python3
from __future__ import annotations
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[5]
HERE=Path(__file__).resolve().parent
ARCH=HERE/"device-archetypes-v1.json"
REG=ROOT/"docs/design/equity-uprise-building/production/asset-registry/generated/equity-uprise-asset-registry-v1.json"
REP=HERE/"generated/equity-uprise-electronics-step4a-report.json"
CONN=HERE/"generated/equity-uprise-electronics-connections-v1.json"
OUT=HERE/"generated/equity-uprise-device-archetype-coverage-v1.json"

def load(path): return json.loads(Path(path).read_text())
def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,indent=2)+"\n")

def canonical_surface_archetype(asset, connected_ids, contract):
    aid=asset.get("asset_id")
    cls=asset.get("classification",{})
    if aid not in connected_ids or cls.get("registry_role")!="individual_physicalizable":
        return None
    category=str(cls.get("asset_type") or cls.get("source_category") or "").lower()
    if category not in set(contract.get("canonical_surface_source_categories",[])):
        return None
    label=str(asset.get("label") or aid or "").lower()
    # Prevent telecom language such as "lightning protection terminals" from
    # becoming a user-interface device simply because it contains "terminal".
    if category=="building_support" or "lightning protection" in label:
        return None
    if any(token in label for token in ("console","workstation connection","dashboard")):
        return "staff_console_surface"
    if category in {"interactive_terminal","terminal"}:
        return "interactive_terminal_surface"
    if category=="display":
        return "display_surface"
    if category=="equipment":
        if any(token in label for token in ("display","monitor","screen","surface","wall","globe")):
            return "display_surface"
        return None
    if category=="instrument" and "globe" in label:
        return "display_surface"
    if category=="furniture" and "console" in label:
        return "staff_console_surface"
    return None

def row_for(key,count,entry,scope,source_asset_types=None,source_asset_ids=None):
    target=entry.get("target_maturity","lab_complete")
    maturity=entry.get("maturity")
    order=["placeholder","recognizable","componentized","interactive","lab_complete"]
    complete=maturity in order and target in order and order.index(maturity)>=order.index(target)
    return {
        "coverage_key":key,
        "scope":scope,
        "instance_count":int(count),
        "display_name":entry.get("display_name"),
        "family":entry.get("family"),
        "current_maturity":maturity,
        "minimum_ci_maturity":entry.get("minimum_ci_maturity"),
        "target_maturity":target,
        "expected_components":entry.get("expected_components",[]),
        "expected_ports":entry.get("expected_ports",[]),
        "expected_state_behaviors":entry.get("expected_state_behaviors",[]),
        "expected_interactions":entry.get("expected_interactions",[]),
        "october_demo_required":bool(entry.get("october_demo_required",False)),
        "coverage_status":"complete" if complete else "incomplete",
        "source_asset_types":dict(sorted((source_asset_types or {}).items())),
        "source_asset_ids":sorted(source_asset_ids or []),
    }

def build_coverage():
    arch=load(ARCH)
    reg=load(REG)
    rep=load(REP)
    conn=load(CONN)
    contract=arch.get("coverage_contract",{})
    archetypes=arch.get("archetypes",{})
    excluded=set(contract.get("excluded_nonphysical_asset_types",[]))
    new_counts={k:int(v) for k,v in rep.get("new_asset_type_counts",{}).items() if k not in excluded}

    rows=[]
    missing=[]
    invalid=[]
    for asset_type,count in sorted(new_counts.items()):
        entry=archetypes.get(asset_type)
        if entry is None:
            missing.append(asset_type)
            continue
        rows.append(row_for(asset_type,count,entry,"step4b_installed_physical"))

    connected_ids=set()
    for link in conn.get("connections",[]):
        connected_ids.add(link.get("from_asset_id"))
        connected_ids.add(link.get("to_asset_id"))
    surface_assets=defaultdict(list)
    for asset in reg.get("assets",[]):
        key=canonical_surface_archetype(asset,connected_ids,contract)
        if key:
            surface_assets[key].append(asset)

    for key in contract.get("canonical_surface_archetypes",[]):
        assets=surface_assets.get(key,[])
        if not assets:
            continue
        entry=archetypes.get(key)
        if entry is None:
            missing.append(key)
            continue
        types=Counter(str(a.get("classification",{}).get("asset_type") or "unknown") for a in assets)
        rows.append(row_for(
            key,len(assets),entry,"canonical_connected_surface",
            source_asset_types=types,
            source_asset_ids=[a["asset_id"] for a in assets],
        ))

    required=contract.get("required_expectation_fields",[])
    order=contract.get("maturity_order",[])
    for row in rows:
        key=row["coverage_key"]
        entry=archetypes.get(key,{})
        for field in required:
            if not isinstance(entry.get(field),list) or not entry.get(field):
                invalid.append(f"{key}:{field}")
        if entry.get("maturity") not in order:
            invalid.append(f"{key}:maturity")
        if entry.get("minimum_ci_maturity") not in order:
            invalid.append(f"{key}:minimum_ci_maturity")
        if entry.get("target_maturity") not in order:
            invalid.append(f"{key}:target_maturity")

    rows=sorted(rows,key=lambda x:(x["family"] or "",x["coverage_key"]))
    incomplete=[x["coverage_key"] for x in rows if x["coverage_status"]!="complete"]
    demo_incomplete=[x["coverage_key"] for x in rows if x["october_demo_required"] and x["coverage_status"]!="complete"]
    physical_count=sum(new_counts.values())
    surface_count=sum(x["instance_count"] for x in rows if x["scope"]=="canonical_connected_surface")
    return {
        "schema_version":"1.0.0",
        "status":"step4c-physical-maturity-coverage",
        "source_registry_version":reg.get("registry_version"),
        "source_electronics_status":rep.get("status"),
        "archetype_authority":"docs/design/equity-uprise-building/production/electronics/device-archetypes-v1.json",
        "coverage_policy":"Exhaustive truthful tracking is CI-required; types may remain incomplete until their reusable archetype reaches lab_complete.",
        "summary":{
            "step4b_installed_physical_asset_types":len(new_counts),
            "step4b_installed_physical_instances":physical_count,
            "canonical_connected_surface_instances":surface_count,
            "coverage_rows":len(rows),
            "complete_rows":len(rows)-len(incomplete),
            "incomplete_rows":len(incomplete),
            "october_demo_incomplete_rows":len(demo_incomplete),
            "missing_archetype_entries":sorted(set(missing)),
            "invalid_expectation_entries":sorted(set(invalid)),
        },
        "incomplete_coverage_keys":incomplete,
        "october_demo_incomplete_coverage_keys":demo_incomplete,
        "rows":rows,
        "passed":not missing and not invalid,
    }

def main():
    report=build_coverage()
    write(OUT,report)
    print("EQUITY UPRISE STEP 4C PHYSICAL MATURITY COVERAGE:", "PASS" if report["passed"] else "FAIL")
    s=report["summary"]
    print(" installed physical types:",s["step4b_installed_physical_asset_types"])
    print(" installed physical instances:",s["step4b_installed_physical_instances"])
    print(" canonical connected surfaces:",s["canonical_connected_surface_instances"])
    print(" complete / tracked rows:",f'{s["complete_rows"]}/{s["coverage_rows"]}')
    print(" october demo incomplete:",s["october_demo_incomplete_rows"])
    if not report["passed"]:
        raise SystemExit(1)

if __name__=="__main__":
    main()
