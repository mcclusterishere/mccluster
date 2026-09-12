# Hitman's Halo World Canon v1

Status: structural canon. Country/site assignments remain research-gated until the authoritative PRIM3 character/jurisdiction roster and curriculum mapping are reconciled.

## Canon decision

Hitman's Halo has two deployments that share presentation/engine primitives but never share operational state.

### Halo Ops — real operational world

Halo Ops is the authenticated McCluster operational surface. It may visualize approved real-world data, real assets, real workflows, and real operational context. It is not a videogame database and it is not a source of game-world mission intelligence.

### PRIM3 Halo — fictional game world

PRIM3 Halo is an Earth-only videogame world inside the PRIM3 product namespace. It uses real countries and real geographic regions for spatial grounding, but facilities, incidents, mission intelligence, adversaries, operational events, exact sites, and scenario data are fictional unless a canon record explicitly says otherwise.

PRIM3 Halo MUST NOT ingest live Halo Ops feeds such as live flights, real operational telemetry, live intelligence, private CRM data, real deployments, or other production operational streams.

## Shared-engine rule

Do not clone the real Halo data plane. Share only generic software primitives that are safe and useful in both products: globe/map renderer, camera controls, layer framework, clustering, route animation, selection state, cards/panels, scene transitions, and generic geospatial utilities.

The two products must have separate API namespaces, data models, access policy, caches, event streams, and persisted state. A renderer package may be shared; production records may not.

## Campaign structure

PRIM3 Halo begins on Earth and contains 66 canonical campaign missions:

- 3 introduction missions in three distinct locations.
- 21 curriculum/episode cores.
- Every core is assigned one real country or coherent national region.
- Every core contains three missions in three distinct geographic areas/sites within that same country.
- 21 cores × 3 variants = 63 core missions; 63 + 3 introductions = 66 total.

The three variants teach the same core learning objective through escalating forms:

- Variant A — recognize and orient: identify the system, signal, pattern, risk, or principle.
- Variant B — operate and apply: use the principle in an active mission problem.
- Variant C — adapt under pressure: solve a changed, adversarial, resource-constrained, or time-sensitive version without changing the learning objective.

A country must not be chosen randomly. Assignment is driven by character jurisdiction/heritage/canon fit, curriculum fit, geography, architecture/infrastructure/ecology, narrative contrast, and representation across the global campaign.

## Geography and fiction boundary

The game may use real countries, cities, regions, terrain, climate, coastlines, languages, cultural references, and publicly documented geography. Exact mission facilities are fictional. Do not portray a real sensitive military, intelligence, critical-infrastructure, or government facility as the mission target simply because it exists in the chosen region.

Each fictional facility record must include a clear fiction marker and may use a real broad region for placement without claiming the facility exists.

## Character and jurisdiction rule

Country allocation is research-gated. Before the 21 core countries become final canon, build one authoritative roster joining every current PRIM3 character to the best-supported jurisdiction/country/region and the canon sources that establish the relationship. No country assignment becomes canonical from memory or guesswork.

Characters can participate outside their home jurisdiction when story logic supports it, but the roster relationship should influence mission casting and regional narrative.

## Isolation contract

Canonical namespace for game assets/data: `PRIM3/game/halo/`.

Recommended persistent data namespace: `prim3_game` inside the canonical McCluster Supabase control plane, with independent RLS and service boundaries. Do not create a second shadow backend merely for the game unless an isolation requirement later proves schema-level isolation insufficient.

Recommended API namespace: `/v1/prim3/game/*`.

Halo Ops remains outside that namespace and retains production-grade authentication and operational-data policy.

## Hosting contract

Both products must be hosted.

- Halo Ops: authenticated McCluster backend surface, reachable after McCluster identity/authentication and served through the existing Cloudflare/OVH architecture; origin services remain private/loopback or private-network only.
- PRIM3 Halo: separately addressable game surface backed by the isolated PRIM3 game namespace. Public/learner access policy can differ from Halo Ops, but it must never obtain Halo Ops credentials or datasets.

## Existing Site 0 game shell

The legacy `_unfinished/site0-game/` tree is reference material, not the new canonical game root. Useful UI/game assets may be harvested after provenance review. Its long-standing fictional-scenario boundary is preserved: game presentation must not falsely claim real government authority or turn real operational data into fiction without an explicit reviewed transformation.

## Mission record minimum

Every canonical mission ultimately needs: mission ID; curriculum/core ID; variant; country; region; fictional site/facility; learning objective; primary/support characters; mission type; environmental/architectural traits; briefing; success/failure conditions; unlock dependencies; reusable assets; and canon/provenance references.

## Research gate

The seed campaign intentionally leaves countries/sites null until three sources are reconciled:

1. authoritative current PRIM3 character roster and jurisdictions;
2. canonical 21 curriculum/episode cores behind the 66-mission structure;
3. geographic research for candidate countries/regions.

Once reconciled, country/site assignment becomes a reviewed canon change rather than ad-hoc map data.
