#!/usr/bin/env python3
"""TABLE READ on Prime: facial expression curves and head pose from one take.

    python face_curves.py <take.webm|mp4> --model face_landmarker.task [--fps 30] [--smooth 0.4] [--out curves.json]

MediaPipe Face Landmarker (VIDEO mode, CPU) on every frame of the actor's own
full-frame recording: the 52 expression blendshapes (jawOpen, eyeBlinkLeft,
mouthSmileLeft, browInnerUp, ...) and the head pose (yaw, pitch, roll in
degrees; x, y, z in centimetres) from the facial transformation matrix.
Frames are decoded by ffmpeg at a constant rate so frame i is at i / fps on the
take's own timeline; align_takes.py's trim_head_ms moves it onto the scene's.
Frames with no face hold the last value and are marked in "detected".

Needs: ffmpeg on PATH, `pip install mediapipe` (it brings numpy and OpenCV),
and face_landmarker.task (3.76 MB, float16 v1). Runs offline."""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_WIDTH = 640


def probe(media: Path) -> tuple[int, int]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", str(media)], check=True, capture_output=True, text=True).stdout.strip()
    w, h = (int(x) for x in out.split(",")[:2])
    return w, h


def frames(media: Path, fps: float, width: int):
    w, h = probe(media)
    tw = min(width, w) // 2 * 2
    th = int(round(h * tw / w / 2)) * 2
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(media), "-an", "-vf", f"fps={fps},scale={tw}:{th}",
                             "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    size = tw * th * 3
    i = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield i, tw, th, buf
            i += 1
    finally:
        proc.stdout.close()
        proc.wait()


def pose(matrix) -> dict:
    """Yaw (Y), pitch (X), roll (Z) in degrees from a 4x4 row-major transform; translation in cm."""
    m = [[float(matrix[r][c]) for c in range(4)] for r in range(4)]
    sy = -m[1][2]
    pitch = math.asin(max(-1.0, min(1.0, sy)))
    if abs(sy) < 0.9999:
        yaw = math.atan2(m[0][2], m[2][2])
        roll = math.atan2(m[1][0], m[1][1])
    else:
        yaw = math.atan2(-m[2][0], m[0][0])
        roll = 0.0
    return {"yaw": math.degrees(yaw), "pitch": math.degrees(pitch), "roll": math.degrees(roll),
            "x": m[0][3], "y": m[1][3], "z": m[2][3]}


def smooth(series: list[float], alpha: float) -> list[float]:
    if alpha <= 0 or not series:
        return series
    out, prev = [], series[0]
    for v in series:
        prev = alpha * prev + (1 - alpha) * v
        out.append(prev)
    return out


def run(media: Path, model: Path, fps: float = 30.0, smooth_alpha: float = 0.0, width: int = DEFAULT_WIDTH) -> dict:
    try:
        import numpy as np
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision
    except ImportError as e:  # pragma: no cover - depends on the machine
        sys.exit(f"MediaPipe is not installed ({e}). On Prime: py -m pip install mediapipe")
    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
    names: list[str] = []
    shapes: dict[str, list[float]] = {}
    head = {k: [] for k in ("yaw", "pitch", "roll", "x", "y", "z")}
    detected: list[bool] = []
    last_shape: dict[str, float] = {}
    last_pose = {k: 0.0 for k in head}
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        for i, w, h, buf in frames(media, fps, width):
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3))
            res = lm.detect_for_video(img, int(round(i * 1000 / fps)))
            ok = bool(res.face_blendshapes)
            if ok:
                for c in res.face_blendshapes[0]:
                    if c.category_name == "_neutral":
                        continue
                    if c.category_name not in shapes:
                        names.append(c.category_name)
                        shapes[c.category_name] = [0.0] * i
                    last_shape[c.category_name] = float(c.score)
                if res.facial_transformation_matrixes:
                    last_pose = pose(res.facial_transformation_matrixes[0])
            for n in names:
                shapes[n].append(last_shape.get(n, 0.0))
            for k in head:
                head[k].append(last_pose[k])
            detected.append(ok)
    for n in names:
        shapes[n] = [round(v, 4) for v in smooth(shapes[n], smooth_alpha)]
    for k in head:
        head[k] = [round(v, 3) for v in smooth(head[k], smooth_alpha)]
    found = sum(detected)
    return {
        "schema": "mccluster-face-curves/1",
        "source": media.name,
        "model": model.name,
        "fps": fps,
        "frames": len(detected),
        "detected_frames": found,
        "coverage": round(found / len(detected), 3) if detected else 0.0,
        "blendshapes": shapes,
        "head": head,
        "detected": [1 if d else 0 for d in detected],
        "smooth": smooth_alpha,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("media", type=Path)
    ap.add_argument("--model", type=Path, default=Path("face_landmarker.task"))
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--smooth", type=float, default=0.0, help="0 (raw) to 0.9 (heavy); keys stay editable in Blender either way")
    ap.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is not on PATH.")
    if not a.model.exists():
        sys.exit(f"Model not found: {a.model}. Download face_landmarker.task (float16 v1, 3.76 MB) from Google's MediaPipe model page.")
    data = run(a.media, a.model, a.fps, a.smooth, a.width)
    out = a.out or a.media.with_suffix(".curves.json")
    out.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"{a.media.name}: {data['frames']} frames, face found in {data['detected_frames']} ({data['coverage']:.0%}), "
          f"{len(data['blendshapes'])} expression curves -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
