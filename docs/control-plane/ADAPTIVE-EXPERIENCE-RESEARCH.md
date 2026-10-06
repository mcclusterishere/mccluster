# Adaptive Experience Research Architecture

Status: research-to-build contract after Audience Science v1.

This document grounds the next McCluster personalization layer in the current
repository and in the mature + emerging recommender/adaptive-interface literature.

The goal is not "more personalization." The goal is a measurable adaptive system
that can improve the user experience over time without confusing correlation with
preference, experiments with production truth, or novelty with evidence.

## 1. Current McCluster baseline

The repository already has four pieces that should be reused rather than replaced.

### First-party event spine

`js/analytics.js` + `MCC_TRACK` + the collector already capture first-party
page, click, attention, acquisition, music, Action, friction, device/session and
authenticated-account context after the privacy gate.

The event taxonomy and analytics hotpaths already distinguish view/content/
engagement/conversion/ops events.

### Audience Science

`workers/mccluster/src/analytics/audience-science.js` now derives transparent
behavioral features including:

- dominant-track share;
- Herfindahl concentration;
- Shannon / normalized entropy;
- effective catalog size;
- repetition;
- completion;
- returns;
- Action engagement;
- conversion evidence.

This is measurement, not motive inference.

### Existing local personalization

`window.MCC_MODEL` in `js/analytics.js` is already a primitive adaptive
experience engine. It:

- maps events to six hand-authored interest domains;
- adds arbitrary 1-3 weights;
- applies a 14-day decay;
- tracks recommendation shows and taps;
- suppresses fatigued recommendations;
- selects a next-best page;
- chooses "scarcity / mission / proof / belonging" persuasion framing.

This is useful compatibility surface, but it is not a scientifically defensible
decision engine. It has no server-side decision ledger, no candidate exposure
record, no propensity, no policy version, no stable experiment assignment, and
no causal evaluation contract.

### Existing AI-call experiments

`supabase/replay_migrations/0029_experiments.sql` provides deterministic
experiment assignment and per-arm scoreboards for AI calls. It is the right
historical precedent, but it is scoped to AI voice/model/effort rather than
website experience.

Do not overload `ai_experiments` into product-experience experiments.

## 2. Research lineage

### Mature foundations to treat as production-grade concepts

- Adaptive hypermedia: maintain a user model and adapt content/navigation to
  goals/context (Brusilovsky, 1996).
- Item-to-item collaborative filtering for scalable real-time recommendation
  (Amazon, 2003).
- Matrix factorization / latent factors, implicit feedback, temporal effects and
  confidence (Koren, Bell & Volinsky, 2009).
- Contextual bandits for exploration/exploitation and logged-policy evaluation
  (Li, Chu, Langford & Schapire, 2010).
- Candidate generation + ranking as distinct serving stages (YouTube, 2016).
- Counterfactual / propensity-weighted learning from biased implicit feedback
  (Joachims, Swaminathan & Schnabel, 2016).
- Sequential recommendation: recent order matters, not only aggregate totals
  (SASRec 2018 and successors).
- Long-term slate optimization / simulation for sequential interaction
  (SlateQ + RecSim, 2019).
- Dynamic latent relationship states via hidden Markov models, with holdout
  validation (Netzer, Lattin & Srinivasan, 2008).
- Variance-reduced online experiments using pre-experiment covariates (CUPED
  and modern CUPAC-style extensions).

### 2024-2026 frontier relevant to this repository

- HSTU / Generative Recommenders: treat long user action histories as sequential
  transduction rather than a bag of features.
- Semantic IDs: represent heterogeneous items through hierarchical semantic
  tokens instead of only opaque UUIDs.
- GenPage (Netflix, RecSys 2026): generate a constrained structured multi-row
  homepage from user/request context; richer context was more valuable than
  simply increasing model size in the reported regime.
- UniPinRec (Pinterest, RecSys 2026): share a user representation across
  generative retrieval and ranking.
- Epistemic Recommendation / EGRec (RecSys 2026): occasionally recommend the
  item whose outcome would reduce uncertainty about the user, not merely the
  item with the highest predicted engagement.
- ConAlign (Kuaishou, RecSys 2026): retain a small unbiased/random traffic
  stream to reduce observational bias and interest collapse while preserving
  production performance.
- Whole-page-aware optimization: optimize screen/page outcomes, not isolated
  item CTR.
- Personalized generative UI (2026): learn presentation preference from sparse
  pairwise feedback rather than assuming one universal UI rubric.
- User-governed preference memory / calibrated initiative (RecSys 2026):
  explicit preference memory should be inspectable, steerable and revocable.
- Inverse-Theory-of-Mind recommendation (RecSys 2026): reconstruct the decision
  context and maintain competing hypotheses about why behavior occurred.
  This is research-only for McCluster; never convert speculative hypotheses
  into authoritative psychological or protected-trait labels.
- Self-evolving recommendation systems (RecSys 2026): offline agents generate
  candidate model changes; online slow loops validate them against delayed
  north-star metrics before production launch.
- Network-interference-aware experimentation (RecSys 2026): when treatments
  can spill through a social graph, randomize/estimate at graph-cluster level
  rather than pretending users are independent.

## 3. Target architecture: two independent experience planes

There must be a hard boundary between "validated enough to run the product" and
"interesting enough to study."

### A. Production Experience Plane

Only promoted, versioned policies may affect the default experience.

The production plane owns:

1. canonical feature/profile read;
2. surface registry;
3. eligible-candidate generation;
4. business / safety constraints;
5. stable production policy;
6. decision ledger;
7. exposure + outcome attribution;
8. fatigue/diversity control;
9. explicit user preference memory;
10. rollback.

Initial production policy should be intentionally conservative:

- deterministic eligibility rules;
- Audience Science features;
- declared preferences;
- recent-session state;
- diversity / novelty floor;
- fatigue suppression;
- stable layout decisions for a bounded TTL;
- simple calibrated scoring;
- no protected-trait inference;
- no opaque psychological persuasion labels.

A contextual bandit can be promoted into production only after the experiment
plane demonstrates a reliable gain with guardrail metrics intact.

### B. Research Lab Plane

The Research Lab is a separate policy namespace. It can evaluate emerging
methods without silently becoming product truth.

Modes:

1. **offline** — replay logged decisions / simulate;
2. **shadow** — make a decision but do not alter the user experience;
3. **ghost comparison** — compare emerging policy choice to production choice;
4. **live low-risk** — randomized treatment on approved low-risk surfaces;
5. **opt-in frontier** — generative or highly dynamic UI only for users who
   explicitly choose experimental experiences;
6. **promoted** — only after evidence and review; policy is copied/versioned into
   the Production Experience Plane.

Research Lab policies may include:

- LinUCB / Thompson-sampling contextual bandits;
- epistemic-gain recommenders;
- diversity/debiasing policies using unbiased traffic;
- latent-class segmentation;
- HMM / latent-transition journey states;
- sequential Transformer/HSTU-style user encoders;
- semantic-ID retrieval;
- generative page composition;
- learned UI preference models;
- self-evolving offline policy search;
- inverse-Theory-of-Mind hypothesis generation in shadow mode only.

## 4. The most important missing data: opportunity / exposure

Current analytics records a great deal about what visitors do. It does not
consistently record the full set of alternatives the system made available.

Without opportunity logging, "clicked X" cannot distinguish:

- X was the only visible choice;
- X was ranked first among 20 choices;
- X was deliberately searched for;
- X was exposed repeatedly by the old algorithm.

Every adaptive surface must therefore create a server-authoritative decision
record before rendering.

Minimum decision contract:

- decision_id;
- subject key (canonical user when available, otherwise consented device key);
- session_id;
- surface_id;
- surface version;
- policy_id + policy_version;
- experiment_id + arm, when applicable;
- assignment unit;
- feature_snapshot_id;
- eligible candidate IDs;
- selected candidate IDs;
- ordered positions;
- probability / propensity of each selected action when randomized;
- reason codes;
- objective weights;
- constraints applied;
- created_at;
- expires_at.

Client events then reference the decision_id:

- experience_impression;
- experience_visible;
- experience_interaction;
- experience_dismissed;
- experience_outcome.

This is the foundation required for propensity correction, unbiased offline
evaluation, bandits, epistemic exploration, whole-page modeling and causal
experiments.

## 5. Proposed schema

Use a forward migration. Do not rewrite existing applied migrations.

### Registry

`experience_surfaces`
- id
- key
- description
- risk_tier
- allowed_mutations
- enabled

`experience_policies`
- id
- key
- version
- plane: production | research
- mode: offline | shadow | ghost | live | opt_in | promoted
- algorithm
- config jsonb
- source_commit_sha
- enabled
- promoted_from_policy_id
- created_at

### Experiments

`experience_experiments`
- id
- key
- hypothesis
- primary_metric
- guardrail_metrics
- randomization_unit
- allocation
- start/end
- preregistration jsonb
- status
- owner

`experience_experiment_arms`
- experiment_id
- arm_key
- policy_id
- weight
- is_control

`experience_assignments`
- experiment_id
- subject_key_hash
- arm_key
- assigned_at
- assignment_version

Assignment must be server-side and stable. Use a deterministic cryptographic
hash/HMAC over experiment + subject + assignment salt, not client randomness.

### Decision / outcome ledger

`experience_feature_snapshots`
- id
- subject key hash
- feature schema version
- features jsonb
- created_at

`experience_decisions`
- decision_id
- surface_id
- subject key hash
- session_id
- policy_id
- experiment_id/arm
- feature_snapshot_id
- eligible_candidates jsonb
- selected_candidates jsonb
- propensities jsonb
- reason_codes text[]
- objective_weights jsonb
- created_at
- expires_at

Outcomes can remain on the canonical event spine if every relevant event carries
decision_id, policy, experiment and arm. Do not create duplicate analytics truth
unless a normalized decision-to-outcome materialization is needed for speed.

### Explicit preference memory

`experience_preferences`
- canonical person id
- namespace
- key
- value
- source: explicit | imported
- confidence
- created_at / updated_at / revoked_at

Observed behavior stays in Audience Science. Explicit user statements remain a
different evidence type.

## 6. Surface contract

A surface should not call a model directly.

Every adaptive surface calls one stable API:

`POST /v1/experience/decide`

Input:
- surface key;
- currently eligible candidates + semantic metadata;
- session context;
- constraints.

Server:
1. resolves canonical identity/device;
2. reads the current feature snapshot and explicit preferences;
3. resolves experiment assignment;
4. applies risk/eligibility constraints;
5. invokes production or assigned research policy;
6. stores decision + propensities;
7. returns an ExperienceDecision.

Response:
- decision_id;
- policy;
- experiment/arm;
- ordered modules/items;
- layout variant from an allowlist;
- copy/CTA variant from an allowlist;
- reason codes;
- TTL.

The browser renders only from the allowed component library. Even future
generative composition returns a constrained ExperienceSpec, never arbitrary
HTML/JS.

## 7. Surface risk tiers

### Tier 0 — safe for ordinary randomized experimentation

- ordering music cards;
- "continue listening" choice;
- related content;
- Action content discovery;
- creator/content recommendations;
- non-sensitive module ordering;
- visual density/layout variants inside the design system.

### Tier 1 — experiment with stronger guardrails

- CTA wording;
- onboarding sequencing;
- recommendation diversity/exploration;
- timing of nonessential prompts;
- creator/tool suggestions.

### Tier 2 — opt-in or human-reviewed frontier

- generated page composition;
- LLM-authored personalized explanatory copy;
- proactive agent interventions;
- long-horizon RL policies.

### Never experiment adaptively on

- legal/privacy disclosure;
- consent controls;
- account deletion;
- security/authentication;
- emergency/safety messaging;
- payment amount or hidden pricing;
- eligibility for civic benefits/services;
- targeting based on protected/sensitive inferred traits.

## 8. Experimental validity

A live experiment is not valid just because the dashboard shows different
numbers.

Every experiment needs:

- hypothesis before launch;
- primary outcome before launch;
- guardrails before launch;
- stable randomization unit;
- deterministic assignment;
- sample-size / minimum-support rule;
- exposure logging;
- treatment-compliance measurement;
- pre-period covariates;
- confidence intervals;
- novelty/ramp effects tracked over time;
- no peeking-based automatic "winner" promotion.

Use CUPED/CUPAC-style pre-experiment covariates to improve power where valid.

For social/network treatments where one user's treatment can affect another,
support cluster-level assignment and spillover-aware analysis rather than
ordinary iid user randomization.

## 9. Promotion pipeline

No emerging algorithm jumps directly into production.

State machine:

research_idea
→ offline_replay
→ shadow
→ ghost_compare
→ live_canary
→ randomized_trial
→ evidence_review
→ promoted
→ production
→ monitored
→ rollback_or_retain

Required promotion evidence:

- primary metric improves;
- guardrails do not degrade beyond limits;
- effect is not driven by one acquisition channel/device;
- adequate treatment exposure;
- acceptable confidence interval / posterior;
- no unexplained subgroup harm;
- latency/cost within budget;
- decision logging complete;
- reproducible code + config + commit SHA.

## 10. Control console

Add a first-class **Adaptive** area in Control, not a hidden debug page.

### Production
- active policy per surface;
- current version / commit;
- traffic served;
- objective metrics;
- fatigue/diversity health;
- rollback button;
- user preference-memory coverage.

### Research Lab
- experiment cards;
- hypothesis;
- algorithm family;
- stage (offline/shadow/live/etc.);
- traffic allocation;
- control/treatment arms;
- sample/exposure counts;
- primary outcome;
- guardrails;
- confidence / uncertainty;
- policy disagreement with production;
- promotion readiness.

### Decisions
For a selected session/visitor:
- feature snapshot;
- candidates eligible;
- candidates shown;
- order/position;
- policy;
- propensity;
- experiment arm;
- subsequent outcomes.

### Model readiness
- LCA readiness;
- HMM readiness;
- bandit readiness;
- semantic-ID readiness;
- sequential-model readiness;
- generative-page readiness.

Readiness should be criteria-driven, not "enough rows feels like enough."

### Replay
Given historical context:
- what production policy chose;
- what each research policy would have chosen;
- whether outcome labels are available;
- estimated counterfactual metrics where methodologically valid.

## 11. Analytics additions

Control → Analytics → Audience should gain an Experience subview:

- decision → impression → visible → interaction → outcome funnel;
- policy/arm comparisons;
- rank/position effects;
- exposure-adjusted track/content affinity;
- exploration vs exploitation share;
- diversity / catalog coverage;
- fatigue;
- novelty;
- recommendation regret/proxy regret where valid;
- long-term return by earlier policy exposure;
- experiment contamination / assignment integrity.

Do not mix raw treatment arms into one aggregate without making experiment
assignment visible.

## 12. Research contribution / export

If McCluster wants to contribute data to research, do not publish raw production
telemetry.

Build a separate de-identified research export pipeline with:

- experiment protocol + preregistration;
- schema/model/policy version;
- treatment assignment;
- candidate/exposure/outcome data needed to reproduce analysis;
- direct identifiers removed;
- no IP, email, phone, exact address or free text;
- experiment-specific pseudonymous subject IDs;
- coarse geography only when scientifically necessary;
- minimum-cell / disclosure review before export;
- documented consent/legal basis where required.

The scientifically valuable artifact is not "we collected lots of user data."
It is a reproducible logged-decision dataset where the treatment, propensity,
opportunity set, outcome and code version are known.

## 13. Repository changes required

### Replace / preserve

Preserve the public compatibility API of `MCC_MODEL` temporarily so existing
surfaces do not break, but change its implementation into a client for the
ExperienceDecision API.

Deprecate:
- hand-written regex domain scoring as decision authority;
- arbitrary fixed 1/2/3 behavioral weights as user truth;
- "which psychology closes this person" framing.

Retain local-device fallback only when the network decision service is
unavailable.

### Extend

- collector: accept decision/experiment context;
- event taxonomy: add experience decision/exposure/outcome events;
- events_lean: project decision_id, experiment_id, arm, surface, policy;
- Audience Science: ingest exposure/opportunity context;
- Control Analytics: Experience subview;
- Forensics: show decision + treatment context in journeys;
- native Action Network surfaces: consume the same experience API when adopted;
- music surfaces: first production pilot;
- Action discovery: second pilot;
- global "For You"/next-step surface: third pilot.

## 14. First build sequence

### PR A — Experience Evidence Plane
No personalization behavior change.

- schema/registry;
- decision IDs;
- stable assignment;
- exposure events;
- propensity logging;
- Control experiment/read views;
- tests.

### PR B — Compatibility adapter
- `MCC_MODEL.suggest/shown/profile` backed by the new service;
- preserve fallback;
- no generative UI.

### PR C — Production policy v1
- mature deterministic score;
- Audience Science + explicit preference inputs;
- diversity/fatigue constraints;
- music next-step + Action next-step + For You.

### PR D — Research Lab v1
- shadow policies;
- offline replay;
- stable A/B assignment;
- experiment dashboard;
- promotion state machine.

### PR E — First live research policies
- contextual-bandit treatment;
- unbiased/random exploration bucket;
- epistemic policy initially shadow, then low-risk canary only after replay.

### Later
- latent-class/HMM states;
- semantic IDs;
- unified sequential user encoder;
- generative constrained page composition;
- self-evolving offline policy search.

## 15. Non-negotiable scientific rules

1. Log what could have been shown, not only what was clicked.
2. Log propensities for randomized/adaptive policies.
3. Preserve a true holdout/control.
4. Separate declared preference from observed behavior.
5. Separate production policy from research policy.
6. Never infer protected/sensitive traits for targeting.
7. Never promote from offline metrics alone.
8. Never call correlation causal.
9. Never let an LLM invent experiment results.
10. Every decision must be attributable to a policy version and code commit.
11. Every user-facing adaptive decision must have a deterministic rollback path.
12. Experimental UI cannot bypass the design-system/safety constraints.

## 16. Research references

Foundational:
- Brusilovsky, "Methods and Techniques of Adaptive Hypermedia" (1996).
- Linden, Smith & York, "Amazon.com Recommendations: Item-to-Item Collaborative Filtering" (2003).
- Koren, Bell & Volinsky, "Matrix Factorization Techniques for Recommender Systems" (2009).
- Li, Chu, Langford & Schapire, "A Contextual-Bandit Approach to Personalized News Article Recommendation" (2010).
- Covington, Adams & Sargin, "Deep Neural Networks for YouTube Recommendations" (2016).
- Joachims, Swaminathan & Schnabel, "Unbiased Learning-to-Rank with Biased Feedback" (2016).
- Kang & McAuley, "Self-Attentive Sequential Recommendation" (2018).
- Ie et al., "SlateQ" and "RecSim" (2019).
- Netzer, Lattin & Srinivasan, "A Hidden Markov Model of Customer Relationship Dynamics" (2008).

Frontier:
- Zhai et al., "Actions Speak Louder than Words: Trillion-Parameter Sequential Transducers for Generative Recommendations" (HSTU, 2024).
- ACM RecSys 2026 Session 1: Semantic IDs & Generative Interfaces.
- ACM RecSys 2026 Session 2: Long-Horizon Sequential Recommendation and EGRec.
- ACM RecSys 2026 Session 3: User Agency, Preference Memory and Inverse Theory of Mind.
- ACM RecSys 2026 Session 4: ConAlign, self-evolving recommendation and agentic push systems.
- ACM RecSys 2026 Session 7: spillover-contained social experimentation.
- ACM RecSys 2026 Session 8: Netflix GenPage and Pinterest UniPinRec.
- Peng et al., "Efficient Personalization of Generative User Interfaces" (2026).
