# PRIM3 Halo Mission Selector Spec

The mission-control screen is a planet-first deployment interface inspired by the strategic rhythm of globe-based mission selection without copying proprietary art, assets, maps, code, branding, or UI layouts.

## Default state

- Camera begins with the Earth framed as a tactical globe.
- America/Site 0 is the deployment origin for campaign travel unless later canon changes the origin.
- Available missions appear as game markers only; no live operational Halo Ops markers are visible.
- Locked missions may appear as subdued regional signals without exposing future briefing content.
- Selecting a marker opens a mission dossier with country, broad region, fictional facility name, learning objective, cast, risk/conditions, rewards/unlocks, and deployment action.

## Deployment sequence

1. player selects one available mission;
2. globe focuses the country and selected regional site;
3. mission dossier opens;
4. player confirms deployment;
5. deployment arc animates from the current/origin base to mission region;
6. game transitions to briefing/loadout/site experience;
7. completion writes only PRIM3 game progress/state;
8. globe returns with updated unlocks/world state.

## Arc behavior

Each of the 21 core arcs owns one country. Its A/B/C missions occupy three distinct broad regions/sites within that country. Completing A unlocks or informs B; B unlocks/informs C unless a future curriculum rule explicitly allows branching. The country remains recognizable across the triad while environment, facility type, pressure, characters, and mission mechanics change.

## World layers

Initial layers: campaign missions, regional boundaries, deployment arcs, fictional Site 0/home base, story/intel overlays, completed operations, and optional environmental context. Future layers can be added through the shared Halo renderer interface, not by connecting the game to production Halo Ops feeds.

## UI identity

PRIM3 Halo should feel like its own command interface: dark strategic presentation, global scale, cinematic camera motion, high information density, and strong mission hierarchy. It should not imitate XCOM's visual assets or exact composition. Hitman's Halo/PRIM3 visual language remains canonical.
