# Hitman's Halo as an owner-only module

Written 2026-11-23. Companions: `HALO-ADMIN-GLOBE.md` (what the Halo view holds), `INTEL-TO-MISSION-CANON.md` (the evidence
and decision canon), `supabase/pending/PROMOTION-ORDER.md` section 16 (the staged SQL).

## What Halo is, and is not

Hitman's Halo is the owner's **real-world intelligence and decision workspace**: what happened, what it affects, what the
system recommends and why. It is the four screens (World, Missions, People, Intelligence) on the full-screen globe at
`action-globe.html?explore=1&halo=1`.

It is not PRIM3's fictional Halo (`PRIM3/game/halo/`), not The Real History atlas and not the public Globe. McCluster Core
is the scheduler; Halo is where the owner reads the result. There is one Halo: this change adds no second globe, no frame
and no session handoff.

## What this change adds

| Piece | Where | What it does |
|---|---|---|
| Stable module id `halo` | `workers/mccluster/src/eup/modules.js` (`MODULE_IDS`, `MODULE_PENDING_SQL`) | Halo is a registered policy unit beside `environment`, `league`, `intake` |
| Staged SQL | `supabase/pending/eup_module_policy_halo_v1.sql` + rollback | Teaches the policy store the id. **Not applied.** |
| Owner section | `GET /v1/eup/halo` (`workers/mccluster/src/eup/halo.js`) | The module's route, who can open it, its policy unit, and the configuration of every declared feed. No feed data |
| Admin card | Control → System → E=Up → Overview → Modules (`js/control-room/eup.js`, drawn by `js/control-room/halo-module.js`) | An explicit "Hitman's Halo" card with three separate facts and the door |
| Control entry | Control → System → Hitman's Halo, `control.html#system:halo` (`js/control-room/nav.js`) | The same card plus the declared feed list |

## Three facts, never one "on"

The card never collapses these into a single state:

1. **Access.** Who can open Halo today: the house owner. The release guard (`packages/release-policy/globe.mjs`,
   `workers/mccluster/src/world-release.js`) refuses every Halo route to anyone else before dispatch, and each operations
   route checks the owner again. The card does not decide this and says so.
2. **Module policy.** What the store holds for the `halo` unit: *not in the store yet* (the staged SQL is unapplied), *not
   installed*, *disabled*, *enabled*, *draining*, or *unknown* when the read failed. A failed read is never completed with
   a guess.
3. **Backend.** Whether the Worker answered for the module, and which declared feeds lack a key or binding. *Configured*
   is not a count: what each feed returned and shows is reported inside Halo.

"Installed" is not "ready" and "enabled" is not "open". The card states that **no Halo route reads the policy unit yet**.

## Transition

Existing doors and owner behaviour are unchanged at every step: the Control tile, the Control menu entry, the Analytics tab
`#insights:halo`, the World frame button, the globe header button and every `?halo=` deep link keep working.

| Step | State | Owner sees | Who can open Halo |
|---|---|---|---|
| 0 (before this change) | Halo is a link in Control | A tile and a link | House owner (release guard) |
| 1 (this change, code only) | Module registered in code; store does not know the unit | Card: policy "not in the store yet", no command offered; door present | House owner (release guard), unchanged |
| 2 (owner promotes the staged SQL) | Store knows the unit | Card and Module policy offer Install, then Enable / Drain / Disable | House owner (release guard), unchanged |
| 3 (a later, separate change; owner decision) | Halo routes read the unit | A disabled unit closes Halo | House owner **and** an enabled unit |

Step 3 is not built. It needs an owner decision on what a disabled or draining Halo means (the page, the feeds, the
operations routes, the Core jobs that write evidence) and on the fallback when the policy store is unreachable. Until then
the card labels a recorded state as recorded only.

Deploy order does not matter for safety. A new page against an old Worker shows the card with "not deployed" for the
backend and "not in the store yet" for the policy; the three applied units still work. A new Worker against the unmigrated
store reports `halo` as `registered: false` and answers normally for the other three.

## Who sees what

- **Guest:** `/v1/eup/*` answers 401 before the store is asked. Control shows its sign-in.
- **Member (not the house owner):** `/v1/eup/*` answers 403; the card, the door and the feed list are not drawn, and an
  earlier owner read in the same page is dropped.
- **House owner:** the card, in every state, including when the overview, the policy read or the Halo section fail.

`GET /v1/eup/halo` returns no feed row, no count and no credential. For each declared feed, `configured` is `true` or
`false` where the Worker can check the requirement, and `null` where it cannot: `null` means "not checked here".

## Evidence for this change

- `workers/mccluster/test/eup-halo.test.mjs`, `workers/mccluster/test/eup-modules.test.mjs`: the Worker section, the
  registry, 401 / 403, missing policy, every failed read.
- `scripts/test/halo-module.test.mjs`: the card in every state, permissions, deep links, the E=Up Overview with failed reads.
- `scripts/test/control-nav.test.mjs`: the Control entry and the preserved `#insights:halo`.
- `scripts/test/eup-module-policy-halo-sql.test.mjs`: the staged SQL, as text.
- `scripts/e2e/halo-private-preview.mjs`: a loopback preview with synthetic data for looking at the card and the feeds by
  hand. It proves layout and behaviour, not any production reading.

Database review updated 2026-11-24: the exact applied policy SQL matched a fresh production catalog on a disposable
PostgreSQL 17.6 database, and the original extension produced its expected fingerprints there. The corrected guards and
behavioral proof are prepared; their execution remains a gate on the exact PR head's Reconciliation CI. See
`evidence/HALO-POLICY-PREPARATION-2026-11-24.md`. The staged file remains optional and unapplied. No module is enabled.
The repository's Playwright suites (`scripts/e2e/control-eup.e2e.mjs`, `owner-halo-globe.e2e.mjs`) were not run for this database review.
