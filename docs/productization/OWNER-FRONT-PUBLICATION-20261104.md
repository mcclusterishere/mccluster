# Owner front page publication and recovery

Local implementation on main `4fc32c84970d1a5cbc69c2df218e700bcea14032`.
Implementation checkpoint before review publication. No merge, deployment, production migration or setting change.

The existing Control front-page settings editor now previews history and shipped
defaults without publishing, then publishes explicitly against the revision loaded
from the server. A stale revision cannot overwrite a newer edit. It reuses
`site_content` at `index.html` / `@front`, its existing audit trigger and
`site_content_history`; the published store and identity stay canonical. One private per-user draft table
is added in the pending proposal.

## Existing work and scope

Rechecked open PRs on 2026-11-04. #681 remains at
`5e020833534b68b31e191b137e9a30da8b58314f`, #636 at
`a5efd156978ad648e5407404733915d1db78ffb5`, and #493 at
`9ad0503ead6c4a581e61cc529639bebd4fa64131`. The prior audit inspected #681's
changed files and implementation status and #636's Studio consolidation contract.
Those branches own managed member projects, cinematic/tile publication, media and
domain bindings. This slice uses the same private-preview/explicit-publication/
revision-conflict pattern on the existing house settings store. It does not import
their pending schemas or rebuild their customer project publisher. Halo, PRIM3,
camera/screen/grid and city files are untouched.

## Behavior

- Private preview remains the real `index.html` frame. Save private draft writes
  a versioned, per-user draft through an authorized RPC. Resume survives reload
  and database restart. Delete saved draft does not alter the published page.
  Direct browser table access is revoked and RLS is enabled and forced.
- The last 25 history entries are available only through an authenticated,
  server-authorized snapshot. Choosing one stages its content. It never rewrites
  history. Publish writes a new audited change. Reset likewise stages the shipped
  page and requires Publish to delete the override.
- Publication checks the latest history ID as a string, including edits and resets
  made through older writers. It does not rely on timestamps or JavaScript numbers.
- Missing RPCs or unreadable state disable publication and explain the blocker.
  A public read can still seed the preview. There is no legacy write fallback.
- Conflicts and uncertain network outcomes preserve the local draft and block
  retries until the owner explicitly reloads/reconciles live settings. Reload is
  labeled to retain the saved draft. Resume keeps its original publication base;
  a stale saved draft cannot silently overwrite newer content. After loading the
  current live version, the owner can explicitly use the reviewed preview over
  that loaded version, then Publish. Another intervening edit still conflicts.
  No automatic external retry occurs.
- Account changes clear private history/draft state and fence late responses;
  refreshing a token for the same subject preserves edits. JWT decoding is used
  only to invalidate local state, never to grant access.
- The copy pencil publishes immediately and is a separate existing workflow.
  `js/site-editor.js` now suppresses it in same-origin Control/front-studio frames
  so the private preview cannot accidentally publish copy. It remains on the
  standalone site, with this distinction stated in Control.

## Server contract and release gates

`supabase/pending/owner_front_publication_v1.sql` is an **unapplied proposal**,
not an applied migration or ledger entry. It adds snapshot/publish and private draft save/discard RPCs, a private draft
table and monotonic revision sequence, and a
non-browser-callable validator; uses the existing `mnet_is_admin()` gate and
requires an authenticated user; revokes default PUBLIC/anon execution and grants
only the four entry RPCs to authenticated callers. Nonowners are rejected inside
each RPC. It does not change the existing legacy writer permissions.

The validator checks the existing house-settings shape, types, bounds, songs,
tags and safe links. Member custom media and managed-project data retain their
own workflows; non-null house media customization is refused for separate review,
never silently stripped. Existing renderer defaults, including optional tag
flags, are accepted by a direct renderer-to-SQL test.

Short table locks on `site_content` coordinate snapshots/publication with legacy
INSERT/UPDATE/DELETE writers that do not take advisory locks. This also briefly
serializes unrelated content writes: evaluate this tradeoff in full canonical
PostgreSQL replay and a two-session concurrency test. PGlite tests validate real
SQL behavior, stale sequential writers and access controls with synthetic auth;
they do not prove production lock scheduling or the complete production auth graph.

Before release: review against the current canonical schema and grants, run full
isolated replay plus concurrent legacy/new writes, inspect advisors, separately
approve/apply the SQL and capture its actual ledger version, then deploy the
reviewed frontend. Deploying this frontend alone deliberately leaves publishing
disabled. Existing snapshots and schema-manifest are not edited to pretend this
proposal has been applied. The four pending RPC callers are explicitly recorded
in `supabase/pending/live-callers.json`.

Rollback: revert the frontend to its reviewed previous version; retain existing
content/history and saved drafts. The new functions can remain inert. The companion
`owner_front_publication_v1.rollback.sql` removes only the five new functions,
without deleting data; separately review it after confirming no caller remains.
The isolated database suite proves rollback and reapply preserve drafts and history. Resetting
page settings does not roll back code, transactions, payments or deployments.

## Verification

Commands (tool dependencies installed only under `/tmp/mccluster-owner-tools`,
not added to application packages):

```sh
node --test scripts/test/owner-front-publication.test.mjs
PGLITE_DIR=/tmp/mccluster-owner-tools/node_modules node --test scripts/test/owner-front-publication-db.mjs
PLAYWRIGHT_DIR=/tmp/mccluster-owner-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/control-front-page.e2e.mjs
node --test scripts/test/front-cabin-first.test.mjs scripts/test/control-nav.test.mjs scripts/test/control-workspace.test.mjs scripts/test/control-surface.test.mjs scripts/test/member-front-pages.test.mjs scripts/test/account-identity-gate.test.mjs scripts/test/rpc-names-exist.test.mjs
```

Browser tests run actual Control/index scripts at 390 and 1280 widths with all
remote requests intercepted. SQL tests execute the actual pending SQL and two
existing site-content migrations in isolated PGlite. Neither is a production test.
Local logs and synthetic screenshots are in `/workspace/audit-evidence/`.
Latest local results: 100 targeted JavaScript tests passed, including the central
guidance/adapters, editor/navigation, identity and pending-RPC inventory; all 9
isolated SQL tests passed. The updated complete shell browser fixture passed
104/104 checks, recorded in `front-publication-browser-v2.log`. The SQL-backed
browser journey also passed, including two-tab conflicts and explicit reconciliation. No skips
or failures remain in these runs. The browser suite includes guest, member and
owner behavior, publication/reset/history, conflicts, unavailable RPCs, account
cleanup, 390/1280 layouts, zero horizontal overflow and no uncaught JS errors.
The first browser iteration caught an ordinary token refresh clearing the editor;
the implementation now invalidates only when the account changes, with a unit
regression test. A renderer-to-SQL test also caught optional default tag flags;
the validator now accepts those existing defaults. Chromium downloads were denied
by the network proxy, but installed system Chromium ran the final browser proof.
`git diff --check` and JavaScript syntax checks passed. Full canonical database
replay, real multi-session lock scheduling, managed Supabase and physical-device
Safari/Android verification remain release gates.

Not implemented: a general admin-layout editor,
cross-product readiness inventory, permission delegation, customer entitlements
or billing. The latest $6/module/month direction is planning only; no price or
entitlement changes are included.

## SQL-backed runnable preview and owner dogfooding

`scripts/dev/owner-front-preview.mjs` serves the actual front-page Control module
and unchanged index renderer through a loopback-only harness, with an isolated
on-disk PGlite database. It is a test harness, not another product backend or
a replacement Control shell. It binds only to 127.0.0.1, accepts only fixed
synthetic fixture identities, exposes an allowlist of four RPCs, and blocks
remote service requests with CSP. It contains no production credentials.

```sh
PGLITE_DIR=/tmp/mccluster-owner-tools/node_modules node scripts/dev/owner-front-preview.mjs
# Open http://127.0.0.1:4317/control.html inside this environment.
PGLITE_DIR=/tmp/mccluster-owner-tools/node_modules PLAYWRIGHT_DIR=/tmp/mccluster-owner-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/owner-front-sql.e2e.mjs
```

Dependencies used: @electric-sql/pglite 0.3.14, Playwright 1.56.1, installed system
Chromium. The loopback URL is not a public or parent-accessible hosted preview.

The integrated browser suite configures settings using these owner controls,
saves privately, reloads/resumes, publishes, previews history, restores, deletes
a draft, and reconciles a two-tab conflict explicitly. RPC responses come from
real SQL, with synthetic auth helpers. Public reads prove drafts never publish;
member and guest calls are denied. The test checks 390px overflow and uncaught
JavaScript errors. The separate full-shell fixture covers actual Control routing
and 390/1280px layouts with mocked remote services.

These controls cover house front-page settings only. Cross-product owner controls,
admin-layout editing and delegated permissions remain broader roadmap work.
The standing engineering order is now recorded centrally in AGENTS.md under
“Build controls before features”; the existing seven vendor adapters point there.

## Native PostgreSQL completion follow-up, 2026-11-07

The original implementation and PGlite tests are retained. The remaining real
multi-session gap now has a reproducible test:

```sh
POSTGRES_MODULE_PATH=/path/to/postgres/src/index.js \
NATIVE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54322/postgres \
node scripts/test-owner-front-postgres.mjs
```

Local PostgreSQL **17.7** passed all **12** checks. The harness creates and drops
its own scratch database. It uses canonical M-person linking, primary-link lookup,
admin helpers, content tables and audit functions from their committed SQL; only
managed `auth.users`, `auth.uid()` and `auth.role()` are stubbed in this subset.
The local subset is not a full Supabase replay or managed-auth acceptance.

The races synchronize by observing the actual blocked backend in
`pg_stat_activity`, rather than assuming a sleep made two sessions overlap:

- Two new publishers: one commits, the stale other receives `40001`.
- Legacy insert, update and delete before a new publication: each blocks the new
  operation, whose stale base is rejected after the legacy commit.
- New publication before a legacy writer: the legacy writer waits, then both
  changes survive in their correct audit order.
- A snapshot waits for a legacy writer and returns matching content and history.
- Competing draft saves and stale discard reject lost updates. Publication that
  waits for another tab's newer draft preserves that different draft.
- Owner/member/unlinked/anonymous/service identities, private grants, forced RLS,
  malformed inputs, and rollback/reapply preservation are checked as well.

`Reconciliation CI` now runs the same suite **after the full canonical reset and
unchanged schema-manifest gate**, against the real replayed tables, triggers,
auth schema and helper functions. No local stubs are installed in this mode.
It requires an explicit disposable-reset acknowledgement and rejects anything
except the literal loopback Supabase test URL without connection overrides.
The stack is destroyed even on failure. The pending proposal is applied twice
only there, and rollback/reapply is exercised there; no production migration,
production ledger or manifest is changed.

Current main was checked at `cdf80c3dc91a282c4def45606bf3a3473aad688c`.
Canonical migrations, replay migrations and the schema manifest are unchanged
from this branch's base. No overlap with the Arcade, Policy or portfolio runtime
changes is introduced. This follow-up changes only verification and documentation.
Hosted canonical results must be checked on the pushed commit before calling that
gate passed. Actual owner-session/physical-device acceptance and separately
approved SQL-first then frontend rollout remain release gates. This draft must
not be merged as implicit deployment approval.
