#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTIVE="$ROOT/supabase/migrations"
REPLAY="$ROOT/supabase/replay_migrations"
TMP="$(mktemp -d)"
BACKUP="$TMP/backup"
ADDED="$TMP/added"
mkdir -p "$BACKUP"
: > "$ADDED"

cleanup() {
  set +e
  shopt -s nullglob
  for saved in "$BACKUP"/*.sql; do cp "$saved" "$ACTIVE/$(basename "$saved")"; done
  while IFS= read -r name; do [[ -n "$name" ]] && rm -f "$ACTIVE/$name"; done < "$ADDED"
  rm -rf "$TMP"
}
trap cleanup EXIT

shopt -s nullglob
replays=("$REPLAY"/*.sql)
[[ ${#replays[@]} -gt 0 ]] || { echo "No replay migrations found under $REPLAY" >&2; exit 2; }

for replay in "${replays[@]}"; do
  name="$(basename "$replay")"
  if [[ -f "$ACTIVE/$name" ]]; then cp "$ACTIVE/$name" "$BACKUP/$name"; else printf '%s\n' "$name" >> "$ADDED"; fi
  cp "$replay" "$ACTIVE/$name"
done

# Production applied these migrations atomically via apply_migration. The CLI reset
# can execute top-level statements separately (their LOCK TABLE then fails with
# 25P01), so stage transaction boundaries only in the disposable reset copy. Keep
# the canonical stored statements byte-exact.
transactional=(
  "20261031180839_music_direct_sales_v1.sql"
  "20261109175747_music_direct_asset_versions_v1.sql"
)
for name in "${transactional[@]}"; do
  if [[ -f "$ACTIVE/$name" ]]; then
    cp "$ACTIVE/$name" "$BACKUP/$name"
    { printf 'begin;\n'; cat "$BACKUP/$name"; printf '\ncommit;\n'; } > "$ACTIVE/$name"
  fi
done

mode="${1:-reset}"
if [[ "$mode" = "start" ]]; then
  shift
  supabase start "$@"
elif [[ "$mode" = "reset" ]]; then
  shift || true
  supabase db reset "$@"
else
  supabase db reset "$@"
fi
