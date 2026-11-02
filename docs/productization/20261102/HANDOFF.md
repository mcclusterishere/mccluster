> Current publication supplement: see [the frozen source manifest and continuation](../20261102-current/SNAPSHOT.md). Historical local-only/no-push wording below describes earlier checkpoints and is superseded only for authorized non-force review-branch publication. No main merge, production migration, deployment, credential change or spending is authorized. Claude's implementation is preserved from `edd8cdd8be4d07fa674071a9b151045bf7cfc94c`; see [its handoff](../20261102-claude/HANDOFF.md). This snapshot publishes reviewed source corrections; complete combined acceptance remains outstanding.

# Whole-site productization master handoff — updated 2026-11-02

**Release decision: gated. This packet is an audit and tested implementation scaffold, not a finished product or deployment approval.** No production SQL, external Claude message, public push, PR, merge, deployment, credential change, purchase or feature activation occurred.

The existing McCluster plane is the implementation target: Control and its current editors, Worker `mccluster`, Supabase `zmnhbrjyhxzhkxmhkexs`, and OVH Core. Do not create another builder, admin shell, identity store, billing engine or social queue. Independent customer installation is a separate release gate already defined by merged PR #683.


## Current assignment and implementation updates

Latest v6 increment: [module consumer ledger](../20261102-social-consumer/CONSUMER-LEDGER.md) and atomic social consumer SQL/Worker integration. Customer social has an explicit compatibility/module mode, transactional advanced mutation checks, and a combined managed-token authorization/read. Default-off; no policy seed. World delivery, other advanced modules and external provider execution retain separately listed gates.

Latest local increment: [default-off annual-registration/trial SQL](../20261102-domain-trial/HANDOFF.md) and [Worker contracts/limits](../20261102-trial/WORKER-CONTRACT.md). Verified registration receipts, scoped capability metadata/require/cancel and conservative social enforcement are prepared. Policy is unseeded, current registrar cannot grant, and consumer integration remains gated. See the v5 bundle checkpoint for the exact source identity.

Product scope: the platform is the first product, with segmented purchasable modules; the builder is its entry door. A separately paid domain plus one month of platform access is the requested offer, not free domain or automatic paid conversion. After trial expiry, customers retain site/data/control and advanced modules disable; annual domain registration is independent. Detailed renewal/hosting/retention terms remain gated. Actual domain purchase completion is a priority, with no live financial action authorized.

Primary priority: the Anti-Social song-led landing/demo → sign-up → existing free builder → save/preview/publish/recovery journey must work before any campaign launches. Song asset/rights verification and paid advertising remain separate gates.

The owner requests ONE comprehensive implementation assignment for the whole existing site, with internal milestones, not separate editor-only prompts. Use [the master Claude assignment](CLAUDE-PROMPT.md) and [whole-site coverage/acceptance](WHOLE-SITE-ACCEPTANCE.md). The original audit below remains historical evidence; its planning-only next-step wording is superseded by this section.

Independent review passed c1505931175a0753170fe7cd803eb7635e5bafcc:77 SQL/HTTP assertions,28 foundation assertions and72 archive hashes. Its immutable source Library artifact is `libfile_bb853859485c81919dee34a083fcf847`, version0. The [v2 contract](../20261102-v2/API.md) is one implemented slice, not the scope ceiling.

The v3 checkpoint was based on exact681. Continued [v4 integration](../20261102-v4/HANDOFF.md) now includes audited main as an ancestor, tested dual-revision Tile bridge and domain correctness fixes; production migrations/ledger match main exactly. Current source CHECKPOINT.json pins the final local commit. [Tile API](../20261102-tile-bridge/HANDOFF.md), [domain evidence/blockers](../20261102-domain/HANDOFF.md), and [platform entitlement queue](../20261102-v4/PLATFORM-CONTRACT-QUEUE.md) are companion implementation contracts. No production SQL/flags or deployment occurred.

Codex owns backend contracts/migrations/replay; Claude owns comprehensive frontend implementation against verified contracts and all existing entry points. Blocked backend areas are concrete requests within the same assignment; they do not stop independent work or become mock-complete features. Approval gates apply to dependent external actions, not ordinary authorized local engineering.

## Source-backed owned architecture appendix

[OWNED-ARCHITECTURE.md](OWNED-ARCHITECTURE.md) maps pinned Puck, assistant-ui, LitServe, next-forge and public Ploy behavior to adopt/adapt/skip decisions. [Exact source pins](architecture-source-pins.json) record inspected commits/blobs. It specifies an owned, bounded chat proposal/preview/Apply/Undo slice and test plan; implementation is not claimed. The tested ba06fed backend remains unchanged. Native Expo does not make the vanilla website React; current three-tile schema and nonstreaming/concurrency1 Core bounds remain. No vendor installation or source copy occurred. Domain/trial/entitlement priorities remain in the same whole-platform assignment.

## Fresh inventory

- Fetched 235 remote branch refs. Main remains `e80cb0a137683393f19ba251f9beb9e66577ce64`; #683 is merged, not open.
- Read metadata for all 82 open PRs: 55 drafts; 30 currently report unmergeable against their declared bases. This is not evidence of 27 newly introduced regressions: prior unknown statuses may have resolved. Five heads have returned failing workflows: #656, #681, #636, #614, #587. No `APPROVED` reviews were returned.
- The per-PR inventory records actual merge bases, ahead/behind counts, changed paths and SQL paths. There are 559 paths touched by more than one open PR; file overlap is a triage signal, not a semantic conflict verdict.
- Draft #681 at `5e020833534b68b31e191b137e9a30da8b58314f` is 64 commits ahead and 14 behind main. It already consolidates the customer stack; do not merge its 18 ancestors independently. Its own notes keep schemas unapplied and paid/provider flags off.
- Production migration ledger is still 355. Actual catalog queries independently confirm missing free-site tables, present Control content/history and PRIM3 progress, and present music asset/version tables. A matching ledger does not attest definitions, grants or deployed code.
- Portability scan finds 136 runtime/config files with known production bindings. This is not an independently installable edition.

See [all PRs](PR-INVENTORY.md), [readiness](BACKEND-READINESS.md), [integration order](INTEGRATION-ORDER.md), [contracts](CONTRACTS.md), [migration manifest](migration-manifest.json), [migration runbook](MIGRATIONS.md), and [gated Claude prompt](CLAUDE-PROMPT.md).

The separate [lyric impact gate](LYRIC-IMPACT.md) includes an aggregate-only preflight, locally checked against the exact source sanitizer on synthetic documents. It was not run against production and does not expose lyrics. The parent supplied additional independent catalog evidence at 02:34 UTC; attributed findings are distinguished from this branch's own raw catalog snapshots.

## What this branch prepares

Six exact existing pending migrations for the minimum owned website, plus optional canonical-artist binding, copied from reviewed #681 into `prepared/`. Every file has a SHA256 and source commit in the manifest. They remain outside `supabase/migrations`; no production history was fabricated. No new schema design is represented as implemented.

`replay-prepared.py` creates its own network-isolated PostgreSQL container, verifies hashes/source bytes, applies the sequence, checks repeat behavior, and inspects actual RLS/grants/triggers. It accepts no production database URL. Existing candidate fixtures execute real SQL and real Worker handlers with synthetic identities; they are not live Supabase Storage, OAuth, DNS, payment or browser evidence.

## Important engineering findings

1. **Ordinary project saves lose concurrent changes.** A fixture reproduces two readers, successful first save, then successful stale save overwriting it. `expected_updated_at` is ignored. `managed-projects.js` has no expected-revision filter or immutable revision history. This must be fixed before a conflict-safe save/restore frontend handoff. The existing tile Studio already has revision-aware RPCs; reuse its design, not its private-media store indiscriminately.
2. **Control homepage edits have narrower semantics than a versioned builder.** Live `site_content_set` is admin-gated, but has no compare-and-swap token; `site_content_revert` deletes the override to restore the shipped default. `site_content_history` exists. Neither RPC is an arbitrary scene-version restore contract.
3. **One optional migration is intentionally one-shot.** Reapplying `canonical_artist_bindings_v1.sql` fails at its existing table inside a transaction. Six foundation files support repeat application in the fixture. Neither behavior proves equivalence to a partially drifted production schema.
4. **Modules are not full admin product controls yet.** The candidate supports owner switches for `world` and `world_discovery`; hosting is nonconfigurable and advertising inert. This does not provide a general module dependency/draining/permission contract.
5. **Domain hosting has an engineering gate.** The provider snapshot expires after 24 hours, with no authoritative scheduled refresh in this candidate; apex routing is not established. Fixture recovery proof is not unattended hosting readiness.
6. **Commerce remains paused.** The parent’s independent catalog review reports that `music_direct_claim_download` consumes a download before signing and returns the current mutable offer path. Treat asset pinning and failed-start reservation/settlement as open until repaired and independently replayed. Existing checkout/session/account/amount/currency guards must survive integration. No price or commission policy was selected here.

## Verification and limits

Fresh local main source tests: **1,322 passed**; Python: **7 passed**. Candidate Worker suite after installing its committed lockfile: **1,330 passed, 4 skipped**. Minimum free-site SQL/Worker fixture passed; provider-binding SQL recovery fixture passed; native owner-storage and two-session quota tests passed. Prepared replay results are in `evidence/prepared-replay.log` (including actual permission rows). Stale-save reproduction confirms a blocker; it is not an acceptance pass.

An initial Worker run lacked installed dependencies; it was rerun after `npm ci`. Initial replay exposed the one-shot optional migration and a local PostgreSQL startup readiness race; the harness now distinguishes one-shot behavior and waits for the final TCP server. No candidate SQL was changed to hide a failure.

No live browser login, real Storage round-trip, paid-provider sandbox, OVH model execution, deployed commit attestation, database restore rehearsal or independent customer installation was performed. Green source tests do not close those gates. Private in-flight archives are parent-reported, not silently substituted with old public branches.

## Next concrete work

First reconcile #681 with exact current main in an isolated integration branch while preserving the 355-migration hygiene and recent payment/privacy protections. Then implement conflict-aware saves and explicit restore semantics over the existing content/project engines, test two-session races and account changes, and refresh this packet. Only after those contracts and required real-service checks pass should Claude receive an implementation-ready frontend brief. Production approval must name the exact reviewed SQL hashes, target, impact and coordinated application SHA; this packet does not request or imply that approval.

Documentation amendment: [Cloudflare registrar capability, evidence and commercial boundaries](../20261102-domain/REGISTRAR-EVIDENCE-AMENDMENT.md). Tested runtime/SQL remains unchanged at b1b994d5; no new activation or financial authority.
