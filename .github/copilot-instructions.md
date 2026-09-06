# GitHub Copilot — McCluster

This repository participates in the McCluster control plane.

Canonical backend: GitHub `mcclusterishere/mccluster`, Cloudflare Worker `mccluster`, Supabase `zmnhbrjyhxzhkxmhkexs`.

There is no Worker named `mccluster-core`. Do not create one.

Do not scaffold a new API server, auth provider, or database. Route shared work through McCluster. Public site is `matthew.mccluster.org`. API is `https://api.mccluster.org`. Read `AGENTS.md`.

## Autonomous operations contract

McCluster is an event-driven operating system, not a collection of disconnected assistants.

Canonical operational state lives in Supabase project `zmnhbrjyhxzhkxmhkexs`. Existing outreach CRM tables include `out_companies`, `out_contacts`, `out_campaigns`, `out_recipients`, and `out_events`. The autonomous operations layer includes `ops_objectives`, `ops_signals`, `ops_lead_scores`, `ops_agent_jobs`, `ops_recommendations`, and `ops_repo_events`.

When working in this repository:

- Reuse the canonical backend and schemas; do not create parallel CRM databases, shadow lead lists, or competing sources of truth.
- Treat repository changes, tests, deployment results, CRM engagement, research findings, and campaign outcomes as signals that should feed the operating layer.
- Prefer event-driven jobs plus scheduled reconciliation over one-off scripts.
- Keep lead/account scoring adaptive: engagement, urgency, fit, and momentum may expand or shrink campaign scope.
- New objectives and campaigns may be proposed automatically from evidence, but proposals must be written as recommendations before external execution.
- Autonomous agents MAY research, classify, score, reconcile, test, lint, analyze, draft, queue jobs, and propose next actions.
- Autonomous agents MUST NOT send external communications, merge/deploy production code, spend money, delete production data, change authentication/authorization, or perform destructive migrations without explicit human approval.
- Every organized outbound message must obey `docs/control-plane/OUTREACH-CRM-INVARIANT.md`; the CRM/database is the source of truth and Gmail `CRM Linked` is only an audit marker after successful database linkage.
- Never invent contact metadata, consent, replies, opens, clicks, titles, or company facts. Unknown is a valid value.
- Make jobs idempotent where possible and record enough provenance to explain why a score, recommendation, or scope change happened.
- Tests are part of the product. Code-changing agents should run the relevant tests and record outcomes before proposing or completing a change.

The desired steady state is continuous maintenance: ingest signals, reconcile state, score priorities, run safe checks, surface anomalies, and prepare high-value next actions while the owner is offline. Human approval gates remain mandatory for consequential external or production actions.

## Never draw a logo

The artwork the owner supplies is the only source of truth for any mark,
forever. Do not trace, approximate, reconstruct, recolour, or composite one —
not as a placeholder, not "until the real one arrives", not at a size where
you think it will not matter. Cropping a supplied file is fine; adding a
shape it does not contain is drawing. If the variant you need does not
exist, ask for it.

An agent shipped a hand-drawn `we-icon.svg` into three repositories once and
it had to be torn out of four. See `AGENTS.md` → "THE LOGOS ARE NOT YOURS TO
DRAW" for the supplied Whip Equipped kit.

## mcclusterishere/Here is dead

It publishes nothing — deploy workflows disabled, no CNAME. Do not write to
it. If a task looks like it belongs there, say so in the chat and work in
`mcclusterishere/mccluster` instead.
