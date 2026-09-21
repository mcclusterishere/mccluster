#!/usr/bin/env python3
"""Independent Core V2 generated-asset verifier. NOT FOR CONSTRUCTION."""
from pathlib import Path
import json, sys, hashlib
import trimesh

HERE=Path(__file__).resolve().parent
GEN=HERE/"generated"
GLB=GEN/"equity-uprise-building-core-v2.glb"
REPORT=GEN/"equity-uprise-building-core-v2-report.json"
CORE=json.loads((HERE/"building-core-v2.json").read_text())
PROGRAMS=json.loads((HERE/"core-v2-floor-programs.json").read_text())
B1=json.loads((HERE/"basement-b1-program.json").read_text())
SITE=json.loads((HERE/"floor-01"/"floor-01-site-egress.json").read_text())

errors=[]
if not GLB.exists(): errors.append("missing combined GLB")
if not REPORT.exists(): errors.append("missing combined report")
if errors:
    print("\n".join(errors));sys.exit(1)

r=json.loads(REPORT.read_text())
if not r.get("passed"): errors.append("builder report failed")
if r.get("checks_failed")!=0: errors.append(f"builder reports {r.get('checks_failed')} failed checks")

scene=trimesh.load(GLB,force="scene")
if len(scene.geometry)<100: errors.append(f"unexpectedly low mesh count: {len(scene.geometry)}")
sha=hashlib.sha256(GLB.read_bytes()).hexdigest()
if sha!=r.get("sha256"): errors.append("GLB SHA-256 does not match report")

expected=[-13.5,0,13.5,27,40.5,54,67.5,81]
actual=[x["finished_floor_elevation_ft"] for x in CORE["levels"]]
if actual!=expected: errors.append(f"core elevations mismatch {actual}")

# Node-name proof of both stairs at every interface.
names=set(scene.graph.nodes_geometry)
for base in expected[:-1]:
    for prefix in ["stair_a","stair_b"]:
        needle=f"{prefix}_L{base:g}_upper_landing"
        if needle not in names: errors.append(f"missing {needle}")

# Shaft proof.
for node in ["passenger_elevator_shaft_north","freight_elevator_shaft_north","stair_a_enclosure_north","stair_b_enclosure_north"]:
    if node not in names: errors.append(f"missing vertical system node {node}")

# B1 / site proof.
if CORE.get("level_of_exit_discharge") != 1:
    errors.append("Floor 1 is not identified as level of exit discharge")
if B1.get("elevation_ft") != -13.5:
    errors.append("B1 FFE is not -13.5 ft")
for node in ["B1_program_01_room","SITE_discharge_barrier_01","SITE_discharge_barrier_02"]:
    if node not in names:
        errors.append(f"missing B1/site simulation node {node}")
assembly=[x for x in SITE.get("site_elements",[]) if x.get("kind")=="assembly"]
if len(assembly)!=2:
    errors.append(f"expected two assembly areas, found {len(assembly)}")
doors={x.get("object_id") for x in SITE.get("exterior_openings",[])}
for oid in ["F1-DOOR-STAIR-A-DISCHARGE","F1-DOOR-STAIR-B-DISCHARGE","F1-DOOR-SERVICE-WEST"]:
    if oid not in doors:
        errors.append(f"missing exterior opening {oid}")
if len(SITE.get("floor1_discharge_controls",[])) != 2:
    errors.append("Floor 1 does not define both basement-direction discharge controls")

# Floor 6 Halo Globe proof.
halo=[(lvl,s) for lvl in PROGRAMS["levels"] for s in lvl.get("spheres",[]) if s.get("route_key")=="halo_spatial_intelligence"]
if len(halo)!=1:
    errors.append(f"expected exactly one Halo Globe program object, found {len(halo)}")
else:
    lvl,s=halo[0]
    if lvl["level"]!=6: errors.append("Halo Globe is not assigned to Floor 6")
    if "L6_sphere_01_halo_globe" not in names: errors.append("generated GLB is missing L6_sphere_01_halo_globe")
    if s["center_z_local_ft"]-s["radius_ft"]<6.0: errors.append("Halo Globe drops into circulation clearance")
    if s["center_z_local_ft"]+s["radius_ft"]>11.0: errors.append("Halo Globe exceeds the intended ceiling zone")

if errors:
    print("Core V2 verification FAILED")
    for e in errors:print("-",e)
    sys.exit(1)
print(f"Core V2 verification PASS · meshes={len(scene.geometry)} · sha256={sha}")
