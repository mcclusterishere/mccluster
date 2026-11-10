# E=Up → Environmental Justice League (admin-only intake)

Status, 2026-11-09: source and synthetic tests on branch `claude/new-session-83ken5`. Not merged, not applied, not deployed. Owner direction: the first deeper E=Up release is admin-only at every data, API and storage boundary; the consumer environmental globe keeps its current authorized behaviour and its two SQL files stay held.

## What exists

- `supabase/pending/eup_league_v1.sql` (+ `.rollback.sql`): private tables `eup_campaigns`, `eup_campaign_revisions`, `eup_missions`, `eup_mission_revisions`, `eup_applications`, `eup_assignments`, `eup_proofs`, `eup_proof_revisions`, `eup_proof_reviews`, `eup_consents`, `eup_command_receipts`; one service-only invoker RPC `eup_league_command(action, actor, id, document, revision, key)` that rechecks house ownership, expected revision (CAS), capacity (under the mission row lock) and an owner-scoped idempotency key whose payload digest must match on replay. RLS on, anon/authenticated revoked. Nothing touches `action_missions`, `network_groups`, `action_policy_bills` or the held `world_environment` SQL.
- `workers/mccluster/src/eup/league.js`: routes under `/v1/eup/league/*`, reached only through `eup/router.js` after `requireHouseOwner`. Request shaping, SQLSTATE mapping (`40001` revision conflict, `EU001` capacity, `EU002` self-review, `EU003` idempotency conflict), and an honest `schema_not_applied` 503 when the pending SQL is absent.
- `workers/mccluster/src/eup/league-fixture.js`: the five draft templates from the owner's review kit, unpublished, unpriced, no points/payment/commission/broadcast. A fixture the owner creates from; never seeded by code.
- `workers/mccluster/src/eup/overview.js`: module states (`draft`, `planned`, `held`, `dormant`, `partial`), campaign/queue counts from the intake, freshness and concrete blockers.

## Loop implemented (admin preview)

campaign draft → release → mission draft → release → application (owner records it for an account) → version-bound approval with atomic capacity → participant acceptance bound to the mission revision → private proof (modes per mission; a song needs credits and a rights declaration; no location fields) → revision-bound human review, no self-review → exact-scope consent (purpose, audience, notice revision, expiry, revocation) with `publication_state` fixed at `private`. Pause pauses assignments and blocks proof; re-release restores them; withdrawal declines open applications and withdraws assignments while receipts stay.

Not implemented, by design: publication, live broadcast, points, payouts, agency commission, member-facing application routes, media upload/quarantine. Routes `/league/publish|broadcast|points|payouts` answer 501.

## Routes

| Method | Path | Body |
| --- | --- | --- |
| GET | `/v1/eup/league/fixture` | |
| GET/POST | `/v1/eup/league/campaigns` | `{idempotency_key, campaign:{slug,title,purpose,audience:'admin_preview',…}}` |
| POST | `/v1/eup/league/campaigns/:id/transition` | `{idempotency_key, expected_revision, to}` |
| POST | `/v1/eup/league/campaigns/:id/missions` | `{idempotency_key, mission:{slug,template,title,proof_modes,capacity?,requirements,…}}` |
| GET | `/v1/eup/league/missions?campaign=` | |
| PUT | `/v1/eup/league/missions/:id` | `{idempotency_key, expected_revision, mission}` |
| POST | `/v1/eup/league/missions/:id/transition` | `{idempotency_key, expected_revision, to}` |
| POST | `/v1/eup/league/missions/:id/applications` | `{idempotency_key, expected_revision, application:{applicant?,…}}` |
| GET | `/v1/eup/league/applications?mission=&status=` | |
| POST | `/v1/eup/league/applications/:id/decision` | `{idempotency_key, expected_revision, decision, reason?}` |
| GET | `/v1/eup/league/assignments?mission=` | |
| POST | `/v1/eup/league/assignments/:id/accept` | `{idempotency_key, expected_revision}` |
| POST | `/v1/eup/league/assignments/:id/proofs` | `{idempotency_key, expected_revision?, proof:{mode,…}}` |
| GET | `/v1/eup/league/proofs?assignment=` | |
| POST | `/v1/eup/league/proofs/:id/review` | `{idempotency_key, proof_revision, decision, reason?}` |
| POST | `/v1/eup/league/proofs/:id/consent` | `{idempotency_key, proof_revision, consent:{purpose,audience,notice_revision,granted,expires_at?}}` |
| GET | `/v1/eup/league/consents?proof=` | |

## Tests

- `workers/mccluster/test/eup-league.test.mjs` (fake service REST): key/revision requirements, one-RPC routing, SQLSTATE mapping, unapplied schema, 501 surfaces, fixture policy, overview states.
- `scripts/test/eup-league.integration.mjs` (PGlite, `PGLITE_MODULE=…`): rollback + re-apply, anon/authenticated denial, idempotent replay and payload-digest conflict, CAS, capacity 1 with two approvals, pause/re-release/withdraw recovery, proof modes and song rights, self-review denial, stale review refused, consent grant/revoke, public projections untouched, Worker routes over the same database. PGlite is serial: capacity contention is proven under the row lock, not as a native multi-session race.

## Release gates (none met)

Owner review of the SQL; apply through the promotion path (`supabase/pending/README.md`) with its returned version; `live-callers.json` entries for `eup_league_command` and the `eup_*` tables until then; Control shell wiring; native PostgreSQL multi-session capacity test; decisions on points, audience beyond `admin_preview`, retention and who reviews.
