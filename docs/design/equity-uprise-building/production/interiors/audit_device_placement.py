#!/usr/bin/env python3
"""Audit the electronics GLB against the furnished floor GLBs, not each in isolation.

Diagnostic only: does not move devices, invent support bindings, or certify an
installation. Report mode succeeds after producing evidence; --strict fails on
any unresolved contact or intersecting monitor pair. NOT FOR CONSTRUCTION.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import sys
from pathlib import Path

PROD = Path(__file__).resolve().parents[1]
ROOT = PROD.parents[3]
FT = 0.3048
CONTACT_TOLERANCE_FT = 0.25 / 12
sys.path.insert(0, str(PROD / "electronics"))
from device_placement_bindings import load_bindings, bound_position


def surface_height(triangle, x, y):
    """Height of a horizontal triangle at XY; None outside or for non-flat faces."""
    a, b, c = triangle
    if max(p[2] for p in triangle) - min(p[2] for p in triangle) > 1e-5:
        return None
    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if den < 1e-10:  # Vertical/degenerate/downward-facing triangles cannot support a base.
        return None
    u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den
    v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den
    if min(u, v, 1 - u - v) < -1e-7:
        return None
    return float(a[2])


def support_contact(bounds, surfaces, tolerance=CONTACT_TOLERANCE_FT):
    """Five real-triangle contact samples, not a containing furniture AABB.

A sample proves geometric contact only. It cannot prove structural support,
manufacturer clearances, stability or cable management.
"""
    lo, hi = bounds
    inset = min(0.001, (hi[0] - lo[0]) / 4, (hi[1] - lo[1]) / 4)
    samples = [(lo[0] + inset, lo[1] + inset), (hi[0] - inset, lo[1] + inset),
               (hi[0] - inset, hi[1] - inset), (lo[0] + inset, hi[1] - inset),
               ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)]
    evidence = []
    for x, y in samples:
        candidates = [(z, name) for name, tri in surfaces
                      if (z := surface_height(tri, x, y)) is not None and z <= lo[2] + tolerance]
        nearest = max(candidates, default=None)
        gap = lo[2] - nearest[0] if nearest else None
        evidence.append({"xy_ft": [round(x, 5), round(y, 5)],
                         "surface_node": nearest[1] if nearest else None,
                         "gap_ft": round(gap, 5) if gap is not None else None,
                         "contact": gap is not None and abs(gap) <= tolerance})
    contacts = sum(p["contact"] for p in evidence)
    return {"status": "contact" if contacts == 5 else "partial_contact" if contacts else "no_contact",
            "contact_samples": contacts, "samples": evidence}


def intersection(a, b, tolerance=1e-4):
    overlap = [min(a[1][k], b[1][k]) - max(a[0][k], b[0][k]) for k in range(3)]
    return [round(x, 5) for x in overlap] if min(overlap) > tolerance else None


def binding_geometry_matches(binding, nodes, elevation):
    """Check authored origin and facing from real geometry, not copied metadata."""
    aid = binding['asset_id']
    kind = binding['asset_type']
    p = bound_position(binding, elevation)
    offset = [0, 0, .20] if kind == 'monitor' else [0, 0, 0]
    front_offset = [0, -.125, .20] if kind == 'monitor' else [-.05, -.59, .48]
    front = aid + ('::PART::BEZEL' if kind == 'monitor' else '::PART::FRONT_IO')
    angle = math.radians(binding['yaw_degrees'])
    for node, local in ((aid, offset), (front, front_offset)):
        if node not in nodes:
            return False
        expected = [p[0] + local[0] * math.cos(angle) - local[1] * math.sin(angle),
                    p[1] + local[0] * math.sin(angle) + local[1] * math.cos(angle), p[2] + local[2]]
        actual = [(a + b) / 2 for a, b in zip(*nodes[node])]
        if any(abs(a - b) > .001 for a, b in zip(actual, expected)):
            return False
    return True


def read_geometry(path, scale=1, elevation=0):
    import numpy as np
    import trimesh
    scene = trimesh.load(path, force="scene")
    nodes = {}
    surfaces = []
    for name in scene.graph.nodes_geometry:
        transform, geometry = scene.graph[name]
        mesh = scene.geometry[geometry]
        vertices = trimesh.transform_points(mesh.vertices, transform) * scale
        vertices[:, 2] += elevation
        nodes[name] = [vertices.min(0).tolist(), vertices.max(0).tolist()]
        triangles = vertices[mesh.faces]
        flat = (np.ptp(triangles[:, :, 2], axis=1) < 1e-5) & (np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])[:, 2] > 1e-10)
        surfaces.extend((name, tri.tolist()) for tri in triangles[flat])
    return nodes, surfaces


def audit(production=PROD):
    production = Path(production)
    electronics = production / "electronics/generated"
    components_path = electronics / "equity-uprise-device-components-v1.json"
    glb = electronics / "equity-uprise-electronics-fabric-v1.glb"
    devices = json.loads(components_path.read_text())["devices"]
    core = json.loads((production / "building-core-v2.json").read_text())
    ffe = {int(x["level"]): x["finished_floor_elevation_ft"] for x in core["levels"]}
    nodes, _ = read_geometry(glb)  # electronics is already absolute feet
    bindings_path = electronics.parent / "device-placement-bindings-v1.json"
    bindings = load_bindings(bindings_path)
    source_paths = [components_path, glb, production / "building-core-v2.json", bindings_path]
    binding_checks = []
    floors = []
    for level in range(8):
        tag = "B1" if level == 0 else "L7" if level == 7 else f"F{level}"
        slug = "basement-b1" if level == 0 else f"floor-{level:02}"
        floor_path = production / f"generated/equity-uprise-{slug}-core-v2.glb"
        source_paths.append(floor_path)
        # Floor GLBs are local metres, Z-up. Add FFE exactly once.
        _, surfaces = read_geometry(floor_path, scale=1 / FT, elevation=ffe[level])
        monitors = [d for d in devices if d["asset_type"] == "monitor" and d["asset_id"].startswith(tag + "-")]
        hosts = [d for d in devices if d["asset_type"] == "workstation" and d["asset_id"].startswith(tag + "-")]
        contacts = []
        for device in monitors + hosts:
            aid = device["asset_id"]
            node = aid + "::PART::STAND_OR_MOUNT" if device["asset_type"] == "monitor" else aid
            bounds = nodes[node]  # Missing authored geometry must fail, never be treated as a pass.
            if aid in bindings:
                binding = bindings[aid]
                declared_surfaces = [(name, tri) for name, tri in surfaces if name == binding["support_node"]]
                contact = support_contact(bounds, declared_surfaces)
                metadata_matches = device.get("support_binding") == binding
                geometry_matches = binding_geometry_matches(binding, nodes, ffe[level])
                binding_checks.append({"asset_id": aid, "support_node": binding["support_node"],
                                       "metadata_matches": metadata_matches, "origin_and_facing_match": geometry_matches, **contact,
                                       "passed": metadata_matches and geometry_matches and contact["status"] == "contact"})
            contacts.append({"asset_id": aid, "asset_type": device["asset_type"], "mesh_node": node,
                             "bottom_aff_ft": round(bounds[0][2] - ffe[level], 5),
                             **support_contact(bounds, surfaces)})
        collisions = []
        for a, b in itertools.combinations(monitors, 2):
            # DISPLAY_PANEL is the primary node; this is exact for the current
            # axis-aligned rectangular panels, not a universal mesh-collision claim.
            overlap = intersection(nodes[a["asset_id"]], nodes[b["asset_id"]])
            if overlap:
                collisions.append({"asset_ids": [a["asset_id"], b["asset_id"]], "panel_overlap_ft": overlap})
        floors.append({"level": level, "level_id": tag, "hosts": len(hosts), "monitors": len(monitors),
                       "monitor_panel_intersections": collisions, "support_contacts": contacts})
    observed = {x["asset_id"] for x in binding_checks}
    for aid in sorted(set(bindings) - observed):
        binding_checks.append({"asset_id": aid, "passed": False, "status": "missing_bound_device"})
    unresolved = [x for f in floors for x in f["support_contacts"] if x["status"] != "contact"]
    collisions = [x for f in floors for x in f["monitor_panel_intersections"]]
    return {"schema_version": "1.0.0", "status": "diagnostic_not_visual_approval", "not_for_construction": True,
            "scope": "Authored workstation chassis and monitor stands against the actual B1-L7 furnished floor meshes; monitor-panel pair intersections",
            "limitations": ["Five base samples establish geometric contact only, not structural or installation safety.",
                            "Monitor pair AABBs are exact only for the current axis-aligned rectangular display panels.",
                            "No inferred surface is an approved mount binding. Other electronics, cables, rack-room conflicts and decorative monitors require separate review.",
                            "No vendor accuracy, sponsor relationship, physical ownership, live connection or visual approval is asserted."],
            "contact_tolerance_ft": CONTACT_TOLERANCE_FT,
            "sources": [{"path": str(p.relative_to(production)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in source_paths],
            "summary": {"hosts": sum(f["hosts"] for f in floors), "monitors": sum(f["monitors"] for f in floors),
                        "unresolved_support_contacts": len(unresolved), "monitor_panel_intersections": len(collisions)},
            "bound_placement_passed": bool(binding_checks) and all(x["passed"] for x in binding_checks),
            "binding_checks": binding_checks,
            "passed": not unresolved and not collisions, "floors": floors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="fail while any placement diagnostic remains unresolved")
    parser.add_argument("--require-bound", action="store_true", help="fail if any authored binding is absent or loses contact with its exact support")
    parser.add_argument("--output", type=Path, default=PROD / "interiors/device-placement-audit-v2.json")
    args = parser.parse_args()
    result = audit()
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"placement_passed": result["passed"], **result["summary"], "report": str(args.output)}, indent=2))
    return 1 if (args.strict and not result["passed"]) or (args.require_bound and not result["bound_placement_passed"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
