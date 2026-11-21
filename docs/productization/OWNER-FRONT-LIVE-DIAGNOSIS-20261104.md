# Owner editor: live diagnosis and bounded release

Read-only investigation, 2026-11-04. No production mutation or publication.

## Evidence and limits

- GitHub `main` AND the published `gh-pages` editor return blob
  `c1af7b5a155f8d302a25200a7b1d461069cf015b` for
  `js/control-room/front-page.js`. Both use `site_content_set`/`site_content_revert`,
  not the local `owner_front_*` workflow. The tested local fix has not shipped.
- Production catalog query confirms `mnet_is_admin`, `site_content_set` and
  `site_content_revert` exist; all FOUR new owner snapshot/publish/draft RPCs are
  absent. `site_content` and `site_content_history` exist with RLS enabled;
  `site_content_audit_t` exists. `owner_front_drafts` is absent.
- Production `mnet_is_admin()` resolves `current_m_uid()` through the caller's
  primary `m_auth_user_links` row, then checks `mnet_admin_m_uids()`. The latter
  identifies the primary M-account linked to the owner email already coded in
  that function. Frontend admin visibility alone is insufficient. No user rows
  or account mappings were changed, and no owner JWT was available to test the
  actual session. Do not loosen this gate to make a failing session work.
- Both live hosts could not be fetched: the execution proxy returned tunnel
  HTTP 403; the web reader also reported inaccessible URLs. This is an environment
  access failure, not evidence that the website itself returns 403 to users.
  Therefore the user's exact live symptom remains unconfirmed. Do not claim the
  missing new RPCs explain failure of the OLD editor: it does not call them.
- Expected personal editor route:
  `https://matthew.mccluster.org/control.html#create:front-page`.
  Source routes company non-World pages toward the personal host. Redirects,
  browser cache, current session and iframe delivery remain unverified live.

## Smallest path to the actual product

Use the existing production release route after the following gates, not a new
hosting product. The local change touches only two runtime files:
`js/control-room/front-page.js` and `js/site-editor.js`; index.html is unchanged.

1. Reconcile the local patch against then-current main, preserving parallel work.
   Prepare the review branch/PR only when publication is authorized. Keep the
   architecture guidance separable. Run the existing exact-commit deployment gates.
2. Replay the two baseline site-content migrations and the pending proposal in
   a full isolated canonical PostgreSQL schema. Confirm grants, history trigger,
   auth.users FK, canonical M-account helpers, and simultaneous legacy/new writers.
   PGlite validates SQL semantics but cannot establish multi-session scheduling.
3. Review/promote `supabase/pending/owner_front_publication_v1.sql` as one numbered
   migration. Dependencies: auth.uid(), auth.users, mnet_is_admin() and its
   current_m_uid()/mnet_admin_m_uids()/m_auth_user_links chain; site_content,
   site_content_history, site_content_audit_t, and seven-argument site_content_set.
   It adds four authenticated entry RPCs, one private validator, a private draft
   table and monotonic sequence. Table/sequence browser grants are revoked; RLS is
   enabled and forced. Each entry RPC checks auth.uid plus the existing admin gate.
   Existing content/history and legacy writer permissions are preserved.
4. Separately approve production SQL application. Verify function signatures,
   grants and owner-session read access before frontend rollout. A real signed-in
   owner may call the read-only snapshot endpoint; do not impersonate their JWT.
   Anonymous/member calls must fail. A deployment/service-role session is not
   a substitute for this check.
5. Separately approve merge/frontend deployment, explicitly recognizing that
   pushing main triggers `.github/workflows/deploy-pages.yml`. It waits for the
   exact-commit CI gate, stamps assets and publishes gh-pages. SQL must already
   be available; a frontend-only release intentionally disables publishing.
   Do not casually promote SQL and UI in one merge: independent integrations
   can race. Record actual migration version and deployed asset SHA.
6. Open the route above on the user's device. Read-only acceptance: correct asset
   version, owner authorization, live snapshot/history and real iframe handshake.
   Saving drafts/publishing production content are separate owner actions. Stage
   an innocuous change, publish only intentionally, then verify history restore
   as a new publication. Watch the Network error for the OLD editor first if the
   user needs an immediate diagnosis: public read, iframe handshake, authenticated
   site_content_set response. The absence of an owner-session trace remains a gap.

Rollback: revert ONLY the two runtime files through the reviewed release path,
preserving unrelated changes. Leave the new schema inert, or separately approve
`supabase/pending/owner_front_publication_v1.rollback.sql` after removing callers.
It drops four entry functions and the validator; it keeps private drafts, sequence,
public content and history. Reapply preserves these records (tested). A page-history
restore does not roll back application code or database functions.

## Optional accessible isolated preview

The existing `127.0.0.1:4317` URL belongs to this execution machine, not the user's
phone. No port-share/hosted-preview capability is available in this session.
The current development harness contains synthetic shared owner identities and
MUST NOT simply be tunneled to the internet.

If a preview is preferred before release: approve a temporary, access-restricted
preview on an existing controlled release runner, with a named expiry. Run the
same harness against its own disposable local database behind authenticated TLS
access; retain loopback binding, restrict access to the owner, review proxy host/
origin handling, and strip or protect fixture-role endpoints. No production tokens,
SQL, OAuth allowlist, DNS cutover or paid service are needed. Validate its exact URL
from an external device before handing it over, then remove the preview after review.
This is a concrete proposed deployment boundary, not a created URL or an already
verified hosting target. Host selection, authenticated access setup and deployment
still require approval and environment access.

## Local supporting checks

The added isolated test reproduces the observed production M-account helper chain
with synthetic rows. It verifies owner success and nonowner/missing-primary-link
rejection. Together with earlier tests it covers ten SQL cases. This improves
coverage but does not prove the user's real session is correctly linked.
Previous results remain: 100 targeted JS tests; 104 full-Control browser checks;
SQL-backed draft/resume/publish/history/restore and conflict reconciliation pass.
Logs: `/workspace/audit-evidence/owner-front-db-live-auth.log` and
`/workspace/audit-evidence/live-editor/fetch.json`.
