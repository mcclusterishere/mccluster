export const STATE_KEY = 'here.universe.mccluster-fictional-city.state';
export const STATE_VERSION = 1;
const integer = (value, fallback, max = 1000000) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : fallback;
const unique = (values, allowed) => [...new Set(Array.isArray(values) ? values.filter(id => allowed.has(id)) : [])];

export function initialState(manifest) {
  return {
    version: STATE_VERSION, revision: manifest.revision,
    credits: manifest.district.currency.startingBalance,
    position: { x: manifest.district.spawn[0], z: manifest.district.spawn[1], interior: null },
    inventory: {}, met: [], visited: [], receipts: [], story: { chapter: null }
  };
}

export function sanitizeState(raw, manifest) {
  const state = initialState(manifest);
  if (!raw || raw.version !== STATE_VERSION) return state;
  const buildings = new Set([...manifest.businesses, manifest.garage].map(b => b.id));
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
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= 100 && p.z >= -70 && p.z <= 120) {
    state.position = { x: p.x, z: p.z, interior: buildings.has(p.interior) ? p.interior : null };
  }
  state.receipts = (Array.isArray(raw.receipts) ? raw.receipts : []).filter(r =>
    r && items.has(r.itemId) && r.price === items.get(r.itemId).price && Number.isSafeInteger(r.at) && r.at >= 0
  ).slice(-50).map(r => ({ itemId: r.itemId, price: r.price, at: r.at }));
  if (typeof raw.story?.chapter === 'string' && /^[a-z0-9-]{1,60}$/.test(raw.story.chapter)) state.story.chapter = raw.story.chapter;
  return state;
}

export function loadState(storage, manifest) {
  try { return sanitizeState(JSON.parse(storage.getItem(STATE_KEY) || 'null'), manifest); }
  catch { return initialState(manifest); }
}
export function saveState(storage, state) {
  try { storage.setItem(STATE_KEY, JSON.stringify(state)); return true; }
  catch { return false; }
}
export function purchase(state, itemId, manifest, now = Date.now()) {
  const item = manifest.items.find(i => i.id === itemId);
  if (!item || !Number.isSafeInteger(item.price) || item.price < 0) return { ok: false, reason: 'unknown-item', state };
  if (!Number.isSafeInteger(state.credits) || state.credits < item.price) return { ok: false, reason: 'insufficient-credits', state };
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
export function recordVisit(state, id, manifest) {
  if (![...manifest.businesses, manifest.garage].some(b => b.id === id) || state.visited.includes(id)) return state;
  return { ...state, visited: [...state.visited, id] };
}
