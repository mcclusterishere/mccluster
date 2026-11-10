#!/usr/bin/env bash
# The bytes half of supabase/pending/network_media_assets_pointer_guard_v1.sql,
# shown on the REAL Supabase Storage API: does the mnet-media upload flow still
# work once "mnet media owner upload", "mnet media owner update" and "mnet media
# owner delete" are gone, and does the member's own token stop changing a file?
#
# It starts the Storage API (a pinned public image) on a scratch database, lets
# it create its own storage schema, builds the table and the bucket from the
# applied migration's own DDL (the fixture of
# scripts/test-network-media-pointer-guard-db.sh), and then:
#   1. production's shape: the fixture hashes to production's evidence; the
#      member's row writes work; the upload flow works; and with their own token
#      the member overwrites, deletes-and-replays and moves the object (the finding)
#   2. the guard, then its rollback, then the guard twice: the rollback leaves
#      nothing behind in public or storage, the second apply equals the first
#   3. under the guard: the member's row writes are refused; the upload flow
#      still works end to end; every member-token write to the object is
#      refused; the whole behaviour test passes
#   4. the rollback after use: production's shape and behaviour again
#   5. the guard again: step 3's flow again
#
# Two ways to run it. Both need Docker; neither is part of `npm test`; nothing
# here reaches Supabase: the database, the keys and the containers are made for
# this run and removed at the end.
#
#   a. on any throwaway PostgreSQL the container can reach over TCP:
#        PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres scripts/test-network-media-storage-flow.sh
#   b. on the official Supabase Postgres image, which it starts itself:
#        SUPABASE_DB_IMAGE=supabase/postgres:17.11.0.018 scripts/test-network-media-storage-flow.sh
#      There every statement, the guard and its rollback included, runs as that
#      image's `postgres` role: not a superuser, not the owner of storage.objects
#      (supabase_storage_admin is, and the Storage API connects as it), holding
#      MAINTAIN like production, and under Supabase's default privileges. The
#      fixture's grants are then production's to the letter (authenticated=damrw).
#
# STORAGE_API_IMAGE (default supabase/storage-api:v1.90.2), STORAGE_API_PORT
# (default 5055) and SUPABASE_DB_PORT (default 54329) can be overridden.
set -euo pipefail
cd "$(dirname "$0")/.."
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
. scripts/test/support/network-media-fixture.sh

IMAGE="${STORAGE_API_IMAGE:-supabase/storage-api:v1.90.2}"
PORT="${STORAGE_API_PORT:-5055}"
BOX="nma-storage-flow-$$"; PGBOX="nma-supabase-db-$$"
rand() { node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }
SECRET="$(rand 32)"; ROLEPASS="$(rand 18)"
key() { node -e "
  const c = require('crypto'), b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ role: process.argv[1], iss: 'scratch', iat: 1, exp: 4102444800 });
  console.log(body + '.' + c.createHmac('sha256', process.argv[2]).update(body).digest('base64url'));" "$1" "$SECRET"; }
docker info >/dev/null 2>&1 || { echo "Docker is required for this test" >&2; exit 2; }

if [ -n "${SUPABASE_DB_IMAGE:-}" ]; then
  # b. the official Supabase Postgres image, as its restricted postgres role
  export PGHOST=127.0.0.1 PGPORT="${SUPABASE_DB_PORT:-54329}" PGUSER=postgres PGPASSWORD="$(rand 18)"
  DB=postgres; ROLE=supabase_storage_admin
  cleanup() { docker rm -f "$BOX" "$PGBOX" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  docker run -d --name "$PGBOX" -p "127.0.0.1:$PGPORT:5432" -e POSTGRES_PASSWORD="$PGPASSWORD" \
    -e JWT_SECRET="$SECRET" -e JWT_EXP=3600 "$SUPABASE_DB_IMAGE" >/dev/null
  ready=0
  for _ in $(seq 1 90); do
    if psql -qAt -d postgres -c 'select 1' >/dev/null 2>&1; then ready=$((ready + 1)); else ready=0; fi
    [ "$ready" -ge 3 ] && break
    sleep 1
  done
  [ "$ready" -ge 3 ] || { echo "the Supabase Postgres image did not start:" >&2; docker logs "$PGBOX" 2>&1 | tail -20 >&2; exit 1; }
  [ "$(nm_q postgres "select rolsuper or pg_has_role('postgres', 'supabase_storage_admin', 'USAGE') from pg_roles where rolname = 'postgres'")" = f ] \
    || nm_fail "expected the image's postgres role to be neither a superuser nor a member of supabase_storage_admin"
  # The platform gives the storage role its password; the bare image has none. This
  # one statement is the only one run as the image's superuser.
  PGUSER=supabase_admin psql -q -v ON_ERROR_STOP=1 -d postgres -c "alter role supabase_storage_admin password '$ROLEPASS'" >/dev/null
  nm_apply "$DB" "$NM_T.stub.sql" -v real_storage=1 -v real_supabase=1
  echo "$SUPABASE_DB_IMAGE (PostgreSQL $(nm_q postgres 'show server_version')), every statement as its restricted postgres role; $IMAGE"
else
  # a. any throwaway PostgreSQL: a scratch database and a login that owns the storage schema
  : "${PGHOST:?PGHOST must be set to a TCP address, for example 127.0.0.1 (or set SUPABASE_DB_IMAGE)}"
  PGPORT="${PGPORT:-5432}"; export PGPORT
  DB="nma_storage_flow_$$"; ROLE="nma_storage_admin_$$"
  cleanup() {
    docker rm -f "$BOX" >/dev/null 2>&1 || true
    psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
    psql -q -d postgres -c "drop role if exists $ROLE" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
  nm_apply "$DB" "$NM_T.stub.sql" -v real_storage=1
  psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<SQL
create role $ROLE login noinherit createrole password '$ROLEPASS';
grant anon, authenticated, service_role to $ROLE;
alter role $ROLE set search_path = storage;
grant create on database $DB to $ROLE;
create schema storage authorization $ROLE;
grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema auth, public to $ROLE;
grant references on auth.users to $ROLE;
SQL
  echo "PostgreSQL $(nm_q postgres 'show server_version'); $IMAGE"
fi

docker run -d --name "$BOX" --network host --tmpfs /var/lib/storage \
  -e SERVER_PORT="$PORT" -e SERVER_HOST=127.0.0.1 \
  -e AUTH_JWT_SECRET="$SECRET" -e AUTH_JWT_ALGORITHM=HS256 -e PGRST_JWT_SECRET="$SECRET" \
  -e ANON_KEY="$(key anon)" -e SERVICE_KEY="$(key service_role)" \
  -e DATABASE_URL="postgresql://$ROLE:$ROLEPASS@$PGHOST:$PGPORT/$DB" \
  -e STORAGE_BACKEND=file -e STORAGE_FILE_BACKEND_PATH=/var/lib/storage -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e STORAGE_S3_BUCKET=scratch -e GLOBAL_S3_BUCKET=scratch -e TENANT_ID=scratch -e REGION=scratch \
  -e UPLOAD_FILE_SIZE_LIMIT=524288000 -e FILE_SIZE_LIMIT=524288000 \
  -e UPLOAD_SIGNED_URL_EXPIRATION_TIME=7200 -e SIGNED_UPLOAD_URL_EXPIRATION_TIME=7200 \
  -e IMAGE_TRANSFORMATION_ENABLED=false -e ENABLE_IMAGE_TRANSFORMATION=false \
  -e DB_INSTALL_ROLES=false -e PG_QUEUE_ENABLE=false -e NODE_ENV=production \
  "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  curl -fsS -m 2 "http://127.0.0.1:$PORT/status" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS -m 2 "http://127.0.0.1:$PORT/status" >/dev/null 2>&1 \
  || { echo "the Storage API did not start:" >&2; docker logs "$BOX" 2>&1 | tail -20 >&2; exit 1; }
[ "$(nm_q "$DB" "select to_regclass('storage.objects') is not null and to_regprocedure('storage.foldername(text)') is not null")" = t ] \
  || nm_fail "the Storage API did not create its schema"
echo "the Storage API is up on its own schema ($(nm_q "$DB" 'select count(*) from storage.migrations') migrations; storage.objects is owned by $(nm_q "$DB" "select pg_get_userbyid(relowner) from pg_class where oid = 'storage.objects'::regclass"))"

# The table, the bucket and the Storage policies: the applied files' own DDL.
nm_applied_ddl "$DB"
if [ -n "${SUPABASE_DB_IMAGE:-}" ]; then
  # Supabase's default privileges hand a new table to authenticated in full.
  # Production's table does not hold these three (evidence: authenticated=damrw).
  nm_q "$DB" "revoke truncate, references, trigger on public.network_media_assets from authenticated" >/dev/null
  export MEDIA_EVIDENCE_EXACT_GRANTS=1
fi
nm_apply "$DB" "$NM_T.refs.stub.sql"
nm_apply "$DB" "$NM_T.seed.sql"
flow() { STORAGE_URL="http://127.0.0.1:$PORT" STORAGE_JWT_SECRET="$SECRET" PGDATABASE="$DB" \
           node scripts/test/network-media-storage-flow.integration.mjs "$1"; }

echo "1. production's shape and behaviour"
nm_evidence "$DB" production
nm_attacks "$DB" false
flow production

echo "2. the guard, its rollback, the guard twice"
nm_mark "$DB" before
nm_apply "$DB" "$NM_PENDING"
nm_mark "$DB" applied
nm_apply "$DB" "$NM_ROLLBACK"
nm_mark "$DB" rolled_back
nm_same "$DB" before rolled_back "the rollback left something behind"
nm_evidence "$DB" production
nm_apply "$DB" "$NM_PENDING"
nm_apply "$DB" "$NM_PENDING"
nm_mark "$DB" reapplied
nm_same "$DB" applied reapplied "the re-applied guard differs from the first apply"
echo "   apply -> rollback leaves nothing behind in public or storage; the guard re-applied (twice) equals the first apply"

echo "3. under the guard"
nm_evidence "$DB" guarded
nm_attacks "$DB" true
flow guarded
nm_behaviour "$DB"

echo "4. the rollback after use"
nm_apply "$DB" "$NM_ROLLBACK"
nm_evidence "$DB" production
flow production

echo "5. the guard again"
nm_apply "$DB" "$NM_PENDING"
nm_evidence "$DB" guarded
flow guarded
echo "network media storage flow: ok"
