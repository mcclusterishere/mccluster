/* PRIM3 tactics — the playable levels, by id (prim3-transit.html?level=<id>). An unknown or missing id
   loads Transit / Relay, the default level. Each module exports the same shape: W, H, FLOORS, FRAME,
   toDisplay, SCENE, MISSION, surfaces(), engineConfig(); optional floorName(z). */
export const LEVELS = {
  'transit-relay': { title: 'Transit / Relay', load: () => import('./transit-relay.mjs') },
  'equity-uprise-hq': { title: 'Equity Uprise HQ', load: () => import('./equity-uprise-hq.mjs') }
};
export const DEFAULT_LEVEL = 'transit-relay';
/* ?level=forge plays the document the Level Forge (prim3-level-builder/) handed over for a play test, exported
   into this same shape by forge.mjs. It is a hook, not a listed level; without a valid hand-over it is the default. */
export const FORGE_LEVEL = 'forge';
export async function loadLevel(id) {
  if (id === FORGE_LEVEL) {
    const level = (await import('./forge.mjs')).loadPlaytest();
    if (level) return level;
  }
  return (LEVELS[id] || LEVELS[DEFAULT_LEVEL]).load();
}
