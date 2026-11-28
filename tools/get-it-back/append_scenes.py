"""Append every scene of another .blend into the open working copy, then save the working copy.

    blender work.blend -b --python append_scenes.py -- --from proof_phone_call.blend [--scene "Name"]...

The source file is only read. Appended scenes keep their names (Blender adds .001 on a clash);
the names are printed so the cut list can use them."""
import argparse
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--from", dest="src", required=True)
ap.add_argument("--scene", action="append", default=[])
a = ap.parse_args(argv)
head = sys.argv[: sys.argv.index("--")] if "--" in sys.argv else sys.argv
blend = next((x for x in head if x.lower().endswith(".blend")), None)
if blend and not bpy.data.filepath:
    bpy.ops.wm.open_mainfile(filepath=blend)
if not bpy.data.filepath:
    sys.exit("Open the working copy first: blender work.blend -b --python append_scenes.py -- --from other.blend")
before = {s.name for s in bpy.data.scenes}
with bpy.data.libraries.load(a.src, link=False) as (src, dst):
    dst.scenes = [n for n in src.scenes if not a.scene or n in a.scene]
added = [s.name for s in bpy.data.scenes if s.name not in before]
print("appended scenes:", added)
print("all scenes:", [s.name for s in bpy.data.scenes])
bpy.ops.wm.save_mainfile()
