/* PRIM3 tactics — the playable levels, by id (prim3-transit.html?level=<id>). An unknown or missing id
   loads Transit / Relay, the default level. Each module exports the same shape: W, H, FLOORS, FRAME,
   toDisplay, SCENE, MISSION, surfaces(), engineConfig(); optional floorName(z). */
export const LEVELS = {
  'transit-relay': { title: 'Transit / Relay', load: () => import('./transit-relay.mjs') },
  'equity-uprise-hq': { title: 'Equity Uprise HQ', load: () => import('./equity-uprise-hq.mjs') }
};
export const DEFAULT_LEVEL = 'transit-relay';
export function loadLevel(id) { return (LEVELS[id] || LEVELS[DEFAULT_LEVEL]).load(); }
