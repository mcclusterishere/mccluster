# Site-wide analytics and retention audit — 2026-10-11

Source: live Supabase public.events, 14-day window ending 2026-10-11; queries executed against project zmnhbrjyhxzhkxmhkexs. Counts are recorded events, not people. No IP or individual visitor details included.

## Baseline
- 1,726 page_view events; 612 distinct session IDs; 339 single-page sessions (55.4%).
- 367 sessions with album_play, song_start, music_play or music_full_play (60.0%).
- 91 sessions with a device ID observed on a page view before the 14-day window (14.9%); **not** verified person-level retention.
- Mean observed first-to-last event span: 138 seconds.
- Top page views: album.html 981, account.html 257, index.html 147, listen.html 137, mnet.html 80.
- Acquisition events: ig/social 289; specifically tagged Instagram trial reel 23; direct/none 58; Google referral 1.
- October 3 spike: 122 distinct page-view sessions, 320 views; Instagram dominant among acquired events.

## Friction
- 424 dead_click events in 76 sessions; false positives known for fields, current-page links and playback. Do not use raw count as verified broken controls.
- Account: 286 dead-click/rage-click/JS-error events in 35 sessions. signup_blocked: 3 server_429 and 1 missing_region in 14 days.
- Album: 58 friction events in 24 sessions. Play/seek/locked states need real-device testing.
- Mnet: 63 friction events in 19 sessions. Music tab/button and mission controls need interaction tests.
- JS errors: injected Instagram browser autofill callback dominates observed errors; isolate from application-owned exceptions.

## Priority actions
1. P0: Instrument explicit signup_started/succeeded/failed events; separate auth rate limits from client validation. Preserve signup state and show clear retry guidance. Never bypass server rate limits.
2. P0: Real-device album playback and account registration smoke tests; verify audio state transitions and CTA feedback in Instagram in-app browser.
3. P1: Fix rage/dead-click classifier to correlate repeated taps with the same actionable element, not merely close coordinates; exclude inputs and browser-injected errors from product defect metrics.
4. P1: Album-to-fan retention funnel: play -> follow/save -> optional account creation -> first return; measure each step before claiming lift.
5. P1: Artist profile traffic: privacy-safe page views, approximate sessions, aggregated sources, daily trends; never expose visitor identities or IPs.
6. P2: Cohort reporting by acquisition source and campaign; distinguish anonymous device-history from verified user retention.
7. P2: Experiment CTA language and position on album pages; compare downstream qualified conversions and guardrails, not just clicks.

## Measurement acceptance
- Report sessions, people, and events separately.
- Attribute campaigns only when a source is recorded; unknown stays unknown.
- Compare 7/14/30-day cohorts on identical event definitions.
- Exclude bot traffic and duplicate telemetry where validated.
- Do not classify single-page listening sessions as bounce without engagement measurement.
- Every P0 fix requires passing CI and browser/device interaction tests before merge.
