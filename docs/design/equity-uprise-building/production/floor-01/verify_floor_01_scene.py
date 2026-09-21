#!/usr/bin/env python3
"""
Core V2 compatibility shim.

The former Floor 1-only verifier checked Core V1 floor-local geometry. Core V2
vertical continuity is verified at the combined-building level.

Use ../verify_equity_uprise_building_v2.py.

NOT FOR CONSTRUCTION.
"""
from pathlib import Path
import runpy

HERE=Path(__file__).resolve().parent
TARGET=HERE.parent/"verify_equity_uprise_building_v2.py"
if not TARGET.exists():
    raise SystemExit(f"Missing Core V2 combined verifier: {TARGET}")
print("Floor 1 isolated Core V1 verifier retired. Running Core V2 combined building verification.")
runpy.run_path(str(TARGET),run_name="__main__")
