# McCluster House Agents · Human Uprise World v1

**Status:** owner-private, code review only. The SQL lives in `supabase/pending/20261019210000_house_agent_accounts_v1.sql`. No migration is represented as applied, no live account as provisioned, and no external posting or agent model job is claimed active.

Owner direction 2026-10-19: turn the established 39-person PRIM3 fictional ensemble into reusable artist/media identities; begin with an American-storyline cohort; make the existing World globe a discovery surface for human members AND clearly identified fictional, studio-run system accounts; give each future system account its own bounded creative agent; prove the model on McCluster's house before white-label resale.

## Source and naming law

- **PRIM3 story source:** `mcclusterishere/Prim3` `CANON.md`, `story/IMMEDIATE-CAST-CANON.md`, and specialist psychological/Hitman dossiers. The Royce engineered-origin addendum is **proposed**, not merged source canon.
- **Product:** **Human Uprise**. Equity Uprise runs on it; they are not equivalent. The old `mnet.html` and `action_*` route/table names are deliberate compatibility identifiers.
- **McCluster** is the canonical resident AI and the canonical technical control plane: `workers/mccluster`, shared Supabase, Core runtime, M Account, existing social publisher. No new auth provider, database, or job scheduler.
- **World:** Cesium remains the single existing globe. Its guest entry is **Travel-first**, with Missions and Posts alongside it. Fictional characters are an additive optional discovery layer, never a replacement for travel, mission proof, or news.

## First U.S.-storyline cohort

`data/prim3/house-agent-us-cohort.v1.json` stages **13 fictional creator/operator accounts**, each with story function, independent editorial mission, voice, canon references, rights/production gates, and separate account identifier:

- **McCluster** — American protagonist, story anchor `US-CT` from the Bridgeport Vibes-concert canon. This is **narrative association**, not Matthew McCluster's live position, home, or verified residency.
- **Hitman side, 12 characters:** Royce, Sable Quinn, Grant Voss, Tone Rivera, Kira “Keys” Moon, Omar “Rack” Dillon, Jules “Kiosk” Mendez, Rae “Twin” Colton, Chris “Perch” Alvarez, Dez “Switch” Calhoun, Mina “Halo” Brooks, Sora “Gymnast” Okada.

The source story does **not** establish the other 12 characters' state-level residences. The U.S. designation here is an **owner-proposed fictional distribution cohort**, not a canonical assertion that those people physically live in the United States. Their `region_key` remains **null**, and World cannot invent a regional pin for them. A future approved canon location gives an account a story-region association with provenance. Cast names, language, appearance, nationality, the viewer's IP address, and visitor geolocation are **never** evidence of a character's region.

PRIM3's 24 Equity Uprise mains, 3 system/public presences and 12 contemporary Hitman personalities remain the **39-person immediate cast**. Benji and Ghost are historical McCluster identities, not duplicate accounts. PRIM2/Pylon are not automatically issued human-equivalent performer accounts. International character rollouts require their own canon dossiers.

## Two identity types; one social graph

| Human profile | House fictional performer |
|---|---|
| `m_people.id` (M Account UID) | `house_system_accounts.id` (fictional actor UUID) |
| Authenticated human with privacy settings | Operator-owned and declared fictional; no fake human signup |
| Existing `network_profiles`, verified membership/location when consented | Separate canonical actor metadata; no real GPS or residency claims |
| Verified actions count toward genuine member impact | Scripts/cutscenes/content **never** count as verified human actions |
| Human profile can follow, block, report | Future typed actor feed must preserve following, blocking, reporting, attribution, moderation |

**No fictional character may occupy an invented `m_people` row or `auth.users` credential.** Existing `network_posts.author_m_uid` and `network_feed_items.actor_m_uid` currently require human IDs; do not bypass this with a dummy account. A future review-backed **typed actor** migration is required to blend AI/studio posts into the real network feed. Until then, only a separate read-only published-character projection is supported.

## World region contract

Current real member totals originate in `action_globe_public_regions()`, with the existing minimum **5 consenting members** per region. They must remain suppressed below the threshold. Existing real mission pins/verified actions are a separate governed layer.

The additional read is:

`GET /v1/house-agents/public?country=US` (published characters only)

Its count means **approved fictional system accounts in a narrative country**, not humans in a place. The optional `/v1/house-agents/public/regions` endpoint groups only approved, correctly located **fictional STORY regions** using canonical regional centroids. World uses `js/world-house-agents.js` to show grouped story character markers and a character mission/personality dossier with an explicit fiction notice. Country selection shows fictional accounts separately from missions and real members. No fabricated member count, no spoofed engagement, no private operational Halo layers.

Current state: all 13 staged in a pending SQL file as **private drafts**, none publicly visible. The World layer remains empty/fail-closed until reviewed accounts are deliberately published.

## Each actor gets its own Core agent — the runtime contract (not yet activated)

**Identity**: `(org_id, actor_id)` with durable persona version, canon citations, rights metadata, allowed spoiler level, story-mission objectives, and active narrative region. `actor_id` is never a human `m_uid`.

**Agent execution**: one *logical* agent identity, not one always-on server or one model provider per character. The McCluster Core Capability Registry routes each character's jobs through the existing durable `ops_agent_jobs` and `ai_context`. Use scoped, nontransferable permissions:

1. Load minimal authorized character canon; pick an original weekly story arc and daily draft objective.
2. Request storyboard, images, original/recharacterized video, voice/music/sfx through the existing media harness and its media-job references; never bypass likeness rights or budget estimation.
3. Consistency-review the character against its versioned sheet and spoilers against episode/publication state.
4. Produce a **draft** in `house_agent_drafts`; record canonical Core task reference, asset provenance, output cost and model/version in the existing plane.
5. Owner reviews rights, accuracy, disclosures, brand consistency, audience and any paid spend before output promotion.
6. Once the typed actor native-post contract ships, convert an approved draft to an attributed Human Uprise post; only then may existing authorized social publishing connections distribute per-platform versions via official APIs.
7. Record real measured reach, saves, views, referrals and conversions; do not simulate likes/comments/followers or use bots to engineer artificial consensus.

Capabilities initially requested: `ai.chat` (story/draft), `image.generate`, `video.generate`, `audio.generate`. **No runtime model/job binding is provisioned by this v1 migration.** External posting, autonomous replies, cross-agent engagement, account creation and ad purchases stay off by default.

## Owner review API

- `GET /v1/house-agents/owner`: private inventory of scoped house actors.
- `GET /v1/house-agents/owner/drafts`: private review queue.
- `POST /v1/house-agents/owner/drafts`: create a review-only draft for an existing fictional account.
- `POST /v1/house-agents/owner/drafts/:id/review`: approve/reject draft; **approval is not publication**.

Private routes use the existing McCluster house-owner org membership, not `?admin=1` or frontend flags. All SQL tables are RLS-enabled and revoked from anon/authenticated roles. Service role is only in the canonical Worker. Native Mnet feed continues with its human auth and block enforcement.

## Production and media identity

A model-independent character sheet should contain: front/three-quarter/profile full-body canonical views, facial consistency landmarks, age-appropriate wardrobe, expression/gesture guide, identity-safe vocal/cadence notes, backstory/spoiler locks, forbidden traits, proof of rights to each reference, and revision approval. For McCluster's real likeness and video, obtain his own approved reference assets; for other collaborators or performers obtain permission before transferring their likeness, voice or original footage.

Long-video **re-characterization** is a separately staged capability: segment into scenes with overlap, track the selected performer, batch bounded temporal windows, consistently replace only authorized subjects, preserve unmodified actors/backgrounds and source audio subject to rights, assemble/repair seams, then QC temporal identity drift, lipsync, occlusions, rendering errors and costs. Do **not** pretend arbitrary full-length video replacement exists just because `video.generate` is available.

No file under `data/prim3` is a generated actor photograph or an authorization to publish.

## Acceptance and business rollout

**A. Private founder pilot:** pending migration reviewed/applied in test environment; owner lists 13 draft actors; all distinct missions/personas present; nonowner cannot read drafts; legacy feed and real region RPCs unchanged; zero public actors and zero external sends.

**B. Reviewed characters:** owner locks rights and story-region provenance for Royce/McCluster; generate actual character sheets and a 30–60 second original pilot; approve safe metadata for public view. World click lists only those deliberately published characters; state and country counts are *separate from humans*.

**C. Native human + agent media market:** typed actor posts, follow/block/report/mute, capability-scoped agent jobs, billable media work orders, creator commissions and native post proof; no fake human identity; measurements from real audiences.

**D. Productization / white-label:** tenant-owned fictional performers, organization quotas, scoped agent/job/media costs, subscriptions, roles, export rights, permitted external channels, billing and audit all reuse the existing McCluster control plane. Founder organization remains the first client; do not create a separate backend per customer.

## Explicit release gates

- Keep `supabase/pending/20261019210000_house_agent_accounts_v1.sql` **pending** until reviewed. Do not mark applied or move to production ledger without evidence.
- Do not merge or deploy UI/runtime code without validation of real Worker imports, RLS and schema, country/regional selection, small-screen UX and CI.
- Public identities and their AI production nature must be apparent; fictional people do not impersonate genuine independent residents, journalists, witnesses or review authors.
- Only a future audited native-publisher path may create real `network_posts` on behalf of a typed fictional actor; ordinary member interactions must be distinguished from automated/studio ones.
- `royce-janus` proposed PRIM3 origin is spoiler-gated and **not** authoritatively merged. Public drafts must never expose that full reveal ahead of the episode.

### Source references

- `mcclusterishere/Prim3`: `CANON.md`, `story/IMMEDIATE-CAST-CANON.md`, `story/HITMAN-CHARACTER-DOSSIERS.md`, `story/PRIME-LORE.md`, `story/PRIM-SUCCESSION-AUTHORITY.md`.
- McCluster `docs/architecture/identity-network.md`, `docs/action-network/HUMAN-UPRISE-WORLD-FEED.md`, `docs/travel/TRAVEL-FIRST-WORLD-STANDARD-20261017.md`.
- McCluster `docs/control-plane/AI-HARNESS.md`, `docs/control-plane/GENERATIVE-MEDIA-HARNESS.md`, `workers/mccluster/src/platform-api.js`, `workers/mccluster/src/social/router.js`.
