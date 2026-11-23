# Evidence packet for scoped agent work

Two agents share this repository's work without sharing a machine: a device agent (the owner's
development agent on a Windows or Mac device) and a separately authorised Core agent on the OVH host.
They exchange **scoped jobs** and **evidence packets**, never shells, tokens or unreviewed pushes.
A packet is a folder outside the public repository (it may name hosts and local paths; the repository
never does) with these parts, in this order:

| Part | File | Content |
| --- | --- | --- |
| 1 | `task.md` | The original task text, verbatim, and the scope the agent accepted (repository, worktree, branch, paths it may touch) |
| 2 | `inputs.json` | Permitted input versions: base commit, upstream refs read (PR numbers and head SHAs), live deployment SHAs observed, tool versions |
| 3 | `diff.patch` or `output/` | The change as a patch against the base commit, or the produced artefacts with SHA-256 |
| 4 | `tests/` | Actual test output as run, with exit codes, on the device that ran them; a skipped suite is listed as skipped, never as passed |
| 5 | `runs/` | Receipts of real runs (`mccluster-desktop-job/1`, node agent logs, Core lease ids), each stating the device, model and `hardware_mode` |
| 6 | `unresolved.md` | What was not done, not verified or blocked, with the exact blocker |

Rules: a packet is reviewed before merge or before it leaves the owner's devices; a fixture never
counts as a run; nothing in a packet grants the other agent access (no tokens, keys, cookies or
passwords); a Core agent's packet names the lease and node ids it acted on, a device agent's packet
names the branch and commit.

The first packet of this kind was produced for the 0.2.0 desktop client build on 2026-11-22 and kept
outside the repository on the owner's device.
