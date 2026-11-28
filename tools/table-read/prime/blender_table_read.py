"""TABLE READ on Prime: build (or patch) a Blender scene from an aligned Table Read take.

  Build, render the proof and save the editable project:
    blender [approved_rigs.blend] -b --python blender_table_read.py -- \
        --alignment takes/aligned/alignment.json \
        --curves DAVE=takes/dave.curves.json --curves MATTHEW=takes/matthew.curves.json \
        [--rig DAVE=ObjectName --rig MATTHEW=ObjectName] \
        --out render/ --save render/table_read.blend [--engine WORKBENCH|EEVEE]

  Retake one line, re-render only its shot and splice it into the proof:
    blender render/table_read.blend -b --python blender_table_read.py -- \
        --patch retake/aligned/alignment.json --patch-curves DAVE=retake/dave.curves.json \
        --shot line-006 --out render/ --save render/table_read.blend

What it makes, all editable:
  - TR_CTRL.<ROLE>: one control per actor. Every expression is a custom property
    (jawOpen, eyeBlinkLeft, mouthSmileLeft, ...) keyed per frame from the face curves,
    and the head turn is the control's own rotation, keyed. Gains (head_gain,
    expression_gain) are properties too. Edit, smooth or delete keys like any F-curve.
  - The face: with --rig, a COPY of the named approved object (the original is never
    changed) whose shape keys with matching names are driven by the control, and whose
    "head" bone (or object) follows the control's rotation. Without --rig, a stand-in
    head labelled "STAND-IN · <ROLE>", driven the same way. Nothing is ever drawn
    to look like a real person.
  - The voices: each actor's aligned WAV as a sound strip on its own channel.
  - Shots: one timeline marker per script line, bound to the speaker's camera
    (CAM.<ROLE>) or the wide camera for directions, so one shot can be re-rendered alone.
  - Output: portrait 720 x 1280, 30 fps, H.264 + AAC (proof.mp4), via Blender's own encoder.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import bpy

FPS = 30
RES = (720, 1280)
SC: list = []  # the Table Read scene being built or patched
PALETTE = [(0.95, 0.75, 0.30, 1), (0.45, 0.80, 0.95, 1), (0.70, 0.95, 0.55, 1), (0.95, 0.55, 0.75, 1)]


def args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--alignment", type=Path)
    ap.add_argument("--curves", action="append", default=[])
    ap.add_argument("--rig", action="append", default=[])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--save", type=Path)
    ap.add_argument("--engine", default="WORKBENCH")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--patch", type=Path)
    ap.add_argument("--patch-curves", action="append", default=[])
    ap.add_argument("--shot")
    return ap.parse_args(argv)


def pairs(items: list[str]) -> dict[str, str]:
    out = {}
    for it in items:
        k, _, v = it.partition("=")
        if not v:
            sys.exit(f"expected ROLE=value, got {it!r}")
        out[k.strip().upper()] = v.strip()
    return out


def frame(ms: float) -> int:
    return int(round(ms / 1000.0 * FPS)) + 1


# ---------------------------------------------------------------- controls and keys
def control(role: str) -> bpy.types.Object:
    name = f"TR_CTRL.{role}"
    ob = bpy.data.objects.get(name)
    if ob:
        return ob
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "SPHERE"
    ob.empty_display_size = 0.05
    ob["head_gain"] = 1.0
    ob["expression_gain"] = 1.0
    ob.id_properties_ui("head_gain").update(min=0.0, max=2.0, description="Scales the recorded head turn")
    ob.id_properties_ui("expression_gain").update(min=0.0, max=2.0, description="Scales every recorded expression")
    ob.rotation_mode = "XYZ"
    return ob


def fcurve(ob: bpy.types.Object, path: str, index: int = 0):
    ad = ob.animation_data or ob.animation_data_create()
    if not ad.action:
        ad.action = bpy.data.actions.new(f"{ob.name}.Table Read")
    act = ad.action
    if hasattr(act, "fcurve_ensure_for_datablock"):  # Blender 4.4+ layered actions (5.x only has these)
        return act.fcurve_ensure_for_datablock(ob, path, index=index)
    for fc in act.fcurves:  # older Blender
        if fc.data_path == path and fc.array_index == index:
            return fc
    return act.fcurves.new(path, index=index)


def set_keys(fc, start_frame: int, values: list[float], replace_range: tuple[int, int] | None = None):
    """Write one key per frame from start_frame. With replace_range, keys inside it are replaced first."""
    if replace_range:
        a, b = replace_range
        for i in range(len(fc.keyframe_points) - 1, -1, -1):  # by index, from the end: references go stale on remove
            if a <= fc.keyframe_points[i].co[0] <= b:
                fc.keyframe_points.remove(fc.keyframe_points[i], fast=True)
    n0 = len(fc.keyframe_points)
    fc.keyframe_points.add(len(values))
    for i, v in enumerate(values):
        kp = fc.keyframe_points[n0 + i]
        kp.co = (start_frame + i, v)
        kp.interpolation = "LINEAR"
    if replace_range:
        sort = getattr(fc.keyframe_points, "sort", None)
        if sort:
            sort()
    fc.update()


def key_curves(ctrl, curves: dict, start_frame: int, replace: tuple[int, int] | None = None, limit: int | None = None):
    step = max(1, round(curves.get("fps", FPS) / FPS))
    for name, series in curves["blendshapes"].items():
        if name not in ctrl.keys():
            ctrl[name] = 0.0
            ctrl.id_properties_ui(name).update(min=0.0, max=1.0, description="MediaPipe blendshape from the take")
        vals = series[::step][:limit] if limit else series[::step]
        set_keys(fcurve(ctrl, f'["{name}"]'), start_frame, vals, replace)
    h = curves["head"]
    for axis, key in ((0, "pitch"), (1, "roll"), (2, "yaw")):
        vals = [math.radians(v) for v in h[key][::step]]
        vals = vals[:limit] if limit else vals
        if vals and not replace:
            base = sorted(vals)[len(vals) // 2]  # the actor's resting pose is the rig's neutral
            ctrl[f"rest_{key}"] = base
        base = ctrl.get(f"rest_{key}", 0.0)
        set_keys(fcurve(ctrl, "rotation_euler", axis), start_frame, [v - base for v in vals], replace)


def drive(target, path: str, ctrl, expr: str, props: list[str], index: int = -1):
    fc = target.driver_add(path, index) if index >= 0 else target.driver_add(path)
    d = fc.driver
    d.type = "SCRIPTED"
    for p in props + ["expression_gain"]:
        v = d.variables.new()
        v.name = p.replace("-", "_")
        v.type = "SINGLE_PROP"
        v.targets[0].id = ctrl
        v.targets[0].data_path = f'["{p}"]'
    d.expression = expr
    return fc


# ---------------------------------------------------------------- faces
def material(name, rgba):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = rgba
    return m


def standin(role: str, ctrl, x: float, color) -> list:
    coll = bpy.data.collections.new(f"STAND-IN.{role}")
    SC[0].collection.children.link(coll)
    mat = material(f"STAND-IN.{role}", color)
    dark = material("STAND-IN.features", (0.08, 0.08, 0.1, 1))

    def mesh(kind, name, loc, scale, mat_):
        if kind == "sphere":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16)
        else:
            bpy.ops.mesh.primitive_cube_add()
        ob = bpy.context.active_object
        ob.name = name
        ob.location = loc
        ob.scale = scale
        ob.data.materials.append(mat_)
        for c in ob.users_collection:
            c.objects.unlink(ob)
        coll.objects.link(ob)
        return ob

    pivot = bpy.data.objects.new(f"TR_HEAD.{role}", None)
    coll.objects.link(pivot)
    pivot.location = (x, 0, 1.6)
    con = pivot.constraints.new("COPY_ROTATION")
    con.target = ctrl
    drive(con, "influence", ctrl, "min(1, head_gain)", ["head_gain"])
    head = mesh("sphere", f"STAND-IN.{role}.head", (0, 0, 0), (0.11, 0.12, 0.145), mat)
    eye_l = mesh("cube", f"STAND-IN.{role}.eyeL", (-0.04, -0.105, 0.03), (0.016, 0.006, 0.01), dark)
    eye_r = mesh("cube", f"STAND-IN.{role}.eyeR", (0.04, -0.105, 0.03), (0.016, 0.006, 0.01), dark)
    brow = mesh("cube", f"STAND-IN.{role}.brow", (0, -0.11, 0.06), (0.06, 0.005, 0.006), dark)
    mouth = mesh("cube", f"STAND-IN.{role}.mouth", (0, -0.112, -0.05), (0.035, 0.006, 0.004), dark)
    jaw = mesh("cube", f"STAND-IN.{role}.jaw", (0, -0.1, -0.075), (0.03, 0.006, 0.006), dark)
    for ob in (head, eye_l, eye_r, brow, mouth, jaw):
        ob.parent = pivot
    drive(eye_l, "scale", ctrl, "0.01 * max(0.08, 1 - eyeBlinkLeft * expression_gain)", ["eyeBlinkLeft"], 2)
    drive(eye_r, "scale", ctrl, "0.01 * max(0.08, 1 - eyeBlinkRight * expression_gain)", ["eyeBlinkRight"], 2)
    drive(brow, "location", ctrl, "0.06 + 0.025 * browInnerUp * expression_gain", ["browInnerUp"], 2)
    drive(mouth, "scale", ctrl, "0.035 * (1 + 0.8 * (mouthSmileLeft + mouthSmileRight) / 2 * expression_gain)", ["mouthSmileLeft", "mouthSmileRight"], 0)
    drive(jaw, "location", ctrl, "-0.075 - 0.05 * jawOpen * expression_gain", ["jawOpen"], 2)
    label = bpy.data.curves.new(f"STAND-IN.{role}.label", "FONT")
    label.body = f"STAND-IN · {role}"
    label.size = 0.045
    label.align_x = "CENTER"
    tob = bpy.data.objects.new(f"STAND-IN.{role}.label", label)
    tob.location = (x, -0.05, 1.82)
    tob.rotation_euler = (math.radians(90), 0, 0)
    tob.data.materials.append(mat)
    coll.objects.link(tob)
    for name in ("eyeBlinkLeft", "eyeBlinkRight", "browInnerUp", "mouthSmileLeft", "mouthSmileRight", "jawOpen"):
        if name not in ctrl.keys():
            ctrl[name] = 0.0
    return [pivot]


def approved(role: str, ctrl, name: str, x: float) -> dict:
    src = bpy.data.objects.get(name)
    if not src:
        sys.exit(f"--rig {role}={name}: no object named {name} in this .blend")
    ob = src.copy()
    if src.data is not None:
        ob.data = src.data.copy()
        if getattr(src.data, "shape_keys", None):
            ob.data.shape_keys.name = f"TR copy of {src.name}"
    ob.name = f"TR.{role}.{src.name}"
    ob.animation_data_clear()
    coll = bpy.data.collections.new(f"RIG.{role} (copy of {src.name})")
    SC[0].collection.children.link(coll)
    coll.objects.link(ob)
    ob.location.x = x
    matched = []
    meshes = [ob] if ob.type == "MESH" else [c for c in src.children if c.type == "MESH"]
    if ob.type == "ARMATURE":
        copies = []
        for child in meshes:
            c = child.copy()
            c.data = child.data.copy()
            c.parent = ob
            for mod in c.modifiers:
                if mod.type == "ARMATURE":
                    mod.object = ob
            coll.objects.link(c)
            copies.append(c)
        meshes = copies
        bone = next((b for b in ob.pose.bones if b.name.lower() in ("head", "def-head", "head_fk", "mixamorig:head")), None)
        if bone:
            con = bone.constraints.new("COPY_ROTATION")
            con.target = ctrl
            con.mix_mode = "ADD"
            con.owner_space = con.target_space = "LOCAL"
            drive(con, "influence", ctrl, "min(1, head_gain)", ["head_gain"])
    else:
        con = ob.constraints.new("COPY_ROTATION")
        con.target = ctrl
        con.mix_mode = "ADD"
    for m in meshes:
        keys = getattr(m.data, "shape_keys", None)
        if not keys:
            continue
        for kb in keys.key_blocks[1:]:
            if kb.name in ctrl.keys() or kb.name in ARKIT:
                if kb.name not in ctrl.keys():
                    ctrl[kb.name] = 0.0
                drive(kb, "value", ctrl, f"{kb.name} * expression_gain", [kb.name])
                matched.append(kb.name)
    return {"object": ob.name, "copied_from": src.name, "shape_keys_driven": sorted(set(matched))}


ARKIT = {"browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "cheekPuff", "cheekSquintLeft",
         "cheekSquintRight", "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft",
         "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft",
         "eyeSquintRight", "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen", "jawRight", "mouthClose",
         "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel", "mouthLeft",
         "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker", "mouthRight",
         "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft", "mouthSmileRight",
         "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight"}


# ---------------------------------------------------------------- scene, sound, shots, render
def camera(name: str, loc, target_x: float, lens: float):
    cam = bpy.data.objects.get(name)
    if cam:
        return cam
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.lens = lens
    cam.location = loc
    SC[0].collection.objects.link(cam)
    aim = cam.constraints.new("TRACK_TO")
    tgt = bpy.data.objects.new(f"{name}.aim", None)
    tgt.location = (target_x, 0, 1.6)
    SC[0].collection.objects.link(tgt)
    aim.target = tgt
    aim.track_axis = "TRACK_NEGATIVE_Z"
    aim.up_axis = "UP_Y"
    return cam


def strips(scene):
    se = scene.sequence_editor or scene.sequence_editor_create()
    return se.strips if hasattr(se, "strips") else se.sequences


def sound_strip(scene, name: str, path: Path, channel: int, start: int):
    s = strips(scene).new_sound(name=name, filepath=str(path), channel=channel, frame_start=start)
    return s


def setup_render(scene, engine: str):
    scene.render.fps = FPS
    scene.render.resolution_x, scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    try:
        scene.render.engine = {"EEVEE": "BLENDER_EEVEE", "WORKBENCH": "BLENDER_WORKBENCH"}.get(engine.upper(), engine)
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    if scene.render.engine == "BLENDER_WORKBENCH":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
    img = scene.render.image_settings
    if hasattr(img, "media_type"):
        img.media_type = "VIDEO"
    img.file_format = "FFMPEG"
    ff = scene.render.ffmpeg
    ff.format = "MPEG4"
    ff.codec = "H264"
    ff.constant_rate_factor = "MEDIUM"
    ff.audio_codec = "AAC"
    ff.audio_bitrate = 192
    ff.audio_channels = "STEREO"
    ff.audio_mixrate = 48000


def render(scene, path: Path, start: int, end: int):
    scene.frame_start, scene.frame_end = start, end
    scene.render.filepath = str(path)
    scene.render.use_file_extension = False
    bpy.ops.render.render(animation=True, scene=scene.name)


def build(a) -> dict:
    al = json.loads(a.alignment.read_text(encoding="utf-8"))
    base = a.alignment.parent
    curves = {k: json.loads(Path(v).read_text(encoding="utf-8")) for k, v in pairs(a.curves).items()}
    rigs = pairs(a.rig)
    scene = bpy.data.scenes.new("Table Read")
    SC[:] = [scene]
    setup_render(scene, a.engine)
    world = bpy.data.worlds.new("TR world")
    world.color = (0.03, 0.03, 0.04)
    scene.world = world
    report = {"scene": scene.name, "actors": [], "shots": []}
    roles = [t["role"] for t in al["takes"]]
    end_ms = max((t["duration_ms"] - t["trim_head_ms"]) for t in al["takes"])
    for i, t in enumerate(al["takes"]):
        role = t["role"].upper()
        x = (i - (len(roles) - 1) / 2) * 0.6
        ctrl = control(role)
        scene.collection.objects.link(ctrl)
        ctrl.location = (x, -0.6, 2.05)
        entry = {"role": role, "control": ctrl.name}
        if role in rigs:
            entry["rig"] = approved(role, ctrl, rigs[role], x)
        else:
            standin(role, ctrl, x, PALETTE[i % len(PALETTE)])
            entry["rig"] = "STAND-IN (no approved rig given)"
        if role in curves:
            c = curves[role]
            # face frames are on the take's own clock; the scene starts at the aligned head
            skip = int(round(t["trim_head_ms"] / 1000 * c.get("fps", FPS)))
            trimmed = {**c, "blendshapes": {k: v[skip:] for k, v in c["blendshapes"].items()}, "head": {k: v[skip:] for k, v in c["head"].items()}}
            key_curves(ctrl, trimmed, 1)
            entry["face_coverage"] = c.get("coverage")
        else:
            entry["face_coverage"] = None
        wav = base / t["aligned_wav"]
        sound_strip(scene, f"VOICE {role}", wav, 1 + i, 1)
        camera(f"CAM.{role}", (x, -1.15, 1.62), x, 50)
        report["actors"].append(entry)
    wide = camera("CAM.WIDE", (0, -2.6, 1.7), 0, 32)
    scene.camera = wide
    for sh in al.get("shots", []):
        f0 = frame(sh["start_ms"])
        mk = scene.timeline_markers.new(sh["shot"], frame=f0)
        spk = (sh.get("speaker") or "").upper()
        mk.camera = bpy.data.objects.get(f"CAM.{spk}") or wide
        report["shots"].append({"shot": sh["shot"], "speaker": sh.get("speaker"), "start_frame": f0, "end_frame": frame(sh["end_ms"]) - 1 if sh.get("end_ms") else None, "camera": mk.camera.name, "text": sh.get("text")})
    scene.frame_start, scene.frame_end = 1, max(2, frame(end_ms) - 1)
    report["frames"] = scene.frame_end
    scene["table_read"] = json.dumps({"alignment": str(a.alignment), "shots": report["shots"], "frames": report["frames"]})
    return scene, report


def patch(a) -> tuple:
    scene = next((s for s in bpy.data.scenes if "table_read" in s.keys()), None)
    if not scene:
        sys.exit("This .blend has no Table Read scene. Build it first.")
    SC[:] = [scene]
    meta = json.loads(scene["table_read"])
    shot = next((s for s in meta["shots"] if s["shot"] == a.shot), None)
    if not shot:
        sys.exit(f"No shot {a.shot}. Shots: {', '.join(s['shot'] for s in meta['shots'])}")
    f0, f1 = shot["start_frame"], shot["end_frame"] or scene.frame_end
    ral = json.loads(a.patch.read_text(encoding="utf-8"))
    rbase = a.patch.parent
    rshot = next((s for s in ral.get("shots", []) if s["index"] == int(a.shot.split("-")[1])), None) or (ral.get("shots") or [{"start_ms": 0}])[0]
    r0 = rshot["start_ms"]
    length = f1 - f0 + 1
    curves = {k: json.loads(Path(v).read_text(encoding="utf-8")) for k, v in pairs(a.patch_curves).items()}
    done = []
    for i, t in enumerate(ral["takes"]):
        role = t["role"].upper()
        # mute the original voice across the shot (keys on volume stay editable), lay the retake over it
        for old in [s for s in strips(scene) if s.name.startswith(f"RETAKE {a.shot} {role}")]:
            strips(scene).remove(old)  # a second retake of the same line replaces the first
        orig = next((s for s in strips(scene) if s.name == f"VOICE {role}"), None)
        if orig:
            for fr, vol in ((f0 - 1, 1.0), (f0, 0.0), (f1, 0.0), (f1 + 1, 1.0)):
                orig.volume = vol
                orig.keyframe_insert("volume", frame=fr)
        snd = sound_strip(scene, f"RETAKE {a.shot} {role}", rbase / t["aligned_wav"], 8 + i, f0 - frame(r0) + 1)
        snd.frame_offset_start = max(0, f0 - snd.frame_start)
        snd.frame_offset_end = max(0, snd.frame_final_end - (f1 + 1))
        ctrl = bpy.data.objects.get(f"TR_CTRL.{role}")
        if ctrl and role in curves:
            c = curves[role]
            skip = int(round((t["trim_head_ms"] + r0) / 1000 * c.get("fps", FPS)))
            seg = {**c, "blendshapes": {k: v[skip:] for k, v in c["blendshapes"].items()}, "head": {k: v[skip:] for k, v in c["head"].items()}}
            key_curves(ctrl, seg, f0, replace=(f0, f1), limit=length)
        done.append(role)
    return scene, {"shot": a.shot, "frames": [f0, f1], "roles": done, "full_end": meta.get("frames") or scene.frame_end}


def splice(proof: Path, shot_file: Path, f0: int, f1: int, mix: Path, dest: Path):
    """proof[0, f0) + shot + proof(f1, end] for the picture; the patched audio mix for sound."""
    ff = shutil.which("ffmpeg")
    if not ff:
        print("ffmpeg not on PATH: shot rendered, not spliced", file=sys.stderr)
        return False
    a, b = (f0 - 1) / FPS, f1 / FPS
    graph = (f"[0:v]split[pa][pb];[pa]trim=end={a:.4f},setpts=PTS-STARTPTS[v0];[1:v]setpts=PTS-STARTPTS[v1];"
             f"[pb]trim=start={b:.4f},setpts=PTS-STARTPTS[v2];[v0][v1][v2]concat=n=3:v=1:a=0[v]")
    subprocess.run([ff, "-v", "error", "-y", "-i", str(proof), "-i", str(shot_file), "-i", str(mix), "-filter_complex", graph,
                    "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                    "-shortest", str(dest)], check=True)
    return True


def main():
    a = args()
    # `blender file.blend -b --python ...` has already opened the file; the bpy module (tests) has not.
    head = sys.argv[: sys.argv.index("--")] if "--" in sys.argv else sys.argv
    blend = next((x for x in head if x.lower().endswith(".blend")), None)
    if blend and not bpy.data.filepath:
        bpy.ops.wm.open_mainfile(filepath=blend)
    a.out.mkdir(parents=True, exist_ok=True)
    if a.patch:
        if not a.shot:
            sys.exit("--patch needs --shot <name>")
        scene, report = patch(a)
        setup_render(scene, a.engine)
        f0, f1 = report["frames"]
        full_end = report.pop("full_end")
        shot_file = a.out / f"shot_{a.shot}.mp4"
        render(scene, shot_file, f0, f1)
        mix = a.out / "mix_patched.wav"
        scene.frame_start, scene.frame_end = 1, max(f1, full_end)
        with bpy.context.temp_override(scene=scene):
            bpy.ops.sound.mixdown(filepath=str(mix), container="WAV", codec="PCM", format="S16", mixrate=48000)
        proof = a.out / "proof.mp4"
        dest = a.out / f"proof_retake_{a.shot}.mp4"
        report["shot_file"] = str(shot_file)
        report["spliced"] = str(dest) if proof.exists() and splice(proof, shot_file, f0, f1, mix, dest) else None
    else:
        if not a.alignment:
            sys.exit("--alignment is required to build")
        scene, report = build(a)
        if not a.no_render:
            render(scene, a.out / "proof.mp4", 1, report["frames"])
            report["proof"] = str(a.out / "proof.mp4")
    meta = json.loads(scene.get("table_read", "{}"))
    scene.frame_start, scene.frame_end = 1, meta.get("frames") or scene.frame_end  # the project keeps the whole scene
    scene.render.filepath = str(a.out / "proof.mp4")
    if a.save:
        bpy.ops.wm.save_as_mainfile(filepath=str(a.save.resolve()))
        report["blend"] = str(a.save)
    (a.out / ("patch_report.json" if a.patch else "build_report.json")).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


main()
