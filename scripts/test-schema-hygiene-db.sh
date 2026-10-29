#!/usr/bin/env bash
# The 2026-10-29 pending migrations against throwaway local Postgres (16+) databases, never
# production. Each file is applied on a stub of production's state, its behaviour test runs,
# its rollback runs, it is applied again (idempotent) and the behaviour test runs again:
#   supabase/pending/20261029100000_privilege_hygiene_v1.sql          (+ rollback)
#   supabase/pending/20261029100100_definer_views_invoker_v1.sql       (+ rollback)
#   supabase/pending/20261029100200_rls_initplan_select_wrap_v1.sql    (+ rollback)
#   supabase/pending/20261029100300_eu_runtime_and_media_rollup_v1.sql (+ rollback)
# Usage: PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-schema-hygiene-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
P=supabase/pending
T=supabase/tests
DBS=()
TMP=""
cleanup() {
  for d in "${DBS[@]}"; do psql -q -d postgres -c "drop database if exists $d" >/dev/null; done
  if [ -n "$TMP" ]; then rm -rf "$TMP"; fi
}
trap cleanup EXIT
# Sets $db in this shell (not a subshell), so the EXIT trap sees every database it made.
fresh() { db="schema_hygiene_${1}_$$"; DBS+=("$db"); psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $db" >/dev/null; }
run() { local db="$1"; shift; for f in "$@"; do psql -X -q -1 -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null; done; }
check() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$1" -f "$2" | grep -E ': ok$'; }

# 1. privilege hygiene
fresh hygiene
run "$db" $T/supabase_api_roles.stub.sql $T/schema_test_helpers.sql $T/privilege_hygiene_v1.stub.sql $P/20261029100000_privilege_hygiene_v1.sql
check "$db" $T/privilege_hygiene_v1.behaviour.sql
run "$db" $P/20261029100000_privilege_hygiene_v1.rollback.sql
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -c "select t_eq(has_table_privilege('authenticated','public.campaigns','TRUNCATE') and has_table_privilege('anon','public.network_blocks','INSERT') and has_function_privilege('anon','public.eu_role()','EXECUTE') and (select roles::text from pg_policies where policyname='out_suppressions_add') = '{public}', true, 'rollback restores production')" >/dev/null
run "$db" $P/20261029100000_privilege_hygiene_v1.sql $P/20261029100000_privilege_hygiene_v1.sql
check "$db" $T/privilege_hygiene_v1.behaviour.sql

# 2. definer views -> security_invoker views over SECURITY DEFINER functions (same rows), rollback, re-apply
fresh views
run "$db" $T/supabase_api_roles.stub.sql $T/schema_test_helpers.sql $T/definer_views_invoker_v1.stub.sql
psql -X -q -t -A -v ON_ERROR_STOP=1 -v pending=$P/20261029100100_definer_views_invoker_v1.sql \
  -v rollback=$P/20261029100100_definer_views_invoker_v1.rollback.sql -d "$db" -f $T/definer_views_invoker_v1.behaviour.sql | grep -E ': ok$'
run "$db" $P/20261029100100_definer_views_invoker_v1.sql $P/20261029100100_definer_views_invoker_v1.sql
# public_music_reads_lean_v1.sql, which follows it, swaps the function bodies to events_lean and keeps the views invoker
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "create table public.events_lean as select id, name, lower(props->>'track') as track, device_id, session_id, at, coalesce(is_bot, false) as is_bot from public.events" >/dev/null
run "$db" $P/public_music_reads_lean_v1.sql
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -c "
  select t_eq(count(*), 2::bigint, 'track views still security_invoker after the lean file') from pg_class c
   where c.oid in ('public.v_track_signals'::regclass, 'public.v_track_affinity'::regclass) and c.reloptions @> array['security_invoker=true'];
  select t_as('anon');
  select t_eq(t_count('select 1 from public.v_track_signals') > 0 and t_count('select 1 from public.v_track_affinity') > 0, true, 'anon reads the lean views');
  reset role;
  select 'public_music_reads_lean_v1 on top: ok';" | grep -E ': ok$'

# 3. auth_rls_initplan select-wrap: identical access before, after and after rollback, on the
# stub's representative tables. The file's statements for those tables are applied; the
# offline test scripts/test/rls-initplan-select-wrap.test.mjs proves all 71 statements are
# production's expressions with only the three sub-selects added.
fresh initplan
run "$db" $T/supabase_api_roles.stub.sql $T/schema_test_helpers.sql $T/rls_initplan_select_wrap_v1.stub.sql
TMP=$(mktemp -d)
subset() { node -e '
  const fs = require("fs"); const [file, out] = process.argv.slice(1);
  const keep = new Set(["prim3_course_progress","comments","campaigns","creator_service_offers","eu_fellowships","events","network_activity"]);
  const text = fs.readFileSync(file, "utf8");
  const head = text.slice(0, text.indexOf("\nalter policy ") + 1).split("\n").filter((l) => /^set local /.test(l));
  const stmts = text.slice(text.indexOf("\nalter policy ") + 1).split(/\n(?=alter policy )/);
  const picked = stmts.filter((s) => keep.has(/ on public\.(\w+)/.exec(s)[1]));
  fs.writeFileSync(out, head.join("\n") + "\n" + picked.join("\n") + "\n");
  console.error(`${picked.length} of ${stmts.length} statements from ${file}`);
' "$1" "$2"; }
subset $P/20261029100200_rls_initplan_select_wrap_v1.rollback.sql "$TMP/before.sql"
subset $P/20261029100200_rls_initplan_select_wrap_v1.sql "$TMP/after.sql"
run "$db" "$TMP/before.sql"
psql -X -q -v ON_ERROR_STOP=1 -v phase=before -d "$db" -f $T/rls_initplan_select_wrap_v1.probe.sql >/dev/null
run "$db" "$TMP/after.sql"
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -c "select t_eq(count(*), 0::bigint, 'policies still calling auth.uid()/auth.jwt()/current_m_uid() per row') from pg_policies where schemaname = 'public' and policyname <> 'cm_read' and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(?<!SELECT )(auth\.uid|auth\.jwt|current_m_uid)\(\)'" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -v phase=after -d "$db" -f $T/rls_initplan_select_wrap_v1.probe.sql >/dev/null
run "$db" "$TMP/before.sql"
psql -X -q -v ON_ERROR_STOP=1 -v phase=rollback -d "$db" -f $T/rls_initplan_select_wrap_v1.probe.sql >/dev/null
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -c "
  select t_eq(count(*), 0::bigint, 'access that differs between phases: ' || coalesce(string_agg(who || ' ' || probe, ', '), ''))
    from (select who, probe from public.t_access group by who, probe having count(distinct outcome) > 1 or count(*) <> 3) d;
  select t_eq(count(distinct outcome) > 3, true, 'the probes see different access per caller') from public.t_access where probe like 'read %';
  select 'rls_initplan_select_wrap_v1: ok ('|| count(*)/3 || ' reads and writes compared)' from public.t_access;" | grep -E 'ok'
rm -rf "$TMP"
[ -n "${SHOW_ACCESS:-}" ] && psql -X -q -d "$db" -c "select who, probe, outcome from public.t_access where phase = 'after' order by 1,2"

# 4. EU worker runtime and media rollup: applied twice, behaviour, the created functions equal the
# rows the CI reset records in supabase/schema-manifest.json (same bodies, config, EXECUTE), rollback
fresh eu
run "$db" $T/supabase_api_roles.stub.sql $T/supabase_storage.stub.sql $T/schema_test_helpers.sql $T/eu_runtime_and_media_rollup_v1.stub.sql \
  $P/20261029100300_eu_runtime_and_media_rollup_v1.sql $P/20261029100300_eu_runtime_and_media_rollup_v1.sql
check "$db" $T/eu_runtime_and_media_rollup_v1.behaviour.sql
EU_DB_URL="postgresql://${PGUSER:-postgres}@/${db}?host=${PGHOST:-/var/run/postgresql}&port=${PGPORT:-5432}" node --input-type=module -e '
  import { snapshotDatabase } from "./scripts/db/verify-production-schema.mjs";
  import { readFileSync } from "node:fs";
  process.env.PGOPTIONS = "-c client_min_messages=warning -c search_path=\"$user\",public,extensions";
  const manifest = JSON.parse(readFileSync("supabase/schema-manifest.json", "utf8"));
  const key = (r) => `${r[0]}.${r[1]}(${r[2]})`;
  const want = new Map(manifest.sections.functions.rows.map((r) => [key(r), r]));
  const have = snapshotDatabase(process.env.EU_DB_URL).sections.functions.rows
    .filter((r) => /^(eu_(claim_(ddex|external)_jobs|claim_monitors|cron_|event_dispatch|monitor_interval|out_event_communication_bridge|runtime_|oauth_state_|vault_store)|media_usage_rollup)/.test(r[1]));
  const bad = have.filter((r) => JSON.stringify(r) !== JSON.stringify(want.get(key(r))));
  if (have.length !== 19 || bad.length) { console.error(have.length, "functions;", bad.map((r) => key(r) + " " + JSON.stringify(r) + " vs " + JSON.stringify(want.get(key(r)))).join("\n")); process.exit(1); }
  console.log("eu_runtime_and_media_rollup_v1: ok (19 functions equal the schema manifest)");
'
run "$db" $P/20261029100300_eu_runtime_and_media_rollup_v1.rollback.sql
psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -c "select t_eq(to_regclass('private.eu_runtime') is null and to_regprocedure('public.media_usage_rollup(uuid,timestamptz,timestamptz,text)') is null, true, 'rollback removes the runtime')" >/dev/null
run "$db" $P/20261029100300_eu_runtime_and_media_rollup_v1.sql
check "$db" $T/eu_runtime_and_media_rollup_v1.behaviour.sql
