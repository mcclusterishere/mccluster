# Versioned lattice learning in existing missions

Continuation of #786, with #781 and upstream mcclusterishere/Prim3#22 at `197bc2d8df4dc5638249125804eba752e534710e` as geometry/runtime dependencies. No vendored resolver file is edited. The existing owner-only reviewed mission page selects the play variant and supported learning mode before its signed session starts.

## Actual variants

| Variant | Existing runtime | Learning |
| --- | --- | --- |
| Generated side operation | #762 generated level | Existing row distance or square cardinal steps at generated objective steps |
| Transit / Relay | `transit-relay` | Square cardinal steps after each of three turns |
| Equity Uprise HQ | `equity-uprise-hq` | Square cardinal steps after each of three turns |
| B1 · Restore the Picture | `equity-uprise-b1&side=defend` | Square cardinal steps after each of three turns |
| B1 · Blind the Floor | `equity-uprise-b1&side=attack` | Square cardinal steps after each of three turns |
| Courtyard study | Existing PlayCanvas courtyard | Square cardinal steps after each of three turns |
| City street simulation | #781, same canonical resolver | Square or hex lattice steps after each of three turns; actual City topology matches selected learning mode |

Turn readiness is browser-reported presentation context. It is not proof of mission victory. An abandoned debrief is a legitimate saved learning attempt. Authored square-only levels reject hex mode; this work does not imply their geometry supports hex navigation. Forge and Range are editing/shooting tools, not newly claimed mission variants. Existing generator, combat, AP, enemies and saves remain authoritative in their own modules.

## Mathematical contract

`prim3.lattice-learning/v1` pins variant and topology. `square-cardinal-distance/v1` counts four-neighbor steps with Manhattan distance. `hex-axial-distance/v1` counts six-neighbor steps using pointy axial coordinates `(q,r)`, cube `s=-q-r` and half the sum of absolute cube deltas. Inputs are generated on the server from the signed seed and question ordinal. Submitted numbers, question IDs and checkpoint IDs are checked by the existing evaluator and signed evidence path; submitted correctness/expected answers confer no authority.

These are explicitly **unobstructed practice lattice exercises**, not shortest paths through the actual buildings, metric graph routes or AP costs. The server never interprets opaque City node indices as coordinates. Questions display their frame and unit, `lattice steps`.

Authorities:
- `js/prim3-tactics/levels/transit-relay.mjs`: display `(x-32,31-y)`, north-positive Y, 3.54 m tiles.
- HQ and B1 level modules: display `(x-3,8-y)`, north-positive Y, same tile scale.
- Courtyard `rules.js` and `game.js`: centered 10-cell display `(x-4.5,4.5-y)`; no geographic or surveyed metre claim.
- `data/spatial/bridgeport-downtown.v2.json` and `js/spatial/metric-frame.mjs`: street floor, `bridgeport-golden-hill.enu.v1`, x east/y up/z south, square side 2 m, pointy hex radius 1.5 m. Hex +q is east, +r southeast; neighbor spacing is sqrt(3)*1.5 m. The pure tests compare the evaluator to BFS using the actual contract's neighbors and verify cell-center metric spacing.

## Evidence, recovery and scope

A session's normalized context is signed in the initial release event and cannot switch on retry, including concurrent starts. Replay selects the same versioned evaluator. Correct/incorrect/hinted evidence and debriefs use #786's existing tables, signed receipts, expiry and revocation guard. No new SQL or credentials are introduced. All SQL from #786 remains pending and both existing feature gates remain required/default-disabled.

New lattice domains start at level 1 and adapt only within the session. Their signed evidence persists, but they do not seed legacy row-distance progression. No cross-domain level equivalence, mastery calibration, certification or competency credit is claimed. The mode is fixed until debrief; a new session may choose another supported mode. Resume keeps the signed learning context and the existing game's own save/restart semantics; the courtyard itself has no durable tactical save, so its turn presentation resets after a page reload while accepted learning answers remain durable.

Browser acceptance drives actual UI turns with ordinary runtime behavior, then wrong, hinted and correct answers and an explicitly abandoned debrief/reload for every named authored variant and both City modes. It does not fabricate battle completion or prove every campaign can be won. Source review is still an owner attestation. Existing release provenance does not geographically relocate an authored HQ or courtyard scenario.

The release coordinator owns serial integration of #762/#768/#774/#786/#781, pending SQL review/promotion, authorized configuration and authenticated live acceptance. There are no production mutations in this continuation.

Integration overlap: release-owned #786 fixes address premature Completed submissions and expired/revoked-session restart. This continuation also touches `js/prim3-mission/client.mjs`, `released-app.mjs` and `released-learning.mjs`; preserve both changes during serial integration. Those two repairs are not duplicated here.
