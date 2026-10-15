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
  present in production).
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
non-exclusive, and the switch is data: `action_ladder_rules.creator_exclusive`
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

### The rule is data

- `action_ladder_starter_kinds` — the kinds (seeded: `help_person`,
  `write_song`, `attend_rally`).
- `action_ladder_mission_kinds` — which missions count for which kind. The
  desk maps them (RLS: `eu_is_admin`). Public can read the mapping.
- `action_ladder_rules` — row `policy_fellowship`: `required_kinds`,
  `min_kinds` (`null` = all of them; `1` = any one), `creator_exclusive`,
  `active`.

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
stored as
`unverified_lead` (the CHECK allows nothing else). Verification belongs to the
canonical evidence/claim schema being written on `docs/halo-intel-mission-canon`
(`docs/control-plane/INTEL-TO-MISSION-CANON.md`), which was **not yet pushed**
when this was written. Until it lands, the research collection is a thin link
table with a nullable `canon_source_id` (deliberately no foreign key) and is
**pending reconciliation**: when the canon's source/snapshot table is applied,
a follow-up migration adds the FK, backfills `canon_source_id` by URL/content
hash, and widens `evidence_status` to the canon's review states. No competing
evidence store is created here; `decision_intelligence.sources` (pending) and
the canon are the candidates.

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
   (`min_kinds = null`); one UPDATE changes it.
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
7. Later, separately: reconcile `canon_source_id` with the evidence canon;
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
