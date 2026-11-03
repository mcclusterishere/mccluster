// DRAFT — optional, learning-unlocked tactical hints for the PRIM3 tactical resolver.
//
// Normal play never needs this module: every action in tactical-resolver.mjs works without it.
// A player MAY ask for a hint for the active unit. They get a learning challenge drawn from the
// current board and their field (E = math, R = science, T = IT; shared skills allowed). A correct
// answer unlocks a LEGAL suggestion for that unit, scored by a deterministic evaluator over the
// resolver's own rules. Nothing here moves a unit or spends an action point.
//
// Hard boundaries:
// - Fog of war: the evaluator only ever sees playerProjection(): own units, board, and the enemies
//   the player knows about. Hidden enemies, unrevealed tiles, technical truth and RNG never enter it.
// - Correctness of answers is exact arithmetic here (rationals), never a language model.
// - Geometry is the resolver's square grid: Manhattan gridDistance, Bresenham line of sight,
//   same-floor only. A hex adapter would be a separate, separately verified module.
// - The suggestion is "strong given what you know", never "perfect" or "guaranteed".
// - Bounded game rules only; nothing here is real-world weapon or trajectory guidance.

import { createState, gridDistance, hasLineOfSight, shotPreview, stableHash } from './tactical-resolver.mjs';

export const HINT_VERSION = 'tactical-hints/0.1.0';

// Explicit, documented weights. Units: "expected HP" for damage terms, tiles for objective progress.
export const WEIGHTS = Object.freeze({
  objectiveProgressPerTile: 0.6, // each tile closer to the nearest open objective
  incomingExpectedDamage: 1.0,   // per expected HP the known enemies could deal next phase
  outgoingExpectedDamage: 0.8,   // per expected HP this unit could deal after the move (if AP remains)
  concealmentBreak: 2.5,         // moving into a known enemy's detection (only while concealed)
  tieEpsilon: 0.05               // scores within this are reported as ties
});

const OPEN_OBJECTIVE_STATES = new Set(['OPEN', 'ACTIVE', 'IN_PROGRESS']);

// ---------- fog of war ----------

// The default "known enemy" rule uses only supported mechanics: an enemy is known when a living
// player unit has line of sight to it and it is within that player unit's detectionRadius, or
// when the host lists it in knownEnemyIds (its own fog layer: DETECTED/INFERRED/... states).
export function knownEnemyIds(state, knownEnemyIdsFromHost = null) {
  if (Array.isArray(knownEnemyIdsFromHost)) return new Set(knownEnemyIdsFromHost.map(String));
  const players = state.units.filter((u) => u.faction === 'PLAYER' && !u.dead && !u.downed);
  const known = new Set();
  for (const enemy of state.units) {
    if (enemy.faction === 'PLAYER' || enemy.dead) continue;
    if (players.some((p) => gridDistance(p, enemy) <= p.detectionRadius && hasLineOfSight(state, p, enemy))) known.add(enemy.id);
  }
  return known;
}

// What the player is entitled to see. Everything downstream takes ONLY this object.
export function playerProjection(state, { knownEnemyIds: hostKnown = null } = {}) {
  const known = knownEnemyIds(state, hostKnown);
  const units = state.units
    .filter((u) => u.faction === 'PLAYER' || known.has(u.id))
    .map((u) => ({ ...u, statuses: [...u.statuses] }));
  return {
    version: state.version,
    width: state.width,
    height: state.height,
    floors: state.floors,
    round: state.round,
    phase: state.phase,
    units,
    cover: state.cover.map((c) => ({ ...c, sides: [...c.sides] })),
    blockers: state.blockers.map((b) => ({ ...b })),
    objectives: state.objectives.map((o) => ({ ...o })),
    objectiveTiles: Array.isArray(state.battlefield && state.battlefield.objectiveTiles)
      ? state.battlefield.objectiveTiles.map((t) => ({ id: String(t.id), x: Number(t.x), y: Number(t.y), z: Number(t.z || 0) }))
      : [],
    mission: { clock: state.mission.clock, escalation: state.mission.escalation }
  };
}

// A resolver state rebuilt from the projection, so the resolver's own functions (shotPreview,
// hasLineOfSight) run on exactly what the player knows and nothing else.
function projectedState(projection) {
  const s = createState({ width: projection.width, height: projection.height, floors: projection.floors,
    units: projection.units, cover: projection.cover, blockers: projection.blockers, objectives: projection.objectives });
  s.round = projection.round; s.phase = projection.phase;
  // createState normalises units; keep the projected flags exactly
  s.units = projection.units.map((u) => ({ ...u, statuses: [...u.statuses] }));
  return s;
}

// ---------- binding ----------

export function stateFingerprint(projection, unitId) {
  return stableHash({ v: HINT_VERSION, unitId, p: projection });
}

export function bindingKey({ tenantId, playerId, missionId }, projection, unitId) {
  if (!tenantId || !playerId || !missionId) throw new Error('tenantId, playerId and missionId are required');
  return stableHash({ tenantId: String(tenantId), playerId: String(playerId), missionId: String(missionId),
    round: projection.round, unitId: String(unitId), fp: stateFingerprint(projection, unitId) });
}

// ---------- exact answers ----------

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; }
function rat(n, d = 1) { if (d === 0) throw new Error('zero denominator'); const s = d < 0 ? -1 : 1; const g = gcd(n, d); return { n: (s * n) / g, d: Math.abs(d) / g }; }
function ratEq(a, b) { return a.n === b.n && a.d === b.d; }

// Accepts "18", "1.8", "1.80", "9/5", " -3 ", "0x1A"(hex for IT), "yes"/"no". Returns {kind, value}.
export function parseAnswer(raw) {
  const text = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!text || text.length > 32) return null;
  if (['yes', 'y', 'true'].includes(text)) return { kind: 'bool', value: true };
  if (['no', 'n', 'false'].includes(text)) return { kind: 'bool', value: false };
  let m = /^(-?\d+)\s*\/\s*(\d+)$/.exec(text);
  if (m && Number(m[2]) !== 0) return { kind: 'num', value: rat(Number(m[1]), Number(m[2])) };
  m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (m) {
    const frac = m[3] || '';
    if (frac.length > 6) return null;
    const d = 10 ** frac.length;
    const n = Number(m[2]) * d + Number(frac || 0);
    return { kind: 'num', value: rat(m[1] ? -n : n, d) };
  }
  m = /^0x([0-9a-f]{1,8})$/.exec(text);
  if (m) return { kind: 'num', value: rat(parseInt(m[1], 16), 1) };
  return null;
}

function answersMatch(expected, given) {
  if (!given || given.kind !== expected.kind) return false;
  return expected.kind === 'bool' ? expected.value === given.value : ratEq(expected.value, given.value);
}

// ---------- challenges (deterministic from the binding) ----------

function seeded(seedHex) {
  let s = parseInt(seedHex.slice(0, 8), 16) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}

const FIELD_OF_ROLE = { E: 'MATH', R: 'SCIENCE', T: 'IT' };

// Each generator returns { skill, prompt, answer:{kind,value}, steps:[progressive hints], explain }.
const GENERATORS = {
  MATH: [
    (ctx, rnd) => { // grid distance on THIS board (the resolver's own rule)
      const u = ctx.unit, t = ctx.target;
      const d = Math.abs(u.x - t.x) + Math.abs(u.y - t.y);
      return { skill: 'math.manhattan-distance', prompt: `Your unit is at (${u.x}, ${u.y}). The ${t.label} is at (${t.x}, ${t.y}). Moving only along rows and columns, how many tiles apart are they?`,
        answer: { kind: 'num', value: rat(d) },
        steps: [`Count the column difference: |${u.x} − ${t.x}|.`, `Count the row difference: |${u.y} − ${t.y}|.`, `Add them: ${Math.abs(u.x - t.x)} + ${Math.abs(u.y - t.y)}.`],
        explain: `|${u.x}−${t.x}| + |${u.y}−${t.y}| = ${d}` };
    },
    (ctx, rnd) => { // expected damage = probability × damage (exact)
      const p = [25, 40, 50, 60, 75, 80][rnd() % 6], dmg = 2 + (rnd() % 4);
      const v = rat(p * dmg, 100);
      return { skill: 'math.expected-value', prompt: `A shot hits ${p}% of the time and deals ${dmg} damage when it hits. What is the expected damage per shot? (A fraction or a decimal is fine.)`,
        answer: { kind: 'num', value: v },
        steps: ['Expected value = chance × outcome.', `Write ${p}% as ${p}/100.`, `Multiply: ${p}/100 × ${dmg}.`],
        explain: `${p}/100 × ${dmg} = ${v.n}/${v.d}` };
    }
  ],
  SCIENCE: [
    (ctx, rnd) => { // inverse-square falloff (learning content; not a game mechanic)
      const d = 2 + (rnd() % 4);
      return { skill: 'science.inverse-square', prompt: `A sensor's signal strength falls off with the square of distance. At 1 tile it reads 1 unit. What does it read at ${d} tiles? (Answer as a fraction.)`,
        answer: { kind: 'num', value: rat(1, d * d) },
        steps: ['Inverse-square: strength ∝ 1 / distance².', `Square the distance: ${d}² = ${d * d}.`, `So the reading is 1 / ${d * d}.`],
        explain: `1 / ${d}² = 1/${d * d} (learning content; game detection uses the resolver's detectionRadius, not this curve)` };
    },
    (ctx, rnd) => { // rate: tiles per phase
      const speed = ctx.unit.moveRange, n = speed * (2 + (rnd() % 3));
      return { skill: 'science.rate', prompt: `A unit covers ${speed} tiles per move. How many moves does it need to cover ${n} tiles?`,
        answer: { kind: 'num', value: rat(n, speed) },
        steps: ['Time = distance ÷ rate.', `${n} ÷ ${speed}.`], explain: `${n} / ${speed} = ${n / speed}` };
    }
  ],
  IT: [
    (ctx, rnd) => { // usable hosts in a subnet
      const prefix = [26, 27, 28, 29, 30][rnd() % 5], hosts = 2 ** (32 - prefix) - 2;
      return { skill: 'it.subnet-hosts', prompt: `How many usable host addresses are in an IPv4 /${prefix} subnet?`,
        answer: { kind: 'num', value: rat(hosts) },
        steps: [`Host bits = 32 − ${prefix} = ${32 - prefix}.`, `Addresses = 2^${32 - prefix} = ${2 ** (32 - prefix)}.`, 'Subtract the network and broadcast addresses: − 2.'],
        explain: `2^${32 - prefix} − 2 = ${hosts}` };
    },
    (ctx, rnd) => { // hex to decimal
      const v = 16 + (rnd() % 240);
      return { skill: 'it.hex', prompt: `A node label reads 0x${v.toString(16).toUpperCase()}. What is that in decimal?`,
        answer: { kind: 'num', value: rat(v) },
        steps: ['Each hex digit is a power of 16.', `0x${v.toString(16).toUpperCase()} = ${Math.floor(v / 16)}×16 + ${v % 16}.`],
        explain: `${Math.floor(v / 16)}×16 + ${v % 16} = ${v}` };
    }
  ]
};

function challengeContext(projection, unit) {
  const tiles = projection.objectiveTiles.filter((t) => isOpenObjective(projection, t.id));
  const enemies = projection.units.filter((u) => u.faction !== 'PLAYER' && !u.dead);
  const target = tiles[0] ? { ...tiles[0], label: 'objective' }
    : enemies[0] ? { x: enemies[0].x, y: enemies[0].y, label: 'known hostile' }
    : { x: Math.min(projection.width - 1, unit.x + 3), y: unit.y, label: 'waypoint' };
  return { unit, target };
}

// mastery: 0..3. Higher mastery unlocks the harder generator of the field (and richer guidance).
export function createChallenge(binding, projection, unitId, { mastery = 0, field = null } = {}) {
  const unit = projection.units.find((u) => u.id === unitId && u.faction === 'PLAYER');
  if (!unit) throw new Error('UNKNOWN_OR_FOREIGN_UNIT');
  const key = bindingKey(binding, projection, unitId);
  const chosenField = field || FIELD_OF_ROLE[unit.role] || 'MATH';
  const list = GENERATORS[chosenField];
  const rnd = seeded(key);
  const gen = list[mastery >= 2 ? Math.min(1, list.length - 1) : 0]; // higher mastery: the harder generator
  const c = gen(challengeContext(projection, unit), rnd);
  return {
    // public part: safe to show
    public: { challengeId: stableHash({ key, skill: c.skill }), bindingKey: key, unitId, round: projection.round, field: chosenField, skill: c.skill, prompt: c.prompt },
    // server-held part: never sent to the browser before a correct answer
    secret: { answer: c.answer, steps: c.steps, explain: c.explain }
  };
}

// ---------- the evaluator ----------

function isOpenObjective(projection, id) {
  const o = projection.objectives.find((x) => x.id === id);
  return !o || OPEN_OBJECTIVE_STATES.has(o.state);
}

function nearestObjectiveDistance(projection, at) {
  let best = Infinity, id = null;
  for (const t of projection.objectiveTiles) {
    if (!isOpenObjective(projection, t.id)) continue;
    const d = gridDistance(at, t);
    if (d < best) { best = d; id = t.id; }
  }
  return { distance: best, objectiveId: id };
}

function expectedDamage(preview) {
  if (!preview || !preview.legal) return 0;
  const p = preview.hitChance / 100, c = preview.critChance / 100;
  return p * ((1 - c) * preview.damage + c * preview.critDamage);
}

export function legalCandidates(projection, unitId) {
  const unit = projection.units.find((u) => u.id === unitId);
  const out = [{ action: 'HOLD', x: unit.x, y: unit.y, z: unit.z, apCost: 0 }];
  if (unit.ap < 1 || unit.dead || unit.downed) return out;
  const blocked = new Set(projection.blockers.map((b) => `${b.x}:${b.y}:${b.z}`));
  const taken = new Set(projection.units.filter((u) => !u.dead && u.id !== unit.id).map((u) => `${u.x}:${u.y}:${u.z}`));
  for (let y = 0; y < projection.height; y += 1) {
    for (let x = 0; x < projection.width; x += 1) {
      const tile = { x, y, z: unit.z };
      if (x === unit.x && y === unit.y) continue;
      const d = gridDistance(unit, tile);
      if (d > unit.moveRange) continue; // resolver MOVE rule: Manhattan distance ≤ moveRange, 1 AP
      if (blocked.has(`${x}:${y}:${unit.z}`) || taken.has(`${x}:${y}:${unit.z}`)) continue;
      out.push({ action: 'MOVE', x, y, z: unit.z, apCost: 1 });
    }
  }
  return out;
}

export function evaluate(projection, unitId, weights = WEIGHTS) {
  const base = projectedState(projection);
  const unit = base.units.find((u) => u.id === unitId);
  const enemies = base.units.filter((u) => u.faction !== 'PLAYER' && !u.dead && !u.downed);
  const startObj = nearestObjectiveDistance(projection, unit);
  const scored = legalCandidates(projection, unitId).map((cand) => {
    const s = { ...base, units: base.units.map((u) => (u.id === unitId ? { ...u, x: cand.x, y: cand.y, z: cand.z } : u)) };
    const apLeft = unit.ap - cand.apCost;
    let incoming = 0, outgoing = 0, bestShot = null, detected = false, exposedTo = [];
    for (const e of enemies) {
      const inc = expectedDamage(shotPreview(s, e.id, unitId));
      if (inc > 0) exposedTo.push({ id: e.id, expected: round2(inc) });
      incoming += inc;
      if (apLeft >= 1) {
        const pv = shotPreview(s, unitId, e.id);
        const out = expectedDamage(pv);
        if (out > outgoing) { outgoing = out; bestShot = { targetId: e.id, hitChance: pv.hitChance, damage: pv.damage, cover: pv.cover, flanked: pv.flanked }; }
      }
      if (unit.concealed && gridDistance(e, cand) <= e.detectionRadius && hasLineOfSight(s, e, cand)) detected = true;
    }
    const obj = nearestObjectiveDistance(projection, cand);
    const progress = Number.isFinite(startObj.distance) && Number.isFinite(obj.distance) ? startObj.distance - obj.distance : 0;
    const score = weights.objectiveProgressPerTile * progress - weights.incomingExpectedDamage * incoming
      + weights.outgoingExpectedDamage * outgoing - (detected ? weights.concealmentBreak : 0);
    return { ...cand, score: round2(score), features: { objectiveProgress: progress, objectiveDistance: obj.distance, incomingExpected: round2(incoming), exposedTo, outgoingExpected: round2(outgoing), bestShot, breaksConcealment: detected, apLeft } };
  });
  scored.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x || (a.action === 'HOLD' ? -1 : 1));
  const top = scored[0];
  const ties = scored.filter((c) => top.score - c.score <= weights.tieEpsilon);
  return { top, ties, candidates: scored, objective: startObj };
}

function round2(v) { return Math.round(v * 100) / 100; }

function explainSuggestion(result, projection) {
  const t = result.top, f = t.features, lines = [];
  lines.push(t.action === 'HOLD' ? `Hold position at (${t.x}, ${t.y}).` : `Move to (${t.x}, ${t.y}) — 1 action point (Manhattan distance ${Math.abs(t.x - result.unitAt.x) + Math.abs(t.y - result.unitAt.y)} ≤ move range ${result.moveRange}).`);
  if (Number.isFinite(f.objectiveDistance)) lines.push(`Objective: ${f.objectiveDistance} tiles away after this (${f.objectiveProgress >= 0 ? 'closer by ' + f.objectiveProgress : 'farther by ' + (-f.objectiveProgress)}).`);
  else lines.push('No reachable objective tile is known on this floor; the suggestion weighs safety and shots only.');
  lines.push(f.exposedTo.length ? `Known hostiles that could shoot you there: expected ${f.incomingExpected} damage (sum of hit% × damage, crits included).` : 'No known hostile has a shot at that tile.');
  if (f.bestShot) lines.push(`From there you keep 1 action: best known shot ${f.bestShot.hitChance}% for ${f.bestShot.damage} (expected ${f.outgoingExpected})${f.bestShot.flanked ? ', flanking' : ''}.`);
  if (f.breaksConcealment) lines.push('This tile is inside a known hostile\'s detection range: it breaks concealment.');
  if (result.ties.length > 1) lines.push(`${result.ties.length} options score within ${WEIGHTS.tieEpsilon} of each other; others are just as reasonable.`);
  lines.push('Based only on what your squad can see. Unseen hostiles, cover you have not revealed and dice rolls can change the outcome — this is a strong option, not a guaranteed one.');
  return lines;
}

// ---------- the session (bind, verify, unlock) ----------

// session: the server-held record for one hint request. Pure: returns a new session + response.
export function openHint(binding, state, unitId, opts = {}) {
  if (state.phase !== 'PLAYER') throw new Error('HINTS_ONLY_IN_PLAYER_PHASE');
  const projection = playerProjection(state, opts);
  const unit = projection.units.find((u) => u.id === unitId);
  if (!unit || unit.faction !== 'PLAYER') throw new Error('UNKNOWN_OR_FOREIGN_UNIT');
  const ch = createChallenge(binding, projection, unitId, opts);
  return { session: { binding: { ...binding }, unitId, bindingKey: ch.public.bindingKey, challenge: ch, attempts: 0, solved: false, revealed: false, rewardIssued: false }, response: ch.public };
}

export function answerHint(session, binding, state, input, opts = {}) {
  for (const k of ['tenantId', 'playerId', 'missionId']) if (String(session.binding[k]) !== String(binding[k])) return { session, response: { ok: false, code: 'NOT_YOUR_HINT' } };
  const projection = playerProjection(state, opts);
  if (state.phase !== 'PLAYER' || bindingKey(binding, projection, session.unitId) !== session.bindingKey) {
    return { session, response: { ok: false, code: 'STALE_BOARD', message: 'The board changed since this hint was opened. Ask again for a fresh one.' } };
  }
  const next = { ...session };
  if (next.solved) return { session: next, response: { ok: true, already: true, ...suggestion(projection, session.unitId, next) } };
  const given = parseAnswer(input);
  if (!answersMatch(next.challenge.secret.answer, given)) {
    next.attempts += 1;
    const steps = next.challenge.secret.steps;
    return { session: next, response: { ok: false, code: given ? 'WRONG' : 'UNREADABLE', attempts: next.attempts, nextStep: steps[Math.min(next.attempts - 1, steps.length - 1)], canReveal: next.attempts >= steps.length } };
  }
  next.solved = true;
  const reward = !next.rewardIssued && !next.revealed; // mastery evidence only once, and never after a reveal
  next.rewardIssued = next.rewardIssued || reward;
  return { session: next, response: { ok: true, masteryEvidence: reward ? { skill: next.challenge.public.skill, independent: next.attempts === 0 } : null, explain: next.challenge.secret.explain, ...suggestion(projection, session.unitId, next) } };
}

// After enough wrong tries the player may see the worked answer. It still unlocks the hint, but it
// never counts as demonstrated mastery.
export function revealAnswer(session) {
  const steps = session.challenge.secret.steps;
  if (session.attempts < steps.length) return { session, response: { ok: false, code: 'KEEP_TRYING' } };
  return { session: { ...session, revealed: true }, response: { ok: true, explain: session.challenge.secret.explain, note: 'Revealed answers do not count toward mastery.' } };
}

function suggestion(projection, unitId, session) {
  const result = evaluate(projection, unitId);
  const unit = projection.units.find((u) => u.id === unitId);
  result.unitAt = { x: unit.x, y: unit.y }; result.moveRange = unit.moveRange;
  return {
    suggestion: { action: result.top.action, x: result.top.x, y: result.top.y, z: result.top.z, score: result.top.score, features: result.top.features },
    alternatives: result.ties.slice(1, 4).map((c) => ({ action: c.action, x: c.x, y: c.y, score: c.score })),
    why: explainSuggestion(result, projection),
    weights: WEIGHTS,
    autoAction: false // the hint never moves the unit or spends AP
  };
}
