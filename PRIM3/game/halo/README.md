# PRIM3 Halo

This directory is the canonical root for the fictional PRIM3 Hitman's Halo game layer.

It is deliberately isolated from the real Halo Ops operational data plane. Real geography may be used for world grounding; mission facilities, incidents, operational intelligence, and scenario state are fictional unless a canon source explicitly states otherwise.

## Boundaries

- Do not consume live Halo Ops feeds.
- Do not reuse production operational credentials.
- Do not mix real CRM, telemetry, flight, deployment, or private operational records into game state.
- Generic renderer/UI/geospatial packages may be shared when they contain no operational data or credentials.
- The legacy `_unfinished/site0-game/` is reference material only; harvest assets/code after provenance review rather than making it the canonical data source.

## Campaign

`campaign.v1.json` defines the structural 66-mission campaign: three introductions plus 21 three-mission learning arcs. Country, region, site, facility, and character assignments remain null until the roster/curriculum/geography research gate is complete.
