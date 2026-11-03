#!/usr/bin/env python3
"""Brand-slot emission for Equity Uprise building builders.

A brand slot is an EMPTY glTF node (no mesh) named ``brand-slot::<id>`` whose
extras carry the slot record from ``brand-manifest.json``. No builder draws,
traces, extrudes or letters a mark; owner-supplied artwork is applied at
runtime by ``equity-uprise-brand-slots.mjs``. NOT FOR CONSTRUCTION.
"""
import json
from pathlib import Path
import numpy as np

FT = 0.3048
HERE = Path(__file__).resolve().parent
MANIFEST_PATH = HERE / "brand-manifest.json"
MANIFEST = json.loads(MANIFEST_PATH.read_text())


def slots_for(surface_prefix, level=None):
    return [s for s in MANIFEST["slots"] if s["surface"].startswith(surface_prefix) and (level is None or s["level"] == level)]


def add_brand_slots(scene, slots, origin_z_ft=0.0, mark=None):
    """Add one empty node per slot. ``origin_z_ft`` is the GLB's own Z datum in building feet."""
    names = []
    for s in slots:
        # Identity transform: the node carries its position in extras only, so every
        # architecture node in the building GLBs stays translation-free (consumers
        # such as the PRIM3 level read raw node bounds).
        T = np.eye(4)
        name = f"brand-slot::{s['id']}"
        scene.graph.update(frame_to=name, frame_from=scene.graph.base_frame, matrix=T,
                           metadata={"brand_slot": dict(s, manifest="production/brand/brand-manifest.json", glb_origin_z_ft=origin_z_ft)})
        names.append(name)
        if mark:
            for inv in s.get("replaces_inventory_records", []):
                mark(inv)
    return names
