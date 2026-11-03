import { loadState, saveState, purchase, recordMeeting, recordVisit } from './state.mjs';
import { createCoreLoreLink, manifestDigest } from './core-link.mjs';

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
let storyCache;
let coreLink;
let pageClosed = false;
let panelGeneration = 0;
const coreResidents = new Map();
addEventListener('pagehide', () => { pageClosed = true; }, { once: true });
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
const dialog = $('city-dialog');
const body = $('city-dialog-body');
const buildings = () => [...manifest.businesses, manifest.garage];
const residents = () => [...manifest.npcs, ...manifest.garageCrew];
const findBuilding = id => buildings().find(b => b.id === id);
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

function markVisit(id) { state = recordVisit(state, id, manifest); persist(); }
function moveToBuilding(id, enter = false) {
  const place = findBuilding(id); if (!place) return;
  closePanel();
  if (scene) {
    scene.teleport({ x: place.entrance[0], z: place.entrance[1], interior: null });
    if (enter) scene.enterBuilding(id);
  } else if (enter) {
    state.position = { x: 0, z: 6, interior: id };
    markVisit(id); openBuilding(id);
  } else {
    state.position = { x: place.entrance[0], z: place.entrance[1], interior: null };
    openBuilding(id);
  }
  markVisit(id);
  if (enter) notify('Inside ' + place.name);
  else notify('Arrived outside ' + place.name + '. Walk to the door or press E.');
  updateLocation(state.position);
  if (scene) $('city-canvas').focus({ preventScroll: true });
}

function updateLocation(position) {
  state.position = position;
  const inside = position.interior && findBuilding(position.interior);
  $('city-location').textContent = inside ? inside.name : position.z > 48 ? 'Equity Uprise Island' : 'Harbor Boulevard';
  $('city-exit').hidden = !inside;
  if (inside) state = recordVisit(state, inside.id, manifest);
  clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500);
}
function openBuilding(id) {
  const place = findBuilding(id); if (!place) return;
  const root = panel(place.category || 'The garage', place.name);
  root.append(el('p', place.tagline, 'city-quote'), el('p', place.description), el('p', place.backstory));
  const actions = el('div', undefined, 'city-dialog-actions');
  actions.append(button('Walk inside', () => moveToBuilding(id, true), 'city-primary'));
  if (place.itemIds?.length) actions.append(button('Browse the counter', () => openShop(id)));
  if (id === manifest.garage.id) actions.append(button('Open the story desk', () => openStory()), button('Open the transportation globe', () => openTravel()));
  root.append(actions, el('h3', 'The people here'));
  for (const personId of place.staffIds) {
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
  if (person.businessId === manifest.garage.id) actions.append(button('Whip Equipped story desk', openStory, 'city-primary'));
  actions.append(button('See you around', closePanel)); root.append(actions);
}
function openShop(id) {
  const place = findBuilding(id); if (!place) return;
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
function drawMap() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 350 390'); svg.setAttribute('class', 'city-map');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Two shopping blocks around Harbor Boulevard. Garage to the north; a bridge reaches Equity Uprise island to the south.');
  const shape = (tag, attrs, label) => {
    const n = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (label) n.textContent = label; svg.append(n); return n;
  };
  const mx = x => 175 + x * 2.05, mz = z => 125 + z * 2.05;
  shape('rect', { x: 18, y: 3, width: 314, height: 229, rx: 9, fill: '#e9e4cf' });
  shape('rect', { x: 22, y: 105, width: 306, height: 34, fill: '#73877e' });
  shape('rect', { x: 165, y: 226, width: 20, height: 66, fill: '#e9dfbf' });
  shape('rect', { x: 131, y: 270, width: 88, height: 85, rx: 6, fill: '#e9e4cf' });
  shape('rect', { x: 151, y: 291, width: 48, height: 48, rx: 3, fill: '#47676a' });
  shape('text', { x: 175, y: 367 }, 'EQUITY UPRISE ISLAND');
  const names = ['TEA', 'HORDASH', 'MIKE HAWK', 'ROBBERY 1s', 'HITMAN GEAR', 'CAMERA MEN', 'PRESSURE TV', 'BADDIES'];
  buildings().forEach((place, i) => {
    const x = mx(place.position[0]), y = mz(place.position[1]);
    shape('rect', { x: x - place.size[0], y: y - place.size[1], width: place.size[0] * 2, height: place.size[1] * 2, rx: 3, fill: place.color });
    shape('text', { x, y: y + place.size[1] + 11 }, names[i] || 'WHIP EQUIPPED');
  });
  if (!state.position.interior) {
    shape('circle', { cx: mx(state.position.x), cy: mz(state.position.z), r: 5, fill: '#eb763e', stroke: '#fff', 'stroke-width': 2 });
  }
  return svg;
}
function openMap() {
  const root = panel('Harbor Boulevard & Equity Uprise Island', 'The district');
  root.append(drawMap());
  const grid = el('div', undefined, 'city-card-grid');
  for (const place of buildings()) {
    const card = el('article', undefined, 'city-place-card');
    card.append(el('p', place.category || 'Story hub', 'city-eyebrow'), el('h3', place.name), el('p', place.description));
    const actions = el('div', undefined, 'city-dialog-actions');
    actions.append(button('Go to the door', () => moveToBuilding(place.id)), button('About this spot', () => openBuilding(place.id)));
    card.append(actions); grid.append(card);
  }
  root.append(grid, button('Walk to Equity Uprise Island', () => {
    closePanel(); scene?.teleport({ x: 0, z: 73, interior: null });
    if (!scene) openTravel('equity-uprise-hq');
  }, 'city-primary'));
}
function openResidents() {
  const root = panel('24 new neighbors + the 3-person garage crew', 'City directory');
  for (const place of buildings()) {
    root.append(el('h3', place.name));
    for (const id of place.staffIds) { const p = findResident(id); if (p) root.append(personButton(p)); }
  }
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
function handleTarget(target) {
  if (!target) return;
  if (target.kind === 'npc') openResident(target.id);
  else if (target.kind === 'building') {
    scene.enterBuilding(target.id); markVisit(target.id);
    notify('Inside ' + findBuilding(target.id).name + '. Walk to the counter or talk to the crew.');
  } else if (target.kind === 'counter') {
    if (target.id === manifest.garage.id) openStory(); else openShop(target.id);
  } else if (target.kind === 'portal') openTravel(target.id);
  else if (target.kind === 'exit') scene.exitBuilding();
}
function bindControls() {
  $('city-map-open').addEventListener('click', openMap);
  $('city-garage-open').addEventListener('click', () => moveToBuilding(manifest.garage.id, true));
  $('city-pocket-open').addEventListener('click', openPocket);
  $('city-residents-open').addEventListener('click', openResidents);
  $('city-story-open').addEventListener('click', () => openStory());
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
    if (manifest.schema !== 'mccluster.fictional-city/v1' || manifest.businesses?.length !== 8 || manifest.npcs?.length !== 24 || manifest.garageCrew?.length !== 3) throw new Error('The district data is incomplete.');
    try { storage = localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('storage'); } }; }
    state = loadState(storage, manifest);
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
        canvas: $('city-canvas'), manifest, onInteract: handleTarget,
        onPrompt: prompt => {
          $('city-prompt').textContent = prompt?.label || 'Walk up to a door or a neighbor.';
          $('city-interact').disabled = !prompt;
        },
        onMove: updateLocation,
        onReady: () => { $('city-scene-status').hidden = true; $('city-canvas').dataset.ready = 'true'; },
        onError: error => { $('city-scene-status').hidden = false; $('city-scene-status').textContent = 'The 3D street could not open. The district map, shops, dialogue, and story desk still work.'; console.warn('City renderer:', error.message); }
      });
      scene.teleport(restoredPosition);
      const entry = new URLSearchParams(location.search).get('entry');
      if (entry === 'garage') moveToBuilding(manifest.garage.id, true);
      else if (entry === 'island') scene.teleport({ x: 0, z: 73, interior: null });
    } catch (error) {
      $('city-scene-status').textContent = 'The 3D street could not open on this device. Use the district map to visit the shops, meet the residents, and open the story desk.';
      console.warn('City renderer unavailable:', error.message);
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
