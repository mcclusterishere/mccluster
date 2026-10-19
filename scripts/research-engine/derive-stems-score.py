#!/usr/bin/env python3
"""McCluster Research Engine: opt-in offline experimental stem + score pipeline.

No service endpoint. Nothing is automatically installed, downloaded, billed, or
published. A creator-authorized job may run in isolated compute in the future.

Optional external tools:
  audio-separator --output_dir ... --output_format WAV <audio>
  basic-pitch <output_dir> <audio>
Optional music21 converts generated MIDI into draft MusicXML notation.
A final sheet score must be checked against the actual performance by a musician.
"""
from __future__ import annotations
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
from datetime import datetime, timezone

MAX_BYTES = 500 * 1024 * 1024
AUDIO_EXT = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".aiff"}
MAX_RUN_SECONDS = 20 * 60


def source_path(raw: str) -> pathlib.Path:
    path = pathlib.Path(raw).expanduser().resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in AUDIO_EXT:
        raise ValueError("Provide an existing supported local audio file")
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Audio source exceeds the 500 MiB experimental cap")
    return path


def run_tool(exe: str, argv: list[str], *, cwd: pathlib.Path) -> dict:
    binary = shutil.which(exe)
    if binary is None:
        return {"status": "unavailable", "reason": f"{exe} not installed"}
    try:
        completed = subprocess.run(
            [binary, *argv], shell=False, cwd=str(cwd), text=True,
            capture_output=True, timeout=MAX_RUN_SECONDS, check=False,
        )
        return {
            "status": "complete" if completed.returncode == 0 else "failed",
            "exit_code": completed.returncode,
            "stderr_tail": completed.stderr[-750:],
        }
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "reason": f"exceeded {MAX_RUN_SECONDS} seconds"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Local audio file")
    parser.add_argument("--output", required=True, help="New directory for local derived media")
    parser.add_argument("--execute", action="store_true", help="Actually run installed models")
    parser.add_argument("--rights-confirmed", action="store_true",
                        help="Creator specifically authorizes derived stem/note analysis")
    parser.add_argument("--separate", action="store_true",
                        help="Ask installed audio-separator for stems")
    parser.add_argument("--transcribe", action="store_true",
                        help="Ask installed basic-pitch for draft MIDI (not a verified score)")
    parser.add_argument("--allow-model-download", action="store_true",
                        help="Explicitly permit installed model tool to fetch model weights")
    args = parser.parse_args()

    source = source_path(args.source)
    output = pathlib.Path(args.output).expanduser().resolve()
    if output == source or output == source.parent:
        raise ValueError("Use a dedicated output directory for model artifacts")
    if not (args.separate or args.transcribe):
        parser.error("Select --separate and/or --transcribe")
    if args.execute and not args.rights_confirmed:
        parser.error("--execute requires --rights-confirmed")
    if args.execute and args.separate and not args.allow_model_download:
        parser.error("--separate may download model weights: add --allow-model-download after checking model licensing and consent")

    plan = {
        "schema": "mcc.research.derived-media-job.v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_name": source.name,
        "status": "planned" if not args.execute else "running",
        "rights_authorized": bool(args.rights_confirmed),
        "source_kind": "original_mixed_audio",
        "separate": bool(args.separate), "transcribe": bool(args.transcribe),
        "derived_not_ground_truth": True,
        "model_attribution": {
            "separation": "Audio Separator (select and pin pretrained model/version separately)",
            "transcription": "Spotify Basic Pitch (instrument-agnostic, most effective on isolated instruments)",
        },
        "jobs": [],
        "warnings": [
            "Not a source project or the artist's actual individual trackouts.",
            "Model-derived stems may contain bleed, artifacts, and inaccurate instrument assignment.",
            "Machine-generated notes/MIDI are not fully reliable sheet music, particularly for polyphonic mixes.",
            "No results are authorized for automatic publication, profiling listeners, or medical interpretation.",
        ],
    }
    if not args.execute:
        print(json.dumps(plan, indent=2))
        return 0

    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    target_files = [source]
    if args.separate:
        stems_dir = output / "stems"
        stems_dir.mkdir(mode=0o700)
        result = run_tool("audio-separator", [
            str(source), "--output_dir", str(stems_dir), "--output_format", "WAV"
        ], cwd=output)
        result["kind"] = "source_separation"
        plan["jobs"].append(result)
        if result["status"] == "complete":
            found = sorted(p for p in stems_dir.glob("*.wav") if p.is_file())
            target_files = found if found else [source]
        else:
            plan["warnings"].append("Separation unavailable. Transcribing the mixed source would be especially uncertain.")
    if args.transcribe:
        notes_dir = output / "draft-midi"
        notes_dir.mkdir(mode=0o700)
        for f in target_files:
            if any(word in f.stem.lower() for word in ("drum", "percussion", "kick", "snare", "hat")):
                plan["jobs"].append({"kind": "note_transcription", "source": f.name,
                                     "status": "skipped", "reason": "percussion is not pitched melodic material"})
                continue
            result = run_tool("basic-pitch", [str(notes_dir), str(f)], cwd=output)
            result.update({"kind": "note_transcription", "source": f.name})
            plan["jobs"].append(result)

    midis = sorted((output / "draft-midi").glob("*.mid")) if (output / "draft-midi").exists() else []
    if midis:
        try:
            from music21 import converter
            sheet_dir = output / "draft-musicxml"
            sheet_dir.mkdir(mode=0o700)
            for midi in midis:
                try:
                    score = converter.parse(str(midi))
                    score.write("musicxml", fp=str(sheet_dir / (midi.stem + ".musicxml")))
                    plan["jobs"].append({"kind": "draft_sheet_export", "source": midi.name,
                                         "status": "complete", "human_review_required": True})
                except Exception as exc:
                    plan["jobs"].append({"kind": "draft_sheet_export", "source": midi.name,
                                         "status": "failed", "reason": str(exc)[:300]})
        except ImportError:
            plan["warnings"].append("music21 not installed; draft MIDI exists, but MusicXML was not produced.")
    plan["status"] = "complete_with_gates"
    with (output / "manifest.json").open("x", encoding="utf8") as handle:
        json.dump(plan, handle, indent=2)
    os.chmod(output / "manifest.json", 0o600)
    print(json.dumps({"output": str(output), "jobs": plan["jobs"],
                      "human_review_required": True}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as exc:
        print(f"research engine: {exc}", file=sys.stderr)
        sys.exit(1)
