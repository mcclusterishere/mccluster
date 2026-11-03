import { loadState, saveState, purchase, recordMeeting, recordVisit, payInteraction, recordDiscovery, interactionsOf, storyProgress, atStoryBeat, completeStoryBeat } from './state.mjs';
import { createCoreLoreLink, manifestDigest } from './core-link.mjs';
import { cityPlaces, neighborhoods, storyArcs, storyBeat, neighborhoodAt, validateCityExtensions } from './content.mjs';
import { bindCity, resolveResidentRoutes, ORIGINAL_BUSINESS_IDS } from './places.mjs';
import { createSpatialWorld, DISTRICT_SURFACES } from './spatial.mjs';

const $ = id => document.getElementById(id);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (label, action, className) => {
  const node = el('button', label, className);
  node.type = 'button'; node.addEventListener('click', action); return node;
};
let manifest, state, scene, storage, toastTimer, saveTimer, adTimer, previousFocus;
let places = null, bound = null, vacant = [], chunkIndex = null;
let storyCache;
let coreLink;
let pageClosed = false;
let panelGeneration = 0;
const coreResidents = new Map();
addEventListener('pagehide', () => { pageClosed = true; }, { once: true });
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
const dialog = $('city-dialog');
const body = $('city-dialog-body');
const buildings = () => cityPlaces(manifest);
const residents = () => [...manifest.npcs, ...manifest.garageCrew];
// lore buildings first; a parcel no lore has claimed yet is a generic place with the same position fields
const findBuilding = id => buildings().find(b => b.id === id) || vacant.find(p => p.id === id);
// display names are lore (expansionNeighborhoods); the places file's names are the plain fallback
const neighborhoodName = id => (manifest?.expansionNeighborhoods || []).find(n => n.id === id)?.name || places?.neighborhoods.find(n => n.id === id)?.name || '';
const findResident = id => coreResidents.get(id) || residents().find(n => n.id === id);

function notify(message) {
  const node = $('city-toast'); node.textContent = message; node.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 4500);
}
function persist() {
  clearTimeout(saveTimer);
  const ok = saveState(storage, state);
  $('city-save-note').textContent = ok ? 'Your place and pocket save on this device.' : 'Saving is unavailable in this browser. Keep this tab open to retain your progress.';
  return ok;
}
function stats() {
  $('city-balance').textContent = state.credits.toLocaleString();
  $('city-pocket-count').textContent = Object.values(state.inventory).reduce((a, b) => a + b, 0);
  $('city-met').textContent = state.met.length + ' / ' + residents().length;
  syncStoryProgress();
}
function syncStoryProgress() {
  const arcs = storyArcs(manifest);
  const completed = arcs.flatMap(arc => storyProgress(state, arc).completed);
  scene?.setStoryProgress?.(completed);
  const arc = arcs.find(a => a.id === 'robbery-1s');
  if (arc && $('city-robbery-progress')) {
    const progress = storyProgress(state, arc);
    $('city-robbery-progress').textContent = progress.finished ? 'The altar awaits your return.'
      : `${progress.completed.length} / ${arc.beats.length} scenes · ${progress.next.title}`;
  }
}
function panel(kicker, title) {
  panelGeneration++;
  if (!dialog.open) previousFocus = document.activeElement;
  scene?.setPaused(true);
  $('city-dialog-kicker').textContent = kicker;
  $('city-dialog-title').textContent = title;
  body.replaceChildren();
  if (!dialog.open) dialog.showModal();
  body.scrollTop = 0; dialog.scrollTop = 0;
  return body;
}
function closePanel() { dialog.close(); }
dialog.addEventListener('close', () => {
  panelGeneration++;
  scene?.setPaused(false);
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
$('city-dialog-close').addEventListener('click', closePanel);
dialog.addEventListener('click', event => { if (event.target === dialog) {
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closePanel();
}});

function markVisit(id) { state = recordVisit(state, id, manifest, places); persist(); }
function moveToBuilding(id, enter = false) {
  const place = findBuilding(id); if (!place) return;
  enter = enter && place.enterable !== false && place.style !== 'yard';
  closePanel();
  if (scene) {
    scene.teleport({ x: place.entrance[0], z: place.entrance[1], interior: null });
    if (enter) scene.enterBuilding(id);
  } else if (enter && place.enterable !== false) {
    state.position = { x: 0, z: 6, interior: id };
    markVisit(id); openBuilding(id);
  } else {
    state.position = { x: place.entrance[0], z: place.entrance[1], interior: null };
    openBuilding(id);
  }
  markVisit(id);
  if (enter && place.enterable !== false) notify('Inside ' + place.name);
  else notify('Arrived outside ' + place.name + '. Walk to the door or press E.');
  updateLocation(state.position);
  if (scene) $('city-canvas').focus({ preventScroll: true });
}

function updateLocation(position) {
  state.position = position;
  const inside = position.interior && findBuilding(position.interior);
  const story = neighborhoodAt(manifest, position);
  const area = story ? null : bound?.index.neighborhoodAt(position.x, position.z);
  $('city-location').textContent = inside ? inside.name : story ? 'Bridgeport · Downtown' : area && area.id !== 'original-block' ? neighborhoodName(area.id) : position.z > 48 && Math.abs(position.x) < 22 ? 'Equity Uprise Island' : 'Harbor Boulevard';
  if ($('city-area-label')) $('city-area-label').textContent = story ? 'BRIDGEPORT STORY BLOCK' : inside ? (neighborhoodName(inside.neighborhood) || 'COMMERCIAL DISTRICT').toUpperCase() : area?.kind === 'landmark' ? 'THE ISLAND' : area && area.id !== 'original-block' ? neighborhoodName(area.id).toUpperCase() : 'COMMERCIAL DISTRICT';
  if ($('city-stage-area')) $('city-stage-area').textContent = story ? 'BRIDGEPORT / 02' : 'HARBOR / 01';
  $('city-exit').hidden = !inside;
  if (inside) state = recordVisit(state, inside.id, manifest, places);
  clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500);
}
function openBuilding(id) {
  const place = findBuilding(id); if (!place) return;
  if (place.generic) { openParcel(id); return; }
  const root = panel(place.category || (place.parcelId ? neighborhoodName(place.neighborhood) : 'The garage'), place.name);
  root.append(el('p', place.tagline, 'city-quote'), el('p', place.description), el('p', place.backstory));
  const actions = el('div', undefined, 'city-dialog-actions');
  if (place.enterable !== false && place.style !== 'yard') actions.append(button('Walk inside', () => moveToBuilding(id, true), 'city-primary'));
  else actions.append(button('Go to this spot', () => moveToBuilding(id), 'city-primary'));
  appendInteractions(actions, place);
  if (place.storyArcId) actions.append(button('The Robbery 1s story', () => openArc(place.storyArcId)));
  if (place.itemIds?.length) actions.append(button('Browse the counter', () => openShop(id)));
  if (id === manifest.garage.id) actions.append(button('Open the story desk', () => openStory()), button('Open the transportation globe', () => openTravel()));
  root.append(actions);
  const people = peopleOf(place);
  if (people.length) root.append(el('h3', 'The people here'));
  for (const personId of people) {
    const person = findResident(personId);
    if (person) root.append(personButton(person));
  }
}
function personButton(person) {
  const node = button('', () => openResident(person.id), 'city-person');
  const swatch = el('span', person.name.split(' ').map(n => n[0]).slice(0, 2).join(''), 'city-person-swatch');
  swatch.style.backgroundColor = person.appearance?.shirt || '#4c6d63';
  const text = el('span', undefined, 'city-person-text');
  text.append(el('strong', person.name), el('small', person.role));
  node.append(swatch, text); return node;
}
function openResident(id, topicId) {
  const person = findResident(id); if (!person) return;
  if (!coreResidents.has(id)) void coreLink?.resident(id).then(value => {
    if (value?.id === id) coreResidents.set(id, value);
  });
  state = recordMeeting(state, id, manifest); persist(); stats();
  const place = findBuilding(person.businessId);
  const root = panel((place?.name || 'On the block') + ' · ' + person.role, person.name);
  const origin = person.origin && (typeof person.origin === 'string' ? person.origin : [person.origin.city, person.origin.country].filter(Boolean).join(', '));
  root.append(el('p', [person.age ? person.age + ' years old' : '', origin].filter(Boolean).join(' · '), 'city-bio-meta'));
  const topic = person.dialogue.topics.find(t => t.id === topicId);
  if (topic) {
    root.append(el('h3', topic.label));
    for (const line of topic.lines) {
      const row = el('p', undefined, 'city-script-line');
      row.append(el('strong', line.speaker), document.createTextNode(line.text)); root.append(row);
    }
  } else root.append(el('p', person.dialogue.greeting, 'city-quote'));
  const choices = el('div', undefined, 'city-dialog-actions');
  for (const item of person.dialogue.topics) choices.append(button(item.label, () => openResident(id, item.id)));
  root.append(choices);
  const biography = el('details');
  biography.append(el('summary', 'Their story'));
  const content = el('div');
  content.append(el('p', person.backstory), el('p', person.personality));
  biography.append(content); root.append(biography);
  const actions = el('div', undefined, 'city-dialog-actions');
  if (place?.itemIds?.length) actions.append(button('Browse ' + place.name, () => openShop(place.id), 'city-primary'));
  appendInteractions(actions, person);
  if (person.businessId === manifest.garage.id) actions.append(button('Whip Equipped story desk', openStory, 'city-primary'));
  actions.append(button('See you around', closePanel)); root.append(actions);
}
/* Authored interactions bind generically: lore declares `interactions: [{ type, id, label, price, npcIds, outcome }]`
   on a business (offered there and by each listed resident) or on a resident. `bribe` spends city credits through
   the same rules as a purchase. Minors never offer one. Unknown types are ignored, so newer lore never breaks an
   older host. */
const INTERACTIONS = {
  bribe(it) {
    return button((it.label || 'Make an offer') + ' · ' + it.price + ' cr', () => {
      const result = payInteraction(state, it.id, manifest);
      if (!result.ok) { notify(result.reason === 'insufficient-credits' ? 'You need more city credits for that.' : 'That offer is not available.'); return; }
      state = result.state; persist(); stats();
      const root = panel('Paid · ' + it.price + ' city credits', it.label || 'Done');
      root.append(el('p', it.outcome || 'Done.', 'city-quote'), el('p', state.credits + ' city credits left in your pocket.', 'city-bio-meta'));
      root.append(button('Back to the street', closePanel));
    }, 'city-primary');
  }
};
function appendInteractions(actions, entity) {
  if (entity.minor === true) return;
  for (const it of interactionsOf(manifest).values()) {
    const offered = it.ownerId === entity.id || (it.npcIds || []).includes(entity.id);
    if (!offered || !INTERACTIONS[it.type]) continue;
    const node = INTERACTIONS[it.type](it);
    node.dataset.interaction = it.id;
    node.disabled = state.credits < it.price;
    node.setAttribute('aria-label', (it.label || 'Make an offer') + ' for ' + it.price + ' city credits');
    actions.append(node);
  }
}
// everyone attached to a place: staff first, then members, students and affiliates (lore revision 2)
const peopleOf = place => [...new Set([...(place.staffIds || []), ...(place.affiliatedStaffIds || []), ...(place.memberIds || []), ...(place.studentIds || [])])];
function openParcel(id) {
  const place = vacant.find(p => p.id === id); if (!place) return;
  const root = panel(neighborhoodName(place.neighborhood), place.name);
  const actions = el('div', undefined, 'city-dialog-actions');
  const family = place.familyId && (manifest.families || []).find(f => f.id === place.familyId);
  if (family) {
    if (family.lore) root.append(el('p', family.lore));
    const home = (family.members || []).map(m => m.npcId && findResident(m.npcId)).filter(Boolean);
    for (const person of home) root.append(personButton(person));
    actions.append(button('Back to the street', closePanel)); root.append(actions);
    return;
  }
  if (place.enterable) {
    root.append(el('p', 'The door is open. Nobody is behind the counter yet.'));
    actions.append(button('Walk inside', () => moveToBuilding(id, true), 'city-primary'));
  } else root.append(el('p', 'You knock. Nobody answers the door.'));
  actions.append(button('Back to the street', closePanel)); root.append(actions);
}
function openLandmark(id) {
  const l = places?.landmarks.find(x => x.id === id); if (!l) return;
  const root = panel(neighborhoodName(l.neighborhood), l.name);
  if (l.hqView) {
    const d = Math.round(Math.hypot(l.position[0], l.position[1] - 88));
    root.append(el('p', 'Equity Uprise HQ stands on its island ' + d + ' metres across the water: a 72-foot square tower, six floors and an open roof at 81 feet. The footbridge from Harbor Boulevard is the way over.'));
  }
  const actions = el('div', undefined, 'city-dialog-actions');
  actions.append(button('Go to the footbridge', () => { closePanel(); scene?.teleport({ x: 0, z: 46, interior: null }); notify('At the footbridge. Walk south to the island.'); }, 'city-primary'));
  actions.append(button('HQ doorway', () => openTravel('equity-uprise-hq')));
  root.append(actions);
}
function openShop(id) {
  const place = findBuilding(id); if (!place) return;
  if (place.generic) { openParcel(id); return; }
  const root = panel('The counter · ' + state.credits + ' credits in your pocket', place.name);
  root.append(el('p', place.tagline, 'city-quote'));
  const grid = el('div', undefined, 'city-card-grid');
  for (const item of manifest.items.filter(i => i.businessId === id)) {
    const card = el('article', undefined, 'city-place-card');
    card.append(el('p', item.kind || 'Collectible', 'city-eyebrow'), el('h3', item.name), el('p', item.description));
    const price = el('div', undefined, 'city-price-row');
    const buy = button('Buy', () => {
      const result = purchase(state, item.id, manifest);
      if (!result.ok) { notify(result.reason === 'pocket-full' ? 'You already have 99 of these.' : 'You need more city credits for that.'); return; }
      state = result.state; persist(); stats(); openShop(id);
      notify(item.name + ' added to your pocket. ' + item.price + ' credits spent.');
    }, 'city-primary');
    buy.disabled = state.credits < item.price || (state.inventory[item.id] || 0) >= 99;
    buy.setAttribute('aria-label', 'Buy ' + item.name + ' for ' + item.price + ' credits');
    price.append(el('strong', item.price + ' cr'), buy); card.append(price);
    if (state.inventory[item.id]) card.append(el('p', 'In your pocket: ' + state.inventory[item.id]));
    grid.append(card);
  }
  root.append(grid, el('p', 'City credits have no cash value.', 'city-bio-meta'));
}
function openPocket() {
  const root = panel(state.credits + ' city credits', 'Your pocket');
  const owned = Object.entries(state.inventory);
  if (!owned.length) root.append(el('p', 'Empty for now. There are 24 questionable purchases waiting on the block.'));
  for (const [id, count] of owned) {
    const item = manifest.items.find(i => i.id === id);
    const card = el('article', undefined, 'city-place-card');
    card.append(el('h3', item.name + ' × ' + count), el('p', item.description)); root.append(card);
  }
  if (state.receipts.length) {
    const receipts = el('details'); receipts.append(el('summary', 'Recent receipts'));
    const list = el('div');
    for (const r of [...state.receipts].reverse().slice(0, 10)) {
      list.append(el('p', manifest.items.find(i => i.id === r.itemId).name + ' — ' + r.price + ' credits'));
    }
    receipts.append(list); root.append(receipts);
  }
}
function drawMap(area) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  if (!area && places) return drawCityMap(ns, svg);
  const allSurfaces = area ? area.surfaces : DISTRICT_SURFACES;
  const bounds = area ? area.bounds : { minX: -76, maxX: 76, minZ: -62, maxZ: 112 };
  const scale = 310 / (bounds.maxX - bounds.minX), height = (bounds.maxZ - bounds.minZ) * scale + 40;
  const mx = x => 20 + (x - bounds.minX) * scale, mz = z => 20 + (z - bounds.minZ) * scale;
  svg.setAttribute('viewBox', `0 0 350 ${height}`); svg.setAttribute('class', 'city-map');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', area ? 'Downtown Bridgeport building footprints, streets and numbered story locations. Destinations are listed below.' : 'Harbor Boulevard, Whip Equipped garage, bridge and Equity Uprise island. Destinations are listed below.');
  const shape = (tag, attrs, label) => {
    const n = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (label) n.textContent = label; svg.append(n); return n;
  };
  const rect = (s, fill) => shape('rect', { x: mx(s.minX), y: mz(s.minZ), width: (s.maxX - s.minX) * scale, height: (s.maxZ - s.minZ) * scale, fill });
  for (const surface of allSurfaces) rect(surface, '#e9e4cf');
  if (area) for (const road of area.roads) {
    if (road.points) shape('polyline', { points: road.points.map(([x, z]) => `${mx(x)},${mz(z)}`).join(' '), fill: 'none', stroke: '#73877e', 'stroke-width': road.width * scale, 'stroke-linejoin': 'round' });
    else rect({ minX: road.x - road.width / 2, maxX: road.x + road.width / 2, minZ: road.z - road.depth / 2, maxZ: road.z + road.depth / 2 }, '#73877e');
  } else {
    rect({ minX: -72, maxX: 72, minZ: -10, maxZ: 8 }, '#73877e');
    rect({ minX: -10.9728, maxX: 10.9728, minZ: 77.0272, maxZ: 98.9728 }, '#47676a');
    shape('text', { x: mx(0), y: mz(106), 'font-size': 11 }, 'EQUITY UPRISE');
  }
  const shown = area ? area.places : [...manifest.businesses, manifest.garage];
  shown.forEach((place, index) => {
    if (place.footprint) shape('polygon', { points: place.footprint.map(([x, z]) => `${mx(x)},${mz(z)}`).join(' '), fill: place.color, stroke: '#64766b', 'stroke-width': .7 });
    else rect({ minX: place.position[0] - place.size[0] / 2, maxX: place.position[0] + place.size[0] / 2, minZ: place.position[1] - place.size[1] / 2, maxZ: place.position[1] + place.size[1] / 2 }, place.color);
    if (!area || place.storyArcId) {
      const cx = mx(place.entrance[0]), cy = mz(place.entrance[1]);
      shape('circle', { cx, cy, r: 10, fill: '#fffdf6', stroke: '#294d47', 'stroke-width': 1 });
      shape('text', { x: cx, y: cy + 4, style: 'font-size:12px' }, String(index + 1));
    }
  });
  if (!state.position.interior && state.position.x >= bounds.minX && state.position.x <= bounds.maxX && state.position.z >= bounds.minZ && state.position.z <= bounds.maxZ) {
    shape('circle', { cx: mx(state.position.x), cy: mz(state.position.z), r: 5, fill: '#eb763e', stroke: '#fff', 'stroke-width': 2 });
  }
  return svg;
}
/* The whole city at one scale: north up (−Z), land, streets, every parcel and the island HQ. */
function drawCityMap(ns, svg) {
  // the authored frame plus any neighbourhood built from other sources (Bridgeport, north of the original block)
  const story = neighborhoods(manifest);
  const b = [places.frame.bounds, ...story.map(n => n.bounds)].reduce((u, r) => ({ minX: Math.min(u.minX, r.minX), maxX: Math.max(u.maxX, r.maxX), minZ: Math.min(u.minZ, r.minZ), maxZ: Math.max(u.maxZ, r.maxZ) }));
  const pad = 6, k = 1.05;
  const W = (b.maxX - b.minX) * k + pad * 2, H = (b.maxZ - b.minZ + 20) * k + pad * 2;
  svg.setAttribute('viewBox', `0 0 ${W.toFixed(0)} ${H.toFixed(0)}`); svg.setAttribute('class', 'city-map city-map-wide');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'McCluster City. Harbor Boulevard runs east to west through the original block, Civic Center to the west and the HQ Waterfront to the east. Northside homes lie north of the garage. Two wharves wrap the harbor, where a footbridge reaches Equity Uprise island.');
  const mx = x => pad + (x - b.minX) * k, mz = z => pad + (z - b.minZ) * k;
  const shape = (tag, attrs, label) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([key, v]) => n.setAttribute(key, v)); if (label) n.textContent = label; svg.append(n); return n; };
  const rect = (r, fill, extra = {}) => shape('rect', { x: mx(r.minX), y: mz(r.minZ), width: (r.maxX - r.minX) * k, height: (r.maxZ - r.minZ) * k, fill, ...extra });
  shape('rect', { x: 0, y: 0, width: W, height: H, fill: '#9cc2c0', rx: 8 });
  for (const s of places.surfaces) rect(s, s.kind === 'pier' || s.kind === 'bridge' ? '#c9b48f' : s.kind === 'quay' ? '#e3d6b8' : '#e9e4cf');
  for (const n of story) for (const sf of n.surfaces) rect(sf, '#e9e4cf');
  for (const p of places.parks || []) rect(p, '#bcd0a8');
  for (const s of places.streets) rect(s, s.kind === 'road' || s.kind === 'lane' ? '#8d9595' : s.kind === 'plaza' ? '#efe6cf' : '#d7b9a0');
  for (const p of [...buildings(), ...vacant]) {
    const [x, z] = p.position, [w, d] = p.size;
    rect({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }, p.generic ? '#b7a68c' : (p.color || '#7a8a7d'), { rx: 1.5, 'data-place': p.id });
  }
  rect({ minX: -10.97, maxX: 10.97, minZ: 77.03, maxZ: 98.97 }, '#47676a');
  for (const n of story) {
    for (const p of n.places || []) if (p.style !== 'yard') { const r = buildingBoundsOf(p); rect(r, p.storyArcId ? '#c98a5a' : '#b7a68c', { rx: 1 }); }
    const t = shape('text', { x: mx((n.bounds.minX + n.bounds.maxX) / 2), y: mz(n.bounds.minZ + 24), class: 'city-map-area' }, n.name.toUpperCase());
    t.setAttribute('text-anchor', 'middle');
  }
  for (const n of places.neighborhoods) {
    const c = n.bounds;
    const t = shape('text', { x: mx((c.minX + c.maxX) / 2), y: mz(n.id === 'hq-island' ? 106 : n.id === 'northside-residential' ? -141 : n.id === 'original-block' ? 30 : (c.minZ + c.maxZ) / 2 + (n.id.includes('waterfront') ? 20 : 0)), class: 'city-map-area' }, neighborhoodName(n.id).toUpperCase());
    t.setAttribute('text-anchor', 'middle');
  }
  if (!state.position.interior) shape('circle', { cx: mx(state.position.x), cy: mz(state.position.z), r: 4, fill: '#eb763e', stroke: '#fff', 'stroke-width': 1.5 });
  return svg;
}
function buildingBoundsOf(p) {
  if (Array.isArray(p.footprint) && p.footprint.length >= 3) {
    const xs = p.footprint.map(q => q[0]), zs = p.footprint.map(q => q[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }
  const [x, z] = p.position, [w, d] = p.size; return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}
function placeCard(place) {
  const card = el('article', undefined, 'city-place-card');
  card.append(el('p', place.generic ? neighborhoodName(place.neighborhood) : (place.category || neighborhoodName(place.neighborhood) || 'Story hub'), 'city-eyebrow'), el('h3', place.name));
  if (place.description) card.append(el('p', place.description));
  const actions = el('div', undefined, 'city-dialog-actions');
  actions.append(button('Go to the door', () => moveToBuilding(place.id)), button('About this spot', () => openBuilding(place.id)));
  card.append(actions); return card;
}
function openMap(areaId) {
  const area = neighborhoods(manifest).find(n => n.id === areaId);
  const root = panel(area ? area.city : places ? 'Harbor Boulevard & four new neighborhoods' : 'Harbor Boulevard & Equity Uprise Island', area ? area.name : places ? 'The city' : 'The district');
  const tabs = el('div', undefined, 'city-dialog-actions');
  tabs.append(button('Harbor & Uprise', () => openMap()));
  for (const n of neighborhoods(manifest)) tabs.append(button('Bridgeport · Robbery 1s', () => openMap(n.id)));
  root.append(tabs, drawMap(area));
  if (area) {
    const credits = el('p', undefined, 'city-bio-meta');
    credits.append(document.createTextNode('Building footprints: CT State GIS Office, 2023. Streets: '));
    const osm = el('a', '© OpenStreetMap contributors'); osm.href = 'https://www.openstreetmap.org/copyright'; osm.target = '_blank'; osm.rel = 'noopener'; credits.append(osm);
    root.append(credits, button('Open The Robbery 1s', () => openArc('robbery-1s'), 'city-primary'));
  }
  if (!area && places) {
    // authored versus surveyed ground, stated where the map is read
    const legend = el('p', 'The harbor, the island, the wharves and the neighborhoods around them are an authored plan, not a survey. The Bridgeport block uses surveyed building footprints (CT State GIS Office, 2023) and streets (', 'city-bio-meta');
    const osm = el('a', '© OpenStreetMap contributors'); osm.href = 'https://www.openstreetmap.org/copyright'; osm.target = '_blank'; osm.rel = 'noopener';
    legend.append(osm, document.createTextNode(', ODbL).'));
    root.append(legend);
    const found = (state.discoveries || []).filter(id => places.landmarks.some(l => l.id === id) || places.neighborhoods.some(n => n.id === id)).length;
    root.append(el('p', found + ' of ' + (places.landmarks.length + places.neighborhoods.length) + ' places found on foot.', 'city-bio-meta'));
  }
  const grid = el('div', undefined, 'city-card-grid');
  const cards = area ? area.places : [...manifest.businesses, manifest.garage];
  cards.forEach((place, index) => {
    if (area && !place.storyArcId) return;
    if (!area) { grid.append(placeCard(place)); return; }
    const card = el('article', undefined, 'city-place-card');
    card.append(el('p', `${index + 1} · ${place.category || 'Story location'}`, 'city-eyebrow'), el('h3', place.name), el('p', place.description));
    const actions = el('div', undefined, 'city-dialog-actions');
    actions.append(button('Go to the door', () => moveToBuilding(place.id)), button('About this spot', () => openBuilding(place.id)));
    card.append(actions); grid.append(card);
  });
  root.append(grid);
  if (!area) for (const n of places?.neighborhoods.filter(n => n.status === 'new') || []) {
    const inArea = vacant.filter(p => p.neighborhood === n.id && p.role !== 'scenery');
    if (!inArea.length) continue;
    const details = el('details', undefined, 'city-area-list');
    details.append(el('summary', neighborhoodName(n.id) + ' · ' + inArea.length + ' doors'));
    const g = el('div', undefined, 'city-card-grid');
    for (const p of inArea) g.append(placeCard(p));
    details.append(g); root.append(details);
  }
  if (!area) root.append(button('Walk to Equity Uprise Island', () => {
    closePanel(); scene?.teleport({ x: 0, z: 73, interior: null });
    if (!scene) openTravel('equity-uprise-hq');
  }, 'city-primary'));
}

function openResidents() {
  const root = panel(residents().length + ' neighbors, including the 3-person garage crew', 'City directory');
  const listed = new Set();
  for (const place of buildings()) {
    const ids = peopleOf(place).filter(id => findResident(id));
    if (!ids.length) continue;
    root.append(el('h3', place.name));
    for (const id of ids) { listed.add(id); root.append(personButton(findResident(id))); }
  }
  for (const family of manifest.families || []) {
    const ids = (family.members || []).map(m => m.npcId).filter(id => id && findResident(id) && !listed.has(id));
    if (!ids.length) continue;
    root.append(el('h3', family.name));
    for (const id of ids) { listed.add(id); root.append(personButton(findResident(id))); }
  }
  const rest = residents().filter(n => !listed.has(n.id));
  if (rest.length) { root.append(el('h3', 'Around town')); for (const n of rest) root.append(personButton(n)); }
}

function moveToBeat(beat, walk = false) {
  const point = { x: beat.position[0], z: beat.position[1], interior: null };
  if (!scene) {
    updateLocation(point); markVisit(beat.placeId); persist();
    openArcBeat(beat.id);
    return;
  }
  closePanel();
  // Closing the native dialog dispatches its close event asynchronously. Resume
  // movement before asking the scene to find a route, without reopening a panel.
  scene.setPaused(false);
  if (walk && !state.position.interior) {
    const found = scene.walkTo(point, { kind: 'story', id: beat.id });
    notify(found ? 'Follow the street to ' + beat.title + '.' : 'No walking route from here. Open the story to go to the scene.');
  } else {
    scene.teleport(point); markVisit(beat.placeId); persist();
    notify('At ' + beat.title + '. Press E or tap Interact to begin.');
  }
  $('city-canvas').focus({ preventScroll: true });
  $('city-canvas').scrollIntoView({ block: 'center', behavior: 'instant' });
}
function openArc(id = 'robbery-1s') {
  const arc = storyArcs(manifest).find(a => a.id === id); if (!arc) return;
  const progress = storyProgress(state, arc);
  const root = panel(`${arc.series} · ${arc.setting}`, arc.title);
  root.append(el('p', 'A pair of shoes changes hands. The neighborhood pays the price.', 'city-quote'));
  root.append(el('p', `${progress.completed.length} of ${arc.beats.length} scenes visited. Follow the amber markers through Bridgeport.`));
  if (progress.next) {
    const next = progress.next, place = findBuilding(next.placeId);
    const card = el('article', undefined, 'city-place-card');
    card.append(el('p', 'NEXT SCENE · ACT ' + next.act, 'city-eyebrow'), el('h3', next.title), el('p', `${place.name} · ${next.objective || next.summary}`));
    const actions = el('div', undefined, 'city-dialog-actions');
    actions.append(button('Go to the scene', () => moveToBeat(next), 'city-primary'));
    if (scene && !state.position.interior) actions.append(button('Walk the street route', () => moveToBeat(next, true)));
    if (atStoryBeat(state, next)) actions.append(button('Begin this scene', () => openArcBeat(next.id)));
    card.append(actions); root.append(card);
  } else {
    root.append(el('p', 'The episode is complete. Its last question stays with the shoes.', 'city-quote'));
  }
  root.append(el('h3', 'Your story route'));
  for (const [index, beat] of arc.beats.entries()) {
    const done = progress.completed.includes(beat.id), next = progress.next?.id === beat.id;
    const row = button(`${done ? '✓' : next ? '→' : '·'} ${index + 1}. ${done || next ? beat.title : 'Act ' + beat.act + ' · Continue the story to reveal this scene'}`, () => openArcBeat(beat.id), 'city-person');
    row.disabled = !done && !next; root.append(row);
  }
  const cast = el('details'); cast.append(el('summary', 'The people in this story'));
  const people = el('div');
  for (const character of arc.cast || []) people.append(el('p', character.name + (progress.finished ? ' — ' + character.role : '')));
  cast.append(people); root.append(cast);
  const area = neighborhoods(manifest).find(n => n.places.some(p => p.storyArcId === arc.id));
  if (area) root.append(button('See the Bridgeport block', () => openMap(area.id)));
}
function openArcBeat(id) {
  const found = storyBeat(manifest, id); if (!found) return;
  const { arc, beat, index } = found, progress = storyProgress(state, arc);
  const done = progress.completed.includes(id), next = progress.next?.id === id;
  const place = findBuilding(beat.placeId);
  const root = panel(`${arc.title} · Act ${beat.act} · Scene ${index + 1}`, done || next ? beat.title : 'The story continues here');
  root.append(el('p', place.name + ' · Bridgeport', 'city-bio-meta'));
  if (!done && !next) {
    root.append(el('p', 'This part of the story comes later.'), button('Return to the story route', () => openArc(arc.id), 'city-primary'));
    return;
  }
  if (!done && !atStoryBeat(state, beat)) {
    root.append(el('p', beat.objective || 'Visit this location to continue the story.'));
    root.append(button('Go to the scene', () => moveToBeat(beat), 'city-primary'));
    return;
  }
  markVisit(beat.placeId);
  root.append(el('p', beat.summary, 'city-quote'));
  const prose = el('div', undefined, 'city-reading');
  for (const paragraph of beat.paragraphs) prose.append(el('p', paragraph));
  root.append(prose);
  const actions = el('div', undefined, 'city-dialog-actions');
  if (!done) actions.append(button(beat.actionLabel || 'Continue', () => {
    const result = completeStoryBeat(state, id, manifest);
    if (!result.ok) { notify('Visit the current scene to continue.'); return; }
    state = result.state; persist(); syncStoryProgress();
    openArc(arc.id);
    notify(storyProgress(state, arc).finished ? 'The Robbery 1s · Episode complete.' : 'Scene saved. The next part of the story is ready.');
  }, 'city-primary'));
  actions.append(button('Story route', () => openArc(arc.id)), button('Back to the street', closePanel)); root.append(actions);
}
function safeRoute(route) {
  if (typeof route !== 'string') return null;
  const url = new URL(route, location.href);
  return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? url : null;
}
function openTravel(selected) {
  const root = panel('Departure desk', 'Where to next?');
  root.append(el('p', 'Your place in the district is saved before you leave. Return here to continue your walk.'));
  for (const portal of manifest.portals.filter(p => !selected || p.id === selected)) {
    const url = safeRoute(portal.route); if (!url) continue;
    const card = el('article', undefined, 'city-place-card');
    card.append(el('h3', portal.name), el('p', portal.description));
    const link = el('a', 'Open ' + portal.name + ' ↗'); link.href = url.href;
    link.addEventListener('click', persist); card.append(link); root.append(card);
  }
}
function plainMarkdown(text) {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/^\*|\*$/gm, '').replace(/`/g, '');
}
function reading(text) {
  const wrap = el('div', undefined, 'city-reading');
  for (const paragraph of text.split(/\n\s*\n/).filter(Boolean)) {
    if (/^#{1,4} /.test(paragraph)) wrap.append(el('h3', paragraph.replace(/^#{1,4} /, '')));
    else {
      const p = el('p');
      const speech = /^\*\*([^*]+):\*\*\s*([\s\S]*)$/.exec(paragraph);
      if (speech) p.append(el('strong', speech[1] + ': '), document.createTextNode(plainMarkdown(speech[2])));
      else p.textContent = plainMarkdown(paragraph);
      wrap.append(p);
    }
  }
  return wrap;
}
async function openStory(chapterId) {
  const root = panel('Whip Equipped garage · Script & listening desk', 'The story lives here');
  const generation = panelGeneration;
  root.append(el('p', 'Open a chapter to read its full before scene, music-video treatment, and aftermath. This desk keeps the long story intact. The street outside is a free-roam pre-finale setting.'));
  const loading = el('p', 'Opening the screenplay…'); root.append(loading);
  try {
    if (!storyCache) {
      const response = await fetch('data/fictional-city/whip-story.v1.json?v=__STAMP__', { cache: 'no-cache' });
      if (!response.ok) throw new Error('story');
      storyCache = await response.json();
    }
    if (!dialog.open || generation !== panelGeneration) return;
    loading.remove();
    const chapter = storyCache.chapters.find(c => c.id === chapterId);
    if (chapter) {
      state.story.chapter = chapter.id; persist();
      root.append(button('← All chapters', () => openStory()), el('h3', chapter.title));
      for (const [label, value] of [['Before the song · 2T', chapter.before], ['Music-video treatment · T', chapter.video], ['After the song · 2T', chapter.after]]) {
        const details = el('details'); details.append(el('summary', label), reading(value)); root.append(details);
      }
      root.querySelector('details').open = true;
    } else {
      const intro = el('p', 'Every song keeps its 2T → T → 2T structure. Read the full screenplay here, then open the album to listen.', 'city-quote');
      root.append(intro);
      for (const chapter of storyCache.chapters) root.append(button(chapter.title, () => openStory(chapter.id), 'city-person'));
      const roads = el('details'); roads.append(el('summary', 'The Road Years — camper, G20, and green Econoline'), reading(storyCache.roadYears)); root.append(roads);
    }
    const album = el('a', 'Listen to Whip Equipped ↗'); album.href = 'album.html?album=whip-equipped'; album.addEventListener('click', persist);
    root.append(album);
  } catch {
    if (!dialog.open || generation !== panelGeneration) return;
    loading.textContent = 'The story desk could not load. Your city progress is safe.';
    root.append(button('Try again', () => openStory(chapterId)));
    const source = el('a', 'Read the canonical screenplay ↗');
    source.href = 'https://github.com/mcclusterishere/mccluster/blob/main/docs/music/whip-equipped/SCREENPLAY.md';
    root.append(source);
  }
}
/* Chunk detail: published per-chunk JSON, checked against the index's SHA-256 when the browser can hash. */
async function loadChunk(id) {
  const meta = chunkIndex?.chunks.find(c => c.id === id); if (!meta) throw new Error('unknown chunk');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('data/fictional-city/' + meta.file + '?v=__STAMP__', { cache: 'no-cache', signal: controller.signal });
    if (!response.ok) throw new Error('chunk ' + id + ' answered ' + response.status);
    const buffer = await response.arrayBuffer();
    if (meta.sha256 && globalThis.crypto?.subtle) {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== meta.sha256) throw new Error('chunk ' + id + ' failed its integrity check');
    }
    return JSON.parse(new TextDecoder().decode(buffer));
  } finally { clearTimeout(timer); }
}
/* On approach to the island, warm the browser cache with the canonical HQ geometry the doorway opens first. */
let hqPrefetched = false;
function prefetchHq() {
  if (hqPrefetched) return; hqPrefetched = true;
  for (const file of ['equity-uprise-building-core-v2.glb', 'equity-uprise-floor-01-core-v2.glb']) {
    const link = document.createElement('link'); link.rel = 'prefetch'; link.as = 'fetch'; link.href = 'equity-uprise-preview/' + file;
    link.dataset.cityPrefetch = 'hq'; document.head.append(link);
  }
}
function handleTarget(target) {
  if (!target) return;
  if (target.kind === 'npc') openResident(target.id);
  else if (target.kind === 'story') openArcBeat(target.id);
  else if (target.kind === 'building') {
    const place = findBuilding(target.id);
    if (place.enterable === false || place.style === 'yard') { markVisit(place.id); openBuilding(place.id); }
    else {
      scene.enterBuilding(target.id); markVisit(target.id);
      notify('Inside ' + place.name + (place.storyArcId ? '. Explore the room or open the story.' : '. Walk to the counter or talk to the crew.'));
    }
  } else if (target.kind === 'counter') {
    const place = findBuilding(target.id);
    if (place?.storyArcId) {
      const arc = storyArcs(manifest).find(a => a.id === place.storyArcId), next = arc && storyProgress(state, arc).next;
      if (next?.placeId === place.id) openArcBeat(next.id); else openArc(place.storyArcId);
    } else if (target.id === manifest.garage.id) openStory(); else if (place?.itemIds?.length || place?.generic) openShop(target.id); else openBuilding(target.id);
  } else if (target.kind === 'parcel') {
    const p = vacant.find(v => v.id === target.id);
    if (p?.enterable) { scene.enterBuilding(p.id); markVisit(p.id); notify('Inside ' + p.name + '.'); } else openParcel(target.id);
  } else if (target.kind === 'landmark') openLandmark(target.id);
  else if (target.kind === 'portal') openTravel(target.id);
  else if (target.kind === 'exit') scene.exitBuilding();
}
function bindControls() {
  $('city-map-open').addEventListener('click', () => openMap(neighborhoodAt(manifest, state.position)?.id));
  $('city-garage-open').addEventListener('click', () => moveToBuilding(manifest.garage.id, true));
  $('city-pocket-open').addEventListener('click', openPocket);
  $('city-residents-open').addEventListener('click', openResidents);
  $('city-story-open').addEventListener('click', () => openStory());
  $('city-robbery-open')?.addEventListener('click', () => openArc());
  $('city-travel-open').addEventListener('click', () => openTravel());
  $('city-exit').addEventListener('click', () => {
    if (scene) scene.exitBuilding();
    else { const p = findBuilding(state.position.interior); updateLocation({ x: p.entrance[0], z: p.entrance[1], interior: null }); }
  });
  $('city-interact').addEventListener('click', () => scene?.interactNearest());
  $('city-zoom-in').addEventListener('click', () => scene?.zoomBy(.8));
  $('city-zoom-out').addEventListener('click', () => scene?.zoomBy(1.25));
  $('city-reset-view').addEventListener('click', () => scene?.resetView());
  const moves = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 }, east: { x: 1, z: 0 } };
  for (const node of document.querySelectorAll('[data-move]')) {
    node.addEventListener('pointerdown', event => {
      event.preventDefault(); node.setPointerCapture(event.pointerId); scene?.setInput(moves[node.dataset.move]);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) node.addEventListener(type, () => scene?.setInput({ x: 0, z: 0 }));
  }
  addEventListener('blur', () => scene?.setInput({ x: 0, z: 0 }));
}
async function start() {
  try {
    let response = await fetch('data/fictional-city/district.v1.json?v=__STAMP__', { cache: 'no-cache' });
    if (!response.ok) throw new Error('The district data could not load.');
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('The district data is too large.');
    manifest = JSON.parse(text);
    // The eight original businesses, 24 residents and the garage crew must be present; newer lore may add more.
    if (!/^mccluster\.fictional-city\/v\d+$/.test(manifest.schema || '') || !ORIGINAL_BUSINESS_IDS.every(id => manifest.businesses?.some(b => b.id === id)) || !(manifest.npcs?.length >= 24) || manifest.garageCrew?.length !== 3) throw new Error('The district data is incomplete.');
    validateCityExtensions(manifest);
    // Geography is a separate authority. Without it the original district still plays exactly as before.
    try {
      const [placesResponse, indexResponse] = await Promise.all([
        fetch('data/fictional-city/places.v1.json?v=__STAMP__', { cache: 'no-cache' }),
        fetch('data/fictional-city/chunks/index.v1.json?v=__STAMP__', { cache: 'no-cache' })
      ]);
      if (!placesResponse.ok) throw new Error('places');
      places = await placesResponse.json();
      chunkIndex = indexResponse.ok ? await indexResponse.json() : null;
      bound = bindCity(manifest, places);
      manifest = bound.manifest; vacant = bound.vacant;
      const routes = resolveResidentRoutes(bound, createSpatialWorld([...manifest.businesses.filter(b => !b.parcelId), manifest.garage], manifest.district.island?.hq, places));
      if (routes.size) manifest = { ...manifest, npcs: manifest.npcs.map(n => routes.has(n.id) ? { ...n, route: routes.get(n.id), placement: 'patrol' } : n) };
    } catch (error) { places = null; bound = null; vacant = []; chunkIndex = null; console.warn('City geography unavailable; the original district remains playable.', error?.message || error); }
    try { storage = localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('storage'); } }; }
    state = loadState(storage, manifest, places);
    bindControls(); stats(); updateLocation(state.position); persist();
    const neighbors = [manifest.npcs.find(n => n.name === 'Lin Qiao'), manifest.npcs.find(n => n.name === 'Mike Hawk'), manifest.garageCrew.find(n => /Majid/i.test(n.name))].filter(Boolean);
    neighbors.forEach(n => $('city-neighbor-list').append(personButton(n)));
    const ads = manifest.businesses.flatMap(b => (b.ads?.length ? b.ads : [b.tagline]).map(line => ({ brand: b.name, line })));
    let adIndex = 0;
    const rotateAd = () => { const ad = ads[adIndex++ % ads.length]; $('city-ad').textContent = '“' + (typeof ad.line === 'string' ? ad.line : ad.line.text) + '”'; $('city-ad-brand').textContent = ad.brand; };
    rotateAd(); adTimer = setInterval(rotateAd, 18000);
    try {
      const { createCityScene } = await import('./scene.mjs?v=__STAMP__');
      const restoredPosition = { ...state.position };
      scene = createCityScene({
        canvas: $('city-canvas'), manifest, places, vacant, chunkIndex, loadChunk, onInteract: handleTarget,
        onDiscover: id => {
          const before = state.discoveries?.length || 0;
          state = recordDiscovery(state, id, places);
          if ((state.discoveries?.length || 0) > before) {
            const l = places?.landmarks.find(x => x.id === id) || places?.neighborhoods.find(x => x.id === id && x.status === 'new');
            if (l) notify('Found: ' + (neighborhoodName(l.id) || l.name));
            clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300);
          }
        },
        onApproachHq: prefetchHq,
        onPrompt: prompt => {
          $('city-prompt').textContent = prompt?.label || 'Walk up to a door or a neighbor.';
          $('city-interact').disabled = !prompt;
        },
        onMove: updateLocation,
        onReady: () => { $('city-scene-status').hidden = true; $('city-canvas').dataset.ready = 'true'; },
        onError: error => { $('city-scene-status').hidden = false; $('city-scene-status').textContent = 'The 3D street could not open. The district map, shops, dialogue, and story desk still work.'; console.warn('City renderer:', error.message); }
      });
      scene.teleport(restoredPosition);
      syncStoryProgress();
      const entry = new URLSearchParams(location.search).get('entry');
      if (entry === 'garage') moveToBuilding(manifest.garage.id, true);
      else if (entry === 'island') scene.teleport({ x: 0, z: 73, interior: null });
      else if (entry === 'bridgeport' || entry === 'robbery-1s') {
        const arc = storyArcs(manifest).find(a => a.id === 'robbery-1s');
        const next = arc && storyProgress(state, arc).next;
        const spawn = next?.position || neighborhoods(manifest)[0]?.spawn;
        if (spawn) scene.teleport({ x: spawn[0], z: spawn[1], interior: null });
      }
    } catch (error) {
      $('city-scene-status').textContent = 'The 3D street could not open on this device. Use the district map to visit the shops, meet the residents, and open the story desk.';
      console.warn('City renderer unavailable:', error.message);
      const entry = new URLSearchParams(location.search).get('entry');
      if (entry === 'bridgeport' || entry === 'robbery-1s') openArc();
    }
    document.documentElement.dataset.cityReady = 'true';
    // The existing owner session is the only bridge identity. Late or mismatched Core releases cannot replace local canon.
    if (globalThis.MCC?.api) void (async () => {
      const sha256 = await manifestDigest(text);
      if (pageClosed) return;
      coreLink = createCoreLoreLink({
        api: globalThis.MCC.api.bind(globalThis.MCC),
        expected: { id: manifest.id, revision: manifest.revision, sha256 },
        session: () => globalThis.MCC?.session?.()?.access_token || null
      });
      await coreLink.connect();
    })().catch(() => { /* Optional Core availability never prevents the authored city from starting. */ });
    // Read-only diagnostics for support and deterministic browser verification; no auth bypass or state mutator.
    Object.defineProperty(globalThis, 'MCC_CITY', { configurable: true, value: Object.freeze({
      snapshot: () => structuredClone(state), stats: () => scene?.getStats() || null, revision: manifest.revision,
      places: () => places ? { neighborhoods: places.neighborhoods.length, parcels: places.parcels.length, vacant: vacant.length, chunks: chunkIndex?.chunks.length || 0 } : null,
      loreSource: () => coreLink?.status() || 'static'
    }) });
    addEventListener('pagehide', () => { persist(); clearInterval(adTimer); clearTimeout(toastTimer); coreLink?.dispose(); scene?.dispose(); }, { once: true });
  } catch (error) {
    $('city-scene-status').textContent = error.message + ' Reload to try again.';
    $('city-save-note').textContent = 'The city has not started; existing progress has not been changed.';
    console.error('City startup:', error.message);
  }
}
await start();
