# Character sheet — review slice

Status: local code and isolated tests only. No production migration, deployment, settings, permissions or publication has been performed.

Matthew's public portfolio now links to `character.html`; Control → Create → Character sheet opens `character.html?edit=1`. These are review routes in this branch, not claims that production supports them yet.

## Existing sources and boundaries

- `data/roles.json`, `role.html`, `resume-it-support.html`, `data/seo/entity-graph.json`, `data/dossier.json` and the résumé builders remain the career/profile authorities. No employment dates, skills or credentials were rewritten. The timeline renders the existing public role dates verbatim.
- `data/portfolio.json` and `portfolio.html` remain the existing portfolio. Proposed class project briefs link to existing engineering/research surfaces; they do not claim those projects are finished class work.
- `workers/mccluster/src/prim3/learning.js` and `learning_external_credentials` remain the private credential/review authority. The new handler uses the same house-owner guard, Worker, M Account and data plane. It adds no auth stack or registrar connector.
- `data/portfolio-progression.json` contains the owner-stated CS BS → accelerated Cybersecurity MS goal and Business Administration minor goal. The initial brief listed Chemistry, Natural Sciences, Information Systems and American Government. Later owner instructions on November 6 superseded that list with Chemistry, Financial Accounting, Macroeconomics and history (U.S. History I in the revised plan). The seed follows that correction and adds the conditional Housatonic associate-degree goal; no transfer or completion timeline is asserted. Four remaining slots are explicitly unconfirmed. Eight prep courses are not eight earned credits.

## Owner journey

1. Open the owner workspace using an authenticated house-owner account. Anonymous/member/admin labels do not grant this authority.
2. Set project progress to planned, in progress, or completed/self-reported. Select each course summary to include publicly; all are private initially.
3. Optionally add exact known date intervals against an existing résumé role. Broad source dates are never guessed. Intervals remain self-reported; overlaps count once across the selected roles. Durations use [start,end) dates, 365.2425 days/year, rounded down to tenths. No years-per-skill are inferred.
4. Save a private draft. Reload recovers the server draft. On a conflict, reload the current revision; a failed save never displays success. Working changes are in memory only and disappear on reload.
5. Preview the saved public selection. The server strips all fields except approved summaries and computes a SHA-256 digest. Check the explicit publication confirmation, then publish. A changed revision or changed evidence requires a fresh preview.
6. Public readers receive only the frozen published projection. Subsequent drafts stay private. Unpublish removes the snapshot while retaining the private draft.

The public career-source section remains the already-public résumé catalogue independently of selected experience intervals. Transcripts, student identifiers, certificate paths, reviewer IDs and raw evidence never enter the public projection. The editor does not upload new documents; existing learning-credentials storage stays private.

## Progress rules and validation

Each self-reported completed project earns 25 motivational XP. A matching, independently reviewer-verified CLEP exam earns 100 XP. One level per 100 XP; recomputation replaces the total rather than accumulating awards. Repeated records cannot double-award a course. Planned/in-progress work earns zero. These are motivation points, not academic credits or proficiency ratings.

The adapter reads only the signed-in owner's server records. It requires `verification_status=reviewer_verified`, a non-self reviewer, a verification timestamp, and exact structured metadata: `external_program=CLEP`, `issuer=College Board`, and `title` matching the named subject. Those fields can be supplied through the existing external-credential workflow; the existing reviewer checks the issuer evidence. The adapter does not infer passing results from filenames or transcripts, invent official course codes, or label owner claims externally verified. Four placeholder subjects cannot earn verified-exam XP. No real exam record was supplied or inspected in this task.

Validated evidence is reflected on owner reload and preview. There is no new background watcher or webhook. Public snapshots update only on deliberate publication and remain as-of their publication timestamp; a later rejection requires re-preview/publication or unpublish. Institution credit acceptance, degree requirements, admission and degree completion are unknown and never inferred.

## Persistence and release

`supabase/pending/learning_portfolio_v1.sql` is an unapplied proposal, registered in `live-callers.json`. It adds one private singleton draft/public-snapshot row and a service-only atomic write RPC. RLS is enabled; anon/authenticated roles have no direct access. The RPC repeats the house-owner membership check, locks the row and compares its revision. The Worker performs validation and publication hashing before calling it. No live database or permission changes were made.

Before release: review/promote the pending SQL through the existing migration process, run the shared-data-plane integration checks, deploy the reviewed Worker/static changes through normal gates, then test a real owner account and choose what to publish. Missing storage fails closed. Do not merge this draft as a claim of production readiness.

Remaining scope: choose the other four subjects, approve/implement the proposed class projects, enter known exact dates, provide any actual credential evidence through the existing private workflow, and validate institutional transfer/degree rules separately. This slice does not edit project briefs, import transcripts, attach arbitrary artifact URLs, issue credentials, calculate per-skill work years, or automatically publish updates.

## Review evidence and reproduction

Screenshots contain a synthetic self-reported Chemistry completion, not a claim about Matthew:

- [390px review](review/character-390.png)
- [1440px review](review/character-1440.png)

Tests completed:

- Root `npm test`: 1,962 passing JS tests, 3 skipped; 7 Python tests passing.
- Worker `npm test`: 1,435 passing, no failures/skips (installed existing locked dependencies without lifecycle scripts).
- Focused model/API + existing learning tests: 17 passing after final integration changes.
- Browser journey: 390px and 1440px scrollWidth equals clientWidth; edit/save failure/save/reload/preview/confirmation/publication/public read/unpublish/account-change/denied-owner; no page errors. Network is intercepted with synthetic responses, including global navigation isolation; this is not an end-to-end production test.
- SQL behavior: applied twice in isolated PGlite PostgreSQL runtime; save/publish/unpublish, stale revision, non-owner rejection, anon/authenticated table and RPC denial all pass. This is not a hosted Supabase migration test or concurrency load test.
- `git diff --check` passes.

Commands from repo root (Node 24 used):

```sh
npm test
(cd workers/mccluster && npm ci --ignore-scripts && npm test)
node --test workers/mccluster/test/portfolio-progression.test.mjs workers/mccluster/test/prim3-learning.test.mjs
# Optional review tools installed outside the repo; no dependency/lockfile changes:
npm install --prefix /tmp/portfolio-tools --cache /tmp/npm-cache --no-audit --no-fund playwright@1.58.2 @electric-sql/pglite@0.3.14
PORTFOLIO_TOOLS=/tmp/portfolio-tools/node_modules CHROMIUM_PATH=/usr/bin/chromium node scripts/e2e/portfolio-progression.e2e.mjs
PORTFOLIO_TOOLS=/tmp/portfolio-tools/node_modules node scripts/test/portfolio-progression-db.mjs
```

Implementation checked against [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Workers request documentation](https://developers.cloudflare.com/workers/runtime-apis/request/), plus the repository's installed contracts. The Supabase changelog Markdown endpoint could not be retrieved (unsupported type/403); no new SDK or platform-specific feature was introduced.

## Canonical SQL release proof

`scripts/test-portfolio-postgres.mjs` runs only after the existing disposable
Supabase migration reset and unchanged schema-manifest comparison. It requires
`PORTFOLIO_CANONICAL_ACK=disposable-supabase-reset`, the loopback reset database on
port54322, and the existing pinned postgres@3.4.5 test driver. It refuses existing
portfolio objects and does not install auth, tenancy or role stubs. Synthetic
managed-auth users exercise the actual canonical trigger/dependency chain.

The harness checks client-role denial, service access to the existing credential
schema, invalid inputs, an observed unique-insert lock wait, two observed row-lock
waits for competing save/publication calls, transaction rollback, unpublish,
data-preserving permission rollback and reapplication. Test-owned objects and
users are removed afterward. A green PGlite suite alone does not establish this
native proof; the exact-head hosted Supabase migration-reset job must pass.

The pending RPC rejects null/negative revisions and null actions before its first
INSERT. The Worker integer guard remains unchanged. This closes a service-only
SQL NULL-comparison loophole; it does not grant clients direct RPC access.
