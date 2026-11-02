# Continued backend readiness work — v4

The one whole-platform assignment remains docs/productization/20261102/CLAUDE-PROMPT.md. v3 source and c150 source archives stay immutable. Work continues locally with isolated domain and Tile bridge worktrees; their results must be reviewed before inclusion.

The primary free-builder backend journey now runs actual managed-project create/public-read handlers plus v2 save/resume/publish/withdraw/recover over actual local SQL with fixture Auth. It verifies text/image config round-trip, public draft/owner-field omission, wrong-user refusal, and recovery without republication.144 assertions pass in evidence/free-builder-sql-http.log. This does not verify a real sign-up, uploaded image bytes, browser preview/public rendering, mobile acceptance or funded hosting. Those remain explicit functional gates.

See PLATFORM-CONTRACT-QUEUE.md for domain/year/platform-month/module-expiry semantics, actual existing source boundaries, required owner decisions and exact operational gates. No source gate was disabled and no live transaction occurred.

## Integrated final source and proof

Main e80cb0a137683393f19ba251f9beb9e66577ce64 was reconciled locally in merge e1eeacec. It is now an ancestor; applied supabase/migrations and production-ledger.json match main byte-for-byte. Four conflicts were resolved deliberately: both storefront and bound music checkout regressions retained, candidate customer-commerce return URLs retained plus main music purchase URLs, and source-coverage entries unioned without changing building capability ownership.2,164 source-coverage checks pass. No spatial/product capability was invented.

Domain corrective a6ae46f9 was reviewed and applied as2a402b6a; Tile bridge a69a1f6c as50fa9a51. Both came from isolated local worktrees. The front validator also rejects normalized dot-segment paths so personal fronts cannot evade project-media exclusion via `/./projects/`.

Final combined proof:144 editor/free-builder SQL/HTTP assertions;57 Tile bridge SQL/HTTP/hash assertions;1,338 Worker tests,0 skipped;1,342 root tests;7 Python tests. Native six editor/Tile proof lines cover simultaneous Control/project/front writes, withdrawal/recovery, publish/takedown, old/new Tile lock order and stale publish/withdraw. Native three domain proofs cover duplicate funding, same-host and same-order claims. Domain source's three standalone SQL/API replays are preserved in the domain handoff evidence; full combined Worker included all formerly skipped PGlite suites.

The bridge uses service-only project_tile_editor_v2, checks both editor-head and Studio revision, locks before legacy row locks, preserves existing media/entitlement validators and drafts, and supports explicit unpublished switch-back/withdraw/recover. See ../20261102-tile-bridge/HANDOFF.md for the exact routes and signatures. The baseline primary replay intentionally demonstrates failure BEFORE bridge application; the dedicated suite applies and verifies the solution. Frontend callers still need dual-revision adoption; no flag enabled.

Domain corrections match exact quote hostname/action/term/availability, reject malformed ownership timestamps, require the server-bound checkout session and make webhook binding races retryable. See ../20261102-domain/HANDOFF.md. Read-only deployed Worker metadata proves the18 candidate bindings absent from that inspected deployment; no secret values were exposed. Sandbox-only execution, provider-enforced charge/registrant proof, domain refund/renewal/transfer, DNS/TLS refresh, annual ownership and tenant trial/module contract remain concrete gates. Code fixes do not make live domain purchase ready.

Prepared changes: updated pending editor_versioned_contracts_v1.sql; additive pending project_tile_editor_v2.sql; corrected existing unapplied creator_domain_orders_v1.sql. No production apply/version/ledger changes. Trial grants/module billing are NOT fabricated migrations; required canonical-identity and policy decisions remain in PLATFORM-CONTRACT-QUEUE.md.

The one master Claude assignment covers the whole platform with internal milestones, prioritizing the free-builder activation and actual domain purchase journeys. All other modules remain in its coverage appendix. Continue ready frontend work; exact backend/owner gates stay unresolved until independently verified. Current source package CHECKPOINT.json pins the final combined commit and SOURCE-HASHES.json pins the executable contents.
