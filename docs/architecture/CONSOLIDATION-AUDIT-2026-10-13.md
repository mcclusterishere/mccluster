# Consolidation audit — identity, creator tools and analytics (2026-10-13)

## Canonical product rule
One M Account, one `m_uid`, one `platform_profiles.mccluster_id` handle, one `network_profiles` public identity. Artist, producer, influencer, cohort member, customer and administrator are **capabilities**, not separate accounts. This rule already exists in `docs/architecture/identity-network.md` but is not consistently enforced.

## Verified drift / priority
| Priority | Drift | Evidence | Destination |
| --- | --- | --- | --- |
| P0 | Music creator profile maintains separate handle, artist name, bio, avatar, banner and website | `music_creator_profiles`, `js/music-creator-studio.js`, `js/music-creator-profile.js` | `platform_profiles.mccluster_id` + `network_profiles`; keep only artist-specific metadata in music tables |
| P0 | Existing `identity_presentations` already has `music_enabled` but creator onboarding still creates a separate profile without treating that as the activation switch | `20261005054044_identity_presentations_music_action_v1.sql` | One capability activation, server-authorized and reflected in Profile |
| P0 | Public artist route resolves its own music handle | `music-creator.html?handle=`, `js/music-creator-profile.js` | Resolve canonical handle to `m_uid`; preserve legacy URLs via redirects/aliases |
| P1 | Artist settings, media, rights, licensing, catalog and analytics appear as a parallel Creator Studio | `creator.html`, `js/music-creator-studio.js` | Profile > Creator capabilities > Music; analytics in shared Analytics > Music |
| P1 | Analytics has multiple frontends and routing layers | `analytics.html`, `js/analytics-suite.js`, `js/analytics-board.js`, `js/music-self-analytics.js`, `creator-landing-analytics.html` | One Analytics entry point with role-scoped views, preserve owner/admin controls |
| P1 | Role-specific creator workspaces propose their own My Profile/My Audience/My Rewards | `docs/ACTION-NETWORK-CREATOR-ROLE-WORKSPACES.md` | Shared Profile, Analytics, Earnings; role-specific tasks remain role facets |
| P2 | Account/profile settings spread across `account.html`, `js/mnet.js`, `js/mccluster-creator-account.js`, `mccluster-creator.html` | Separate pages/controllers | Define canonical owner for each field and route all edits there |
| P2 | Navigation retains multiple destinations for identity and creator activities | `js/tabbar.js`, `creator.html`, `listen.html` | Four primary destinations maximum; contextual links can promote capabilities but should not create duplicate centers |

## Proposed simple information architecture
- **Profile:** identity, handle, appearance, bio, artist activation, creator roles, catalog management, rights/licensing, settings, public profile preview.
- **Analytics:** one dashboard with Music / Content / Audience / Earnings tabs gated by roles, plus separate administrator controls.
- **Music:** discovery, listening, sharing, and a promotional CTA to activate artist tools under Profile; no independent identity onboarding.
- **Action:** feed, missions, groups, messages through contextual navigation; no duplicate profile editor.
- **Control:** administrative workflows, approvals, and security; never exposed to ordinary users.

## Backend ownership map
- Identity: `m_people`, `m_auth_user_links`, `platform_profiles`, `network_profiles`.
- Capabilities/presentation: `identity_presentations` and server-authorized role/entitlement tables.
- Music data: `creator_tracks`, albums, rights, licenses, ISRC and payout records reference `m_uid` and track UUIDs, not handles.
- Metrics: existing analytics events with canonical `m_uid` / org / resource dimensions; shared read API with least-privilege authorization.
- Admin: independent authorization layer, not a parallel identity.

## Migration and acceptance criteria
1. Inventory existing artist handles and collisions; generate explicit resolution report before writes.
2. Backfill canonical links and alias old URLs; do not overwrite profile fields silently.
3. Introduce a single server-side artist activation/update endpoint with authorization and audit log; make retries idempotent.
4. Move artist management UI under Profile and music reporting under Analytics. Keep legacy links as redirects.
5. Add tests for existing member activation, custom handles, rename propagation, album/track ownership, old artist URLs, RLS isolation, role switching and non-artist accounts.
6. Remove duplicated forms/endpoints only after production data reconciliation and traffic checks.

## Scope caution
This is a source-code architectural audit, not a full runtime navigation crawl or exhaustive database dependency graph. Do not delete legacy tables or ship destructive migrations without confirming consumers, data and access policies.
