# Policy Fellowship ladder

**Owner direction, 2026-10-15 (Matthew).** A person starts with three low
missions (help a person, write a song, go to a rally). Then they can join the
cohort that writes policy memorandums for local politicians at the **state**
level, made easy and smart for their state. Fellows research in their
dashboard (news, scholarly research, other data), type their memo and submit
it up the line. The owner reviews: approve, pass (decline), tell them to edit,
or edit it himself and tell them what he edited. Policy teams grow out of this,
with Hitman's Halo for intelligence. Super-admin: coordinate with politicians
and campaign software at the highest level. CRM at the lowest level. Level 1
has two kinds of signed-in people: fans, and people doing business for
themselves (artists with a creator account); the CRM belongs to the business
half. The Action Network is where the artist goes. Focus on what exists now.

Status of this document: design plus a **pending** schema
(`supabase/pending/policy_fellowship_ladder_v1.sql`), the review state
machine, and the smallest UI on existing surfaces. Nothing here is applied in
production. The apply checklist is at the end.

## 1. Inventory (checked 2026-10-15)

Production counts come from SELECT-only aggregate queries against Supabase
`zmnhbrjyhxzhkxmhkexs` (counts only; no personal data was read).

### Applied in production

| Piece | Where | Rows | What it is |
| --- | --- | --- | --- |
| `action_missions`, `action_mission_assignments`, `action_proofs` | `20261002061056_action_network_gamification_v1` | 37 missions (27 open), 7 assignments, 0 verified, 0 proofs | The mission engine. A proof reviewed `verified` by `review_action_proof()` sets the assignment to `verified`. |
| `action_proof_review_history` + member notification | `20261004015451_…review_notifications_v1` | 0 | Every proof review archived; the member is told via `network_notifications`. |
| `action_fellowship_applications`, `action_fellowship_status()`, `apply_for_fellowship()`, `review_fellowship_application()` | `20261002063754_action_network_fellowship_v1`, extended by `20261014185932_equity_policy_memo_application_path` | 0 | The network fellowship: three verified actions **or** a verified "Write a policy memo" mission (`368fd75a…`) opens the application; the desk accepts or declines with a note. Production function bodies contain the memo path. |
| `action_cohorts`, `action_cohort_members`, `admit_fellow_to_cohort()` | gamification v1, `20261005054040_action_cohort_admission_v1` | 2 cohorts, 0 members | A cohort seat is given on purpose by the desk to an accepted fellow. Production `admit_fellow_to_cohort` hash equals the repo file (md5 prefix `46c78700`, compared on a scratch database). |
| Equity Uprise group, campaign `equity-uprise-003`, the four Docket 516R missions, cohort "Equity Uprise · policy writers, next cohort" | `20261005054036_equity_uprise_group_docket_516r` | (in the counts above) | The existing policy-writer funnel (Connecticut). |
| `action_policy_bills`, `action_policy_official_profiles`, `action_policy_memo_bounties`, `action_policy_memo_submissions` | `20261014020454_action_policy_memo_bounties` | 0, 0, 0, 0 | Public bill registry, verified official profiles, **funded** research bounties, and service-only bounty submissions (`document_path`, no versions, no review loop). |
| `civic_source_registry`, `civic_jurisdictions`, `civic_offices`, `civic_office_terms`, `civic_contact_channels`, `civic_source_sync_runs` | `20261014021057_civic_global_discovery` | jurisdictions 0, offices 0, channels 0 | Office-centric civic registry; sources listed with auth mode and secret **names** (`OPENSTATES_API_KEY`, `LEGISCAN_API_KEY`, `CONGRESS_API_KEY`), all disabled. Contact channels are public only when verified and flagged public. |
| `civic_candidate_profiles`, `civic_candidate_cohorts`, `civic_candidate_cohort_members`, `civic_policy_lab_projects`, `media_*` | `20261014021258_candidate_labs_media_graph` | all 0 | Candidate workspace stub (service-only, no public policy) and the news-ownership graph. |
| `action_globe_regions` | `20261014013557_action_globe_regions` | 3 | Region keys (country + subdivision). Used here as the **state** key. |
| `network_notifications` | network schema | n/a | The member notification table the proof review already writes. |
| `creator_billing_subscriptions` | creator billing | n/a | Active row = a paid creator/business workspace (the L1b capability). |
| `out_*` tables, `leads`, `site_requests`, `comms_contacts` | outreach CRM / front desk / communications beta | `comms_contacts` 0 | The company's CRM (AI-HARNESS: `out_*` is the outreach CRM; `docs/control-plane/OUTREACH-CRM-INVARIANT.md`). |
| `eu_fellowships`, `eu_fellowship_applications` | replay `0017_equity_uprise_platform` | 14, 0 | A **directory of third-party fellowships** and the Equity Uprise fellowship intake (`fellowship.html` → `eu-intake`). Not this ladder. |
| `research_sources` | `20261006211536_experience_evidence_plane_v1` | 0 | Experience-research bibliography, not policy research. |

### Pending (repo only, not applied)

- `supabase/pending/20261014170000_action_mission_curated_catalog_resources.sql`
  (mission curation; production still shows the retired missions open).
- `supabase/pending/20261011190000_decision_intelligence_evidence_v1.sql`
  (private `decision_intelligence.sources/claims/evidence_links`; schema not
  present in production). Superseded by the evidence canon below; do not
  apply both.
- `supabase/pending/20261015210000_intel_mission_canon_v1.sql` and
  `docs/control-plane/INTEL-TO-MISSION-CANON.md` (PR #438, branch
  `docs/halo-intel-mission-canon`): the canonical evidence/claim schema
  (`intel_evidence`, `intel_claims`, `intel_claim_evidence`, append-only
  `intel_reviews`, briefings, decision basis, mission decisions, outcomes and
  proofs; sources and snapshots reuse `ops_ingest_records`).
- **This change:** `supabase/pending/policy_fellowship_ladder_v1.sql`.

### Wired today (UI and server)

- **Fellowship application** and the Action Record: `js/mnet.js` →
  `action_fellowship_status`, `apply_for_fellowship` (PostgREST RPC with the
  member's token).
- **Owner desk:** `control.html` → `js/control-room/action-network.js`:
  proof review (`review_action_proof`), fellowship review, cohort seats
  (`admit_fellow_to_cohort`), live grants.
- **Public policy room:** `action-policy.html` + `js/action-policy.js` reads
  bills, verified officials and funded bounties (anon). All empty in
  production today, and it says so.
- **Bill sync:** `scripts/policy/legiscan-sync.mjs` (server-only, LegiScan;
  not scheduled anywhere in CI).
- **News:** `supabase/functions/public-gdelt-news` serves cached GDELT DOC 2.0
  results; upstream fetches are server-only with backoff.
- **No Worker routes** exist for policy, fellowship or cohorts; these surfaces
  talk to Supabase RPCs under RLS. This change follows the same pattern
  (no new Worker route, no new backend).
- `policy.html` and `policy-memo-dna.html` are Matthew's own published policy
  writing on his property (static pages, no editor). They are not the fellow
  editor and were not changed.

### Gaps this change closes (and only these)

1. No starter-mission ladder: no "help a person / write a song / attend a
   rally" categories exist (`action_missions.domain` has no such values), and
   the fellowship threshold is a hardcoded `3` in SQL.
2. Cohorts have no state or program, so there is no "Policy Fellowship for my
   state" and no policy team.
3. Memos have no workflow: bounty submissions are a single service-only
   document path with four statuses; nothing records versions, owner edits,
   notes, diffs, or review history.
4. No per-memo research collection with provenance.

## 2. The ladder

```
public (logged out)          the World / globe; the ladder is readable by anyone
L1a Fan                      signed-in member (m_people + auth user)
L1b Creator / business       + an active creator workspace (creator_billing_subscriptions);
                             the Action Network is where the artist goes; the CRM lives HERE,
                             purpose-limited to that business's own contacts
Starter missions (3 kinds)   help_person, write_song, attend_rally — each complete when a mission
                             mapped to that kind has a VERIFIED assignment
Policy Fellowship (state)    an action_cohorts row: program 'policy_fellowship', region_key = state;
                             seat = accepted fellowship application + ladder rule satisfied
Policy teams                 action_cohorts: program 'policy_team', parent_cohort_id = state cohort;
                             seat needs a seat in the parent
Owner / super-admin          eu_is_admin(): reviews memos, seats fellows, coordinates officials
```

**Roles are capabilities, not exclusive tracks.** A creator account, a fan
account and a fellowship seat can sit on the same person. Whether an artist
can also be a fellow is an **open question** for the owner ("an artist can't
be a fellow… that's not the right way to think about it"); the default is
non-exclusive, and the switch is data: `action_unlock_rules.creator_exclusive`
(default `false`).

### What "completed a mission" means

A starter kind is complete when the member has an `action_mission_assignments`
row with `status = 'verified'` for a mission mapped to that kind. That status is
set only by `review_action_proof()` when the desk verifies the proof. A
submitted, pending or rejected proof does not count.

This must be the **same definition** the World's CCTV gate uses for "has
completed a mission" (owner: logged in + location consent + completed mission).
That gate is being written on `feat/world-globe-feed-analytics`
(`docs/control-plane/WORLD-GLOBE-FEED-AND-ANALYTICS.md`), which was **not yet
pushed** when this was written (`git fetch origin feat/world-globe-feed-analytics`
found no ref). Whichever lands second must reconcile to one shared predicate,
ideally one SQL function (`action_member_has_verified_mission(uid)`), so the
two gates cannot drift.

The evidence canon (PR #438) states "approved proof = `action_proofs.status =
'verified'`". `review_action_proof()` sets the proof and its assignment to
`verified` in the same transaction, so the two read the same for ordinary
missions. They can differ where another path verifies an assignment (for
example the Anti-Social level review or the completion automation), so the
shared predicate must be chosen once, by the owner, and used by the ladder,
the CCTV gate and the canon alike. This ladder uses the assignment status
because that is what the fellowship already counts.

### The rule is data

- `action_ladder_starter_kinds` — the kinds (seeded: `help_person`,
  `write_song`, `attend_rally`).
- `action_ladder_mission_kinds` — which missions count for which kind. The
  desk maps them (RLS: `eu_is_admin`). Public can read the mapping.
- `action_unlock_rules` — row `policy_fellowship`: `requirement_kind =
  'starter_kinds'`, `required_kinds`, `min_count` (`null` = all of them;
  `1` = any one), `creator_exclusive`, `enabled`. The same table holds every
  other unlock (section 2a).

Default: all three kinds. Changing to "any one" or "any two" is an UPDATE, not
a deploy.

**Missions that exist today.** Only `help_person` has a real mission:
"Help someone reach a real service" (`51000000-…-0003`, open), which the pending
file maps. "Feed two people" and "Build and hand out two care kits" are
candidates the owner may also map. **There is no "write a song" mission and no
"go to a rally" mission in production.** The owner (or the desk, through the
existing "Create as draft" mission form) must create them, with proof rules
that do not require photographing strangers, then map them. Until then the
ladder correctly shows those steps with no open mission.

### Relationship to the existing fellowship application

The network fellowship (`apply_for_fellowship`: three verified actions, or the
verified memo mission) is unchanged. The ladder adds a check where it
matters: `admit_fellow_to_cohort()` now refuses a seat in a
`policy_fellowship` cohort unless the fellow satisfies the active ladder rule,
and refuses a `policy_team` seat without a seat in its parent state cohort.
Non-policy cohorts behave exactly as before (the replaced function is the
production function plus those two checks).

### "What's my next step"

`policy_ladder_status()` (anon and authenticated) returns the rule, each
starter step with its open missions and my status on them, completed/needed,
eligibility, my latest fellowship application, my policy seats, and
`next_step`: `sign_in` → `complete_starter_missions` →
`apply_for_fellowship` → `await_fellowship_review` →
`await_policy_cohort_seat` → `write_memo`. The JS mirror is
`nextStep()` in `js/policy-fellowship-ladder.js`.

## 2a. Access and unlock model (owner, 2026-10-15)

Every unlock is a row in `action_unlock_rules` (`unlock_keys`,
`requirement_kind`, `min_count`, `params`, `enabled`,
`requires_counsel_signoff`, `counsel_signoff_at`). The evaluator is one
server function, `action_unlock_progress(user, rule)` → `{met, have, need,
reason}`, and members (or anyone) read the whole picture with
`action_unlock_status()`. A disabled rule is never met. A rule with
`requires_counsel_signoff = true` **cannot be enabled** until
`counsel_signoff_at` is set (table CHECK), and is never met before then.
Client-side shading is presentation only; the Worker or the RPC enforces.

| Level | Sees / can do | Rule row (seeded) | State |
| --- | --- | --- | --- |
| Public (logged out) | The globe plus **one free layer**; everything else is visible but shaded/locked, and clicking it prompts sign-in | `public_free_layer` → `globe_layer:flights`, `none` | enabled; matches what `workers/mccluster/src/world-layers.js` already serves publicly |
| L1 Fan | Follow/engage; music layer and music news on the globe; **watch** the Action Network **read-only** (not a poster); **fund** creators/businesses | `member_layers` → satellites, launches (`signed_in`) | enabled; matches the Worker's current member-only layers. A music layer does not exist yet; it gets its own row when it does |
| L1 Creator / business | Post and act in the Action Network; the CRM lives here | (future row `action_network_post`, `creator_account`) | **gap:** in the code inspected, posting is not gated on a creator capability; the post path must read this rule before fans become read-only |
| Starter missions → Policy Fellowship | three verified starter kinds → state cohort seat | `policy_fellowship` (`starter_kinds`) | enabled; unchanged |
| Equity Uprise (E=Up) activation | activates E=Up for the member | `equity_uprise_activation` (`verified_referrals`, 3) | **disabled**, `requires_counsel_signoff` |
| Fellow + 10 registration assists → Whip Equipped hand-off | the "Whip Equipped transport" globe layer and **eligibility to apply** as a driver in Whip's app | `whip_transport_partner` (`registration_assists`, 10, `requires_fellow`) | **disabled**, `requires_counsel_signoff`, no counting source |

**Funding (fans → creators/businesses).** Only through the existing payment
processor (Stripe) and the existing ledgers: `creator_billing_subscriptions`
(creator workspaces), `action_creator_funding` / payout reservations (no live
payout execution today), `creator_fan_purchase_evidence` (pending). No new
payment path is designed here; money switches stay with the owner.

### E=Up activation and strict referral verification

- **Rule:** three **verified** joins through the member's personal referral
  link. A join is a row in `action_participants` whose `referred_by` is one of
  the member's referral codes (that table already issues per-campaign codes;
  production has 3 participants, 0 referred). It counts only when the joined
  person has `action_member_verifications.status = 'verified'` (not expired,
  not revoked). "Plus shares" is an **open question**: the rule carries
  `params.shares_required = null` until the owner defines which shares count.
- **Strict verification for anyone who signs up through a referral link:**
  location sharing at signup, identity/face verification, and a signed
  consent/attestation. Design:
  - A **third-party identity-verification vendor** does the identity and face
    check. Candidates by name only: **Stripe Identity** (already used by the
    Whip routes, `workers/mccluster/src/whip/identity-gateway.js`) or
    **Persona**. The owner picks; no keys or integration are added here.
  - `action_member_verifications` stores **status only**: vendor name, vendor
    reference, consent/attestation versions and dates, location consent date
    and precision, verified/expiry dates, and the date by which the vendor must
    have deleted biometric data. It **never** stores a face image, a biometric
    template, an ID document, a document number or a date of birth (the
    `at_night_verifications` pattern). RLS forced; written only by the server
    (vendor webhook); a member reads their own row.
  - **Biometric consent** needs explicit, written, purpose-specific consent text
    before capture, a published **retention schedule**, and deletion when the
    purpose ends or within the statutory limit, under Illinois **BIPA** and the
    similar Texas (CUBI) and Washington (RCW 19.375 / My Health My Data)
    regimes; no sale or profit from biometric data. **Owner/legal decision:**
    counsel approves the consent text, retention period and vendor terms
    before the rule can be signed off.
  - **Location** is consented, minimized and stored coarse (the existing
    `action_globe_member_regions` region key) unless a precise location is
    strictly needed; precise GPS stays opt-in and separate.

## 2b. The Whip Equipped hand-off and the voter-registration rule

- **Whip Equipped LLC is Matthew's separate company,
  never a McCluster Corp brand** (`docs/control-plane/DOMAINS-AND-ENTITIES.md`). The unlock is a
  **cross-entity partner hand-off** with its own data boundary and consent:
  McCluster passes only "this member is eligible to apply" (and only with the
  member's consent), never their mission, memo or verification records.
- Reuse what exists: Whip's schema (`supabase/replay_migrations/0037_whip_mobility.sql`:
  `drivers`, `rides`, `identity_verifications` via Stripe Identity,
  `partner_referrals`; production: 1 driver, 0 identity verifications) and its
  routes on the one Worker (`workers/mccluster/src/whip/`). Nothing is
  duplicated.
- **Eligibility to apply, never driver status.** Drivers still pass Whip's own
  flow: identity verification, background check, insurance, and the TNC
  licensing their jurisdiction requires. The McCluster unlock grants only the
  right to start that application and to see the transport layer.
- **The voter-registration rule ships DISABLED with `requires_counsel_signoff =
  true`.** Paying or rewarding people per voter registration is restricted:
  federal law makes it a crime to pay or offer to pay anyone *for registering*
  to vote in a federal election (52 U.S.C. § 10307(c)), so the registrant may
  never receive anything; and many states restrict paying registration-drive
  workers per registration or by quota. Whether a non-cash unlock for the
  *assister* falls under those state rules is exactly the question for counsel.
  A nonprofit's registration work must
  be **nonpartisan**. Before it can be enabled, counsel must approve whether a
  non-monetary unlock tied to registration assistance is permissible at all,
  and in which states.
- **What may count, if counsel approves:** only verifiable, nonpartisan
  registration-assistance actions (for example a completed hand-off to the
  official state portal or vote.gov, reviewed like a mission proof).
  **Never collect or store how anyone votes**, their party, or any **voter-file** data.
  No counting source is built: `action_unlock_progress` answers
  `counting_source_pending_counsel` for this rule even if someone enables it.
- These are **owner/legal decisions**.

## 3. The memo review loop

```
draft ──submit──► submitted ──start_review──► in_review ──approve──────────► approved
  │                  │                          ├──decline ("pass")───────► declined
  │                  │                          ├──request_changes──► changes_requested ──resubmit──► submitted
  │                  │                          └──owner_edit──► owner_edited ──resubmit──► submitted
  │                  │                                             ├──owner_edit (again)
  │                  │                                             └──approve──► approved
  └─withdraw─► withdrawn ◄─withdraw─ (submitted, changes_requested, owner_edited)
```

- One table of 14 legal transitions, in SQL
  (`action_policy_memo_next_status`) and JS (`TRANSITIONS`); a test proves
  they are identical, and that every other (state, action, actor) is refused.
- `approved`, `declined` and `withdrawn` are terminal. A pass is final for
  that memo; the fellow starts a new one.
- `decline`, `request_changes` and `owner_edit` **require a note** to the
  fellow. `owner_edit` also requires text that differs from the current
  version.
- **Versions are immutable.** Every submission and every owner edit writes
  `action_policy_memo_versions` (title, body, `sha256`, parent,
  `diff_from_parent`, note, author role). An owner version must carry a parent,
  a diff and a note (table CHECK). The diff is a deterministic line LCS diff
  computed in SQL; the browser uses the identical algorithm for display, and a
  test compares them on shared fixtures.
- **The review log is immutable**: `action_policy_memo_reviews` records every
  transition (actor role, from, to, version, note, time). Update and delete
  are refused by trigger, even for the service role; the only delete is the
  cascade when the service role erases a whole memo (member erasure).
- **Notifications:** each owner action writes `network_notifications`
  (`type = 'action_policy_memo_review'`) to the fellow, with the action and
  note.
- After an owner edit, the fellow's working draft becomes the owner's text, so
  "edit it myself and tell them what I edited" is one step for the owner and
  the fellow sees the diff and the note.
- The owner cannot review a memo they wrote.

Access: a fellow reads only their own memos, versions, reviews and research;
the desk (`eu_is_admin()`) reads all; anon reads nothing. Nobody writes the
tables directly; every write is a `security definer` RPC with
`search_path = ''`.

Bounties: a memo can reference `bill_id`, `official_profile_id` (and later a
bounty). Paid bounty submissions (`action_policy_memo_submissions`) stay
service-only and are **not** merged into this loop yet; when a funded bounty is
answered by a fellowship memo, the submission should point at the approved
version (follow-up, owner decision on money first).

## 4. Research workspace

Fellows collect sources into a per-memo research collection
(`action_policy_memo_research_items`): kind (`news`, `scholarly`,
`public_data`, `legislation`, `halo_intel`, `manual_citation`), provider,
provider id, title, https URL, publisher, `retrieved_at`, license/terms note,
`content_sha256`, the fellow's note.

**A search result is not verified evidence.** Every item is an unverified lead,
stored as `unverified_lead` (the CHECK allows nothing else), and that never
changes on this table. Verification belongs to the evidence canon (PR #438,
`docs/control-plane/INTEL-TO-MISSION-CANON.md`): a lead becomes evidence only
when the desk ingests it as an `ops_ingest_records` snapshot and an
`intel_evidence` row (publisher, URL, `retrieved_at`, license, `content_sha256`)
whose `review_status` the canon's append-only `intel_reviews` moves to
`accepted`. The research table is the **thin link**: `canon_source_record_id`
(→ `ops_ingest_records.id`) and `canon_evidence_id` (→ `intel_evidence.id`).
Their foreign keys are added when the canon is applied (both files are
pending), using the canon's `(id, org_id)` keys with the fellowship's org.
Shown status is read from the canon row, never copied. Memo citations to
claims go through `intel_claims` with purpose `public_interest_research`. No
competing evidence store is created here.

### Providers (no scraping)

- **Google Scholar has no official API, and its terms prohibit automated
  querying/scraping.** The platform never fetches it. A fellow may type a
  citation they found there by hand (`kind = manual_citation`,
  `provider = manual`). There is no `google_scholar` provider value.
- Scholarly search goes through official/open APIs, with attribution and
  rate limits, server-side (each one's current terms to be re-checked when its adapter is built): **OpenAlex** (CC0 metadata; follow its current
  access rules: contact email or API key, daily limits), **Crossref** REST (polite pool, `mailto`), **Semantic
  Scholar** API (key optional, rate-limited; license terms to review),
  **CORE** (API key), **arXiv** API (rate limit; attribution), **PubMed
  E-utilities** (NCBI rate limits; `api_key` optional).
- News: the existing GDELT adapter (`public-gdelt-news`, cached).
- Legislation: the existing LegiScan sync (`LEGISCAN_API_KEY`) and
  Congress.gov (`CONGRESS_API_KEY`), and Open States (`OPENSTATES_API_KEY`),
  all already listed (disabled) in `civic_source_registry` with their terms
  notes.
- Halo intel: by reference to the canon, never a copy of Halo's store.

Not built yet: the server-side search adapters themselves. Adding one means a
`civic_source_registry`-style entry with its terms reviewed and its key named
(never committed), a Worker or Edge Function route that fetches, caches and
attributes, and per-member rate limits. Until then fellows add items by hand
with the provenance fields above.

## 5. "Smart for their state"

A state Policy Fellowship cohort carries `region_key`; a memo inherits it.
Memo templates are prefilled from data that already exists for that state:
`action_policy_bills` (by `region_key`/`jurisdiction`), verified
`action_policy_official_profiles`, and `civic_jurisdictions` /
`civic_offices` / `civic_office_terms` once the sync runs. In production all
of these are empty today, so the template is blank but honest. Filling them
needs the owner to enable a source: Open States (state legislators, bills,
committees; API key `OPENSTATES_API_KEY`; review its usage and attribution
terms before enabling) and/or LegiScan. No provider is enabled by this change.

## 6. Super-admin: officials and campaign software

What exists: verified official profiles (published only when verified),
office-centric civic registry with verified public contact channels, and a
service-only candidate workspace. Nothing in production yet.

**Boundary (design, owner/legal decisions flagged):**

- **Separate entities, separate data.** McCluster Corp is a Connecticut public
  charity (AGENTS.md: CHR.0069693). A **501(c)(3)** organization may not
  participate or intervene in any political campaign for or against a
  candidate, and its lobbying must stay within the applicable limits
  (insubstantial-part test, or the 501(h) expenditure election). Charitable
  activity, funds, data and staff must be kept separate from candidate or
  campaign activity. Nonpartisan policy education and memos to officials on
  issues are the charitable lane; anything that helps a candidate get elected
  is not.
- **Campaign software is a separately configured workspace** owned by a
  separate legal entity (a candidate committee, a PAC, or a 501(c)(4)/527 as
  counsel decides), with its own tenant/org id, its own data boundary, its own
  consent records and its own audit log. Fellowship data (members, memos,
  research, mission records) does not flow into it, and campaign data does not
  flow back, except by an explicit, consented, logged export the owner
  approves.
- **Contributions, FEC and state campaign-finance reporting are out of scope**
  until counsel confirms the entity and the rules. No money handling is built.
- **No voter-level psychological profiling, no sensitive-trait inference, no
  covert persuasion targeting.** Contact data is purpose-limited and consented;
  every access and export is audit-logged. The fellowship sends memos to
  officials; it does not target constituents.
- **CRM at the lowest level** means the L1b business half: a creator's own
  contacts, for that creator's own business, on the plane's existing CRM
  (`out_*` / `comms_*`), never a second CRM. The officials/campaign CRM at the
  top is the separate workspace above, not this one.

**Relation to the evidence canon.** The canon (PR #438) enforces in the
database that claims cannot target a person and that there is **no electoral
purpose** lane. That is the same line this design draws: nonpartisan memos to
officials on issues may cite canon evidence (purpose
`public_interest_research` / `nonprofit_program`); the campaign workspace
gets **no access** to the canon or to fellowship research, and if it ever
needs research it keeps its own store inside its own entity's boundary.
Politician coordination for nonpartisan policy (who receives a memo) uses
verified `action_policy_official_profiles`, which is office-holder public
information, not campaign data.

These are **owner and legal decisions**; the design does not block on them,
and nothing in this change touches candidates, campaigns, money, or contact
data.

## 7. What the UI has (this change)

- **Owner:** `control.html` → Human Uprise → **Policy memos** tab
  (`js/control-room/action-network.js`): the queue (submitted, in review,
  owner-edited) and recent decisions; each memo shows the current version,
  the diff against its parent, the review log and research leads; actions
  Start review, Approve, Request changes, Pass, and Edit (prefilled text plus
  a required note). If the pending migration is not applied it says so.
- **Fellow:** `action-policy.html` gains a signed-in **Your policy ladder**
  section (`js/policy-fellowship-desk.js`): the three starter steps and the
  next step; with a seat, the memo list, a new-memo form, the editor (save
  draft, submit), owner notes and diffs, and the research form (manual leads
  with provenance). Phone width first; inputs at `max(16px, 1rem)`.

Remaining UI (not built): server-side scholarly/news search inside the desk;
memo templates prefilled from state data (needs synced data first); a desk
editor for ladder rules and mission→kind mapping (today: SQL or the
Supabase table editor as the owner); policy team management beyond
`admit_fellow_to_cohort`; the CCTV-gate predicate shared with the World.

## 8. Open questions for Matthew

1. **Artist ↔ fellow:** may a creator/business account also be a fellow?
   Default here: yes (`creator_exclusive = false`).
2. **All three starter missions, or any of them?** Default: all three
   (`min_count = null`); one UPDATE changes it.
3. **Which legal entity runs the fellowship, and which runs the campaign
   workspace?** Default assumption: McCluster Corp (charity) runs the
   nonpartisan fellowship; campaign software waits for a separate entity and
   counsel.
4. **Where does the politicians list come from?** The officials already
   recruited need a source of record: verified `action_policy_official_profiles`
   entered by the desk with a verification method, or a separate
   campaign-workspace CRM. No names are seeded.
5. Should the existing Equity Uprise cohort (`d68908b7…`, Connecticut) become
   the first state Policy Fellowship cohort (`program = 'policy_fellowship'`,
   its Connecticut `region_key`)?
6. Who besides the owner may review memos? Today the check is
   `eu_is_admin()`.
7. **E=Up "plus shares":** which shares count, and how many?
8. **Identity vendor:** Stripe Identity (already in the Whip routes) or Persona,
   and the biometric consent text and retention period (counsel).
9. **Voter-registration unlock:** counsel's answer on whether any unlock may be
   tied to registration assistance, and in which states.
10. **Which free layer** do logged-out visitors get (today: flights)?

## 9. Production apply checklist (owner approval required)

1. Owner approves the design and answers questions 1, 2 and 5.
2. Create the "write a song" and "go to a rally" missions (draft → review →
   open) and map them, plus any extra `help_person` missions, in
   `action_ladder_mission_kinds`.
3. Apply `supabase/pending/policy_fellowship_ladder_v1.sql` with the Supabase
   MCP `apply_migration` under the name `policy_fellowship_ladder_v1`, as the
   service role. Before applying, confirm `admit_fellow_to_cohort` still hashes
   to `46c78700` (md5 prefix of `pg_get_functiondef`); if it changed, merge.
4. Verify: `select public.policy_ladder_status()` as anon returns three steps;
   `get_advisors` shows no new security findings; the desk's Policy memos tab
   loads an empty queue.
5. Promote the file per `supabase/pending/README.md` (version, `git mv`,
   production ledger, drift contract).
6. Create the first state cohort(s) with `program = 'policy_fellowship'` and a
   `region_key`.
7. Leave `equity_uprise_activation` and `whip_transport_partner` disabled. To
   enable either: counsel signs off (`counsel_signoff_at`, `counsel_signoff_ref`),
   the vendor/consent work (E=Up) or the counting source (Whip) is built and
   reviewed, then `enabled = true`.
8. Later, separately: after the canon (PR #438) is applied, add the FKs for
   `canon_evidence_id` / `canon_source_record_id` and the ingest path from a
   lead to `intel_evidence`;
   unify the CCTV "completed mission" predicate; enable a legislation source
   after its terms are reviewed.

Rollback: the header of the pending file lists the exact statements, in
order. Export memos before dropping their tables.

## Tests

- `node --test scripts/test/policy-fellowship-ladder.test.mjs` — JS/SQL state
  machine identity, illegal transitions, note/change rules, ladder rule
  evaluation, next step, the diff fixtures, RLS shape, providers, immutability.
- `scripts/test-policy-fellowship-db.sh` (needs a scratch Postgres 16) — applies
  the real migration chain plus the pending file twice and runs
  `supabase/tests/policy_fellowship_ladder.behaviour.sql` as the real API roles.
