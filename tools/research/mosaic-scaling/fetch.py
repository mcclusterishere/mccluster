"""Bounded pilot: no tokens, no bulk archive, cache outside the repository."""
import argparse
import csv
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import urllib.request

INDEX = "https://doi.pangaea.de/10.1594/PANGAEA.958449?format=textfile"
BASE = "https://download.pangaea.de/dataset/958449/files/"
FIRST = dt.date(2019, 10, 14)
STOP = dt.date(2020, 1, 13)
RX = re.compile(r"pairs_\d{8}T\d+_\d{8}T\d+_drift_and_deformation\.nc")
MAX_BYTES = 96 * 1024 * 1024


def select(text):
    lines = text.split("*/", 1)[-1].strip().splitlines()
    chosen = {}
    for row in csv.DictReader(lines, delimiter="\t"):
        start, end = (dt.datetime.fromisoformat(row[k]) for k in ("Date/Time (start)", "Date/Time (end)"))
        name = row["netCDF"]
        if not RX.fullmatch(name):
            raise ValueError("unexpected dataset filename")
        week = start.date() - dt.timedelta(days=start.weekday())
        hours = (end - start).total_seconds() / 3600
        if FIRST <= week < STOP and 22 <= hours <= 26 and end.date() < week + dt.timedelta(days=7):
            rec = dict(week=week.isoformat(), start=start.isoformat(), end=end.isoformat(), hours=hours, file=name)
            if week not in chosen or (rec["start"], name) < (chosen[week]["start"], chosen[week]["file"]):
                chosen[week] = rec
    return [chosen[k] for k in sorted(chosen)]


def fetch(url, dest, cap):
    part = dest.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=120) as resp, part.open("wb") as out:
        count = 0
        while chunk := resp.read(1024 * 1024):
            count += len(chunk)
            if count > cap:
                raise ValueError("file exceeded byte limit")
            out.write(chunk)
    part.replace(dest)


def sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("cache", type=Path)
    p.add_argument("--download", action="store_true", help="retrieve bounded pilot, approximately 0.6 GB")
    a = p.parse_args()
    a.cache.mkdir(parents=True, exist_ok=True)
    idx = a.cache / "index.tsv"
    if not idx.exists():
        fetch(INDEX, idx, 2 * 1024 * 1024)
    records = select(idx.read_text(encoding="utf-8-sig"))
    for r in records:
        if a.download:
            path = a.cache / r["file"]
            if not path.exists():
                fetch(BASE + r["file"], path, MAX_BYTES)
            r["sha256"] = sha(path)
        print(r["week"], r["file"], flush=True)
    (a.cache / "selection.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

