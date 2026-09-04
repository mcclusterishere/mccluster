# Outbound Outreach CRM Invariant

This is a control-plane operational rule for McCluster Corp outreach.

## Invariant

Every outbound message intentionally sent as part of any campaign, prospecting sequence, stakeholder interview campaign, partnership outreach campaign, sponsorship/resource outreach campaign, cohort recruitment effort, manufacturer/OEM outreach, or other organized outreach must be linked to the McCluster outbound CRM before the send task is considered complete.

This includes the initial message and every later message that advances the same organized outreach relationship: follow-up replies, reroutes, scheduling continuations, corrections, introductions, and other campaign-thread sends.

For Gmail sends, the CRM linkage must preserve at minimum:

- provider = Gmail
- Gmail message ID
- Gmail thread ID
- primary recipient address
- subject
- sent timestamp
- campaign identity or Gmail campaign label when applicable
- recipient state = sent
- a corresponding sent event

After the CRM linkage succeeds, apply the Gmail label `CRM Linked` to the sent message. That label is the human-visible audit marker. The database is the source of truth.

## Completion rule

Do not report campaign outreach as complete while any message in the batch lacks its CRM linkage. A successful Gmail send followed by a failed CRM write is an incomplete operation and must be repaired before moving on.

## Reconciliation

When a mismatch is suspected:

1. Enumerate the Gmail campaign label or outbound batch.
2. Compare Gmail message IDs against `out_campaigns.audience.gmail_message_id`.
3. Backfill missing `out_contacts`, `out_campaigns`, `out_recipients`, and `out_events` records without inventing consent, opens, clicks, replies, titles, or company metadata.
4. Verify one unique CRM campaign record per Gmail message ID.
5. Verify sent-recipient and sent-event counts match the campaign-message count.
6. Apply `CRM Linked` only after the database linkage exists.

The database enforces uniqueness for non-empty Gmail message IDs through `out_campaigns_gmail_message_id_unique`.

## Current reconciliation baseline

As of 2026-09-04:

- Data Center Campaign Partners: 99 Gmail messages linked
- Shiloh Resource Outreach: 86 Gmail messages linked
- DeKalb Policy Interviews: 34 Gmail messages linked
- Motorcycle OEM Outreach: 22 Gmail messages linked
- PRIM3 Cohort Outreach: 7 Gmail messages linked
- Total organized outreach messages reconciled: 248
- CRM sent-recipient rows: 248
- CRM sent-event rows: 248
- Duplicate Gmail message IDs: 0

Gmail `CRM Linked` count and distinct CRM Gmail-message-ID count must remain equal for the organized outreach set.

Any future organized outreach campaign must follow this invariant from its first send.