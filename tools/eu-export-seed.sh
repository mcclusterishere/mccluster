#!/usr/bin/env bash
# ============================================================
# Re-export the static mirrors of the Equity Uprise seed.
#
#   data/eu-topics.json
#   data/eu-fellowships.json
#
# WHY THESE FILES EXIST. matthew.mccluster.org is a static site. The topic
# hubs and the fellowship explorer have to paint something true on the
# very first frame — before any network call, for a signed-out visitor,
# and on the day the site deploys but the migration has not been run
# yet. So the seed ships twice: once as SQL (the source of truth, which
# the desk edits live) and once as JSON (a mirror, which the page falls
# back to). The pages always prefer the database when it answers.
#
# WHY IT IS EXPORTED RATHER THAN HAND-KEPT. Two copies of the same
# content drift, always, and the drift is invisible because each copy
# looks right on its own. This script regenerates the JSON from the SQL
# through a real Postgres, so the mirror cannot say anything the seed
# does not.
#
# RUN IT after editing 0018:
#
#   bash tools/eu-export-seed.sh
#
# Needs postgresql-16 locally. Touches nothing outside data/.
# ============================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d /tmp/eu-export-XXXXXX)"
PORT="${PGPORT:-54331}"

if [ "$(id -u)" = "0" ] && id -u postgres >/dev/null 2>&1; then
  RUNAS="su postgres -c"; chown -R postgres "$WORK"
else
  RUNAS="bash -c"
fi

cleanup() {
  $RUNAS "PATH=$PGBIN:\$PATH pg_ctl -D $WORK/pg stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

$RUNAS "PATH=$PGBIN:\$PATH initdb -D $WORK/pg -U pg --auth=trust" >/dev/null 2>&1
$RUNAS "PATH=$PGBIN:\$PATH pg_ctl -D $WORK/pg -o '-k $WORK -p $PORT -c listen_addresses=' -l $WORK/pg.log start" >/dev/null

cat > "$WORK/shim.sql" <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema public, auth to anon, authenticated, service_role;
SQL

cp "$REPO/supabase/migrations/0017_equity_uprise_platform.sql" "$WORK/0017.sql"
cp "$REPO/supabase/migrations/0018_equity_uprise_seed.sql"     "$WORK/0018.sql"
chmod -R a+rX "$WORK"

PSQL="PATH=$PGBIN:\$PATH psql -h $WORK -p $PORT -U pg -d postgres -v ON_ERROR_STOP=1 -q"
$RUNAS "$PSQL -c 'set client_min_messages=warning' -f $WORK/shim.sql -f $WORK/0017.sql -f $WORK/0018.sql" >/dev/null

TOPIC_NOTE='MIRROR, NOT SOURCE. supabase/migrations/0018_equity_uprise_seed.sql is the source of truth; this file is exported from it so topics.html renders before the database is reachable, and on a signed-out first paint. Regenerate with tools/eu-export-seed.sh after changing the seed.'
FELLOW_NOTE='MIRROR, NOT SOURCE. supabase/migrations/0018_equity_uprise_seed.sql is the source of truth; this file is exported from it so fellowships.html renders before the database is reachable. Once the desk is adding listings live, the database is ahead of this file and the page prefers it. Regenerate with tools/eu-export-seed.sh.'

$RUNAS "$PSQL -At -c \"select jsonb_pretty(jsonb_build_object(
  'note', '$TOPIC_NOTE',
  'topics', (select jsonb_agg(to_jsonb(t) - 'updated_at' order by t.ordinal) from eu_topics t)))\"" \
  > "$REPO/data/eu-topics.json"

$RUNAS "$PSQL -At -c \"select jsonb_pretty(jsonb_build_object(
  'note', '$FELLOW_NOTE',
  'sources', (select jsonb_agg(to_jsonb(s) - 'last_swept' order by s.id) from eu_fellowship_sources s),
  'fellowships', (select jsonb_agg(
     to_jsonb(f) - 'id' - 'created_at' - 'updated_at' - 'created_by' - 'org_profile_id'
                 - 'verified_at' - 'deadline' - 'description'
     order by f.title) from eu_fellowships f where f.status = 'published')))\"" \
  > "$REPO/data/eu-fellowships.json"

echo "wrote data/eu-topics.json      ($(python3 -c "import json;print(len(json.load(open('$REPO/data/eu-topics.json'))['topics']))") topics)"
echo "wrote data/eu-fellowships.json ($(python3 -c "import json;print(len(json.load(open('$REPO/data/eu-fellowships.json'))['fellowships']))") listings)"
