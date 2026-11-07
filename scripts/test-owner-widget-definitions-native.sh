#!/usr/bin/env bash
# Creates only an isolated disposable container, no ports, mounts or production connection.
set -euo pipefail
cd "$(dirname "$0")/.."
container="mccluster-widget-test-$$"
tmp="$(mktemp -d)"
cleanup(){ docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run --detach --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16@sha256:f9a7b9ebf6f56201f949db745e47bc423c0f0f8294bafe991cc10bf74b029657 >/dev/null
for i in {1..60}; do
 if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
 sleep 0.25
done
psql(){ docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql < supabase/tests/owner_widget_definitions.stub.sql > "$tmp/setup.log"
psql < supabase/pending/owner_widget_definitions_v1.sql >> "$tmp/setup.log"
psql < supabase/tests/owner_widget_definitions.behaviour.sql
# Two native sessions: ordinary registry writer holds row lock, editor blocks and
# then rejects the stale revision when the legacy writer commits its change.
psql -Atc "select public.owner_widget_snapshot_v1('fixture')" >/dev/null 2>&1 && { echo 'Unexpected anonymous owner authority'; exit 1; }
revision="$(psql -Atc "select coalesce(max(id)::text,'0') from owner_widget_history where app_id=(select id from platform_apps where app_key='fixture')")"
draft="$(psql -Atc "select revision from owner_widget_drafts where app_id=(select id from platform_apps where app_key='fixture')")"
psql > "$tmp/writer.log" <<'SQL' &
begin;
set application_name='widget-lock-test';
update platform_apps set settings=jsonb_set(settings,'{widget_access_v1}','{"version":1,"widgets":{}}') where app_key='fixture';
-- Current publication is empty: introduce a distinct change before commit.
update platform_apps set settings=jsonb_set(settings,'{widget_access_v1}','{"version":1,"widgets":{"legacy":{"configured":false}}}') where app_key='fixture';
select pg_sleep(3);
commit;
SQL
writer=$!
for i in {1..40}; do
 if [[ "$(psql -Atc "select count(*) from pg_stat_activity where application_name='widget-lock-test' and wait_event='PgSleep'")" == 1 ]]; then break; fi
 sleep 0.05
done
if psql > "$tmp/conflict.log" 2>&1 <<SQL
\set VERBOSITY verbose
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.owner_widget_edit_v1('fixture','publish','$revision','$draft');
SQL
then echo 'FAIL stale concurrent publication accepted'; exit 1; fi
wait "$writer"
grep -q '40001' "$tmp/conflict.log"
echo 'PASS native concurrent legacy writer conflicts with stale publication'
psql < supabase/pending/owner_widget_definitions_v1.rollback.sql >/dev/null
psql -Atc "select count(*)>0 from owner_widget_history" | grep -qx t
if psql > "$tmp/rollback.log" 2>&1 <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.owner_widget_snapshot_v1(null);
SQL
then echo 'FAIL rollback left RPC executable'; exit 1; fi
grep -q 'permission denied' "$tmp/rollback.log"
echo 'PASS native rollback disables RPC and retains history'
