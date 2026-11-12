# Mnet integrated application, admissions, music and acquisition contract

Status: product architecture contract / implementation backlog. **Not a claim that features are shipped.**

## Non-negotiable cross-repository architecture

`mcclusterishere/mccluster` and `mcclusterishere/hitmans-halo` are **separate source repositories but one integrated McCluster application/ecosystem**. Do not create a second user identity, second membership database, duplicate public shell, or competing globe. The canonical public website is `matthew.mccluster.org`. Hitman's Halo retains ownership of its sophisticated Cesium/globe runtime and exposes bounded integration surfaces to the McCluster app. Integrate through documented, authenticated contracts and shared identity/entitlements; preserve independent deployability and test boundaries. Any future agent must inspect both repos before changing overlapping features.

## Public vs member access

- Public visitors can discover music, portfolio, business services, campaigns, and automotive experiences without a social-network account.
- Mnet membership is application-only, personally approved by the owner; submitting an application **does not create an active member**. Pending/declined accounts cannot access members-only media or community APIs.
- Applicant flow: short founder introduction, tap-to-select interests/goals, optional freeform responses, explicit camera consent, private photo or video introduction, submit, pending/review/approve/decline, notifications. Avoid inferring eligibility from facial appearance or protected characteristics. Set biometric/media retention, deletion, access logging and non-camera accessibility alternative before launch.
- Face-based cross-device identification is a distinct future opt-in feature, never a replacement for independent authentication, account recovery or authorization.
- Server-side authorization and RLS, not frontend visibility, enforce member entitlements.

## Music funnel

- Per-track policy: `public_full`, `preview_only`, `one_time_full_then_locked`, `members_full`; owner configurable.
- Public preview has an explicit, track-specific duration and accessible player state. Once preview or one-time play ends, card fades to dark overlay with `Apply for Access to hear the full song` CTA. A one-time full listen must be enforced by authenticated or abuse-resistant server-side play grants; anonymous one-time guarantees are limited without reliable identity.
- Preserve current player and existing album order; do not blanket-lock all music. Never send protected full-track media URL to an unauthenticated browser merely hidden by UI.
- CTA links into a track-attributed Mnet application, not instant registration. After approval, return to originating track.

## Independent landing funnels within one site

Keep the original 360-degree landing experience intact. Make its sections independently addressable and trackable, without splitting them into separate applications yet:

1. **Top 360 / business-owner introduction**: `Want a website like this?` and `Who is Matthew McCluster?`; deep link, unique campaign attribution and business service CTA.
2. **Vault / plane / immersive 360 segment**: deep link and unique event funnel, engagement milestones and destination CTA.
3. **Vault ending / sky-to-bedroom texting scene**: separately deep-linkable end segment, contact/message CTA and its own attribution.

Track per-funnel `landing_view`, `experience_start`, `milestone`, `cta_view`, `cta_click`, `application_start`, `application_submit`, `membership_approved`, and `conversion` with campaign/source, section ID, session pseudonym, timestamp, and consent controls. No raw facial media in analytics. Do not count impressions as conversions. Preserve cross-segment journey linkage where consented.

## Logged-out navigation

Keep the existing three-item bottom navigation and insert **The Whip Equipped** destination between Play and the central M/emblem. Logged-out Whip Equipped links to a dedicated public automotive marketplace surface for vehicle rentals, buying and selling. Keep the social/community product available but do not force visitors into Action Network onboarding to browse music or commerce. Do not imply rentals/listings/payment handling are live until inventory, terms, moderation and transaction controls exist.

## Implementation sequence / acceptance criteria

1. Inventory existing album cards, playback gate, bottom navigation, landing sections, analytics event contracts, auth/RLS, and Control owner gates. Write regression tests before modifying production behavior.
2. Implement section deep links and isolated analytics attribution, with consent-aware event capture and Control reporting.
3. Add a feature-flagged logged-out Whip Equipped navigation entry and honest marketplace landing shell.
4. Implement per-track playback policies, end-of-preview overlays, attribution-preserving application CTA and server-side entitlement checks.
5. Implement tap-through application and private founder review queue, with camera consent, secure media handling, retention and accessible alternatives; block activation until owner approval.
6. End-to-end tests: visitor → preview → application → pending → owner approval → full play; separate business, vault and bedroom funnel attribution; mobile navigation; no protected media leakage.
7. Verify existing signed-in experience, action network, payment flows and Halo integration remain intact. Do not merge/deploy until CI and browser smoke checks pass.

## Out of scope until explicitly approved

Automatic biometric identification, automated face-based admission, compulsory facial-template storage, unreviewed vehicle transactions, migration of Halo Cesium code into the McCluster frontend, and making every song members-only.
