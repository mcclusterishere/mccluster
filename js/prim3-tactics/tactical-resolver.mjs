const CARDINALS = ['N', 'E', 'S', 'W'];

// Rule constants. Canon (TACTICAL-CORE-MECHANICS.yaml, XCOM2-MECHANIC-ADAPTATION-AUTHORITY.md) names
// the mechanics but gives no numbers for these; they are conservative values, documented in
// game/TACTICAL-TRANSIT-RULES.md, and tunable without changing canon.
const EYE_HEIGHT = 1.6;               // metres above the surface a unit stands on
const SLAB_THICKNESS = 0.3;           // metres: a roof surface blocks sight between height - 0.3 and height
const REACTION_AIM_PENALTY = 15;      // overwatch reaction shots (canon silent; conventional value)
const DEFAULT_SEED = 1;

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
    statuses: Array.isArray(unit.statuses) ? [...unit.statuses] : [],
    ...(unit.weaponRange != null ? { weaponRange: Number(unit.weaponRange) } : {}),
    ...(Array.isArray(unit.patrol) ? { patrol: unit.patrol.map((c) => ({ x: Number(c.x), y: Number(c.y), z: Number(c.z || 0) })) } : {})
  };
}

function normalizeSurface(item) {
  return { ...(item.id != null ? { id: String(item.id) } : {}), z: Number(item.z || 0), x: Number(item.x), y: Number(item.y),
    w: Number(item.w ?? 1), d: Number(item.d ?? 1), height: Number(item.height ?? 0) };
}

function normalizeLink(item, index) {
  const cost = Number(item.cost ?? 1);
  if (!Number.isInteger(cost) || cost < 1) throw new Error(`Link ${item.id ?? index} cost must be a whole number of at least 1`);
  const end = (c) => ({ x: Number(c.x), y: Number(c.y), z: Number(c.z || 0) });
  return { id: String(item.id ?? `link-${index}`), from: end(item.from), to: end(item.to), cost };
}

function normalizeNode(node) {
  const out = { id: String(node.id), state: node.state || 'UNSEEN', required: node.required !== false };
  if (node.at) {
    out.at = { x: Number(node.at.x), y: Number(node.at.y), z: Number(node.at.z || 0), range: Number(node.at.range ?? 1) };
    if (Array.isArray(node.at.roles)) out.at.roles = node.at.roles.map(String);
  }
  return out;
}

function copyState(state) {
  return {
    ...state,
    units: state.units.map((unit) => ({ ...unit, statuses: [...unit.statuses] })),
    cover: state.cover.map((item) => ({ ...item, sides: [...item.sides] })),
    blockers: state.blockers.map((item) => ({ ...item })),
    surfaces: Array.isArray(state.surfaces) ? state.surfaces.map((item) => ({ ...item })) : null,
    links: Array.isArray(state.links) ? state.links.map((item) => ({ ...item, from: { ...item.from }, to: { ...item.to } })) : [],
    rng: state.rng ? { seed: state.rng.seed, n: state.rng.n } : { seed: DEFAULT_SEED, n: 0 },
    nodes: state.nodes.map((node) => ({ ...node, ...(node.at ? { at: { ...node.at, ...(node.at.roles ? { roles: [...node.at.roles] } : {}) } } : {}) })),
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
    blockers: (config.blockers || []).map((item) => ({ x: Number(item.x), y: Number(item.y), z: Number(item.z || 0), ...(item.h != null ? { h: Number(item.h) } : {}) })),
    // Walkable upper-floor rects. null = not configured: every in-bounds cell of every floor is walkable (original rule).
    surfaces: Array.isArray(config.surfaces) ? config.surfaces.map(normalizeSurface) : null,
    links: (config.links || []).map(normalizeLink),
    rng: { seed: Number(config.seed ?? DEFAULT_SEED), n: 0 },
    nodes: (config.nodes || []).map(normalizeNode),
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

// ---------- geometry ----------

function surfacesConfigured(state) {
  return Boolean(state && Array.isArray(state.surfaces));
}

// Manhattan on one floor. Across floors: Manhattan x/y distance when walkable surfaces are configured
// (so roof-to-yard shots have a range), otherwise Infinity (the original rule).
function gridDistance(a, b, state = null) {
  if (Number(a.z || 0) !== Number(b.z || 0) && !surfacesConfigured(state)) return Infinity;
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

// Per-state geometry index (blockers, surfaces, links). Built once per blockers/surfaces/links arrays
// and cached by identity: resolver states are immutable values (every action returns a copy).
const geometryCache = new WeakMap();

function geometry(state) {
  const cached = geometryCache.get(state.blockers);
  if (cached && cached.surfaces === state.surfaces && cached.links === state.links && cached.count === state.blockers.length
    && cached.width === state.width && cached.height === state.height && cached.floors === state.floors) return cached.geo;
  const W = state.width, H = state.height, F = state.floors;
  const cellKey = (x, y, z) => (z * H + y) * W + x;
  const blocked = new Set();
  const walls = new Map(); // x:y:z -> blocker (any coordinates, as the original rule keyed them)
  for (const b of state.blockers) {
    const k = `${b.x}:${b.y}:${b.z}`, seen = walls.get(k);
    if (!seen || (seen.h != null && (b.h == null || b.h > seen.h))) walls.set(k, b); // keep the tallest
    if (inBounds(state, b.x, b.y, b.z)) blocked.add(cellKey(b.x, b.y, b.z));
  }
  const configured = surfacesConfigured(state);
  let surfaceHeight = null; // Float64Array, NaN = no surface
  const columnSurfaces = new Map(); // x:y column -> [{z,height}] (z >= 1) for roof-slab sight checks
  if (configured) {
    surfaceHeight = new Float64Array(W * H * Math.max(1, F)).fill(NaN);
    for (const s of state.surfaces) {
      if (s.z < 0 || s.z >= F) continue;
      for (let y = Math.max(0, s.y); y < Math.min(H, s.y + s.d); y += 1) {
        for (let x = Math.max(0, s.x); x < Math.min(W, s.x + s.w); x += 1) {
          const k = cellKey(x, y, s.z);
          surfaceHeight[k] = Number.isNaN(surfaceHeight[k]) ? s.height : Math.max(surfaceHeight[k], s.height);
          if (s.z >= 1) {
            const ck = y * W + x;
            if (!columnSurfaces.has(ck)) columnSurfaces.set(ck, []);
            columnSurfaces.get(ck).push({ z: s.z, height: s.height });
          }
        }
      }
    }
  }
  const linksAt = new Map();
  for (const link of state.links || []) {
    if (!inBounds(state, link.from.x, link.from.y, link.from.z) || !inBounds(state, link.to.x, link.to.y, link.to.z)) continue;
    const a = cellKey(link.from.x, link.from.y, link.from.z), b = cellKey(link.to.x, link.to.y, link.to.z);
    if (!linksAt.has(a)) linksAt.set(a, []);
    if (!linksAt.has(b)) linksAt.set(b, []);
    linksAt.get(a).push({ to: b, cost: link.cost, id: link.id });
    linksAt.get(b).push({ to: a, cost: link.cost, id: link.id });
  }
  // Sight intervals per x:y column, in metres. Only used when surfaces are configured.
  let columns = null;
  if (configured) {
    // the lowest surface on floor z+1: the storey top a full-height wall on floor z reaches
    const storeyTop = [];
    for (let z = 0; z < F; z += 1) {
      const above = state.surfaces.filter((s) => s.z === z + 1).map((s) => s.height);
      storeyTop.push(above.length ? Math.min(...above) : Infinity);
    }
    columns = new Map();
    for (const b of state.blockers) {
      if (!inBounds(state, b.x, b.y, b.z)) continue;
      let bottom, top;
      if (b.z === 0) {
        bottom = 0;
        if (b.h != null) top = b.h;
        else {
          const over = (columnSurfaces.get(b.y * W + b.x) || []).filter((s) => s.z > b.z).map((s) => s.height);
          top = over.length ? Math.min(...over) : storeyTop[0];
        }
      } else {
        const base = surfaceHeight[cellKey(b.x, b.y, b.z)];
        if (Number.isNaN(base)) continue; // no surface under it: a movement block only
        bottom = base;
        top = b.h != null ? base + b.h : Infinity;
      }
      const ck = b.y * W + b.x;
      if (!columns.has(ck)) columns.set(ck, []);
      columns.get(ck).push([bottom, top]);
    }
  }
  const walkable = (x, y, z) => {
    if (!inBounds(state, x, y, z)) return false;
    const k = cellKey(x, y, z);
    if (blocked.has(k)) return false;
    if (configured && z > 0 && Number.isNaN(surfaceHeight[k])) return false;
    return true;
  };
  const standHeight = (x, y, z) => {
    if (!configured || !inBounds(state, x, y, z)) return 0;
    const h = surfaceHeight[cellKey(x, y, z)];
    return Number.isNaN(h) ? 0 : h;
  };
  const geo = { W, H, F, cellKey, blocked, walls, configured, surfaceHeight, columnSurfaces, columns, linksAt, walkable, standHeight };
  geometryCache.set(state.blockers, { surfaces: state.surfaces, links: state.links, count: state.blockers.length, width: W, height: H, floors: F, geo });
  return geo;
}

function hasLineOfSight(state, a, b) {
  const az = Number(a.z || 0), bz = Number(b.z || 0);
  const geo = geometry(state);
  if (!geo.configured) {
    // original rule: one floor only; any wall on the line blocks. A blocker with h (metres) at or below
    // eye height is low enough to see over.
    if (az !== bz) return false;
    return !lineCells(a, b).some((cell) => {
      const wall = geo.walls.get(`${cell.x}:${cell.y}:${az}`);
      return wall && !(wall.h != null && wall.h <= EYE_HEIGHT);
    });
  }
  const ha = geo.standHeight(a.x, a.y, az) + EYE_HEIGHT;
  const hb = geo.standHeight(b.x, b.y, bz) + EYE_HEIGHT;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const half = len2 ? 0.5 / Math.sqrt(len2) : 0; // half a tile, as a fraction of the line
  for (const cell of lineCells(a, b)) {
    const t = len2 ? ((cell.x - a.x) * dx + (cell.y - a.y) * dy) / len2 : 0;
    const h1 = ha + (hb - ha) * clamp(t - half, 0, 1);
    const h2 = ha + (hb - ha) * clamp(t + half, 0, 1);
    const lo = Math.min(h1, h2), hi = Math.max(h1, h2);
    const ck = cell.y * geo.W + cell.x;
    for (const [bottom, top] of geo.columns.get(ck) || []) if (lo < top && hi > bottom) return false;
    for (const s of geo.columnSurfaces.get(ck) || []) if (lo < s.height && hi > s.height - SLAB_THICKNESS) return false;
  }
  return true;
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

// options.reaction: an overwatch reaction shot (REACTION_AIM_PENALTY applies before the clamp).
function shotPreview(state, attackerId, targetId, options = {}) {
  const attacker = unitById(state, attackerId);
  const target = unitById(state, targetId);
  if (attacker.dead || attacker.downed || target.dead) return { legal: false, reason: 'INVALID_UNIT_STATE' };
  if (attacker.faction === target.faction) return { legal: false, reason: 'FRIENDLY_TARGET' };
  if (!hasLineOfSight(state, attacker, target)) return { legal: false, reason: 'NO_LINE_OF_SIGHT' };
  if (attacker.ammo <= 0) return { legal: false, reason: 'EMPTY_MAGAZINE' };
  const distance = gridDistance(attacker, target, state);
  if (attacker.weaponRange != null && distance > attacker.weaponRange) return { legal: false, reason: 'OUT_OF_RANGE' };
  const cover = coverForAttack(state, target, attacker);
  const rangePenalty = Math.max(0, distance - 6) * 4;
  const elevationBonus = attacker.z > target.z ? 10 : 0;
  const hunkerPenalty = target.hunkered ? 20 : 0;
  const flankBonus = cover.flanked ? 15 : 0;
  const reactionPenalty = options.reaction ? REACTION_AIM_PENALTY : 0;
  const chance = clamp(attacker.aim - cover.bonus - rangePenalty - hunkerPenalty + elevationBonus + flankBonus - reactionPenalty, 5, 95);
  const critChance = clamp(attacker.crit + (cover.flanked ? 20 : 0), 0, 75);
  return {
    legal: true,
    hitChance: Math.round(chance),
    critChance: Math.round(critChance),
    damage: attacker.weaponDamage,
    critDamage: attacker.weaponDamage + attacker.critBonus,
    cover: cover.type,
    flanked: cover.flanked,
    distance,
    ...(options.reaction ? { reactionPenalty } : {})
  };
}

function spendAp(unit, amount) {
  if (unit.ap < amount) throw new Error('Not enough action points');
  unit.ap -= amount;
}

function detects(state, watcher, target) {
  return gridDistance(watcher, target, state) <= watcher.detectionRadius && hasLineOfSight(state, watcher, target);
}

function detectAtPosition(state, mover) {
  return state.units.some((enemy) => {
    if (enemy.faction === mover.faction || enemy.dead || enemy.downed) return false;
    return detects(state, enemy, mover);
  });
}

function isBlockedCell(state, x, y, z) {
  return state.blockers.some((item) => item.x === x && item.y === y && item.z === z);
}

// ---------- dice ----------

// Deterministic 0..99 from (seed, n): a small integer hash, no Math.random anywhere.
function rollAt(seed, n) {
  let h = (Math.imul(Number(seed) >>> 0, 0x9e3779b1) ^ Math.imul((n + 1) >>> 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) % 100;
}

// Draws from state.rng and advances it (mutates the state passed: call on a copy).
function drawFromState(state) {
  if (!state.rng) state.rng = { seed: DEFAULT_SEED, n: 0 };
  const value = rollAt(state.rng.seed, state.rng.n);
  state.rng.n += 1;
  return value;
}

// rolls: array (consumed in order, then the state PRNG), a function returning 0..99, or nothing (state PRNG).
function makeRoller(state, rolls) {
  if (typeof rolls === 'function') return () => Number(rolls());
  if (Array.isArray(rolls)) { let i = 0; return () => (i < rolls.length ? Number(rolls[i++]) : drawFromState(state)); }
  return () => drawFromState(state);
}

// Pure: returns the next state with its PRNG advanced, plus `count` rolls in 0..99.
function drawRolls(state, count = 1) {
  const next = copyState(state);
  const rolls = [];
  for (let i = 0; i < count; i += 1) rolls.push(drawFromState(next));
  return { state: next, rolls };
}

// ---------- reach and paths ----------

const ORDER_RESOLVER = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ORDER_NESW = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Weighted reach (Dijkstra over integer costs with FIFO buckets, so unit-cost results equal the original
// breadth-first search exactly). An orthogonal step on one floor costs 1; a declared link costs link.cost.
// Walls, unwalkable cells and every living unit in `occupants` (except the mover) block a cell.
function reachFrom(state, start, maxCost, { order = ORDER_RESOLVER, occupants = state.units, exceptId = null, stopAt = null } = {}) {
  const geo = geometry(state);
  const { W, H, cellKey, linksAt } = geo;
  const taken = new Set();
  for (const u of occupants) if (!u.dead && u.id !== exceptId && inBounds(state, u.x, u.y, u.z)) taken.add(cellKey(u.x, u.y, u.z));
  const startKey = cellKey(start.x, start.y, start.z);
  const cost = new Map([[startKey, 0]]);
  const prev = new Map();
  const buckets = [[startKey]];
  const passable = (x, y, z) => geo.walkable(x, y, z) && !taken.has(cellKey(x, y, z));
  for (let d = 0; d < buckets.length; d += 1) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      const k = bucket[i];
      if (cost.get(k) !== d) continue;
      if (stopAt !== null && k === stopAt) return { cost, prev, geo, startKey };
      if (d >= maxCost) continue;
      const x = k % W, y = Math.floor(k / W) % H, z = Math.floor(k / (W * H));
      const relax = (nk, nd, linkId) => {
        if (nd > maxCost) return;
        const known = cost.get(nk);
        if (known !== undefined && known <= nd) return;
        cost.set(nk, nd);
        prev.set(nk, { from: k, linkId });
        (buckets[nd] || (buckets[nd] = [])).push(nk);
      };
      for (const [dx, dy] of order) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny, z)) continue;
        relax(cellKey(nx, ny, z), d + 1, null);
      }
      for (const link of linksAt.get(k) || []) {
        const tx = link.to % W, ty = Math.floor(link.to / W) % H, tz = Math.floor(link.to / (W * H));
        if (!passable(tx, ty, tz)) continue;
        relax(link.to, d + link.cost, link.id);
      }
    }
  }
  return { cost, prev, geo, startKey };
}

function cellOfKey(geo, k) {
  return { x: k % geo.W, y: Math.floor(k / geo.W) % geo.H, z: Math.floor(k / (geo.W * geo.H)) };
}

function pathFromReach(reach, k) {
  if (!reach.cost.has(k)) return null;
  const path = [];
  for (let at = k; at !== reach.startKey; at = reach.prev.get(at).from) path.unshift(cellOfKey(reach.geo, at));
  return path;
}

// Public reach: every tile a unit could reach within maxCost movement, its cost and its path
// (steps include link steps). options.occupants limits which units block (a fog-of-war caller passes
// only the units its side knows about); options.order sets the deterministic neighbour order.
function computeReach(state, unitId, maxCost = Infinity, options = {}) {
  const unit = unitById(state, unitId);
  const order = options.order === 'NESW' ? ORDER_NESW : Array.isArray(options.order) ? options.order : ORDER_RESOLVER;
  const reach = reachFrom(state, unit, maxCost, { order, occupants: options.occupants || state.units, exceptId: unit.id });
  const { cellKey } = reach.geo;
  return {
    costAt: (x, y, z = unit.z) => (inBounds(state, x, y, z) ? reach.cost.get(cellKey(x, y, z)) : undefined),
    pathTo: (x, y, z = unit.z) => (inBounds(state, x, y, z) ? pathFromReach(reach, cellKey(x, y, z)) : null),
    cells: [...reach.cost.entries()].filter(([k]) => k !== reach.startKey).map(([k, c]) => ({ ...cellOfKey(reach.geo, k), cost: c }))
  };
}

// Shortest route around walls and every unit, within maxSteps of movement cost. Orthogonal steps cost 1,
// declared links (stairs, ladders) cost link.cost, so the route may end on another floor.
// Authoritative (sees the whole state); a client should plan with knownPaths and pass its route
// to moveUnit, so a refusal never reveals a unit the player cannot see.
function findPath(state, unitId, destination, maxSteps = Infinity) {
  const unit = unitById(state, unitId);
  const dest = { x: Number(destination.x), y: Number(destination.y), z: Number(destination.z || 0) };
  if (!inBounds(state, dest.x, dest.y, dest.z)) return null;
  if (dest.z !== unit.z && !(state.links || []).length) return null;
  const geo = geometry(state);
  const target = geo.cellKey(dest.x, dest.y, dest.z);
  const reach = reachFrom(state, unit, maxSteps, { exceptId: unit.id, stopAt: target });
  if (target === reach.startKey) return null;
  return pathFromReach(reach, target);
}

function linkBetween(state, a, b) {
  return (state.links || []).find((link) =>
    (link.from.x === a.x && link.from.y === a.y && link.from.z === a.z && link.to.x === b.x && link.to.y === b.y && link.to.z === b.z)
    || (link.to.x === a.x && link.to.y === a.y && link.to.z === a.z && link.from.x === b.x && link.from.y === b.y && link.from.z === b.z)) || null;
}

// ---------- shots ----------

function applyShot(state, attacker, target, preview, roll, critRoll) {
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
  return { hit, critical, damage };
}

// Every opposing unit on overwatch with a legal shot at the mover's current cell fires once: overwatch
// is consumed, no AP is spent, ammo is used, the reaction aim penalty applies. A concealed mover is a
// target only once the watcher detects it (which breaks its concealment). Returns true if the mover
// is downed or dead.
function resolveReactions(state, mover, roll) {
  const watchers = state.units.filter((w) => w.overwatch && !w.dead && !w.downed && w.faction !== mover.faction);
  for (const watcher of watchers) {
    if (!watcher.overwatch) continue;
    if (mover.concealed) {
      if (!detects(state, watcher, mover)) continue;
      mover.concealed = false;
      state.events.push({ type: 'CONCEALMENT_BROKEN', unitId: mover.id, reason: 'DETECTION' });
    }
    const preview = shotPreview(state, watcher.id, mover.id, { reaction: true });
    if (!preview.legal) continue;
    const hitRoll = roll();
    const critRoll = roll();
    watcher.overwatch = false;
    const result = applyShot(state, watcher, mover, preview, hitRoll, critRoll);
    state.events.push({ type: 'OVERWATCH_SHOT', watcherId: watcher.id, targetId: mover.id, at: { x: mover.x, y: mover.y, z: mover.z },
      hit: result.hit, critical: result.critical, damage: result.damage, hitChance: preview.hitChance });
    if (mover.dead || mover.downed) return true;
  }
  return false;
}

// options.path: the route the player chose (from the start or its first step, ending at the destination).
// It is checked step by step: each step is an orthogonal neighbour on the same floor (cost 1) or a
// declared link (cost link.cost); the total cost must fit the move range. If a step meets a unit the
// mover's side could not know about, the move is interrupted on the last free tile: the AP is spent,
// and nothing is revealed before contact.
// options.rolls: dice for reaction fire (array consumed in order, or a function returning 0..99);
// without it the state's seeded PRNG is used.
function moveUnit(state, unitId, destination, mode = 'MOVE', options = {}) {
  const next = copyState(state);
  const unit = unitById(next, unitId);
  if (next.phase !== (unit.faction === 'PLAYER' ? 'PLAYER' : 'THREAT')) throw new Error('Unit cannot act outside its phase');
  if (unit.dead || unit.downed) throw new Error('Unit cannot move');
  const dest = { x: Number(destination.x), y: Number(destination.y), z: Number(destination.z || 0) };
  if (![dest.x, dest.y, dest.z].every(Number.isInteger)) throw new Error('Destination must be a whole tile');
  if (!inBounds(next, dest.x, dest.y, dest.z)) throw new Error('Destination out of bounds');
  if (dest.z !== unit.z && !next.links.length) throw new Error('Destination is on another floor');
  if (isBlockedCell(next, dest.x, dest.y, dest.z)) throw new Error('Destination is a wall');
  if (dest.x === unit.x && dest.y === unit.y && dest.z === unit.z) throw new Error('Unit is already there');
  const geo = geometry(next);
  if (!geo.walkable(dest.x, dest.y, dest.z)) throw new Error('Destination is not a walkable surface');
  const isDash = mode === 'DASH';
  const maxDistance = unit.moveRange * (isDash ? 2 : 1);
  const cost = isDash ? 2 : 1;
  if (unit.ap < cost) throw new Error('Not enough action points');
  let path;
  if (options.path) {
    path = options.path.map((c) => ({ x: Number(c.x), y: Number(c.y), z: Number(c.z ?? unit.z) }));
    if (path.length && path[0].x === unit.x && path[0].y === unit.y && path[0].z === unit.z) path = path.slice(1);
    if (!path.length || path.length > maxDistance) throw new Error('Route outside movement range');
    const end = path[path.length - 1];
    if (end.x !== dest.x || end.y !== dest.y || end.z !== dest.z) throw new Error('Route does not end at the destination');
    let at = unit;
    let total = 0;
    for (const step of path) {
      if (![step.x, step.y, step.z].every(Number.isInteger)) throw new Error('Route leaves the floor or the grid');
      if (step.z === at.z && Math.abs(step.x - at.x) + Math.abs(step.y - at.y) === 1) total += 1;
      else {
        const link = linkBetween(next, at, step);
        if (link) total += link.cost;
        else if (step.z !== at.z) throw new Error('Route leaves the floor or the grid');
        else throw new Error('Route is not a connected path');
      }
      if (!inBounds(next, step.x, step.y, step.z) || isBlockedCell(next, step.x, step.y, step.z)) throw new Error('Route crosses a wall');
      if (!geo.walkable(step.x, step.y, step.z)) throw new Error('Route leaves the walkable surface');
      at = step;
    }
    if (total > maxDistance) throw new Error('Route outside movement range');
  } else {
    if (occupied(next, dest.x, dest.y, dest.z, unit.id)) throw new Error('Destination occupied');
    path = findPath(next, unit.id, dest, maxDistance);
    if (!path) throw new Error('No traversable path within movement range');
  }
  spendAp(unit, cost);
  const roll = makeRoller(next, options.rolls);
  const walked = [];
  let interruptedBy = null;
  let downedOnRoute = false;
  for (const step of path) {
    const blocker = next.units.find((other) => !other.dead && other.id !== unit.id && other.x === step.x && other.y === step.y && other.z === step.z);
    if (blocker) { interruptedBy = { x: step.x, y: step.y, z: step.z }; break; }
    walked.push(step);
    unit.x = step.x; unit.y = step.y; unit.z = step.z;
    if (resolveReactions(next, unit, roll)) { downedOnRoute = true; break; }
  }
  const stop = walked.length ? walked[walked.length - 1] : { x: unit.x, y: unit.y, z: unit.z };
  unit.x = stop.x; unit.y = stop.y; unit.z = stop.z;
  if (unit.concealed && detectAtPosition(next, unit)) {
    unit.concealed = false;
    next.events.push({ type: 'CONCEALMENT_BROKEN', unitId: unit.id, reason: 'DETECTION' });
  }
  if (interruptedBy) next.events.push({ type: 'MOVE_INTERRUPTED', unitId: unit.id, at: { ...stop }, blockedAt: interruptedBy, path: walked, apRemaining: unit.ap });
  else if (downedOnRoute) next.events.push({ type: isDash ? 'DASH' : 'MOVE', unitId: unit.id, destination: { ...stop }, path: walked, apRemaining: unit.ap, interrupted: 'OVERWATCH', requestedDestination: dest });
  else next.events.push({ type: isDash ? 'DASH' : 'MOVE', unitId: unit.id, destination: dest, path, apRemaining: unit.ap });
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
  const { hit, critical, damage } = applyShot(next, attacker, target, preview, roll, critRoll);
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
  if (node.at) {
    // positioned interaction: on the node's floor, within range (Manhattan), and an allowed role
    const within = actor.z === node.at.z && Math.abs(actor.x - node.at.x) + Math.abs(actor.y - node.at.y) <= node.at.range;
    if (!within) throw new Error(`Actor is not in position for ${nodeId}`);
    if (node.at.roles && !node.at.roles.includes(String(actor.role))) throw new Error(`Role ${actor.role} cannot operate ${nodeId}`);
  }
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
    const { removeBlockers, ...battlefieldEffect } = clone(truth.effectOnVerified);
    Object.assign(next.battlefield, battlefieldEffect);
    next.events.push({ type: 'LAB_NODE_VERIFIED', nodeId, effect: clone(truth.effectOnVerified) });
    if (Array.isArray(removeBlockers) && removeBlockers.length) {
      const gone = new Set(removeBlockers.map((c) => `${Number(c.x)}:${Number(c.y)}:${Number(c.z || 0)}`));
      const removed = next.blockers.filter((b) => gone.has(`${b.x}:${b.y}:${b.z}`)).map((b) => ({ x: b.x, y: b.y, z: b.z }));
      next.blockers = next.blockers.filter((b) => !gone.has(`${b.x}:${b.y}:${b.z}`));
      next.events.push({ type: 'BLOCKERS_REMOVED', nodeId, cells: removed });
    }
  }
  return { state: next, accepted: true, nodeState: node.state };
}

function extractUnit(state, unitId) {
  const next = copyState(state);
  const unit = unitById(next, unitId);
  const zone = next.battlefield && next.battlefield.extractionZone;
  if (zone) {
    if (unit.dead || unit.downed) throw new Error('Unit cannot extract');
    const z = Number(zone.z || 0);
    const inside = unit.z === z && Math.abs(unit.x - Number(zone.x)) + Math.abs(unit.y - Number(zone.y)) <= Number(zone.r ?? 0);
    if (!inside) throw new Error('Unit is not in the extraction zone');
  }
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
  findPath,
  computeReach,
  drawRolls,
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
  stableHash,
  EYE_HEIGHT,
  SLAB_THICKNESS,
  REACTION_AIM_PENALTY
};
