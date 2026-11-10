# Arcade activation handoff — 2026-11-07

The graphical games and City consumer are integrated through #754; #761 adds an
explicit cloud gate and Sole result recovery. This document records release prerequisites,
not a claim that production schema, flag, sessions or ion imagery have been verified.
Release coordination owns serial merges, schema promotion and Worker rollout.

## Release order

1. Keep `ARCADE_CLOUD_ENABLED` absent or false while inspecting the canonical database.
   The existing Worker authenticates the house owner even for `/v1/arcade/capabilities`.
   Local game play and device saves work with cloud disabled. Capability true only
   verifies the flag and binding presence; it does **not** prove schema readiness.
2. **Applied 2026-11-09** as `supabase/migrations/20261109181623_city_arcade_v1.sql`, version
   `20261109181623`, SHA-256 `b03081d4be03ed85673b1f5f401ba8de5cef8c88dc59e241436734e8f323aba0`
   (stored statements compared with the file; receipt
   `docs/control-plane/evidence/releases-2026-11-09/MIGRATION-RELEASE-RECEIPT.md`). The older
   reviewed hash `787e1dc2…` described the pre-W2/W3 file and is superseded. Do not re-apply
   the file; it uses plain CREATE statements. All three tables held zero rows at receipt time.
   The LIVE Worker still runs the pre-`startKey` handler and cannot start runs against this
   schema: deploy the reviewed handler (this branch) before `ARCADE_CLOUD_ENABLED` is ever set.
3. Prerequisites are existing `auth.users`, `public.orgs` (slug `mccluster`),
   `public.org_members` (`profile_id`, `org_id`, `role`), and the existing server role.
   Verify its SELECT permission on membership tables and actual schema compatibility.
   The migration creates three Arcade tables and two functions, enables RLS and
   denies direct anon/authenticated access. Version rows allow service SELECT/INSERT
   only. The RPC rechecks current owner membership on each command.
4. Before enabling production, run real multi-connection PostgreSQL checks for concurrent
   first creation/revision conflicts, frozen mission versions, duplicate finish and
   membership revocation. PGlite integration is serial and cannot prove those races.
   Verify schema cache visibility and canonical Worker access using existing server
   bindings; do not put credentials in browser code, logs or this handoff.
5. Deploy the reviewed canonical Worker with existing `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` bindings, then set `ARCADE_CLOUD_ENABLED=true` through
   the coordinated rollout. The owner must verify capability, mission save/load/start,
   finish/history/reload and recovery for both games. Member/guest/revoked access must
   remain denied. Practice results are self-reported and must not award real currency.
6. On failure, disable the cloud flag and retain schema/data. Local play remains available.
   Do not drop tables, erase runs or revert unrelated releases as a rollback shortcut.

## Acceptance entry points

- `city-arcade.html?game=gauranfucking-tea-tea-rush&location=bridgeport-main-elm`
- `city-arcade.html?game=designer-kicks-sole-run&location=bridgeport-main-golden-hill`
- Repeat Sole with `location=bridgeport-main-elm`.

Use the existing owner-protected host and actual owner session. At 390px and 1280px,
check graphical play, touch/keyboard, configuration, result persistence, return/resume,
and **Walk Sole routes on globe** through both entrance directions. The same Cesium
viewer must survive entry/return. Test hex/square position continuity, closures and
lost-return acknowledgement retry. Do not publish any test authentication harness.

## Automated evidence and boundaries

`city-arcade-recovery.e2e.mjs` exercises actual Sole modules and an isolated database:
start a saved mission, fast-forward its local timer, let the database accept completion
and drop its response, restart locally, reload with a denied session (Reconnect and Discard
must be on screen), restore authorization and press Reconnect, without a reload. It verifies one
result and cleared pending state at 390px and 1280px, Sole only, with a session that has
no user id (the outbox's `device` scope). Timer fast-forward and identity fixtures are
test-only; this does not prove production sessions or a human playthrough.
The City Arcade workflow runs this alongside graphical play, disabled/missing-schema
behavior and actual Cesium lifecycle browser checks.

Unit and integration checks the same workflow runs:

- `city-arcade-outbox.test.mjs` (both games, DOM stub that keeps the markup's initial
  `hidden`): restart, apply, load and a new start keep an unsaved receipt; Reconnect is
  hidden while the cloud is ready, offered when it is not, and saves the receipt when
  pressed; a 409 on finish keeps "The server already holds a different result for this
  run …" and the receipt; a stored receipt cannot be rewritten; the outbox never evicts.
- `city-arcade-start-intent.test.mjs` (both games): the start key is stored before the
  request, reused after a lost response, and cleared after success or a 409; with
  `PGLITE_MODULE` set it also drives the real handler and applied SQL and counts one run.
- `city-arcade-start-recovery.integration.mjs`: keyed starts, exact retry including the
  run's frozen revision document after a re-save, conflicting reuse, `current`.

Not in CI, local and opt-in: `city-arcade-start-key.native.integration.mjs` races one start
key on native PostgreSQL 16/17. Reused at once on two missions, the second start loses on
`unique(actor,start_key)` (23505); reused in sequence it is refused with 40001. The Worker
answers 409 to both, and no second run is created.

Shared City uses sourced road topology and continuous ENU positions. Arcade legacy
saves retain their separate coordinates. Confirmed, request-correlated shared City arrivals now collect Sole checkpoints in configured
order; four pairs plus an explicit entrance return complete the mission. Progress survives
return/reload, and cloud completion uses the existing pending-result retry path. Doors/stairs,
live ion entitlement/imagery and physical-phone performance remain unverified.

Live read-only probes from this executor on 2026-11-07 to the public Arcade page and
API capability endpoint failed at the network CONNECT proxy (403, no target HTTP
response). This is not evidence that either production endpoint failed. Authenticated
live acceptance and schema/flag inspection remain with the release coordinator.
