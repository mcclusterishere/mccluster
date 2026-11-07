# Owner widget definition publisher, unconfigured release

Control → System → Apps adds a form for registered applications. The owner can
add/remove widget identifiers, leave kind/capability undecided or record a proposal,
save a private draft, reload it, validate a private preview, explicitly publish,
and restore a publication to a private draft before another preview/publication.
There is no JSON editing, AI or shell requirement in the owner workflow.

This is the registry adapter of the owner-front publication pattern (#741):
canonical published storage, private per-owner drafts, database revision tokens,
compare-and-swap, atomic history and restore-to-draft. It does not modify #741 or
create another content server. Published definitions remain in
`platform_apps.settings.widget_access_v1`, consumed by #771. Draft/history tables
store work in progress and evidence, not a second authoritative product catalog.

## Deliberately inactive boundary

Every widget MUST have `configured:false`. Kind and capability are optional proposals,
not new grants; no capability matrix changes occur. Plans, price IDs, extra fields,
activation, invalid types and more than 16 widgets are rejected in PostgreSQL.
System cannot be marked included or subscription. Existing active or unknown legacy
policies cannot be replaced through this publisher, including via restore. App enabled,
ownership, URLs, unrelated settings and billing records are untouched.

The browser's preview interlock is usability, not an authorization grant. Publication
uses only the current saved server draft and its publication base; request-supplied
content cannot replace it. Private preview returns unconfigured/grants_access:false.
A history restore is validated again and becomes a draft, never an immediate publish.

## Authorization and concurrency

RPCs require a real auth.uid(), canonical mnet_is_admin(), AND owner membership in the
enabled McCluster house org. No client role or user metadata is accepted. Definitions
are house-global registry configuration, not tenant configuration; lower roles receive
no delegation. Internal helpers have EXECUTE revoked; exposed RPCs are authenticated
and owner checked. Draft/history tables have forced RLS and no browser table grants.
Functions fix search_path and qualify schema objects, following the existing owner
publisher pattern and [Supabase function guidance](https://supabase.com/docs/guides/database/functions).

Every edit locks its canonical app row. The history trigger captures namespace changes
from legacy writers too; monotonically increasing revisions reject stale or ABA edits.
Unrelated registry metadata updates are preserved. Snapshot takes a row share lock for
consistent value/history. Native PostgreSQL tests exercise two sessions contending on
the row; the stale editor is rejected after the legacy writer commits.

## Release coordination

Base implementation is independent of #741 SQL and #771 Worker rollout. Both small
Apps render/bind hooks must be preserved when integrating concurrent Control changes.
Do not promote SQL automatically. Proposed file:
`supabase/pending/owner_widget_definitions_v1.sql`; dependencies are the existing
platform_apps, orgs, org_members, auth.users/auth.uid and mnet_is_admin objects.
Promotion needs schema/RLS review against the actual canonical database, checked
privileges/default grants and existing registry triggers, release coordinator approval,
and the repo's pending-SQL promotion process. No production SQL/settings were changed.

Promote and verify RPC owner/denied-role behavior before static deployment. Without
SQL, the UI reports the failed load and offers reload; it cannot fall back to a raw
registry write. Track both RPCs in pending/live-callers.json until production evidence
and the replay manifest establish deployment. No secret provisioning is needed.

Rollback first removes the UI or disables RPC execution, then uses the provided
non-destructive rollback SQL: revokes RPC access and removes the audit trigger while
preserving registry values, drafts and history. Re-enabling needs a fresh review and
editor reload; never reuse a stale pre-rollback editing session.

## Evidence and remaining decisions

- `scripts/test-owner-widget-definitions-native.sh`: disposable PostgreSQL 16 container,
  no exposed ports/host volumes/production connection; lifecycle, role/RLS boundaries,
  real concurrent writer conflict, non-destructive rollback.
- `scripts/test/owner-widget-definitions-db.mjs`: isolated PGlite suite including malformed
  metadata, activation/plan rejection, cross-app history rejection, stale drafts, legacy
  ABA writes, enabled-house and membership checks, active-policy preservation.
- `scripts/e2e/control-widget-definitions.e2e.mjs`: real Control HTML/scripts, isolated SQL
  RPCs with synthetic identity transport, 390px/1280px owner journey. This proves UI/SQL
  integration, not production authentication or deployment.

Still needs owner decisions: which widgets/capabilities belong to which products;
which features are included; approved plan mappings; bundle versus independent module
subscriptions (canonical ledger currently allows one subscription per organization).
Activation requires a separately reviewed extension after those decisions and must
intersect entitlement with resource and licensing authority. This release cannot make
those decisions or activate a subscription, even for the owner.
