# Equity Uprise — World, mission series and song action contracts

Owner direction: October 18, 2026. **Equity Uprise** is the social product. “An action network” describes the purpose; it is not the product name. Continue using the shared McCluster identity, canonical audio catalogue and platform services. Do not fork the backend into a separate social network.

## Current UI slice (branch feat/equity-uprise-mission-series-compact-world-20261018)

- World controls keep Travel / Missions / News as routing modes for compatibility with in-flight feed work. Remove the redundant globe “Missions · All regions” control and the five-category mission deck navigation. News-feed integration is being handled separately; do not duplicate that work here.
- In Missions, **Open** and **Completed** are one small status switch. Open missions remain live, simple cards with the exact “Read full mission” flow, Pass, Accept and a real Undo button. Passing is local and reversible; accepting can only succeed after the existing server-side join path says it succeeded.
- Completed renders the **Docket 516R** series. One completed work card at a time, browse with horizontal swipe, previous/next, or keyboard. “Read full mission” shows the verified published work, credits, recording and visual links. No accept/pass on historical work. No auto-awarded points or payments.
- The **Write a Song** display title replaces **Write the Change** while retaining the database mission UUID and historical archive identifiers. “Write the change” may remain secondary CTA copy. There is no backfill of historical participant assignments from archive data.
- “Heal the 3rd World” audio is the existing music transport, not a new player. Compact it to one accessible Play/Pause globe-side button positioned above the fullscreen control; retain the actual Audio element, source and playback when navigating from Music to World. Title/mute continue to be available in the Music experience, not in a second World dock.
- No change to the supported privacy posture, owner authorization, user identity, payment gates, review rules or historical provenance.

## Authoritative completed work

The public historical source is `data/action/docket-516r-archive.json`, served from `/v1/action-archive/docket-516r-2025`. It documents **nine distinct completed works**, **ten recordings** (Environmental Injustice has an alternate mix, not a tenth mission), **ten people** and **one October 5, 2025 cohort showcase**. The showcase is at Shiloh Baptist Church, 477 Broad Street, Bridgeport, Connecticut; coordinates are address-interpolated, not a surveyed entry point.

**Only the showcase has confirmed location coordinates.** A work may be associated with its series and that showcase, but must not inherit the showcase as its recording/shooting location. A future card may include `recording_place`, `filming_place`, `performance_place` or `event_place` independently, each with precision, source and publication consent. Omit a map pin when its actual location is unverified or private.

Four recordings in the public Equity Uprise album have existing, canonical `release_url` and `catalogue_key`; completed cards link those to the music engine instead of making another native audio player. Six archived recordings have external Drive playback but no confirmed published music-engine catalogue entry; preserve them as clearly labeled archive links until publication and rights clearance. Never invent a catalogue key or present a Drive file as released music.

## Backend/admin product contract — next implementation, NOT deployed in this UI slice

The repository already has `action_missions`, assignments, submitted proof, owner-controlled verification, `action_archive_*` history, and a proposal for `action_mission_arcs` and `action_mission_ctas` under `supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql`. **Do not apply that pending migration ad hoc**, merge two overlapping schemas or promote the old archive to assignments. Reconcile migrations and the production ledger under the DB review gate first.

1. **Series:** Create a tenant-scoped `mission_series` entity (`series_id`, owner, slug, title, description, campaign/cohort, optional artwork, visibility, published revision) and ordered memberships (`series_id`, `mission_id` or historical `work_id`, ordinal). A series may include repeatable mission templates and multiple completed work items; historical projects are read-only unless reviewed provenance is changed by an authorized curator.
2. **Mission templates and admin builder:** Control creates and previews a reusable `mission_card_revision`: type, CTA, eligibility, requirements, brief, full description, proof settings, attachments, safe map markers, music/media object references and theme. Save draft, validate permissions/rights, preview under role-specific auth, then owner publishes an immutable revision. An artist can propose a song CTA; only authorized Control editors can publish it. Tenants cannot edit other tenants’ cards. Support withdraw/unpublish without deleting verified history.
3. **Completion workflow:** `draft -> open -> assigned/in_progress -> submitted -> reviewed -> verified -> public_completed`. Treat assignment status and public-card publication as **separate** dimensions. The existing admin-only proof review is authoritative: no public completed card until verified (or explicitly attested for reviewed historical imports), permission to publish checked, and referenced media cleared. Use an idempotent event/outbox `assignment_verified` to create or update a completion projection keyed by assignment ID and card revision. Never trigger money, point credits, copyright claims or playback entitlements merely because a card is published. Handle review reversal, deletion request, private work and media unpublish. No duplicate cards on retries.
4. **Portable embed:** One schema `mission_card` with stable `id`, `series_id`, `state`, `cta`, `media_refs`, `geo_refs` and `provenance`; render as lightweight feed excerpt, open-deck card, completed carousel card, work detail dialog, globe pin context, artist/partner profile module and shared deep link. A visual should reference an existing media library ID, not copy audio/video into every frontend. Audio playback remains owned by the canonical Music client with entitlement checks.
5. **Geospatial:** Each pin carries coordinates or jurisdiction, venue/time, precision, role (`event`, `recording`, `shoot`, `community`), evidence/provenance and consent; event-attached works can offer “Show series showcase” without misrepresenting where a track was recorded. Geocoordinates are never inferred from song subject matter. Guests can view published coarse public locations; sensitive exact locations remain private.
6. **CTA relations:** Song-to-mission is many-to-many with relation type (`inspired_by`, `documents`, `soundtrack`, `deliverable`, `next_action`), position, locale, release status and rights approval. UI calls Music for releases and Missions for the action. Draft proposals cannot unlock paid/gated audio.
7. **Observability/quality:** Event taxonomy: `mission_series_open`, `mission_open`, `mission_pass`, `mission_pass_undo`, `mission_accept_intent`, `mission_join_confirmed`, `mission_work_published`, `mission_work_open`, `mission_media_open`, `song_to_mission_cta_open`, `mission_globe_focus`. Keep visitor-consent rules, event minimization, idempotency and admin audit.

**Acceptance gate for the backend slice:** scratch DB+RLS tests (guest, member, creator, reviewer, wrong tenant, revoked revision), verified-only projection tests including racing/replay and reversal, canonical audio permission tests, honest geolocation provenance tests, admin create/preview/review/publish/withdraw E2E, 390px mobile deck and music continuity E2E. Keep this slice behind review/draft until those pass; do not mark it production live merely because the UI renders.

## Editorial proposals — CTAs for Docket 516R songs

These are **draft ideas**, not new verified campaigns, completed accomplishments, public promises or current production routes. Every proposed CTA must be reviewed against the song’s lyrics and the organizers’ intent before publication. A recording mix shares its parent work’s CTA unless a curator explicitly differentiates it.

| Song (completed historical work) | Suggested future action | Delivery / guardrail |
|---|---|---|
| Environmental Injustice (including Brave mix) | **Document an environmental concern** | Photograph or cite a public source; protect private addresses and obtain consent |
| Please Set Me Free | **Find and share an approved support resource** | Connect with existing reentry, housing or community service directories; no unverified legal advice |
| SJW | **Research a claim; write a policy note** | Evidence-based policy-fellow review, not attacks on individuals |
| Scar Stories | **Record a community story** | Explicit consent and right to withdraw; optional anonymous written submission |
| Save the Land | **Document or join a local conservation effort** | Approved cleanup/land stewardship partner; no trespassing |
| Not for Sale | **Research a public-interest issue** | Document sources and a proposed safeguard; no public accusations without review |
| Money or the Power | **Follow a public decision or budget** | Public records with transparent citations; create a policy proposal |
| Do Right by We | **Complete one verified community-help action** | Non-exploitative mutual aid, recipient privacy and consent |
| We Ain’t Goin Nowhere | **Show up to a verified community gathering** | Public event/organizer approval, real attendance verification |

The mission **Write a Song** can be a shared creative entry point across the catalogue, with individual songs also linking to distinct action CTAs in reviewed `action_mission_ctas`. No preview, payment or account signup should be triggered automatically by clicking an editorial song reference.
