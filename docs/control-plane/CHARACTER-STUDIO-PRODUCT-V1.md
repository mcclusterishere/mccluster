# McCluster Character Studio — Product v1

**Status:** Draft implementation, private owner preview. **Not merged, migrated, deployed, sold or publicly available.**

**Entry:** Existing Control Room → Create → Characters (`control.html#create:characters`), including the optional owner-workspace presentation `control.html?workspace=1#create:characters`.

**Backend authority:** McCluster Worker + existing Supabase organization membership, reused from House Agents v1 draft PR #548. The character IP authority for PRIM3 is the separate `mcclusterishere/Prim3` repository. A character is **not** a new Supabase Auth user or an M Account person.

## Product thesis

A creator designs **one portable character identity** that stays coherent in text, comics, virtual performances, future video/voice, games and approved social channels. The moat is consistency, provenance, fine-grained permissions, legal rights, production quality and a reusable creative workflow—not a single image or prompt.

**Five distinct domain primitives:**

1. **Character:** stable tenant-scoped identity, handle, story-world association, fictional disclosure, account lifecycle.
2. **Character revision:** immutable-by-workflow versioned creative bible (personality, contradictions, mission, content themes, visual direction, agent limits).
3. **Performance:** licensed source + original character references + actual model/renderer job receipts and asset lineage (future; video planning in PR #546 is not a completed pipeline).
4. **Agent session:** Core job identity/memory scope, approved tools, model and cost receipts, review queue (future; never pseudo-human auth).
5. **Distribution:** one real canonical post, native feed author type, explicit connected external channels and human final release (future; *not* a fictional member/paid mission or fabricated engagement).

Every production artifact should pin **character_id + revision + canon release + asset licensing record + job/approval receipt**, so a new visual look or voice does not silently mutate old work.

## First working slice

`POST /v1/house-agents/owner/characters/preview` compiles a validated character brief into an owner-only creative bible and shareable-looking **private preview**. This is currently deterministic code, not an LLM or image/video provider call. It returns `model_called:false`; no tokens are billed.

`POST /v1/house-agents/owner/characters` performs exactly **one atomic database RPC** after owner authorization, storing an inert `house_system_accounts` row plus revision 1 in `house_character_revisions`. A response with `published:false` does not imply discoverability or an agent process. This endpoint is **unavailable until both pending migrations** are staged and safely promoted.

`GET /v1/house-agents/owner` lists the private studio roster. `GET /v1/house-agents/owner/characters/:uuid/revisions` reads revision history scoped to McCluster's house org. Both require a validated owner token. All generated characters start with `account_status=draft`, zero autonomous spend, no agent schedule, no social posting, no model voice/likeness rights and no geography marker.

**Request contract:** `docs/control-plane/contracts/character-brief.v1.schema.json`.

Inputs include name, handle, story world, country for **fictional story distribution only**, mission, expressive voice, goal, fear, contradiction, optional appearance cues and content pillars. The private output includes a story hook, bio proposal, direction, content series, initial draft and an explicit content/safety contract. Unknown and forged privilege fields are rejected. Rights and canon are **never considered verified** from a text entry.

This is reusable beyond PRIM3: the first 13 House Agents are a test cohort, not a baked-in roster. New creator characters get narrative board `other` until a reviewed, separately approved cross-IP binding exists.

## Creation funnel

`Concept → Compile → Private preview → Save revision → Canon approval → Rights review → Asset pack → Pilot scene → Human quality review → Character-ready → Native publication → External channels`

The current PR implements only the first **four** steps. The remaining steps depend on production-grade evidence, moderation, and separately approved migrations.

- **Character identity:** unique org-scoped handle, fictional actor type, story world, approved canon references.
- **Personality:** voice, primary desire, fear, contradiction, editorial mission, topics, knowledge/spoiler boundary.
- **Look & sound:** textual art brief before model usage; image turnaround/pose sheet and original licensed voice later, with provenance.
- **Performance:** own or properly consented source clips, actor replacement, temporal consistency, QC and human review; PR #546 provides a non-spending *shot planner*, not an end-to-end video performer.
- **Operations:** agent capability grants, scoped Core memory, budget, scheduled drafts and review receipts before each post.
- **Social layer:** genuine humans and declared fictional system actors share a feed only after typed-authorship, block/mute/report and ownership moderation are implemented.

## Rights, safety, privacy and commercial gates

- No real-person impersonation, face/voice cloning or derivative training without verified rights, license and consent. A typed claim of source IP is never proof.
- Character profile and material must clearly disclose fictional/AI-assisted nature. No manufactured follower numbers, human verification, claims of real-world attendance, fake news or secretly fake endorsements.
- Fictional story distribution geography does **not** reveal or infer real people's locations, and never increments human member/mission aggregates.
- PRIM3 canon spoilers, especially Royce's proposed engineered-origin reveal, stay in the authorized story vault until release.
- No unreviewed synthetic-media publishing, automated social replies, platform credential collection in the browser or unmetered model spending.
- Multi-tenant SaaS requires customer organization roles, per-tenant isolation tests, license ledger, account claims/collisions, abuse handling, capability-specific pricing/quotas, portability/export, retention/deletion policy, terms and updated Privacy Policy.

## Commercial packaging — proposal, not a live entitlement

1. **Creator:** build several private identities and manually approve draft media; usage charged separately.
2. **Studio:** collaborating roles, version history, branded worlds, approved media generation, review calendar and asset rights.
3. **Agency / White-label:** client organizations, seats, per-client permissions, brand templates and audited external channel publishing.

Set actual plan prices and included generation minutes only after provider cost-of-goods, refund/abuse and latency measurements. Each video/model job requires a budget guard *before* queueing. No plan should promise unlimited high-compute rendering.

**North-star metric:** characters with approved reference pack, at least one consistent usable 5–15-second pilot scene and a verified, rights-cleared publishing receipt—not number of fake accounts/posts. Secondary metrics: time to first private dossier, human edit acceptance, continuity defects, cost per approved second of video, repeat 30-day studio usage, authorized channel click-through.

## Release checklist

- [x] Shared schema/validation compiler and non-spending preview
- [x] Native Control Create → Characters editor and proposed story/persona preview
- [x] Transactional draft account + revision-1 SQL, both pending
- [x] Owner-gated API; separate M Account and fictional system actor identity
- [x] Adversarial tests for unauthorized access, privilege injection, fiction, spend/publishing invariants
- [ ] Full CI green on the stacked Character Studio PR, Playwright owner preview on phone and desktop
- [ ] Staging SQL replay with real RLS authorization/negative tests, owner approval and deployment decision
- [ ] Version 2 editing and audit history, name/handle conflict UX, deletion/export governance
- [ ] Asset rights/references, character sheet generator, real approved 5–15-second sample performance
- [ ] Per-character Core draft agents and safe prompt/knowledge isolation, with receipts
- [ ] Typed native posting and full moderation, followed by official social channel integration
- [ ] SaaS entitlements, per-org studio roles and billing, privacy and platform-policy sign-off

**Do not merge/deploy/apply SQL** simply because compilation tests pass. The Studio feature is stacked on the draft House Agents branch, and the pilot must remain private until security and business release gates pass.
