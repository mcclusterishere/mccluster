# Adaptive mission acceptance and activation

This is the release companion for the bounded owner-only coordinate practice from #742. It does not activate a live news pipeline or grant certification. Generated side operations (#762) are a separate tactical feature; their outcomes must not be treated as validated learning answers.

## Repeatable database acceptance

Run from the repository root with Node 22+ and Docker:

```sh
node scripts/test-prim3-adaptive-postgres.mjs
```

The script starts digest-pinned PostgreSQL 17.6 and PostgREST 13.0.7 in a disposable Docker network. Only PostgREST is published on a random loopback port. It creates synthetic identities, applies the existing learning migration with repository auth/storage dependency stubs, and uses the actual learning handler over PostgREST HTTP. It accepts no production URL or credentials. Containers, volumes, network and temporary local credentials are removed in `finally`.

Acceptance includes simultaneous release, two independent PostgREST connections demonstrably waiting on a real PostgreSQL session-row lock, duplicate/conflicting answers, rollback without chain gaps, lost commit acknowledgement, JSONB signature replay, hints, failed-close recovery, complete debrief, RLS isolation, append-only protection, generic-route bypass rejection, forged self-reported evidence and wrong-key rejection. No competency ratings are written. The corresponding GitHub workflow repeats this on relevant PRs and main.

The owner authorization callback is synthetic in this test. This proves the adapter/database contract, not production identity, deployed settings, Worker runtime, or live news. The HTTP transport wrapper strips the Supabase `/rest/v1` prefix and injects two named failure cases; it never fabricates database responses.

## Serial release procedure

The release coordinator owns merge, production configuration and rollout. Do not run competing settings or schema writes.

1. Require green exact-head CI, including **PRIM3 adaptive real PostgreSQL**. Recheck the eventual main/deployed SHA; PR-head CI cannot prove a later merge tree.
2. Verify existing `learning_lab_sessions`, `learning_evidence_events` and `learning_competency_ratings` schema, RLS, primary/sequence uniqueness, append-only and hash-chain triggers. This feature introduces no migration. Compare the existing learning migration before considering any repair; do not blindly reapply SQL.
3. Verify the existing house-owner authorization against a real authorized session. Unauthenticated and non-owner calls must fail, even if other learning routes are opened to more learners. Do not weaken the owner gate or reuse a service credential as a user session.
4. Provision a dedicated random signing key through the approved secret-management path. Keep its value out of logs, PRs, browser code and shell arguments. It must survive deployments: the current version does not support rotating away a key while retaining verification of historical sessions. Do not replace/delete an established key to recover a failed session.
5. Enable `PRIM3_ADAPTIVE_ENABLED` as the exact string `true` only after the preceding checks. Reconcile configuration through the existing deployment source so a later deployment cannot silently reset it. Do not add the secret to repository vars.
6. With the house owner's authenticated browser, open `prim3-mission.html`. Verify metadata reports enabled, complete the explicit fiction/geography review, acknowledge the brief and prepare/open Transit. Return, submit a correct answer, use a hint, submit another answer, save debrief and reload. The saved debrief must retain validated math evidence while labeling tactical outcome as learner-reported and awarding no Principles credit.
7. Exercise a lost-response retry on an approved synthetic acceptance session and confirm one receipt, contiguous sequence and one debrief. Verify a second identity cannot read it. Record only sanitized session references and results in the release evidence; do not publish learner data or tokens.
8. Disable the flag if any acceptance step fails. Preserve the key and evidence. Disabling stops reads/writes through the adapter before database access; it is not a database rollback.

## Remaining product scope

The integrated exercise has three practice levels, server-validated answers and bounded cross-session continuity (see `VERIFIED-PRACTICE-PROGRESSION.md`), not calibrated mastery or certification. Tactical handoff is an existing separate tab with learner-reported outcome. Automatic verified-news intake, moderated durable news releases with provenance/deduplication/expiry, varied curriculum templates, broader persistent curriculum progression, and authenticated in-game checkpoint callbacks remain separate work. Do not describe a successful coordinate-practice activation as completion of those capabilities.
