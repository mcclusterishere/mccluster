# Optional widget-definition schema integration

Local review branch `codex/four-schema-review-20261107` starts from #776 head `14d50042`. It normally merges original #771 `cebbbe2c` and original #780 `c4757dc9`, retaining their ancestry. It deliberately does not import the broader `b30d468a` release candidate carried by #780's later integration merge. The active #776 branch is untouched.

Control integration retains owner-front render/bind/init, portfolio routing, product-readiness render/bind, and widget-definition render/bind. Both CSS/script includes remain. Worker imports and dispatch retain both portfolio and product-readiness routes; pending caller inventory retains all owner-front, portfolio and widget entries.

## Exact fourth migration

Supabase CLI2.117.0 generated `supabase/migrations/20261107135756_owner_widget_definitions_v1.sql`. It is byte-identical to the independently reviewed #780 pending SQL:

`6980e063138f5b1f4ba5fdcc0362cb98fbdd13455fa71b4f43e3bd493451ef45`

The first three migrations and their hashes are unchanged. This fourth payload creates private draft/history tables, revision sequence, five functions and one platform_apps history trigger. It uses canonical auth.uid/mnet_is_admin plus enabled mccluster owner membership; no role/identity helper is replaced. Tables FORCE RLS and deny direct browser access. Only the two owner entry RPCs grant authenticated execution and each enforces owner checks; helper functions remain unavailable to browser roles.

No plan mapping or commercial entitlement decision is made. Every published widget definition is constrained to configured:false; definition publication does not activate access. Schema installation inserts no definitions or public content. Do not publish definitions, alter mappings, add credentials, enable feature flags or activate anything as part of this preparation.

## Dependencies and rollout conditions

Refresh metadata-only preflight for auth.users, platform_apps (including id, app_key, settings and updated_at), orgs.enabled, org_members and existing canonical owner identity helpers. Check absence or exact compatibility of the proposed tables, sequence, functions and trigger. Inspect dependencies before replacing an existing trigger of the same name. This integration performs no production queries or writes.

Use the same coordinated post-OVH schema window described in OWNER-SCHEMA-PROMOTION-20261107.md. Root must review/select this optional branch before replacing active #776. Never combine it by silently changing the active proposal. Publication or owner-device acceptance remains separate.

If the original359 baseline and all four proposed version/name receipts match exactly, expected post-apply ledger count363/latest20261107135756 owner_widget_definitions_v1 has SHA256 `b54ddc8837a1262587e3baec2b17a3aa494273632e4b7fa136d6f4a296dca8f8`. This is a conditional expectation, not a receipt. The apply tool may assign actual versions; reconcile actual filenames, native harness version references, production-ledger and Core contract from real receipts. This branch leaves both ledger/Core at359. Coordinate any change with the sole OVH release owner; never claim the existing359 node matches an applied363 schema.

## Verification and manifest

The existing pinned native widget-definition workflow is retained and now also triggers on the canonical migration path. It asserts pending/canonical byte equality and truthfully labels its auth/tenancy fixtures. Original #780 independent native PostgreSQL proof covers lifecycle/history/RLS, a concurrent legacy writer causing stale-publication rejection, and rollback retaining history. It is not canonical managed-auth acceptance. Canonical reset of this combined branch must verify the fourth payload against real prerequisites; existing owner/portfolio native proof steps remain intact.

The committed manifest still covers the first three schemas. Once root chooses this draft, its first canonical reset must capture the exact new snapshot through the existing artifact/log transport. Expected incremental metadata additions are two relations, five functions and one trigger, with no unrelated changes; inspect the actual diff, not just counts. Regenerate with the canonical verifier, then rerun the unchanged strict manifest gate and all native suites. No hand-built manifest or skipped gate is acceptable.

Prefer reverting application code while retaining private drafts/history if rollout recovery is needed. The existing pending rollback revokes execution and disables the new history trigger without deleting drafts/history; review exact callers and authorize any production rollback separately. Do not erase migration history.

Local combined-branch checks: 1,997 root tests passed with three existing skips, plus seven Python tests; 54 focused readiness/widget-access/portfolio Worker tests passed; 10 SQL-backed widget behavior checks passed. Real Control browser fixtures passed20 widget-definition checks and18 product-readiness checks across390/1280, including reload/conflict/account-change clearing and no overflow/script errors. Workflow YAML, JavaScript syntax, pending/promoted byte equality, drift-contract checker and diff whitespace checks passed. No production SQL/settings, remote push, plan mapping or activation occurred.

## Four-schema manifest receipt

Canonical job128424880757/run42379822301 at exact `fa5cfd7ac3401bfd7befc5d52c12c546f75f8da6` passed startup and the complete migration rebuild. The strict comparison correctly rejected only the newly added metadata. Artifact13577132618 belongs to that exact head; ZIP SHA256 `27a5b6214cb031d839ffbbaf7ae857a70204120ed2971d3646ccbc55f4d6a8f7`. The reviewed job-log transport recovered the 281,554-byte reset snapshot, verified uncompressed SHA256 `44583266895c8a7f6004fd6a2436e80bbe4f362a687d06628d8c5ea15973aff6`, and the canonical verifier generated the committed manifest with zero drift.

Independent row comparison confirms exactly owner_widget_drafts and owner_widget_history added, five owner_widget functions added, and owner_widget_history_v1 trigger added on platform_apps. No existing relation/function/trigger changed or disappeared; schemas, policies, buckets and query hashes are unchanged. Both new tables FORCE RLS and deny browser table grants. Only snapshot/edit RPCs grant authenticated execution; their helpers remain ungranted, all search paths fixed. The metadata change preserves all three previous schema entries. Require a fresh exact-head canonical/native run after publication of this generated manifest; skipped downstream tests in the mismatch run are not successful tests.

Widget fixture-auth job128424880494 exposed a Docker entrypoint readiness race before SQL: pg_isready accepted the temporary socket-only initialization server, then psql reached a disappearing socket. The harness now probes the final container-local TCP server, uses the same connection path for psql, and explicitly fails on readiness timeout. No ports are published and the container still uses network:none. All native lifecycle/history/RLS/concurrent legacy-writer/rollback assertions passed locally with the pinned image after this repair. SQL payload/hash and assertion strength are unchanged.
