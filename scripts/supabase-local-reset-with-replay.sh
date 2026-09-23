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

mode="${1:-reset}"
if [[ "$mode" = "start" ]]; then
  shift
  attempts="${SUPABASE_START_ATTEMPTS:-6}"
  base_delay="${SUPABASE_START_RETRY_BASE_SECONDS:-5}"
  for ((attempt=1; attempt<=attempts; attempt++)); do
    log="$TMP/supabase-start-$attempt.log"
    if supabase start "$@" 2>&1 | tee "$log"; then
      break
    fi
    status=$?
    if ! grep -Eqi 'toomanyrequests|failed to pull docker image|error pulling image configuration' "$log"; then
      exit "$status"
    fi
    if (( attempt == attempts )); then
      echo "Supabase start exhausted $attempts registry-throttle retries." >&2
      exit "$status"
    fi
    supabase stop --no-backup >/dev/null 2>&1 || true
    delay=$(( base_delay * (1 << (attempt - 1)) ))
    (( delay > 60 )) && delay=60
    echo "Supabase image registry throttled; retrying start attempt $((attempt + 1))/$attempts after ${delay}s." >&2
    sleep "$delay"
  done
elif [[ "$mode" = "reset" ]]; then
  shift || true
  supabase db reset "$@"
else
  supabase db reset "$@"
fi
