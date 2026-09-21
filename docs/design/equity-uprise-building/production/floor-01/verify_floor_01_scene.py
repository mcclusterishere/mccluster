#!/usr/bin/env python3
"""
Verify the generated Equity Uprise Floor 1 GLB against canonical deterministic constraints.

This is a production/QC check, not a construction-code check.
"""

from pathlib import Path
import json
import math
import sys
import trimesh

FT = 0.3048
TOL_FT = 0.02

HERE = Path(__file__).resolve().parent
GLB = HERE / "generated" / "equity-uprise-floor-01-deterministic-v1.glb"
REPORT = HERE / "generated" / "equity-uprise-floor-01-verification-v1.json"

if not GLB.exists():
    raise SystemExit(f"Missing generated GLB: {GLB}. Run build_equity_uprise_floor_01.py first.")

scene = trimesh.load(GLB, force="scene")

def world_bounds(node):
    tf, geom_name = scene.graph[node]
    mesh = scene.geometry[geom_name].copy()
    mesh.apply_transform(tf)
    return (mesh.bounds / FT).tolist()

def center_ft(node):
    b = world_bounds(node)
    return [
        (b[0][0]+b[1][0])/2,
        (b[0][1]+b[1][1])/2,
        (b[0][2]+b[1][2])/2,
    ]

def near(a,b,tol=TOL_FT):
    return abs(float(a)-float(b)) <= tol

checks=[]

def check(name, passed, actual=None, expected=None):
    checks.append({
        "name":name,
        "passed":bool(passed),
        "actual":actual,
        "expected":expected
    })

ext_ft=(scene.extents/FT).tolist()
check("canonical 72ft plan width", near(ext_ft[0],72), ext_ft[0],72)
check("canonical 72ft plan depth", near(ext_ft[1],72), ext_ft[1],72)

# Floor slab proves the world datum and complete plate.
fb=world_bounds("floor_slab")
check("floor slab west datum", near(fb[0][0],0), fb[0][0],0)
check("floor slab south datum", near(fb[0][1],0), fb[0][1],0)
check("floor slab east datum", near(fb[1][0],72), fb[1][0],72)
check("floor slab north datum", near(fb[1][1],72), fb[1][1],72)

# Elevator shaft: verify the four shaft-wall envelopes stay on the locked X54–62/Y34–44 box.
for node in ["elevator_south_1","elevator_north_1","elevator_east_1","elevator_west_1","elevator_west_2"]:
    check(f"{node} exists", node in scene.graph.nodes_geometry)

es=world_bounds("elevator_south_1")
en=world_bounds("elevator_north_1")
ee=world_bounds("elevator_east_1")
check("elevator south aligns Y34", near((es[0][1]+es[1][1])/2,34), (es[0][1]+es[1][1])/2,34)
check("elevator north aligns Y44", near((en[0][1]+en[1][1])/2,44), (en[0][1]+en[1][1])/2,44)
check("elevator east aligns X62", near((ee[0][0]+ee[1][0])/2,62), (ee[0][0]+ee[1][0])/2,62)

# Protected stairs are required to be in the north/rear band Y54–72.
stair_nodes=[n for n in scene.graph.nodes_geometry if n.startswith("stair_a_") or n.startswith("stair_b_")]
stair_bounds=[world_bounds(n) for n in stair_nodes]
min_stair_y=min(b[0][1] for b in stair_bounds)
max_stair_y=max(b[1][1] for b in stair_bounds)
check("stairs remain in rear/north band", min_stair_y >= 54-TOL_FT and max_stair_y <= 72+TOL_FT, [min_stair_y,max_stair_y], [54,72])

# Reception desk exact locked plan bounds X30–42/Y44–47.
rb=world_bounds("reception_desk")
check("reception desk X30", near(rb[0][0],30), rb[0][0],30)
check("reception desk X42", near(rb[1][0],42), rb[1][0],42)
check("reception desk Y44", near(rb[0][1],44), rb[0][1],44)
check("reception desk Y47", near(rb[1][1],47), rb[1][1],47)

# Directory locked X49–51/Y24–29.
db=world_bounds("directory")
check("directory X49", near(db[0][0],49), db[0][0],49)
check("directory X51", near(db[1][0],51), db[1][0],51)
check("directory Y24", near(db[0][1],24), db[0][1],24)
check("directory Y29", near(db[1][1],29), db[1][1],29)

# Canonical camera anchor center.
cc=center_ft("camera::canonical_360")
for axis,actual,expected in zip("xyz",cc,[36,28,5.333]):
    check(f"canonical camera {axis}", near(actual,expected,0.03), actual,expected)

# Entrance opening must remain in the south facade between X29 and X43.
left=world_bounds("south_exterior_wall_left")
right=world_bounds("south_exterior_wall_right")
check("south entrance left jamb X29", near(left[1][0],29), left[1][0],29)
check("south entrance right jamb X43", near(right[0][0],43), right[0][0],43)

failed=[c for c in checks if not c["passed"]]

result={
    "scene_id":"equity-uprise-floor-01",
    "verification_version":"1.0.0",
    "glb":GLB.name,
    "mesh_count":len(scene.geometry),
    "checks_total":len(checks),
    "checks_passed":len(checks)-len(failed),
    "checks_failed":len(failed),
    "passed":not failed,
    "checks":checks,
    "scope_note":"Verifies deterministic geometry against canonical production constraints; does not establish construction/code compliance."
}

REPORT.write_text(json.dumps(result,indent=2)+"\n")
print(json.dumps(result,indent=2))
sys.exit(1 if failed else 0)
