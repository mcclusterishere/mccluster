#!/usr/bin/env python3
"""Get It Back: review a lyric sheet's wording and timings against what is heard.

    python review_lyrics.py lyrics/get-it-back.lyrics.json [--asr asr.json] [--out review.md] [--apply fixed.json]

Inputs
  lyrics  the production's lyric JSON: {"timed": {"line": [{"begin", "end", "content"}]}} (data/lyrics shape)
          or a list of {"start"|"begin", "end", "text"|"content"}.
  --asr   optional words heard in the audio: the JSON core/src/lyrics/asr_faster_whisper.py prints
          ({"segments": [{"words": [{"start", "end", "word", "probability"}]}]}). Run it on Prime with
          --model base.en --compute-type int8 for a CPU pass.

What it checks
  1. Matthew's confirmed wording (owner, 2026-11-28): "send it stat", "definitely getting hacked for that",
     "My pole a ghost". Each must appear in a line; where a line holds a near miss the report proposes the
     confirmed wording, and --apply writes a copy with it.
  2. With --asr, every word of every line against the words heard inside the line's time (+-0.5 s).
     A lyric word the recogniser did not hear there, or heard with probability < 0.5, is marked [?word].
     Lines where nothing was heard are marked as unchecked, never as wrong.
  Without --asr only (1) runs, and every line is reported as not yet checked against the audio.
Standard library only."""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

CONFIRMED = ["send it stat", "definitely getting hacked for that", "My pole a ghost"]
LOW_PROB = 0.5
PAD = 0.5


def norm(w: str) -> str:
    return re.sub(r"[^a-z0-9']+", "", w.lower().replace("’", "'")).strip("'")


def tokens(text: str) -> list[str]:
    return [t for t in (norm(w) for w in text.split()) if t]


def load_lines(path: Path) -> tuple[list[dict], dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = data.get("timed", {}).get("line") if isinstance(data, dict) else data
    if raw is None and isinstance(data, dict):
        raw = data.get("lines")
    if not isinstance(raw, list):
        sys.exit("Unrecognised lyric JSON: expected timed.line[] or a list of lines.")
    lines = []
    for i, l in enumerate(raw):
        lines.append({"i": i, "begin": float(l.get("begin", l.get("start", 0)) or 0), "end": float(l.get("end", 0) or 0),
                      "text": str(l.get("content", l.get("text", "")))})
    return lines, data


def load_words(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    words = [w for s in data.get("segments", []) for w in s.get("words", [])]
    return sorted(({"start": float(w["start"]), "end": float(w["end"]), "w": norm(w["word"]), "p": float(w.get("probability", 1))} for w in words if norm(w["word"])), key=lambda w: w["start"])


def find_phrase(lines: list[dict], phrase: str) -> dict:
    want = tokens(phrase)
    best = {"phrase": phrase, "found": False, "line": None, "ratio": 0.0, "near": None}
    for l in lines:
        toks = tokens(l["text"])
        for j in range(len(toks) - len(want) + 1):
            if toks[j:j + len(want)] == want:
                return {**best, "found": True, "line": l["i"], "ratio": 1.0}
        for j in range(max(1, len(toks) - len(want) + 1)):
            window = toks[j:j + len(want)]
            r = difflib.SequenceMatcher(None, " ".join(want), " ".join(window)).ratio()
            if r > best["ratio"]:
                best = {**best, "line": l["i"], "ratio": round(r, 3), "near": " ".join(window), "at": j}
    return best


def apply_phrase(text: str, near_start: int, n: int, phrase: str) -> str:
    """Replace the n words starting at word index near_start (counted on non-empty tokens) with phrase."""
    words = text.split()
    idx = [k for k, w in enumerate(words) if norm(w)]
    if near_start + n > len(idx):
        return text
    a, b = idx[near_start], idx[near_start + n - 1]
    tail = re.sub(r"^[\w'’]+", "", words[b])  # keep trailing punctuation
    if words[a][:1].isupper():
        phrase = phrase[:1].upper() + phrase[1:]
    return " ".join(words[:a] + [phrase + tail] + words[b + 1:])


def check_line(line: dict, heard: list[dict]) -> dict:
    inside = [w for w in heard if w["end"] >= line["begin"] - PAD and w["start"] <= line["end"] + PAD]
    words = line["text"].split()
    lyr = [norm(w) for w in words]
    if not inside:
        return {"status": "unchecked (nothing heard in this line's time)", "marked": line["text"], "unclear": []}
    sm = difflib.SequenceMatcher(None, lyr, [w["w"] for w in inside], autojunk=False)
    ok = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            ok[blk.a + k] = inside[blk.b + k]
    unclear, out = [], []
    for k, w in enumerate(words):
        if not lyr[k]:
            out.append(w)
            continue
        hit = ok.get(k)
        if hit is None or hit["p"] < LOW_PROB:
            unclear.append({"word": w, "reason": "not heard here" if hit is None else f"heard with low confidence ({hit['p']:.2f})"})
            out.append(f"[?{w}]")
        else:
            out.append(w)
    return {"status": "checked", "marked": " ".join(out), "unclear": unclear}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("lyrics", type=Path)
    ap.add_argument("--asr", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--apply", type=Path, help="write a copy of the lyric JSON with the confirmed wording applied")
    ap.add_argument("--confirmed", action="append", help="override the confirmed phrases (repeat)")
    a = ap.parse_args(argv)
    lines, data = load_lines(a.lyrics)
    confirmed = a.confirmed or CONFIRMED
    heard = load_words(a.asr) if a.asr else None
    phrases = [find_phrase(lines, p) for p in confirmed]
    rows = [{**l, **(check_line(l, heard) if heard is not None else {"status": "not checked against audio (no --asr)", "marked": l["text"], "unclear": []})} for l in lines]

    md = [f"# Lyric review: {a.lyrics.name}", "", "## Confirmed wording (Matthew)", ""]
    for p in phrases:
        if p["found"]:
            md.append(f"- \"{p['phrase']}\": present, line {p['line'] + 1}.")
        elif p["line"] is not None and p["ratio"] >= 0.5:
            md.append(f"- \"{p['phrase']}\": **not present**. Line {p['line'] + 1} has \"{p['near']}\" ({p['ratio']:.0%} similar); propose the confirmed wording.")
        else:
            md.append(f"- \"{p['phrase']}\": **not present** and no near line. Place it by ear against the audio.")
    md += ["", "## Lines", "", "Words marked `[?word]` were not heard where the sheet puts them, or only with low confidence. Check them by ear.", ""]
    for r in rows:
        md.append(f"{r['i'] + 1}. `{r['begin']:7.2f}–{r['end']:7.2f}` {r['marked']}" + ("" if r["status"] == "checked" else f"  _({r['status']})_"))
    n_unclear = sum(len(r["unclear"]) for r in rows)
    md += ["", f"Summary: {len(lines)} lines; {n_unclear} unclear word(s); "
           f"{sum(1 for p in phrases if p['found'])}/{len(phrases)} confirmed phrases present; "
           + ("checked against the recogniser." if heard is not None else "not yet checked against the audio.")]
    report = "\n".join(md) + "\n"
    out = a.out or a.lyrics.with_suffix(".review.md")
    out.write_text(report, encoding="utf-8")
    out.with_suffix(".json").write_text(json.dumps({"phrases": phrases, "lines": rows, "unclear_words": n_unclear, "asr": str(a.asr) if a.asr else None}, indent=2), encoding="utf-8")

    if a.apply:
        fixed = json.loads(json.dumps(data))
        target = fixed["timed"]["line"] if isinstance(fixed, dict) and "timed" in fixed else fixed
        key = "content" if target and "content" in target[0] else "text"
        for p in phrases:
            if not p["found"] and p["line"] is not None and p["ratio"] >= 0.5:
                t = target[p["line"]]
                t[key] = apply_phrase(t[key], p["at"], len(tokens(p["near"])), p["phrase"])
        a.apply.write_text(json.dumps(fixed, indent=2, ensure_ascii=False), encoding="utf-8")
    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
