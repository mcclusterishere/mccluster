"""McCluster production adapter: Faster Whisper transcript of one media file (Shiloh). Offline.

    python -I transcript.py --media <file> --model large-v3-turbo --language en --out <file.json> [--words] [--models-dir <dir>]

Writes mccluster-transcript/1: segments with start/end seconds, text, average log probability, and (with --words)
word timestamps with probabilities. Nothing is uploaded; the model is loaded from the local cache or --models-dir
(never downloaded here: the owner installs models deliberately).
"""
import argparse, hashlib, json, os, platform, socket, sys, time

ap = argparse.ArgumentParser()
ap.add_argument("--media", required=True)
ap.add_argument("--model", required=True)
ap.add_argument("--language", default="en")
ap.add_argument("--out", required=True)
ap.add_argument("--words", action="store_true")
ap.add_argument("--models-dir")
a = ap.parse_args()

from faster_whisper import WhisperModel  # noqa: E402
import faster_whisper  # noqa: E402

h = hashlib.sha256()
with open(a.media, "rb") as fh:
    for chunk in iter(lambda: fh.read(1 << 20), b""):
        h.update(chunk)
started = time.time()
model = WhisperModel(a.model, device="auto", compute_type="auto", download_root=a.models_dir, local_files_only=True)
segments, info = model.transcribe(a.media, language=a.language, word_timestamps=a.words, vad_filter=True)
out = []
for s in segments:
    item = {"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip(), "avg_logprob": round(s.avg_logprob, 4)}
    if a.words and s.words:
        item["words"] = [{"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word, "p": round(w.probability, 4)} for w in s.words]
    out.append(item)
doc = {"schema": "mccluster-transcript/1", "media_sha256": h.hexdigest(), "model": a.model, "language": info.language,
       "language_probability": round(info.language_probability, 4), "duration_s": round(info.duration, 3),
       "engine": "faster-whisper", "engine_version": getattr(faster_whisper, "__version__", None),
       "worker": {"host": socket.gethostname(), "platform": platform.platform()}, "elapsed_s": round(time.time() - started, 2),
       "reviewed": False, "segments": out}
tmp = a.out + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
os.replace(tmp, a.out)
print("transcript ok: %d segments" % len(out))
