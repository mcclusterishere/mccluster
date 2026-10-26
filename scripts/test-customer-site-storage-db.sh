#!/usr/bin/env bash
# Native PostgreSQL, disposable CI database only. Never use a production endpoint.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="customer_storage_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_api_roles.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_storage.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/pending/member_fronts_v1.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create table m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);
grant select on m_auth_user_links to service_role;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111');
insert into m_auth_user_links values('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',true);
SQL
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/pending/customer_site_storage_v1.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" > /tmp/customer-storage-first-$$.log 2>&1 <<'SQL' &
begin;
set role service_role;
select customer_site_storage_reserve_v1('11111111-1111-4111-8111-111111111111','front-media','11111111-1111-4111-8111-111111111111/first',300000000);
select pg_sleep(2);
commit;
SQL
first_pid=$!
# Both sessions overlap. Either may win; exactly one 300 MB reservation must fit.
set +e
psql -q -v ON_ERROR_STOP=1 -d "$DB" > /tmp/customer-storage-second-$$.log 2>&1 <<'SQL'
set role service_role;
select customer_site_storage_reserve_v1('11111111-1111-4111-8111-111111111111','front-media','11111111-1111-4111-8111-111111111111/second',300000000);
SQL
second_status=$?
wait "$first_pid"
first_status=$?
set -e
if [[ "$first_status" -eq 0 && "$second_status" -eq 0 ]] || [[ "$first_status" -ne 0 && "$second_status" -ne 0 ]]; then
  cat /tmp/customer-storage-first-$$.log /tmp/customer-storage-second-$$.log
  exit 1
fi
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
do $$begin
 if (select count(*) from customer_site_storage_reservations where state='pending')<>1 then raise exception 'concurrent quota exceeded';end if;
end$$;
SQL
echo 'PASS: two native PostgreSQL sessions cannot reserve 600 MB against the shared 500 MB allowance'
