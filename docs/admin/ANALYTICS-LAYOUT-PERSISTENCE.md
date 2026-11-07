# Canonical Analytics layout persistence — pending release

Extends #784's editor using a dedicated namespace in the existing Supabase data
plane. No second configuration server, owner directory, Worker proxy, front-page
draft, widget definition or entitlement is created. The two authenticated
PostgREST RPCs are the API, using the same user-token pattern as #780.

## Scope and authority

A layout is shared by authorized owners of one organization, keyed by `org_id`.
It changes presentation only, never collection, metrics, resource access or tiers.
Read and save both require authenticated identity AND the existing
`mnet_is_admin()` AND `mccluster_is_house_owner()` AND `is_org_owner(org_id)`
predicates. Both house and target organization must be enabled. This preserves
#780's admin/house-owner boundary and adds target ownership; #771's inspection
membership is not sufficient to edit. No canonical predicates are redefined.

All six groups and eleven detail routes remain fixed. Overview stays first;
owners can reorder the five others and choose each group's opening detail.
Data-status/error actions stay outside layout configuration. Extra JSON keys,
unknown versions, omitted/duplicate groups and cross-group detail IDs are rejected
by PostgreSQL independently of the browser validator.

## API and storage

- `POST /rest/v1/rpc/owner_analytics_layout_read_v1` with `{p_org_id}`.
- `POST /rest/v1/rpc/owner_analytics_layout_save_v1` with
  `{p_org_id,p_expected_revision,p_layout}`.
- Both return `{schema:'analytics-layout/v1',org_id,revision,layout}`. Revision is
  an opaque decimal string. An absent saved layout reads the validated default
  with revision `0`, without inserting a row.
- `owner_analytics_layouts` stores the authoritative current layout;
  `owner_analytics_layout_history` records each successful revision, actor and
  value atomically. They are one presentation namespace, not a product catalog.
- The enabled target org row serializes first and subsequent saves. The revision
  match and current/history writes occur in one transaction. Monotonic sequence
  revisions prevent ABA. Identical saves still advance revision; do not retry a
  write automatically. Reads and saves fence organization/membership changes
  with locks and re-check canonical authority after waiting.
- Stale revision raises `PT409` (HTTP 409). `42501` denies unauthorized access.
  Invalid layout is HTTP 400. Extra RPC parameters cannot impersonate an actor.
- Forced RLS and no direct table/sequence privileges for anon, authenticated or
  service_role. Only authenticated receives the public RPC EXECUTE grants;
  private helpers have no caller grants. Definer functions fix search_path and
  fully qualify authority and storage objects. Transactional creation/revocation
  avoids an interim public-EXECUTE window.

Following [Supabase function security guidance](https://supabase.com/docs/guides/database/functions),
privileged storage is reachable only through these narrow, owner-checked functions.
[PostgREST custom SQLSTATE handling](https://docs.postgrest.org/en/stable/references/errors.html)
is why conflict uses PT409 rather than mapping a generic serialization error to
an unexpected HTTP 500.

## Additive Control/Worker integration handoff

Shared `control.html`, `control-room-v2.js`, Worker routing and Analytics renderer
files are unchanged. Keep #780's publisher and #771's inspector hooks intact.

1. Promote and verify the pending SQL through the release-owned process first.
   Load `analytics-layout.js`, `analytics-layout-adapter.js` and the #784 stylesheet
   before the shell. #784's category hook remains independently applicable.
2. Append `CR.analyticsLayout.render()` to Analytics Setup, retaining its existing
   property forms. At the bind point use the authoritative selected membership's
   `org_id`, not a route parameter, inferred slug, email or default tenant:
   ```js
   const adapter = CR.analyticsLayoutAdapter.create({
     orgId: selectedMembership.org_id,
     supa: window.MCC_SUPA
   });
   const handle = CR.analyticsLayout.bind(container, {
     adapter,
     identity: adapter.identity,
     onSaved: layout => { CR.analyticsDeck.configure(layout); redrawAnalytics(); },
     onInvalidate: () => { CR.analyticsDeck.configure(null); redrawAnalytics(); }
   });
   ```
   `selectedMembership`, `container` and `redrawAnalytics` denote the existing
   shell/Analytics lifecycle values; this is the additive contract, not guessed
   global names. Redraw the deck without replacing a mounted settings form mid-
   request. Dispose the old handle before replacing its host; on org/account
   switch clear the configured deck and create a NEW scoped adapter. Load saved
   configuration once per authorized workspace mount, including direct Analytics
   entry; default route/deep links continue to choose their explicit detail.
3. Call `handle.invalidate()` on the shell's verified owner-role revocation,
   in addition to the existing auth/session event listeners. Adapter binds the
   authenticated subject, verifies response organization, refuses redirects and
   validates returned data. Decoded subject is a UI stale-result fence, never
   authority; PostgREST verifies the JWT and SQL checks canonical permissions.
4. **Worker hook: none required.** Do not add a second house-owner query/proxy or
   call these RPCs using a service-role actor. They are direct authenticated
   canonical PostgREST APIs like the existing editor pattern. Existing Analytics
   data endpoints and their permissions remain untouched.
5. Failed/uncertain saves disable further edits until explicit reload. Reload
   retrieves the committed revision/value. A conflict preserves the draft for
   inspection but never silently overwrites the remote version. A denied account
   clears the editor. Scope mismatches and unavailable schema fail closed.

## Promotion, rollback and evidence

`supabase/pending/owner_analytics_layout_v1.sql` is unapplied source, not a live
migration. Dependencies: canonical auth.uid/users, orgs/org_members and the three
existing owner predicates. No #780 draft/history table is a dependency. Add only
the two new entries when reconciling `pending/live-callers.json` with concurrent
branches. Review actual helper bodies, enabled-state columns, default grants and
schema/RLS against release evidence before promotion; then follow pending SQL
promotion/replay and production-snapshot requirements. No production flag or
setting changes are included.

Rollback first removes/disables UI calls, then applies the companion rollback to
revoke RPC execution. It retains current layouts, revisions and history. Reapply
restores the API without resetting state; clients must reload. No destructive
rollback or automatic migration is supplied.

`scripts/test-owner-analytics-layout-native.mjs` runs pinned native PostgreSQL 16
and PostgREST 13.0.7 containers on a disposable network; only PostgREST exposes an
ephemeral loopback port, no database port or host data mount. Canonical owner
predicate bodies are extracted from repository migrations; identity-directory
primitives and users are explicitly synthetic. Signed local JWTs exercise actual
PostgREST role switching. Tests cover grants, malformed inputs, cross-scope and
revoked roles, disabled scopes, atomic audit, concurrent writers, uncertain-commit
readback, browser full-page reload and error recovery at 390/1280, rollback and
reapply. This proves native database/transport/UI integration, not managed
production authentication, deployment or live owner acceptance.

## Concrete original editor work still outstanding

Navigation grouping alone does not finish these original simplification goals:

| Existing editor | Concrete remaining presentation work | Preserve |
| --- | --- | --- |
| Sell → Payments/Renewals (`renderWorkView`, `CR.work.section`) | Compact due/failed/recorded summaries with drilldown into the existing ledger editor | Owner-recorded versus provider-verified distinction, linked records, amounts/currencies, audit and action permissions |
| Create → Publish → Channels (`renderChannels`) | Separate account status, registration and campaign creation into progressive panels rather than stacking all forms with compose | Pending form state, selected account, connected/disconnected truth, explicit publish actions and every existing field |
| System → Resources (`renderResources`) | Compact balance/catalog/consumer summaries with expandable evidence and local categories | Separate request failures from missing values; original data, explicit Read platform state and all resource controls |

These shared-shell editor changes remain with coordinated follow-through; this
persistence patch does not edit them or claim their visual redesign is complete.

### Exact source anchors for release integration

- `js/control-room-v2.js`: existing `window.CR.analytics.init({ request: request,
  supa: supa })` near the module initialization is where to supply
  `workspace: function () { return state.org; }`. `state.org.id` comes from
  `discoverWorkspace()`'s selected server membership; no new workspace lookup.
- `js/control-room/analytics.js`: retain that callback in `init`. In `mount`,
  after `host.innerHTML=shell()`, create a stable settings container as a sibling
  of `[data-cra-panel]`, not inside it. Bind the editor once per host/org and load
  the saved layout even on direct entry to a non-Setup detail.
- `paint()` replaces only `[data-cra-panel]`: keep the settings sibling outside
  that replacement, show it only for `S.section==='setup'`, and use `paint` as
  the deck-only redraw callback after configuration changes. A collapsed native
  details section labelled “Arrange Analytics” can contain the persistent editor.
  Do not remount it on every data refresh; that would discard unsaved edits.
- `clearPrivate()` must dispose/invalidate the layout handle and call
  `CR.analyticsDeck.configure(null)` before clearing `S.host`. On a replaced host
  dispose the old handle before binding another. Workspace changes already
  reload Control via `switchWorkspace`; preserve that behavior.

These source hooks are intentionally handed to the release owner rather than
applied to the actively shared files. Native tests cover the adapter/editor/API;
final composed shell lifecycle acceptance is still required after those hooks land.
