/* PRIM3 × Equity Uprise — mission: BLIND THE FLOOR / RESTORE THE PICTURE (B1). Review branch; not public canon.

   A TRAINING-mode red-team exercise on the canonical B1 (Technical Operations / Underground Operations), in
   SANDBOX only. The four B1 security cameras (B1-SEC-CAM-01…04, the building's registry, at their authority
   position, aim and optics) watch the Network / Telecom Core and the lane in front of it. Their horizontal
   links run from the B1 patch panel (B1-NET-PATCH-PANEL-01, ports 10–13) in the IDF rack by the tunnel
   concourse. Blinding a camera is the approved sandbox fault camera_link_down at that panel; restoring it
   removes the fault; the picture only counts once it is VERIFIED at the network operations console
   (B1-TELECOM-CONSOLE-01). Every placement goes through the adapter's feet → grid frame.

   Two sides, one board, the opponent on the canonical threat AI:
     side 'defend' — the squad (R/E/T) is Equity Uprise's own: it comes down from Floor 1, finds the red team in
                     the dark, restores a camera link at the rack and VERIFIES the picture at the console before
                     the clock runs out. The red team (AI) re-cuts any link it can reach while the picture is dark.
     side 'attack' — the squad is the red team: it comes in through the tunnel transfer lock under concealment,
                     blinds all four cameras (cut links at the rack; T may jam or Sync-Pulse them first), pulls
                     the core log at the console and leaves by the lock. The defenders (AI) see through the
                     cameras that are still live, restore links at the rack and verify at the console.

   Rules are the vendored PRIM3 resolver's. This module only adds the mission's technical layer: which sandbox
   fault an accepted rack action applies (the engine checks position, role and AP), the CONSOLE gate (the
   sandbox decides whether there is a picture to verify), the opponent's technical intent, and the outcome.  */
import * as R from '../tactical-resolver.mjs';
import { buildBattlefield, walkableCells } from '../adapters/equity-uprise/pipeline.mjs';
import { bindCameras, sandboxView, availability } from '../adapters/equity-uprise/sandbox.mjs';
import { selectCamerasForLane } from '../adapters/equity-uprise/adapter.mjs';

export const MISSION_ID = 'blind-the-floor';
export const SIDES = ['defend', 'attack'];
export const B1 = 0, F1 = 1; // authority levels
export const CLOCK = { defend: 9, attack: 10 };

// the mission's spatial spec, all in authority ids (resolved through the adapter)
export const SPEC = {
  levels: [B1, F1], site: true,
  // B1: the workshop, the telecom core and the transfer lock are opened for the exercise; the plant rooms stay shut
  rules: { [B1]: { open: ['b1-telecom-core', 'b1-facilities-workshop', 'b1-tunnel-transfer-lock'] }, [F1]: {} },
  openings: { 'F1-DOOR-PUBLIC-OUTER': true },
  elevators: false, // the exercise does not use the cabs: a PRIM3 mission moves by stair
  cameras: { level: B1 },
  anchors: {
    rack: { device: 'B1-NET-PATCH-PANEL-01', level: B1 },
    console: { equipment: 'B1-TELECOM-CONSOLE-01', level: B1 },
    portal: { door: 'B1-LOCK-OUTER-DOOR-01', level: B1 },
    desk: { equipment: 'B1-OPS-DESK-01', level: B1 }
  }
};
export const CAMERA_FAULT = 'camera_link_down';

const SQUAD = {
  E: { hp: 8, maxHp: 8, moveRange: 6, aim: 72, weaponDamage: 3, ammo: 4, magazineSize: 4, reserveAmmo: 8, detectionRadius: 4 },
  R: { hp: 6, maxHp: 6, moveRange: 6, aim: 80, weaponDamage: 4, ammo: 3, magazineSize: 3, reserveAmmo: 6, detectionRadius: 5 },
  T: { hp: 6, maxHp: 6, moveRange: 6, aim: 62, weaponDamage: 2, ammo: 6, magazineSize: 6, reserveAmmo: 12, detectionRadius: 4, canBeDowned: true, level: 1 }
};
const HOSTILE = { hp: 5, maxHp: 5, aim: 60, moveRange: 5, detectionRadius: 3 };

export function battlefield(pkg) {
  const bf = buildBattlefield(pkg, { ...SPEC, cameras: { level: B1, faction: 'PLAYER' } });
  const lanes = walkableCells(bf, B1);
  const sel = selectCamerasForLane(bf.cameras, lanes);
  return { bf, lanes, selection: sel };
}

export function engineConfig(pkg, { side = 'defend', seed = 20261103 } = {}) {
  if (!SIDES.includes(side)) throw new Error('side must be defend or attack');
  const bf = buildBattlefield(pkg, { ...SPEC, cameras: { level: B1, faction: side === 'defend' ? 'PLAYER' : 'THREAT' } });
  const { rack, console: con, portal } = bf.anchors;
  const z = rack.z;
  const camIds = bf.cameras.map((c) => c.asset_id);
  const squad = side === 'defend'
    ? [['E1', 'E', 6, 6, 1], ['R1', 'R', 6, 7, 1], ['T1', 'T', 5, 6, 1]] // Floor 1, the arrival atrium
    : [['E1', 'E', 6, 3, z], ['R1', 'R', 4, 3, z], ['T1', 'T', 5, 3, z]]; // B1, inside the transfer lock and the Stair B landing
  const hostiles = side === 'defend'
    ? [['H1', 7, 4, z, [{ x: 7, y: 4, z }, { x: 6, y: 5, z }]], ['H2', 5, 4, z, null], ['H3', 4, 6, z, [{ x: 4, y: 6, z }, { x: 6, y: 6, z }]]]
    : [['H1', 5, 6, z, [{ x: 5, y: 6, z }, { x: 6, y: 5, z }]], ['H2', 4, 5, z, [{ x: 4, y: 5, z }, { x: 3, y: 4, z }]], ['H3', 8, 5, z, [{ x: 8, y: 5, z }, { x: 7, y: 4, z }]], ['H4', 6, 6, 1, [{ x: 6, y: 6, z: 1 }, { x: 8, y: 4, z: 1 }]]]; // H4: Floor 1 security, answers the alarm by Stair A
  const units = [
    ...squad.map(([id, role, x, y, uz]) => ({ id, faction: 'PLAYER', role, x, y, z: uz, ...SQUAD[role], ...(side === 'attack' ? { concealed: true } : {}) })),
    ...hostiles.map(([id, x, y, hz, patrol]) => ({ id, faction: 'THREAT', x, y, z: hz, ...HOSTILE, ...(patrol ? { patrol } : {}) }))
  ];
  const consoleRoles = side === 'defend' ? ['T'] : ['T', 'E'];
  // the red team has already cut every link when the defenders are called down; the attackers find them live
  const ledger = side === 'defend' ? camIds.map((id) => ({ fault_id: CAMERA_FAULT, target: id, by: 'red-team', round: 0 })) : [];
  return {
    width: bf.grids[B1] ? 12 : 12, height: 13, floors: 9, seed,
    clock: CLOCK[side], extractionRequired: side === 'attack',
    surfaces: bf.surfaces, links: bf.links, blockers: bf.blockers, cover: bf.cover,
    machines: bf.machines,
    units,
    nodes: [
      { id: 'RACK', state: 'LIVE', required: false, at: { x: rack.x, y: rack.y, z, range: 1, roles: ['T'] } },
      { id: 'CONSOLE', state: side === 'defend' ? 'DARK' : 'OBSERVED', required: true, at: { x: con.x, y: con.y, z, range: 1, roles: consoleRoles } }
    ],
    technicalTruth: { nodes: {
      RACK: { actions: { LIVE: { RESTORE_LINK: { next: 'LIVE', apCost: 1 }, CUT_LINK: { next: 'LIVE', apCost: 1 } } } },
      CONSOLE: { actions: side === 'defend' ? { OBSERVED: { VERIFY: { next: 'VERIFIED', apCost: 1 } } } : { OBSERVED: { PULL: { next: 'VERIFIED', apCost: 1 } } } }
    } },
    objectives: [],
    battlefield: {
      levelId: 'equity-uprise-b1', coordinateFrame: { x0: 3, y0: 8, yUp: true },
      objectiveTiles: [{ id: 'CONSOLE', x: con.x, y: con.y, z }, { id: 'RACK', x: rack.x, y: rack.y, z }],
      extractionZone: side === 'attack' ? { x: portal.x, y: portal.y, z, r: 1 } : null,
      eu: { mission: MISSION_ID, side, mode: 'TRAINING', execution_target: 'SANDBOX', live_control_allowed: false, cameras: camIds, ledger, verified: false, pulled: false, events: [] }
    }
  };
}

/* ---------- the technical layer ---------- */
const euOf = (s) => s.battlefield.eu;
const withEu = (s, patch) => ({ ...s, battlefield: { ...s.battlefield, eu: { ...euOf(s), ...patch } } });
export function liveCameras(pkg, s) { const v = sandboxView(pkg, euOf(s).ledger); return euOf(s).cameras.filter((id) => availability(v, id) !== 'unavailable'); }
export const pictureLive = (pkg, s) => liveCameras(pkg, s).length > 0;

// apply the ledger to the board: camera machines follow the sandbox; the CONSOLE has a picture to verify only when one is live
export function sync(pkg, s) {
  let next = bindCameras(s, pkg, euOf(s).ledger, euOf(s).cameras);
  const eu = euOf(next);
  if (eu.side === 'defend') {
    const con = next.nodes.find((n) => n.id === 'CONSOLE');
    if (con.state !== 'VERIFIED') {
      const want = pictureLive(pkg, next) ? 'OBSERVED' : 'DARK';
      if (con.state !== want) next = { ...next, nodes: next.nodes.map((n) => (n.id === 'CONSOLE' ? { ...n, state: want } : n)) };
    }
  }
  return next;
}
export function createMission(pkg, opts = {}) { return sync(pkg, R.beginPlayerPhase(R.createState(engineConfig(pkg, opts)))); }

const note = (s, ev) => withEu(s, { events: [...euOf(s).events, { round: s.round, ...ev }] });
function cut(pkg, s, by) {
  const live = liveCameras(pkg, s); if (!live.length) return null;
  const id = live[0];
  return { state: note(withEu(s, { ledger: [...euOf(s).ledger, { fault_id: CAMERA_FAULT, target: id, by, round: s.round }] }), { type: 'SANDBOX_FAULT', fault_id: CAMERA_FAULT, target: id, by }), id };
}
function restore(pkg, s, by) {
  const led = euOf(s).ledger; if (!led.length) return null;
  const f = [...led].sort((a, b) => a.target.localeCompare(b.target))[0];
  return { state: note(withEu(s, { ledger: led.filter((x) => x !== f) }), { type: 'SANDBOX_RESTORED', fault_id: f.fault_id, target: f.target, by }), id: f.target };
}

// the squad's mission actions for a unit: legality is the resolver's own verdict (dry run) plus the sandbox gate
export function missionActions(pkg, s, unitId) {
  const u = s.units.find((x) => x.id === unitId), eu = euOf(s), out = [];
  if (!u || u.faction !== 'PLAYER') return out;
  const dry = (node, act) => { try { return R.technicalAction(s, unitId, node, act).accepted; } catch (e) { return false; } };
  if (eu.side === 'defend') {
    if (eu.ledger.length && dry('RACK', 'RESTORE_LINK')) out.push({ id: 'eu:restore', label: `Restore ${4 - eu.ledger.length + 1}/4`, sub: '1 AP' });
    if (dry('CONSOLE', 'VERIFY')) out.push({ id: 'eu:verify', label: 'Verify picture', sub: '1 AP' });
  } else {
    if (liveCameras(pkg, s).length && dry('RACK', 'CUT_LINK')) out.push({ id: 'eu:cut', label: `Cut link ${eu.ledger.length + 1}/4`, sub: '1 AP' });
    if (!eu.pulled && dry('CONSOLE', 'PULL')) out.push({ id: 'eu:pull', label: 'Pull log', sub: '1 AP' });
  }
  return out;
}

export function performMission(pkg, s, actionId, unitId) {
  const run = (node, act) => { const out = R.technicalAction(s, unitId, node, act); if (!out.accepted) throw new Error('refused'); return out.state; };
  if (actionId === 'eu:restore') { if (!euOf(s).ledger.length) throw new Error('nothing to restore'); const r = restore(pkg, run('RACK', 'RESTORE_LINK'), unitId); return { state: sync(pkg, r.state), log: `T restores ${r.id} at the patch panel. ${pictureLive(pkg, r.state) ? 'Picture back on the core lane.' : ''}` }; }
  if (actionId === 'eu:cut') { if (!liveCameras(pkg, s).length) throw new Error('every link is already cut'); const r = cut(pkg, run('RACK', 'CUT_LINK'), unitId); return { state: sync(pkg, r.state), log: `T cuts ${r.id}'s link at the patch panel (${euOf(r.state).ledger.length}/4).` }; }
  if (actionId === 'eu:verify') { if (!pictureLive(pkg, s)) throw new Error('no picture to verify'); let n = run('CONSOLE', 'VERIFY'); n = note(withEu(n, { verified: true }), { type: 'PICTURE_VERIFIED', by: unitId, live: liveCameras(pkg, n) }); return { state: sync(pkg, n), log: `T verifies the picture at the core console (${liveCameras(pkg, n).length}/4 live).` }; }
  if (actionId === 'eu:pull') { let n = run('CONSOLE', 'PULL'); n = note(withEu(n, { pulled: true }), { type: 'LOG_PULLED', by: unitId }); return { state: sync(pkg, n), log: `${s.units.find((u) => u.id === unitId).role} pulls the core log. Out through the lock.` }; }
  throw new Error('unknown mission action ' + actionId);
}

// the opponent's technical intent, after its tactical turn (the canonical threat AI moved and shot):
//   red team (side defend): a red-team member next to the rack re-cuts a link while the picture is unverified
//   defenders (side attack): a defender next to the rack restores a link; next to the console with a live picture, verifies
export function afterThreat(pkg, s) {
  let next = s; const log = []; const eu = euOf(s);
  const { RACK, CONSOLE } = Object.fromEntries(s.nodes.map((n) => [n.id, n.at]));
  const near = (u, at) => u.z === at.z && Math.abs(u.x - at.x) + Math.abs(u.y - at.y) <= 1;
  for (const h of s.units.filter((u) => u.faction === 'THREAT' && !u.dead && !u.downed)) {
    if (eu.side === 'defend') {
      if (!euOf(next).verified && near(h, RACK)) { const r = cut(pkg, next, h.id); if (r) { next = r.state; log.push(`${h.id} re-cuts ${r.id} at the rack.`); } }
    } else {
      if (near(h, RACK) && euOf(next).ledger.length) { const r = restore(pkg, next, h.id); if (r) { next = r.state; log.push(`${h.id} restores ${r.id} at the rack.`); } }
      if (near(h, CONSOLE) && pictureLive(pkg, next) && !euOf(next).verified) { next = note(withEu(next, { verified: true }), { type: 'PICTURE_VERIFIED', by: h.id, live: liveCameras(pkg, next) }); log.push(`${h.id} verifies the picture at the console: the red team is on camera.`); }
    }
  }
  return { state: sync(pkg, next), log };
}

// 'win' | 'lose-clock' | 'lose-t' | 'lose-all' | 'lose-verified' | null
export function outcome(s) {
  const eu = euOf(s), squad = s.units.filter((u) => u.faction === 'PLAYER'), t = squad.find((u) => u.role === 'T');
  if (R.missionComplete(s)) return 'win';
  if (t && t.dead) return 'lose-t';
  if (squad.every((u) => u.dead || u.downed)) return 'lose-all';
  if (eu.side === 'attack' && eu.verified) return 'lose-verified';
  if (s.mission.escalation === 'TERMINAL') return 'lose-clock';
  return null;
}

export const COPY = {
  defend: {
    title: 'Restore the Picture', objective: 'Restore and verify the B1 picture',
    brief: 'B1 has gone dark: the red team cut all four camera links at the B1 patch panel and is holding the concourse. Come down from Floor 1, restore a link at the rack (T, next to it), then VERIFY the picture at the network operations console in the telecom core (T, next to it) before the clock runs out. While the picture is unverified, any red-team member at the rack cuts it again.',
    roles: { E: 'Take the concourse. Keep the rack clear.', R: 'Overwatch the lane. Longest sight.', T: 'Restore a link at the rack, then verify at the console. Keep T alive.' }
  },
  attack: {
    title: 'Blind the Floor', objective: 'Blind B1, pull the log, get out',
    brief: 'You are the red team, in through the tunnel transfer lock under concealment. Four cameras watch the telecom core and the rack. Blind all four (cut their links at the rack; T can Jam or Sync-Pulse them first), pull the core log at the console, then leave by the lock. If a defender verifies a live picture at the console, the exercise is lost.',
    roles: { E: 'Hold the concourse. Cover T at the rack.', R: 'Watch the lab and the stair.', T: 'Blind the cameras at the rack, pull the log. Keep T alive.' }
  }
};

export function debrief(pkg, s) {
  const eu = euOf(s), o = outcome(s), lines = [];
  const faults = eu.events.filter((e) => e.type === 'SANDBOX_FAULT').length, restores = eu.events.filter((e) => e.type === 'SANDBOX_RESTORED').length;
  lines.push(`${eu.side === 'defend' ? 'Restore the Picture' : 'Blind the Floor'} · ${o === 'win' ? 'exercise won' : 'exercise lost'} · round ${s.round}.`);
  lines.push(`Sandbox: ${faults} link cut${faults === 1 ? '' : 's'}, ${restores} restored; ${liveCameras(pkg, s).length}/4 cameras live at the end; picture ${eu.verified ? 'verified' : 'not verified'}.`);
  lines.push('All of it ran in the SANDBOX: the building, its registry and the sandbox baseline are unchanged. Restart clears the exercise.');
  return lines;
}
