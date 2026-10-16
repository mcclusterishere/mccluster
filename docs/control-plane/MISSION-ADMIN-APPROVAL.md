# Mission admin approval, and the gated track

**Owner direction, 2026-10-15 (Matthew).** Every mission completion is approved
by an admin before it counts or posts as finished (anti-farming; missions will
be paid). Missions created from decisions stay draft until an admin publishes
them. "Completed mission" means `action_mission_assignments.status =
'verified'`, set only when an admin verifies the proof. On the album *CIA Mind
Control*, the gated track plays in full only for a member with at least three
verified missions **and** a verified identity; everyone else hears the preview;
the other two tracks stay free; preview and full listens are counted apart.

Status: **pending**. Two files in `supabase/pending/` (each with a rollback),
Worker and page changes on this branch. Nothing is applied in production.

## 1. Audit: every path that could complete a mission or move points/money

Production function bodies were compared with the repo on 2026-10-15
(SELECT-only `md5(pg_get_functiondef(...))` against the same functions created
from the repo files on a scratch Postgres 16; no personal data read).

| # | Path | Where | Production vs repo | Before | Now |
| --- | --- | --- | --- | --- | --- |
| 1 | `review_action_proof()` | `20261002061056` | `f72e6483` = repo | admin token + not own proof, in the RPC only | unchanged RPC; the database now also requires an admin token, not the submitter, and the reviewer recorded, for **any** writer |
| 2 | `submit_action_proof()` (camera loop) | `20261003022730` / `023055`, replaced by `20261004015451` | `b5d61ac8` = repo | files `pending`, assignment `submitted` (never verifies) | proofs can only be **born pending** (any writer) |
| 3 | `review_antisocial_level()` / `antisocial_settle_level3()` | `20261015000455` | `9871041b`, `5e68d1b6` = repo | admin-only; one review settles both partners; **no review history** | every level review is archived in `action_proof_review_history` (`source = 'antisocial_level'`); a level is verified only by an admin who is not its author |
| 4 | `action_record_verified_mission` trigger (completion automation) | `20261003035208`, last `20261004021226` | `36c29b35` = repo | downstream of `verified` (writes `action_events`), never verifies | unchanged; only reachable after an admin verification |
| 5 | `action_share_on_verify` trigger | `20261002135458` | whitespace-only difference | downstream: posts a verified card | unchanged |
| 6 | `action_bounty_sync_claim` / `mark_action_bounty_paid` | `20261004000628`, `20261003235507` | `dfd38ab9`, `327ffacf` = repo | approval follows the verified assignment; payout admin-only in the RPC; **the service role could approve or pay a claim directly** | a claim is `approved` only behind a verified assignment; `paid` only by an admin who is not the claimant (any writer) |
| 7 | **Clip campaigns, `approval_mode = 'auto'`** | `20261006170955` (`clip_submit`, `clip_release_due`) | `74789735`, `f9370119` = repo | **AUTOMATIC:** clips filed `not_required`, and the Worker's scheduled `clip_release_due()` (`workers/mccluster/src/clipping/runner.js`) made their earnings payable with no human review. Production: 0 auto campaigns, 0 `not_required` clips, 0 payable/paid earnings | no `auto` mode, no `not_required` state; earnings become payable only behind a clip approved by the campaign owner or an admin who is not the clipper; `clip_release_due()` replaced without `not_required` |
| 8 | **Clip bonus earnings with no submission** | `clip_release_due()` | same | **AUTOMATIC:** released with no approved clip behind them | released only once the clipper has an approved clip |
| 9 | Clip verification by the Worker (`clip_record_verification`, `clip_settle_submission`) | `20261006170955` | `87656673`, `9610193f` = repo | automation that checks the post and **accrues held** earnings from platform metrics | unchanged: it accrues, but nothing it writes can be paid without the approval in 7 |
| 10 | Points: any insert into `action_points_ledger` | gamification v1, Anti-Social | n/a | only the review RPCs insert; **the service role or a cron job could mint** | minted only under an admin token, never to the reviewer's own identity, and an award tied to an assignment needs that assignment's same-transaction verified review |
| 11 | Direct writes to assignments/proofs | grants | n/a | `authenticated` has SELECT only; **`service_role` (Workers, Edge Functions) and direct sessions (cron) could set `verified`** | refused unless an admin token wrote a verified review in the same transaction, and never for the admin's own mission |
| 12 | Publishing missions | `control.html` PATCH (admin RLS); `clip_campaign_set_status` (campaign owner) | `5a282b54` = repo | **a clip campaign's owner opened its mission without an admin** | a mission becomes `open` only after an admin approved it for publication (`publish_approved_at/by`); the desk's PATCH stamps it, or `approve_action_mission_publication()` lets a campaign owner take it live afterwards |
| 13 | Missions from decisions (PR #439, `intel_create_mission_from_decision`) | branch `feat/intel-mission-vertical-slice` | pending | created `draft`, `verification_mode = 'review'` | compatible, **no change needed on that branch**; publishing goes through 12. Its `intel_review_outcome` already needs a `verified` proof, which only 1 can now produce |

Also checked and not a path: `action_act()` (cannot mint mission events),
`apply_for_fellowship()` (reads verified), the Worker (`platform-api.js` and
`social/router.js` only **read** assignments/proofs with the service role), the
Edge Functions (none write these tables), `js/*` (the desk calls the review
RPCs only), and the only cron job in production (`ops_maintenance_tick`, which
touches none of these tables). Production triggers on these tables match the
repo.

### How "only an admin" is decided

`public.action_acting_admin()`: `auth.uid()` is set **and** `eu_is_admin()` is
true. That is the existing role model: the house owner, plus anyone the owner
designates with `eu_profiles.role = 'admin'`. A service-role key carries no
`auth.uid()`, so it is never an admin. Direct database sessions (migrations,
the SQL editor, cron) are exempt only from the mission-publication rule, never
from verification, points, bounties or clips.

## 2. The gated track

- **Rule (data):** `action_unlock_rules` row `gated_track_niggy_nigg`, on PR
  #443's requirement kind `identity_verified`, with `params = {"purpose":
  "referral_signup", "min_verified_missions": 3, ...links}` and
  `unlock_keys = {music_full_track:niggy-nigg}`. Missions =
  `action_member_verified_mission_count(uid)`: distinct missions with an
  admin-verified assignment (clip missions excluded). One predicate, also
  exposed as `action_member_has_verified_mission(uid)` for the World's CCTV
  gate and the ladder.
- **Identity, by contract with PR #443:** `public.member_identity_verified(uid,
  purpose)` is the one place it is read: a row in `action_member_verifications`
  for that `purpose`, `status = 'verified'`, not expired. `referral_signup` =
  an owner-approved V1 live introduction; `halo_full` = an owner-approved V2
  plus Persona (#443 adds it). **Which purpose the full track needs is data**
  (`params.purpose`, default `referral_signup`).
- **Apply order with #443:** preferred #440 → approval → #443 → gated. The
  gated file sets the same requirement-kind list and purpose check #443 sets,
  so both orders apply cleanly, and the track gate evaluates the rule itself
  (never through `action_unlock_progress`), so it is right in either order.
  The gated file's `action_unlock_progress` is #443's plus a
  `params.min_verified_missions` clause; if #443 is applied after the gated
  file, re-run the gated file (idempotent) so `action_unlock_status()` also
  counts the missions, or have #443 carry that clause.
- **Server-side:** the Worker (`workers/mccluster/src/music/router.js`) asks
  `music_gate_claim_rule()`, which evaluates the rule and writes the play row
  in one transaction; only a `claimed` answer gets a stream token for the
  private object. Locked, the answer is 403 with what is missing and no URL.
  Signed-out visitors can read the gate (`GET /v1/music/gates/niggy-nigg`) so
  the page can say what the full track takes.
- **Client reflects it:** `js/gated-audio.js` (`progress`, `explain`) and
  `album.html` show `x/3 MISSIONS` or `VERIFY ID`, link to
  `mnet.html?view=missions` and the identity page, and say the whole sentence
  in the preview toast.
- **Metrics:** preview plays are `music_preview_play`, full plays
  `music_full_play` (props: track, album, source, gated; nothing beyond the
  existing analytics model). The names already existed (mini player, owner
  analytics); the album page now emits them for the gated row, both are mapped
  in `event_taxonomy` (stage `content`), and Control → Analytics shows
  "Preview plays" next to "Full plays". Per-track counts are in the existing
  content table (`analytics_content`: `preview_plays`, `full_plays`). The
  server-side record of granted full plays is `music_gated_plays`.
- **The master was never in this public repo.** Full history (6,167 commits
  across all 609 branch and pull-request refs, blobless clone, 2026-10-15):
  the only gated-track file ever committed is
  `assets/audio/niggy-nigg-preview.mp3` (193,243 bytes in `e2a86635`, then
  65,347 bytes / 4.05 s in `bf62b7e8`, both previews). No other audio path
  resembles the master. The master lives only in the private bucket
  `mcc-gated-audio`.

## 3. Owner decisions

1. **House operators** (`ops.use`) still play the full track without the rule
   so the owner can hear the catalogue. Keep, or remove?
2. **Clip approvals:** the campaign owner (the paying creator) or an admin
   approves a clip. Should paid clips also need a platform admin?
3. **Which identity the full song needs.** Default `referral_signup` (the
   approved V1 live intro). The owner said "we need all the information on
   you" for the full song, which reads as `halo_full` (V2 + Persona). Switching
   is one UPDATE after #443 is applied:
   `update action_unlock_rules set params = params || '{"purpose":"halo_full"}' where rule_key = 'gated_track_niggy_nigg';`
   The identity link (`identity-verify.html`, #443's page) is also a `params` field.
4. Missions already open in production are recorded as approved for
   publication when the file is applied.

## 4. Apply (owner approval required)

1. Apply `supabase/pending/policy_fellowship_ladder_v1.sql` first (PR #440).
2. Apply `supabase/pending/mission_admin_approval_v1.sql`, then PR #443's
   identity file, then `supabase/pending/gated_track_mission_identity_v1.sql`, with the Supabase
   MCP `apply_migration` under those names. Before applying, re-check the
   hashes in section 1; if one changed, merge.
3. Only then deploy the Worker (still the preferred order). If the Worker
   is deployed before the SQL, the rule RPCs (`music_gate_rule_state`,
   `music_gate_claim_rule`) are missing and PostgREST answers `PGRST202`
   (404). The Worker detects that (`missingRpc` in
   `workers/mccluster/src/music/router.js`) and fails closed for the
   rule-gated track ALONE: its gate answers `{allowed:false, preview_only:true,
   reason:"gate_not_ready"}`, a play is `403 locked`, no stream token or
   signed URL is made. Every other track keeps its pre-#444 behaviour:
   listens start, beat and finish (finishing reads every gate and no longer
   502s). Any other RPC error is still an error. Test: `music-gate.test.mjs`,
   "Worker before its SQL".
4. Verify: as the desk, verify a test proof in `control.html`; `select
   public.music_gate_rule_state(null, 'niggy-nigg', 'gated_track_niggy_nigg')`
   says `sign_in`, `missions`, `identity_verification`.
5. Promote both files per `supabase/pending/README.md`.

Rollback: `mission_admin_approval_v1.rollback.sql` and
`gated_track_mission_identity_v1.rollback.sql` (gate first), and redeploy the
previous Worker.

## Tests

- `scripts/test-mission-admin-approval-db.sh` (scratch Postgres 16): a control
  run proving the gaps exist without the file; the mission engine, fellowship,
  Anti-Social and Policy Fellowship ladder suites re-run with both files
  applied; `supabase/tests/mission_admin_approval.behaviour.sql` (P1-P12);
  `supabase/tests/gated_track_mission_identity.behaviour.sql` (the matrix).
- `node --test scripts/test/gated-track-mission-identity.test.mjs`,
  `scripts/test/music-platform.test.mjs`, `workers/mccluster/test/music-gate.test.mjs`.
