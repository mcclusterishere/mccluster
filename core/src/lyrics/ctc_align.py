#!/usr/bin/env python3
"""McCluster lyric machine, stage 3: word timing by forced alignment.

WhisperX-style: Whisper's own word times are approximate (they come from
cross-attention), so each line's words are force-aligned to the isolated vocal
with a wav2vec2 CTC acoustic model (torchaudio WAV2VEC2_ASR_BASE_960H, English,
open weights). The line text is the owner's sheet where there is one, so this is
alignment of the words the owner wrote, not recognition.

Input:  a lyrics JSON from align.mjs (lines already placed in time) + vocals 16 kHz
Output: the same JSON with refined word times, lines snapped to their words, and
        per-line "align_score" (mean CTC frame probability of the line's words).
Lines whose alignment is weak keep their earlier times.

Usage: ctc_align.py LYRICS.json VOCALS16K.wav OUT.json
"""
import json
import re
import subprocess
import sys
import time

PAD = 0.6          # seconds of context either side of a line window
MIN_SCORE = 0.12   # below this a line keeps its Whisper/interpolated timing


def load(path):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000",
                          "-f", "f32le", "-"], check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


NUM = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
       "7": "seven", "8": "eight", "9": "nine", "10": "ten", "66": "sixty six", "100": "hundred",
       "2015": "twenty fifteen", "2023": "twenty twenty three"}


def spell(word):
    w = word.lower().replace("’", "'").replace("‘", "'")
    w = re.sub(r"[^a-z0-9' ]+", " ", w).strip()
    if w in NUM:
        w = NUM[w]
    w = re.sub(r"\d+", lambda m: " ".join(NUM.get(c, "") for c in m.group(0)), w)
    return re.sub(r"[^a-z' ]+", "", w).strip()


def main() -> int:
    doc = json.load(open(sys.argv[1]))
    audio_path = sys.argv[2]
    import numpy as np
    import torch
    import torchaudio
    from torchaudio.pipelines import WAV2VEC2_ASR_BASE_960H as BUNDLE

    t0 = time.time()
    torch.set_num_threads(int(__import__("os").environ.get("LYRICS_THREADS", "0")) or torch.get_num_threads())
    import contextlib
    with contextlib.redirect_stdout(sys.stderr):  # download notices must not reach the output
        model = BUNDLE.get_model().eval()
    labels = BUNDLE.get_labels()          # ('-', '|', 'E', 'T', ...), '-' is blank
    index = {c: i for i, c in enumerate(labels)}
    wav = load(audio_path)
    sr = BUNDLE.sample_rate
    total = len(wav) / sr

    with torch.inference_mode():
        lines = doc["timed"]["line"]
        aligned = 0
        for i, line in enumerate(lines):
            words = line.get("words") or []
            spoken = [(k, spell(w["content"])) for k, w in enumerate(words)]
            spoken = [(k, s) for k, s in spoken if s]
            if not spoken:
                continue
            lo = max(0.0, line["begin"] - PAD)
            hi = min(total, line["end"] + PAD)
            if hi - lo < 0.3:
                continue
            seg = torch.from_numpy(wav[int(lo * sr):int(hi * sr)])[None]
            emission, _ = model(seg)
            emission = torch.log_softmax(emission, dim=-1)[0]
            transcript = "|".join(s.upper().replace(" ", "|") for _, s in spoken)
            targets = [index[c] for c in transcript if c in index]
            if not targets or len(targets) > emission.shape[0]:
                continue
            ali, scores = torchaudio.functional.forced_align(emission[None], torch.tensor([targets], dtype=torch.int32), blank=0)
            ali, scores = ali[0], scores[0].exp()
            spans = torchaudio.functional.merge_tokens(ali, scores)
            # group character spans into words at '|'
            ratio = (hi - lo) / emission.shape[0]
            groups, cur = [], []
            sep = index["|"]
            for sp in spans:
                if sp.token == sep:
                    if cur:
                        groups.append(cur)
                    cur = []
                else:
                    cur.append(sp)
            if cur:
                groups.append(cur)
            # words spelt as two ("twenty fifteen") come back as several groups: re-merge by count
            want = [len(s.split(" ")) for _, s in spoken]
            if sum(want) != len(groups):
                continue
            merged, g = [], 0
            for n in want:
                part = [sp for grp in groups[g:g + n] for sp in grp]
                merged.append(part)
                g += n
            score = float(np.mean([sp.score for part in merged for sp in part]))
            line["align_score"] = round(score, 3)
            if score < MIN_SCORE:
                continue
            for (k, _), part in zip(spoken, merged):
                words[k]["begin"] = round(lo + part[0].start * ratio, 3)
                words[k]["end"] = round(lo + (part[-1].end) * ratio, 3)
            aligned += 1

    machine = doc.setdefault("machine", {})
    eng = machine.get("engine")
    if not isinstance(eng, dict):
        eng = {"asr": f"{eng or 'unknown'} {machine.get('model', '')}".strip()}
    eng["aligner"] = "wav2vec2 CTC (torchaudio WAV2VEC2_ASR_BASE_960H)"
    machine["engine"] = eng
    machine["ctc_aligned_lines"] = aligned
    machine.setdefault("timing", {})["align_seconds"] = round(time.time() - t0, 1)
    with open(sys.argv[3], "w") as fh:
        json.dump(doc, fh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
