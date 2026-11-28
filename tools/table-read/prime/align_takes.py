#!/usr/bin/env python3
"""TABLE READ on Prime: line up the takes from one Table Read.

    python align_takes.py <takes_dir> [--session <room>.session.json] [--out <dir>]

<takes_dir> holds what the phones exported (or what the host received): for each
person a media file (.webm or .mp4) and its <same name>.take.json manifest
(schema mccluster-table-read-take/1, written by js/table-read/take-store.js).

For every take it:
  1. decodes the microphone to 16 kHz mono with ffmpeg;
  2. finds the 1 kHz sync beep near where the device's own clock says the sync
     cue fired (+-600 ms); if the beep is not in the recording (echo cancellation
     can remove a phone's own beep) it uses the timestamp alone and says so;
  3. trims each track's head so every take's first sync cue lands at the same
     instant, and measures drift between the first and last sync cue against
     the room server's clock;
  4. writes one aligned 48 kHz WAV per role and alignment.json: the trims, drift,
     how each sync was found, and the shot list (one shot per script line, from
     the cue changes every device logged).

Standard library plus ffmpeg on PATH. Nothing is uploaded. The same rules as
js/table-read/sync.js (alignOnCue, takeDrift)."""
from __future__ import annotations

import argparse
import array
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

RATE = 16000
BEEP_HZ = 1000.0
WINDOW_MS = 20
HOP_MS = 5
SEARCH_MS = 600
DRIFT_FIX_PPM = 150  # above this, the aligned WAV is tempo-corrected


def ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        sys.exit("ffmpeg is not on PATH. Blender does not ship one on Windows; install ffmpeg or set PATH.")
    return exe


def decode_pcm(media: Path) -> array.array:
    out = subprocess.run([ffmpeg(), "-v", "error", "-i", str(media), "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"],
                         check=True, capture_output=True).stdout
    pcm = array.array("h")
    pcm.frombytes(out[: len(out) - len(out) % 2])
    if sys.byteorder == "big":
        pcm.byteswap()
    return pcm


def goertzel(pcm: array.array, start: int, n: int, hz: float = BEEP_HZ) -> float:
    k = 2.0 * math.cos(2.0 * math.pi * hz / RATE)
    s1 = s2 = 0.0
    end = min(len(pcm), start + n)
    for i in range(max(0, start), end):
        s0 = pcm[i] + k * s1 - s2
        s2, s1 = s1, s0
    return s1 * s1 + s2 * s2 - k * s1 * s2


def find_beep(pcm: array.array, expect_ms: float) -> float | None:
    """Onset (ms) of the strongest 1 kHz burst within SEARCH_MS of expect_ms, or None."""
    n = RATE * WINDOW_MS // 1000
    hop = RATE * HOP_MS // 1000
    lo = int((expect_ms - SEARCH_MS) * RATE / 1000)
    hi = int((expect_ms + SEARCH_MS) * RATE / 1000)
    if hi <= 0 or lo >= len(pcm):
        return None
    energies = [(i, goertzel(pcm, i, n)) for i in range(max(0, lo), max(0, min(hi, len(pcm) - n)), hop)]
    if len(energies) < 10:
        return None
    vals = sorted(e for _, e in energies)
    floor = vals[len(vals) // 2] + 1.0
    peak_i, peak = max(energies, key=lambda x: x[1])
    if peak < floor * 40:  # not clearly above the background at 1 kHz
        return None
    coarse = next(i for i, e in energies if e >= peak / 4)  # onset: first window above a quarter of the peak
    fine_hop = max(1, RATE // 1000)  # then step 1 ms around it
    for i in range(max(0, coarse - hop), coarse + hop + 1, fine_hop):
        if goertzel(pcm, i, n) >= peak / 4:
            return (i + n / 2) * 1000.0 / RATE
    return (coarse + n / 2) * 1000.0 / RATE


def load_takes(folder: Path) -> list[dict]:
    takes = []
    for mf in sorted(folder.glob("*.take.json")):
        m = json.loads(mf.read_text(encoding="utf-8"))
        if m.get("schema") != "mccluster-table-read-take/1":
            continue
        stem = mf.name[: -len(".take.json")]
        media = next((p for p in (folder / f"{stem}.webm", folder / f"{stem}.mp4") if p.exists()), None)
        if not media:
            print(f"skip {mf.name}: no media file named {stem}.webm or .mp4", file=sys.stderr)
            continue
        takes.append({"manifest": m, "media": media, "stem": stem})
    return takes


def align(takes: list[dict]) -> dict:
    rows = []
    for t in takes:
        m = t["manifest"]
        pcm = decode_pcm(t["media"])
        syncs = []
        for s in m.get("sync", []):
            stamped = s.get("in_take_ms")
            if stamped is None:
                continue
            found = find_beep(pcm, stamped)
            syncs.append({"id": s["id"], "server_at": s["server_at"], "stamped_ms": stamped,
                          "beep_ms": found, "used_ms": found if found is not None else stamped,
                          "source": "beep" if found is not None else "timestamp",
                          "clock_error_ms": None if found is None else round(found - stamped, 1)})
        drift = None
        if len(syncs) >= 2:
            a, b = syncs[0], syncs[-1]
            server = b["server_at"] - a["server_at"]
            if server > 0:
                drift = ((b["used_ms"] - a["used_ms"]) - server) / server * 1e6
        rows.append({"seat": m["seat_id"], "role": m.get("role") or m["seat_id"], "name": m.get("name"),
                     "media": t["media"].name, "duration_ms": round(len(pcm) * 1000 / RATE, 1),
                     "started_device_t": m.get("started_device_t"), "syncs": syncs,
                     "drift_ppm": None if drift is None else round(drift, 1),
                     "clock": m.get("clock"), "interrupted": bool(m.get("interrupted")),
                     "lines": m.get("lines", []), "video": m.get("video"), "scratch": bool(m.get("scratch"))})

    anchored = [r for r in rows if r["syncs"]]
    if anchored:
        first = min(r["syncs"][0]["used_ms"] for r in anchored)
        spread = max(r["syncs"][0]["used_ms"] for r in anchored) - first
        for r in rows:
            r["trim_head_ms"] = round(r["syncs"][0]["used_ms"] - first, 1) if r["syncs"] else 0.0
            r["aligned_by"] = r["syncs"][0]["source"] if r["syncs"] else "none (no sync cue: align by ear on the clap)"
    else:
        spread = None
        for r in rows:
            r["trim_head_ms"] = 0.0
            r["aligned_by"] = "none (no sync cue: align by ear on the clap)"
    return {"takes": rows, "spread_before_ms": None if spread is None else round(spread, 1)}


def shot_list(result: dict, session: dict | None) -> list[dict]:
    """One shot per script line, timed on the aligned timeline from the take with the most cue changes."""
    best = max(result["takes"], key=lambda r: len(r["lines"]), default=None)
    if not best or not best["lines"] or best["started_device_t"] is None:
        return []
    lines = (session or {}).get("scene", {}).get("lines", [])
    seen, shots = set(), []
    for ev in sorted(best["lines"], key=lambda e: e["device_t"]):
        start = ev["device_t"] - best["started_device_t"] - best["trim_head_ms"]
        if shots and shots[-1]["index"] == ev["index"]:
            continue
        if shots:
            shots[-1]["end_ms"] = round(start, 1)
        line = lines[ev["index"]] if 0 <= ev["index"] < len(lines) else {}
        key = ev["index"]
        shots.append({"shot": f"line-{key:03d}" + (f"-{sum(1 for s in shots if s['index'] == key)}" if key in seen else ""),
                      "index": key, "speaker": line.get("speaker"), "kind": line.get("kind"), "text": line.get("text"),
                      "start_ms": round(max(0.0, start), 1), "end_ms": None})
        seen.add(key)
    if shots:
        shots[-1]["end_ms"] = round(best["duration_ms"] - best["trim_head_ms"], 1)
    return shots


def write_wavs(result: dict, folder: Path, out: Path) -> None:
    for r in result["takes"]:
        dest = out / f"voice_{r['role'].lower().replace(' ', '-')}.wav"
        filters = []
        if r["drift_ppm"] is not None and abs(r["drift_ppm"]) > DRIFT_FIX_PPM:
            filters.append(f"atempo={1 + r['drift_ppm'] / 1e6:.6f}")
        cmd = [ffmpeg(), "-v", "error", "-y", "-ss", f"{r['trim_head_ms'] / 1000:.3f}", "-i", str(folder / r["media"]),
               "-vn", "-ac", "1", "-ar", "48000"]
        if filters:
            cmd += ["-af", ",".join(filters)]
        subprocess.run(cmd + [str(dest)], check=True)
        r["aligned_wav"] = dest.name
        r["tempo_corrected"] = bool(filters)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("takes_dir", type=Path)
    ap.add_argument("--session", type=Path, help="the host's <room>.session.json (script lines for the shot list)")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--take", help="take_id to align when the folder holds several")
    a = ap.parse_args(argv)
    out = a.out or a.takes_dir / "aligned"
    out.mkdir(parents=True, exist_ok=True)
    takes = load_takes(a.takes_dir)
    ids = sorted({t["manifest"]["take_id"] for t in takes})
    if a.take:
        takes = [t for t in takes if t["manifest"]["take_id"] == a.take]
    elif len(ids) > 1:
        pick = max(ids, key=lambda i: (sum(1 for t in takes if t["manifest"]["take_id"] == i), i))
        print(f"several takes here ({', '.join(ids)}); aligning {pick}. Use --take to choose.", file=sys.stderr)
        takes = [t for t in takes if t["manifest"]["take_id"] == pick]
    if not takes:
        print("No takes found (need <name>.webm or .mp4 next to <name>.take.json).", file=sys.stderr)
        return 2
    session = json.loads(a.session.read_text(encoding="utf-8")) if a.session else None
    if session is None:
        found = sorted(a.takes_dir.glob("*.session.json"))
        session = json.loads(found[-1].read_text(encoding="utf-8")) if found else None
    result = align(takes)
    write_wavs(result, a.takes_dir, out)
    result["shots"] = shot_list(result, session)
    result["schema"] = "mccluster-table-read-alignment/1"
    result["source_dir"] = str(a.takes_dir)
    (out / "alignment.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    for r in result["takes"]:
        how = ", ".join(f"{s['id']} {s['source']}" + (f" (clock {s['clock_error_ms']:+.0f} ms)" if s["clock_error_ms"] is not None else "") for s in r["syncs"]) or "no sync cue"
        print(f"{r['role']:<12} trim {r['trim_head_ms']:>7.1f} ms  drift {r['drift_ppm'] if r['drift_ppm'] is not None else '-':>8} ppm  {how}  -> {r['aligned_wav']}")
    print(f"spread before alignment: {result['spread_before_ms']} ms; {len(result['shots'])} shots; {out / 'alignment.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
