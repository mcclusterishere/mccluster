# Identity verification levels

**Owner direction, 2026-10-15 (Matthew).** Joining through a referral link
takes a **live camera video introduction**: no upload, no still photo. The
person says their first and last name and promises that is who they are, and
the video goes to the owner for review. **Full Hitman's Halo access** takes a
second live video ("I want access to …, here's why"), which the owner compares
with the first to confirm it is the same person, **plus** a third-party
government-ID check whose result the owner matches against what the person
said. Target: decided within 24 hours. Without it, no full Halo access.

Status: design, a **pending** schema
(`supabase/pending/20261015230000_identity_verification_levels_v1.sql`, with
its rollback file), the member capture page, the owner's review queue, and a
Worker route for Persona that ships **off**. Nothing here is applied in
production. It stacks on the Policy Fellowship ladder
(`docs/control-plane/POLICY-FELLOWSHIP-LADDER.md`,
`supabase/pending/policy_fellowship_ladder_v1.sql`) and must be applied after
it.

## 1. Inventory (what existed, checked in this branch)

| Piece | Where | Used how |
| --- | --- | --- |
| `action_member_verifications` (status-only, one row per user, purpose `referral_signup`), `action_unlock_rules`, `action_unlock_progress()` | ladder pending file (PR #440) | **Extended**, not duplicated: one row per (user, purpose), purpose `halo_full` added, requirement kind `identity_verified`, rule `halo_full`. |
| Referral codes: `action_participants.referral_code` / `referred_by` | `20260930235851_uprise_action_network.sql` | The E=Up rule counts referred people whose `referral_signup` row is verified. Unchanged. |
| Marketplace referral contract (commissions) | `docs/marketplace/referral-contract-5000.md` | Money only, payouts disabled; no identity data. Not touched. |
| `at_night_verifications` (server-only provider assertions, no ID images) | `supabase/migrations/pending/20261009220000_at_night_adult_verification.sql` | The pattern followed: status and provider reference only, never documents. |
| Whip Equipped's Stripe Identity (`identity_verifications`, `workers/mccluster/src/whip/identity-gateway.js`) | replay `0037_whip_mobility.sql` | Whip Equipped LLC is a **separate company**; its verification data is not shared or reused here. |
| Private bucket patterns | `20260920035720_gated_audio_bucket_live.sql` (`mcc-gated-audio`, private), `20260921051000_mnet_avatar_bucket.sql` (owner-folder `storage.foldername(name)[1] = auth.uid()` policies) | The new bucket follows both: private, typed, size-capped, owner-folder paths. |
| Camera code | `js/mnet-live.js` (`getUserMedia` for live rooms); mission proofs use `<input capture>` (camera-loop) | Proof capture accepts files, so it is **not** reused for identity; the identity page records with `getUserMedia` + `MediaRecorder` only. `creator-capture.html` is empty in this tree. |
| Notifications | `network_notifications` | Each decision notifies the member (`type = 'identity_verification_review'`). |
| Owner control room | `control.html` → `js/control-room/action-network.js` (Human Uprise: proof review, fellowship, Policy memos) | New **Identity** tab there, module `js/control-room/identity-review.js`. |
| Halo's gate | `hitmans-halo`: owner-only behind Cloudflare Access / a reviewed HTTPS boundary (its `AGENTS.md`, `SECURITY.md`) | Not edited. Section 6 is the contract for extending it. |

## 2. The two levels

```
signed-in member
  └─ V1 Live introduction ── owner approves ──► action_member_verifications(referral_signup) = verified
        (required for referral-link accounts;     counts toward the referrer's E=Up "3 verified joins"
         anyone may do it, and V2 needs it)
            └─ V2 Full Halo access ── video + Persona "approved" + owner approves ──► (halo_full) = verified
                                                                                    └─ rule halo_full met
                                                                                       ⇒ entitlement:halo_full
```

### V1 Live introduction

1. The member reads the **active** consent text for V1 and ticks "I agree";
   types their first and last name; agrees to share their **broad region**
   (location consent at signup, stored coarse: a region key such as a state,
   never coordinates; picking a region is optional, consenting is required).
2. They turn on the camera. Only after `getUserMedia` returns a stream with a
   **live** video track does the page ask the server for a challenge
   (`identity_start_submission`). The server issues a random phrase (a word
   and four digits, e.g. "harbor 4821"), a private object path
   (`<user id>/<submission id>`) and a **ten-minute** expiry, and records the
   consent acceptance with its time.
3. The phrase is on screen while they record (3 to 60 seconds) with
   `MediaRecorder`: "My name is …. My code is: harbor 4821. I promise that
   this is who I am." They can play it back and record again with the same
   code while it is fresh.
4. Send: the browser gets a **signed upload URL** for exactly that path and
   PUTs the bytes straight into the private bucket (never through the Worker),
   then calls `identity_finish_submission`, which checks the object really is
   in storage at the issued path, uploaded by this person, of an allowed type
   and size, recorded after the code was issued, and claimed as a live
   `getUserMedia` capture; then the submission is `submitted`.
5. The owner reviews (section 4): **approve**, **reject** or **request a
   retake**, with a note (required for reject and retake). Approval writes the
   `referral_signup` verification row. A retake means a new attempt with a new
   code.

The server-issued, short-lived phrase is what makes a pre-recorded clip
useless: it cannot contain a code that did not exist when it was recorded.
The brief suggested a device-generated nonce; a server-issued one is
stronger (the owner sees what should have been said, and the client cannot
choose it), so that is what was built.

**What "live only" can and cannot prove.** The page has no file input and no
code path that reads a file; the database refuses a finish whose capture
metadata is not a live `getUserMedia` track. A determined person can still
fake a camera (virtual-camera software) or script a browser. The defence is
the human review plus the fresh code; the doc does not claim more.

### V2 Full Hitman's Halo access

1. Needs an approved V1. Same capture flow with the V2 consent, up to 120
   seconds, saying the code, their name, **what they want access to and why**
   (also typed in short).
2. After sending the video, the member starts the **government-ID check**
   with Persona (section 5). Persona hosts the ID images and any selfie; we
   receive only the inquiry id and status (and, if the owner turns it on, the
   name on the ID and the birth **year**).
3. The owner sees the V2 video **side by side** with the approved V1 video,
   the code each one had to say, the names typed each time, and the Persona
   result next to the stated name, and decides. **Approve is refused unless
   Persona's status is `approved` and the V1 is approved.**
4. Approval writes the `halo_full` verification row. The entitlement is the
   unlock rule `halo_full` (unlock key `entitlement:halo_full`, requirement
   kind `identity_verified`, purpose `halo_full`), which ships **disabled and
   awaiting counsel sign-off**, like the ladder's E=Up rule. Until the owner
   records counsel sign-off and enables it, nobody is entitled, even after an
   approval.

## 3. Consent (mandatory, plain language, versioned)

`identity_consent_versions` holds each level's text. The two seeded texts are
**drafts**; a level cannot be captured at all until its consent is
**active**, and the table refuses `active` unless the owner's approval
(`approved_by`, `approved_at`), the retention period **N** (`retention_days`)
and a counsel review date (`counsel_reviewed_at`) are filled in. Once a
version leaves draft its words, level and N are frozen by trigger; a change
is a new version. `body_sha256` records the exact text. Every acceptance is
stored (`identity_consent_acceptances`, with time) and each submission
carries the version and acceptance time.

The draft texts (read them in the pending file) say, in plain words:

- **What is recorded:** a short live video (camera and microphone) made on
  the page, no uploads; the typed name; the time; the code shown; the broad
  region (V1) or the access request (V2).
- **That submissions are compared:** "We review your submissions together,
  including comparing them with each other, to confirm you are the same
  person", and for V2 also with the name from the ID check.
- **Who sees them:** the owner personally, and only admins the owner names in
  writing; never public, never on the profile, never shown to the referrer
  (who learns only approved or not).
- **No face matching by software:** "No computer program measures or matches
  your face."
- **Not used for AI training**, never sold.
- **Retention:** video deleted **N days after the decision** (N is the owner's
  choice; shown as "[N]" until set); the decision, date and note stay for the
  life of the account / access.
- **Deletion:** ask at any time on the page ("Delete my videos") or by
  writing to the owner; before a decision this withdraws the request.
- **Persona (V2):** an outside company holds the ID images under its own
  terms; we receive the result.

### Biometric-law review: a counsel decision

A video of a face and voice, reviewed to confirm identity, may be treated as
biometric information under Illinois **BIPA** (740 ILCS 14), Texas **CUBI**
(Bus. & Com. Code § 503.001) and Washington **RCW 19.375** (and Washington's
My Health My Data Act for some data), even when no face template is
computed. These laws turn on written notice, written consent, a published
retention schedule and destruction when the purpose is met. **Counsel decides**
whether they apply to manual review, whether the consent text and retention
period satisfy them, and whether any state needs to be excluded or handled
differently. The schema enforces that a consent cannot go live without a
recorded counsel review date, and the `halo_full` rule cannot be enabled
without counsel sign-off.

**The design is manual human review.** No automated face-geometry matching,
liveness scoring or face template exists anywhere in this change. If
automated matching is ever proposed, it needs **separate, explicit consent**
(a new consent version for that purpose), counsel review, and its own
retention schedule; it may not be added under these consents.

## 4. Owner review (control room → Human Uprise → Identity)

- The queue lists submitted videos oldest first with **age**, the 24-hour
  target (`sla_due_at`, "over 24 h" flagged), attempt number, region, and for
  V2 the Persona status.
- **Open and review** calls `identity_review_open` (written to the review log
  as `viewed`), then asks Storage for **signed URLs valid for five minutes**
  (only reviewers can mint them: the bucket's SELECT policy is reviewer-only).
  V2 shows the approved V1 video beside it (stacked on a phone, side by side
  from 900px).
- Approve / Ask for a retake / Reject, with a note (required except for
  approve), through `identity_review_decide()`. A reviewer cannot decide
  their own submission. Each decision notifies the member.
- **Revoke** (`identity_revoke_verification`, note required) is available as
  an RPC for the desk; no UI button yet.
- **Delete due videos**: lists videos past their delete date, deletes them
  through the Storage API, then marks each (`identity_mark_video_deleted`
  refuses while the object still exists).

**Who reviews:** `identity_is_reviewer()` = an admin (`eu_is_admin()`) who is
the owner (`matthew@mccluster.org`, the same owner rule the platform uses) **or**
listed in `identity_reviewers`, which only the service role can write. Being
listed without being an admin is not enough, and an admin who is not listed
cannot see anything. Owner decision: which admins, if any.

**The review log** (`identity_review_log`) records consent acceptance,
start, submit, expiry, withdraw, every open (`viewed`), every decision,
revocations, Persona events and deletions. Update and delete are refused by
trigger, even for the superuser, except the cascade when a whole account is
erased.

## 5. Persona (the government-ID check)

Flagged off: `PERSONA_ENABLED = "false"` in `wrangler.toml`; any other value
than the string `"true"` makes both Persona routes answer 503
`PERSONA_DISABLED` without calling anything.

Secrets, by **name only** (`wrangler secret put`): `PERSONA_API_KEY`,
`PERSONA_TEMPLATE_ID` (an `itmpl_…` inquiry template the owner builds in the
Persona dashboard: government ID, optionally a selfie), `PERSONA_WEBHOOK_SECRET`.
`PERSONA_STORE_VERIFIED_NAME = "false"`: the owner's choice whether to keep the
ID's name and birth year (never the full date of birth) for side-by-side review;
off means the owner reads the name in Persona's dashboard by inquiry id.

Routes (`workers/mccluster/src/identity/router.js`, wired in
`src/entry-platform.js`, preflight answered via `src/preflight.js`):

| Route | Auth | Does |
| --- | --- | --- |
| `POST /v1/identity/persona/inquiry` `{submission_id}` | member bearer | Checks (service role) the submission is the caller's own, V2, and its video is `submitted`; creates **one** inquiry (`Idempotency-Key` = submission id; `meta.auto-create-account-reference-id` = user id; `meta.auto-create-one-time-link`), records its id, returns the one-time link. Existing inquiry → returns it. |
| `POST /v1/identity/persona/webhook` | `Persona-Signature` | HMAC-SHA256 over `"<t>.<raw body>"` with the webhook secret, hex, constant-time compare; two space-separated signature sets accepted during rotation; timestamps more than **300 s** from now are refused (replay). The event id (`evt_…`) is the primary key of `identity_persona_events`, so a redelivered event is a no-op (`duplicate: true`); an older event never overwrites a newer status (`created-at` ordering). Only inquiry id, status and (opt-in) name/birth year are passed on; images, document numbers, addresses and full birthdate are dropped in the Worker. |
| `GET /v1/identity/entitlement?key=halo_full` | member bearer | `{key, entitled}` for the **bearer** only, from `identity_entitlement_for()` (service role). `no-store`. |

Persona API details used (checked against Persona's public docs on
2026-10-15): `POST https://api.withpersona.com/api/v1/inquiries`, header
`Persona-Version`, body `data.attributes.inquiry-template-id`; webhook
signature header format as above. **Plan and pricing were not verified:**
Persona's pricing page refused automated access (HTTP 403) on 2026-10-15.
The owner should check the current plans, any free tier or trial, per-check
cost, data-retention settings and the DPA on Persona's site before enabling.

## 6. The Halo contract (not implemented in Halo)

Halo today is owner-only behind Cloudflare Access (or an equivalently
reviewed HTTPS boundary). To admit `halo_full` members later, without a
second auth stack:

1. The member signs in with their M Account (Supabase session) on the Halo
   host.
2. Halo's server (not the browser) calls
   `GET https://api.mccluster.org/v1/identity/entitlement?key=halo_full` with
   the member's bearer token and admits the session only on
   `{"entitled": true}`. It re-checks on a short interval (e.g. every 5
   minutes, and on every privileged action) so a revocation takes effect.
3. The Cloudflare Access policy keeps the owner path as it is; members reach
   Halo through the authenticated app path, never by being added to Access by
   hand.
4. What a `halo_full` member may do inside Halo (which layers, which tools,
   spend limits) is a separate Halo capability list; the entitlement only
   answers "identity confirmed and access granted". Owner-only tools stay
   owner-only.

Halo's repository is not edited by this change.

## 7. Security

- **Private bucket** `identity-verification-videos`: `public = false`, 50 MB
  per object, `video/webm` or `video/mp4` only (Chrome/Firefox/Android record
  webm, Safari/iOS mp4).
- **Storage policies:** INSERT for an authenticated member only into their own
  folder, only at the exact path the server issued, only while that
  submission is awaiting capture and its code is fresh
  (`identity_can_upload`); the unique (bucket, name) key plus **no UPDATE
  policy** means each object is written once and never replaced. **No member
  SELECT**, not even of their own video. SELECT and DELETE for reviewers
  only. Anon has no policy.
- **Tables:** RLS forced; API roles get no direct writes; members read only
  their own submissions; every write is a `security definer` RPC with
  `search_path = ''`. Persona and entitlement functions are service-role only.
- **Limits:** V1 3–60 s, V2 3–120 s (checked in the browser and the
  database), 50 MB, six attempts per person per 24 h, ten-minute code.
- **Virus scanning: not available** on this storage path. Mitigation: the
  bucket accepts only two video types, files are only ever played back in
  the reviewer's browser `<video>` element from a signed URL (never executed,
  downloaded by the UI or transcoded server-side), and the size is capped. If
  server-side processing is ever added, scanning must come first.
- **Mime checks** happen three times: the bucket's allowed types, the stored
  object's metadata in `identity_finish_submission`, and the page.
- **Signed URLs** last five minutes and are minted by the reviewer's own
  session; the queue never offers a download. Opening is logged. (A reviewer
  could still screen-record; that is a trust question, which is why reviewers
  are named.)
- **No raw transcripts or recordings in Git**; test fixtures are invented.

## 8. Files

| File | What |
| --- | --- |
| `supabase/pending/20261015230000_identity_verification_levels_v1.sql` | Schema, bucket, policies, RPCs. Apply after the ladder. |
| `supabase/pending/20261015230000_identity_verification_levels_v1.rollback.sql` | Exact rollback (empty the bucket first). |
| `supabase/tests/identity_verification_levels.behaviour.sql`, `supabase/tests/supabase_storage.stub.sql`, `scripts/test-identity-verification-db.sh` | Behaviour tests as the real API roles on a scratch Postgres, plus rollback round trip and the ladder's own tests on top. |
| `identity-verify.html`, `js/identity-verify.js`, `js/identity-capture-core.js` | Member capture page (noindex), phone first. |
| `js/control-room/identity-review.js` (+ tab in `action-network.js`, scripts in `control.html`) | Owner queue. |
| `workers/mccluster/src/identity/router.js` (+ `entry-platform.js`, `preflight.js`, `wrangler.toml` flags) | Persona inquiry, webhook, entitlement. |
| `workers/mccluster/test/identity-verification.test.mjs`, `scripts/test/identity-verification-levels.test.mjs` | node --test. |

## 9. Owner decisions (nothing goes live without them)

1. **Retention N**: days after a decision before a video is deleted (the
   draft texts say "[N]"; the design proposes 30 for rejected/retake and
   asks whether approved videos should also go at N days, which is what is
   built, or be kept while the account stays active, which the brief
   floated: keeping them longer is more biometric exposure and needs
   counsel's view).
2. **Reviewers**: only the owner, or also named admins (rows in
   `identity_reviewers`)?
3. **Persona**: plan and pricing (verify on Persona's site; not verified
   here), the inquiry template, the DPA, and whether to store the ID name and
   birth year (`PERSONA_STORE_VERIFIED_NAME`). Or a different vendor (Stripe
   Identity is used by Whip Equipped, a separate company).
4. **Consent text approval** for both versions (then a new non-draft version
   is marked active with `approved_by`, `approved_at`, `retention_days`).
5. **Counsel review**: biometric-law applicability (BIPA / Texas / Washington),
   the consent texts, retention, vendor terms; then `counsel_reviewed_at` on
   the consents and `counsel_signoff_at` on the `halo_full` rule.
6. Whether a V1 is required of **every** new account or only referral-link
   accounts (built: available to everyone, required by the E=Up rule for
   referral joins; the signup flow does not yet force it, see 10).

## 10. Not built (follow-ups)

- Forcing V1 inside the referral **signup** flow itself (the page exists; the
  sign-up path must send referral-link accounts to it before their join can
  count; today the E=Up rule simply does not count them until verified).
- A scheduled purge (today the owner presses "Delete due videos").
- A revoke button and a reviewer-management UI.
- Halo's side of section 6.

## 11. Production apply checklist (owner approval required)

1. Apply the ladder first (its own checklist).
2. Apply this file with the Supabase MCP `apply_migration` as
   `identity_verification_levels_v1`; verify `get_advisors` shows no new
   security findings; confirm the bucket is private.
3. Verify with a test account that a signed upload URL can be created and
   used with only the INSERT policy (Storage API versions differ; if upload
   needs more, adjust the policy, never open SELECT to members).
4. Owner + counsel approve consent texts; publish them as new active versions.
5. Add any named reviewers (service role).
6. Only then, to enable the ID check: create the Persona template and
   webhook (URL `https://api.mccluster.org/v1/identity/persona/webhook`), set
   the three secrets, set `PERSONA_ENABLED = "true"` and deploy.
7. To grant entitlements: record counsel sign-off on `halo_full` and enable it.
8. Promote the pending file per `supabase/pending/README.md`.

Rollback: `…_identity_verification_levels_v1.rollback.sql` (empty the bucket
through the Storage API first); set `PERSONA_ENABLED = "false"`.

## Tests

- `node --test scripts/test/identity-verification-levels.test.mjs`
- `cd workers/mccluster && node --test test/identity-verification.test.mjs`
- `scripts/test-identity-verification-db.sh` (scratch Postgres 16+)
