#!/usr/bin/env bash
# Runs the Anti-Social — Get Social chain and its behaviour tests against a
# throwaway local Postgres (16+), as the real API roles:
#   the API role stub, the member-network table stub, the gamification
#   migration, the proof retry/review-history migration, the feed-share
#   migration, the draft three-level migration, then the pending completion
#   SQL, then the behaviour tests.
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=pg scripts/test-antisocial-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="antisocial_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/mnet_network_tables.stub.sql
apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
apply supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql
apply supabase/migrations/20261002135458_action_network_feed_shares_v1.sql
apply supabase/migrations/20261014185154_antisocial_get_social_three_levels_draft.sql
apply supabase/pending/antisocial_get_social_completion_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/antisocial_connections.behaviour.sql
if [ -f supabase/tests/antisocial_levels.behaviour.sql ]; then
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/antisocial_levels.behaviour.sql
fi
echo "antisocial chain: ok"
