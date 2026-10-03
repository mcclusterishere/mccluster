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

**SELF-DECLARED: CERTIFIED RACIST™**

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


## V1 profile badge — Certified Racist™

For the first release, replace recurring Racist Tax subscription mechanics with a single satirical self-declared profile badge:

**CERTIFIED RACIST™**
**SELF-DECLARED**

The badge is never earned by an algorithm, moderation decision, administrator judgment, demographic attribute, failed mission, or third-party report. It becomes eligible only after the member personally chooses the self-declared path.

The member controls whether it appears on their public front profile.

### I Changed My Mind

A member with the self-declared badge can choose **I CHANGED MY MIND** from their own profile controls.

That action:
- stops presenting Certified Racist as the member's current campaign state;
- preserves the append-only state-transition audit history;
- can route the member directly into the End Racism mission sequence;
- does not fabricate mission completion or verified-action credit;
- may support a separate current-state presentation such as **I CHANGED MY MIND**.

Changing public presentation is not deletion of the underlying audit event.

## Member-controlled front-profile badges

Action profiles need a member-owned badge manager. A member can:

- see badges they are eligible to display;
- show or hide each optional public badge;
- reorder displayed badges;
- preview the front-profile presentation;
- change self-declared campaign presentation through an allowed state transition;
- distinguish earned/verified badges from self-declared/satirical badges.

A member cannot grant themselves an earned or verified badge. Eligibility for verified badges comes from the canonical Action ledger or other authoritative product contract.

Suggested badge provenance classes:

- `verified_action` — derived from verified missions;
- `skill` — derived from verified skill progression;
- `fellowship` — awarded through the fellowship contract;
- `self_declared` — member-selected identity/campaign satire;
- `system` — product/account milestones that do not imply mission verification.

Public badge rendering must expose provenance sufficiently to prevent a self-declared badge from being mistaken for an Action-verified factual judgment.

### Authorization

Only the member may change their optional public badge visibility/order or invoke their self-declared **I Changed My Mind** transition through ordinary profile controls.

Administrative tooling may moderate content or disable an abusive presentation under the platform's moderation rules, but must not assign **Certified Racist**, reverse **I Changed My Mind**, or make a private self-declaration public on a member's behalf.


## Campaign page v2 — the joke underneath the joke

The canonical public route remains `end-racism.html`. The campaign slug remains `end-racism`. CIA Mind Control remains the record attached to the gateway, and the Action Network remains the action destination. This revision changes the campaign narrative without breaking the existing inbound or outbound funnel.

### Certified Racist™

The public joke is now **CERTIFIED RACIST™**, always paired with **SELF-DECLARED** in explanatory copy. The contradiction is intentional: a participant who voluntarily chooses the racist path discovers that "certification" comes with paperwork, accountability, community-service missions, and proof.

The platform still does not determine that somebody is racist. No administrator, report, classifier, demographic attribute, moderation result, failed mission, or model may assign the status to another person.

Suggested institutional satire:

- Department of Racial Consistency
- Form ER-001
- probationary standing
- continuing-education requirements
- "Racism has paperwork."
- "We don't discriminate against racists. Unlike racists."

The joke never creates an exemption from ordinary moderation or conduct rules.

### Get the Wiggers Out of the Street™ / Wigger Recovery Program

The **Wigger Recovery Program** is a satirical mission track about cultural appropriation and contradiction: consuming or imitating Black culture while disrespecting Black people.

Within this campaign, **wigger** names that behavior pattern. It is not a racial classification, and Action must not label a person with it based on skin color, ancestry, appearance, music taste, clothing, speech, location, or third-party reports.

The campaign line is:

**GET THE WIGGERS OUT OF THE STREET™**

"Out of the street" is campaign satire about retiring the performance, not removing people from public space. The mission objective is not to make somebody "act white." The objective is to stop treating Blackness as a costume while still allowing people to enjoy, participate in, and learn from culture respectfully.

Suggested recovery sequence:

1. **Trace the source** — identify the artists, communities, scenes, inventors, or traditions behind something the participant uses or imitates.
2. **Say the names** — publicly attribute the source accurately.
3. **Support the source** — contribute time, money, labor, attention, access, or another concrete resource.
4. **Retire the costume** — stop caricature or identity performance while retaining genuine cultural appreciation.
5. **Bring proof** — submit evidence through the canonical Action mission/proof system.

These are campaign-content concepts. If implemented as scored missions, they must use the canonical mission, assignment, proof, review, and points primitives. The campaign page itself does not fabricate completion.

### Human-race reveal

The satire resolves with a second meaning of "racist":

**CERTIFIED RACIST AGAINST THE HUMAN RACE**

The factual anchor is narrower and deliberate: there is one living human species, **Homo sapiens**. Human racial categories are social classifications; they do not divide people into separate human species.

The reveal reframes the joke as criticism of humanity's own record — war, slavery, genocide, exploitation, pollution, tribalism, and other human-made harms — while ending in a universal membership rule:

**Membership is automatic. Discrimination is prohibited. Self-criticism is encouraged.**

The campaign's final action remains constructive. Participants are routed into the same End Racism Action Network campaign regardless of which joke path brought them there.
