# McCluster House Agents — Human Uprise World v1

Status: **implementation branch / migration pending / not live**  
Direction: owner, 2026-10-19  
Product boundary: Human Uprise (public social + globe); McCluster Control (owner workflows); PRIM3 (fictional canon)

## Outcome

People and individually governed fictional AI performers can inhabit the same Human Uprise discovery world, with **one feed, one McCluster identity plane, one operations control plane**. A house-agent account is a *system actor* owned by an organization, not a fabricated verified person. Its profile explicitly says fictional AI-produced PRIM3 entertainment. It has its own narrative mission, persona contract, creative memory scope, and eventually a separately authorized agent workflow; ordinary M Account members retain control of their own real identity.

The first owner-controlled cohort is defined at `data/prim3/house-agent-us-cohort.v1.json`: 13 candidate fictional performers, McCluster plus the existing 12 Hitman roles. **Only McCluster has explicitly supported U.S. nationality and a Connecticut story event**. Other Hitman characters belong to the proposed U.S. launch slate, but their current hometowns and nationalities remain UNVERIFIED. Do not infer nationality or residence from name, costume, accent, group or work assignment. Original PRIM3 canon remains authoritative in `mcclusterishere/Prim3`, especially `CANON.md`, `story/IMMEDIATE-CAST-CANON.md`, and `story/HITMAN-CHARACTER-DOSSIERS.md`.

## 0. What this PR actually adds

1. A versioned 13-character first-party roster containing voice, character mission, story authority links, jurisdiction uncertainty, disclosure and individual agent policy.
2. Pending tenant-scoped SQL for `house_system_accounts` + a private review queue `house_agent_drafts`. These are **not** m_people or fake Supabase Auth users.
3. One Worker router on `api.mccluster.org` for owner-only account and draft inspection, owner-only draft creation/approval, and **published-only** public character discovery. No anonymous write, no paid generation or outbound publishing.
4. Published-only fictional-character country and region overlays on the **existing** Cesium World, with count and dossier/mission drawer. No new global navigation, no replacement globe, no location collection, no admin intelligence data.
5. Unit tests for RLS/owner gates, published projection, geo integrity, typed fictional-actor counts, and first-cohort disclosure.

**What it does not add:** 13 real M Accounts, 13 running inference processes, 13 invented followers, a scheduled content bot, external Meta/TikTok/X account creation, one-click voice cloning, published posts, fake interactions, provider activation, an immediately deployed character gallery, or a new platform backend. No schema has been applied to production. All 13 pilot rows start `draft` and invisible.

## Identity and content contract

The identity model will grow from `human` to `human | fictional_system_account | business_or_studio`, but the *human* branch must keep `m_uid` as the immutable person's key. The staged house actor has a distinct `house_system_accounts.id`, org-scoped `handle`, verified rights and immutable character/provenance reference. Never synthesize `m_people` rows to bypass `network_posts.author_m_uid` and `network_feed_items.actor_m_uid` FKs. These existing tables and blockers/follows/media permissions are human-specific; a later typed-actor migration, carefully reviewed, will bridge agents into the **same** native post feed without creating another social graph.

A system-actor post requires:
- author type + system-account ID, franchise/character credit, org, source rights and versioned canon;
- user-visible **fictional/AI-generated** disclosure in profile and appropriate content provenance;
- actual approved creative media, rights/likeness/voice proof (for real persons or reused source videos);
- visibility, block/mute/report, moderation, accessible alt text, and review state;
- explicit externally connected channel and manual owner approval before distribution;
- distinct analytics attribution; agent posting does not count as a verified human mission, paid claim, volunteer, supporter, or geographic member.

Never backfill fictional performers into the consented `action_globe_member_regions` or the K>=5 region public member count. Character *story location* is not a human home, live geolocation, or actual physical appearance. An unknown current region creates no fake pin. For a fictional character whose presence is not location-grounded, country selection can show the character but no regional marker. Any coarse pin location must be canon-linked, region-reviewed, and generated only from approved `action_globe_regions` centroids.

## Each agent is an independent governed persona, not an unbounded bot

Canonical runtime: McCluster Core `ops_agent_jobs` / agent executor, canonical Supabase `ai_context` memory, capability ids from `core/capabilities/catalog.json`, existing `media_jobs`, existing external `social_publish_jobs`. No account-local cron, shadow database, pseudo-human password, separate Core installation, vendor-locked contract or unauthorized model training.

- Every character's `agent.agent_id` and `namespace` isolate canon-facing persona context. The company operator may review crossovers; one character cannot read another tenant's confidential drafts.
- A character has an **editorial mission** (why it posts) and a **fictional story/game mission** (what it does on the globe). These are separate from real-world eligible paid `action_missions`.
- The logical runner assembles a brief, retrieves only approved canon and permitted asset references, drafts a screenplay/caption/storyboard, submits media proposals via the capability router, validates spoiler/rights/real-world claims and emits a private draft for review.
- Starting scope is one **proposed** draft a day per agent (off until owner enables), zero autonomous budget, no auto replies, no direct publish. A real job must produce a Core receipt before any capability is reported as operational.
- The owner can approve/reject a draft. **Approving a draft is not publishing**; a distinct release gate checks platform connection and rights, conversion to typed network post and external channel target.
- An agent can be paused, its rights revoked, its account archived, its reference assets removed, its queued drafts invalidated and its state exported. No unilateral changes to owner policy.

Proposed future capability names (not falsely active): `character.context.read`, `character.draft.create`, `character.perform.video`, `character.content.review`, `actor.network.publish`, `actor.channel.publish`, `actor.schedule.plan`. Bind these only after implementation + evaluation and apply current risk vocabulary; don't insert speculative IDs into the live capability catalog as active entries.

## Publish loop (future, not operational in this pilot)

`canon + approved character sheet + rights → Core draft job → private review → clip/video pipeline → QC for likeness / flicker / voice / spoiler → approved master → native network post + authorized external per-platform variant → verified analytics → editorial evaluation`.

The first video re-characterization capability should start with short **consented, owned** source video: capture one source actor, produce original Royce reference pack, mask/track foreground performer, temporally consistent character replacement, separate audio/lip-sync permission, continuity and final assembly. Longer clips are queued in scene/chunk windows with overlap and quality checks, not claimed to be infinite single-model inference. Store provenance and creator rights outside the public Git tree.

External social connections use the already-existing authorized OAuth + official API queue; tokens stay server-side. Generated fictional creators must not impersonate independent humans, simulate authentic third-party engagement, give unverified testimonials, or present in-universe law enforcement, politics, factual emergencies or endorsements as real.

## Service shape and onboarding — resellable by design

**Tenant zero:** McCluster house org owns the first 13 staging characters. After this pilot, a customer can create an organization membership, purchase a plan/seat entitlement, define authorized character/brand profiles, attach character sheets/rights, approve budgets and connect *their own* social channels. Billing charges compute, media and publishing seats under the existing checkout and meter; no automatic purchases. Never clone the house roster into a customer's org by default; character/IP licensing requires an explicit agreement.

System-owner Controls should ultimately expose **Agents** as a local destination/filter inside the existing Control/Studio navigation, not a new global tab. Each row shows character, lore source, attached accounts, active/stopped state, next draft, pending approvals, cost and genuine reach, along with pause/revoke/export. A customer portal gets the same review flow with tenant RLS and capability-scoped roles.

## World UI rules

The established public World is **travel-first for guests**, with Missions and Posts adjacent; its Cesium layer and navigation are retained. Published system actors have a visually distinct, non-mission color and explicit fiction label. Tapping a published regional character marker opens a count and list of personas, editable only in owner Control. Tapping a country shows the **human mission count** and a separate **fictional performer account count**. Neither count is derived from the other. Markers are region-centroid story associations, not GPS/visitation.

## Release gates

- [x] Canon 13 candidate persona manifest; confidence/region gaps explicit
- [x] Pending schema + RLS + filtered published-only view
- [x] Authenticated owner-only Worker draft/read APIs; anonymous published-only list
- [x] Existing globe integration for non-inflated approved fictional counts
- [x] Deterministic tests for staging, type integrity and geography
- [ ] Schema migration staging apply/replay and independent RLS verification
- [ ] CI, Worker unit suite, World browser E2E for signed-out/signed-in + iPhone reduced motion, 390×844 and wide
- [ ] Character account operator UI with explicit owner activate/pause controls
- [ ] Individual Core agent job bindings and durable per-account activation receipts
- [ ] Rights-reviewed character sheets, voices and initial production assets
- [ ] Typed post-author extension, feed/profile/blocks/reports schema and migration
- [ ] Reviewed media/character video pipeline with scene-level consistency
- [ ] External OAuth channel grants + editorial release/publish receipts
- [ ] Product entitlements and multi-tenant misuse/abuse tests
- [ ] Public policy notice updates for fictional account identities and AI content
- [ ] Owner decision to publish a profile on the live globe

Keep PR in **draft** and do not apply SQL, merge, deploy, seed engagement or activate any external social accounts until the gates are met. The owner can review its manifests without exposing the identities to visitors.
