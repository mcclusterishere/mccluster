#!/usr/bin/env node
/* Blind the Floor / Restore the Picture — play whole games on the real resolver, threat AI and sandbox binding.

   The player side is a HEURISTIC POLICY (not a script): each turn it reads only the player projection (fog of
   war: known hostiles, known machines, known paths), takes the mission action if the engine and the sandbox allow
   it, shoots the best known shot above a threshold, uses T technology control (Sync Pulse, Jam) when a live
   camera covers its next stop, and otherwise moves toward its role's goal by the engine's own known paths.
   The opponent is the canonical threat AI plus the mission's technical intent (missions/blind-the-floor.mjs).
   Every roll comes from the engine's seeded generator, so a seed replays exactly.

   Usage: node scripts/prim3/blind-the-floor-sim.mjs [seeds=200] [side=both]                                   */
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { playerProjection, knownPaths } from '../../js/prim3-tactics/tactical-hints.mjs';
import { runThreatPhase } from '../../js/prim3-tactics/tactical-threat-ai.mjs';
import { loadPackage } from '../../js/prim3-tactics/adapters/equity-uprise/pipeline.mjs';
import * as M from '../../js/prim3-tactics/missions/blind-the-floor.mjs';
import { pathToFileURL } from 'node:url';

const md = (a, b) => (a.z === b.z ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 99);

// cost from every cell to the nearest goal cell, over the static board (the squad alone; doors as configured)
function goalCost(s, unitId, goals) {
  const base = { ...s, units: s.units.filter((u) => u.id === unitId) };
  const best = new Map();
  for (const g of goals) {
    const probe = { ...base, units: base.units.map((u) => ({ ...u, x: g.x, y: g.y, z: g.z, ap: 2 })) };
    let reach; try { reach = R.computeReach(probe, unitId, Infinity); } catch (e) { continue; }
    for (let z = 0; z < s.floors; z += 1) for (let y = 0; y < s.height; y += 1) for (let x = 0; x < s.width; x += 1) {
      const c = reach.costAt(x, y, z); if (!Number.isFinite(c)) continue;
      const k = `${x}:${y}:${z}`; if (!best.has(k) || best.get(k) > c) best.set(k, c);
    }
  }
  return (x, y, z) => best.get(`${x}:${y}:${z}`) ?? Infinity;
}
const around = (at, r = 1) => { const o = []; for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) if (Math.abs(dx) + Math.abs(dy) <= r) o.push({ x: at.x + dx, y: at.y + dy, z: at.z }); return o; };

export function goalsFor(pkg, s, u) {
  const eu = s.battlefield.eu, at = Object.fromEntries(s.nodes.map((n) => [n.id, n.at]));
  const rackAdj = around(at.RACK).filter((c) => !(c.x === at.RACK.x && c.y === at.RACK.y));
  const conAdj = around(at.CONSOLE);
  const both = rackAdj.filter((c) => md(c, at.CONSOLE) <= 1);
  if (u.role === 'T') {
    if (eu.side === 'defend') return M.pictureLive(pkg, s) ? (both.length ? [...both, ...conAdj] : conAdj) : (both.length ? both : rackAdj);
    if (M.liveCameras(pkg, s).length) return rackAdj;
    if (!eu.pulled) return both.length ? both : conAdj;
    return around(s.battlefield.extractionZone, 1).filter((c) => md(c, s.battlefield.extractionZone) <= s.battlefield.extractionZone.r);
  }
  if (eu.side === 'attack' && eu.pulled) return around(s.battlefield.extractionZone, 1).filter((c) => md(c, s.battlefield.extractionZone) <= s.battlefield.extractionZone.r);
  return around(at.RACK, 2);
}

function tryDo(fn) { try { return fn(); } catch (e) { return null; } }

// one unit's turn under the policy; returns the new state (and a trace)
function unitTurn(pkg, s, id, trace) {
  for (let guard = 0; guard < 6; guard += 1) {
    const u = s.units.find((x) => x.id === id);
    if (!u || u.dead || u.downed || u.ap < 1 || (u.statuses || []).includes('EXTRACTED') || M.outcome(s)) return s;
    const eu = s.battlefield.eu;
    // 1. mission action
    const acts = M.missionActions(pkg, s, id);
    const want = acts.find((a) => a.id === 'eu:verify' || a.id === 'eu:pull') || acts.find((a) => (a.id === 'eu:restore' && !M.pictureLive(pkg, s)) || a.id === 'eu:cut');
    if (want) { const r = M.performMission(pkg, s, want.id, id); trace.push([s.round, id, want.id]); s = r.state; continue; }
    // 2. extraction
    if (eu.side === 'attack' && eu.pulled) { const n = tryDo(() => R.extractUnit(s, id)); if (n) { trace.push([s.round, id, 'extract']); s = n; continue; } }
    // 2b. stabilize a downed squadmate next to this unit
    const down = s.units.find((o) => o.faction === 'PLAYER' && o.downed && !o.dead && o.id !== id && !(o.statuses || []).includes('STABILIZED') && md(o, u) <= 1);
    if (down) { const n = tryDo(() => R.stabilize(s, id, down.id)); if (n) { trace.push([s.round, id, 'stabilize', down.id]); s = n; continue; } }
    // 3. the best known shot
    const known = playerProjection(s).units.filter((h) => h.faction !== 'PLAYER' && !h.dead && !h.downed);
    const shots = known.map((h) => ({ h, pv: tryDo(() => R.shotPreview(s, id, h.id)) })).filter((t) => t.pv && t.pv.legal).sort((a, b) => b.pv.hitChance - a.pv.hitChance);
    const thr = u.role === 'T' ? 55 : 35;
    if (shots.length && shots[0].pv.hitChance >= thr && u.ammo > 0) {
      const d = R.drawRolls(s, 2); const out = R.fireWeapon(d.state, id, shots[0].h.id, d.rolls[0], d.rolls[1]);
      trace.push([s.round, id, 'fire', shots[0].h.id, shots[0].pv.hitChance, out.result.hit]); s = out.state; continue;
    }
    if (u.ammo === 0 && u.reserveAmmo > 0) { s = R.reload(s, id); trace.push([s.round, id, 'reload']); continue; }
    // 4. T technology control: blind a live hostile camera that covers where T is going
    if (u.role === 'T' && eu.side === 'attack' && (s.machines || []).some((m) => m.kind === 'CAMERA' && m.faction === 'THREAT' && m.state === 'ACTIVE')) {
      const cam = s.machines.find((m) => m.kind === 'CAMERA' && m.faction === 'THREAT' && m.state === 'ACTIVE');
      const goals = goalsFor(pkg, s, u);
      const exposed = goals.some((g) => md(g, cam) <= cam.detectionRadius);
      if (exposed) {
        const pv = R.techActionPreview(s, 'SYNC_PULSE', id, { x: cam.x, y: cam.y, z: cam.z });
        if (pv.legal) { s = R.syncPulse(s, id, { x: cam.x, y: cam.y, z: cam.z }); trace.push([s.round, id, 'pulse']); continue; }
      }
    }
    // 5. move toward the goal (dash when one move cannot get there and nothing is known to be watching)
    const goals = goalsFor(pkg, s, u);
    const cost = goalCost(s, id, goals);
    const here = cost(u.x, u.y, u.z);
    if (here > 0) {
      const p = playerProjection(s), pu = p.units.find((x) => x.id === id);
      const tryMove = (dash) => {
        pu.moveRange = u.moveRange * (dash ? 2 : 1);
        const kp = knownPaths(p, id); let best = null;
        for (const [k, steps] of kp.dist) {
          if (steps <= 0) continue; const [x, y, z] = k.split(':').map(Number); const c = cost(x, y, z);
          const cv = s.cover.find((q) => q.x === x && q.y === y && q.z === z);
          const score = c * 10 - (cv ? (cv.type === 'HIGH' ? 3 : 2) : 0) + (s.units.some((o) => o.id !== id && o.x === x && o.y === y && o.z === z && !o.dead) ? 999 : 0);
          if (!best || score < best.score) best = { x, y, z, score, c, path: kp.pathTo(x, y, z) };
        }
        return best;
      };
      let mv = tryMove(false);
      if (mv && mv.c >= here && u.ap >= 2) { const d = tryMove(true); if (d && d.c < here) mv = { ...d, dash: true }; }
      if (mv && mv.c < here) {
        const n = tryDo(() => R.moveUnit(s, id, { x: mv.x, y: mv.y, z: mv.z }, mv.dash ? 'DASH' : 'MOVE', { path: mv.path }));
        if (n) { trace.push([s.round, id, mv.dash ? 'dash' : 'move', mv.x, mv.y, mv.z]); s = n; continue; }
      }
    }
    // 6. hold: overwatch if anything is known, else hunker
    if (!u.overwatch && u.ammo > 0 && known.length) { s = R.enterOverwatch(s, id); trace.push([s.round, id, 'watch']); continue; }
    if (!u.hunkered) { s = R.hunkerDown(s, id); trace.push([s.round, id, 'hunker']); continue; }
    return s;
  }
  return s;
}

export function playGame(pkg, side, seed, { maxRounds = 20 } = {}) {
  let s = M.createMission(pkg, { side, seed });
  const trace = [];
  for (let r = 0; r < maxRounds; r += 1) {
    for (const id of ['T1', 'E1', 'R1']) { s = unitTurn(pkg, s, id, trace); if (M.outcome(s)) break; }
    let o = M.outcome(s); if (o) return { side, seed, outcome: o, round: s.round, trace, state: s };
    let n = R.beginThreatPhase(s);
    n = runThreatPhase(n).state;
    const a = M.afterThreat(pkg, n); n = a.state; for (const l of a.log) trace.push([n.round, 'AI', l]);
    s = M.sync(pkg, R.beginPlayerPhase(R.resolveClockStatePhase(n)));
    o = M.outcome(s); if (o) return { side, seed, outcome: o, round: s.round, trace, state: s };
  }
  return { side, seed, outcome: 'timeout', round: s.round, trace, state: s };
}

export async function winRates(n = 200, sides = M.SIDES) {
  const pkg = await loadPackage(), out = {};
  for (const side of sides) {
    const tally = {};
    for (let seed = 1; seed <= n; seed += 1) { const g = playGame(pkg, side, seed); tally[g.outcome] = (tally[g.outcome] || 0) + 1; }
    out[side] = { games: n, player: tally.win || 0, opponent: n - (tally.win || 0), outcomes: tally };
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const n = Number(process.argv[2] || 200), side = process.argv[3];
  console.log(JSON.stringify(await winRates(n, side && side !== 'both' ? [side] : M.SIDES), null, 1));
}
