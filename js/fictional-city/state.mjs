export const STATE_KEY = 'here.universe.mccluster-fictional-city.state';
export const STATE_VERSION = 2;
/* v1 (the first district, 2026-11-03) → v2 (the expanded city): every v1 field keeps its meaning and value.
   The original block kept its coordinates, so a v1 position is still a valid v2 position. v2 adds
   `discoveries` (landmark/neighbourhood IDs reached on foot) and `payments` (credits spent on authored
   interactions such as a bribe), and widens the saved-position bounds to the larger city. */
export const MIGRATIONS = Object.freeze({ 1: 'v1→v2: keep credits, inventory, receipts, met, visited, story chapter, position; add discoveries/payments' });
const CITY_BOUNDS = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
const V1_BOUNDS = { minX: -100, maxX: 100, minZ: -70, maxZ: 120 };
const integer = (value, fallback, max = 1000000) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : fallback;
const unique = (values, allowed) => [...new Set(Array.isArray(values) ? values.filter(id => allowed.has(id)) : [])];

export function initialState(manifest) {
  return {
    version: STATE_VERSION, revision: manifest.revision,
    credits: manifest.district.currency.startingBalance,
    position: { x: manifest.district.spawn[0], z: manifest.district.spawn[1], interior: null },
    inventory: {}, met: [], visited: [], receipts: [], story: { chapter: null },
    discoveries: [], payments: []
  };
}
// IDs a save may reference: lore buildings plus geography parcels (enterable generic buildings) and landmarks.
function knownPlaces(manifest, places) {
  const buildings = new Set([...manifest.businesses, manifest.garage].map(b => b.id));
  for (const p of places?.parcels || []) buildings.add(p.id);
  const discoverable = new Set([...(places?.landmarks || []).map(l => l.id), ...(places?.neighborhoods || []).map(n => n.id)]);
  return { buildings, discoverable };
}
export function interactionsOf(manifest) {
  const out = new Map();
  for (const entity of [...(manifest.businesses || []), ...(manifest.npcs || []), ...(manifest.garageCrew || [])]) {
    (entity.interactions || []).forEach((it, i) => {
      if (!it || typeof it.type !== 'string') return;
      const id = typeof it.id === 'string' ? it.id : `${entity.id}:${it.type}:${i}`;
      out.set(id, { ...it, id, ownerId: entity.id });
    });
  }
  return out;
}

export function sanitizeState(raw, manifest, places = null) {
  const state = initialState(manifest);
  if (!raw || !(raw.version === 1 || raw.version === STATE_VERSION)) return state;
  const { buildings, discoverable } = knownPlaces(manifest, places);
  const people = new Set([...manifest.npcs, ...manifest.garageCrew].map(n => n.id));
  const items = new Map(manifest.items.map(i => [i.id, i]));
  state.credits = integer(raw.credits, state.credits);
  state.met = unique(raw.met, people);
  state.visited = unique(raw.visited, buildings);
  if (raw.inventory && typeof raw.inventory === 'object') {
    for (const [id, count] of Object.entries(raw.inventory)) {
      if (items.has(id) && integer(count, 0, 99)) state.inventory[id] = count;
    }
  }
  // Spatial collision validation occurs again inside the scene. Persist only finite bounded coordinates.
  const p = raw.position;
  const bounds = raw.version === 1 ? V1_BOUNDS : CITY_BOUNDS;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ) {
    state.position = { x: p.x, z: p.z, interior: buildings.has(p.interior) ? p.interior : null };
  }
  state.receipts = (Array.isArray(raw.receipts) ? raw.receipts : []).filter(r =>
    r && items.has(r.itemId) && r.price === items.get(r.itemId).price && Number.isSafeInteger(r.at) && r.at >= 0
  ).slice(-50).map(r => ({ itemId: r.itemId, price: r.price, at: r.at }));
  if (typeof raw.story?.chapter === 'string' && /^[a-z0-9-]{1,60}$/.test(raw.story.chapter)) state.story.chapter = raw.story.chapter;
  if (raw.version === STATE_VERSION) {
    state.discoveries = unique(raw.discoveries, discoverable);
    const interactions = interactionsOf(manifest);
    state.payments = (Array.isArray(raw.payments) ? raw.payments : []).filter(r =>
      r && interactions.has(r.interactionId) && r.cost === interactions.get(r.interactionId).cost && Number.isSafeInteger(r.at) && r.at >= 0
    ).slice(-50).map(r => ({ interactionId: r.interactionId, cost: r.cost, at: r.at }));
  }
  return state;
}

export function loadState(storage, manifest, places = null) {
  try { return sanitizeState(JSON.parse(storage.getItem(STATE_KEY) || 'null'), manifest, places); }
  catch { return initialState(manifest); }
}
export function saveState(storage, state) {
  try { storage.setItem(STATE_KEY, JSON.stringify(state)); return true; }
  catch { return false; }
}
// The one credit check every spend uses (shop counters and authored interactions).
function affordable(state, cost) {
  return Number.isSafeInteger(cost) && cost >= 0 && Number.isSafeInteger(state.credits) && state.credits >= cost;
}
export function purchase(state, itemId, manifest, now = Date.now()) {
  const item = manifest.items.find(i => i.id === itemId);
  if (!item || !Number.isSafeInteger(item.price) || item.price < 0) return { ok: false, reason: 'unknown-item', state };
  if (!affordable(state, item.price)) return { ok: false, reason: 'insufficient-credits', state };
  if ((state.inventory[itemId] || 0) >= 99) return { ok: false, reason: 'pocket-full', state };
  return { ok: true, item, state: {
    ...state, credits: state.credits - item.price,
    inventory: { ...state.inventory, [itemId]: (state.inventory[itemId] || 0) + 1 },
    receipts: [...state.receipts, { itemId, price: item.price, at: now }].slice(-50)
  }};
}
export function recordMeeting(state, id, manifest) {
  if (![...manifest.npcs, ...manifest.garageCrew].some(n => n.id === id) || state.met.includes(id)) return state;
  return { ...state, met: [...state.met, id] };
}
export function recordVisit(state, id, manifest, places = null) {
  if (!knownPlaces(manifest, places).buildings.has(id) || state.visited.includes(id)) return state;
  return { ...state, visited: [...state.visited, id] };
}

/* Generic authored-interaction payment (a bribe today; any `{ type, cost }` interaction tomorrow).
   Same game-credit rules as a purchase: integral, bounded, never below zero, logged, no real money. */
export function payInteraction(state, interactionId, manifest, now = Date.now()) {
  const it = interactionsOf(manifest).get(interactionId);
  if (!it || !Number.isSafeInteger(it.cost) || it.cost < 0 || it.cost > 100000) return { ok: false, reason: 'unknown-interaction', state };
  if (!affordable(state, it.cost)) return { ok: false, reason: 'insufficient-credits', state };
  return { ok: true, interaction: it, state: {
    ...state, credits: state.credits - it.cost,
    payments: [...(state.payments || []), { interactionId: it.id, cost: it.cost, at: now }].slice(-50)
  }};
}
export function recordDiscovery(state, id, places) {
  const allowed = new Set([...(places?.landmarks || []).map(l => l.id), ...(places?.neighborhoods || []).map(n => n.id)]);
  if (!allowed.has(id) || (state.discoveries || []).includes(id)) return state;
  return { ...state, discoveries: [...(state.discoveries || []), id] };
}
