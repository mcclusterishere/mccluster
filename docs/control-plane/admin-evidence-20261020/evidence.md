# Evidence lineage and decision integrity — W01/W02/W03

Prepared 20 October 2026 against current-main source `e9d8604988496783fa25f4c450bd49fec69ba476`. This is local implementation and test evidence, not a production-deployment attestation or an independently accepted community outcome. The migration remains pending. No production rows, collector flags, publication settings, provider entitlements or deployment state were changed.

## Existing authority and the implemented trace

The implementation extends the existing USGS collector, `ops_ingest_*`, `intel_evidence`, `intel_claims`, stance-bearing evidence links and human reviews, `intel_briefings`, private `ai_context.decisions`, `intel_decision_basis`, Action missions/proofs and `intel_outcomes`. It introduces no alternative graph, identity, scheduler or store. The `ai_context` schema remains private.

The real SQL replay runs the existing `intel_mission_canon.behaviour.sql` fixture: bounded source records → accepted source evidence → reviewed supported claim → cited briefing → proposed decision and basis → attributable approval → draft mission → submitted proof → verified proof and accepted outcome → feedback evidence. Stable IDs and the existing lineage RPC connect each step. Those records are synthetic fixtures. “Accepted outcome” in this fixture means the existing database workflow accepted fixture proof; it does not demonstrate a real intervention, partner acceptance, causal benefit or scientific result.

New feedback is a new claim link. It queues the old claim and dependent final briefing for review. The extended fixture explicitly reviews that feedback and creates a new briefing before proposing the next decision. Re-review does not resurrect an earlier approval fingerprint.

## Recoverable decisions and audit boundaries

`context-decision/proposals.mjs` persists proposals in the existing private table using an actor-and-organization-scoped idempotency key, a transaction advisory lock and a unique index. A normalized immutable input is saved with the proposal. An exact retry returns the same ID; changed input under the same key returns conflict. Human membership is checked by the Edge Function before this persistence helper. User input cannot supply the server-owned receipt or approval fingerprint.

The Worker performs an authenticated `intel-decision/v2` contract handshake before any proposal write. Explicit keys are supported; existing callers without a key receive a deterministic content key. Deliberately creating another otherwise identical proposal requires a new explicit key. This prevents an old deployed Edge Function from receiving a retryable proposal it cannot deduplicate.

Decision insertion and basis recording are separate remote operations. If the proposal commits and the subsequent basis RPC fails, the response retains the original decision ID/key, says `actionable:false`, and gives the exact same-POST retry instruction. Audit state is `unconfirmed`, not falsely “failed”: a lost RPC response could follow a committed transaction. The database readiness endpoint resolves that ambiguity.

`intel_record_decision_basis` commits the existing basis rows and one existing `control_audit` proposal receipt in one database transaction. An unavailable audit ledger rolls this transaction back while leaving the prior proposal available for repair. Replaying the same proposal and basis operation repairs it without a second decision or proposal audit event. The receipt retains the original proposing actor and the reconciling actor. A dangling audit ID is explicitly `recorded:false/state:missing` and cannot satisfy approval.

This scoped change does **not** replace the generic audit helper. Approval, mission, review and outcome routes still expose that helper's `audit.recorded:false` result when the underlying action succeeds but its audit write fails. Those responses must not be represented as a complete audit trail. Durable reconciliation for those other action types remains follow-up work; only proposal/basis recovery is implemented here.

## Approval, corrections and actions

The pending migration computes a SHA-256 change-detection fingerprint over existing basis IDs, briefing content and citations, claim statements/reviews/stances, evidence content/review/location/measures and source status. This fingerprint is not a calibrated confidence score or a proof that a statement is scientifically true.

Approval requires a final briefing with nonempty citations, represented basis links, accepted reviewed evidence, supported reviewed claims with accepted supporting evidence, a real matching proposal receipt, and a current human organization owner/admin. The empty-JSON-citation regression is covered even when a direct SQL writer restores `status='final'` after deleting all citations. Approved decision text and its approval snapshot are immutable; a changed decision needs a replacement proposal.

Creating a linked draft mission, opening it, or starting member work rechecks the current basis and approving actor's membership. A revoked approver, retracted claim, changed evidence or missing receipt blocks new work. Existing proof submission/review remains available so history and newly observed outcomes are not discarded. Existing mission publication permissions are still required; this adds a condition, not a grant.

Content/source URL/license/geometry changes withdraw evidence review. Claim edits, link edits, rejected evidence and retractions queue dependent claims and mark affected final briefings `draft`. Citation/link mutations lock their parent rows to serialize against approval snapshots. Source revisions preserve old rows and use parsed offset-aware provider revision timestamps. A strictly newer changed source revision supersedes older source records and queues affected evidence, claims and briefings. Old replays cannot restore source authority. Missing or invalid provider revision times remain unknown and require explicit review; this migration does not infer their ordering.

## Projection and source health contract

`intel/projection.js` provides descriptive `mccluster-intel-projection/v1` and `mccluster-source-health/v1` envelopes. The existing owner evidence route adds the envelope and bounded-read completeness metadata; the USGS adapter persists it inside existing `source_ref` JSON. Current schema geometry checks remain intact.

| Field family | Meaning |
| --- | --- |
| Identity | Organization, connector/source, evidence, source-record and provider event IDs; source revision and content hash |
| Time | Separate observation, publisher publication, discovery, retrieval, forecast issue and validity fields; unknown values are null and time basis can be unknown |
| Geometry | Canonical finite source-published point only; derived geometry is separate and requires method and explicit uncertainty; no null-island placement |
| Values | Existing measures plus explicit value/unit records when the adapter knows them; USGS magnitude scale can be unknown and depth is kilometers |
| Truth kind | `unknown`, `observation`, `published_report`, `forecast`, `reference`, `aggregate`, `inference`, `fiction`; no universal confidence value |
| Context | Declared coverage, source health, license/attribution/use limits, review actor/time, supporting/contradicting/context references |

This slice wires the existing USGS observation path and owner evidence response. It does not claim that every source family, export or UI card now consumes this envelope. Other adapters must explicitly supply their known publication/forecast semantics. Syndication adjudication and universal citation-entailment evaluation are not implemented by this projection helper.

USGS reads now cap the response body at 2 MB and retain the 15-second deadline through body consumption, not merely until response headers. Redirects, non-2xx responses, malformed payloads, timeouts and oversize bodies are failures; HTTP 204 and validated empty collections are true empty responses. The existing feature flag, checkpoint/deduplication, entitlement and collector-frequency gates remain authoritative. Revisionless events use content hashes for deduplication and do not invent a provider revision from the observation time.

Health separates transport (`unavailable`, `timeout`, `denied`, `failed`, `running`, `responded`), coverage (`truncated`, `last_success_only`, `unavailable`, `empty`, `monitored`, `unknown`), last-success age/staleness and rejected-record quality. Last-success data is retained. A 30-minute staleness default is an operational display threshold, not a funder criterion or scientific guarantee. A full 500-record page is truncated monitored coverage, never all seismic activity. HTTP success alone does not imply coverage or data quality.

## Capability matrix for this slice

| Actor | Owner Intel routes | Direct database boundary | Action scope |
| --- | --- | --- | --- |
| Guest | Denied before dispatch/cache | No raw Intel grants or privileged RPC execution | Existing public projections only |
| Member | Denied | Existing RLS returns no raw Intel rows; new privileged RPCs denied | Existing member-owned Action workflow; stale linked Intel basis blocks starting work |
| Creator | Denied unless separately house owner | Creator/profile status grants no Intel authority | Existing creator permissions only |
| Tenant administrator | Top-level house-owner gate remains required | Existing organization owner/admin RLS only for that organization; no new RPC execution | No cross-organization approval or basis links |
| Country/region leader | No new owner diagnostic access | No new regional SQL grants | Country selection is not authority; pending regional work remains separately gated |
| House owner | Existing authenticated gate | Edge rechecks actual owner/admin membership; service RPCs run behind it | Attributable review/approval and draft mission workflow |
| Research collaborator | No implicit Intel access | No new research access or identity export | Requires separately authorized projection/protocol |
| Compute worker | No human approval route | No service-role grant to node credentials | Existing scoped work only; model output cannot approve |

The existing SQL fixture exercises anonymous, member, owner and service roles, tenant separation, append-only reviews and public suppression. New SQL tests exercise privileged-function denial, composite organization foreign keys, actor membership, revoked approver and action-start rejection. Worker tests exercise owner gate preservation and the decision handshake/recovery boundary. Creator, leader and research collaborator do not receive new dedicated grants here; this table describes inheritance from the unchanged top-level gate, not a claim of end-to-end browser sessions for each persona.

## Validation evidence

Commands run from the repository root:

```sh
node --test workers/mccluster/test/intel-recovery.test.mjs workers/mccluster/test/intel-mission-loop.test.mjs workers/mccluster/test/ai-harness.test.mjs workers/mccluster/test/ai-decisions-read.test.mjs
PGLITE_ROOT=/path/to/@electric-sql/pglite node scripts/test-intel-integrity-db.mjs
```

Results: **40/40 Node tests passed**. The isolated PostgreSQL/WASM replay passed the original full canonical lineage/role fixture and the new partial-write, ledger failure/receipt repair, same-ID replay, changed-key conflict, cross-organization FK, revoked actor, immutable approval, empty citation, changed source URL, offset timestamp, source revision, retraction, linked-action and rollback checks. Actual `persistProposal` SQL is executed through a tagged adapter; this is not a string-matching mock. Tooling used Supabase CLI 2.121.0 to generate the pending filename and PGlite 0.5.10 with pgcrypto, installed outside repository dependencies.

The replay uses the repository's existing prerequisite table/role fixtures and a minimal `control_audit` table contract. It is a real SQL execution check, not a full Supabase stack or production migration replay. It has one connection and does **not** establish native multi-session race safety, PostgREST relationship-cache behavior, Realtime policy behavior or deployment success.

`intel-rollback.sql` is an exact manual rollback restoring the three replaced v1 functions and removing only the added enforcement objects. The test executes it and confirms decision/evidence/audit row counts remain unchanged. It does not restore superseded review statuses or delete history.

## Promotion and remaining gates

1. Review the pending migration with the current production ledger and the platform/security owner. Audit existing `(org, actor, idempotency_key)` duplicates and cross-organization decision references before applying its unique/composite constraints. Violations intentionally fail the migration; do not silently rewrite historical actors or links.
2. Run a disposable **native PostgreSQL/Supabase** migration replay and multi-session races: same proposal key, basis/receipt repair, correction versus approval/mission open/join, role revocation and reordered source revisions. Verify PostgREST can embed the existing evidence/source-record composite relationship and retains intended object grants/RLS. PGlite passing does not waive this gate.
3. Typecheck and stage `context-decision` with its existing `jsr:@supabase/functions-js/edge-runtime.d.ts` and `npm:postgres@3.4.5` imports. Use an isolated Deno configuration if repository npm discovery pulls unrelated app dependencies. Verify actual caller tokens, denied service credentials and exact retry semantics against the staged Edge Function.
4. Coordinate a reviewed release with mutations paused: pending SQL first, new Worker next (fails closed against old Edge), then new Edge Function. Deploying new Edge first rejects legacy Intel requests without keys. Verify handshake, repair/readiness and one authorized staged trace before reopening mutation traffic. Keep collector and public release flags unchanged unless separately authorized.
5. Legacy approved decisions lack the new frozen basis/receipt contract and are intentionally non-actionable through new Intel gates. Review and create replacement proposals; do not backfill human approval or infer that old evidence was reviewed under this policy.
6. Before any claim of a globally complete evidence trail, add explicit reconciliation for missing generic approval/mission/outcome audit receipts. Before real pilot/research claims, obtain actual partner authority, rights/consent where applicable, reviewed source support, baseline/observation windows and independent result evidence. Public component/dataset release and regional access remain separate owner-approved gates.

Rollback requires paused mutation traffic and a coordinated Worker/Edge rollback. Restoring v1 enforcement is an intentional reduction in these new protections; do not reopen v1 mutation traffic while claiming v2 integrity. No rollback or production promotion was executed by this work.
