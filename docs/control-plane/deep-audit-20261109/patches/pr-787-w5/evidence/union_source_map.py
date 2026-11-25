#!/usr/bin/env python3
"""Merge-resolution helper (scratch, not part of any patch).

Resolves a conflicted equity-uprise-repo-source-map-v2.json by taking the union of
the two sides' entries keyed by path. Usage (inside the conflicted worktree):

  python3 -I union_source_map.py <worktree> [<ours-commit> <theirs-commit> [<out-file>]]

Reads stage 2 (ours) and stage 3 (theirs) from the index, keeps ours' entry order,
appends theirs' entries whose path ours lacks, and reports any path both sides
classify differently (none expected). Counts are recomputed the way the verifier
reports them; candidate_count is set to the number of entries (the verifier
requires the discovered set to equal the mapped set).
"""
import json, subprocess, sys
wt = sys.argv[1]
P = "docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json"
show = lambda spec: json.loads(subprocess.check_output(["git", "-C", wt, "show", f"{spec}:{P}"]))
# optional explicit commits (ours theirs) instead of the index stages of a conflicted merge
ours, theirs = (show(sys.argv[2]), show(sys.argv[3])) if len(sys.argv) >= 4 else (show(":2"), show(":3"))
out = sys.argv[4] if len(sys.argv) == 5 else f"{wt}/{P}"
by_path = {e["path"]: e for e in ours["entries"]}
differ, added = [], []
for e in theirs["entries"]:
    if e["path"] in by_path:
        if by_path[e["path"]] != e:
            differ.append(e["path"])
    else:
        by_path[e["path"]] = e
        added.append(e["path"])
merged = dict(theirs)  # theirs' header fields; entries and counts recomputed below
for k, v in ours.items():
    if k not in merged:
        merged[k] = v
entries = list(by_path.values())
merged["entries"] = entries
merged["candidate_count"] = len(entries)
merged["capability_source_count"] = sum(1 for e in entries if e.get("capability_ids"))
merged["support_only_count"] = sum(1 for e in entries if e.get("support_only") is True)
# keep key order of the original file
order = list(ours.keys())
merged = {k: merged[k] for k in order} | {k: v for k, v in merged.items() if k not in order}
open(out, "w").write(json.dumps(merged, indent=2) + "\n")
print(json.dumps({"ours_entries": len(ours["entries"]), "theirs_entries": len(theirs["entries"]),
                  "merged_entries": len(entries), "added_from_theirs": len(added),
                  "same_path_different_entry": differ,
                  "header_keys_differing": sorted(k for k in set(ours) | set(theirs)
                                                  if k != "entries" and ours.get(k) != theirs.get(k))}, indent=1))
