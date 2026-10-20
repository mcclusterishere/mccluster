# Hitman U.S. 50 — House Agents expansion (draft, not public)

**Source fiction:** `mcclusterishere/Prim3/world/HITMAN-US-50-STATE-CHAPTERS.v0.1.json` and companion authority proposal. Platform copy: `data/prim3/hitman-us-50-state-chapters.v0.1.json`.

**Purpose:** 50 fictional region-scoped Hitman captains, one per U.S. state, each commanding a proposed 4–7-person crew and having a distinct character personality, story conflict, editorial series, and reciprocal fictional cross-state rivalry. **The existing 13-character house cohort is unchanged.** There will eventually be *up to* 63 logical character accounts if all 50 new drafts are approved alongside the 13 originals, not 63 operational agents or 63 real human users.

The 2024 statewide presidential map is the fixed **narrative palette only** — 31 red established/legacy syndicates, 19 blue emerging street-crew coalitions. It is not a factual representation of American criminal activity, states' socioeconomic maturity, party members, racial groups, or real political governance. Maine is blue and Nebraska red by statewide winner. Source: https://www.archives.gov/electoral-college/2024.

The PRIM3 opening recurring **39-character cast remains intact**. Royce is national Hitman sovereign; the original twelve Hitman ensemble characters are national specialists without invented state residency. These new 50 are satellite-development characters until authorized by canon.

## Private data / geography

- Pending, review-only, **not applied** `supabase/pending/20261019213000_hitman_us_50_state_chapters_v1.sql` stages 50 proposed `house_system_accounts` system identities, strictly `account_status = 'draft'`, rights/region/canon flags false, zero autonomous spending, no auto-reply, no outbound publication, no scheduled posts.
- SQL is explicitly dependent on the prior `20261019210000_house_agent_accounts_v1.sql` House Agents migration. If a reference state region does not exist, it seeds `region_key = NULL` rather than hallucinating a place or failing on a FK.
- The `US-XX` key in the manifest means **fictional state jurisdiction**; not evidence of character residence or geolocation of a user, customer or real actor.
- The public house-agent view and World marker reads remain **published-only**, requiring canon-approved + region-approved + rights-verified. No drafts contribute to public region counts. In particular, seeding a fictional region on a draft does not make it a public live account.
- When future accounts are approved/published, globe region tap should show separately: fictional characters and their story affiliation, opt-in real human aggregate (privacy suppressed), verified real-world missions. Never add fictional story members to real human membership counts.
- D.C. is national council setting, not a 51st U.S. state chapter.

## Story topology

**Red chapters:** entrenched syndicate organizations, inherited office, formal governing councils, established internal diplomacy.

**Blue chapters:** younger, emergent neighborhood street and creative collectives, fragmented claims, informal coalitions, frequent leadership turnover.

**Contested states:** internal disputes and factions make elections and succession more dynamic, rather than making each chapter an unchanging partisan stereotype. Story reference only.

Example dramatic rivalries from the canon proposal:
- CT ↔ NY — small Connecticut story scene protects its identity against larger New York factions.
- CA ↔ NV — California's fragmented cultural crews challenge the Nevada entertainment commission.
- PA ↔ NJ — established charter disputes the rights of New Jersey's emerging bloc.
- WA ↔ ID — cooperative media scene and legacy council disagree over their code of conduct.
- TX ↔ NM — mature board and grassroots coalition contest who writes the regional charter.
- FL ↔ GA — two old councils compete over succession and prestige.
- IL ↔ IN — emerging cultural crews and mature syndicates contest the future of local governance.

All are scripted **fictional dramatic conflicts**, not calls to action against places or real-world criminal plots.

## Real digital-performer and agent implementation contract

Every approved captain needs: immutable character ID; versioned story & personality; nation-wide hierarchy link to Royce; state story jurisdiction, story producer, performance asset references, approved likeness and voice rights; fixed creative knowledge window and spoiler limits; own Core logical agent ID and private drafts; budget/permission receipts; independent pause, revoke, archive, export; visible AI-fiction disclosure and normal mute/block/report if the native social graph eventually publishes it.

There is **one** Supabase, one M Account system and one McCluster Core job/memory/control-plane stack. Fifty captains means fifty **logical character profiles/agent policies**, not fifty servers, fake M Account humans, bought followers, bots licensed to impersonate, or one social app per state.

## State click UX, once released

1. Tap a U.S. state polygon/region in the existing globe.
2. Show **Fictional HITMAN Chapter** clearly labeled, with approved chapter captain portrait, crest/crew name and story mission.
3. Show public *published* fictional character account count for that state separately from real opt-in humans.
4. Show only publicly authorized story arcs/rivalries; do not leak an unapproved character identity or twist.
5. Open a declared fictional AI-created profile, its actual native posts and reviewed media after typed actor authorship/blocked user reporting exists.

Do not invent a pin at a human home or infer users' locations. No fictional system account can satisfy a real-world action bounty or count as a genuine supporter.

## Activation / business gates

1. Owner locks regional roster and names within Prim3; exclude unintended identities, political or demographic stereotypes, and spoiler disclosures.
2. Apply both pending house migrations only in isolated staging first; verify RLS/tenant/read negatives and replay idempotence.
3. Review original art, performance/voice rights and publishable regional story provenance.
4. Ship one typed `system_actor` native author and moderation contract; do not forge `m_people`.
5. Pilot scripted social posts and budget-controlled per-account draft jobs with real approval receipts; then ramp to the 50.
6. Release state overlays only for individually approved published accounts. Expand agency SaaS as a licensed platform capability, not automatic permission to resell PRIM3 IP.

**Current state: exactly 50 proposed captain/agent account drafts in source files; 0 live new system accounts, 0 running agents, 0 public state markers.**
