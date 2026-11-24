# Hitman's Halo: the next lanes

Written 2026-11-24. These are plans, not built work. None of them blocks the module (`HALO-MODULE.md`), the feed fix
(`HALO-FEED-INVENTORY.md`) or the first case (`HALO-CASE-FUKUSHIMA-RENESAS.md`). Each is its own reviewable change and
each needs the owner's go-ahead where it says so.

Roles, fixed across all of them: **McCluster Core leases small independent jobs. Code computes GIS joins. Models extract
and investigate, with provenance. Halo is where the owner reads the result.** No mixed-GPU model split is required for
any lane here.

## 1. Live watch

Order of sources:

1. **USGS first.** A USGS ingest path already exists for the environmental event timeline
   (`workers/mccluster/test/eup-environment-usgs.test.mjs`; its release switch belongs to another change, not this one). Before quakes become keyed evidence the Worker must stop dropping the revision:
   `normalizeQuake` keeps `time` and drops `updated`, `status`, `magType`, `ids`. Key: `usgs:<id>:<updated>`.
2. **Approved regional sources** next, one at a time, each with its licence recorded on `ops_ingest_connectors`: JMA for
   Japan is the first candidate (the case shows why: its bulletin is the event-day regional signal).
3. **GDELT as discovery only.** A GDELT row is a pointer, never evidence. Each candidate is corroborated by fetching the
   **original article**; the article, not GDELT, becomes the evidence, with its own publisher, URL, published time and
   content hash. A candidate with no reachable original is dropped and counted.

Rules for every source:

| Rule | Meaning |
|---|---|
| Source times | Observed, published (with precision) and ingested are separate; `available_at` is computed, as in the case |
| Dedupe | By (source, record, revision), then by content hash; syndicated copies of one article link to one original |
| Retention | Per connector (`retention_policy`); raw article text only as long as the licence allows; the hash and the citation are kept |
| Coverage and freshness | Per source and region: last provider time, last successful fetch, rows returned, rows kept, and the reason for the difference. The same six conditions Halo's feeds now use: loading, fresh, stale, empty, unavailable, failed |

Jobs Core leases, each small and independent: fetch one source window; fetch one original article; extract statements
from one document; join one event to the facility set; open or update one case. A join is code over verified coordinates
(point in polygon, distance), never a model's guess, and never run against a site whose coordinates are unverified.

## 2. Retrieval benchmark

Question: for the owner's archive of more than a million tokens, when is plain keyword-and-link search enough, and when
does budgeted recursive retrieval earn its cost?

- **Same questions for both.** A fixed set written before either runs, with the passages that answer each marked by a
  person. Include questions whose honest answer is "the archive does not say".
- **Arms.** (a) keyword plus linked-record search over the canonical context plane; (b) recursive retrieval with a fixed
  budget (calls, tokens, wall time) per question.
- **Scored on:** citation correctness (does the cited passage say it), recall against the marked passages, latency, and
  cost. Report each, never a single blended score. A correct "not in the archive" counts as correct.
- **Where it runs:** through the one context plane (`docs/control-plane/AI-HARNESS.md`). No shadow vector store, no
  second conversation database, no raw transcript in Git.

## 3. Evidence, recommendations and approvals

- **Original evidence is immutable.** A correction is a new revision beside the old one, as with the seven ShakeMap
  versions and the four notices in the case.
- **Recommendations and approvals are versioned**, each with actor, time, the evidence ids it rested on, and the outcome
  when one is known. `ai_context.decisions` with `intel_decision_basis` already carries this; `supersedes_id` links
  versions.
- A recommendation written by an agent is `proposed`. Only the house owner's recorded approval changes that.

## 4. From an approved decision to a mission

An approved environmental decision **can become a voluntary mission**. It is never an automatic dispatch: the decision
links to a *draft* mission (`intel_mission_decisions`), the owner publishes it, and members choose to join. Nothing in
Halo assigns a person or shows where one is.

## 5. Policy enforcement for the module

`HALO-MODULE.md` step 3: decide what a disabled or draining `halo` unit closes (the page, the feeds, the operations
routes, the Core jobs that write evidence) and what happens when the policy store cannot be read. Owner decision first.

## 6. Smaller follow-ups found on the way

- Pass the NHC advisory time and the NIFC update time through the Worker so those feeds have a provider time.
- Run the staged SQL (`eup_module_policy_halo_v1.sql`) on a disposable PostgreSQL or PGlite before the owner reviews it.
- Add a `published_at` (with precision) to the evidence path, and an as-of read, so a replay can run from the store.
