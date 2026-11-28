"""Get It Back: conform a cut list into a portrait edit, render it, keep it editable.

    blender blend/get-it-back_full.blend -b --python conform_cut.py -- \
        --cut cut-60s.json --out final/get-it-back_60s.mp4 --save blend/get-it-back_60s.blend

The open .blend's own 3D scenes are the picture: each shot in the cut list is a
scene strip (a scene, its camera, a source frame range) in a NEW edit scene, so
the source scenes, rigs and timeline are never changed. Sound is the song from a
chosen point plus dialogue clips. Any clip marked "scratch" is named SCRATCH in
the edit and carries an on-screen "SCRATCH AUDIO" label while it plays, until a
real performance replaces it (swap the file, or re-run with the new path).

Cut list (schema mccluster-cut/1):
  {"schema": "mccluster-cut/1", "fps": 30, "resolution": [720, 1280],
   "song": {"path": "C:/Users/Mattm/Downloads/Get It Back.m4a", "source_in_s": 0, "until_s": 40, "fade_out_s": 2, "duck_db": -9},
   "shots": [{"id": "suite-vibe", "scene": "Suite", "camera": "CAM.Suite", "frame_in": 1, "frames": 90, "note": "..."}],
   "dialogue": [{"id": "dave-01", "path": "audio/SCRATCH_dave-01.wav", "at_s": 41.2, "speaker": "DAVE", "scratch": true}]}
Shots play back to back from frame 1. The song is ducked by duck_db under dialogue.
Writes <out>.report.json beside the video: shot list with timecodes, scratch clips, durations."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--cut", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--save", type=Path)
    ap.add_argument("--no-render", action="store_true")
    return ap.parse_args(argv)


def strips(scene):
    se = scene.sequence_editor or scene.sequence_editor_create()
    return se.strips if hasattr(se, "strips") else se.sequences


def trim(strip, start: int, end: int):
    """Show [start, end) on the edit timeline (end exclusive)."""
    if hasattr(strip, "left_handle"):  # Blender 5.x
        strip.left_handle, strip.right_handle = start, end
    else:
        strip.frame_final_start, strip.frame_final_end = start, end


def setup(scene, fps: int, res):
    scene.render.fps = fps
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.use_sequencer = True
    scene.render.use_compositing = False
    img = scene.render.image_settings
    if hasattr(img, "media_type"):
        img.media_type = "VIDEO"
    img.file_format = "FFMPEG"
    ff = scene.render.ffmpeg
    ff.format = "MPEG4"
    ff.codec = "H264"
    ff.constant_rate_factor = "HIGH"
    ff.audio_codec = "AAC"
    ff.audio_bitrate = 192
    ff.audio_channels = "STEREO"
    ff.audio_mixrate = 48000


def tc(frame: int, fps: int) -> str:
    s = (frame - 1) / fps
    return f"{int(s // 60):02d}:{s % 60:06.3f}"


def main():
    a = args()
    head = sys.argv[: sys.argv.index("--")] if "--" in sys.argv else sys.argv
    blend = next((x for x in head if x.lower().endswith(".blend")), None)
    if blend and not bpy.data.filepath:
        bpy.ops.wm.open_mainfile(filepath=blend)
    cut = json.loads(a.cut.read_text(encoding="utf-8"))
    if cut.get("schema") != "mccluster-cut/1":
        sys.exit("cut list must have schema mccluster-cut/1")
    base = a.cut.parent
    fps = int(cut.get("fps", 30))
    res = tuple(cut.get("resolution", [720, 1280]))
    name = cut.get("name", "Get It Back 60s")
    old = bpy.data.scenes.get(name)
    if old:
        bpy.data.scenes.remove(old)
    edit = bpy.data.scenes.new(name)
    setup(edit, fps, res)
    report = {"name": name, "fps": fps, "resolution": list(res), "shots": [], "dialogue": [], "problems": []}

    pos = 1
    for i, sh in enumerate(cut["shots"]):
        src = bpy.data.scenes.get(sh["scene"])
        if not src:
            report["problems"].append(f"shot {sh['id']}: no scene named {sh['scene']!r} (scenes: {', '.join(s.name for s in bpy.data.scenes)})")
            continue
        cam = bpy.data.objects.get(sh.get("camera") or "") or src.camera
        if not cam:
            report["problems"].append(f"shot {sh['id']}: scene {src.name} has no camera")
            continue
        frames = int(sh["frames"])
        fin = int(sh.get("frame_in", src.frame_start))
        st = strips(edit).new_scene(name=f"{i + 1:02d} {sh['id']}", scene=src, channel=2 + (i % 2), frame_start=pos - (fin - src.frame_start))
        st.scene_camera = cam
        if hasattr(st, "scene_input"):
            st.scene_input = "CAMERA"
        trim(st, pos, pos + frames)
        report["shots"].append({"id": sh["id"], "scene": src.name, "camera": cam.name, "source_frames": [fin, fin + frames - 1],
                                "edit_frames": [pos, pos + frames - 1], "in": tc(pos, fps), "out": tc(pos + frames, fps), "note": sh.get("note")})
        pos += frames
    end = pos  # exclusive
    edit.frame_start, edit.frame_end = 1, max(1, end - 1)

    song = cut.get("song")
    ducks = []
    for j, d in enumerate(cut.get("dialogue", [])):
        p = Path(d["path"])
        p = p if p.is_absolute() else base / p
        if not p.exists():
            report["problems"].append(f"dialogue {d['id']}: missing {p}")
            continue
        at = int(round(d["at_s"] * fps)) + 1
        label = ("SCRATCH " if d.get("scratch") else "") + f"{d.get('speaker', '')} {d['id']}".strip()
        snd = strips(edit).new_sound(name=label, filepath=str(p), channel=6 + (j % 2), frame_start=at)
        snd.volume = float(d.get("gain", 1.0))
        dur = (snd.right_handle if hasattr(snd, "right_handle") else snd.frame_final_end) - at
        ducks.append((at, at + dur))
        if d.get("scratch"):
            try:
                txt = strips(edit).new_effect(name=f"LABEL {label}", type="TEXT", channel=9, frame_start=at, length=dur)
            except TypeError:  # Blender before 4.4
                txt = strips(edit).new_effect(name=f"LABEL {label}", type="TEXT", channel=9, frame_start=at, frame_end=at + dur)
            txt.text = "SCRATCH AUDIO"
            txt.font_size = 34
            txt.location = (0.5, 0.06)
            txt.use_box = True
            txt.box_color = (0, 0, 0, 0.6)
        report["dialogue"].append({"id": d["id"], "speaker": d.get("speaker"), "file": p.name, "scratch": bool(d.get("scratch")),
                                   "edit_frames": [at, at + dur - 1], "in": tc(at, fps)})
    if song:
        sp = Path(song["path"])
        sp = sp if sp.is_absolute() else base / sp
        if not sp.exists():
            report["problems"].append(f"song: missing {sp}")
        else:
            src_in = int(round(float(song.get("source_in_s", 0)) * fps))
            until = int(round(float(song.get("until_s", (end - 1) / fps)) * fps)) + 1
            s = strips(edit).new_sound(name="SONG Get It Back", filepath=str(sp), channel=5, frame_start=1 - src_in)
            trim(s, 1, min(until, end))
            fade = int(round(float(song.get("fade_out_s", 0)) * fps))
            duck = 10 ** (float(song.get("duck_db", 0)) / 20)
            keys = {1: 1.0}
            for a0, a1 in ducks:
                if a0 < until:
                    keys[max(1, a0 - 6)] = keys.get(max(1, a0 - 6), 1.0)
                    keys[a0] = duck
                    keys[a1] = duck
                    keys[a1 + 6] = 1.0
            if fade:
                keys[max(1, until - fade)] = min(v for f, v in keys.items() if f <= until - fade) if any(f <= until - fade for f in keys) else 1.0
                keys[until] = 0.0
            for f in sorted(keys):
                s.volume = keys[f]
                s.keyframe_insert("volume", frame=f)
            report["song"] = {"file": sp.name, "source_in_s": song.get("source_in_s", 0), "edit_frames": [1, min(until, end) - 1], "fade_out_s": song.get("fade_out_s", 0)}
    for d in report["dialogue"]:
        if d["edit_frames"][1] >= end:
            report.setdefault("warnings", []).append(f"dialogue {d['id']} runs {(d['edit_frames'][1] - end + 1) / fps:.2f} s past the last picture frame; it is cut off")
    report["duration_s"] = round((end - 1) / fps, 3)
    report["scratch_clips"] = sum(1 for d in report["dialogue"] if d["scratch"])
    a.out.parent.mkdir(parents=True, exist_ok=True)
    edit.render.filepath = str(a.out)
    edit.render.use_file_extension = False
    if report["problems"]:
        print("\n".join(report["problems"]), file=sys.stderr)
    if not a.no_render and report["shots"]:
        bpy.ops.render.render(animation=True, scene=edit.name)
        report["video"] = str(a.out)
    if a.save:
        a.save.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(a.save.resolve()))
        report["blend"] = str(a.save)
    Path(str(a.out) + ".report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report.get(k) for k in ("duration_s", "scratch_clips", "problems", "warnings")}, indent=2))
    if report["problems"]:
        sys.exit(1)


main()
