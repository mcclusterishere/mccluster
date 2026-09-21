#!/usr/bin/env python3
"""
Core V2 compatibility shim.

The former implementation in this path generated an isolated Floor 1 GLB with
a short decorative stair placeholder. That geometry is retired on the Core V2
migration branch.

Use ../build_equity_uprise_building_v2.py. The combined building is the
vertical-continuity authority.

NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import runpy

HERE=Path(__file__).resolve().parent
TARGET=HERE.parent/"build_equity_uprise_building_v2.py"
if not TARGET.exists():
    raise SystemExit(f"Missing Core V2 combined builder: {TARGET}")
print("Floor 1 isolated Core V1 builder retired. Running Core V2 combined building generator.")
runpy.run_path(str(TARGET),run_name="__main__")
