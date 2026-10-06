# Clipping marketplace

Paid clipping is a **commercial kind of Action Network mission**, not a second
system. A creator funds a campaign around a song. Members claim it, post clips
on their own accounts and are paid on views read from the platform. Matthew's
house org is tenant zero. Every creator-side boundary is the creator's org, so
any artist org on the plane can run campaigns the same way.

| Layer | Where |
|---|---|
| Schema, authorization, settlement | `supabase/pending/action_clipping_marketplace_v1.sql` (pending production apply, see [Status](#status)) |
| End-to-end proof | `supabase/tests/action_clipping_regression.sql` (CI: `api-economic-core-ci.yml`) |
| Platform reads, cron, member routes | `workers/mccluster/src/clipping/` (tests: `workers/mccluster/test/clipping.test.mjs`) |
| Creator dashboard | Control → Create → Clipping (`js/control-room/clipping.js`) |
| Clipper experience | Action Network → Clips, on the web (`js/mnet-clips.js`) and native (`native/src/ActionNetworkScreen.tsx`) |
| Contracts | `scripts/test/clipping-marketplace.test.mjs` |

## What it reuses

| Need | Existing primitive |
|---|---|
| The campaign and the clipper's participation | `action_missions` (`kind = 'clip'`) and `action_mission_assignments` via `join_action_mission` |
| Funding | `action_bounty_funding_ledger`, generalized so a row funds exactly one bounty **or** one clip campaign |
| The song | `music_catalog_objects` / `creator_tracks` |
| Approved source files | `network_media_assets` in the private `mnet-media` bucket, served as 15-minute signed URLs |
| Each clip as a post with history | `social_accounts` → `social_posts` → `social_metric_snapshots` |
| The funnel | first-party `events` (`props.acq`, `account_created.props.campaign`) and server-measured `music_listens` |
| Quality ranking | `private.live_wilson_lower_bound` |
| Creator authorization | `private.is_org_owner` |
| Audit | `private.clip_audit` writes the org's audit trail |

New objects carry only what clipping adds:

- `action_clip_campaigns`: commercial terms;
- `action_clip_assets`: files and song moments;
- `action_clip_claims`: each clip code;
- `action_clip_submissions`;
- `action_clip_conversions`;
- `action_clip_earnings`: the payout ledger;
- `action_clip_payouts`.

## Tenancy

- **Creator org.** It owns campaigns, budgets, funding, review, payouts and the
  dashboard. Every creator function checks `private.is_org_owner` for the
  campaign's org, either directly or through `private.clip_require_owner`.
  Another org's owner gets `not authorized`.
- **Network org** (`orgs.slug = 'action-network'`, `kind = 'network'`). It owns
  the clipper side: member social accounts (`social_accounts.owner_m_uid`) and
  their clip posts. A clipper's identity and history belong to the network, not
  to whichever creator they clipped for.
- **Clippers** read only their own work through `clip_my_work()`.

## Lifecycle

1. **Creator launches.** `clip_campaign_create` sets:
   - song, platforms and rules;
   - required caption tags;
   - budget, base CPM and minimum views;
   - per-clip, per-clipper and max-payable-views caps;
   - clips per clipper;
   - earning window, keep-live period and hold period;
   - account and listen bonuses;
   - approval mode.

   `clip_campaign_fund` records funding and `clip_campaign_set_status` takes it
   live. After launch, the budget and caps can only grow, and only the rules,
   budget, caps and end date can change.
2. **Clipper claims.** `clip_campaign_claim` joins the mission and issues a clip
   code (`clip-xxxxxxxxxx`). The clipper's link is the song URL with
   `utm_source=clip&utm_medium=<platform>&utm_campaign=<code>`. Approved files
   come from `GET /v1/clips/campaigns/:id/assets`, which requires an active claim.
3. **Clipper connects an account.**
   - `clip_account_register` gives a bio code.
   - The desk attaches the account's Instagram credential with
     `clip_account_attach_credential`. This is admin-only and takes a
     `vault:`/`env:` reference, never a raw token.
   - `POST /v1/clips/accounts/:id/verify` reads the account through that
     credential and marks it verified only when the handle matches and the code
     is in the bio.
4. **Clipper submits** a link. `clip_submit` takes the mission, platform, URL
   and optional song moment, and never a number. The URL is canonicalized, and
   one media id is accepted once across the whole network.
5. **The Worker verifies.** The `clipping.settlement` cron runs on the Worker's
   five-minute schedule, 25 clips at a time, each leased for 10 minutes. It finds the post in the
   clipper's own verified account media and records it with
   `clip_record_verification`. The clip is rejected, with the reason shown to
   the clipper, if any of these holds:
   - the post is not on a verified account of theirs;
   - it was posted before the claim;
   - it was posted after the campaign ended;
   - its caption lacks a required tag.
6. **Metrics.**
   - `clip_record_metrics` stores a `platform_api` snapshot. Reads are hourly
     for 2 days, then every 6 hours to day 7, then daily.
   - `clip_check_fraud` flags `low_engagement` (at least 10k views with under
     0.2% interactions), `view_spike` (20× in under 2 h) and `views_fell` (a
     drop below 80%). A flagged clip is held for review.
   - A post that disappears inside the keep-live period becomes `removed` and
     its held and payable earnings are voided. After keep-live it is simply
     `closed`.
7. **Settlement** (`clip_settle_submission`, service-only).
   - Payable views are the highest platform-read views inside the earning
     window, once they reach the minimum, capped at max payable views.
   - The target is `floor(payable × CPM / 1000)`, capped per clip and per
     clipper.
   - The difference from what is already accrued is written to the ledger: a
     `views` row up, a `reversal` row down.
   - Settlement takes the campaign row lock. It never commits past
     `least(budget, verified funding)`, and pauses the campaign when that runs
     out.
8. **Conversions.** `clip_attribute_conversions` reads the first-party record by
   clip code.
   - **Account bonus:** a new, email-confirmed account created after the claim,
     not the clipper's own, once per person across the network.
   - **Listen bonus:** a completed, server-measured `music_listens` row for the
     campaign's song after the visit. Listens carry a plain slug and the
     catalogue uses `album:slug`, so both are normalized.
   - No bonus is paid before the claim has a verified clip. After that, at most
     one bonus per 200 verified views.
   - Disqualified conversions are kept with their reason.
9. **Hold and release.** Earnings start `held`. `clip_release_due` makes them
   `payable` once all of these hold:
   - the hold period has passed;
   - the clip has been seen live through its keep-live period;
   - the creator approved it, or the campaign does not need approval;
   - the claim is active.

   `clip_review_submission` approves, rejects (voiding), holds or releases.
10. **Payout.** `clip_record_payout` marks everything payable for one clipper in
    the org as `paid` against one payout row, which needs a unique provider
    reference. It runs once; a second call finds nothing payable.

## Money rules

- **Views come only from the platform.** Snapshots written by settlement are
  `source = 'platform_api'`, and only those count. Screenshots, client counts
  and member-reported numbers are never accepted; there is no parameter for
  them.
- **Only the Worker settles.** These are granted to `service_role` alone:
  - `clip_settle_submission`, `clip_work_due`, `clip_record_verification`;
  - `clip_record_metrics`, `clip_check_fraud`, `clip_release_due`;
  - `clip_attribute_conversions`, `clip_account_mark_verified`.
- **Budget-safe.** Every write that commits money locks the campaign row and
  checks `private.clip_money` (committed vs `least(budget, funded)`) under that
  lock.
- **Idempotent.**
  - A view row is keyed by its place in the clip's sequence
    (`views:<submission>:<n>`).
  - A bonus row is keyed by its conversion (`bonus:<conversion>`).
  - A payout is keyed by provider and reference.
  - A replay finds a zero difference or an existing key.
- **Append-only.** The `action_clip_earnings_guard` trigger refuses deletes and
  edits to what was earned. State only moves held ↔ payable, held or payable →
  void, and payable → paid. Paid and void are final.
- **Owner-attested funding is labelled as such.** Creators record an allocation
  of their own budget (`internal`) or a payment they made with its reference
  (`manual`). Stripe and Square funding is refused from the creator path (see
  [Staged](#staged)).

## Civic isolation

Civic missions score verified real-world action and never views
(`docs/ACTION-NETWORK-REWARD-SYSTEM.md`). Clip missions are kept apart:

- `action_civic_only()` triggers refuse civic proof and points for a clip
  mission;
- `action_record()` counts civic missions only;
- the web and native missions lists leave clip campaigns to the Clips tab;
- a clip mission opened by link points to Clips.

## Who can call what

| Caller | Functions |
|---|---|
| anyone | `clip_campaigns_open` (discovery; `GET /v1/clips/platforms`) |
| signed-in member | `clip_campaign_claim`, `clip_account_register`, `clip_submit`, `clip_my_work`; Worker `verify` and `assets` |
| creator org owner | `clip_campaign_create`, `_update`, `_set_status`, `_fund`, `clip_review_submission`, `clip_record_payout`, `clip_campaigns_for_org`, `clip_campaign_dashboard` |
| desk admin | `clip_account_attach_credential` |
| service role (Worker) | settlement, metrics, release, conversions, account verification |

All seven clipping tables have forced RLS, with every browser role revoked.
Reads go through the functions above.

## Creator dashboard

`clip_campaign_dashboard` feeds Control → Create → Clipping. It shows:

- funded, committed, held, payable and paid amounts, and budget left;
- clips, clippers, and verified and payable views;
- effective CPM;
- the first-party funnel by clip code: visits → plays → accounts → full
  listens;
- clippers ranked by reach and by conversion quality (Wilson lower bound);
- top clips and song moments;
- fraud holds and the review queue;
- funding and payout history.

## Status

- **Not yet applied in production.** The migration is in `supabase/pending/`
  because the drift contract rejects an unledgered file in `migrations/`.
  Applying it needs the Supabase connector working: `apply_migration` timed
  out at every size, and staging the SQL another way was not done. To promote
  it, follow `supabase/pending/README.md`:
  1. apply it;
  2. move it under its recorded version;
  3. update the ledger and the drift contract;
  4. drop the CI pending step.
- **Until then the Worker stands down.** `clip_work_due` answers PGRST202, so
  the cron returns `{ skipped: 'not provisioned' }`. The Clips tabs say
  "Clipping is not open yet."
- **Proven.** The CI regression rebuilds the full migration chain, applies this
  migration and drives creator → clipper → platform metrics → earnings →
  conversions → release → payout through the real functions, signed in as each
  party.

## Staged

None of these is presented as working:

| Capability | State |
|---|---|
| YouTube Shorts, TikTok | Off in the database (`clip_platform_enabled`) and the Worker; clips there cannot be submitted or paid until a real integration exists |
| Member self-serve Instagram connect | Not built; the desk attaches a vaulted credential per account |
| Card-funded campaign escrow | Not connected; creators record owner-attested funding |
| Automated payouts (Stripe Connect or other) | Not connected; `clip_record_payout` records a payout made outside the system with its reference |
