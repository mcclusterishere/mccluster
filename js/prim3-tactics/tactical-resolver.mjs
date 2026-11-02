const CARDINALS = ['N', 'E', 'S', 'W'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function stableString(value) {
  if (Array.isArray(value)) return `[${value.map(stableString).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value) {
  const text = typeof value === 'string' ? value : stableString(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeUnit(unit) {
  return {
    id: String(unit.id),
    faction: unit.faction || 'PLAYER',
    role: unit.role || null,
    x: Number(unit.x || 0),
    y: Number(unit.y || 0),
    z: Number(unit.z || 0),
    hp: Number(unit.hp ?? 6),
    maxHp: Number(unit.maxHp ?? unit.hp ?? 6),
    ap: Number(unit.ap ?? 0),
    maxAp: Number(unit.maxAp ?? 2),
    moveRange: Number(unit.moveRange ?? 6),
    aim: Number(unit.aim ?? 70),
    crit: Number(unit.crit ?? 10),
    weaponDamage: Number(unit.weaponDamage ?? 3),
    critBonus: Number(unit.critBonus ?? 2),
    ammo: Number(unit.ammo ?? 4),
    magazineSize: Number(unit.magazineSize ?? unit.ammo ?? 4),
    reserveAmmo: Number(unit.reserveAmmo ?? 8),
    detectionRadius: Number(unit.detectionRadius ?? 5),
    concealed: Boolean(unit.concealed),
    overwatch: Boolean(unit.overwatch),
    hunkered: Boolean(unit.hunkered),
    downed: Boolean(unit.downed),
    dead: Boolean(unit.dead),
    canBeDowned: unit.canBeDowned !== false,
    statuses: Array.isArray(unit.statuses) ? [...unit.statuses] : []
  };
}

function copyState(state) {
  return {
    ...state,
    units: state.units.map((unit) => ({ ...unit, statuses: [...unit.statuses] })),
    cover: state.cover.map((item) => ({ ...item, sides: [...item.sides] })),
    blockers: state.blockers.map((item) => ({ ...item })),
    nodes: state.nodes.map((node) => ({ ...node })),
    objectives: state.objectives.map((objective) => ({ ...objective })),
    mission: clone(state.mission),
    battlefield: clone(state.battlefield),
    events: [...state.events],
    technicalTruth: state.technicalTruth,
    technicalTruthHash: state.technicalTruthHash,
    learnerProfile: state.learnerProfile ? clone(state.learnerProfile) : null
  };
}

function createState(config = {}) {
  const technicalTruth = deepFreeze(clone(config.technicalTruth || { nodes: {} }));
  return {
    version: '0.1.0',
    width: Number(config.width || 20),
    height: Number(config.height || 20),
    floors: Number(config.floors || 1),
    round: 0,
    phase: 'BRIEF',
    units: (config.units || []).map(normalizeUnit),
    cover: (config.cover || []).map((item) => ({
      x: Number(item.x), y: Number(item.y), z: Number(item.z || 0),
      type: item.type === 'HIGH' ? 'HIGH' : 'LOW',
      sides: (item.sides || []).filter((side) => CARDINALS.includes(side))
    })),
    blockers: (config.blockers || []).map((item) => ({ x: Number(item.x), y: Number(item.y), z: Number(item.z || 0) })),
    nodes: (config.nodes || []).map((node) => ({ id: String(node.id), state: node.state || 'UNSEEN', required: node.required !== false })),
    objectives: (config.objectives || []).map((objective) => ({ id: String(objective.id), required: objective.required !== false, state: objective.state || 'OPEN' })),
    mission: {
      escalation: 'STABLE',
      clock: Number(config.clock ?? 8),
      quietWindow: Number(config.quietWindow ?? 0),
      reinforcementsQueued: 0,
      extractionRequired: Boolean(config.extractionRequired),
      extractedUnitIds: []
    },
    battlefield: clone(config.battlefield || {}),
    events: [],
    technicalTruth,
    technicalTruthHash: stableHash(technicalTruth),
    learnerProfile: config.learnerProfile ? clone(config.learnerProfile) : null
  };
}

function unitById(state, unitId) {
  const unit = state.units.find((item) => item.id === unitId);
  if (!unit) throw new Error(`Unknown unit ${unitId}`);
  return unit;
}

function nodeById(state, nodeId) {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Unknown LAB_NODE ${nodeId}`);
  return node;
}

function beginPlayerPhase(state) {
  const next = copyState(state);
  next.round += 1;
  next.phase = 'PLAYER';
  for (const unit of next.units) {
    if (unit.faction !== 'PLAYER' || unit.dead || unit.downed) continue;
    unit.ap = unit.maxAp;
    unit.overwatch = false;
    unit.hunkered = false;
  }
  next.events.push({ type: 'PLAYER_PHASE_BEGIN', round: next.round });
  return next;
}

function beginThreatPhase(state) {
  const next = copyState(state);
  next.phase = 'THREAT';
  for (const unit of next.units) {
    if (unit.faction === 'PLAYER' || unit.dead || unit.downed) continue;
    unit.ap = unit.maxAp;
    unit.overwatch = false;
    unit.hunkered = false;
  }
  next.events.push({ type: 'THREAT_PHASE_BEGIN', round: next.round });
  return next;
}

function resolveClockStatePhase(state) {
  const next = copyState(state);
  next.phase = 'CLOCK_STATE';
  next.mission.clock = Math.max(0, next.mission.clock - 1);
  if (next.mission.clock === 0) next.mission.escalation = 'TERMINAL';
  else if (next.mission.clock <= 2) next.mission.escalation = 'CRITICAL';
  else if (next.mission.clock <= 5 && next.mission.escalation === 'STABLE') next.mission.escalation = 'DEGRADED';
  next.events.push({ type: 'CLOCK_STATE_RESOLVED', round: next.round, clock: next.mission.clock, escalation: next.mission.escalation });
  return next;
}

function gridDistance(a, b) {
  if (Number(a.z || 0) !== Number(b.z || 0)) return Infinity;
  return Math.abs(Number(a.x) - Number(b.x)) + Math.abs(Number(a.y) - Number(b.y));
}

function occupied(state, x, y, z, exceptId = null) {
  return state.units.some((unit) => !unit.dead && unit.id !== exceptId && unit.x === x && unit.y === y && unit.z === z);
}

function inBounds(state, x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 && x < state.width && y < state.height && z < state.floors;
}

function lineCells(a, b) {
  const cells = [];
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    if (!(x0 === x1 && y0 === y1)) cells.push({ x: x0, y: y0, z: Number(a.z || 0) });
  }
  return cells;
}

function hasLineOfSight(state, a, b) {
  if (Number(a.z || 0) !== Number(b.z || 0)) return false;
  const blockers = new Set(state.blockers.map((item) => `${item.x}:${item.y}:${item.z}`));
  return !lineCells(a, b).some((cell) => blockers.has(`${cell.x}:${cell.y}:${cell.z}`));
}

function sourceSide(target, attacker) {
  const dx = attacker.x - target.x;
  const dy = attacker.y - target.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
  return dy > 0 ? 'S' : 'N';
}

function coverForAttack(state, target, attacker) {
  const cover = state.cover.find((item) => item.x === target.x && item.y === target.y && item.z === target.z);
  if (!cover) return { type: 'NONE', bonus: 0, flanked: false };
  const protectedSide = cover.sides.includes(sourceSide(target, attacker));
  if (!protectedSide) return { type: 'NONE', bonus: 0, flanked: true, underlying: cover.type };
  return { type: cover.type, bonus: cover.type === 'HIGH' ? 40 : 20, flanked: false };
}

function shotPreview(state, attackerId, targetId) {
  const attacker = unitById(state, attackerId);
  const target = unitById(state, targetId);
  if (attacker.dead || attacker.downed || target.dead) return { legal: false, reason: 'INVALID_UNIT_STATE' };
  if (attacker.faction === target.faction) return { legal: false, reason: 'FRIENDLY_TARGET' };
  if (!hasLineOfSight(state, attacker, target)) return { legal: false, reason: 'NO_LINE_OF_SIGHT' };
  if (attacker.ammo <= 0) return { legal: false, reason: 'EMPTY_MAGAZINE' };
  const cover = coverForAttack(state, target, attacker);
  const distance = gridDistance(attacker, target);
  const rangePenalty = Math.max(0, distance - 6) * 4;
  const elevationBonus = attacker.z > target.z ? 10 : 0;
  const hunkerPenalty = target.hunkered ? 20 : 0;
  const flankBonus = cover.flanked ? 15 : 0;
  const chance = clamp(attacker.aim - cover.bonus - rangePenalty - hunkerPenalty + elevationBonus + flankBonus, 5, 95);
  const critChance = clamp(attacker.crit + (cover.flanked ? 20 : 0), 0, 75);
  return {
    legal: true,
    hitChance: Math.round(chance),
    critChance: Math.round(critChance),
    damage: attacker.weaponDamage,
    critDamage: attacker.weaponDamage + attacker.critBonus,
    cover: cover.type,
    flanked: cover.flanked,
    distance
  };
}

function spendAp(unit, amount) {
  if (unit.ap < amount) throw new Error('Not enough action points');
  unit.ap -= amount;
}

function detectAtPosition(state, mover) {
  return state.units.some((enemy) => {
    if (enemy.faction === mover.faction || enemy.dead || enemy.downed) return false;
    return gridDistance(enemy, mover) <= enemy.detectionRadius && hasLineOfSight(state, enemy, mover);
  });
}

function moveUnit(state, unitId, destination, mode = 'MOVE') {
  const next = copyState(state);
  const unit = unitById(next, unitId);
  if (next.phase !== (unit.faction === 'PLAYER' ? 'PLAYER' : 'THREAT')) throw new Error('Unit cannot act outside its phase');
  if (unit.dead || unit.downed) throw new Error('Unit cannot move');
  const dest = { x: Number(destination.x), y: Number(destination.y), z: Number(destination.z || 0) };
  if (!inBounds(next, dest.x, dest.y, dest.z)) throw new Error('Destination out of bounds');
  if (occupied(next, dest.x, dest.y, dest.z, unit.id)) throw new Error('Destination occupied');
  const distance = gridDistance(unit, dest);
  const isDash = mode === 'DASH';
  const maxDistance = unit.moveRange * (isDash ? 2 : 1);
  const cost = isDash ? 2 : 1;
  if (!Number.isFinite(distance) || distance > maxDistance) throw new Error('Destination outside movement range');
  spendAp(unit, cost);
  unit.x = dest.x; unit.y = dest.y; unit.z = dest.z;
  if (unit.concealed && detectAtPosition(next, unit)) {
    unit.concealed = false;
    next.events.push({ type: 'CONCEALMENT_BROKEN', unitId: unit.id, reason: 'DETECTION' });
  }
  next.events.push({ type: isDash ? 'DASH' : 'MOVE', unitId: unit.id, destination: dest, apRemaining: unit.ap });
  return next;
}

function enterOverwatch(state, unitId) {
  const next = copyState(state);
  const unit = unitById(next, unitId);
  spendAp(unit, 1);
  unit.overwatch = true;
  next.events.push({ type: 'OVERWATCH_SET', unitId });
  return next;
}

function hunkerDown(state, unitId) {
  const next = copyState(state);
  const unit = unitById(next, unitId);
  spendAp(unit, 1);
  unit.hunkered = true;
  next.events.push({ type: 'HUNKER', unitId });
  return next;
}

function reload(state, unitId) {
  const next = copyState(state);
  const unit = unitById(next, unitId);
  spendAp(unit, 1);
  const needed = Math.max(0, unit.magazineSize - unit.ammo);
  const loaded = Math.min(needed, unit.reserveAmmo);
  unit.ammo += loaded;
  unit.reserveAmmo -= loaded;
  next.events.push({ type: 'RELOAD', unitId, loaded, ammo: unit.ammo, reserveAmmo: unit.reserveAmmo });
  return next;
}

function fireWeapon(state, attackerId, targetId, roll, critRoll = 100) {
  const preview = shotPreview(state, attackerId, targetId);
  if (!preview.legal) throw new Error(preview.reason);
  const next = copyState(state);
  const attacker = unitById(next, attackerId);
  const target = unitById(next, targetId);
  spendAp(attacker, 1);
  attacker.ammo -= 1;
  attacker.concealed = false;
  const hit = Number(roll) < preview.hitChance;
  const critical = hit && Number(critRoll) < preview.critChance;
  const damage = hit ? (critical ? preview.critDamage : preview.damage) : 0;
  if (hit) {
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp <= 0) {
      if (target.canBeDowned && !target.downed) target.downed = true;
      else target.dead = true;
    }
  }
  next.events.push({ type: 'FIRE', attackerId, targetId, hit, critical, damage, hitChance: preview.hitChance });
  return { state: next, result: { ...preview, hit, critical, damage } };
}

function stabilize(state, actorId, targetId) {
  const next = copyState(state);
  const actor = unitById(next, actorId);
  const target = unitById(next, targetId);
  if (!target.downed || target.dead) throw new Error('Target is not stabilizable');
  if (gridDistance(actor, target) > 1) throw new Error('Target is not adjacent');
  spendAp(actor, 1);
  target.statuses = [...new Set([...target.statuses, 'STABILIZED'])];
  next.events.push({ type: 'STABILIZE', actorId, targetId });
  return next;
}

function setObjectiveState(state, objectiveId, objectiveState) {
  const next = copyState(state);
  const objective = next.objectives.find((item) => item.id === objectiveId);
  if (!objective) throw new Error(`Unknown objective ${objectiveId}`);
  objective.state = objectiveState;
  next.events.push({ type: 'OBJECTIVE_STATE', objectiveId, state: objectiveState });
  return next;
}

function technicalAction(state, actorId, nodeId, actionId) {
  const next = copyState(state);
  const actor = unitById(next, actorId);
  const node = nodeById(next, nodeId);
  if (actor.dead || actor.downed) throw new Error('Actor cannot perform technical work');
  const truth = next.technicalTruth.nodes && next.technicalTruth.nodes[nodeId];
  if (!truth) throw new Error(`Missing technical truth for ${nodeId}`);
  const stateActions = truth.actions && truth.actions[node.state];
  const transition = stateActions && stateActions[actionId];
  if (!transition) {
    next.events.push({ type: 'TECHNICAL_ACTION_REJECTED', actorId, nodeId, actionId, nodeState: node.state });
    return { state: next, accepted: false, nodeState: node.state };
  }
  const apCost = Number(transition.apCost ?? 1);
  spendAp(actor, apCost);
  node.state = transition.next;
  next.events.push({ type: 'TECHNICAL_ACTION_ACCEPTED', actorId, nodeId, actionId, nodeState: node.state, apCost });
  if (node.state === 'VERIFIED' && truth.effectOnVerified) {
    Object.assign(next.battlefield, clone(truth.effectOnVerified));
    next.events.push({ type: 'LAB_NODE_VERIFIED', nodeId, effect: clone(truth.effectOnVerified) });
  }
  return { state: next, accepted: true, nodeState: node.state };
}

function extractUnit(state, unitId) {
  const next = copyState(state);
  const unit = unitById(next, unitId);
  next.mission.extractedUnitIds = [...new Set([...next.mission.extractedUnitIds, unitId])];
  unit.statuses = [...new Set([...unit.statuses, 'EXTRACTED'])];
  next.events.push({ type: 'EXTRACT', unitId });
  return next;
}

function missionComplete(state) {
  const objectivesDone = state.objectives.filter((item) => item.required).every((item) => ['COMPLETE', 'VERIFIED', 'SECURED'].includes(item.state));
  const nodesDone = state.nodes.filter((node) => node.required).every((node) => ['VERIFIED', 'SEALED_STABILIZED'].includes(node.state));
  if (!objectivesDone || !nodesDone) return false;
  if (!state.mission.extractionRequired) return true;
  const survivingPlayers = state.units.filter((unit) => unit.faction === 'PLAYER' && !unit.dead);
  return survivingPlayers.every((unit) => state.mission.extractedUnitIds.includes(unit.id));
}

function applyDirectorPressure(state, event) {
  const next = copyState(state);
  const before = next.technicalTruthHash;
  if (event.type === 'ADD_CLOCK_PRESSURE') {
    next.mission.clock = Math.max(0, next.mission.clock - clamp(event.amount ?? 1, 0, 3));
  } else if (event.type === 'QUEUE_REINFORCEMENT') {
    next.mission.reinforcementsQueued += clamp(event.amount ?? 1, 0, 8);
  } else if (event.type === 'SET_ENVIRONMENTAL_PRESSURE') {
    next.battlefield.environmentalPressure = String(event.value || 'STANDARD');
  } else if (event.type === 'SET_QUIET_WINDOW') {
    next.mission.quietWindow = clamp(event.amount ?? 0, 0, 5);
  } else {
    throw new Error('Mission Director event is outside the approved pressure vocabulary');
  }
  if (stableHash(next.technicalTruth) !== before) throw new Error('Mission Director may not mutate technical truth');
  next.events.push({ type: 'DIRECTOR_PRESSURE', event: clone(event) });
  return next;
}

function threatView(state) {
  return {
    round: state.round,
    phase: state.phase,
    units: state.units.map((unit) => ({
      id: unit.id, faction: unit.faction, x: unit.x, y: unit.y, z: unit.z,
      hp: unit.hp, downed: unit.downed, dead: unit.dead, concealed: unit.concealed,
      statuses: [...unit.statuses]
    })),
    objectives: state.objectives.map((item) => ({ ...item })),
    mission: clone(state.mission),
    battlefield: clone(state.battlefield)
  };
}

export {
  createState,
  beginPlayerPhase,
  beginThreatPhase,
  resolveClockStatePhase,
  gridDistance,
  hasLineOfSight,
  coverForAttack,
  shotPreview,
  moveUnit,
  enterOverwatch,
  hunkerDown,
  reload,
  fireWeapon,
  stabilize,
  setObjectiveState,
  technicalAction,
  extractUnit,
  missionComplete,
  applyDirectorPressure,
  threatView,
  stableHash
};
