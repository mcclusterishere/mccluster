# Supabase hardening review, 2026-11-28

Project `zmnhbrjyhxzhkxmhkexs`, read-only. Sources: the Supabase security and performance advisors
(run 2026-11-28 08:43 UTC), `pg_policies`, `pg_proc`, `storage.buckets`, `pg_stat_user_tables`, and the
repo's callers (`js/`, `workers/`, `supabase/functions/`). Nothing was applied to production.

## What the advisors report

| Lint | Level | Count | Verdict |
|---|---|---|---|
| `rls_disabled_in_public` | ERROR | 0 | All 505 `public` tables have RLS on. |
| `security_definer_view`, `function_search_path_mutable`, `auth_rls_initplan` | | 0 | Fixed by the 2026-10-29 group 0 files. |
| `anon_security_definer_function_executable` | WARN | 29 | Reviewed, intended. See S3. |
| `authenticated_security_definer_function_executable` | WARN | 133 | Reviewed, intended. See S3. |
| `extension_in_public` | WARN | 2 | `vector`, `pg_trgm`. Deferred. See S4. |
| `auth_leaked_password_protection` | WARN | 1 | Dashboard setting. See S2. |
| `rls_enabled_no_policy` | INFO | 227 | Intended: service-role-only tables (215 `public`, all 12 `ai_context`). |
| `unindexed_foreign_keys` | INFO | 481 | Seven matter. See P1. |
| `multiple_permissive_policies` | WARN | 214 | Deferred. See P2. |
| `unused_index` | INFO | 337 | Not acted on. See P3. |
| `no_primary_key` | INFO | 26 | 25 in `archive_missions_20261030` (frozen archive, no API grants) and `public._analytics_baseline_tmp`. See P4. |
| `auth_db_connections_absolute` | INFO | 1 | Dashboard setting. See P5. |

## Security

**S1. Four public buckets can be listed by anyone. Fixed in a pending file.**
`creator-artwork`, `creator-previews`, `cuts` and `mnet-avatars` each have a SELECT policy on
`storage.objects` whose only test is the bucket id (`to anon, authenticated`, or `to public` for avatars).
`POST /storage/v1/object/list/<bucket>` answers from that policy, so the public anon key enumerates every
path: the listener previews and artwork of releases still in review, and each member's avatar folder by
user id. The advisor does not yet flag this; it was found by reading the policies.
Public buckets serve `/object/public/...` without RLS, and every reader in the repo uses those URLs, so the
fix keeps reading as it is and leaves owners a SELECT over their own objects (needed by `remove()` and
upsert). File: `supabase/pending/20261128090000_storage_public_bucket_listing_v1.sql`, test
`scripts/test-storage-listing-db.sh`, order `supabase/pending/PROMOTION-ORDER.md` section 21.

**S2. Leaked password protection is off.** Dashboard → Authentication → Providers → Email →
"Prevent use of leaked passwords" (Have I Been Pwned check). Not a migration; owner's switch.

**S3. SECURITY DEFINER functions open to the API roles: reviewed, no change.** Of the 29 anon-callable ones,
26 are the World's and the stores' public reads (projections, counts and receipts that hand anon a safe
column set instead of the table), and `eu_is_admin()`, `eu_is_staff()` and `shake_is_crew()` are kept on purpose, as
`20261029010919_privilege_hygiene_v1.sql` explains: anon-facing RLS policies call them. Every one of the 133
authenticated-callable functions that writes checks the caller (`auth.uid()`, `current_m_uid()`, an admin
helper or `private.clip_require_owner`), and the read helpers with no visible check are scoped through
`current_m_uid()` or `l3_is_staff()`. Revoking any would break a shipped caller.

**S4. `vector` and `pg_trgm` live in `public`.** Moving them (`alter extension ... set schema extensions`)
changes the schema of the `vector` type and the trigram operators, and functions pinned to
`search_path = ''` or `public` that use them would stop resolving. Deferred until a migration can rewrite
those callers in the same change.

**S5. `net` schema grants.** `anon` and `authenticated` hold SELECT and INSERT on `net.http_request_queue`
and `net._http_response` (pg_net's defaults on this project). `net` is not an API schema, so neither role can
reach them through PostgREST today. Noted, not changed: pg_net's grants are managed by Supabase.

## Performance

**P1. Foreign keys without a covering index on large tables. Ready as an ops file.** Seven of the 481 are on
tables over 25,000 rows (`media_news_articles` ~800k, `ops_ontology_lineage` ~186k, `ops_agent_jobs` ~52k,
`control_observability_events` ~28k). Without them a parent delete or key change scans the child table.
`supabase/ops/fk_cover_v1_idx.sql`, one `CREATE INDEX CONCURRENTLY` per call. The other 474 are on tables of
a few hundred rows or fewer and are left alone.

**P2. 214 multiple permissive policies.** Mostly a public-read policy plus an owner-write `for all` policy on
the same table, so authenticated SELECTs evaluate both. Merging them changes access expressions table by
table and needs the access-matrix tests per table; deferred to a dedicated pass.

**P3. 337 unused indexes.** Not dropped. Statistics were last reset at an unknown time, several are new
(the 2026-11 releases), and some serve rare admin and reconciliation paths. Revisit after 30 days of
statistics with `pg_stat_user_indexes`.

**P4. No primary key.** `archive_missions_20261030` is the frozen pre-2026-10-30 missions archive (120 rows,
no API grants). `public._analytics_baseline_tmp` looks like a leftover working table; dropping it is the
owner's call.

**P5. Auth connection pool fixed at 10.** Dashboard → Project Settings → Database → connection pooling for
Auth: switch to a percentage so it grows with the instance. Owner's switch.
