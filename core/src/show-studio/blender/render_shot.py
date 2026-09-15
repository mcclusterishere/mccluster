# Render the first and last frame of one shot's camera move.
#
# Runs inside Blender's bundled Python (`blender --background --python`).
# Reads the JSON spec blender-runtime.mjs wrote, imports the shot's GLBs,
# frames them with a real camera, and renders the two boundary frames that
# a first/last-frame video model interpolates between.
#
# Progress is reported as MCCLUSTER_EVENT lines on stdout, which the Node
# side parses; anything else Blender prints is kept only as a tail.

import json
import math
import os
import sys

import bpy
from mathutils import Vector


def emit(kind, **fields):
    payload = {"kind": kind}
    payload.update(fields)
    print("MCCLUSTER_EVENT " + json.dumps(payload), flush=True)


def spec_path_from_argv():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for arg in argv:
        if arg.startswith("--spec="):
            return arg[len("--spec="):]
    raise SystemExit("render_shot.py requires --spec=<path>")


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_asset(asset):
    path = asset["path"]
    if not os.path.isfile(path):
        raise SystemExit("missing asset: %s" % path)

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [obj for obj in bpy.data.objects if obj not in before]

    for obj in imported:
        if obj.parent is not None:
            continue
        obj.location = Vector(asset["location"]) + obj.location
        obj.rotation_euler = [
            obj.rotation_euler[i] + asset["rotation"][i] for i in range(3)
        ]
        obj.scale = [obj.scale[i] * asset["scale"][i] for i in range(3)]

    return imported


def aim(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def build_camera(camera_spec):
    data = bpy.data.cameras.new("mccluster_camera")
    data.lens = camera_spec["focal_length"]
    camera = bpy.data.objects.new("mccluster_camera", data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    return camera


def build_lighting(lighting):
    data = bpy.data.lights.new("mccluster_sun", type="SUN")
    data.energy = lighting["sun_energy"]
    sun = bpy.data.objects.new("mccluster_sun", data)
    sun.rotation_euler = lighting["sun_rotation"]
    bpy.context.scene.collection.objects.link(sun)

    world = bpy.data.worlds.new("mccluster_world")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs[1].default_value = lighting["world_strength"]
    bpy.context.scene.world = world
    return sun


def configure_render(spec):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = spec["samples"]
    # A fixed seed is what makes two renders of the same shot the same
    # image; sampling noise that moves between boundary frames reads as a
    # flicker once the video model interpolates them.
    scene.cycles.seed = spec["seed"]
    scene.cycles.use_denoising = True
    scene.render.resolution_x = spec["resolution"]["width"]
    scene.render.resolution_y = spec["resolution"]["height"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"


def render_to(path):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    spec = json.load(open(spec_path_from_argv(), "r", encoding="utf-8"))
    emit("started", shot=spec["id"], assets=len(spec["assets"]))

    reset_scene()

    imported = 0
    for asset in spec["assets"]:
        imported += len(import_asset(asset))
    emit("imported", shot=spec["id"], objects=imported)

    configure_render(spec)
    build_lighting(spec["lighting"])
    camera = build_camera(spec["camera"])

    for label, key in (("first", "start"), ("last", "end")):
        camera.location = Vector(spec["camera"][key])
        aim(camera, spec["camera"]["look_at"])
        bpy.context.view_layer.update()
        target = spec["output"][label]
        render_to(target)
        emit("rendered", shot=spec["id"], boundary=label, path=target)

    emit("finished", shot=spec["id"])


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 - surfaced as a parseable event
        emit("failed", error=str(error))
        raise SystemExit(1)
