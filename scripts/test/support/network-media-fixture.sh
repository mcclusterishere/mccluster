# Shared by scripts/test-network-media-pointer-guard-db.sh and
# scripts/test-network-media-storage-flow.sh (sourced, not run): the fixture
# for supabase/pending/network_media_assets_pointer_guard_v1.sql and the small
# helpers both use. Scratch databases only; the PG* environment names the server.
NM_PENDING=supabase/pending/network_media_assets_pointer_guard_v1.sql
NM_ROLLBACK=supabase/pending/network_media_assets_pointer_guard_v1.rollback.sql
NM_T=supabase/tests/network_media_assets_pointer_guard
NM_EVIDENCE=docs/control-plane/evidence/production-schema-snapshot-2026-11-03.json

nm_apply()   { psql -q -v ON_ERROR_STOP=1 -d "$1" "${@:3}" -f "$2" >/dev/null; }
nm_pipe()    { psql -q -v ON_ERROR_STOP=1 -d "$1" >/dev/null; }
nm_q()       { psql -qAt -v ON_ERROR_STOP=1 -d "$1" -c "$2"; }
# psql's NOTICE lines (each test block reports in one), and everything from the first ERROR on
nm_notices() { PGOPTIONS="--client-min-messages=notice" psql -q -v ON_ERROR_STOP=1 -d "$1" "${@:2}" 2>&1 | sed -n 's/^.*NOTICE:  /   /p; /ERROR:/,$p'; }
nm_fail()    { echo "FAIL: $*" >&2; exit 1; }

# The applied files' own DDL, byte for byte: m_people and m_auth_user_links
# (replay 0049), current_m_uid() (replay 0051), m_merge_people (0049), and
# 20260920071811 from its first line down to its Storage policies (the table,
# its policies and grants, the mnet-media bucket, the four Storage policies).
nm_applied_ddl() {
  awk '/^create table if not exists public\.m_people/{on=1} /^comment on table public\.m_people/{on=0} on' \
    supabase/replay_migrations/0049_m_account_people.sql | nm_pipe "$1"
  awk '/^create or replace function public\.current_m_uid/{on=1} on{print} /^grant execute on function public\.current_m_uid/{on=0}' \
    supabase/replay_migrations/0051_m_account_uid_rpc.sql | nm_pipe "$1"
  awk '/^create or replace function public\.m_merge_people/{on=1} on{print} /^grant execute on function public\.m_merge_people/{on=0}' \
    supabase/replay_migrations/0049_m_account_people.sql | nm_pipe "$1"
  awk '/^create table if not exists public\.network_blocks/{exit} {print}' \
    supabase/migrations/20260920071811_mnet_real_network_v1.sql | nm_pipe "$1"
}

# Everything in public and storage, as one value under a label; two labels compared.
nm_mark() { nm_q "$1" "insert into t.fingerprints values ('$2', t.fingerprint()) on conflict (label) do update set value = excluded.value" >/dev/null; }
nm_same() {
  [ "$(nm_q "$1" "select (select value from t.fingerprints where label = '$2') = (select value from t.fingerprints where label = '$3')")" = t ] \
    || nm_fail "$4: $(nm_q "$1" "select string_agg(a.key, ', ') from jsonb_each((select value from t.fingerprints where label = '$2')) a where a.value <> ((select value from t.fingerprints where label = '$3') -> a.key)") differ between $2 and $3"
}

nm_evidence()  { node scripts/test/support/media-asset-evidence.mjs "$1" "$2" "$NM_EVIDENCE"; }
nm_attacks()   { nm_notices "$1" -v after="$2" -f "$NM_T.attacks.sql"; }
nm_behaviour() { nm_notices "$1" -v cases="$(cat "$NM_T.cases.json")" -f "$NM_T.behaviour.sql"; }
# The guard's precheck (21 numbers) and the media-signing fix's legacy count (7:
# assets, not_canonical, prefix_not_linked_to_owner, named,
# named_and_no_longer_signed, named_ids, named_ids_without_a_row).
nm_count()     { psql -qAt -F ' ' -v ON_ERROR_STOP=1 -d "$1" -f scripts/db/media-asset-pointer-guard-precheck.sql; }
nm_legacy()    { psql -qAt -F ' ' -v ON_ERROR_STOP=1 -d "$1" -f scripts/db/media-asset-legacy-count.sql; }
# Both on the same rows, against what is expected, and against each other on the
# four numbers they share: rows, not canonical, prefix not linked, and unsigned
# rows that a proof, a level, a case or a clipping source names.
nm_counts() {  # database, when, expected precheck, expected legacy count
  local pre legacy
  pre="$(nm_count "$1")"; legacy="$(nm_legacy "$1")"
  [ "$pre" = "$3" ] || nm_fail "the precheck $2: $pre"
  [ "$legacy" = "$4" ] || nm_fail "the legacy count $2: $legacy"
  [ "$(echo "$pre" | cut -d' ' -f1,3,4,10)" = "$(echo "$legacy" | cut -d' ' -f1,2,3,5)" ] \
    || nm_fail "the precheck and the legacy count disagree $2: $pre / $legacy"
}
