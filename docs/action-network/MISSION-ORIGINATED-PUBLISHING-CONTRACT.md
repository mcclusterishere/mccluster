# Action Network publishing invariant — mission-originated only

Decision: a member may publish to the Action Network only by **doing a mission** or **funding a mission**. This is a forward implementation requirement; existing free-form composer and API are not yet enforced against this policy.

## Publishing sources
- Do: accepted mission, progress update, evidence/proof submission, verified milestone, completed outcome, collaborator contribution.
- Fund: contribution receipt (amount privacy controls), campaign funding milestone, funded outcome, impact follow-up.
- Polls and updates: must be attached to a mission and initiated by authorized mission participants or organizers; no general free-floating social posts.
- Public discovery: cards on the 35% panel represent mission-linked events and can open in-place while the globe remains visible.
- Moderation and integrity: role/ownership validation, server-side mission membership or verified funding, anti-spam, privacy/redaction, media checks, dispute/reversal handling; never rely on a disabled composer alone.

## Backend gate (required before launch)
1. Add explicit post_type and source_mission_id plus immutable origin reference (assignment, proof, verified event, or payment receipt) with unique idempotency key.
2. In the canonical Worker POST route, reject posts without valid source and authorization; validate funding using server-confirmed payment status, never client claims.
3. Preserve legacy content as read-only archival material until it can be classified, rather than inventing mission provenance.
4. Add end-to-end tests: anonymous reject, arbitrary post reject, unrelated mission reject, unverified payment reject, valid mission/fund publish, refund/reversal policy, and moderation.
5. Provide mission-specific structured composer, not an unrestricted free-form posting entry point.

**No backend enforcement is claimed by this specification.**
