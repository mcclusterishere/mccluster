# End Racism two-path campaign v1

## Purpose

Use a provocative joke to route people into measurable anti-racism action without granting permission to harass anyone or having Action label a person racist.

The campaign asks one deliberately blunt question:

**PROVE YOU'RE NOT RACIST.**

A participant chooses one of two paths. Action records the choice and what happens next; it does not infer a person's beliefs.

## Path A — Prove it

The participant chooses **PROVE IT** and receives the End Racism mission sequence.

Progress is earned only through verified mission completions. Payment, posting volume, likes, referrals, political agreement, or demographic identity cannot substitute for proof.

Suggested public progression:

- 1 verified mission — Started the Work
- 5 verified missions — I Did the Work
- 10 verified missions — End Racism challenge complete
- 25 verified missions — eligible for the relevant Action fellowship review, subject to the fellowship's separate requirements

The shareable object is a normal Action Receipt showing verified actions. It is evidence of completed work, not a platform declaration that a person is incapable of racism.

## Path B — Self-declare + Racist Tax

The participant may instead choose **NO. I'M RACIST.**

This creates a satirical, explicitly voluntary status:

**SELF-DECLARED: VERIFIED RACIST™**

The word **SELF-DECLARED** is mandatory anywhere the status is rendered. Action must never assign this status from behavior, demographics, reports, moderation outcomes, mission failures, or an algorithm.

The participant may then make an optional **Racist Tax™** contribution to the End Racism initiative. The contribution is a donation/support transaction; it buys no exemption, permission, moderation privilege, mission credit, points, or authorization to use slurs or harass anyone.

Suggested receipt copy:

**RACIST TAX PAID**
Thank you for accidentally funding the End Racism Initiative.

Payment amount is never used as a reputation score.

## Redemption loop

Every self-declared screen includes **CHANGE MY MIND / DO THE WORK**.

A self-declared participant can enter the same mission sequence at any time. Completing the campaign threshold changes the current campaign state to **DID THE WORK** while preserving the audit history of the participant's own earlier selection.

Public presentation should emphasize the current earned state rather than permanently stigmatizing the participant.

Example:

**SELF-DECLARED → DID THE WORK → 10 VERIFIED ACTIONS**

## State model

Campaign participation uses explicit states:

- `unselected`
- `action_path`
- `self_declared_path`
- `did_the_work`

Store an append-only transition ledger in addition to the current state.

Every transition records actor, timestamp, source, and campaign version. A user may choose either initial path. `self_declared_path → action_path` is always allowed. `did_the_work` is awarded only by the verified-action threshold transaction.

## Data and safety rules

1. Never infer or algorithmically assign the racist label.
2. Never expose a private selection as public without an explicit public-display choice.
3. Never allow another member or administrator to self-declare on somebody else's behalf.
4. No slur permission, harassment waiver, discrimination waiver, or moderation exemption exists.
5. Racist Tax payments award zero Action points and zero mission completions.
6. Mission verification follows the normal Action proof/review system.
7. Demographic identity never determines eligibility or scoring.
8. Rejected proof must not be represented as evidence that a participant is racist.
9. Allow a participant to stop publicly displaying the satirical status without deleting the audit ledger.
10. Campaign copy must distinguish satire from an institutional factual finding.

## Funnel

`campaign link → PROVE YOU'RE NOT RACIST → choose path`

Action path:
`mission → proof → review → verified action → Action Record → Action Receipt → next mission`

Self-declared path:
`voluntary self-declaration → optional Racist Tax → satirical receipt → CHANGE MY MIND → mission sequence`

Both paths ultimately route resources or participation toward the End Racism initiative, but only completed verified missions create Action reputation.

## Implementation gate

Do not deploy the campaign tables until the core Mission Engine migration is production-ready. The campaign must reference the canonical mission/assignment/points primitives rather than inventing a parallel reward system.
