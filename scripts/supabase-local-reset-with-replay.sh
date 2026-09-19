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

supabase db reset "$@"
