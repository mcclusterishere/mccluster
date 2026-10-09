# Creator-owned experience, shared Action Network infrastructure

Status: product specification; not yet deployed.

## Canonical identity and brand routing
One shared Mnet identity, permissions and subscription graph. Each creator has a unique canonical slug, optional verified custom domain, logo, banner, bio, social links, role memberships, credits and catalog. Resolve creator context from validated hostname/path on the server; change the bottom M navigation identity to the active creator logo and apply that creator's theme. On returning to network home, restore M identity. Keep accessible navigation, visible account settings and legally required operator/privacy disclosures; do not deceptively conceal platform operator.

## Rich playable portfolio
Require at least five distinct rights-cleared work examples during onboarding. Store one reusable canonical media asset per example, with creator ownership/credits, mime type, file size, duration_ms, artwork, thumbnail, alt text, status, visibility, transcript/captions where relevant and approved source. Music player shows full track length and progress; video player shows length, seek, captions, poster and full-screen. Support externally hosted references only where allowed and measurable; don't claim exact completion analytics for third-party embeds without reliable telemetry. Reuse the approved assets in applicant matching cards and public creator pages; support creator editing and moderation.

## Media graph and linked credits
Media asset -> credited people with roles (recording artist, featured artist, producer, recording engineer, videographer/director, video editor), permissions, order and canonical creator IDs. Credits link to public creator profile and persist across song player, music video and catalog cards. Resolve rights and attribution for each media asset; do not infer copyright ownership from credits.

## Discovery matching
Applicant sees other roles only. Match card can play/seek approved portfolio audio and video before a left/right decision. Record applicant choice separately from media engagement; avoid treating watch time as a hidden hiring vote. Reciprocal preferences inform five-role pod assembly with eligibility, country/co-location, capacity and availability constraints. Disclose that preferences inform selection; do not reveal other applicants' private swipe results.

## Event and analytics taxonomy
asset_impression, media_play_intent, media_started, media_progress (throttled 10/25/50/75/95 percent milestones), media_pause, media_seek, media_complete, media_replay, profile_open_from_credit, creator_subscribe, referral_landing, verified_account_created, qualified_creator_acquisition, retained_subscriber.
Track media_duration_ms, playhead_ms, foreground/visibility, muted/autoplay flag, session/consented anonymous visitor, asset_id, credited creator, referring creator, campaign_id and attribution token where applicable. Server-side dedupe event IDs and avoid per-second telemetry. Measure real playback time only while progressing and visible/audible; distinguish start vs qualified play vs completion. Do not expose raw viewer identities or private analytics to other applicants.

## Creator storefront / hosted site
The profile is a standalone creator-branded social storefront with artist/producer/engineer/videographer/editor-specific catalog views, subscriber button, link hub, portfolio, collaborators and optional domain. Shared auth/session across different domains requires standards-compliant redirects; never assume cookies work across domains. No false guarantee that users cannot discover the platform operator. Make branding independent from the provider while retaining legally required disclosures.

## Domain and price proposal
User-directed commercial proposal: $20 upfront, $5 per month for creator-branded hosting, with domain registration through McCluster offered at checkout. **Clarify whether $20 includes first-year domain registration and initial setup or is solely a setup fee**, since registrar/renewal costs vary by TLD; show actual domain availability, annual renewal, taxes, transfer rights and cancellation terms separately. Do not claim a permanent domain can be purchased once for $20. Onboarding portfolio and network profile should work before a paid custom domain.

## Acceptance criteria
Five media examples required; media playable in matching cards and public profiles; accessible audio/video duration and controls; linked credits traverse creator pages; bottom brand/logo changes on creator-context navigation; server-enforced creator visibility and rights; consent-aware analytics; account+matching subscription required for referral acquisition; custom domain verifies ownership and TLS before activation; mobile test and playback tests.

## Navigation clarification — preserve existing McCluster bottom bar (authoritative)
Do NOT implement a new generic four-button nav or clone/fork the bottom bar per creator. Locate and reuse the production McCluster bottom-navigation component and its exact current order, icons, record control, music control, profile control, keyboard/accessibility and routing behavior. In creator context, the **existing central M emblem slot alone** becomes the verified creator's logo/emblem; clicking it opens that creator's portfolio landing page. Outside creator context the same slot returns to the original McCluster M and its existing destination. Other nav controls remain materially unchanged for v1. The profile button retains its existing semantics (signed-in account), distinct from the central public creator portfolio. The existing record action and music player must not be broken.

Implement a creator context resolver that yields canonical creator ID, verified emblem URL, portfolio route, theme metadata and verified domain; fail closed to McCluster defaults on missing, invalid or unauthorized creator data. A single shared shell and component must serve all creator profiles; future independently branded creator apps and network-specific navigation are **future configurable extensions**, not an excuse to duplicate source or deploy isolated authentication systems. On credit-link navigation, change creator context, central logo and portfolio target together while preserving music playback and back navigation. Test McCluster -> artist -> videographer -> McCluster, missing logo fallback, cross-domain auth redirect and mobile safe-area layout. Preserve existing bottom bar CSS rather than adopting prototype styles.
