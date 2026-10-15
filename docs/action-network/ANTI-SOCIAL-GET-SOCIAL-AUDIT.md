# Anti-Social — Get Social: audit before building

Owner, 2026-10-14: "Three levels, one Anti-Social mission … connect with one
person, connect with five people, then turn that connection into a
collaboration through Action Network … these should be levels within a single
mission, not three separate mission cards." Read before the build; every claim
below names the file it comes from.

## The ask, as given

| Level | Name | Do | Proof |
| --- | --- | --- | --- |
| 1 / 3 | High Five | Give one person a high five. | A short clip, with permission. |
| 2 / 3 | Five High Fives | Give five different people a high five. | One compilation video or short recap. No filming without consent. |
| 3 / 3 | Make Something Together | Find another Action Network member, connect through the platform, and create something together: a song, video, photo project, or other original work. | A jointly credited project linked to both profiles. |

Level 3 is the flagship: Connect → Collaborate → Publish, in the platform. Both
creators are credited and the finished project counts toward the same mission
for both. One mission, three levels, 1 / 3 → 2 / 3 → 3 / 3; one card.

## What exists today

### A mission is one row with no levels

- `public.action_missions` (`supabase/migrations/20261002061056_action_network_gamification_v1.sql:7`):
  `campaign_id`, `title`, `description`, `domain`, `difficulty` 1–5,
  `base_points` 10–1000, `proof_required`, `verification_mode`
  (review|peer|automatic|none), `skills text[]`, `capacity`, `status`
  (draft|open|paused|closed), `starts_at`, `ends_at`; later `kind` civic|clip
  (`20261006170955_action_clipping_marketplace_v1.sql:69`). No column, table or
  RPC anywhere names a level, tier, step or stage.
- The only "levels" in the system are prose: the Freestyle Containment Protocol
  seed writes "Level 1 … Level 2 … Level 3" into its description
  (`20261003023055_action_mission_camera_loop_v1.sql:9`). Nothing reads them.
- Missions are authored by seed migrations (`insert into public.action_missions
  … on conflict (id) do update`, e.g. `20261005054042_action_network_demographics_antiracism_v1.sql:24`)
  with deterministic ids. No Worker route creates a mission; `js/action.js:377`
  and `js/mnet.js:2037` only read `action_missions` by status/campaign.

### One assignment, one proof

- `action_mission_assignments` (`…gamification_v1.sql:16`): `unique(mission_id,user_id)`,
  `status` joined|in_progress|submitted|verified|rejected|withdrawn, `m_uid`,
  timestamps; later origin/attribution and live-session columns.
- Joining: `join_action_mission` (latest `20261014120000_action_globe_join_authorization.sql`)
  enforces open window, capacity and regional consent; attributed, live and
  origin variants exist for posts, live rooms and campaign links.
- `action_proofs` (`…gamification_v1.sql:23`): **`unique(assignment_id)`**, one
  proof per assignment; `proof_type` video|photo|link|text|artifact; https links
  ≤ 2000 chars; uploads must be the member's own `network_media_assets` in
  ready/staged; one-use-per-url and one-use-per-upload partial unique indexes.
- `submit_action_proof` (latest `20261004015451_action_proof_retry_and_review_notifications_v1.sql:100`)
  validates, locks the assignment, requires status in joined|in_progress|submitted|rejected,
  upserts the one proof and sets the assignment `submitted`.
- `review_action_proof` (`…gamification_v1.sql:234`): admins only
  (`eu_is_admin()`), never your own; `verified` awards `kind='mission'` points
  once per assignment (`base_points × difficulty factor`, unique
  `(assignment_id, kind)`), splits skill XP across the mission's skills, and
  sets the assignment `verified`; `rejected` sets `rejected` (resubmission is
  allowed by `submit_action_proof`).
- The points ledger's `kind` check already allows `'collaboration'`
  (`…gamification_v1.sql:35`); nothing awards it anywhere.
- The review desk is `js/control-room/action-network.js:103` (pending proofs
  joined to assignments) and `:392` (`rpc/review_action_proof`).

### Counts, record, feed

- `action_mission_stats` (`20261003035208_action_mission_completion_automation_v1.sql:75`)
  counts per mission: joined, in_progress, submitted, verified, rejected,
  slots_left. No per-level counts.
- `action_record()` (`…gamification_v1.sql:320`) returns verified_actions,
  points, in_progress, `missions[]` (one `review_note` by a subquery that
  assumes one proof per assignment), skills, cohorts. `js/mnet.js:2112` paints
  it: status label, points, Receipt, Share to feed.
- A verified action reaches the feed only through the server:
  `action_share_assignment_internal` / `share_verified_action`
  (`20261002135458_action_network_feed_shares_v1.sql`) write a `network_posts`
  row (`post_type 'share'`, `metadata.action {assignment_id, mission_id}`) and
  `action_feed_shares` vouches for it, because post metadata is member-writable.
- `network_posts` (`supabase/replay_migrations/0068_mnet_replay_foundation.sql:32`):
  one `author_m_uid`, `body`, `post_type` post|update|share|announcement,
  `visibility` public|network|private, `media`, `metadata`, `reply_to_id`.
  No co-author, credits or collaborators field anywhere.
- `docs/action-network/MISSION-ORIGINATED-PUBLISHING-CONTRACT.md`: posts are
  mission-originated and authorized server-side; the Worker rejects posts
  without a valid source.

### Connecting through the platform

- `network_follows` (`0068_mnet_replay_foundation.sql:48`) with
  `/v1/mnet/people/:handle/follow` POST/DELETE
  (`workers/mccluster/src/platform-api.js:635`); the person view
  (`js/mnet.js:1177`) offers Follow, Message, Mute, Block, Report and the
  person's posts.
- `network_connections` (`20260920071811_mnet_real_network_v1.sql:204`):
  requester/addressee, `pending|accepted|declined`, a pair index. **No route or
  RPC writes it.** It is read in one place: the messaging gate counts an
  accepted connection, or a mutual follow, as "network"
  (`…mnet_real_network_v1.sql:345`).
- Conversations and message requests: `/v1/mnet/conversations` GET/POST
  (`platform-api.js:755,769`), `member_state` requested/… .
- `network_notifications` (`type text`, `object_type`, `object_id`,
  `metadata`) is generic; the bell shows them.
- The capability map names cohorts and credentials; nothing names a member
  collaboration or a joint credit.

### "Anti-Social" already means two other things

- *Antisocial* is a track of I AM HERE (`here:antisocial`,
  `20261003233747_action_network_live_governance_v1.sql:53`) with the commerce
  offer `anti-social` ("Get your presence managed",
  `20261006233518_here_album_commerce_v1_reconcile.sql:116`).
- `anti-social-mission.html` is the "Do it for you" business mission page
  (website / brand / business / content offers through `onboard.html`).
- The new mission is a civic mission in the community domain. It takes the
  owner's name, "Anti-Social — Get Social", carries no campaign and no link to
  the business offer or the track, and nothing of the existing two moves.

### Where it runs

- Fifteen migrations on this branch are not in production (see the
  World doc); this adds one more. SQL behaviour tests live in
  `supabase/tests/*.behaviour.sql` and run against a scratch Postgres with
  the real API roles (`supabase/tests/supabase_api_roles.stub.sql`). The
  existing runner, `scripts/test-mission-engine-db.sh`, is stale: it applies
  only the first gamification migration, and the behaviour test it runs now
  expects `action_proof_review_history` from a later one, so it fails at
  line 155 before any later rule is checked. A Postgres 16 server can be
  started in this container, so the new migration gets its own runner that
  applies the whole action chain in order, and its behaviour test runs here
  and in CI.

## What a parallel session built today (read on the branch at 14:35–14:58)

Ninety-four commits landed on this branch while the audit above was being
written, including a first implementation of this mission and a ledger
reconciliation. Read before anything is changed.

- **Ledger reconciled.** `supabase/production-ledger.json` now lists 306
  migrations, every file in `supabase/migrations` among them, the globe
  migrations renamed to their applied versions; the "fifteen unapplied"
  statement earlier in this document is superseded. The draft below is
  recorded as applied (`6db7b69`, `c8ce996`).
- **The mission** (`supabase/migrations/20261014185154_antisocial_get_social_three_levels_draft.sql`):
  one row `a17050c1-a551-4c5c-80c1-5a1750c1a001`, "Anti-Social — Get Social",
  community, difficulty 1, 150 base points, skills community · collaboration
  · creativity, **status `draft`**, linked to the *Antisocial* track through
  `action_globe_song_missions` ("the owner explicitly approved", `34dcda6`).
- **Levels** live in a mission-specific table `action_antisocial_levels`
  (assignment × level 1–3; proof_url, media_asset_id, statement, post_id,
  collaborator_m_uid, status pending|verified|rejected, review note),
  readable by the owner and admins only. `submit_antisocial_level` requires
  the previous level verified, a clip or https link for levels 1–2, and for
  level 3 a public post by one of the two plus **an accepted
  `network_connections` row** between them. `review_antisocial_level`
  (admins, not own work) verifies a level; level 3 verifies only when the
  partner has independently submitted the same post with reciprocal credit;
  then 150 points (`kind='mission'`, once) and the assignment is `verified`.
  A trigger blocks the standard proof route for this mission.
- **Credit** is derived at read time: `antisocial_public_collaborations`
  lists a member's verified joint posts with the partner's public name; the
  person view shows a "Verified collaborations" block from it.
- **Member UI** (`mnet.html` `#mnAntisocialLevels`, `js/mnet.js`
  `antisocialPaint`/`antisocialSubmit`): a 1/3 · 2/3 · 3/3 list with
  Ready/Locked/Awaiting review/Verified/Revise, one form per level
  (recap, optional clip or https link; level 3 adds a partner select built
  from accepted connections and a pasted post id), consent hints verbatim.
- **Desk** (`js/control-room/action-network.js`): a pending-levels queue
  with the recap, linked proof, the clip through a new admin-only signed
  route (`/v1/mnet/missions/antisocial/:assignment/:level/media`, 15 min),
  the partner and post for level 3, Verify / Reject.
- **Tests**: `scripts/test/antisocial-three-levels.test.mjs` pins the SQL and
  page text (regex contracts). No behaviour test, no browser run.

### Gaps against the owner's spec

1. **Nobody can connect, so Level 3 is unreachable.** `network_connections`
   is select-only for members (`…mnet_real_network_v1.sql:265`); no RPC and
   no Worker route creates or accepts a connection; the person view offers
   Follow, Message, Mute, Block, Report and no Connect. The level-3 select
   will always read "No accepted connections yet".
2. **"Connect → Collaborate → Publish" is not in the platform.** Level 3
   asks the member to paste a post id of a post one of them made; nothing
   publishes the work as a joint project, and the post itself has one
   author. "Both creators are credited" is true only on the person view,
   after both are verified, and not on the post people actually see.
3. **Progress is invisible outside the dialog.** The Action Record row says
   "In progress" with no 1/3 · 2/3; the Missions list card does not say the
   mission has levels; `action_mission_stats` has no level counts.
4. **Draft.** The mission is hidden from members (RLS reads open|paused);
   the parallel session wrote "open only after member UI, reviewer UI and
   Worker are live and verified". The UI and desk exist; what is missing is
   the connect flow and a verified run.
5. Points are a flat 150 at 3/3 with no collaboration award, although the
   ledger kind exists; the owner calls level 3 the flagship.
6. A mission-specific table and a hard-coded mission id: it works for this
   mission and cannot carry a second multi-level mission. Acceptable for
   now; noted.

## What completes it (building in this order)

A. **Connect.** `request_connection(p_handle)` / `answer_connection(p_id,
   p_accept)` as server RPCs over the existing table, with a notification to
   the other member; a **Connect** button on the person view (Connect →
   Requested → Connected; Accept when they asked first); requests reachable
   from the bell.
B. **Publish together, in the platform.** From Level 3, "Publish together":
   title, kind (song · video · photo · writing · other), a link or an upload;
   the server writes one public post credited to both in `metadata.
   collaboration` and vouches it in a server-only table, submits the
   initiator's level 3, and tells the partner, whose Level 3 becomes one
   tap ("A published *Title* with you — submit it as your Level 3"). The
   feed card reads "Made together by A and B".
C. **Progress everywhere.** The Action Record row and the Missions card read
   n/3.
D. **A collaboration award** (`kind='collaboration'`) for both at 3/3.
E. **Proof.** A behaviour test on a scratch Postgres (stub + the action
   chain + this migration), the browser run through 1/3 → 2/3 → connect →
   publish → 3/3 against the fake backend, and the contract tests.
F. **Open the mission** once A–E pass, in the same migration, with the
   owner told.

## Built on the audit (same day)

- A: `supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql` (connect
  RPCs), the Worker's person route, Connect on the person view, the bell.
- B: `publish_antisocial_collaboration`, `action_collaboration_posts`,
  `antisocial_collaborations_for_me`, `action_collaboration_cards`; Level 3
  publishes together; the made-together card; the partner's page.
- C: `action_record` carries levels; n / 3 on the record and the card.
- D: `review_antisocial_level` settles both and awards `collaboration`.
- E: `scripts/test-antisocial-db.sh` + two behaviour tests on a scratch
  Postgres; contract tests; the browser run.
- F: the pending file opens the mission when applied.

## Design note written before the parallel work was found (kept for the record)

1. **A level model on the mission, not three cards.** `action_missions.levels
   jsonb` (an ordered array; empty for every existing mission), validated by a
   check and by the RPCs: `{ level, title, instruction, proof_note,
   proof_types[], collaboration }`. The card stays one row; the list shows
   "3 levels"; the dialog shows 1 / 3 → 2 / 3 → 3 / 3.
2. **One proof per level.** `action_proofs.level smallint default 1` and
   `unique(assignment_id, level)` in place of `unique(assignment_id)`;
   `action_mission_assignments.level_reached smallint default 0`.
   `submit_action_proof` takes `p_level`, which must be `level_reached + 1`.
   Every existing mission keeps today's behaviour exactly (level 1 of 1).
3. **Progression.** Verifying level n < N marks `level_reached = n`, sets the
   assignment back to `in_progress` and the next level opens; verifying level N
   sets `verified` and awards the mission points exactly as today. The Action
   Record and the stats carry the level.
4. **Level 3 is a collaboration object, server-side.**
   `action_collaborations`: mission, level, initiator, partner, status
   invited|accepted|declined|published|withdrawn, project title, kind
   (song|video|photo|writing|other), link, the published post. RPCs:
   `invite_collaboration` (a member on the mission names a partner by handle;
   the partner is notified), `answer_collaboration` (accept joins the partner
   to the mission if needed and writes an accepted `network_connections` row,
   so "connected through the platform" is literal and unlocks messaging as
   network), `publish_collaboration` (either member, once accepted: the
   server writes one jointly credited post, `metadata.collaboration {id,
   mission_id, credits:[both]}`, vouched like a share, and a level-3 proof for
   **both** assignments carrying `collaboration_id`). `review_action_proof` on
   either proof verifies both, so one review settles the pair; both reach
   3 / 3, both get the mission points, and both get a `kind='collaboration'`
   bonus, the ledger kind that was waiting for this.
5. **Linked to both profiles.** The post card reads "Made together by A and B"
   with both avatars; each member's Action Record row reads "3 / 3 · with
   @partner"; the person view's posts include posts a member is credited on.
6. **The desk** shows the level and, for a collaboration, both members; one
   verify settles both.
7. **Consent wording ships verbatim** in the level instructions ("with
   permission", "No filming without consent"), and the proof note repeats it
   above the camera.
8. **Seed**: one open mission, community domain, difficulty 2, 300 base
   points, skills community · creative · collaboration, three levels as in the
   table above, no campaign, no region (it appears in Missions and search, not
   as a pin).

Tests: Node contract tests on the migration and the page; a vm harness run
of the level flow (as `workers/mccluster/test/mnet-mission-flow.test.mjs`
does); a browser run that takes the mission through 1 / 3, 2 / 3, an invite,
an acceptance and a jointly credited publish against the fake backend; a
`supabase/tests/action_mission_levels.behaviour.sql` for CI.
