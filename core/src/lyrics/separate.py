#!/usr/bin/env python3
"""McCluster lyric machine, stage 1: source separation (owned, self-hosted).

Splits one track into stems with Demucs (open weights, MIT). The default is the
six-stem htdemucs_6s (vocals, drums, bass, guitar, piano, other); --model htdemucs
gives four stems (vocals, drums, bass, other). It always also writes:

  instrumental.<ext>   every stem except vocals, summed
  vocals16k.wav        the vocal stem as 16 kHz mono for the recogniser/aligner
  manifest.json        model, stems, durations, sizes, peak/RMS levels

Stems are the owner's unreleased material: they are written to a local folder
(gitignored) or a private bucket, never to the public repository.

Usage: separate.py AUDIO OUTDIR [--model htdemucs_6s] [--format mp3|flac] [--threads N]
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

SR = 44100
HEADROOM = 10 ** (-1.0 / 20)  # -1 dBFS: room for the MP3 encoder's own overshoot


def decode(path, sr=SR, channels=2):
    import numpy as np
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-map", "0:a:0", "-vn",
         "-ac", str(channels), "-ar", str(sr), "-f", "f32le", "-"],
        check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, channels).T.copy()


def encode(samples, path, fmt, sr=SR):
    """samples: (channels, n) float32 -> file via ffmpeg (no metadata)."""
    import numpy as np
    ch = samples.shape[0]
    args = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
            "-map_metadata", "-1"]
    if fmt == "flac":
        args += ["-c:a", "flac", "-sample_fmt", "s16", "-compression_level", "8"]
    elif fmt == "mp3":
        args += ["-c:a", "libmp3lame", "-b:a", "320k"]
    elif fmt == "wav":
        args += ["-c:a", "pcm_s16le"]
    subprocess.run(args + [path], input=np.ascontiguousarray(samples.T, dtype=np.float32).tobytes(), check=True)


def levels(x):
    import numpy as np
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(x)))) if x.size else 0.0
    db = lambda v: round(20 * np.log10(v), 2) if v > 1e-9 else None
    return {"peak_dbfs": db(peak), "rms_dbfs": db(rms)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("outdir")
    ap.add_argument("--model", default=os.environ.get("LYRICS_SEPARATOR_MODEL", "htdemucs_6s"))
    ap.add_argument("--format", default=os.environ.get("STEMS_FORMAT", "mp3"), choices=["mp3", "flac", "wav"])
    ap.add_argument("--threads", type=int, default=int(os.environ.get("LYRICS_THREADS", "0")))
    ap.add_argument("--vocals-only", action="store_true", help="write only vocals16k.wav (lyrics need nothing else)")
    args = ap.parse_args()

    import numpy as np
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    if args.threads:
        torch.set_num_threads(args.threads)
    os.makedirs(args.outdir, exist_ok=True)
    t0 = time.time()
    model = get_model(args.model)
    model.eval()
    wav = decode(args.audio, model.samplerate)
    ref = wav.mean(0)
    mean, std = float(ref.mean()), float(ref.std()) or 1.0
    x = torch.from_numpy((wav - mean) / std)[None]
    with torch.no_grad():
        out = apply_model(model, x, shifts=0, split=True, overlap=0.25, progress=False)[0]
    out = out.numpy() * std + mean
    t_sep = time.time() - t0

    names = list(model.sources)
    stems = {n: out[i] for i, n in enumerate(names)}
    stems_meta = []
    gain_db = 0.0
    if not args.vocals_only:
        inst = sum(v for n, v in stems.items() if n != "vocals")
        # Separated stems (and their sum) routinely peak above full scale: a mastered
        # mix sits at 0 dBFS and the model's float output overshoots it (measured up
        # to +3 dBFS here). Written as-is they clip. One shared gain on every file
        # keeps the stems' balance, so they still add back up to the (quieter) mix.
        peak = max(float(np.max(np.abs(v))) for v in list(stems.values()) + [inst])
        if peak > HEADROOM:
            g = HEADROOM / peak
            gain_db = round(20 * np.log10(g), 2)
            stems = {n: v * g for n, v in stems.items()}
            inst = inst * g
        for n, v in list(stems.items()) + [("instrumental", inst)]:
            p = os.path.join(args.outdir, f"{n}.{args.format}")
            encode(v, p, args.format, model.samplerate)
            with open(p, "rb") as fh:
                digest = hashlib.sha256(fh.read()).hexdigest()
            stems_meta.append({"stem": n, "file": os.path.basename(p), "format": args.format,
                               "bytes": os.path.getsize(p), "sha256": digest,
                               "seconds": round(v.shape[1] / model.samplerate, 3), **levels(v)})
    # the recogniser and aligner want 16 kHz mono
    voc = stems["vocals"].mean(0)
    import math
    n16 = int(math.floor(len(voc) * 16000 / model.samplerate))
    voc16 = np.interp(np.linspace(0, len(voc) - 1, n16), np.arange(len(voc)), voc).astype(np.float32)
    encode(voc16[None], os.path.join(args.outdir, "vocals16k.wav"), "wav", 16000)

    manifest = {
        "version": 1, "separator": "demucs", "model": args.model, "stems": stems_meta, "gain_db": gain_db,
        "sources": names, "samplerate": model.samplerate, "format": args.format,
        "seconds": round(wav.shape[1] / model.samplerate, 3),
        "timing": {"separate_seconds": round(t_sep, 1), "total_seconds": round(time.time() - t0, 1)},
    }
    with open(os.path.join(args.outdir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    json.dump(manifest, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
