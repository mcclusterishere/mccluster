/* E=Up → Hitman's Halo: the owner's read of the Halo MODULE (not of its data). Owner-only through ./router.js.

   Hitman's Halo is the real-world intelligence and decision workspace: the four screens (World, Missions, People,
   Intelligence) on the full-screen globe at HALO_ROUTE (docs/control-plane/HALO-ADMIN-GLOBE.md). This section is what
   the Admin card and the Control entry read so they can say what is true about the module without opening it:

     module       the stable id, the one route and its four views
     access       who can open Halo today and what decides it. Today that is the house-owner release guard
                  (packages/release-policy/globe.mjs, ../world-release.js) and each route's own owner check.
     policy       the persisted 'halo' policy unit (./modules.js), read on this request, never cached:
                    available            the store answered for the unit (installed or not, state, revision)
                    unregistered         the store does not know the unit yet (the staged SQL is not applied)
                    schema_not_applied   the store has no module policy at all
                    unavailable          the read failed; nothing is assumed
     enforcement  policy_enforced is false: no Halo route reads the unit yet, so a state recorded for it neither opens
                  nor closes Halo. It is said here so "installed" or "enabled" is never read as "ready" or "open".
     feeds        every feed the Halo view DECLARES (js/halo/halo.js GROUPS), with the route it reads and whether the
                  Worker has what that route needs. `configured` is true / false where this file can check it (a
                  boolean, never a value) and null where it cannot: null is "not checked here", not "configured".

   Nothing here is feed data: no rows, no counts, no provider answer, no credential. A count belongs to the feed's
   own owner-gated route and to the Halo view that shows it. */
import { HALO_LAYERS, configured } from '../world-halo-layers.js';
import { TIDES_BASE, TIDES_LAYER_PATH } from '../world-halo-ops.js';
import { moduleControl, MODULE_PENDING_SQL } from './modules.js';

export const HALO_MODULE_ID = 'halo';
export const HALO_ROUTE = 'action-globe.html?explore=1&halo=1';
export const HALO_VIEWS = Object.freeze([
  Object.freeze({ id: 'world', label: 'World', route: HALO_ROUTE }),
  Object.freeze({ id: 'missions', label: 'Missions', route: 'action-globe.html?explore=1&halo=missions' }),
  Object.freeze({ id: 'people', label: 'People', route: 'action-globe.html?explore=1&halo=people' }),
  Object.freeze({ id: 'intel', label: 'Intelligence', route: 'action-globe.html?explore=1&halo=intel' })
]);

/* The feeds the Halo view declares, in its own order (js/halo/halo.js GROUPS; scripts/test/halo-module.test.mjs holds
   the two lists to each other). `layer` names a ../world-halo-layers.js layer whose requirement this file can check. */
const DECLARED = Object.freeze([
  { id: 'flights', label: 'Aircraft', group: 'Air & sea', route: '/v1/world/layers/flights', needs_map: true },
  { id: 'military', label: 'Military aircraft', group: 'Air & sea', layer: 'military' },
  { id: 'vessels', label: 'Ships (AIS)', group: 'Air & sea', layer: 'vessels' },
  { id: 'weather', label: 'Weather alerts (NOAA)', group: 'Earth & weather', layer: 'weather' },
  { id: 'natural', label: 'Natural events (NASA)', group: 'Earth & weather', layer: 'natural' },
  { id: 'quakes', label: 'Earthquakes', group: 'Earth & weather', layer: 'quakes' },
  { id: 'fires', label: 'Thermal hotspots (NASA FIRMS)', group: 'Earth & weather', layer: 'fires' },
  { id: 'tides', label: 'Water levels (NOAA)', group: 'Earth & weather', route: TIDES_LAYER_PATH, keyless: true, credit: TIDES_BASE.credit },
  { id: 'cyclones', label: 'Tropical cyclones (NOAA)', group: 'Earth & weather', layer: 'cyclones' },
  { id: 'perimeters', label: 'Wildfire perimeters', group: 'Earth & weather', layer: 'perimeters' },
  { id: 'satellites', label: 'Satellites', group: 'Space', route: '/v1/world/layers/satellites', needs_map: true },
  { id: 'launches', label: 'Launches', group: 'Space', route: '/v1/world/layers/launches', needs_map: true },
  { id: 'cctv', label: 'Cameras (CCTV)', group: 'Places & media', route: '/v1/world/cctv', needs_map: true },
  { id: 'missions', label: 'Missions', group: 'Field operations', route: '/v1/world/halo/missions' },
  { id: 'regions', label: 'Member regions (5 or more)', group: 'Field operations', route: null, needs_map: true },
  { id: 'intel', label: 'Intel events (evidence)', group: 'Field operations', route: '/v1/intel/geo', needs_map: true },
  { id: 'markets', label: 'Exchanges, GDP and listings', group: 'Markets', route: null, needs_map: true }
]);
export const HALO_DECLARED_FEED_IDS = Object.freeze(DECLARED.map((f) => f.id));

function feedRow(f, env) {
  const spec = f.layer ? HALO_LAYERS[f.layer] : null;
  const requires = spec && Array.isArray(spec.requires) ? [...spec.requires] : [];
  return {
    id: f.id, label: f.label, group: f.group,
    route: spec ? `/v1/world/layers/${f.layer}` : f.route,
    credit: spec ? spec.base.credit : (f.credit || null),
    requires,
    /* true / false only where the requirement is known to this file; null is "not checked here" */
    configured: spec ? configured(f.layer, env) : (f.keyless ? true : null),
    /* a feed that only draws on the globe cannot be listed while the map has not started */
    needs_map: f.needs_map === true
  };
}

const POLICY_UNREAD = Object.freeze({ registered: null, installed: null, state: null, revision: null, updated_at: null, last_command: null, pending_sql: MODULE_PENDING_SQL[HALO_MODULE_ID] });
/* The 'halo' unit, or exactly why it could not be said. A failed read is never completed with a guess. */
async function haloPolicy(env, ctx) {
  try {
    const control = await moduleControl(env, ctx.fetchImpl, ctx.fail, ctx.user.id, 1);
    const row = control.modules.find((m) => m.moduleId === HALO_MODULE_ID);
    if (!row) return { status: 'unavailable', reason: 'module_policy_unavailable', ...POLICY_UNREAD };
    const fields = { registered: row.registered === true, installed: row.installed, state: row.state, revision: row.revision, updated_at: row.updated_at, last_command: row.last_command, pending_sql: MODULE_PENDING_SQL[HALO_MODULE_ID] };
    return row.registered === false ? { status: 'unregistered', reason: 'module_not_registered', ...fields } : { status: 'available', reason: null, ...fields };
  } catch (error) {
    const reason = error?.reason || 'unavailable';
    return { status: reason === 'schema_not_applied' ? 'schema_not_applied' : 'unavailable', reason, ...POLICY_UNREAD };
  }
}

/* GET /v1/eup/halo → { ok, module, access, policy, enforcement, feeds[], generated_at } */
export async function handleHalo(request, env, ctx) {
  if (ctx.parts.length !== 0) throw ctx.fail(404, 'Halo module route not found', 'not_found');
  if (request.method !== 'GET') throw ctx.fail(405, 'Method not allowed', 'method_not_allowed');
  const policy = await haloPolicy(env, ctx);
  return {
    ok: true,
    scope: 'house_owner',
    generated_at: new Date(ctx.now()).toISOString(),
    module: { id: HALO_MODULE_ID, label: 'Hitman’s Halo', route: HALO_ROUTE, views: HALO_VIEWS.map((v) => ({ ...v })) },
    access: { audience: 'house_owner', decided_by: 'release_guard', detail: 'The release guard refuses every Halo route to anyone but the house owner before dispatch, and each operations route checks the owner again.' },
    policy,
    enforcement: { policy_enforced: false, detail: 'No Halo route reads the halo policy unit yet. A state recorded for it does not open or close Halo.' },
    feeds: DECLARED.map((f) => feedRow(f, env))
  };
}
