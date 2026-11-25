# Verified practice continuity

The coordinate exercise can continue at an appropriate practice level in a new session. This is a bounded heuristic for practice, not a calibrated mastery estimate, Principles credit or certification. It uses the existing learning evidence tables without a migration.

`GET /v1/prim3/learning/adaptive/progress` remains behind the same house-owner and configuration gates. It considers at most ten most recently closed sessions for this user, pack and version, ordered by closure time and ID. Each session's signatures, ordered actions, deterministic answer results and final debrief are replayed. A mismatched closure or unverifiable history fails closed. The response identifies the ten-session window and whether older sessions exist; it is not a lifetime total.

The latest verified debrief supplies the next practice level. An increase requires at least two independent correct answers in that session; hints and reported tactical victory do not increase it. Incorrect answers can lower the level under the existing exercise rule. A session closed with a reported abandoned tactical outcome still contains valid math evidence. Active sessions are excluded. The next release signs its `initial_level` and `basis_session_id`, so later history changes cannot silently alter an existing session's questions. Old releases without these fields still replay from level one.

The player can review another practice after the server acknowledges the closed debrief. This clears only the browser's current-session pointer, preserves server evidence and requires the fiction/geography review again. It cannot discard an unacknowledged request or bypass the debrief.

## Interfaces for the tactical and mission owners

This change depends on the PostgreSQL acceptance work in #768 and must follow it through the serial release coordinator. It does not edit that branch or the release-owned #762 generator. The dedicated signing key still requires action-time approval; this change does not create credentials, enable the feature or modify production data.

The inspected canonical Prim3 commit `efb455c108c858f59cab0c3d2964a1d0783432fa` adds `prim3.metric-navigation/v1` to the tactical resolver. Its graph x-coordinate is an opaque node index, and its hint generator explicitly rejects metric learning challenges. The City's lifecycle/route preview contract also cannot authorize PRIM3 movement or spend AP. Therefore this exercise's row-coordinate questions remain independent of City positions, metric route costs and tactical AP; no conversion is inferred here.

A future authoritative checkpoint integration needs a server-validated run identity, engine/rules revision, released scenario revision and checkpoint identity bound to the owner/session. The current `handoff` receipt records a request to enter Transit, not proof of objective completion. Do not accept a browser victory message, generated mission outcome or preview arrival as learning evidence. Answers use the current server-issued question ID, event ID/sequence and submitted integer; the evaluator determines correctness. A new math domain for square/hex routes must define coordinate frame, topology, distance/cost units and skill version before adding a validator. This PR adds no second tactical engine or news pipeline.

Durable moderated news releases and authenticated tactical completion remain unfinished. This change closes only bounded cross-session practice continuity; it does not make the broader adaptive curriculum or news mission engine complete.

## Validation

Focused tests cover level carryover, hints and outcome independence, user isolation, tampered history, disabled access, the ten-session window, legacy signed releases and the new-session client guard. The real PostgreSQL/PostgREST harness from #768 adds progression and foreign-user checks. Browser acceptance covers review → brief → handoff → answers → debrief → another reviewed session at 390px and 1280px. These use synthetic identities and do not prove production login or activation.
