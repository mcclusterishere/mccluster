#!/usr/bin/env python3
"""McCluster lyric machine: speech recognition step (owned, self-hosted).

Runs faster-whisper (CTranslate2, open weights, no API, no per-call cost) over
one audio file and prints recognised words with their times as JSON on stdout.
Alignment to the owner's lyric sheet and the data/lyrics JSON shape are done in
Node (core/src/lyrics/align.mjs) so the CLI and the Core executor share them.

The audio is data: it is decoded by PyAV/ffmpeg inside faster-whisper and never
executed. The prompt file is plain text, read with a size cap.

Usage: asr_faster_whisper.py AUDIO [--model medium.en] [--prompt-file sheet.txt]
                             [--language en] [--compute-type int8] [--threads N]
"""
import argparse
import json
import os
import re
import sys
import time

PROMPT_MAX_CHARS = 900
# Whisper's stock hallucinations on music/silence (it was trained on subtitled video).
HALLUCINATION = re.compile(r"thanks? (you )?for watching|subscribe|like and share|subtitles? by|"
                           r"transcri(bed|ption) by|amara\.org|see you (in the )?next|www\.|\.com\b", re.I)  # Whisper keeps ~224 prompt tokens; the tail is what counts


def decode(path: str):
    """ffmpeg -> 16 kHz mono float32. ffmpeg only demuxes/decodes the file; the
    container's own tags and cover art are never interpreted."""
    import subprocess
    import numpy as np
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-map", "0:a:0", "-vn", "-ac", "1",
         "-ar", "16000", "-f", "f32le", "-"],
        check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def seg_json(s, offset, pass_no):
    return {
        "start": round(s.start + offset, 3), "end": round(s.end + offset, 3), "text": s.text.strip(),
        "avg_logprob": round(s.avg_logprob, 4), "no_speech_prob": round(s.no_speech_prob, 4), "pass": pass_no,
        "words": [{"start": round(w.start + offset, 3), "end": round(w.end + offset, 3), "word": w.word.strip(),
                   "probability": round(w.probability, 4)} for w in (s.words or []) if w.word.strip()],
    }


def gaps(segments, total, min_gap):
    """Stretches of at least min_gap seconds with no recognised word."""
    times = sorted((w["start"], w["end"]) for s in segments for w in s["words"])
    out, cursor = [], 0.0
    for a, b in times:
        if a - cursor >= min_gap:
            out.append((cursor, a))
        cursor = max(cursor, b)
    if total - cursor >= min_gap:
        out.append((cursor, total))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--model", default=os.environ.get("LYRICS_ASR_MODEL", "medium.en"))
    ap.add_argument("--prompt-file", default=None)
    ap.add_argument("--language", default="en")
    ap.add_argument("--compute-type", default=os.environ.get("LYRICS_ASR_COMPUTE", "int8"))
    ap.add_argument("--threads", type=int, default=int(os.environ.get("LYRICS_ASR_THREADS", "0")))
    ap.add_argument("--beam-size", type=int, default=5)
    ap.add_argument("--gap-seconds", type=float, default=6.0)
    args = ap.parse_args()

    from faster_whisper import WhisperModel  # imported late so --help works without it

    prompt = None
    if args.prompt_file:
        with open(args.prompt_file, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read(64 * 1024)
        # Section labels ("Hook:", "Verse 1:") are not sung; keep the words only.
        lines = [l.strip() for l in text.splitlines()]
        words = " ".join(l for l in lines if l and not l.rstrip().endswith(":"))
        prompt = words[:PROMPT_MAX_CHARS] or None

    audio = decode(args.audio)
    t0 = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type=args.compute_type,
                         cpu_threads=args.threads or 0)
    segments, info = model.transcribe(
        audio,
        language=args.language,
        beam_size=args.beam_size,
        word_timestamps=True,
        initial_prompt=prompt,
        condition_on_previous_text=False,  # stops the repeat-loop hallucination on hooks
        vad_filter=False,  # VAD is trained on speech and drops sung/rapped vocals over beats
        temperature=[0.0, 0.2, 0.4],
    )
    out = [seg_json(s, 0.0, 1) for s in segments]

    # Second pass: Whisper often skips a sung intro or a hook over a loud beat and
    # resumes later. Re-listen to every long stretch with no words, unprompted (a
    # prompt there tends to be echoed back rather than heard), and keep what it hears.
    sr = 16000
    total = len(audio) / sr
    for a, b in gaps(out, total, args.gap_seconds):
        lo, hi = max(0.0, a - 0.5), min(total, b + 3.0)  # run into the next heard words for context
        segs, _ = model.transcribe(
            audio[int(lo * sr):int(hi * sr)], language=args.language, beam_size=args.beam_size,
            word_timestamps=True, condition_on_previous_text=False, vad_filter=False,
            temperature=[0.0, 0.2, 0.4], no_speech_threshold=0.9, log_prob_threshold=-2.0)
        for sg in segs:
            j = seg_json(sg, lo, 2)
            j["words"] = [w for w in j["words"] if a - 0.5 <= w["start"] and w["end"] <= b + 0.5]
            if j["words"] and not HALLUCINATION.search(j["text"]):
                out.append(j)
    out.sort(key=lambda x: x["start"])

    json.dump({
        "engine": "faster-whisper", "model": args.model, "language": info.language,
        "duration": round(len(audio) / 16000, 3), "prompted": bool(prompt),
        "elapsed_seconds": round(time.time() - t0, 1), "segments": out,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
