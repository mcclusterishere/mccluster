# Audience Science

Status: **measurement layer v1**.

Audience Science turns first-party behavioral telemetry into reproducible features.
It does not infer protected traits, ideology, mental health, personality, or motive.

## Why this exists

A raw play is an implicit-feedback event, not a direct statement of preference.
People can click or replay because of preference, curiosity, exposure, novelty,
autoplay, outrage, a meme, or a referral. The backend therefore records what
was observed and keeps inference limits explicit.

The system follows this progression:

1. **Measurement** — transparent behavioral features from first-party events.
2. **Probabilistic segmentation** — latent-class / finite-mixture models only
   after model-selection and stability checks exist.
3. **Longitudinal state modeling** — HMM/state-transition models only after
   enough repeated observations exist.
4. **Causal experiments** — randomized treatments before claiming that a page,
   CTA, context treatment, or recommendation caused a behavioral change.

V1 implements step 1 and deliberately keeps steps 2–4 disabled.

## Canonical unit

Signed-in activity is keyed to the authenticated user when an event-to-device
bridge exists. Otherwise first-party activity is keyed to the consented
device identifier. Events without a device identifier are counted by aggregate
analytics but are not stitched into a person-level Audience Science profile.

No IP/user-agent fingerprint is used to manufacture an identity.

## Music attention distribution

For one visitor, let n_i be observed starts for track i, N the total starts,
p_i = n_i / N, and k the number of distinct observed tracks.

Dominant-track share: D = max(p_i)

Herfindahl concentration: HHI = sum(p_i^2)

Shannon entropy: H = -sum(p_i * ln(p_i))

Normalized entropy: H_n = H / ln(k), for more than one observed track.

Effective catalog size: N_eff = exp(H)

Repeat ratio: R = (N - k) / N

These are observations about attention, not diagnoses of motive.

## V1 behavior signals

Signals are **overlapping descriptors**, never exclusive personas.

- concentrated_attention: at least 5 observed music starts and dominant share at least 0.80.
- broad_exploration: at least 4 tracks and normalized entropy at least 0.65.
- repeat_listening: at least 4 starts and repeat ratio at least 0.50.
- deep_listening: at least 2 starts and observed completion rate at least 0.50.
- returning: at least 2 sessions or 2 active days.
- action_engaged: at least one first-party Action event.
- converted: at least one account/checkout conversion event.

The thresholds are operational descriptors, not validated psychological cut
points. They remain versioned in code so later empirical calibration can replace
them without rewriting history.

A one-play listener is explicitly **not** called concentrated even though the
mathematical dominant share is 1.0. The evidence count travels with every
profile.

## Exposure problem

Observed attention is not equivalent to preference.

If a visitor was shown only one track, a 100% dominant share contains little
information about selection. The current event model does not yet record every
track impression/opportunity, so V1 does not claim exposure-adjusted preference.

A later instrumentation step should record recommendation/shelf impressions with
position and eligible alternatives. That allows propensity/exposure correction
rather than treating availability as choice.

## Model readiness

The endpoint reports a model_readiness object. V1 always reports measurement
stage with latent-class and state-transition modeling disabled.

We do **not** enable an LCA/HMM just because a row count crosses an arbitrary
number. Promotion requires:

- defined training and holdout windows;
- missingness analysis;
- feature scaling and collinearity checks;
- candidate-class/state comparison;
- information criteria where appropriate;
- bootstrap / resampling stability;
- minimum class support;
- out-of-sample predictive checks;
- drift monitoring;
- human review of whether a statistical class has a coherent behavioral interpretation.

The human-readable name is applied only after the statistical class exists.

## Causal claims

Clustering and sequence models find patterns; they do not establish causality.

Questions such as "does context around a provocative track make listeners
explore the album?" should be answered with a randomized experiment when
feasible. Treatment assignment, outcome definition, exclusions and analysis
must be specified before reading the result.

## Privacy / prohibited inference

Audience Science may summarize first-party product behavior for product and
content analytics. It must not produce fields such as:

- race / ethnicity;
- religion;
- sexual orientation;
- medical or mental-health condition;
- political affiliation or ideology;
- racist / not racist;
- criminality or dangerousness;
- inferred personality diagnosis.

The correct representation is behavioral evidence such as:

- 88% of observed music starts were one track;
- effective catalog size was 1.3;
- visitor returned on 3 days;
- no context/Action event was observed.

That remains useful without pretending telemetry can read a person's mind.

## API

Owner-only endpoint:

GET /v1/analytics/audience-science?since=<ISO>&until=<ISO>

The read window is capped at 31 days. The response contains:

- methodology and formula definitions;
- totals;
- behavior-signal counts;
- per-track affinity/concentration;
- per-visitor feature profiles;
- model-readiness status.

Control exposes the result under **Analytics → Audience**.

## Scientific lineage

The design deliberately uses established measurement families rather than an
LLM-created personality taxonomy:

- Shannon entropy / effective-number transformations for diversity.
- Herfindahl-style concentration for distribution concentration.
- Implicit-feedback recommender-system principle: observed interaction is noisy evidence, not an explicit preference rating.
- Latent class / finite-mixture modeling for future probabilistic segmentation.
- Hidden Markov / latent-transition models for future longitudinal states.
- Randomized experiments / causal inference for claims about treatment effects.

The implementation should keep those layers separate: measurement must remain
inspectable even if later statistical models change.
