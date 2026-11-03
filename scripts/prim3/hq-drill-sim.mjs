#!/usr/bin/env node
/* Equity Uprise HQ Emergency Exercise — whole games at FULL strength (the role-players exactly as the level
   defines them, the two roof shooters included) on the real resolver and threat AI.

   The squad is a heuristic policy (never a script): it reads only the player projection, takes the report when
   the engine allows it, fires the best known shot above a threshold, stabilizes a downed squadmate, and otherwise
   moves by the engine's known paths toward its role's goal (T: next to the security interface; E and R: inside
   Floor 1 near it; after the report, Assembly Area A). Winning runs show the intended solution: be through the
   public entrance by the end of round 1–2 (the roof sees the public way, not Floor 1, which sits under Floor 2's
   slab), clear the two inside role-players from inside, report, then cross to Assembly A in one two-move turn each.
   Usage: node scripts/prim3/hq-drill-sim.mjs [seeds=100]                                                       */
import * as R from '../../js/prim3-tactics/tactical-resolver.mjs';
import { playerProjection, knownPaths } from '../../js/prim3-tactics/tactical-hints.mjs';
import { runThreatPhase } from '../../js/prim3-tactics/tactical-threat-ai.mjs';
import * as L from '../../js/prim3-tactics/levels/equity-uprise-hq.mjs';
import { pathToFileURL } from 'node:url';

const md = (a, b) => (a.z === b.z ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 99);
const tryDo = (fn) => { try { return fn(); } catch (e) { return null; } };
function goalCost(s, id, goals) {
  const best = new Map();
  for (const g of goals) {
    if (s.units.some((o) => o.id !== (typeof unitId !== 'undefined' ? unitId : id) && !o.dead && o.x === g.x && o.y === g.y && o.z === g.z)) continue; // a goal someone else stands on is taken
    const probe = { ...s, units: s.units.filter((u) => u.id === id || (u.downed && !u.dead)).map((u) => (u.id === id ? { ...u, x: g.x, y: g.y, z: g.z } : u)) }; // a downed body blocks its cell
    const reach = tryDo(() => R.computeReach(probe, id, Infinity)); if (!reach) continue;
    for (let z = 0; z < s.floors; z += 1) for (let y = 0; y < s.height; y += 1) for (let x = 0; x < s.width; x += 1) { const c = reach.costAt(x, y, z); if (Number.isFinite(c)) { const k = `${x}:${y}:${z}`; if (!best.has(k) || best.get(k) > c) best.set(k, c); } }
  }
  return (x, y, z) => best.get(`${x}:${y}:${z}`) ?? Infinity;
}
// cells any living known hostile on the roof can see (the roof's arc of fire)
function roofArc(s) {
  const roof = s.units.filter((u) => u.faction === 'THREAT' && !u.dead && !u.downed && u.z === 7);
  return (x, y, z) => roof.some((h) => tryDo(() => R.hasLineOfSight(s, h, { x, y, z })) && R.gridDistance(h, { x, y, z }, s) <= 12);
}
function goalsFor(s, u, policy, mem = {}) {
  const node = s.nodes.find((n) => n.id === 'INTERFACE'), at = node.at;
  const ez = s.battlefield.extractionZone, assembly = [];
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (Math.abs(dx) + Math.abs(dy) <= ez.r) assembly.push({ x: ez.x + dx, y: ez.y + dy, z: 0 });
  const iface = [{ x: at.x, y: at.y + 1, z: 1 }, { x: at.x, y: at.y - 1, z: 1 }, { x: at.x - 1, y: at.y, z: 1 }, { x: at.x + 1, y: at.y, z: 1 }].filter((c) => !s.blockers.some((b) => b.x === c.x && b.y === c.y && b.z === c.z));
  const done = node.state === 'VERIFIED';
  const discharge = s.nodes.find((n) => n.id === 'DISCHARGE');
  if (done) {
    // smart: while a remembered roof shooter may still be up there, hold Floor 1 (under Floor 2's slab the roof
    // cannot see in) and let the shooters come down the stairs into the squad's overwatch
    return assembly;
  }
  if (u.role === 'T') return iface;
    return [{ x: at.x, y: at.y + 2, z: 1 }, { x: at.x - 1, y: at.y + 2, z: 1 }];
}
function unitTurn(s, id, policy, trace, mem = {}) {
  for (let guard = 0; guard < 6; guard += 1) {
    const u = s.units.find((x) => x.id === id);
    if (!u || u.dead || u.downed || u.ap < 1 || (u.statuses || []).includes('EXTRACTED') || outcome(s)) return s;
    const node = s.nodes.find((n) => n.id === 'INTERFACE');
    if (u.role === 'T' && node.state !== 'VERIFIED') { const act = node.state === 'OBSERVED' ? 'LINK_1' : 'LINK_2'; const out = tryDo(() => R.technicalAction(s, id, 'INTERFACE', act)); if (out && out.accepted) { trace.push([s.round, id, act]); s = out.state; continue; } }
    if (u.role === 'E' && node.state === 'VERIFIED' && policy === 'smart') { const out = tryDo(() => R.technicalAction(s, id, 'DISCHARGE', 'BREACH')); if (out && out.accepted) { trace.push([s.round, id, 'open-exit']); s = out.state; continue; } }
    if (node.state === 'VERIFIED') { const n = tryDo(() => R.extractUnit(s, id)); if (n) { trace.push([s.round, id, 'assemble']); s = n; continue; } }
    const down = s.units.find((o) => o.faction === 'PLAYER' && o.downed && !o.dead && o.id !== id && !(o.statuses || []).includes('STABILIZED') && md(o, u) <= 1);
    if (down) { const n = tryDo(() => R.stabilize(s, id, down.id)); if (n) { trace.push([s.round, id, 'stabilize', down.id]); s = n; continue; } }
    const known = playerProjection(s).units.filter((h) => h.faction !== 'PLAYER' && !h.dead && !h.downed);
    const shots = known.map((h) => ({ h, pv: tryDo(() => R.shotPreview(s, id, h.id)) })).filter((t) => t.pv && t.pv.legal).sort((a, b) => b.pv.hitChance - a.pv.hitChance);
    // smart: never stand and trade shots in the roof's arc on the street: keep moving (dash) to the glass
    const exposed = policy === 'smart' && u.z === 0 && roofArc(s)(u.x, u.y, 0);
    if (shots.length && shots[0].pv.hitChance >= (exposed ? 80 : u.role === 'T' ? 55 : 35) && u.ammo > 0) { const d = R.drawRolls(s, 2); const out = R.fireWeapon(d.state, id, shots[0].h.id, d.rolls[0], d.rolls[1]); trace.push([s.round, id, 'fire', shots[0].h.id, shots[0].pv.hitChance, out.result.hit]); s = out.state; continue; }
    if (u.ammo === 0 && u.reserveAmmo > 0) { s = R.reload(s, id); continue; }
    const goals = goalsFor(s, u, policy, mem), cost = goalCost(s, id, goals), here = cost(u.x, u.y, u.z);
    if (here > 0) {
      const arc = policy === 'smart' ? roofArc(s) : () => false;
      const p = playerProjection(s), pu = p.units.find((x) => x.id === id);
      const pick = (dash) => {
        pu.moveRange = u.moveRange * (dash ? 2 : 1); const kp = knownPaths(p, id); let best = null;
        for (const [k, steps] of kp.dist) {
          if (steps <= 0) continue; const [x, y, z] = k.split(':').map(Number), c = cost(x, y, z); if (c >= here) continue;
          const cv = s.cover.find((q) => q.x === x && q.y === y && q.z === z);
          const score = c * 10 - (cv ? (cv.type === 'HIGH' ? 3 : 2) : 0) + (arc(x, y, z) ? 25 : 0) + (s.units.some((o) => o.id !== id && o.x === x && o.y === y && o.z === z && !o.dead) ? 999 : 0);
          if (!best || score < best.score) best = { x, y, z, c, score, path: kp.pathTo(x, y, z) };
        }
        return best;
      };
      let mv = pick(policy === 'smart' && u.ap >= 2);
      if (!mv || mv.c >= here) mv = pick(false);
      if (mv && mv.c < here) { const n = tryDo(() => R.moveUnit(s, id, { x: mv.x, y: mv.y, z: mv.z }, pu.moveRange > u.moveRange ? 'DASH' : 'MOVE', { path: mv.path })); if (n) { trace.push([s.round, id, 'move', mv.x, mv.y, mv.z]); s = n; continue; } }
    }
    if (!u.hunkered) { s = R.hunkerDown(s, id); continue; }
    return s;
  }
  return s;
}
export function outcome(s) {
  const t = s.units.find((u) => u.id === 'T1');
  if (R.missionComplete(s)) return 'win';
  if (t.dead) return 'lose-t';
  const squad = s.units.filter((u) => u.faction === 'PLAYER');
  if (squad.every((u) => u.dead || u.downed)) return 'lose-all';
  // everyone who can still walk has assembled, but a downed operative cannot: the exercise cannot complete
  // the resolver counts a downed operative as a survivor who must assemble, and a downed operative cannot move:
  // once anyone is down and not out, the exercise cannot be completed
  if (squad.some((u) => u.downed && !u.dead)) return 'lose-downed';
  return null;
}
export function playHq(seed, policy = 'naive', { maxRounds = 24 } = {}) {
  let s = R.beginPlayerPhase(R.createState(L.engineConfig({ seed }))); const trace = [];
  const mem = { roof: new Set(), hold: 0 }; // what the player has seen: roof shooters not yet seen down
  const remember = () => { for (const h of playerProjection(s).units) if (h.faction !== 'PLAYER') { if (h.z === 7 && !h.dead && !h.downed) mem.roof.add(h.id); if (h.dead || h.downed) mem.roof.delete(h.id); } };
  for (let r = 0; r < maxRounds; r += 1) {
    remember(); if (s.nodes.find((n) => n.id === 'INTERFACE').state === 'VERIFIED') mem.hold += 1;
    for (const id of ['T1', 'E1', 'R1']) { s = unitTurn(s, id, policy, trace, mem); remember(); if (outcome(s)) break; }
    let o = outcome(s); if (o) return { seed, policy, outcome: o, round: s.round, trace, state: s };
    s = R.beginPlayerPhase(R.resolveClockStatePhase(runThreatPhase(R.beginThreatPhase(s)).state));
    o = outcome(s); if (o) return { seed, policy, outcome: o, round: s.round, trace, state: s };
  }
  return { seed, policy, outcome: 'timeout', round: s.round, trace, state: s };
}
export function hqRates(n = 100, policy = 'naive') { const t = {}; for (let seed = 1; seed <= n; seed += 1) { const g = playHq(seed, policy); t[g.outcome] = (t[g.outcome] || 0) + 1; } return { policy, games: n, wins: t.win || 0, outcomes: t }; }
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) { const n = Number(process.argv[2] || 100); console.log(JSON.stringify(hqRates(n, 'naive'))); }
