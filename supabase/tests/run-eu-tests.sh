#!/usr/bin/env bash
# ============================================================
# Stand up a throwaway Postgres, apply the Equity Uprise migrations,
# and try to break into them. Nothing here touches the live project:
# the cluster is created in a temp directory and destroyed on exit.
#
#   bash supabase/tests/run-eu-tests.sh
#
# Needs postgresql-16 client and server binaries on the machine. On
# Debian/Ubuntu: apt-get install postgresql-16. Exits non-zero on the
# first broken promise, so CI can run it as-is.
# ============================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d /tmp/eu-test-XXXXXX)"
PORT="${PGPORT:-54329}"

# initdb refuses to run as root, so when we are root the cluster is
# owned by the postgres system user and every command hops through su.
if [ "$(id -u)" = "0" ] && id -u postgres >/dev/null 2>&1; then
  RUNAS="su postgres -c"
  chown -R postgres "$WORK"
else
  RUNAS="bash -c"
fi

cleanup() {
  $RUNAS "PATH=$PGBIN:\$PATH pg_ctl -D $WORK/pg stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "→ cluster in $WORK"
$RUNAS "PATH=$PGBIN:\$PATH initdb -D $WORK/pg -U pg --auth=trust" > "$WORK/initdb.log" 2>&1
$RUNAS "PATH=$PGBIN:\$PATH pg_ctl -D $WORK/pg -o '-k $WORK -p $PORT -c listen_addresses=' -l $WORK/pg.log start" >/dev/null

# psql runs as the cluster's owner, so the SQL has to be readable by it
cp "$REPO/supabase/migrations/0017_equity_uprise_platform.sql" "$WORK/0017.sql"
cp "$REPO/supabase/migrations/0018_equity_uprise_seed.sql"     "$WORK/0018.sql"
cp "$REPO/supabase/migrations/0019_shake_delivery.sql"        "$WORK/0019.sql"
cp "$REPO/supabase/migrations/0020_harden_function_surface.sql" "$WORK/0020.sql"
cp "$REPO/supabase/tests/eu_platform_test.sql"                 "$WORK/test.sql"

# The shim has to exist before 0017, because 0017's policies reference
# auth.uid() and the anon/authenticated roles. The test file carries the
# shim; we run its first section by running the whole thing after the
# migrations, so the shim pieces are created here up front instead.
cat > "$WORK/shim.sql" <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public, auth to anon, authenticated, service_role;
SQL
chmod -R a+rX "$WORK"

# Migrations run quiet: "already exists, skipping" is what idempotent
# LOOKS like, and forty lines of it buries the one line that matters.
# The test itself runs loud — its output IS the result.
PSQL="PATH=$PGBIN:\$PATH psql -h $WORK -p $PORT -U pg -d postgres -v ON_ERROR_STOP=1 -q"
QUIET="$PSQL -c 'set client_min_messages = warning' -f"

echo "→ shim"
$RUNAS "$QUIET $WORK/shim.sql" >/dev/null
echo "→ 0017 schema"
$RUNAS "$QUIET $WORK/0017.sql" >/dev/null
echo "→ 0017 again (must be idempotent)"
$RUNAS "$QUIET $WORK/0017.sql" >/dev/null
echo "→ 0018 seed"
$RUNAS "$QUIET $WORK/0018.sql" >/dev/null
echo "→ 0018 again (must be idempotent)"
$RUNAS "$QUIET $WORK/0018.sql" >/dev/null
echo "→ 0019 the shake run"
$RUNAS "$QUIET $WORK/0019.sql" >/dev/null
echo "→ 0019 again (must be idempotent)"
$RUNAS "$QUIET $WORK/0019.sql" >/dev/null
echo "→ 0020 hardening (the promises must survive it)"
$RUNAS "$QUIET $WORK/0020.sql" >/dev/null
echo "→ the promises"
$RUNAS "$PSQL -f $WORK/test.sql" 2>&1 | sed 's/^NOTICE:  //'

echo
echo "PASS"
