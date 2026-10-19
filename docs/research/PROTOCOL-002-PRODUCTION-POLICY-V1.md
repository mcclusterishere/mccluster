# Protocol 002 — Production Experience Policy v1

Status: implementation candidate  
Date: 2026-10-06  
Research program: McCluster Adaptive Experience Research Lab  
Depends on: Experience Evidence Plane v1 + MCC_MODEL compatibility adapter

## Research question

Can a deterministic, explainable recommendation policy improve useful next-step
ordering across McCluster's first three adaptive surfaces while preserving user
agency, diversity, reversibility, and valid exposure measurement?

Initial surfaces:

- `global.for_you`
- `music.next_step`
- `action.next_step`

## Why deterministic first

The evidence plane is new. A contextual bandit or learned sequential model would
add exploration and estimation error before the platform has accumulated enough
clean opportunity/exposure data to validate the simpler baseline.

Production Policy v1 therefore uses:

1. a bounded deterministic relevance score;
2. explicit user preference as a separate signal;
3. recent first-party behavioral evidence;
4. fatigue suppression;
5. novelty;
6. a small server-owned business-priority term;
7. diversity reranking after the base score.

No training job, embedding model, LLM call, latent psychological label, protected
trait, or random exploration is used in the hot path.

## Feature contract

Only these classes of information may influence v1:

### Editorial prior

The caller's original position. This preserves a bounded amount of product
judgment and gives a sensible cold-start baseline.

### Recent affinity

A time-decayed aggregate of observable first-party events from the preceding
14 days. Exact prior candidate interactions carry more evidence than broad
domain matches.

Examples include:

- decision-linked interaction/outcome;
- meaningful music/listen events;
- Action mission/campaign interaction;
- saves and completions;
- ordinary page/view events at a lower weight.

Raw event rows are not copied into the feature snapshot. The snapshot stores
aggregate candidate features only.

### Explicit preference

A member-controlled `more` or `less` value stored in
`experience_preferences`.

Explicit preference is intentionally separate from inferred behavior. A person
saying "show me less of this" is not converted into a psychological label and
does not rewrite their historical telemetry.

### Novelty

A deterministic inverse of recent candidate visibility. Unseen candidates
receive more novelty value.

### Fatigue

Repeated visible exposures without an interaction/outcome/dismissal create a
penalty. Fatigue is capped.

### Business priority

A server-owned surface configuration. It is capped at five percent of the base
score in v1.

It may express product sequencing (for example, which owned music destination
is most strategically useful) but **must not encode a paid sponsorship or
material commercial connection**.

## Production weights

Current v1 weights:

| Component | Weight |
| --- | ---: |
| Editorial prior | 0.20 |
| Recent first-party affinity | 0.35 |
| Explicit preference | 0.30 |
| Novelty | 0.10 |
| Business priority | 0.05 |

Fatigue is a subtraction after weighted scoring:

- 0.12 per unanswered visible exposure;
- capped at 0.48.

These values are product-policy parameters, not scientific constants. Any
change requires a policy-version change or documented configuration revision.

## Diversity reranking

After base scoring, candidates are selected greedily. A candidate receives a
temporary penalty when it repeats dimensions already selected:

- same domain: 0.12;
- same kind: 0.06;
- same topic: 0.08.

This is intentionally simple and auditable. It is an MMR-like diversification
step, not a learned diversity model.

## Stability

A valid decision may be reused for 30 minutes when:

- subject hash is the same;
- surface is the same;
- policy is the same;
- no experiment is active;
- eligible candidate IDs/order are identical;
- requested slate size is identical.

This prevents the interface from reshuffling on every repaint.

## Decision record

Every newly computed production decision records:

- subject hash;
- surface;
- policy/version;
- eligible candidates;
- selected candidates and final positions;
- deterministic propensities;
- feature snapshot ID;
- objective weights;
- reason codes;
- expiry.

Feature snapshots record only aggregate v1 features and event count/window.

## User agency

Signed-in members can choose:

- More like this
- Less like this

The preference API is authenticated and keyed by canonical `m_uid`.

Preference memory is revocable and inspectable. Anonymous visitors are not
given server-side explicit preference memory in v1.

## Excluded features

Production Policy v1 MUST NOT use:

- race or ethnicity;
- religion;
- sex, sexual orientation, or sex life;
- health or disability status;
- political ideology or affiliation;
- criminality/dangerousness inference;
- "racist/not racist" inference;
- inferred personality diagnosis;
- precise address/location;
- raw IP address;
- sponsorship payment amount;
- material commercial relationship;
- arbitrary legacy MCC_MODEL persuasion/archetype labels.

## Corporate/creator partnerships

A song may carry a `music_credit_destination` linking an artist/record to a
network organization or partner surface.

Supported relationship labels include:

- credit;
- brand partner;
- sponsor;
- campaign partner;
- affiliate;
- client.

A material commercial connection requires disclosure text.

The shared music engine may display that disclosed relationship and route the
listener to the partner's canonical McCluster group or product page.

**A paid relationship never adds recommendation score in Production Policy
v1.** Placement and sponsorship are separate systems.

This separation makes later research possible: provider/business utility can be
measured without contaminating the user-relevance label.

## Heat Chart case

The Heat Chart is the first satellite-product bridge.

Architecture:

- canonical social/community identity: McCluster `m_uid`;
- broad network room: `mnet.html?group=heat-chart`;
- specialized product: `https://theheatchart.com`;
- existing `heat-chart-authenticity` room remains the authenticity service,
  not the umbrella community;
- the Mnet room links out to The Heat Chart;
- The Heat Chart links back to its Mnet room.

The current Heat Chart NextAuth/Prisma account is not falsely represented as
already unified with `m_uid`. Full SSO/account reconciliation is separate
work.

## Metrics

Primary product metrics depend on surface.

### Global For You
- destination interaction;
- downstream meaningful action/listen/client conversion;
- return session.

### Music next step
- additional meaningful track starts;
- completion;
- catalog breadth/effective catalog size;
- return listening.

### Action next step
- campaign open;
- mission selection;
- assignment creation;
- verified completion.

## Guardrails

- dead/rage clicks;
- page/player errors;
- latency;
- exposure concentration;
- catalog diversity;
- explicit "less" rate;
- abandonment;
- invalid/duplicate Action state;
- partner-disclosure visibility.

CTR alone is not a success criterion.

## Rollback

`control-order@v1` stays in the policy registry.

The production router prefers `production-mature@v1` only while it is enabled.
Disabling that row returns production to caller order without a client release.

Unsupported research algorithms still fail closed to the production policy.

## Research progression

PR C establishes the mature deterministic baseline.

Next:

- PR D: replay/shadow/A-B Research Lab workflow;
- PR E: bounded randomized exploration/contextual-bandit research policy.

A learned or stochastic production policy must demonstrate improvement against
this baseline with uncertainty and guardrails, not merely outperform it on CTR.

## Research basis

Canonical source details live in `data/research/references.json`.

Key sources for this protocol:

- Parapar & Radlinski — unified accuracy/diversity metrics;
- Xu et al. — surrogate for long-term user experience;
- Chen et al. — values of exploration;
- Zhan et al. — provider-aware recommendation utility;
- Joachims et al. — biased-feedback/counterfactual learning;
- Li et al. — contextual bandits;
- FTC endorsement/material-connection guidance;
- Schema.org MusicRecording sponsorship metadata.
