# Equity Uprise Level 07 — Ecosystem Routing Contract

> Status: **CANONICAL CROSS-SITE SEMANTICS — LOCKED**  
> Scope: website/building ecosystem behavior, not roof geometry.  
> This document exists so future agents and implementations understand what Level 7 means even when no current destination map has been designed.

## 1. Core rule

**Level 7 — Roof / Mobility Portal is the ecosystem plane.**

Equity Uprise is one website/building in a larger network.

The Level 7 roof is the canonical place where:
- a user leaves Equity Uprise for another website/building;
- a user may arrive back at Equity Uprise from another website/building;
- destination selection is translated into a cinematic mobility/departure interaction.

This semantic role is permanent unless the owner explicitly changes it.

## 2. Architecture vs ecosystem data

The roof architecture is destination-agnostic.

Do **not** modify roof geometry because:
- a new website is added;
- a website is removed;
- a destination changes domain;
- a destination gets a new building representation;
- an access rule changes.

The architecture provides the portal infrastructure.

The ecosystem registry provides the destinations.

## 3. Canonical travel metaphor

The current canonical transition metaphor is:
- helicopter / vertical-lift departure and arrival.

It may later support:
- eVTOL/VTOL variants;
- other owner-approved mobility representations.

A fixed-wing runway is not part of the canonical concept.

The travel metaphor is digital narrative. It does not by itself establish a real-world aviation operation.

## 4. Destination registry

Future implementation should maintain a data-driven destination registry.

Recommended minimum fields:

- `id` — stable destination identifier
- `display_name` — human-facing name
- `url` — canonical destination URL/domain
- `scene_id` — destination building/place representation
- `arrival_route` — destination landing/arrival state
- `departure_asset` — optional transition asset
- `arrival_asset` — optional transition asset
- `access` — public/authenticated/restricted/etc.
- `enabled` — whether destination is currently available
- `return_route` — how that site returns to Equity Uprise
- `metadata` — optional non-geometric data

This document does not define actual destinations yet.

## 5. Destination rendering

Destinations may be represented in the Level 7 experience as:
- UI list/selector;
- skyline markers;
- distant buildings;
- map-like overlay;
- holographic/graphic overlay;
- aircraft destination display;
- other owner-approved interface.

Those representations are **interface layers**, not roof geometry authority.

Do not bake all destinations into:
- DXF;
- SVG roof plan;
- permanent signage;
- physical building massing.

## 6. Departure contract

Conceptual departure sequence:

1. user reaches Level 7;
2. routing interface loads enabled destinations;
3. user selects a destination;
4. system resolves URL + scene/transition metadata;
5. Level 7 enters a departure state;
6. helicopter/vertical-lift transition plays;
7. navigation crosses to the destination site;
8. destination receives arrival context if supported.

The final technical implementation may vary, but the semantic experience should remain recognizable.

## 7. Arrival contract

A compatible ecosystem website may route back to Equity Uprise with:
- Level 7 as the default return point;
- optional arrival metadata;
- optional return-transition state;
- optional originating-site context.

If no arrival metadata exists, Equity Uprise may load Level 7 in its normal idle/arrival state.

## 8. Deep links

Individual destinations may still support direct deep links to their own pages.

The roof portal does not replace ordinary web navigation.

It is the canonical immersive navigation layer for the ecosystem experience.

## 9. Security and trust

Destination registry entries should be controlled by the McCluster/Equity Uprise platform authority.

Future implementation should:
- validate allowed destination URLs;
- avoid arbitrary untrusted redirect injection;
- distinguish external destinations;
- preserve authentication/session boundaries correctly;
- avoid exposing secrets in routing metadata.

## 10. Cross-site consistency

When other website-buildings are created, they should be able to register:
- their building/location identity;
- their arrival/departure scene;
- their return route;
- their destination metadata.

They do not have to copy Equity Uprise's building architecture.

The shared concept is the **ecosystem travel layer**, not identical buildings.

## 11. Future-agent rule

Any agent working on:
- another website/building in the ecosystem;
- cross-site navigation;
- helicopter/VTOL transitions;
- a world/city master;
- destination selection;
- arrival/departure scenes;
- external-building representations

must understand that Level 7 is the originating canonical ecosystem plane for Equity Uprise.

Do not invent a separate unrelated cross-site hub without explicit owner approval.

## 12. One-sentence authority

**The Level 7 roof is permanent portal infrastructure; the website ecosystem is dynamic routing data layered onto it.**
