# MCCLUSTER CONTROL PLANE — READ THIS FIRST

This file is the law for every McCluster repository, every Cloudflare project, and every agent (ChatGPT, Claude, Codex, Cursor, Gemini, Copilot, Grok).

If you skip it, you will invent a second backend, race a git push, or break a client product. That is exactly how the last agents failed.

## The plane

| Piece | Canonical |
| --- | --- |
| GitHub control repo | `mcclusterishere/mccluster` |
| GitHub org | `McCluster-Corp` |
| Cloudflare project + Worker | `mccluster` |
| Worker source | `workers/mccluster` |
| Matthew McCluster's property (personal) | `https://matthew.mccluster.org` (GitHub Pages, this repo) |
| McCluster Corp's property (company) | `https://mccluster.org`: a different site about a different entity, served by Worker `mccluster` by host once routed. See `docs/control-plane/DOMAINS-AND-ENTITIES.md` |
| API | `https://api.mccluster.org` |
| Supabase | project `zmnhbrjyhxzhkxmhkexs` (`https://zmnhbrjyhxzhkxmhkexs.supabase.co`) |
| Persistent execution | OVH McCluster Core from `core/`, promoted through `deploy/ovh-production`: not a Worker and not a second backend. See `docs/control-plane/ECOSYSTEM.md` and `docs/control-plane/MCCLUSTER-CORE.md` |
| Durable Object class that MUST stay exported | `HereTenantAgent` |

**There is no Worker named `mccluster-core`. Do not create one.**
The canonical API Worker is `mccluster`. The approved `mccluster-mcp` extraction is a stateless transport edge for the same Core and Supabase authority; see the paired canonical architecture documents. Only call routes actually served by these Workers.

**McCluster is the backend AND the control plane.** Product repos are satellites. Client sites are tenants. None of them own auth, billing, social, CRM, or admin.

`Here` is the old website repo. Do not deploy matthew.mccluster.org or mccluster.org from `Here`.

## Hard rules

1. **Do not create a competing backend.** No new auth stack, no new Postgres, no new admin, no new social scheduler, no new Stripe account, in a satellite repo.
2. **Do not auto-push CI onto feature branches.** LiDAR and other heavy jobs use `workflow_dispatch` and artifacts. They never `git push` onto an open PR branch.
3. **Do not overwrite `index.html` or a client's shipping UI** unless the owner named that file in the task.
4. **Cloudflare Worker `mccluster` is not a Node compile of the whole git tree.** Source lives at `workers/mccluster`. Dashboard Root directory is `workers/mccluster`. Deploy command is `npx wrangler deploy`. The public site is static and ships to `matthew.mccluster.org` from this repo, not from `Here`. Do not create `mccluster-core`.
5. **Supabase `zmnhbrjyhxzhkxmhkexs` is the shared data plane.** New tables belong there (or on the Control desk). Public anon key is public by design; RLS is the wall.
6. **Client social is a McCluster service.** Every client backend gets accounts, campaigns, and a queue on the plane. Satellites may display and submit. They are not the source of truth.
7. **Preserve local product law.** PRIM3 Site 0, Uprise World, and any repo-specific gates below this section still apply. Control-plane law does not delete them.
8. **If a task wants you to "rebuild", "simplify", or "migrate to a new stack": stop.** Route the work through McCluster. Ask only if the owner is explicitly retiring a satellite.
9. **Do not invent infrastructure names.** The Worker is `mccluster`. The API host is `api.mccluster.org`. If a name is not in this table, it does not exist.
10. **Keep exporting `HereTenantAgent`.** Worker `mccluster` already has Durable Objects of that class. A deploy that drops the export dies with Cloudflare error 10064. Do not run a delete-class migration unless the owner says wipe those objects.
11. **Never draw a logo.** See the section below. This one has already cost a rewrite.
12. **`mcclusterishere/Here` is dead.** It publishes nothing: its deploy workflows are disabled and it has no CNAME. Do not write to it. If a task seems to want it, say so in the chat and work here instead.
13. **Canonical AI name: McCluster.** The resident AI is named **McCluster**. In UI copy, prompts, docs, tests, logs, and operator-facing language, use `McCluster` or `McCluster AI`. Never shorten the AI name to `Cluster`. Generic technical uses of the noun “cluster” are unaffected.
14. **Mobile first, responsive up.** Every interface built from a Mobbin reference, or from any reference, is designed at phone width first and then given room on tablet and desktop. Breakpoints only ever ADD: they widen a layout or add a column, never hide something the phone was shown or claw back a decision the phone layout made. Concretely, and checked rather than assumed:
    - `@media (min-width: …)`, never `max-width`. A `max-width` query means the design was drawn for a desktop and is being taken back on a phone, which is the wrong way round.
    - `minmax(0, 1fr)`, never a bare `1fr`. `1fr` means `minmax(AUTO, 1fr)`, and that auto floor is the widest min-content in the track, so one unbreakable child pushes the track past its own container and the page scrolls sideways.
    - Form controls at `max(16px, …)`. Anything smaller makes iOS zoom the whole page on focus.
    - Never `user-scalable=no` or `maximum-scale=1`. Blocking pinch zoom fails WCAG 1.4.4.
    - SVG text is sized in USER UNITS and shrinks with the viewBox, so a chart that is legible at 1440 can render 4px type on a phone. Size it for the phone and scale down at a breakpoint, not the reverse.
    - Verify by rendering at 390px and measuring `scrollWidth` against `clientWidth`. They must be equal. Eyeballing a screenshot does not catch a 25px overflow.
15. **Two properties, two entities. Never collapse them.** `https://mccluster.org/` is **McCluster Corp's** house: it answers "what is McCluster Corp?", and its metadata, share cards, Organization data and navigation are company-first. `https://matthew.mccluster.org/` is **Matthew McCluster's** house: person, résumé, engineering, portfolio, photography, music. The I AM HERE album is a front door to Matthew's house, not its identity and never the company's homepage. Hierarchy: Matthew McCluster founded McCluster Corp; McCluster Corp operates Equity Uprise (the public brand, owner 2026-10-28: "the public brand is Equity Uprise, not Human Uprise"; the public-interest project and its movement-creation social platform, the Equity Uprise World, formerly Human Uprise and before that the Uprise Action Network; "Human Uprise" survives only as a legacy technical identifier: the humanuprise.com host, file, function, class, storage-key, event and path names, `@id`s), PRIM3 (learning product, not a recording alias) and the McCluster Platform; **Whip Equipped LLC is Matthew's separate company, never a McCluster Corp sub-brand**; I AM HERE is Matthew's album, published through the ecosystem. Stable `@id`s do not move: Person `https://matthew.mccluster.org/#matthew-mccluster`; Organization `https://matthew.mccluster.org/#mccluster-corp`, whose `url` is `https://mccluster.org/`. Company *apps* (the Equity Uprise World, accounts, checkout, campaigns) stay on their working URLs because sessions and returns are origin-bound; ownership changes navigation and metadata, not URLs. Authority: `data/seo/domain-architecture.json` and `docs/control-plane/DOMAINS-AND-ENTITIES.md`; tests enforce it. **Three hosts, still two entities:** the World's door today is `https://mccluster.org/` (owner, 2026-10-15: the company host's root serves the World, `workers/mccluster/src/company-site/router.js` on the shared `workers/mccluster/src/world-host.js`; the company page is `/company`; the bar's Globe goes there from Matthew's site). The World also has a legacy-named door of its own, `https://humanuprise.com/` (owner, 2026-10-14), a McCluster Corp host served by the one Worker by host (`workers/mccluster/src/human-uprise/router.js`), inert until the owner routes it; on either World host, Music, the M and every creator page send to Matthew's property. Sessions are per origin, and one M Account works on every host because the bar carries a member's sign-in across (`js/tabbar.js` → `POST /v1/auth/handoff`, `workers/mccluster/src/auth-handoff.js`; the arriving host earns its own session, no refresh token crosses).

## AI work: read the harness first

Read `docs/control-plane/AI-HARNESS.md` before any AI, agent, memory, RAG, conversation-history, provider-routing, or autonomous-company work. Private cross-model context lives in Supabase schema `ai_context`, not in public Git: never commit raw ChatGPT, Claude, Grok, Gemini, Copilot, local-model or other provider transcripts to this repository. Every provider is a replaceable adapter that normalizes into the authenticated `context-ingest` contract and retrieves from the one McCluster context plane. No AI provider owns memory: do not create a shadow vector store, a second conversation database, a raw-chat directory, a separate memory service or a competing context source. Git holds schemas, adapters, policies, tests and intentionally public-safe summaries; Supabase holds the private corpus and its provenance.

## Autonomous operations contract

This contract applies to every agent that runs unattended here, whatever vendor it comes from.

McCluster is an event-driven operating system, not a collection of disconnected assistants.

Canonical operational state lives in Supabase project `zmnhbrjyhxzhkxmhkexs`. Existing outreach CRM tables include `out_companies`, `out_contacts`, `out_campaigns`, `out_recipients`, and `out_events`. The autonomous operations layer includes `ops_objectives`, `ops_signals`, `ops_lead_scores`, `ops_agent_jobs`, `ops_recommendations`, and `ops_repo_events`.

When working in this repository:

- Reuse the canonical backend and schemas; do not create parallel CRM databases, shadow lead lists, or competing sources of truth.
- Treat repository changes, tests, deployment results, CRM engagement, research findings, and campaign outcomes as signals that should feed the operating layer.
- Prefer event-driven jobs plus scheduled reconciliation over one-off scripts.
- Keep lead/account scoring adaptive: engagement, urgency, fit, and momentum may expand or shrink campaign scope.
- New objectives and campaigns may be proposed automatically from evidence, but proposals must be written as recommendations before external execution.
- Autonomous agents MAY research, classify, score, reconcile, test, lint, analyze, draft, queue jobs, and propose next actions.
- Autonomous agents MUST NOT send external communications, merge/deploy production code, spend money, delete production data, change authentication/authorization, or perform destructive migrations without explicit human approval.
- Every organized outbound message must obey `docs/control-plane/OUTREACH-CRM-INVARIANT.md`; the CRM/database is the source of truth and Gmail `CRM Linked` is only an audit marker after successful database linkage.
- Never invent contact metadata, consent, replies, opens, clicks, titles, or company facts. Unknown is a valid value.
- Make jobs idempotent where possible and record enough provenance to explain why a score, recommendation, or scope change happened.
- Tests are part of the product. Code-changing agents should run the relevant tests and record outcomes before proposing or completing a change.

The desired steady state is continuous maintenance: ingest signals, reconcile state, score priorities, run safe checks, surface anomalies, and prepare high-value next actions while the owner is offline. Human approval gates remain mandatory for consequential external or production actions.

## THE LOGOS ARE NOT YOURS TO DRAW

**The artwork the owner supplies is the only source of truth for any mark, forever.**

This is not a style preference. An agent once shipped `assets/we-icon.svg` —
five rectangles and a hand-plotted path approximating the Whip Equipped
wrench — into three repositories, and a later agent (this one) compounded it
by inventing a black rounded plate to sit the mark on because the supplied
lockup did not crop to one. Neither was the logo. Both had to be torn out of
four repositories.

Rules, no exceptions:

- **Do not draw, trace, approximate, or "reconstruct" a logo** in SVG, CSS,
  canvas, or anything else. Not as a placeholder. Not "until the real one
  arrives". Not at a size where you think it will not matter.
- **Do not recolour a supplied mark.** If it does not read on a ground, the
  answer is the variant the owner supplied for that ground, or a plate the
  brand itself uses — never a hue you picked.
- **Do not composite one.** Do not crop supplied artwork. Scale the complete supplied artwork proportionally only. Adding a shape
  the supplied file does not contain is drawing.
- **If the variant you need does not exist, ask for it.** A missing asset is a
  question for the owner, not a gap to fill. Variants the owner has asked for
  by name are theirs, not ours, and stay: the Equity Uprise emblem without its
  white tile (`assets/img/equity-uprise-mark.png`, owner 2026-10-15: "cut the
  white part out … keep the dark part") and the same shape painted white for
  the World's dark grounds (`assets/img/equity-uprise-mark-white.png`, owner
  2026-10-15: "make the actual … sign white. Just paint it white for me").
  Both are made from the supplied file's own pixels: nothing traced, cropped
  or added.
- **Do not write a mark out in words where the mark is the control.** The
  Equity Uprise emblem (`assets/img/equity-uprise-logo.webp`) is the join
  on the Equity Uprise World screen, and it stands alone: no caption, no
  wordmark, no chevron beside it, no spelled-out name in product copy
  (owner, 2026-10-14: "just the symbol; I never want to state it; I just
  want to use the mark, never work it out"). Give the control an accessible
  name that says what it does, not what the mark is called.
- **For PRIM3 specifically, use the full uncropped owner-supplied artwork.** Resize only by proportional scaling; never crop a PRIM3 mark or lockup to make it fit a UI slot.

### Whip Equipped — the supplied kit

Under `assets/img/`, preserve the complete supplied artwork when resizing. Do not create new cropped variants. Existing derivatives are not authority to crop future artwork:

| File | What it is | Ground |
| --- | --- | --- |
| `we-logo.png` | full lockup, black tile, black wordmark | light |
| `we-logo-dark.png` | full lockup, white tile, white wordmark | dark |
| `we-icon.png` | app icon, black tile | light |
| `we-icon-dark.png` | app icon, white tile | dark |
| `we-icon-bar.png` / `we-icon-dark-bar.png` | the same icons at bar size | light / dark |
| `we-mark.png` | the wrench alone, gradient | |
| `we-mark-white.png` | the wrench alone, white | |

The three app repositories carry `assets/we-icon.png`, `we-logo.png`,
`we-mark.png` and `we-mark-white.png` from the same source.

If you find `we-icon.svg`, `we-mark-bar.webp`, or any `.webp` of this logo
anywhere: it is the drawn one. Delete it, do not reference it.

## Files every agent must honor

### Shared website navigation

Owner direction, 2026-10-16: all admin destinations are reachable from the shared
bottom control bar; profile/account stay at the top right. Do not add another
global admin sidebar, header tab strip or floating destination menu. Add native
Control routes to the existing workspace route inventory so the bottom navigator
inherits them. Keep local filters, chapter tabs and editor tools within their
destination. Embedded frames retain host-owned navigation. See
`docs/control-plane/SHARED-NAVIGATION.md` for the implementation and release scope.

### Public World: the social feed (travel and missions kept, switched off)

Owner, 2026-10-20: "Until I refine the other features the transport and the
missions feature will be taken off and the social feature will be the only
feature with no tab selecting between the other two." "Keep the social feed on
and then develop those other projects in the back end. Probably keep all three
on admin." The World (`mnet.html`) opens on the **feed only** for everyone:
`hu-social-only` on `<html>` is the switch, and `missions=0` tells the globe.
Travel and Missions are **preserved, not deleted**: their code and suites stay
(`scripts/e2e/world-switch.mjs` drives them with the switch removed), and the
**house owner** keeps all three tabs (`js/world-owner-modes.js`, the server's
owner check). Turning them back on for everyone is removing the switch. This
supersedes the travel-first entry below until the owner turns them back on.

Owner correction, 2026-10-17 (superseded for now by 2026-10-20 above): the logged-out World homepage is **travel first**.
Before changing its presentation or default content, read
`docs/travel/TRAVEL-FIRST-WORLD-STANDARD-20261017.md` and its preserved approved
reference. The guest starts in **Travel**, beside **Missions** and **Posts**, with
the cinematic globe, destination search and **Your whole journey** planner as
the focus. The mission/community-first public entry is superseded. Keep shared
bottom navigation, top-right account/profile and internal-only intelligence
boundaries. Do not confuse this public travel surface with admin Analytics or
Matthew's personal homepage. The standard records the target; check the actual
implementation before claiming its journey or booking capabilities are live.

On the control repo:

- `AGENTS.md` (this law + local product gates)
- `docs/PRODUCT-ARCHITECTURE-ROADMAP.md` (canonical cross-product context; authority + Action Network + Control + commercial completion order)
- `data/product-context.json` (public machine-readable product map)
- the seven thin agent adapters, which point here and copy no rule: `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/mccluster.mdc`, `.github/copilot-instructions.md`, `.github/instructions/mccluster.instructions.md` (`scripts/test/domain-architecture.test.mjs` holds them to this)
- `docs/control-plane/ECOSYSTEM.md`
- `docs/control-plane/registry.json`

On every satellite, the satellite kit and nothing more: `docs/control-plane/SATELLITE.md` as the head of the satellite's `AGENTS.md`, plus the same seven adapters copied unchanged, pointing here. Satellites never copy this file's local product gates (the Equity Uprise building, Uprise World, PRIM3 Site 0 and Universe sections below): those belong to this repo, not to the plane. `docs/control-plane/ECOSYSTEM.md` → "Adding a satellite" is the procedure.

## Owner

Matthew McCluster / McCluster Corp (Connecticut public charity CHR.0069693). Operator desk is the McCluster Control admin.

---

# HERE — Codex Repository Instructions

## HITMAN PRIM3 Site 0 / Ground Zero fortress

Any task that touches Site 0, PRIM3 fortress geometry, Site 0 gameplay, level plans, collision, streaming, or the Ground Zero environment must first read:

- `assets/3d/prim3-site0/AGENTS.md`
- `assets/3d/prim3-site0/PRIM3_Site0_CANONICAL_ARCHITECTURE_v03.json`
- `assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v03_manifest.json`

The canonical production geometry is `assets/3d/prim3-site0/PRIM3_Site0_Master_Facility_v03.glb`. Do not revive the rejected v02 massing or the superseded B3-bypass-only rule. B3 Prime heavy deployment, centered V1/V2, R1/R2, the L1 through-road, the external P1 B3↔L3 lift, and the independent SOUTH B3-to-grade escape route are mandatory unless the architecture contract is deliberately revised in the same change.

### P1 / L3 interface — non-negotiable

P1 is an aircraft-carrier-style external heavy lift. At L3, its platform rises **flush with the SOUTH edge of the flight deck** and becomes a drive/tow surface into the deck apron/merge lane.

**Never recreate an elevated bridge, departure spur, viaduct, or support-pier structure projecting SOUTH from L3.** The old `L3_PRIME_ELEVATED_DEPARTURE_SPUR` and `L3_PRIME_SPUR_SUPPORT_*` geometry is rejected and forbidden.

The separate B3 SOUTH surface escape ramp reaches grade beyond the primary perimeter and does **not** reconnect to the roof.

## HERE portfolio visual direction — flat house system, no material skins

The industrial material program (Material System 2.0: marble ground, blackened-steel/chrome/obsidian/ruby-glass skins, the signature mark, `css/here-material.css`, `css/signature.css`, `js/here-material.js`, `js/signature.js`, `assets/brand/`) was **removed by the owner's call on 2026-08-15** after three visibly broken rollouts. Do not resurrect it, and do not re-skin the interface from `docs/design/INDUSTRIAL-MATERIAL-INTERFACE.md` or `docs/design/HERE-PREMIUM-RESKIN-IMPLEMENTATION.md` — those docs are kept as history only, not as direction.

The shipping aesthetic is the flat house system in `css/style.css` (cinema/gallery coats driven by `js/theme.js`). Visual work happens inside that system: tune tokens and components in place, keep the DOM-first architecture, and treat 3D as progressive enhancement, not a reason for an architectural rewrite.

This direction applies to the HERE portfolio/product shell and related business interfaces. It does **not** override Uprise World. Uprise World remains governed by the separate rules and roadmap below.

## Uprise World

Before modifying any Uprise World code, read all of the following completely:

- `docs/uprise-world/CODEX-IMPLEMENTATION-BIBLE.md`
- `docs/uprise-world/REFERENCE-MANIFEST.md`
- `docs/uprise-world/PROOF-ROOM-SPEC.md`
- `docs/uprise-world/SCREENSHOT-ACCEPTANCE-CRITERIA.md`
- `docs/uprise-world/PERFORMANCE-BUDGET.md`
- `docs/uprise-world/UPRISE-WORLD-ROADMAP.md`
- `docs/uprise-world/PHASE-0-AUDIT-INSTRUCTIONS.md`

### Current direction — decided 2026-08-10

**The shipping look is cel-shaded toon, and Living Sketch is deferred to a later skin.** The owner made this call explicitly.

What that means in practice:

- `MeshToonMaterial` + gradient ramps + `OutlineEffect` is the **current, sanctioned** renderer. It is not a stopgap and not a violation — do not "fix" it back toward Living Sketch.
- Gameplay, world, and rendering stay **separable**. New visual work goes through the material/outline layer rather than being welded into geometry or the update loop, so a Living Sketch pass can be swapped in later without touching locomotion, landmarks, keepers, or errands.
- Living Sketch remains the documented long-term target and its references stay canonical. Nothing in `docs/uprise-world/` is withdrawn. It is **parked**, not cancelled.
- The Phase 0/Phase 1 gating below still governs Living Sketch work. It does **not** block ordinary gameplay and polish work on the current toon build.

The reference for the current look is a cel-shaded low-poly spherical-world game; the technique (toon ramp + inverted-hull outlines, geometry generated from primitives, no imported meshes) is standard and was arrived at independently here. Build original work with it — never copy another site's assets, models, code, or copy.

### Living Sketch — the deferred target

**Living Sketch** is a hand-drawn mixed-media sketchbook world built from irregular ink contours, graphite construction marks, watercolor/marker washes, charcoal-gray grounding, red editorial scribbles, visible paper negative space, selective saturation, selective detail, and controlled human imperfection.

### The Living Sketch style board is ART STYLE ONLY — it is NOT A CHARACTER REFERENCE

`docs/uprise-world/references/style/living-sketch-style-reference-board.jpg` contains drawings of a person. **That person is not Matthew McCluster, is not the protagonist, and is not any character in Uprise World.** The figures in STYLE REF 01–04 are anonymous stand-in bodies that exist solely to demonstrate ink, graphite, wash, and paper technique.

- ✅ Use it for: line quality, construction marks, wash behavior, charcoal grounding, red editorial scribbles, paper negative space, unfinished hand-drawn edges.
- ❌ Never use it for: face, likeness, hair, skin tone, beard, build, age, clothing, colorway, pose-as-character-design, or identity — **for the main character or for any NPC**.

The blue jacket and black tee in those panels are **not** canonical wardrobe. The hair in those panels is **not** the protagonist's hair. The **STYLE 01** and **STYLE 02** panels inside `references/boards/canonical-visual-reference-board.jpg` are the same artwork and carry the same restriction, even though character-authoritative panels sit on the same page.

Character appearance comes only from the character likeness sheet, the raw `assets/likeness/` photographs, the wardrobe board, the exact emblem files, and the character panels of the composite and Proof Room boards. Read `docs/uprise-world/references/style/README.md` before using anything in `style/`.

### Non-negotiable rules

- Never implement **Living Sketch** as conventional 3D with a sketch/post-processing filter layered over the camera.
- Canonical user-supplied visual references outrank generated interpretations.
- Preserve working spherical locomotion, WebGL fallback behavior, landmark/check-in logic, mobile/touch controls, and data-driven world content unless a documented audit shows a concrete reason to change them.
- Do not expand the world map before the **Visual Proof Room** passes its acceptance criteria.
- Follow `UPRISE-WORLD-ROADMAP.md` in order.

### Phase 0 audit gate

**Phase 0 must be completed before any Proof Room implementation or other Uprise World application-code change.** Follow `docs/uprise-world/PHASE-0-AUDIT-INSTRUCTIONS.md`. No Phase 1 implementation may begin before explicit user approval.

## The Universe schema — one world, many universes

Any task that touches game worlds, level selectors, portals, or per-world saved state must first read:

- `docs/universe/UNIVERSE-SCHEMA.md`
- `docs/universe/universe-registry.json`

This schema does not relax any existing gate: Uprise World work still follows `docs/uprise-world/` phases, and Site 0 work still follows `assets/3d/prim3-site0/AGENTS.md`.


## EQUITY UPRISE BUILDING — LOCAL CONTEXT GATE

Before **any** Equity Uprise building/spatial task, first read:

`docs/design/equity-uprise-building/AGENTS.md`

Then run:

```bash
python docs/design/equity-uprise-building/production/audit_building_context.py
```

That local contract, master index, project-state ledger, historical-build register, and build pipeline exist specifically to prevent agents from missing completed work or rebuilding the project from partial context. If the audit fails, fix the context/index before implementation.

## EQUITY UPRISE BUILDING — SPATIAL AUTHORITY POINTER

The local contract above is the front door. For **any** Equity Uprise task involving geometry, architecture, floors, rooms, B1, the roof, building imagery, 360 panoramas, 3D environments, physical navigation, spatial transitions or spatial lore, read and obey, in this order, before designing, generating, rendering, coding or describing the environment:

1. `docs/design/equity-uprise-building/AGENTS.md` — the local contract and its mandatory preflight (`README.md`, `PROJECT-STATE.md`, `MASTER-INDEX.md`, the context audit above).
2. `docs/design/equity-uprise-building/REFERENCE-AUTHORITY.md` — the mandatory authority order: `docs/design/EQUITY-UPRISE-REPO-AUDIT.md`, `production/equity-uprise-capability-map-v2.json`, `docs/design/EQUITY-UPRISE-BUILDING-INVENTORY.md`, `BUILDING-CORE-V2-SPEC.md` with `production/building-core-v2.json` and `production/building-v2-validation.json`, `production/core-v2-floor-programs.json`, then the floor's own written spec, schematic-plan basis, Core V2 DXF/SVG and deterministic production package (`production/floor-0X/`, read after the spec and never above it). It names every current floor, B1 and Level 7 file, so no floor list is copied here.

Program status (what is reconciled, provisional or next), per-floor file lists and the B1 / Level 7 boundaries live in those files and in `PROJECT-STATE.md`, never in this file or in a vendor adapter. This file does not restate them.

What is law everywhere, each already stated by the targets above:

- **Generated images and renders are never geometry authority** (`REFERENCE-AUTHORITY.md`). Never move the elevator, stairs, risers, structural grid, footprint, entrances, floor program or 360 datum to improve a render, never invent spatial lore that conflicts with the canonical geometry, and never invent rooms, floors or departments the audited Equity Uprise program does not support.
- **Core V2 shared geometry is not floor-local** (`BUILDING-CORE-V2-SPEC.md`, `production/building-core-v2.json`): passenger elevator X54–62 / Y34–44; service/freight elevator X0–8 / Y60–72; Stair B X8–18 / Y54–72 (never the old X0–12 assumption); Stair A X60–72 / Y54–72; MEP/riser approximately X50–60 / Y66–72; finished-floor elevations 0 / 13.5 / 27 / 40.5 / 54 / 67.5 / 81 ft on the fixed 72' × 72' plate, both stairs spanning the full 13'-6" between finished floors. Floor-local files may add program but may not redefine shared vertical systems; the combined stacked building is the vertical-continuity authority and per-floor viewers are derived views. The service/freight elevator is not a substitute for a required exit, and nothing implies passenger-elevator service to Level 7.
- **Floor 1 is the building datum and the only normal public entrance** (`REFERENCE-AUTHORITY.md`, `BUILDING-CORE-V2-SPEC.md`): protected-stair discharge doors and the secure west service entrance/apron are not public entrances, and no upper floor gets an exterior door because a generated image wants one.
- **Never use the archived Core V1 DXF/SVG/PNG files for new work** (`REFERENCE-AUTHORITY.md` → Core V1 archive rule): `references/archive/core-v1/` is history and traceability only.
- **Every capability stays mapped** through `production/equity-uprise-capability-map-v2.json` with its implementation status and public/private/approval boundary; do not silently add, remove, relocate or publicize one in spatial work, and never expose a private or approval-gated system publicly. Run `python docs/design/equity-uprise-building/production/verify_equity_uprise_program_coverage.py` after program or routing changes.
- **B1 is restricted live infrastructure** (`BUILDING-CORE-V2-SPEC.md`, `EQUITY-UPRISE-BUILDING-INVENTORY.md`): learner/instructor work uses a sandboxed clone, and ordinary Equity Uprise admin does not inherit underground access.
- **All architecture remains schematic and NOT FOR CONSTRUCTION** pending licensed professional review.
- Do not confuse the Equity Uprise building with the separate `docs/uprise-world/` Living Sketch / Uprise World project; each keeps its own authority unless the owner explicitly requests a crossover.
