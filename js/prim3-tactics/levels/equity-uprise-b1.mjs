/* PRIM3 · Equity Uprise B1 — "Blind the Floor / Restore the Picture" (review branch; not public canon).

   The page level for the first Equity Uprise × PRIM3 vertical slice. The board, cameras, devices and doors come
   from the building package through the adapter (adapters/equity-uprise/); the mission's rules and its sandbox
   binding are missions/blind-the-floor.mjs. This module only hands the page what it draws: the same building
   frame, model and scene as the HQ level (one building, one frame), the mission copy, and the mission hooks.
   Side: ?side=defend (default) or ?side=attack; each side keeps its own save.                                  */
import * as HQ from './equity-uprise-hq.mjs';
import { loadPackage } from '../adapters/equity-uprise/pipeline.mjs';
import * as M from '../missions/blind-the-floor.mjs';

const PKG = await loadPackage();
const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
export const SIDE = M.SIDES.includes(qs.get('side')) ? qs.get('side') : 'defend';
export const LEVEL_ID = 'equity-uprise-b1';
export const SAVE_ID = `${LEVEL_ID}.${SIDE}`;
export const { TILE_M, W, H, FRAME, toDisplay, WORLD_M, MODEL, modelToWorld, OBJ_LABEL_H, storeyOf, floorName, PLAN } = HQ;
export const FLOORS = 9;
export const fogFloor = (x, y, z = 8) => (x >= 3 && x < 9 && y >= 3 && y < 9 ? (z === 1 ? 1 : 8) : 0); // inside the plate, the fog is read on the floor in play (B1 unless the selected operative is on Floor 1)

const cfg = M.engineConfig(PKG, { side: SIDE });
const at = Object.fromEntries(cfg.nodes.map((n) => [n.id, n.at]));
export const SCENE = {
  ...HQ.SCENE,
  objective: { id: 'CONSOLE', x: at.CONSOLE.x, y: at.CONSOLE.y, z: at.CONSOLE.z, label: 'Core console' },
  extraction: cfg.battlefield.extractionZone ? { ...cfg.battlefield.extractionZone, label: 'TRANSFER LOCK' } : { x: at.RACK.x, y: at.RACK.y, z: at.RACK.z, r: 0, label: '' },
  showExtraction: !!cfg.battlefield.extractionZone,
  gridSurfaces: [
    ...HQ.SCENE.gridSurfaces.filter((g) => g.z !== 8),
    { z: 8, x: 3, y: 3, w: 6, d: 6, height: HQ.floorHeight(8) }
  ],
  rack: { x: at.RACK.x, y: at.RACK.y, z: at.RACK.z, label: 'IDF rack' },
  // the sector map shows the floor in play: B1's shut rooms and shafts
  floor1Rooms: [...M.battlefield(PKG).bf.grids[0].cells.values()].filter((c) => c.kind === 'closed' || c.kind === 'shaft').map((c) => ({ x: c.x, y: c.y, id: c.zone })),
  doors: []
};
export const surfaces = () => cfg.surfaces;
export const OPENING = SIDE === 'defend' ? { x: 5.5, y: 6.5, z: 1, dist: 15, pitch: 0.62 } : { x: 5.5, y: 4.5, z: 8, dist: 11, pitch: 0.9 };

const C = M.COPY[SIDE];
export const MISSION = {
  title: C.title, objective: C.objective, node: 'CONSOLE', nodeLabel: 'Core console',
  brief: C.brief, roles: C.roles,
  extractWord: 'Leave by the lock', extractPlace: 'the transfer lock', doneTitle: SIDE === 'defend' ? 'Picture verified' : 'Floor blinded',
  failT: 'Technical was lost.',
  help: [
    SIDE === 'defend'
      ? 'Defend: come down from Floor 1 by Stair A or B. Technical <b>Restores</b> a camera link next to the IDF rack, then <b>Verifies</b> the picture next to the core console. Red-team members at the rack cut links again until you verify. The clock is the exercise window.'
      : 'Attack: you start in the tunnel transfer lock, concealed. Technical <b>Cuts</b> each camera link next to the IDF rack (four), and can <b>Jam</b> or <b>Pulse</b> the cameras first. Then <b>Pull log</b> next to the core console and <b>leave by the lock</b>. If a defender verifies a live picture, the exercise is lost.',
    'Coordinates: X grows east, Y grows north; the building\'s south-west corner is (0, 0), one cell is 12 ft. The board, the cameras and the devices are the building\'s own (PRIM3 adapter); camera faults run in the SANDBOX only. Rules are the Prim3 canonical engine.'
  ]
};

export const engineConfig = ({ seed } = {}) => M.engineConfig(PKG, { side: SIDE, seed });
// the page's mission hooks
export const HOOKS = {
  createState: (seed) => M.createMission(PKG, { side: SIDE, seed }),
  sync: (s) => M.sync(PKG, s),
  actions: (s, id) => M.missionActions(PKG, s, id),
  perform: (s, action, id) => M.performMission(PKG, s, action, id),
  afterThreat: (s) => M.afterThreat(PKG, s),
  outcome: (s) => M.outcome(s),
  debrief: (s) => M.debrief(PKG, s),
  objective(s) {
    const eu = s.battlefield.eu, live = M.liveCameras(PKG, s).length;
    if (SIDE === 'defend') return { title: eu.verified ? 'Picture verified' : live ? 'Verify the picture' : 'Restore a camera link', line: `Cameras live ${live}/4 · ${eu.verified ? 'verified' : 'not verified'} · clock ${s.mission.clock}`, progress: `${live}/4` };
    return { title: eu.pulled ? 'Leave by the lock' : live ? 'Blind the cameras' : 'Pull the core log', line: `Cameras blind ${4 - live}/4 · log ${eu.pulled ? 'pulled' : 'not pulled'} · clock ${s.mission.clock}`, progress: `${4 - live}/4` };
  },
  sideSwitch: SIDE === 'defend' ? 'attack' : 'defend'
};
