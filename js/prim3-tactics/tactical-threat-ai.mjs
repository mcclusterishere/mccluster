// DRAFT — deterministic Threat-phase AI for the PRIM3 tactical resolver.
//
// runThreatPhase(state, { rng }) decides and acts ONLY through the resolver's exported actions
// (moveUnit, fireWeapon, enterOverwatch, hunkerDown, reload). It never edits state itself.
//
// Canon (TACTICAL-CORE-MECHANICS.yaml): hostile_awareness = local senses + alert network;
// may_read_hidden_learner_model: false; threat_ai.may_use_hidden_learner_data: false. This module
// never touches the learner profile or technical truth (tested: different profiles → identical play).
//
// Awareness: a player unit is KNOWN when any living threat detects it right now (within that threat's
// detectionRadius and line of sight). The alert network shares that knowledge with every threat.
// A player unit that shot at a threat this round (FIRE / OVERWATCH_SHOT events) is also known.
// Unaware threats hold, or walk a short declared patrol (unit.patrol), and never shoot.
//
// Aware threat, per unit, in units-array order:
//   1. a known target with a legal shot at ≥ 50 % → fire (firing ends the activation);
//   2. else an empty magazine → reload (once, if reserve ammo and a magazine size exist; else hunker);
//   3. else MOVE (never dash) to the best reachable tile, scored:
//        cover facing the nearest known target (HIGH 3, LOW 2)
//      + a legal shot on a known target (2 + best hit% / 100)
//      + keeps ≥ 3 tiles from every known player (1, else −2)
//      ties: lower movement cost, then z, y, x (deterministic);
//   4. with AP left: fire if any legal shot, else overwatch.
// Downed or dead threats do nothing. Player overwatch fires on threat movement through moveUnit.
//
// Machines (game/TACTICAL-T-CONTROL-RULES.md): hostile ACTIVE cameras feed the alert network. A threat
// with status NETWORK_SILENCED neither shares nor receives network knowledge: it knows only what it
// detects itself and who shot at it. Before anything else, an aware threat re-takes a squad-controlled
// machine when the resolver allows it (2 AP, ≤ 6 tiles, line of sight, 3-round protection over):
// a turret first, then a camera, then a door; ties by distance, then id.
// Rolls: options.rng (function → 0..99, or an array consumed in order); without it, the state's
// seeded PRNG (state.rng). Same state + same rng → same events.

import { shotPreview, moveUnit, fireWeapon, enterOverwatch, hunkerDown, reload, computeReach,
  coverForAttack, gridDistance, hasLineOfSight, drawRolls, retakeMachine, techActionPreview, isExtracted } from './tactical-resolver.mjs';

export const THREAT_AI_VERSION = 'tactical-threat-ai/0.1.0';
export const FIRE_THRESHOLD = 50;
export const KEEP_DISTANCE = 3;

const alive = (u) => !u.dead && !u.downed && !isExtracted(u);
const silenced = (u) => u.statuses.includes('NETWORK_SILENCED');
const RETAKE_PREFERENCE = { TURRET: 0, CAMERA: 1, DOOR: 2 };

function roller(options) {
  const rng = options.rng;
  if (typeof rng === 'function') return { draw: (s) => ({ state: s, roll: Number(rng()) }), fn: () => Number(rng()) };
  if (Array.isArray(rng)) {
    let i = 0;
    const next = () => (i < rng.length ? Number(rng[i++]) : null);
    return {
      draw: (s) => { const r = next(); if (r !== null) return { state: s, roll: r }; const d = drawRolls(s, 1); return { state: d.state, roll: d.rolls[0] }; },
      fn: null,
      rest: () => rng.slice(i),
      // moveUnit consumes a supplied array first (2 rolls per reaction shot), then the state PRNG
      consumed: (n) => { i = Math.min(rng.length, i + n); }
    };
  }
  return { draw: (s) => { const d = drawRolls(s, 1); return { state: d.state, roll: d.rolls[0] }; }, fn: null };
}

// Player units the threats know about right now (no learner data, no technical truth).
// Without unitId: the alert network (every threat that is not NETWORK_SILENCED, plus hostile ACTIVE
// cameras). With the id of a NETWORK_SILENCED threat: only what that threat knows on its own.
export function threatKnowledge(state, unitId = null) {
  const self = unitId != null ? state.units.find((u) => u.id === unitId) : null;
  const isolated = Boolean(self && self.faction !== 'PLAYER' && silenced(self));
  const threats = isolated ? (alive(self) ? [self] : [])
    : state.units.filter((u) => u.faction !== 'PLAYER' && alive(u) && !silenced(u));
  const cameras = isolated ? [] : (state.machines || []).filter((m) => m.kind === 'CAMERA' && m.faction === 'THREAT' && m.state === 'ACTIVE');
  const known = new Set();
  const sees = (w, p) => gridDistance(w, p, state) <= w.detectionRadius && hasLineOfSight(state, w, p);
  for (const p of state.units) {
    if (p.faction !== 'PLAYER' || p.dead || isExtracted(p)) continue;
    if (threats.some((t) => sees(t, p)) || cameras.some((c) => sees(c, p))) known.add(p.id);
  }
  // shots taken at threats this round
  let from = 0;
  for (let i = state.events.length - 1; i >= 0; i -= 1) {
    const e = state.events[i];
    if (e.type === 'PLAYER_PHASE_BEGIN' && e.round === state.round) { from = i; break; }
  }
  const ids = new Map(state.units.map((u) => [u.id, u]));
  for (const e of state.events.slice(from)) {
    const shooter = e.type === 'FIRE' ? e.attackerId : e.type === 'OVERWATCH_SHOT' ? e.watcherId : null;
    if (!shooter) continue;
    const s = ids.get(shooter), t = ids.get(e.targetId);
    if (!s || !t || s.faction !== 'PLAYER' || t.faction === 'PLAYER' || s.dead || isExtracted(s) || isExtracted(t)) continue;
    if (isolated ? t.id === self.id : !silenced(t)) known.add(s.id);
  }
  return known;
}

function targetsFor(state, known) {
  return state.units.filter((u) => known.has(u.id) && alive(u));
}

function bestShot(state, unitId, targets) {
  let best = null;
  for (const t of targets) {
    const pv = shotPreview(state, unitId, t.id);
    if (!pv.legal) continue;
    if (!best || pv.hitChance > best.hitChance || (pv.hitChance === best.hitChance && (t.hp < best.hp || (t.hp === best.hp && t.id < best.targetId)))) {
      best = { targetId: t.id, hitChance: pv.hitChance, hp: t.hp };
    }
  }
  return best;
}

function scoreTile(state, unit, cell, targets, players) {
  const placed = { ...state, units: state.units.map((u) => (u.id === unit.id ? { ...u, x: cell.x, y: cell.y, z: cell.z } : u)) };
  const here = { x: cell.x, y: cell.y, z: cell.z };
  let nearest = null, nd = Infinity;
  for (const t of targets) {
    const d = gridDistance(here, t, state);
    if (d < nd || (d === nd && nearest && t.id < nearest.id)) { nd = d; nearest = t; }
  }
  let score = 0;
  if (nearest) {
    const cover = coverForAttack(state, here, nearest);
    if (cover.type === 'HIGH') score += 3; else if (cover.type === 'LOW') score += 2;
  }
  const shot = bestShot(placed, unit.id, targets);
  if (shot) score += 2 + shot.hitChance / 100;
  const close = players.some((p) => gridDistance(here, p, state) < KEEP_DISTANCE);
  score += close ? -2 : 1;
  return score;
}

function chooseTile(state, unit, targets, known) {
  // plan over what the threats know: other threats and KNOWN players occupy tiles; an unknown player
  // on the route interrupts the move in the resolver, exactly as for the player side
  const occupants = state.units.filter((u) => u.faction !== 'PLAYER' || known.has(u.id));
  const reach = computeReach(state, unit.id, unit.moveRange, { occupants });
  const players = state.units.filter((u) => known.has(u.id) && !u.dead && !isExtracted(u));
  let best = { x: unit.x, y: unit.y, z: unit.z, cost: 0, score: scoreTile(state, unit, unit, targets, players) };
  for (const c of reach.cells) {
    const score = scoreTile(state, unit, c, targets, players);
    const better = score > best.score + 1e-9
      || (Math.abs(score - best.score) <= 1e-9 && (c.cost < best.cost || (c.cost === best.cost && (c.z - best.z || c.y - best.y || c.x - best.x) < 0)));
    if (better) best = { ...c, score };
  }
  if (best.x === unit.x && best.y === unit.y && best.z === unit.z) return null;
  return { cell: best, path: reach.pathTo(best.x, best.y, best.z) };
}

// The squad-controlled machine this threat should re-take now, if the resolver allows any.
function retakeChoice(state, unit) {
  let best = null;
  for (const m of state.machines || []) {
    if (m.faction !== 'PLAYER' || !m.controlledBy) continue;
    const pv = techActionPreview(state, 'RETAKE', unit.id, m.id);
    if (!pv.legal) continue;
    const cand = { id: m.id, kind: m.kind, pref: RETAKE_PREFERENCE[m.kind] ?? 9, distance: pv.distance };
    const better = !best || cand.pref < best.pref || (cand.pref === best.pref
      && (cand.distance < best.distance || (cand.distance === best.distance && cand.id < best.id)));
    if (better) best = cand;
  }
  return best;
}

function patrolStep(state, unit) {
  const route = unit.patrol;
  if (!Array.isArray(route) || !route.length) return null;
  const i = route.findIndex((c) => c.x === unit.x && c.y === unit.y && (c.z || 0) === unit.z);
  const goal = route[i < 0 ? 0 : (i + 1) % route.length];
  if (goal.x === unit.x && goal.y === unit.y && (goal.z || 0) === unit.z) return null;
  const occupants = state.units.filter((u) => u.faction !== 'PLAYER');
  const reach = computeReach(state, unit.id, Infinity, { occupants });
  const full = reach.pathTo(goal.x, goal.y, goal.z || 0);
  if (!full || !full.length) return null;
  // walk as far along the route as one MOVE allows
  const cut = [];
  let at = { x: unit.x, y: unit.y, z: unit.z };
  for (const step of full) {
    const cost = reach.costAt(step.x, step.y, step.z);
    if (cost > unit.moveRange) break;
    cut.push(step); at = step;
  }
  if (!cut.length) return null;
  return { cell: at, path: cut };
}

export function runThreatPhase(state, options = {}) {
  if (!state || state.phase !== 'THREAT') throw new Error('runThreatPhase requires the THREAT phase');
  const dice = roller(options);
  const startEvents = state.events.length;
  const decisions = [];
  let s = state;
  const order = s.units.filter((u) => u.faction !== 'PLAYER').map((u) => u.id);
  const move = (unitId, cell, path) => {
    const before = s.events.length;
    s = moveUnit(s, unitId, cell, 'MOVE', { path, ...(dice.fn ? { rolls: dice.fn } : dice.rest ? { rolls: dice.rest() } : {}) });
    if (dice.consumed) dice.consumed(2 * s.events.slice(before).filter((e) => e.type === 'OVERWATCH_SHOT' || e.type === 'TURRET_SHOT').length);
  };
  const fire = (unitId, targetId) => {
    const a = dice.draw(s); s = a.state;
    const b = dice.draw(s); s = b.state;
    s = fireWeapon(s, unitId, targetId, a.roll, b.roll).state;
  };
  for (const id of order) {
    let unit = s.units.find((u) => u.id === id);
    if (!unit || !alive(unit)) continue;
    const known = threatKnowledge(s, id);
    let targets = targetsFor(s, known);
    if (!known.size) {
      const step = unit.ap >= 1 ? patrolStep(s, unit) : null;
      if (step) {
        move(id, step.cell, step.path);
        decisions.push({ unitId: id, aware: false, action: 'PATROL', to: { x: step.cell.x, y: step.cell.y, z: step.cell.z } });
      } else decisions.push({ unitId: id, aware: false, action: 'HOLD' });
      continue;
    }
    const retake = retakeChoice(s, unit);
    if (retake) {
      s = retakeMachine(s, id, retake.id);
      decisions.push({ unitId: id, aware: true, action: 'RETAKE', machineId: retake.id, kind: retake.kind });
      continue;
    }
    let moved = false, reloaded = false;
    for (let guard = 0; guard < 6; guard += 1) {
      unit = s.units.find((u) => u.id === id);
      if (!alive(unit) || unit.ap < 1) break;
      targets = targetsFor(s, threatKnowledge(s, id));
      const shot = bestShot(s, id, targets);
      if (shot && shot.hitChance >= FIRE_THRESHOLD) {
        fire(id, shot.targetId);
        decisions.push({ unitId: id, aware: true, action: 'FIRE', targetId: shot.targetId, hitChance: shot.hitChance });
        break;
      }
      if (unit.ammo <= 0) {
        if (unit.reserveAmmo > 0 && unit.magazineSize > 0 && !reloaded) {
          s = reload(s, id); reloaded = true;
          decisions.push({ unitId: id, aware: true, action: 'RELOAD' });
          continue;
        }
        s = hunkerDown(s, id);
        decisions.push({ unitId: id, aware: true, action: 'HUNKER' });
        break;
      }
      if (!moved) {
        moved = true;
        const choice = chooseTile(s, unit, targets, threatKnowledge(s, id));
        if (choice && choice.path) {
          move(id, choice.cell, choice.path);
          decisions.push({ unitId: id, aware: true, action: 'MOVE', to: { x: choice.cell.x, y: choice.cell.y, z: choice.cell.z } });
          continue;
        }
      }
      // remaining AP: fire if any legal shot, else overwatch
      const any = bestShot(s, id, targets);
      if (any) {
        fire(id, any.targetId);
        decisions.push({ unitId: id, aware: true, action: 'FIRE', targetId: any.targetId, hitChance: any.hitChance });
      } else {
        s = enterOverwatch(s, id);
        decisions.push({ unitId: id, aware: true, action: 'OVERWATCH' });
      }
      break;
    }
  }
  return { state: s, events: s.events.slice(startEvents), decisions };
}
