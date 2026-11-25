# McCluster City Arcade — game factory and Designer Kicks pilot

Status: **owner-only, pending playtest/QA**. Draft PR prototype, not production-complete.

**Access (owner, 2026-11-03): the arcade is private at first, owner-only like the rest of the games, until it is playtested.** `city-arcade.html` is gated exactly like `fictional-city.html` and `game-hub.html`: `<meta name="robots" content="noindex, nofollow">`, the shared `js/owner-only.mjs` gate (a server-verified owner yes from `GET https://api.mccluster.org/v1/status`), the page markup in an inert `<template>`, and `js/city-arcade/app.mjs` listed only in `data-owner-load`, so no game code runs until the server says yes. It is out of the sitemap and out of public navigation; the Game Hub links to it beside McCluster City. Opening it to the public later is an owner decision (remove the gate, add it to the sitemap, and update `scripts/test/city-arcade.test.mjs` and `scripts/test/seo-entity-pages.test.mjs`). User-facing copy carries no "this is fictional" disclaimers (owner, 2026-11-03).

## Owner direction (2026-11-03)

Designer Kicks is its own **playable shoe-collector game**, not merely the interactive screenplay. Players collect fictional sneaker types, unlock and equip distinct powers, complete challenges, and choose whether to trigger fictional police responses. The original **The Robbery 1s** screenplay remains a separate canonical story mode: the player sandbox must not silently change Dave → donation bin → Malik → Harold → altar, character ages, scene order, or the pastor's unresolved ending.

Every commercial storefront has one small, replayable, standalone-compatible mini-game. Winning individual games should help discover the shared city. While the arcade is owner-only (above), the eventual public goal is that a player does not need the city to try a single game. Do not auto-publish clones to app stores.

## Existing stack — reuse, do not replace

- Existing owner-only city: `fictional-city.html` and `js/fictional-city/*`.
- Canonical original storefront ids and lore: `core/data/fictional-city/district.v1.json`.
- The teaching Game Hub has its own owner-only module host and a shipped `chem108/molecule-rush`; reuse its style of pure rules + presentation and, for now, the same shared owner gate (`js/owner-only.mjs`).
- Core Autonomous Game Studio: `docs/control-plane/AUTONOMOUS-GAME-STUDIO.md`, `core/src/game-studio/*`. Its v0.1 production planner is not an automatic game publishing machine. Connect Arcade-specific generation and bounded playtesting to that existing governance layer later.
- City geography: preserve real Bridgeport cities, street names and verified public facilities; only fictionalize private businesses/people. Existing fictional studio and campaign storefronts are fictional overlays, not real city government.

## Original demo (2026-11-03) — historical baseline

`city-arcade.html` loads `data/city-arcade/catalog.v1.json`. Two playable local-browser games currently exist:

1. **Designer Kicks · Sole Run**, a 7 × 7 deterministic **turn-based** mini prototype: collect Velocity 1s, Ghost Soles, Gravity Highs, Robbery 1s; equip powers; reach the exit before turn 32. A fictional shop encounter offers a legal challenge or a risky grab. Only reported risky behavior powers an abstract police response; interception causes a score fine and return to start. Three detentions or running out of turns ends the run. No real-city geometry or tactical policing patterns are simulated.
2. **GAURANFUCKING TEA · Tea Rush**, five rapid order-matching decisions with score and streak. A low-cost example of a shop-owned original mini-game.

The other **seven** original shop games have stable IDs and distinct planned concepts in the registry, **not playable code yet**. The arcade, like the full city, is owner-only until it has been playtested. Local scores are saved as `here.city-arcade.best.v1`; they **never** modify the existing city save key, credits, money, receipts, purchases, NPC interactions, or screenplay canon. No payment, real goods, account tokens, fraud-resistant leaderboards or App Store binaries.

The prototype is independent of Higgsfield, Blender or any GPU backend. 3D/film-quality assets are a **later** layer rather than a prerequisite for quick games.

## Shared factory contract (next implementation stage)

Each game definition should eventually include:
- `id`, `version`, `title`, `scope` (`city` or `store`), `placeId` (stable canonical private-commercial shop ID), `status`, distinct `genre`, `rating`, declared age-gating requirements.
- Source provenance, owner/tenant rights, original art/audio licenses, requirements, gameplay rules and acceptance tests.
- A sandboxed `mount(host, context)` interface, `destroy()` cleanup, keyboard/touch accessibility and deterministic time-bounded sessions.
- A stable **event contract**, e.g. `arcade.session.completed.v1`: `{gameId, gameVersion, sessionId, score, outcomes, seed, durationMs, clientBuild}`. Treat browser events as untrusted and do **not** grant real money or cross-world benefits merely from local events.
- Server-verified progress claims only after authentication, permission checks, anti-cheat validation and explicit consent for linking profiles. Never let an unauthenticated arcade write directly to the owner city save or private Core data.
- Deep links, icons, screenshots, localized metadata, iPhone layout tests, privacy manifest/data declarations, content-rating review and separate native packaging **only when a genuinely distinct standalone app is justified**.

A future public city portal can open a relevant game using `city-arcade.html?game=<id>`, and the game can explain where its fictional business lives in the larger universe. Avoid coupling to owner-only API routes or exposing private source files to the public page. A public consumer version of the world needs its own explicit auth and deployment design.

## Scalable content pipeline

`concept -> register -> original mechanics -> generate/author assets -> implement -> deterministic unit tests -> touch/keyboard gameplay test -> moderation/rating -> device performance -> preview -> independent review -> owner promotion`.

Reuse the existing autonomous Game Studio review, budget and source-provenance concepts. A game is not "ready" merely because AI generated code; one agent cannot approve its own work. Track retention, completion rate, average session time, crash-free sessions, difficulty and device performance per title. Build distinct genres rather than 100 reskinned copies of the same tapping game.

Possible next vertical slices: **Shoe Sort** (Robbery 1s Exchange), **Frame It** (RealCameraMen), **Parking Panic** (Baddies on Wheels), **Edit Rush** (PressureTV) and **Prop Lab** (Hitman Gear). All remain planned until playable code and tests exist.

## Apple App Store publishing constraints

Apple's current [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) include 4.3 (spam and excessive near-duplicate apps), 4.2 (minimum functionality) and 4.7 (HTML5/JS mini-games inside host apps, with metadata, moderation, privacy, age and permission requirements). A high-volume program should primarily publish **one distinct City Arcade host** and many unique web mini-games. Ship independent App Store titles only if they provide material mechanical and experiential differentiation and comply with policy. The platform, not automated upload volume, is the growth strategy.

## Acceptance / no false shipping claims

- Run `node --test scripts/test/city-arcade.test.mjs scripts/test/owner-only.test.mjs scripts/test/seo-entity-pages.test.mjs` and `node --check js/city-arcade/app.mjs`; the arcade must stay closed on an owner no.
- Verify keyboard, arrows, screen reader labels, 390px mobile layout, game restart, local-storage denied, deep links, achievement isolation, and no regression to the current 3D city.
- Confirm two prototypes load as static files through an HTTP server; test a real device before production.
- Keep all city canon, public geometry, owner access and save migrations unchanged.
- No auto-merge, no production deploy and no App Store submission from this draft.

The long-term Designer Kicks game expands from this 2D **system-validation slice** to 3D collection, equipment slots, multiplayer-compatible economy, missions, city-based NPC interactions, witness/case systems, arrest/legal consequences and creator-crafted custom shoes. The cinematic show remains a parallel content product, not the logic governing sandbox player progress.

## Local continuation (2026-11-04)

The graphical Tea Rush, sourced-street Sole Run, optional Fashion Police encounters, geographic entry/loading and owner mission/result controls are described in [the local review handoff](../city-arcade/LOCAL-REVIEW.md) and [product contract](../city-arcade/PRODUCT-CONTRACT.md). These replace the text/board UI in the local draft; the original deterministic board rules and save keys remain intact. Nothing in that handoff claims deployment or production permission verification.
