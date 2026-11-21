# Music Intelligence Lab — Second-by-second experience research (October 2026)

## Research baseline
Temporal song skipping has been studied by Spotify researchers (Montecchio, Roy, Pachet, PLOS ONE 2020, doi:10.1371/journal.pone.0239418). It is **not novel** to analyze skip positions. Media Session supports media controls but browser support varies (W3C Media Session 2026, https://www.w3.org/TR/mediasession/). Facial movements cannot reliably reveal inner emotional states without context (Goel et al., Nature Communications 2024, doi:10.1038/s41467-024-46670-5). Novelty claims need a documented prior-art search, independent validation and a precise contribution.

## Proposed new research capabilities
1. **Beat/lyric/scene-aligned exposure graph**: immutable versioned timeline with intervals for stems, beat drops, lyric tokens, scene objects, CTA and sponsor opportunities. Align client media-clock intervals, not wall time.
2. **Counterfactual room laboratory**: consented A/B assignment of 15-second interactive rooms; prespecified primary outcomes, holdouts, sequential-testing correction, confidence intervals and novelty decay over repeat visits.
3. **Exposure-qualified retention**: actual forward timeline coverage, replay-weighted listening, skip hazard per second, background playback distinction, stalls, seeks and ad interruption penalties. Treat every metric as observational until delivery verified.
4. **Attention-by-action, not mind reading**: user-triggered interactions, pointer/gaze *direction* only when explicitly opted into tracking, time on objects, voluntary reaction prompts. No inference of emotions, vulnerabilities or personality from face geometry.
5. **Causal event replay**: owner-only reconstructed timeline of anonymized events (not camera recording), with precise sequence, clock drift, dropped packet and browser quality indicators. Debug why an experience failed without exposing an individual's identity.
6. **Adaptive creative orchestration**: bandit-style scene selection only after randomized experiments establish safety and validity; optimize experience satisfaction and voluntary completion, not compulsive engagement.
7. **Ad-load experimentation**: compare sponsor-supported room versus pre-roll and no-ad holdout; measure listener loss, replay, membership application and verified ad revenue. No ad billing from client-only telemetry.
8. **Voluntary reaction studio**: separate informed opt-in, preview and stop/erase controls; camera frames processed locally for visual effects by default; video/audio recording disabled by default and never inferred from camera permission. Independent, revocable consent for storing participant recordings. Face-login enrollment strictly isolated from music research.

## Instrumentation architecture
Client: single event envelope {schema_version,session_id,playback_id,sequence,track_id,track_version,scene_id,scene_version,event_name,media_time_ms,monotonic_time_ms,observed_listen_ms,coverage_intervals,consent_scope,device_capabilities}. Batch with bounded memory, flush on pagehide using sendBeacon where appropriate. Deduplicate by (playback_id,sequence). Server: authenticated/anonymous rate-limited ingress, explicit schema validation, append-only partitioned events, aggregate in 1s/5s/15s windows, confidence/coverage ledger, RLS owner-only views. No raw biometric templates in analytics.

## Accuracy test cases
Seek forward/back, repeated loop, playback rate 0.5/2x, autoplay denial, media stalls, offline queue, hidden-tab legitimate audio, lockscreen, interrupted audio, multi-tab concurrent play, Safari throttling, blocked analytics, clock drift, dropped batches, device mute, ad blocker, no consent. Golden synthetic fixtures with known expected listened duration and exact coverage intervals.

## Release gates
- Gate A: existing engine events reliably reach server and are stored.
- Gate B: exact-duration synthetic fixtures and reconciliation tests pass.
- Gate C: per-track retention dashboard owner-only, with denominator and missingness.
- Gate D: scene event versioning, experiments, and outcome analytics.
- Gate E: opt-in reaction research and independent privacy/security review.

## Explicit non-goals
No covert video/audio surveillance, no repurposing face login templates for analytics, no automatic emotion classification, no claims of identifying an individual's mental state. Do not call untested features production-ready.
