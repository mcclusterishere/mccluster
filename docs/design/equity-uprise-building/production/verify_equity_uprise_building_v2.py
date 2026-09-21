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

expected=[0,13.5,27,40.5,54,67.5,81]
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

if errors:
    print("Core V2 verification FAILED")
    for e in errors:print("-",e)
    sys.exit(1)
print(f"Core V2 verification PASS · meshes={len(scene.geometry)} · sha256={sha}")
