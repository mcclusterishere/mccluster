# Live missions: stay live to complete, "Live now" on the globe, live coverage bounties

**Owner direction, 2026-10-15 (Matthew).** "Mission completion should be live.
You get on camera and do it live; you remain live during the full mission
until completion. On the globe it shows users who are live right now doing
missions. The video saves and becomes a post. Bounties: e.g. 'mayor is giving
a speech, $50 to whoever captures the whole thing live on the platform'.
Weekends: multiple people live at different events, building a database of
those locations. Clippers clip the lives."

**Owner decisions applied (2026-10-15):**
1. Live is **REQUIRED on every mission.** The per-mission field stays, so it
   remains data (`action_mission_live_policies.live_mode`), but every
   existing and new mission ships `required`; none ship `allowed` or
   `not_allowed`. The helped-person / bystander rule lives *inside* the live
   run: if the person being helped has not agreed on camera, the doer keeps
   them off camera (points away, or narrates) and **stays live**. Minors are
   never streamed without a guardian's consent.
2. "Live now" pins are at **city level**: a city label and the centre of a
   0.1° cell, never exact coordinates.

**Status: flagged off and pending.** Nothing is deployed, migrated, or
configured. Every `/v1/live` route answers 503 until
`LIVE_MISSIONS_ENABLED = "true"`, and nothing works until
`supabase/pending/live_missions_v1.sql` is applied.

Evidence tags: **VERIFIED** means read on the provider's or a government's
own page (2026-10-15/16). **SECONDARY** means a non-primary source.
**UNVERIFIED** means it could not be confirmed. **INFERRED** means our
reasoning from verified facts. **PROPOSED** means a recommendation awaiting
a decision.

## 1. What Cloudflare Stream does, and the one thing it does not

| Fact | Tag | Source |
| --- | --- | --- |
| A live input made through `/live_inputs` returns a WHIP publish URL (`…/<SECRET>/webRTC/publish`) and a WHEP playback URL (`…/<INPUT_UID>/webRTC/play`). The WHIP URL "is a credential … anyone with this URL can stream live video to this input." | VERIFIED | https://developers.cloudflare.com/stream/webrtc-beta/ |
| WebRTC playback latency is "less than 500 milliseconds". | VERIFIED | same |
| **"WebRTC is not currently eligible for recording, thus no storage is consumed."** "Recording and live HLS playback are not yet supported." WHIP inputs play only over WHEP, never over HLS/DASH. | VERIFIED | same |
| Codecs: VP9, VP8, H.264 Constrained Baseline 3.1. No simulcast. No broadcast or viewer-count metrics for WebRTC. | VERIFIED | same |
| "Stream Live WebRTC is now GA"; "Billing for WebRTC delivery began on October 15th, 2026"; WHEP playback counts toward minutes delivered. | VERIFIED | same; https://developers.cloudflare.com/stream/pricing/ |
| Price: **$5 per 1,000 minutes stored** per month (prepaid capacity), **$1 per 1,000 minutes delivered**. Ingest and encoding are "always free". A live broadcast with no viewers costs nothing to deliver. | VERIFIED | https://developers.cloudflare.com/stream/pricing/ |
| RTMPS/SRT inputs can record automatically (`recording.mode: automatic`; a recording is "available within 60 seconds"), with `requireSignedURLs`, `allowedOrigins`, `deleteRecordingAfterDays` (30–1096). `enabled: false` rejects new **RTMPS/SRT** connections; `DELETE /live_inputs/{id}` deletes the input. | VERIFIED | https://developers.cloudflare.com/stream/stream-live/start-stream-live/ ; https://developers.cloudflare.com/stream/stream-live/watch-live-stream/ |
| Signed URLs: `requireSignedURLs` makes a video private. Tokens come from `/token` (one API call each, for low volume) or are self-signed with a signing key (for scale). `exp` is at most 24 h. "The `/token` endpoint does not work with Live WebRTC, so signing keys are the recommended option for it." | VERIFIED | https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/ |
| **Whether a signed token can gate the WHEP playback URL** is not documented on the WebRTC page. | UNVERIFIED | must be tested on a real input before relying on it (§6) |
| Live-input events (`live_input.connected`, `live_input.disconnected`, `live_input.errored`) come from Cloudflare **Notifications**. The payload is `{name, text, data:{notification_name, input_id, event_type, updated_at}, ts}`. Leaving the input list blank covers all inputs. | VERIFIED | https://developers.cloudflare.com/stream/stream-live/webhooks/ |
| A Notifications generic webhook authenticates **only** with a secret you choose, sent in `cf-webhook-auth` ("If this header is not present, or is not your specified value, you should reject the webhook"). There is no HMAC and no timestamp. | VERIFIED | https://developers.cloudflare.com/notifications/get-started/configure-webhooks/ |
| Stream's own video webhook (one per account) signs `Webhook-Signature: time=…,sig1=…` with HMAC-SHA256 over `time + "." + body`, keyed with the webhook's `secret`. The docs advise checking `time` against replay. | VERIFIED | https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/ |
| tus uploads: `POST /accounts/{id}/stream`, video id in the `stream-media-id` header. Chunks must be ≥ 5,242,880 bytes and divisible by 256 KiB (except the last), and at most 209,715,200 bytes. `Upload-Metadata` takes `name`, `requiresignedurls`, and other keys. | VERIFIED | https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/ |
| A maximum live broadcast duration for Stream inputs | UNVERIFIED | not found; the DVR docs note degradation past 3 h |

**Consequence (INFERRED).** A browser can only go live over WHIP, and Stream
cannot record WHIP. So "the video saves and becomes a post" cannot rely on
Stream's live recording. This slice records **in the browser**:
`MediaRecorder` captures the same camera and mic tracks that are being
published, and the browser uploads a chunk every few seconds *while live*.
After completion, the Worker assembles the chunks into one private Stream
video over tus. The **server-side** connected/disconnected record (the
webhooks) proves the run was live; the file is the content. Alternatives,
for the owner (§12): an RTMPS/SRT app (Larix, OBS) that Stream can record
itself, which needs an install; or Cloudflare Realtime/RealtimeKit
recording, whose terms and pricing were not researched (UNVERIFIED).

The repo already runs Stream for the Human Uprise live rooms
(`workers/mccluster/src/platform-api.js`, `network_live_sessions`, with
`CF_ACCOUNT_ID` and `CF_STREAM_TOKEN`, recording off, and a WHIP/WHEP client
inline in `js/mnet-live.js`). This slice reuses the same two secrets and the
same "delete the input to end it" rule. It adds a standalone copy of the
client (`js/whip-client.js`) and does not touch the rooms.

## 2. A live run, start to finish

```
member joins a mission (existing)            action_mission_assignments: joined
  │
  ├─ live-mission.html?assignment=…           camera + mic only (getUserMedia); never the screen
  │   three rules confirmed, helped-person choice, globe visibility
  │
  ├─ POST /v1/live/sessions                   Worker, as the member: action_live_open()
  │     → Stream: POST /live_inputs (recording off; server-side; CF_STREAM_TOKEN by name)
  │     → service role: action_live_attach(input, WHEP url, CITY CELL from request.cf)
  │     ← whip_url (to this streamer only, once; memory only)
  │
  ├─ browser publishes over WHIP              js/whip-client.js (SDP offer → 201 + Location)
  ├─ Notifications webhook → /v1/live/webhooks/live-input
  │     cf-webhook-auth checked, event age ≤ 5 min, one row per (input,type,time)
  │     → action_live_observe(): connected/disconnected segments ("evidence: webhook")
  ├─ heartbeat every 15 s → action_live_observe('heartbeat')
  │     (opens segments only when webhooks are absent: "evidence: heartbeat")
  ├─ recording chunk every 5 s → PUT /chunks/:seq → private bucket + SHA-256 receipt
  │
  ├─ drop?  reconnect over WHIP automatically while the resume window allows
  │
  ├─ "Mission complete" → POST /complete     action_live_complete(): close, judge continuity,
  │     file the proof PENDING (proof_type video, metadata.live_session_id),
  │     assignment → submitted; Worker deletes the Stream input
  │
  ├─ cron: chunks → one Stream video (tus, requiresignedurls), hash-checked; chunks deleted
  ├─ desk: GET /sessions/:id/recording (signed, 15 min) → review_action_proof()
  │     ONLY an admin verifies (PR #444's rules apply unchanged; AI is never the judge)
  └─ publishing: only through the streamer's separate opt-ins (§9)
```

## 3. "Remain live the whole time": continuity rules (data, per mission)

`action_mission_live_policies` holds one row per mission (default in brackets):

| Field | Meaning |
| --- | --- |
| `live_mode` [`required`] | `required` / `allowed` / `not_allowed`. Owner: every mission is `required`. |
| `min_duration_seconds` [300] | "Mission complete" unlocks only after this long on camera. |
| `max_duration_minutes` [240] | Past this, the sweep ends the run as broken (`max_duration_exceeded`). |
| `max_single_gap_seconds` [60] | A drop up to this long is a *blip* and is tolerated. |
| `max_total_gap_seconds` [180] | Blips may add up to this much. |
| `max_reconnects` [5] | At most this many drops of any length. |
| `max_resumes` [1] | Drops longer than a blip but inside the resume window are *resumes*; at most this many. |
| `resume_window_minutes` [10] | Any drop longer than this breaks the run. |
| `pin_delay_seconds` [120] | The globe pin and viewing appear only after this. |
| `third_party_rule` [`consent_on_camera_or_keep_off`] | Or `no_third_parties`. |

Verdict (`action_live_eval` in SQL, mirrored in `src/live/continuity.js`):
1. a drop longer than the resume window → **broken**;
2. more resumes than `max_resumes` → **broken**;
3. blips over `max_total_gap_seconds`, or more drops than `max_reconnects` → **broken**;
4. otherwise **resumed** (one long drop, flagged for the reviewer) or **continuous**;
5. while running, silence (no open segment) longer than the resume window → **broken**.

A broken run cannot be completed. The member starts a new run, and the
mission can be tried again. Evidence is recorded on the run: `webhook` when
Cloudflare's connect/disconnect events arrived (strong), `heartbeat` when
only the browser's heartbeats did (weaker, shown to the reviewer).

## 4. Per-mission policy, people on camera, minors

- **Required on every mission** (owner). Enforcement on proofs is a separate
  switch, `action_live_controls.enforce_live_required`, which ships
  **false**. With it off, the existing non-live proof flow keeps working
  until the live path is proven in production. Turned on, a mission whose
  `live_mode = 'required'` takes proof only from a completed live run of
  that same assignment. `submit_action_proof()` already drops any metadata
  key it does not know, so a member cannot forge `live_session_id`.
- **The helped person ("Help a person") and bystanders.** The doer states
  who else is involved before going live: *just me*, *someone I'm helping:
  I'll keep them off camera*, *someone who will agree on camera first*, or
  *narrating, camera pointed away*. During the run, two buttons record the
  moment the person agreed on camera, or the decision to keep them off
  camera (`third_party_marks`, timestamped). Either way the run **stays
  live**. The reviewer checks the recording against the marks. A person who
  did not agree is never shown. PROPOSED: the reviewer rejects or redacts a
  run that shows someone without a mark of their agreement.
- **Minors.** Every run requires the doer to confirm three rules: 18+; no
  children on camera without their guardian's OK; public places, or people
  who agreed, and never a private conversation without everyone's OK. A
  viewer can report `minor_on_camera`. Paid bounties and publishing are 18+
  only (research §4.6, §5.4). PROPOSED: no streaming accounts under 18 until
  counsel approves a guardian-consent flow.

## 5. The globe: "Live now"

- **Precision: city** (owner decision). At start, the Worker takes the
  request's Cloudflare geolocation (`request.cf.city/region/country/
  latitude/longitude`). This location is IP-derived and approximate, and
  the existing privacy notice already discloses it. The Worker snaps it to
  a **0.1° cell centre** (about 11 km). The database rounds again
  (`numeric(5,1)`). Browser GPS is never requested or accepted for pins. No
  city and no point means no pin: no invented (0,0) pins (both the Worker
  and the layer refuse null as 0).
- **Delay:** a pin, and the ability to watch, appear only `pin_delay_seconds`
  (120) after the run connected. WebRTC cannot delay the *video* itself (it
  is sub-second by design), so the delay protects the *where*, not the
  picture. INFERRED.
- **Who sees what** (PROPOSED default, implemented):
  - **public:** `GET /v1/live/now` returns city cells only:
    `{city, region, country, lat, lng, live_count, missions[≤3]}` and the
    total. It contains no run ids, member ids, names, or Stream ids.
  - **signed-in members:** the same, plus watchable runs
    `{id, mission, city, …, live_since}`. Watching is
    `POST /v1/live/sessions/:id/watch`, which returns the WHEP URL only to a
    signed-in member, only while the run is live, only after the delay, and
    never for runs the streamer hid. The desk can watch anything.
  - **streamer choice:** "Show my city" (default) or "Don't show me". A
    hidden run is still live and still reviewed; it just has no pin.
- **The layer** (`js/world-live-now-layer.js`) is a contract module for the
  World's globe (another agent owns the World UI in PR #442, which this
  branch does not touch). `MCC_LIVE_NOW_LAYER.create({getToken, onUpdate})`
  polls the endpoint and returns pins. `attachCesium(viewer, Cesium)`
  optionally draws them. Pins are re-snapped to one decimal on the client
  too.
- **Stream keys are never exposed.** The WHIP URL goes to its own streamer
  once and is held in memory. `cf_input_uid` and `whep_url` are
  column-private (members cannot select them; a test pins this).

## 6. Safety and moderation

| Control | Where |
| --- | --- |
| **Report** a run: minor on camera, no consent, private place, harassment, doxxing, violence, sexual content, dangerous, misleading, other | `POST /sessions/:id/report` → `action_live_reports` (reporter and desk read; the streamer does not) |
| **Kill switch, one run** (desk): delete the Stream input first (the WHIP URL dies), then `action_live_kill()`: status `killed`, pin hidden, open reports actioned; a killed run cannot come back | `POST /sessions/:id/kill` |
| **Kill all + stop new runs** (desk) | `POST /kill-all` → kills every active run, `accepting_sessions = false` |
| **Global off** | `LIVE_MISSIONS_ENABLED = "false"` (Worker) and/or `accepting_sessions = false` (database) |
| **Location safety** | city cell only, 120 s delay, opt-out of the globe, no names in public, no exact place ever |
| **Doxxing prevention** | no member ids or names on public surfaces; the WHEP link only for signed-in members; reports for doxxing; PROPOSED: rate-limit `/watch` per member |
| **Recording consent law** | Public events (open meetings, speeches, rallies in public) generally carry no expectation of privacy (INFERRED). **Private conversations** in all-party-consent states need everyone's consent. Lists vary at the edges (SECONDARY): California, **Connecticut**, Florida, Illinois, Maryland, Massachusetts, Michigan, Montana, Nevada, New Hampshire, Pennsylvania, Washington (PRSA advisory, https://www.prsa.org/docs/default-source/about/ethics/eas/ethical-standards-advisory-illegal-recordings.pdf); Delaware and Oregon are contested; RCFP's state guide is the reference (https://www.rcfp.org/introduction-to-reporters-recording-guide/). The third confirmation covers this. **COUNSEL.** |
| **Content rules** | PROPOSED short list on the page and in terms: no minors without a guardian, no private conversations without consent, no faces of people who did not agree, no medical/benefit details of the person helped, no filming inside homes/shelters/clinics unless invited and consented, no harassment or confrontation for content |
| **WHEP URL is a bearer link** | UNVERIFIED whether signed tokens gate WHEP. Until tested: hand it only to signed-in members, only while live; deleting the input at the end kills it. |
| **AI is never the judge** | nothing here verifies or pays; an admin does (PR #444) |

## 7. Live coverage bounties

Reuses `action_bounties` and `action_bounty_claims` (the money rail, the
funding ledger, claims, `mark_action_bounty_paid`) and PR #444's approval
rules unchanged. Added beside them: `action_bounty_live_coverage`.

| Field | |
| --- | --- |
| `event_title`, `event_kind` | public meeting / speech / rally / community event / public event |
| `city_label`, `cell_lat/lng` | coarse public place (0.1°) |
| `window_starts_at`, `window_ends_at` | the event; ≤ 12 h |
| `start_grace_seconds` [120], `end_grace_seconds` [0] | |
| `max_single_gap_seconds` [30], `max_total_gap_seconds` [60] | stricter than missions; **resumes do not count** |
| `political`, `candidate_related`, `funding_account` | political ⇒ `separate_political_program` (CHECK); candidate-related ⇒ political, and the bounty **cannot open** until `counsel_cleared_at` is set (trigger) |

Rules, enforced in the database for any writer:
- A member goes live *for* a bounty only after claiming it, and only from
  30 minutes before the window until its end (`action_live_open`).
- A claim becomes **approved** only behind a **completed** run of that
  assignment that **covers the window continuously** (`action_live_window_covered`).
  Otherwise rule `live_coverage_v1` turns the approval into a rejection
  with a note. With PR #444 applied, its guard refuses earlier (tested
  both ways). A claim is **never paid** without that coverage.
- The admin still verifies the mission proof first (the existing flow
  moves the claim). The desk may correct the window to the real event
  times before approving, for example when a speech started late.
- **Pay for completeness and quality, never views.** No view-based bonus
  exists in this path (research §2.2; 16 CFR 465.4 forbids
  sentiment-conditioned pay, and 465.8 fake influence indicators).
- **Political events.** McCluster Corp is registered as a Connecticut
  public charity (AGENTS.md, CHR.0069693). Bounty funds for political
  events must come from a separate program, never nonprofit funds.
  Candidate events risk being an in-kind contribution. Both are flagged for
  counsel and owner (§12). Nothing ties a reward to voting or registration
  (52 USC 10307(c); research §6.1).
- **Disclosure:** any clipped or reposted bounty footage carries the FTC
  disclosure (§9).

## 8. Recordings → the proof, the event database, the post

- **Proof:** the assembled private Stream video (`requiresignedurls`),
  reviewed through a 15-minute signed link (`GET /sessions/:id/recording`,
  desk only). Each chunk's SHA-256 is written by the database at arrival and
  re-checked at assembly. A mismatch fails the assembly and keeps the
  chunks for the desk.
- **Event database:** `action_live_event_log(from, to)` (desk only) lists
  finished runs with mission, bounty event, city cell, times, continuity,
  recording and proof state, and the location opt-in. Public projections of
  it come later, and only from runs whose streamer opted in.
- **Post:** a verified run becomes a post only with the streamer's
  publishing opt-ins. The existing "share on verify" path is unchanged and
  must not publish a live recording without them. PROPOSED follow-up: make
  the share trigger check `action_live_publishing_consents` before
  attaching video.

## 9. Clips: consent, redaction, disclosure

Submission consent (review by the desk) is the three confirmations at start.
Publishing consent is separate: the 12 opt-ins from the research (§5.1),
stored in `action_live_publishing_consents`, versioned with the hash of the
exact text shown, **every one off or most-private by default**, revocable
(`revoked_at`):

1. edited clips · 2. McCluster Corp's channels · 3. paid clippers' channels ·
4. paid ads · 5. face (show / **blur**) · 6. voice (use / altered /
**captions only**) · 7. name (full / first / handle / **none**) · 8. tag
handles · 9. place (**none** / state / city; never exact) · 10. term
(**90 days** / 1 year / until revoked) · 11. revocation · 12. credit.

Clippers may use a run only with opt-ins 1 and 3. Every clip must:
- redact faces, voices, plates and exact places per the opt-ins;
- redact bystanders and helped people without an on-camera consent mark;
- pass the research rubric's hard gates;
- carry the FTC disclosure in the video and the caption ("Paid by McCluster
  Corp to share this story", `#ad`, platform paid-partnership label on;
  16 CFR 255.0(f), 255.5).

Automated redaction is only a pre-pass. A human confirms (research §5.6).

## 10. Costs (measured decision; prices VERIFIED, volumes are assumptions)

Stream: $1 per 1,000 minutes delivered (WHEP viewing and recording review),
$5 per 1,000 minutes of storage capacity per month, ingest free.

| Scenario (per weekend) | Live minutes | Avg viewers | Delivered min (live + 1 review) | Delivery $/weekend | Stored min added/month (×4.3) | Storage at 90-day retention (≈3 months) |
| --- | --- | --- | --- | --- | --- | --- |
| Pilot: 5 events × 60 min | 300 | 3 | 900 + 300 = 1,200 | $1.20 | 1,290 | ≈3,900 min → **$20/mo** |
| Base: 20 events × 90 min | 1,800 | 10 | 18,000 + 1,800 = 19,800 | $19.80 (~$85/mo) | 7,740 | ≈23,200 min → **$120/mo** |
| Busy: 50 events × 120 min | 6,000 | 25 | 150,000 + 6,000 = 156,000 | $156 (~$670/mo) | 25,800 | ≈77,400 min → **$390/mo** |
| Mission runs, 200/week × 20 min | 4,000/wk | 1 | 4,000 + 4,000 = 8,000/wk | $8/wk (~$34/mo) | 17,200 | ≈51,600 min → **$260/mo** |

Read across (INFERRED): **storage dominates** once every mission is live.
Levers:
- delete a recording 30 days after review unless the streamer opted into
  publishing (≈ −66% storage);
- review at 1× only once;
- clips are separate, short assets.

Not priced here (UNVERIFIED): Supabase Storage egress when the Worker pulls
chunks to assemble them (each byte once), Worker CPU (small), and
Notifications (no listed charge). A $50 bounty dwarfs its Stream cost
(INFERRED). **Decision:** measure a pilot weekend before setting retention
and the busy-case budget.

## 11. What is in this branch

- `supabase/pending/live_missions_v1.sql` (+ `.rollback.sql`): the tables
  in §3–§9, the functions, the guards, RLS, column grants, the private
  bucket `live-mission-recordings`.
- `workers/mccluster/src/live/`:
  - `index.js`: the routes and the cron maintenance;
  - `continuity.js`: the rules and the city cell;
  - `stream.js`: Stream over `fetchNoCrossHostRedirect`, never following a
    redirect with the token;
  - `webhook.js`: both verifiers;
  - `recording.js`: hashing and tus assembly;
  - `store.js`: the database.
- Wired in `src/entry-platform.js` (route + cron), with
  `LIVE_MISSIONS_ENABLED = "false"` in `wrangler.toml`.
- `live-mission.html` + `js/live-mission-capture.js` + `js/whip-client.js`:
  the capture page.
- `js/world-live-now-layer.js`: the globe layer by contract.
- Tests:
  - `workers/mccluster/test/live-missions.test.mjs`;
  - `scripts/test/live-missions-client.test.mjs`;
  - `scripts/test-live-missions-db.sh` with
    `supabase/tests/live_missions.behaviour.sql`;
  - `scripts/e2e/live-mission-capture.e2e.mjs` (Chromium, fake camera,
    a real WebRTC answer to the page's offer, 390 and 1280 px).

## 12. Decisions for the owner and for counsel

| # | Decision | Owner | Counsel |
| --- | --- | --- | --- |
| 1 | Recording path: browser recording assembled into Stream (built here) vs an RTMPS/SRT app that Stream records itself vs Cloudflare Realtime recording (not researched) | ✔ | |
| 2 | When to turn on `enforce_live_required` (all proofs must be live) | ✔ | |
| 3 | Continuity defaults (5 min minimum; 60 s blips; 1 resume within 10 min; 4 h maximum) and coverage defaults (30 s / 60 s) | ✔ | |
| 4 | Public sees pins + counts, members watch (implemented) vs members only for pins too | ✔ | |
| 5 | Recording retention (proposed: 30 days after review unless published) | ✔ | privacy |
| 6 | Streaming under 18 (proposed: not until a guardian-consent flow is approved) | ✔ | ✔ |
| 7 | Content rules and recording-consent text; all-party-consent states | | ✔ |
| 8 | Political-event bounties: the separate program account; candidate events (in-kind contribution risk) | ✔ | ✔ (**required**) |
| 9 | Bounty amounts, eligibility, and who can post bounties (owner now; partners later: money-transmission review, research §4.4) | ✔ | ✔ |
| 10 | Disclosure wording for clipped live footage | ✔ | ✔ |
| 11 | Whether the Stream account's single video webhook is pointed here (optional; the cron polls anyway) | ✔ | |

## 13. Apply and enable (owner approval required; nothing here was done)

1. Review and merge. Confirm `/v1/health` reports the merged SHA with the
   flag still `"false"`. Every `/v1/live` route answers 503, and `/status`
   says `enabled: false`.
2. Apply `supabase/pending/live_missions_v1.sql` with the Supabase MCP
   `apply_migration` under the name `live_missions_v1`. Verify the private
   bucket `live-mission-recordings` exists. Every mission gets `required`.
   `enforce_live_required` stays false. Promote per
   `supabase/pending/README.md`.
3. Secrets, by name (`wrangler secret put`):
   - `CF_ACCOUNT_ID` and `CF_STREAM_TOKEN` already exist for the live rooms;
     confirm the token is Stream-scoped;
   - `CF_LIVE_NOTIFICATION_SECRET` (new; choose a long random value);
   - optionally `CF_STREAM_WEBHOOK_SECRET` (from `PUT /stream/webhook`'s
     `secret`, if decision 11 is yes).
4. Cloudflare → Notifications → Destinations: add a webhook to
   `https://api.mccluster.org/v1/live/webhooks/live-input` with that secret.
   Then add a Stream Live Input notification for connected + disconnected
   (+ errored), with the input list blank. Inputs that are not live missions
   are acknowledged and ignored.
5. Test on a real input before go-live:
   - WHIP from Safari and Chrome on a phone;
   - WHEP from a second phone;
   - whether a signed token is needed or honoured for WHEP (UNVERIFIED);
   - the connected/disconnected webhooks arrive;
   - the tus assembly of a 20-minute run.
6. Flip `LIVE_MISSIONS_ENABLED = "true"` in `wrangler.toml` (it is uploaded
   with each deploy) and deploy. Mount the layer in the World (PR #442's
   owner). Link "Go live" from a joined mission
   (`live-mission.html?assignment=<id>`).
7. Pilot one weekend; measure minutes (§10); then set retention, and decide
   on `enforce_live_required`.

**Rollback:**
- Set the flag to `"false"` and deploy (instant).
- In the database, `update action_live_controls set accepting_sessions = false`.
- Delete leftover inputs (`meta.name` starts with `live-mission `).
- Run `live_missions_v1.rollback.sql`; empty the bucket first if wanted.
