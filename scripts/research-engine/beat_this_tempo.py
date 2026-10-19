"""Offline Beat This! tempo hypotheses for a PINNED local checkpoint.
No downloads. Code/weights MIT, but training audio clearance must be reviewed.
Output gives beat-derived BPM candidates, not a medical conclusion or verified score.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import statistics
import sys


def estimate(input_audio: Path, checkpoint: Path, expected_sha: str, device: str = "cpu"):
    if not input_audio.is_file() or not checkpoint.is_file():
        raise ValueError("source and locally approved checkpoint are required")
    if len(expected_sha) != 64 or any(c not in "0123456789abcdef" for c in expected_sha):
        raise ValueError("SHA256 checkpoint fingerprint required")
    with checkpoint.open("rb") as file:
        actual = hashlib.file_digest(file, "sha256").hexdigest()
    if actual != expected_sha:
        raise ValueError("reviewed model checkpoint digest mismatch")
    try:
        from beat_this.inference import File2Beats
    except ImportError as exc:
        raise RuntimeError("install reviewed beat-this dependencies into the CPU/GPU worker image") from exc
    # An EXISTING absolute file path prevents the package's short-name
    # fallback, which otherwise downloads model weights from the internet.
    model = File2Beats(checkpoint_path=str(checkpoint.resolve()), device=device, dbn=False)
    beats, downbeats = model(str(input_audio.resolve()))
    times = [float(t) for t in beats if math.isfinite(float(t))]
    valid = [b-a for a,b in zip(times, times[1:]) if 0.25 <= b-a <= 1.5]
    if len(valid) < 5:
        return {"schema":"mcc.music.beat-this.v1","status":"abstained",
                "tempo":{"bpm":None,"confidence":0,
                         "reason":"too few consistently detected beats"}}
    median = statistics.median(valid)
    deviations = [abs(x-median) for x in valid]
    stability = max(0,min(1,1-statistics.median(deviations)/median*5))
    coverage = max(0,min(1,len(valid)/32))
    confidence = round(0.85*stability*coverage,3)  # heuristic, uncalibrated
    bpm = 60/median
    candidates = sorted(set(round(x,2) for x in (bpm/2,bpm,bpm*2) if 40<=x<=240))
    return {
        "schema":"mcc.music.beat-this.v1",
        "status":"estimated_not_verified" if confidence>=.23 else "abstained",
        "model":"Beat This! pretrained, pinned local checkpoint",
        "checkpoint_sha256":expected_sha,"beat_count":len(times),
        "downbeat_count":len(downbeats),
        "tempo":{"bpm":round(bpm,2) if confidence>=.23 else None,
                 "confidence":confidence,"candidates_bpm":candidates,
                 "half_double_time_ambiguous":True,
                 "reason":"beat interval periodicity with uncalibrated stability heuristic"}
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",required=True)
    p.add_argument("--checkpoint",required=True)
    p.add_argument("--sha256",required=True)
    p.add_argument("--output",required=True)
    p.add_argument("--device",choices=("cpu","cuda"),default="cpu")
    args=p.parse_args()
    if not Path(args.checkpoint).is_absolute():
        raise ValueError("checkpoint path must be absolute and operator-approved")
    output=Path(args.output)
    if output.exists() or output.suffix!=".json":
        raise ValueError("output must be a fresh .json artifact")
    result=estimate(Path(args.source),Path(args.checkpoint),args.sha256,args.device)
    output.write_text(json.dumps(result,indent=2),encoding="utf8")


if __name__=="__main__":
    try: main()
    except Exception:
        print("Beat This! evaluation unavailable; see private worker logs",file=sys.stderr)
        raise SystemExit(1)
