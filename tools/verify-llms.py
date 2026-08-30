#!/usr/bin/env python3
"""Check that llms.txt is TRUE.

An llms.txt is a set of promises made directly to a machine that will act
on them without a human reading first. A stale one is worse than none: it
sends an agent to a 404, or has it quote a count that changed six weeks
ago, and nobody notices because no person ever looks at the file.

So every factual claim in llms.txt gets checked here:

  - every local link resolves to a file that exists in the repo
  - every stated count matches the data file it describes
  - every documented API endpoint actually answers (with --live)

Run:  python3 tools/verify-llms.py [--live]
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://matthew.mccluster.org/"
LLMS = os.path.join(ROOT, "llms.txt")
live = "--live" in sys.argv

text = open(LLMS).read()
fails = []


def check(label, ok, why=""):
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"\n         {why}"))
    if not ok:
        fails.append(label)


# ---- 1. every on-site link points at something that exists ----------
print("\n-- the links go somewhere --")
for url in sorted(set(re.findall(r'\((' + re.escape(SITE) + r'[^)\s]*)\)', text))):
    path = url[len(SITE):].split("?")[0].split("#")[0]
    if not path:
        continue
    check(f"{path} exists", os.path.isfile(os.path.join(ROOT, path)),
          "llms.txt links it but the repo has no such file")

# ---- 2. every count it states is the real count ---------------------
print("\n-- the numbers are the numbers --")


def count_in(rel, key):
    with open(os.path.join(ROOT, rel)) as fh:
        d = json.load(fh)
    v = d[key] if isinstance(d, dict) else d
    return len(v)


# (claim as written in llms.txt, data file, key)
CLAIMS = [
    (r"(\d+) programs, (\d+) sources", "data/eu-fellowships.json", ["fellowships", "sources"]),
    (r"(\d+) tracks with ISRCs",       "data/catalogue.json",      ["tracks"]),
    (r"(\d+) items",                   "data/portfolio.json",      ["items"]),
]
for pattern, rel, keys in CLAIMS:
    m = re.search(pattern, text)
    if not m:
        check(f"{rel}: the claim is still in llms.txt", False,
              f"no text matching /{pattern}/ — did the wording change?")
        continue
    for i, key in enumerate(keys):
        said, real = int(m.group(i + 1)), count_in(rel, key)
        check(f"{rel} {key}: says {said}", said == real, f"the file holds {real}")

# topics are named individually, so check the slugs rather than a count
with open(os.path.join(ROOT, "data/eu-topics.json")) as fh:
    slugs = {t["slug"] for t in json.load(fh)["topics"]}
named = set(re.findall(r"`([a-z-]+)`", text)) & {
    "us-israel", "data-centers", "surveillance-and-tracking"}
check("every topic slug named in llms.txt exists", named <= slugs,
      f"named but missing from the data: {named - slugs}")
check("every topic in the data is named in llms.txt", slugs <= named,
      f"in the data but unnamed: {slugs - named}")

# ---- 3. the desks it calls closed are actually disallowed ----------
print("\n-- the closed doors are closed --")
robots = open(os.path.join(ROOT, "robots.txt")).read()
for desk in re.findall(r"`(/[a-z-]+\.html)`", text):
    check(f"{desk} is disallowed in robots.txt", f"Disallow: {desk}" in robots,
          "llms.txt calls it a closed desk but robots.txt does not disallow it")

# ---- 4. the API answers (only with --live) --------------------------
if live:
    print("\n-- the API answers --")
    base = re.search(r"BASE\s+(\S+)", text).group(1)
    key = re.search(r"apikey:\s+(\S+)", text).group(1)
    for call in re.findall(r"`GET (/[^`]+)`", text):
        out = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             base + call, "-H", f"apikey: {key}"],
            capture_output=True, text=True).stdout.strip()
        check(f"GET {call[:58]} -> {out}", out == "200")
    body = subprocess.run(
        ["curl", "-s", "-X", "POST", base + "/rpc/eu_match_fellowships",
         "-H", f"apikey: {key}", "-H", "Content-Type: application/json",
         "-d", '{"p_extra":["surveillance","journalism"],"p_limit":3}'],
        capture_output=True, text=True).stdout
    try:
        rows = json.loads(body)
        check("the matcher returns scored rows with reasons",
              isinstance(rows, list) and bool(rows) and "reasons" in rows[0],
              body[:200])
    except Exception as e:
        check("the matcher returns scored rows with reasons", False, f"{e}: {body[:200]}")
else:
    print("\n-- the API answers --\n  (skipped; pass --live to call it)")

print(f"\n{len(fails)} failed")
sys.exit(1 if fails else 0)
