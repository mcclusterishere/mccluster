# Creator report-card analytics: measurement contract (research-backed)
Status: research and schema staged. No claim of live end-to-end attribution.

## Metric families and precise definitions
1. Acquisition: unique consented visitor/session per creator link; qualified visits (engagement threshold); first-touch referral attribution; last-touch conversion attribution; UTM/referral source; attribution window/version.
2. Network growth: completed signups attributed to creator, email/account verified members, first meaningful action, 7/28-day retained recruits. Never treat page views as new members.
3. Music: starts, qualified listens (define and version threshold), distinct listeners, seconds listened, completion, repeats, saves, playlist adds; split saves/listeners into pre-existing members and new creator-attributed recruits. Playback and saves require trusted player/library events, not clicks or claimed counts.
4. Ecosystem spillover: attributed recruits who view, play, save, follow or buy from OTHER creators; count distinct recruits and distinct discovered artists, exclude same artist and bots. Credit as assisted discovery, not guaranteed causation or automatic payout.
5. Services: offer impressions, CTA clicks, inquiries, booking attempts, completed bookings, paid orders, gross/net verified revenue and refund rate; only server/payment-confirmed sales count as revenue.
6. Quality: conversion funnels by referral source, new vs returning, content engagement, cohort retention, device/platform and bot-adjusted traffic; low-sample confidence flag.
7. Creator operations: published services, verified clip submissions, production cadence, consultations, 14/28-day milestone progress.

## Event taxonomy and required properties
- creator_profile_view: creator_m_uid, visit/session, referrer/UTM, consent status, bot classification
- creator_service_view / creator_service_click: creator_m_uid, offer_id, destination category; external link click is NOT a booking
- creator_referral_landing / creator_signup_completed / creator_member_activated: referral_token, immutable attribution decision, source event, account identity; no client claim of successful signup
- track_play_start / track_play_qualified / track_save / track_unsave: track_id, artist_id, authenticated member if present, player-derived progress, dedup key
- creator_cross_artist_discovery: referred_member_id, source_creator_id, discovered_artist_id, qualifying action, event provenance; compute on server, never browser assertion
- creator_service_booking_confirmed / creator_service_sale_confirmed / creator_service_refunded: trusted provider transaction and original event reference

## Attribution and privacy
- Preserve first-touch and last-touch separately; no unbounded last-click overwrites.
- New/existing membership determined by account creation timestamp relative to first referral touch, not device guesses.
- Session/browser identity is pseudonymous; never infer an authenticated user from an anonymous device without consent and legitimate account linking.
- Respect existing site privacy gate; no engagement instrumentation before consent.
- Report unavailable/not instrumented separately from zero; flag suspected bots and duplicate actions.
- Enforce creator ownership and minimum cohort size on network spillover aggregates; do not expose another artist's individual audience.
- Three-day trial is provisional. Retention requires later 7/28-day windows. Persist report version and source provenance.
- One consultation entitlement per creator, 15 minutes, issued by trusted service once; booking and redemption require separate calendar integration.

## External research references
- Spotify for Artists analytics: https://artists.spotify.com/en/analytics
- Spotify Discovery Mode campaign metrics: https://support.spotify.com/sm-en/artists/article/understanding-your-discovery-mode-performance-report/
- YouTube Analytics for Artists: https://support.google.com/youtube/answer/9419340?hl=en
- YouTube API metric definitions: https://developers.google.com/youtube/analytics/metrics
- Adobe attribution model concepts: https://experienceleague.adobe.com/en/docs/analytics/analyze/analysis-workspace/panels/attribution

## Acceptance sequence
- [ ] Instrument consented creator profile views and service CTA clicks via first-party collector; verify persisted event properties.
- [ ] Implement trusted referral signup attribution and new/existing user segmentation.
- [ ] Connect authenticated player progress and save actions with artist ownership.
- [ ] Compute cross-artist discovery with server joins and privacy thresholds.
- [ ] Server-generate three-day snapshot from actual events, with missing-data provenance.
- [ ] Issue consultation entitlement idempotently; book against real staff availability.
- [ ] Render owner-only report card and validate tenant isolation.
