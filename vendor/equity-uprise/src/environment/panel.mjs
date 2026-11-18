/* Public environmental evidence and scoped participation, inside the existing
   World. Auth, membership, approval and capture eligibility remain server-owned. */
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const text = (value, max = 320) => typeof value === 'string' ? value.slice(0, max) : '';
export function safeURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function captureURL(value, assignment, origin = 'https://environment.invalid') {
  if (!uuid(assignment) || typeof value !== 'string') return '';
  try { const u = new URL(value, origin); return u.origin === new URL(origin).origin && u.pathname === '/live-mission.html' && u.searchParams.get('assignment') === assignment ? u.pathname + u.search : ''; } catch { return ''; }
}
export function normalizeFeed(body) {
  if (body?.schema !== 'world-environment/v1' || !Array.isArray(body.events) || !Array.isArray(body.sources)) throw new Error('Environmental data did not return a supported response.');
  const seen = new Set();
  const events = body.events.slice(0, 600).flatMap(row => {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]{0,299}$/.test(row.id || '') || seen.has(row.id) || !safeURL(row.source?.url)) return [];
    seen.add(row.id);
    const mapped = typeof row.lat === 'number' && typeof row.lon === 'number' && Number.isFinite(row.lat) && Number.isFinite(row.lon) && Math.abs(row.lat) <= 90 && Math.abs(row.lon) <= 180;
    return [{ ...row, lat:mapped ? row.lat : null, lon:mapped ? row.lon : null, title: text(row.title, 180), actions: Array.isArray(row.actions) ? row.actions.filter(a => a && typeof a === 'object' && typeof a.id === 'string' && typeof a.title === 'string').slice(0, 8) : [], source: { label: text(row.source.label, 120), url: safeURL(row.source.url) } }];
  });
  return { ...body, events, sources:body.sources.filter(s => s && typeof s === 'object').slice(0, 20), missions: (Array.isArray(body.missions) ? body.missions : []).filter(m => m && uuid(m.id)).slice(0, 200) };
}
export function normalizeAssignments(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).slice(0, 200).flatMap(row => {
    if (!row || !uuid(row.assignment_id) || !uuid(row.mission_id) || seen.has(row.assignment_id) || !['joined','in_progress','submitted','verified','rejected'].includes(row.status)) return [];
    seen.add(row.assignment_id);
    return [{ ...row, title:text(row.title,180), description:text(row.description,2000), event_id:text(row.event_id,300), source:{label:text(row.source?.label,120),url:safeURL(row.source?.url)} }];
  });
}
export function timeLabel(value) {
  const date = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? new Date(date).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' }) : 'Not supplied by provider';
}
/* RELATIVE TIMES BESIDE ABSOLUTE ONES (slice G1, 2026-11-17): how long ago, by the host feed's own rules (now, Nm, Nh, Nd, then a
   short date with its year when it is not this year); a time just ahead of the clock reads "now", never negative. */
const parseTime = value => { const t = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : null; };
export function agoLabel(value, now = Date.now()) {
  const t = parseTime(value);
  if (t === null) return '';
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60); if (min < 60) return min + 'm';
  const hr = Math.floor(min / 60); if (hr < 24) return hr + 'h';
  const day = Math.floor(hr / 24); if (day < 7) return day + 'd';
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}
const timeWithAgo = value => parseTime(value) === null ? 'Not supplied by provider' : `${timeLabel(value)} · ${agoLabel(value)}`;
/* THE LIST, COMPACT BY DEFAULT (release polish, 2026-11-18; review V2-M2): with every feed observation listed above the posts, the
   first post sat 8 screens or more below the feed's row at 390 with the fixtures' 65 observations. The list opens on the few a
   visitor most needs first: the significant observations (the host's rule, what the tour plays) newest first, then the newest of
   the rest, COMPACT_ROWS in all, and the selected row wherever it is; the posts under the panel carry every observation by time,
   newest first. The panel's "Show all N observations" lists every one in place (these first, the rest in the feed's order) and
   collapses again. A row with no time of its own never goes ahead of a dated one. */
export const COMPACT_ROWS = 2;
const COMPACT_SIGNIFICANT = 2;
export function compactRows(rows, { significant = null, selected = '', limit = COMPACT_ROWS } = {}) {
  const list = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
  const isSignificant = typeof significant === 'function' ? row => { try { return significant(row) === true; } catch { return false; } } : () => false;
  const when = row => parseTime(row.observed_at) ?? -Infinity;
  const newest = (a, b) => { const ta = when(a), tb = when(b); return ta === tb ? 0 : ta < tb ? 1 : -1; };
  const head = list.filter(isSignificant).sort(newest).slice(0, Math.min(COMPACT_SIGNIFICANT, limit));
  for (const row of [...list].sort(newest)) { if (head.length >= limit) break; if (!head.includes(row)) head.push(row); }
  const chosen = selected ? list.find(row => row.id === selected) : null;
  if (chosen && !head.includes(chosen)) head.push(chosen);
  return head;
}
/* a provider's time as it gave it (ISO 8601), or null: never guessed, never a fetch time standing in for an event time */
const validTime = value => parseTime(value) === null ? null : value.slice(0, 40);
const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
/* SOURCE HEALTH IN PLAIN WORDS: the Worker's reason codes (docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md, "Source health") and
   the gate's codes, said so a visitor can read them; an unknown code is shown as the code itself, never invented around */
const REASON_WORDS = Object.freeze({ not_configured:'a credential this installation lacks', timeout:'the provider did not answer in time', upstream_error:'the provider refused, failed or answered an error', invalid_data:'the provider answered in a shape that cannot be used', module_policy_unavailable:'the module policy could not be read', module_disabled:'the module is disabled', network:'the network request failed', bad_response:'the answer could not be read', invalid_event:'the event id is not valid' });
export function reasonWords(code) {
  const c = text(code, 40);
  if (!c) return '';
  if (REASON_WORDS[c]) return REASON_WORDS[c];
  const http = /^http_(\d{3})$/.exec(c);
  return http ? 'the provider answered HTTP ' + http[1] : c;
}
/* the globe's layers, as hu:environment-layer-state names them; their words here */
const LAYER_NAMES = Object.freeze({ events:'Events', fires:'Fires', perimeters:'Fire perimeters', alerts:'Alerts', eonet:'Natural events', tides:'Water levels', shakemap:'ShakeMap' });
const LAYER_STATUSES = Object.freeze(['loading', 'available', 'stale', 'unavailable', 'policy', 'off']);
const OBSERVED_LABELS = Object.freeze(['Observed', 'Acquired', 'Sent', 'Captured', 'Reported', 'Computed']);
const owners = new WeakMap(); // host panel -> current mounted instance (audit EQ2)
export function mountEnvironment(w, d, adapter) {
  if (!adapter || typeof adapter.request !== 'function' || typeof adapter.token !== 'function' || typeof adapter.signIn !== 'function') throw new Error('An environmental host adapter is required.');
  const panel = adapter.panel || d.getElementById('wePanel'), frame = adapter.frame || d.getElementById('mnWorldFrame');
  if (!panel || !frame) return;
  const el = (tag, value = '', cls = '') => { const node = d.createElement(tag); node.textContent = value; if (cls) node.className = cls; return node; };
  const button = (label, action) => { const node = el('button', label); node.type = 'button'; node.onclick = action; return node; };
  const link = (label, href) => { const node = el('a', label); node.href = href; node.rel = 'noopener noreferrer'; node.target = '_blank'; return node; };
  const byId = id => panel.querySelector('#'+id);
  const mode = () => adapter.mode?.() || d.documentElement.dataset.worldMode;
  const active = () => mode() === 'environment';
  const send = data => adapter.sendGlobe ? adapter.sendGlobe(data) : frame.contentWindow?.postMessage(data, w.location.origin);
  const listeners = [], docListeners = [];
  const listen = (type, fn) => { w.addEventListener(type,fn);listeners.push([type,fn]); };
  const listenDoc = (type, fn) => { if (typeof d.addEventListener !== 'function') return; d.addEventListener(type,fn);docListeners.push([type,fn]); };
  /* THE ENVIRONMENTAL GLOBE (slice G1, 2026-11-17; docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md, "Client"). The panel speaks to
     the one globe in a fixed order: hu:environment-layers before the pins, on every activation and on hu:globe-ready; layers off then
     pins off when the tab changes and on destroy. The globe fetches its own public layer routes and reports each layer's state back;
     the panel shows that health beside the feed's and hands the feed (never fetched twice) to the host page as one DOM CustomEvent,
     named by the adapter. Significance is the host's pure rule, supplied through the adapter; the panel never derives it itself. */
  const EVENTS_EVENT = typeof adapter.eventsEvent === 'string' && adapter.eventsEvent ? adapter.eventsEvent : 'environment:events';
  const significance = typeof adapter.significance === 'function' ? row => { try { return adapter.significance(row) === true; } catch { return false; } } : null;
  const reducedMotion = () => { try { return w.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch { return false; } };
  const layersMessage = on => ({ type:'hu:environment-layers', on, selected, replay, layers:{ fires:true, perimeters:true, alerts:true, eonet:true, tides:true } });
  const syncLayers = () => send(layersMessage(active()));
  const sendScene = action => send({ type:'hu:environment-scene', action });
  let destroyed = false;
  const instance = Symbol('environment-panel'); owners.set(panel, instance);
  // Every mutation captures the confirming identity and lifecycle generation up front
  // and hands both to the transport, which rechecks them after its own asynchronous
  // credential step and immediately before fetch (audit EQ1).
  const scope = (identity, epoch, current = () => true) => ({ expectedToken: identity, isCurrent: () => !destroyed && epoch === privateEpoch && owners.get(panel) === instance && current() });
  let feed = null, selected = '', search = '', requested = false, feedBusy = false, privateBusy = false, privateEpoch = 0, feedEpoch = 0;
  /* the globe's side: each layer's last reported state, the tour and view states, the replay choice, the visitor's pause (in memory
     for this page session only), the frame's visibility, one autostart per activation, and a selection that lives only on the globe */
  let layerStates = {}, sceneState = null, viewState = { mode:'3d', morphing:false }, replay = null, pausedByVisitor = false, frameVisible = false, tabOpen = false, autostartDone = false, resumeOnShow = false, observer = null, globeSelection = null, lastCode = null, checkedAt = null;
  /* the boot id of the globe that last said ready (undefined: none has yet), and whether the tour, in this opening of the tab, was
     interrupted by the visitor's own hand on the globe or ran to its end (review RV2-1) */
  let globeBoot, tourStopped = false;
  /* the visitor pressed Next or Previous and the scene they stepped to has not arrived yet: that scene is their choice, so it opens
     its card (review of the release polish, RP-1) */
  let stepAsked = false;
  /* the last digest handed to the host page per layer (review G1R-7), and the search's pending pins resend (review G1R-9) */
  const lastDigests = {}; let searchTimer = null;
  const SEARCH_SYNC_MS = 250;
  let proofEpoch=0,proofBusy=false,planningEpoch=0;
  let team = null, oversight = null, proofReviews=null, privateToken = null, abort = null, timer = null, joining = false, saving = false;
  const token = async () => {try{return await adapter.token()||null;}catch{return null;}};
  const sessionCurrent=async(identity,epoch)=>{const value=await token();return !destroyed&&epoch===privateEpoch&&value===identity;};
  panel.innerHTML = '<p class="we-eyebrow">Environmental Justice</p><h2 id="weTitle">See the evidence. Take action.</h2><p class="we-subtle">Government observations, their dates and practical missions on this same globe. An event is not proof of environmental injustice.</p><div class="we-toolbar"><button type="button" id="weRefresh">Refresh sources</button><span class="we-subtle" id="weFreshness"></span></div><p id="weStatus" class="we-message" role="status" aria-live="polite"></p><div class="we-scene" role="group" aria-label="Tour of significant events on the globe"><button type="button" id="wePlay">Play tour</button><button type="button" id="wePrev">Previous</button><button type="button" id="weNext">Next</button><button type="button" id="weReplay" aria-pressed="false">Replay last 24 h of quakes</button><p class="we-subtle we-scene-status" id="weSceneStatus" role="status" aria-live="polite"></p></div><div class="we-view" role="group" aria-label="Map view"><button type="button" id="weView2d" aria-pressed="false">2D map</button><span class="we-subtle">The list below works without the globe.</span></div><section class="we-team" id="weTeam" aria-label="Environmental Justice Team"></section><section id="weAssignments" class="we-team" aria-label="Your environmental missions" hidden data-private></section><section id="wePlanning" class="we-detail" aria-label="Owner news and sponsorship planning" hidden data-private></section><section id="weProof" class="we-detail" aria-label="Mission evidence" hidden data-private></section><section id="weDetail" class="we-detail" aria-label="Selected environmental observation" hidden></section><label class="we-filter">Find an observation<input id="weSearch" type="search" placeholder="Place or event" maxlength="120"></label><p id="weCount" class="we-subtle"></p><ul class="we-list" id="weEvents" aria-label="Observations"></ul><button type="button" id="weMore" class="we-more" hidden></button><details><summary>Sources, coverage and limitations</summary><p class="we-subtle" id="weLayersNote" role="status" hidden></p><ul class="we-health" id="weSources"></ul><p class="we-subtle">No marker does not mean a place is safe. Coverage and reporting delays vary. These feeds do not measure every pollutant, establish responsibility or replace official emergency instructions.</p></details><section id="weOwner" class="we-owner" aria-label="Owner mission oversight" hidden data-private></section>';
  const status = message => { if (!destroyed) byId('weStatus').textContent = message; };
  const signIn = () => adapter.signIn();
  const request = (path, options = {}) => adapter.request(path, options);
  /* a pin item: the public fields the globe always had (id, title, lat, lon, stale) and, only when the normalized row carries them,
     its category, location kind, source, times and facts, plus the host's significance flag (never a private row, never an
     assignment, never a person) */
  function pinItem(row) {
    const item = { id:row.id, title:row.title, lat:row.lat, lon:row.lon, stale:row.stale };
    if (typeof row.category === 'string') item.category = text(row.category, 40);
    if (typeof row.location_kind === 'string') item.location_kind = text(row.location_kind, 20);
    if (row.source && typeof row.source === 'object') item.source = { label:text(row.source.label, 120), url:safeURL(row.source.url) };
    if ('observed_at' in row) item.observed_at = validTime(row.observed_at);
    if ('fetched_at' in row) item.fetched_at = validTime(row.fetched_at);
    if (Array.isArray(row.facts)) item.facts = row.facts.filter(f => f && typeof f.label === 'string' && typeof f.value === 'string').slice(0, 16).map(f => ({ label:text(f.label, 80), value:text(f.value, 320) }));
    if (significance) item.significant = significance(row);
    return item;
  }
  /* the feed providers' terms as the feed's own source records give them (id, label, url, attribution, licence, coverage): they ride
     with the pins so the globe answers a feed item's selection in the Worker's words and keeps no copy of its own (review G1R-10) */
  const sourceTerms = s => s && typeof s.id === 'string' && s.id ? { id:text(s.id, 40), label:text(s.label, 120), url:safeURL(s.url), attribution:text(s.attribution, 200), license:text(s.license, 200), coverage:text(s.coverage, 300) } : null;
  function syncPins() {
    const on = active(), message = { type:'hu:environment-pins', on, selected, items:on && feed ? feed.events.filter(matches).filter(row => row.lat !== null && row.lon !== null).map(pinItem) : [] };
    if (on && feed) message.sources = feed.sources.map(sourceTerms).filter(Boolean).slice(0, 8);
    send(message);
  }
  const matches = row => !search || [row.title, row.category, row.source.label].join(' ').toLocaleLowerCase().includes(search);
  /* fromGlobe: the globe made this selection itself and said so (hu:environment-selected), so the panel follows it and sends no
     pins back (release polish, 2026-11-18, the Show on globe flip the G1 close-out left): pins carrying a selection the globe
     answers in turn (its ShakeMap read tells a quake the pins selected) let two selections echo between panel and globe for as
     long as the page was open, the globe going back and forth between the event the visitor clicked and the one before it */
  function select(id, fly, fromGlobe) {
    if (!feed?.events.some(row => row.id === id)) return;
    adapter.revealPanel?.();
    globeSelection = null; selected = id; renderDetail(); renderList(); if (!fromGlobe) syncPins();
    if (fly && feed.events.find(row => row.id === id)?.lat !== null) send({ type:'hu:environment-focus', id });
    byId('weDetail').scrollIntoView?.({ block:'nearest', behavior:'auto' });
  }
  /* the list opens compact (compactRows above); the toggle under it lists every observation in place and collapses again. It stays
     the accessible alternative to the globe: a button that says what it does and whether the list is open (aria-expanded,
     aria-controls), opening moves the focus to the first row it revealed, closing keeps it on the toggle.
     THE OPEN LIST HOLDS STILL (review of the release polish, RP-2): the rows the compact list showed when the toggle opened it lead
     the full list, in the order they had, and the rest follow in the feed's order; choosing a row, or the globe choosing one, never
     moves a row of the open list (the few used to be worked out again around the new selection, so a row chosen deep in the list
     jumped to third place under a keyboard or screen-reader user). A row that has the focus keeps it through every re-render of the
     list (the visitor's own choice, the globe's answer to it, a refresh), so the focus never drops to the page. */
  let listOpen = false, openLead = [], shownIds = [];
  const rowButtons = new Map();
  function renderList() {
    const list = byId('weEvents'), more = byId('weMore');
    let focusedId = null;
    for (const [id, control] of rowButtons) if (control === d.activeElement) { focusedId = id; break; }
    list.replaceChildren(); rowButtons.clear();
    const rows = feed?.events.filter(matches) || [];
    const head = compactRows(rows, { significant: significance, selected }), compact = !listOpen && rows.length > head.length;
    const lead = listOpen ? openLead.map(id => rows.find(row => row.id === id)).filter(Boolean) : head;
    const shown = compact ? head : lead.concat(rows.filter(row => !lead.includes(row)));
    shownIds = shown.map(row => row.id);
    const marked = significance ? head.slice(0, COMPACT_ROWS).filter(row => significance(row)).length : 0;
    const limited = feed?.truncated ? ' (source results limited)' : '', few = !marked ? 'the most recent' : marked === Math.min(COMPACT_ROWS, head.length) ? 'the significant ones, newest first' : 'the significant ones first, then the most recent';
    byId('weCount').textContent = !feed ? '' : compact ? `Showing ${shown.length} of ${rows.length} observations: ${few}${head.length > COMPACT_ROWS ? ', and the one selected' : ''}${limited}. Select one here or on the globe.` : `${rows.length} observations shown${limited}. Select one here or on the globe.`;
    more.hidden = rows.length <= head.length;
    more.textContent = listOpen ? 'Show fewer observations' : `Show all ${rows.length} observations`;
    more.setAttribute('aria-controls', 'weEvents'); more.setAttribute('aria-expanded', String(listOpen));
    for (const row of shown) {
      const item = el('li'), control = button('', () => select(row.id, true));
      control.setAttribute('aria-pressed', String(selected === row.id));
      control.append(el('strong', row.title), el('small', `${row.category || 'Observation'} · ${row.source.label}${row.stale ? ' · Older observation' : ''}`), el('small', `Observed: ${timeWithAgo(row.observed_at)}`));
      item.append(control); list.append(item); rowButtons.set(row.id, control);
    }
    if (feed && !rows.length) list.append(el('li', search ? 'No observations match this search.' : 'No observations returned. Check source availability below.'));
    /* without scrolling: the card a choice opens is scrolled into view by select(), as before */
    if (focusedId !== null) rowButtons.get(focusedId)?.focus?.({ preventScroll: true });
  }
  /* PER-SOURCE HEALTH (target 11: "shows each source's health and last success, says plainly when its sources are unavailable"):
     one row per feed source and one per globe layer that has reported, each with its status, the reason in plain words, when the
     served copy was retrieved and the last success the Worker knows of (each with how long ago; "never known" is never guessed
     around), its coverage, attribution and licence, and the provider's public page. A fetch time is never shown as an
     observation time. */
  const alertCounts = c => `${num(c.polygon) ?? 0} with their own polygon · ${num(c.zone_only) ?? 0} name zones only (listed, never placed) · ${num(c.rejected) ?? 0} rejected`;
  const healthHead = (item, title, status) => { const head = el('p'), word = text(status, 20), state = el('span', word || 'Availability unknown', 'we-status'); state.setAttribute('data-status', word || 'unknown'); head.append(el('strong', title), state); item.append(head); };
  /* a layer's own counts: how many of how many it shows, and an alert layer's placed, zone-only and rejected */
  function countsLine(item, layer) {
    const shown = layer.count !== null && layer.total !== null ? `${layer.count} of ${layer.total} shown${layer.truncated ? ' (results limited)' : ''}` : '';
    const counts = layer.layer === 'alerts' && layer.digest?.counts && typeof layer.digest.counts === 'object' ? alertCounts(layer.digest.counts) : '';
    const line = [shown, counts].filter(Boolean).join(' · ');
    if (line) item.append(el('p', line, 'we-subtle'));
  }
  /* one record's health: status (beside the title), reason in plain words, coverage, Retrieved and Last success with how long ago,
     the observation time a feed source reports, attribution and licence, and the provider's page */
  function healthBody(item, h, observed) {
    const why = reasonWords(h.reason);
    if (why) item.append(el('p', `Reason: ${why}`, 'we-subtle'));
    if (text(h.coverage, 300)) item.append(el('p', text(h.coverage, 300), 'we-subtle'));
    item.append(el('p', `Retrieved${parseTime(h.fetched_at) === null ? ': Not supplied by provider' : ' ' + timeWithAgo(h.fetched_at)} · Last success${parseTime(h.last_success_at) === null ? ': never known' : ' ' + timeWithAgo(h.last_success_at)}`, 'we-subtle'));
    if (observed && parseTime(h.observed_at) !== null) item.append(el('p', `Latest observation ${timeWithAgo(h.observed_at)}`, 'we-subtle'));
  }
  function healthTerms(item, h) {
    const terms = [text(h.attribution, 200), text(h.license, 200)].filter(Boolean).join(' · ');
    if (terms) item.append(el('p', terms, 'we-subtle'));
    if (safeURL(h.url)) item.append(link('Source page', safeURL(h.url)));
  }
  function healthRow(title, h) {
    const item = el('li');
    healthHead(item, title, h.status); healthBody(item, h, true); healthTerms(item, h);
    return item;
  }
  /* A GLOBE LAYER'S ROW RENDERS EVERY SOURCE RECORD IT CARRIES (review G1R-3): the water levels' station catalogue and readings, a
     ShakeMap's event detail and contours, one satellite each for the fires, each with its own status, reason, Retrieved and Last
     success, so a reading is never shown as retrieved before it was observed and no record speaks for another; the layer's status
     and counts head the row. A layer that reported no record (the gate refused, the route failed, still loading) is said in the
     layer's own words. */
  function layerRow(layer, s) {
    const item = el('li');
    healthHead(item, LAYER_NAMES[layer], s.status);
    if (!s.sources.length) {
      healthBody(item, s, false); countsLine(item, s); healthTerms(item, s);
      return item;
    }
    countsLine(item, s);
    const own = ['available', 'stale', 'unavailable'].includes(s.status), records = el('ul', '', 'we-records');
    for (const r of s.sources) {
      const row = el('li');
      healthHead(row, r.label || 'Source', own && LAYER_STATUSES.includes(r.status) ? r.status : s.status);
      healthBody(row, r, false); healthTerms(row, r);
      records.append(row);
    }
    item.append(records);
    return item;
  }
  function renderSources() {
    if (destroyed) return;
    const list = byId('weSources'); list.replaceChildren();
    for (const source of feed?.sources || []) list.append(healthRow(text(source.label, 120) || 'Source', source));
    for (const layer of Object.keys(LAYER_NAMES)) {
      const s = layerStates[layer]; if (!s) continue;
      list.append(layerRow(layer, s));
    }
    const refused = Object.values(layerStates).find(s => s.status === 'policy'), note = byId('weLayersNote');
    note.hidden = !refused; note.textContent = refused ? `Environmental layers are not available right now (${reasonWords(refused.reason) || 'the module refused'}).` : '';
  }
  /* a layer state as the globe sends it, kept only in the shape the contract names; every string clipped, every time as given */
  function cleanLayerState(data) {
    if (!LAYER_NAMES[data.layer] || !LAYER_STATUSES.includes(data.status)) return null;
    const sources = (Array.isArray(data.sources) ? data.sources : []).slice(0, 8).filter(s => s && typeof s === 'object').map(s => ({ id:text(s.id, 40), label:text(s.label, 120), status:text(s.status, 20), reason:text(s.reason, 40) || null, fetched_at:validTime(s.fetched_at), last_success_at:validTime(s.last_success_at), coverage:text(s.coverage, 300), attribution:text(s.attribution, 200), license:text(s.license, 200), url:safeURL(s.url) }));
    return { layer:data.layer, status:data.status, reason:text(data.reason, 40) || null, http:num(data.http), schema:text(data.schema, 60) || null, generated_at:validTime(data.generated_at), fetched_at:validTime(data.fetched_at), last_success_at:validTime(data.last_success_at), coverage:text(data.coverage, 300), attribution:text(data.attribution, 200), license:text(data.license, 200), url:safeURL(data.url), source_id:text(data.source_id, 80) || null, label:text(data.label, 120), count:num(data.count), total:num(data.total), truncated:data.truncated === true, sources, digest:data.digest && typeof data.digest === 'object' && !Array.isArray(data.digest) ? data.digest : null };
  }
  /* the digests the host page turns into posts (fire areas, the largest perimeters) and lists (alert counts, a ShakeMap's presence);
     a digest's label is the layer's own (the globe names the record or records its fields came from: review G1R-3; the fires, which
     the Worker sums from both satellites, name every satellite that served them: review RV2-3), else that of the record source_id
     names, so the label, link, coverage and terms of a post always speak for the same records */
  function layerDigests() {
    const out = {};
    for (const [layer, s] of Object.entries(layerStates)) {
      const g = s.digest, first = (s.source_id && s.sources.find(r => r.id === s.source_id)) || s.sources[0] || {};
      const base = { status:s.status, reason:s.reason, fetched_at:s.fetched_at ?? first.fetched_at ?? null, label:s.label || first.label || '', url:s.url || first.url || '', coverage:s.coverage || first.coverage || '', attribution:s.attribution || first.attribution || '', license:s.license || first.license || '' };
      if (layer === 'fires') out.fires = { ...base, generated_at:s.generated_at, cell_degrees:1, cells:g && Array.isArray(g.cells) ? g.cells.slice(0, 10).filter(c => Array.isArray(c) && c.length >= 6).map(c => [num(c[0]), num(c[1]), num(c[2]), num(c[3]), num(c[4]), validTime(c[5])]) : [] };
      else if (layer === 'perimeters') out.perimeters = { ...base, top:g && Array.isArray(g.top) ? g.top.slice(0, 10).filter(r => r && typeof r === 'object').map(r => ({ id:text(r.id, 300), name:text(r.name, 120), gis_acres:num(r.gis_acres), polygon_captured_at:validTime(r.polygon_captured_at), last_edited_at:validTime(r.last_edited_at), discovered_at:validTime(r.discovered_at), lon:num(r.lon), lat:num(r.lat) })) : [] };
      else if (layer === 'alerts') out.alerts = { status:s.status, counts:g && g.counts && typeof g.counts === 'object' ? { polygon:num(g.counts.polygon) ?? 0, zone_only:num(g.counts.zone_only) ?? 0, rejected:num(g.counts.rejected) ?? 0 } : null };
      else if (layer === 'shakemap') out.shakemap = g ? { event_id:text(g.event_id, 40), available:g.available === true } : null;
      else if (layer === 'tides' || layer === 'eonet') out[layer] = { status:s.status };
    }
    return out;
  }
  function onLayerState(data) {
    const state = cleanLayerState(data); if (!state) return;
    layerStates[state.layer] = state;
    renderSources();
    /* a ShakeMap for a quake in the feed marks that row, so the host's significance rule and the pins see it */
    let marked = false;
    if (state.layer === 'shakemap' && state.digest && state.digest.available === true) {
      const row = feed?.events.find(r => r.id === 'usgs:' + text(state.digest.event_id, 40));
      if (row && row.shakemap_available !== true) { row.shakemap_available = true; syncPins(); marked = true; }
    }
    /* the host page is told again only when what it receives for that layer changed from the last one handed on (the whole entry
       layerDigests() builds: the digest's rows with the layer's status, reason, retrieval, label, link, coverage and terms), or when
       it just marked a feed row (a freshly loaded feed has lost the mark): a tour re-selecting a quake, or a refresh whose words did
       not change, repaints nothing there (review G1R-7), while a layer gone stale with the same rows still reaches every post that
       carries its status (review RV2-2) */
    if (state.digest) { const key = JSON.stringify(layerDigests()[state.layer] ?? null); if (marked || lastDigests[state.layer] !== key) { lastDigests[state.layer] = key; dispatchEvents(); } }
  }
  /* THE FEED, HANDED TO THE HOST PAGE ONCE (target 13: nothing is fetched twice): after every load, success or failure, after every
     layer state whose digest changed (or marked a feed row), and on destroy. The detail says plainly when the gate refused and which
     code it answered. */
  function dispatchEvents(code) {
    if (destroyed && code !== 'off') return;
    const sources = feed ? feed.sources : [];
    const newest = sources.filter(s => s && parseTime(s.fetched_at) !== null).sort((a, b) => parseTime(b.fetched_at) - parseTime(a.fetched_at))[0];
    const detail = { events:feed ? feed.events : [], sources, fetched_at:newest ? newest.fetched_at : null, checked_at:checkedAt, unavailable:!feed, code:code || (feed ? null : lastCode), layers:layerDigests() };
    const Ev = w.CustomEvent || (typeof CustomEvent === 'function' ? CustomEvent : null);
    if (!Ev || typeof w.dispatchEvent !== 'function') return;
    try { w.dispatchEvent(new Ev(EVENTS_EVENT, { detail })); } catch {}
  }
  function assignmentFor(id) { return normalizeAssignments(team?.assignments).find(a => a.mission_id === id); }
  /* SELECTED ON THE GLOBE (the contract's hu:environment-selected for an item that is not a feed row: a fire detection or area, a
     perimeter, a water-level station, a ShakeMap contour): the item's own time under its own label (Acquired, Sent, Captured,
     Reported, Observed, Computed), the retrieval time as "Retrieved", coverage, status and reason, the facts, the source, and the
     words the globe owes a visitor: a modelled reading is said to be modelled, an illustrative animation to be illustrative. A
     provider that gave no time gets "Time not supplied by provider", never the fetch time. */
  function cleanSelection(data) {
    const s = data.source && typeof data.source === 'object' ? data.source : {};
    return { id:text(data.id, 300), layer:text(data.layer, 20), kind:text(data.kind, 20), title:text(data.title, 180) || 'Selected on the globe',
      facts:(Array.isArray(data.facts) ? data.facts : []).filter(f => f && typeof f.label === 'string' && typeof f.value === 'string').slice(0, 16).map(f => ({ label:text(f.label, 80), value:text(f.value, 320) })),
      source:{ label:text(s.label, 120), url:safeURL(s.url), attribution:text(s.attribution, 200), license:text(s.license, 200) },
      observed_at:validTime(data.observed_at), observed_label:OBSERVED_LABELS.includes(data.observed_label) ? data.observed_label : 'unknown', observed_date_only:data.observed_date_only === true,
      fetched_at:validTime(data.fetched_at), coverage:text(data.coverage, 300), status:text(data.status, 20) || 'unknown', reason:text(data.reason, 40) || null, modelled:data.modelled === true, illustrative:text(data.illustrative, 120) };
  }
  function paintGlobeSelection(box) {
    const s = globeSelection; box.hidden = false; box.replaceChildren();
    box.append(button('Close selection', () => { globeSelection = null; renderDetail(); }), el('p', 'Selected on the globe', 'we-eyebrow'), el('h3', s.title));
    const facts = el('dl'), add = (k, v) => facts.append(el('dt', k), el('dd', v));
    add(s.observed_label === 'unknown' ? 'Time' : s.observed_label, !s.observed_at ? 'Time not supplied by provider' : s.observed_date_only ? new Date(s.observed_at).toLocaleDateString(undefined, { dateStyle:'medium' }) + ' · date only (time of day not reported)' : timeWithAgo(s.observed_at));
    add('Retrieved', s.fetched_at ? timeWithAgo(s.fetched_at) : 'Not supplied by provider');
    if (s.coverage) add('Coverage', s.coverage);
    add('Status', s.status + (s.reason ? ` (${reasonWords(s.reason)})` : ''));
    for (const f of s.facts) add(f.label, f.value);
    if (s.modelled) add('Reading', 'Modelled, not measured: a model estimate published by the source, versioned by it.');
    if (s.illustrative) add('Animation', s.illustrative);
    if (s.source.url || s.source.label) { const dd = el('dd'); if (s.source.url) dd.append(link(s.source.label || 'Source', s.source.url)); else dd.textContent = s.source.label; facts.append(el('dt', 'Source'), dd); }
    const terms = [s.source.attribution, s.source.license].filter(Boolean).join(' · ');
    if (terms) add('Attribution', terms);
    box.append(facts, el('p', 'A report is not proof of environmental injustice. Follow local official instructions.', 'we-subtle'));
  }
  function renderDetail() {
    if (destroyed) return;
    const box = byId('weDetail'), row = feed?.events.find(row => row.id === selected);
    if (!row && globeSelection) { paintGlobeSelection(box); return; }
    box.hidden = !row; box.replaceChildren(); if (!row) return;
    box.append(button('Close observation', () => { selected = ''; renderDetail(); renderList(); syncPins(); }), el('p', text(row.category, 80), 'we-eyebrow'), el('h3', row.title));
    const facts = el('dl');
    for (const [key,value] of [['Observed',timeWithAgo(row.observed_at)],['Retrieved',timeWithAgo(row.fetched_at)],['Freshness',row.stale ? 'Older observation. Verify current official guidance.' : 'Provider observation. Not a continuous live feed.']]) facts.append(el('dt',key),el('dd',value));
    for (const fact of (Array.isArray(row.facts) ? row.facts : []).slice(0,16)) {
      if (fact && typeof fact.label==='string' && typeof fact.value==='string') facts.append(el('dt',text(fact.label,80)),el('dd',text(fact.value,320)));
    }
    facts.append(el('dt','Source'), (() => { const value=el('dd');value.append(link(row.source.label,row.source.url));return value; })()); box.append(facts);
    if (row.instructions) box.append(el('h4','Official instructions'),el('p',text(row.instructions,2000)));
    if (row.description) box.append(el('p',text(row.description,2000)));
    box.append(el('p', row.lat === null ? 'This report has no mapped point. Read the source for the affected area.' : row.location_kind === 'area_label' ? 'Marker labels a boundary of the reported area, not a precise incident location.' : 'Marker is the provider’s reported location; verify the affected area in the source.', 'we-subtle'));
    box.append(el('p','Stay out of restricted or hazardous areas. Do not handle debris, sample unknown substances, interrupt responders or record people without permission. Follow local emergency instructions.', 'we-safety'));
    box.append(el('h4','Useful work you can do'));
    for (const action of row.actions) {
      const card = el('article'); card.append(el('h4',text(action.title,180)),el('p',text(action.description,900)),el('p','Evidence: '+text(action.proof,500),'we-subtle'),el('p',text(action.safety,700),'we-subtle'));
      const mission = feed.missions.find(m => m.event_id === row.id && m.action_id === action.id && m.status === 'open');
      if (mission) {
        const assignment = assignmentFor(mission.id);
        if (assignment) {
          card.append(el('p','Your mission: '+text(assignment.status,60)));
          card.append(button('View your saved mission',()=>byId('weAssignments').scrollIntoView?.({block:'nearest',behavior:'auto'})));
        } else card.append(button('Join approved mission', () => joinMission(mission)));
      } else {
        const propose = button('Suggest this mission for review', () => proposeMission(row, action)); propose.disabled = saving; card.append(propose,el('p','A suggestion is reviewed by the owner before anyone can join.','we-subtle'));
      }
      if(oversight)card.append(button('Review daily news context',()=>openPlanning(row,action)));
      box.append(card);
    }
    if (feed.missions_unavailable) box.append(el('p','Mission availability could not be verified. Refresh to check again.','we-subtle'));
  }
  function renderAssignments() {
    if (destroyed) return;
    const box=byId('weAssignments');box.replaceChildren();box.hidden=!privateToken;
    if (!privateToken) return;
    box.append(el('h3','Your missions'),el('p','Your saved assignments stay here even when an observation leaves the feed. They are not shown to other visitors.','we-subtle'));
    if (!team) { box.append(el('p','Saved missions could not be confirmed. Check membership to try again.')); return; }
    const assignments=normalizeAssignments(team.assignments);
    if (!assignments.length) box.append(el('p','No saved environmental missions yet. Select an observation to find approved work or suggest a mission for review.'));
    if (team.assignments_limited) box.append(el('p','Showing your 200 most recent assignments. Older assignments remain saved.','we-subtle'));
    for (const assignment of assignments) {
      const card=el('article');
      card.append(el('h4',assignment.title || 'Environmental mission'),el('p','Your mission: '+text(assignment.status,60)));
      card.append(el('p','Mission availability: '+(text(assignment.mission_status,60) || 'Not confirmed'),'we-subtle'));
      if (assignment.description) card.append(el('p',assignment.description));
      if (assignment.source.url) card.append(link('Saved source: '+(assignment.source.label || 'Official report'),assignment.source.url),el('p','Observation saved with this mission: '+timeLabel(assignment.observed_at)+'. This is a historical source snapshot, not current conditions.','we-subtle'));
      if(safeURL(assignment.news_context?.url))card.append(el('h4','Reviewed news context'),el('p',text(assignment.news_context.title,1000)),link('Read reported news context',safeURL(assignment.news_context.url)),el('p','Reported headline claim, not verified environmental fact. GDELT seen time: '+timeLabel(assignment.news_context.seen_at),'we-subtle'));
      if (assignment.ends_at) card.append(el('p','Mission end: '+timeLabel(assignment.ends_at),'we-subtle'));
      if (feed?.events.some(row=>row.id===assignment.event_id)) card.append(button('View current observation',()=>select(assignment.event_id,true)));
      else card.append(el('p','This observation is not in the current feed. Check the official source before acting; your assignment has not been deleted.','we-subtle'));
      const href=captureURL(assignment.capture_path,assignment.assignment_id,w.location.origin);
      if (href) {
        const capture=link('Check recording availability',href);capture.removeAttribute('target');card.append(capture);
        card.append(el('p','This opens setup only. Service availability, permission and consent are checked separately. Nothing starts automatically.','we-subtle'));
      } else card.append(el('p',assignment.mission_status==='paused'||assignment.mission_status==='closed' ? 'This mission is paused or closed. Review its status before doing more work. Recording setup is not offered here.' : ['submitted','verified'].includes(assignment.status) ? 'Your work is saved for review or already verified. No new recording is needed here.' : 'Recording availability has not been confirmed.','we-subtle'));
      card.append(button('Open mission evidence',()=>openProof(assignment)));
      box.append(card);
    }
  }
  function closePlanning(){planningEpoch++;const box=byId('wePlanning');box.hidden=true;box.replaceChildren();}
  async function openPlanning(row,action){
    if(destroyed||!oversight)return;
    const epoch=++planningEpoch,identityEpoch=privateEpoch,identity=await token();
    if(destroyed||epoch!==planningEpoch||identityEpoch!==privateEpoch||!identity)return;
    const box=byId('wePlanning');box.hidden=false;box.replaceChildren(el('h3','Reviewed news and partnership preparation'),el('p','Loading retained headlines…'));box.scrollIntoView?.({block:'nearest'});
    const current=()=>!destroyed&&epoch===planningEpoch&&identityEpoch===privateEpoch;
    const currentIdentity=async()=>{const value=await token();return current()&&value===identity;};
    const call=(operation,body)=>request('/planning/'+operation,{method:'POST',auth:true,...scope(identity,identityEpoch,current),body:{eventId:row.id,actionId:action.id,...body}});
    try{
      const context=await call('context',{});if(!await currentIdentity())return;
      box.replaceChildren(button('Close planning',closePlanning),el('h3','Reviewed news and partnership preparation'),el('p',row.title));
      box.append(el('p',text(context.coverage,500)||'A bounded daily GDELT candidate pool, not automatic geographic or factual verification.','we-subtle'),el('p','Review the linked report and its relevance. Headlines are reported claims, not proof of environmental injustice. Approval here permits this news context only; a mission still needs a separate owner decision.','we-safety'));
      const statusLine=el('p','','we-message');statusLine.setAttribute('role','status');box.append(statusLine);
      const reviewed=el('section');reviewed.append(el('h4','Currently reviewed context'));
      for(const item of context.reviewed||[]){
        if(!uuid(item.review_id))continue;
        const card=el('article');card.append(el('p',text(item.title,1000)));
        if(safeURL(item.canonical_url))card.append(link('Read reviewed report',safeURL(item.canonical_url)));
        card.append(button('Suggest mission with this context',()=>proposeMission(row,action,item.review_id)));reviewed.append(card);
      }
      if(!context.reviewed?.length)reviewed.append(el('p','No current reviewed headline context is available for this observation.'));box.append(reviewed);
      const candidates=el('details');candidates.append(el('summary','Review daily headline candidates'));
      for(const article of (context.articles||[]).filter(a=>a.within_daily_window).slice(0,100)){
        const card=el('article');card.append(el('h4',text(article.title,1000)),el('p','GDELT seen time: '+timeLabel(article.seen_at)+'. Publisher publication time is not verified.','we-subtle'));
        if(safeURL(article.canonical_url))card.append(link('Inspect publisher report',safeURL(article.canonical_url)));
        const label=el('label','Why is this report relevant to the selected observation?'),rationale=el('textarea');rationale.rows=3;rationale.maxLength=2000;label.append(rationale);card.append(label);
        const approve=button('Approve this headline context',async()=>{
          if(approve.disabled||!current())return;if(!rationale.value?.trim()){statusLine.textContent='Explain relevance before approving a headline.';return;}
          if(!w.confirm('Approve this exact headline as context for the selected observation? This does not approve a mission or send outreach.'))return;
          approve.disabled=true;
          try{const result=await call('review',{articleId:article.id,revision:article.revision,headlineExcerpt:article.title,rationale:rationale.value.trim()});if(!await currentIdentity())return;if(!uuid(result.review_id))throw Error('Review was not confirmed.');status('News context review saved.');await openPlanning(row,action);}
          catch(error){if(await currentIdentity())statusLine.textContent=error.message||'Review was not confirmed. Reload before retrying.';}
          finally{approve.disabled=false;}
        });card.append(approve);candidates.append(card);
      }
      box.append(candidates);
      const sponsors=el('section');sponsors.append(el('h4','Potential sponsor preparation'),el('p','Candidates come from your existing CRM. Matching notes are only a hypothesis about fit. No recipient, consent, partnership, payment or outreach is established.','we-subtle'));
      const sponsorResults=el('div');
      const load=button('Find CRM sponsor candidates',async()=>{
        if(load.disabled||!current())return;load.disabled=true;
        try{const result=await call('companies',{});if(!await currentIdentity())return;sponsorResults.replaceChildren();
          for(const company of result.companies||result.candidates||[]){
            const card=el('article');card.append(el('h4',text(company.name,300)),el('p',text(company.alignmentExcerpt||company.alignment_excerpt,1500),'we-subtle'));
            const draftResult=el('div');
            const draft=button('Prepare partnership draft',async()=>{
              if(draft.disabled||!current())return;draft.disabled=true;
              try{const value=await call('sponsor-draft',{companyId:company.company_id||company.id,alignmentExcerpt:company.alignmentExcerpt||company.alignment_excerpt});if(!await currentIdentity())return;draftResult.replaceChildren(el('h4',text(value.subject,1000)),el('p',typeof value.body==='string'?value.body:'','we-draft'),el('p',text(value.citation_limitation,500),'we-subtle'),el('p','Draft only. No recipient selected and nothing sent. Obtain approval for a specific recipient, final content and any commitment before outreach.','we-safety'));}
              catch(error){if(await currentIdentity())statusLine.textContent=error.message||'Draft could not be prepared.';}
              finally{draft.disabled=false;}
            });card.append(draft,draftResult);sponsorResults.append(card);
          }
          if(!(result.companies||result.candidates||[]).length)statusLine.textContent='No evidenced CRM match was found for this reviewed context. No fit has been invented.';
        }catch(error){if(await currentIdentity())statusLine.textContent=error.message||'Sponsor candidates could not be checked.';}
        finally{load.disabled=false;}
      });sponsors.append(load,sponsorResults);box.append(sponsors);
    }catch(error){if(await currentIdentity())box.replaceChildren(button('Close planning',closePlanning),el('p',error.message||'News planning is unavailable. No review or mission was saved.'));}
  }
  function closeProof() { proofEpoch++;const box=byId('weProof');box.hidden=true;box.replaceChildren(); }
  async function openProof(assignment) {
    if(destroyed||proofBusy||!privateToken)return;
    const epoch=++proofEpoch,identityEpoch=privateEpoch,identity=await token();
    if(destroyed||epoch!==proofEpoch||identityEpoch!==privateEpoch||!identity)return;
    const box=byId('weProof');box.hidden=false;box.replaceChildren(el('h3','Mission evidence'),el('p','Loading your saved evidence…'));
    box.scrollIntoView?.({block:'nearest'});
    const requestScope=scope(identity,identityEpoch,()=>epoch===proofEpoch);
    const current=async()=>{const value=await token();return !destroyed&&epoch===proofEpoch&&identityEpoch===privateEpoch&&identity===value;};
    try {
      const state=await request('/assignments/'+assignment.assignment_id+'/proof',{auth:true,...requestScope});
      if(!await current())return;
      box.replaceChildren(button('Close evidence',closeProof),el('h3',assignment.title||'Mission evidence'));
      const note=el('p','','we-message');note.setAttribute('role','status');note.setAttribute('aria-live','polite');box.append(note);
      if(state.proof){box.append(el('p','Evidence review: '+text(state.proof.status,60)),el('p',text(state.proof.statement,4000)));if(safeURL(state.proof.proof_url))box.append(link('Submitted source link',safeURL(state.proof.proof_url)));if(state.proof.review_note)box.append(el('p','Reviewer feedback: '+text(state.proof.review_note,1000)));}
      else box.append(el('p','No evidence has been submitted yet.'));
      box.append(el('p',state.proof_published?'Your verified evidence is already posted to the feed. Changing a sharing choice does not remove an existing post.':state.post_id?'A verified-action card exists on the feed, but public proof has not been confirmed.':state.share?'Your saved choice allows a feed post after verification.':'Your evidence is private to you and authorized reviewers unless you explicitly choose to share it.','we-subtle'));
      if(state.can_submit===true){
        const form=el('form','','we-proof-form');
        const label=(caption,node)=>{const item=el('label',caption);item.append(node);form.append(item);return node;};
        const statement=el('textarea');statement.maxLength=4000;statement.minLength=20;statement.required=true;statement.rows=6;statement.value=text(state.proof?.statement,4000);label('What did you complete? Include dates, sources and what remains uncertain.',statement);
        const url=el('input');url.type='url';url.maxLength=2000;url.placeholder='https://…';url.value=safeURL(state.proof?.proof_url);label('Public evidence link (optional)',url);
        const consent=el('input');consent.type='checkbox';label('I checked this evidence, have permission to submit it, and removed other people’s private information.',consent);
        const share=el('input');share.type='checkbox';share.checked=false;label('After owner verification, I want this proof and statement posted to the public Action Network feed.',share);
        form.append(el('p','Submitting saves evidence for review. It does not verify the mission, award points or start a recording. Public proof is limited to 2,000 characters including the link; private statements may use 4,000. Sharing is off unless you select it above.','we-subtle'));
        const submit=button('Submit evidence for review',()=>{});submit.type='submit';form.append(submit);
        form.onsubmit=async event=>{
          event.preventDefault();if(!await current()||proofBusy)return;
          const value=statement.value.trim(),href=url.value.trim();
          if(!consent.checked||value.length<20||value.length>4000||href&&!safeURL(href)||share.checked&&(value.length+(href?href.length+2:0)>2000)){note.textContent='Add at least 20 characters, a valid HTTPS link if used, and confirm consent. Public proof plus its link must fit within 2,000 characters.';return;}
          proofBusy=true;submit.disabled=true;note.textContent='Saving evidence…';
          try {const result=await request('/assignments/'+assignment.assignment_id+'/proof',{method:'POST',auth:true,...requestScope,body:{proof_type:href?'link':'text',statement:value,proof_url:href||null,share:share.checked===true,consent:true}});if(!await current())return;if(!uuid(result.proof_id)||result.assignment_id!==assignment.assignment_id||result.status!=='submitted')throw Error('Evidence submission was not confirmed.');note.textContent=result.share?'Evidence submitted for review. Public sharing is requested after verification; no public post is confirmed yet.':'Evidence submitted for review with public sharing off.';status(note.textContent);await loadPrivate();}
          catch(error){if(await current())note.textContent=error.message||'Submission was not confirmed. Close and reopen evidence before retrying.';}
          finally{proofBusy=false;submit.disabled=false;}
        };box.append(form);
      }else box.append(el('p','New evidence is not available for this assignment’s current state.','we-subtle'));
      if(state.can_share===true&&!state.proof_published){
        const share=button('Post verified proof to the feed',async()=>{
          if(!await current()||proofBusy||!w.confirm('Post your verified evidence and statement to the public Action Network feed?'))return;
          proofBusy=true;share.disabled=true;
          try{const result=await request('/assignments/'+assignment.assignment_id+'/share',{method:'POST',auth:true,...requestScope,body:{share:true,consent:true}});if(!await current())return;note.textContent=uuid(result.post_id)&&result.proof_published===true?'Your verified proof post is confirmed on the feed.':'Your sharing choice was saved, but no public post is confirmed. Reopen evidence to check.';}
          catch(error){if(await current())note.textContent=error.message||'Sharing was not confirmed. Reopen evidence before retrying.';}
          finally{proofBusy=false;share.disabled=false;}
        });box.append(share);
      }
    }catch(error){if(await current())box.replaceChildren(button('Close evidence',closeProof),el('p',error.message||'Evidence could not be loaded. No change was made.'));}
  }
  function renderTeam() {
    if (destroyed) return;
    renderAssignments();
    const box = byId('weTeam'); box.replaceChildren(); box.append(el('h3','Environmental Justice Team'));
    if (!privateToken) { box.append(el('p','Explore without an account. Sign in to join the team and take part in approved missions.'),button('Sign in to participate',signIn)); return; }
    if (!team) { box.append(el('p','Team membership is not available yet. No membership has been assumed.'),button('Check membership', () => loadPrivate())); return; }
    const joined = team.membership?.joined === true;
    box.append(el('p',joined ? 'You are on the Environmental Justice Team.' : 'Join the team to help turn sourced environmental evidence into practical work.'));
    if (!joined) {
      const label = el('label','','we-consent'), check = el('input'); check.type='checkbox';check.id='weJoinConsent';label.append(check,el('span','I agree to join this team. Other team members can see my membership. The owner can review my mission assignments. I will follow safety guidance and obtain consent before recording.'));box.append(label);
    }
    const join = button(joined ? 'Leave the team' : 'Join the team', () => changeTeam(!joined)); join.disabled=joining;box.append(join);
  }
  function renderOwner() {
    if (destroyed) return;
    const box = byId('weOwner'); box.replaceChildren(); box.hidden=!oversight;
    if (!oversight) return;
    box.append(el('h3','Mission oversight'),el('p','Only the server-authorized owner sees this section. Review the source, safety and evidence requirements before opening a mission.','we-subtle'));
    const refresh = button('Refresh oversight', () => loadPrivate()); box.append(refresh);
    for (const mission of oversight.missions || []) {
      const card=el('article');card.append(el('h4',text(mission.title,180)),el('p',text(mission.description,1200)),el('p','Status: '+text(mission.status,60)));
      const source=mission.source_snapshot?.source;
      if (safeURL(source?.url)) card.append(link('Review '+text(source.label,120),safeURL(source.url)),el('p','Observed: '+timeLabel(mission.source_snapshot.observed_at),'we-subtle'));
      const news=mission.source_snapshot?.news_context;if(safeURL(news?.url))card.append(el('p','Reviewed news context: '+text(news.title,1000)),link('Inspect news context',safeURL(news.url)),el('p','Reported claim. Not a finding of environmental injustice.','we-subtle'));
      const controls=el('div','','we-actions');
      for (const [decision,label] of [['open','Approve mission'],['paused','Pause'],['closed','Close mission']]) {
        if (mission.status!==decision) controls.append(button(label,() => reviewMission(mission.id,decision)));
      }
      card.append(controls);
      for (const assignment of mission.assignments || []) card.append(el('p',`${text(assignment.display_name,120) || 'Member ' + text(assignment.user_id,40)} · ${text(assignment.status,60)}`,'we-subtle'));
      box.append(card);
    }
    if (!oversight.missions?.length) box.append(el('p','No environmental mission proposals yet.'));
    const proofs=el('section');proofs.append(el('h3','Review mission evidence'));
    if(!proofReviews)proofs.append(el('p','Evidence review is unavailable. No review queue has been assumed.','we-subtle'));
    else{
      for(const proof of (proofReviews.proofs||[]).slice(0,200)){
        if(!uuid(proof.proof_id))continue;
        const card=el('article');card.append(el('h4',text(proof.title,180)||'Environmental mission'),el('p',text(proof.statement,4000)),el('p','Review state: '+text(proof.status,60),'we-subtle'));
        if(safeURL(proof.proof_url))card.append(link('Inspect submitted source',safeURL(proof.proof_url)));
        card.append(el('p','Verification can award canonical points and may publish this evidence if the member opted to share. Check the evidence before deciding.','we-subtle'));
        if(proof.status==='pending'&&/^[a-f0-9]{32}$/.test(proof.proof_revision||'')){
          const label=el('label','Review note'),note=el('textarea');note.rows=3;note.maxLength=1000;label.append(note);card.append(label);
          card.append(button('Verify evidence',()=>reviewProof(proof.proof_id,'verified',note.value,proof.proof_revision)),button('Return for correction',()=>reviewProof(proof.proof_id,'rejected',note.value,proof.proof_revision)));
        }else if(proof.status==='pending')card.append(el('p','Refresh evidence before reviewing. No evidence revision was confirmed.','we-subtle'));
        proofs.append(card);
      }
      if(!proofReviews.proofs?.length)proofs.append(el('p','No environmental evidence is waiting for review.'));
      if(proofReviews.limited)proofs.append(el('p','The review list is limited. Review or refresh to see remaining items.','we-subtle'));
    }
    box.append(proofs);

  }
  async function reviewProof(id,decision,note='',revision) {
    if(destroyed||saving)return;
    const epoch=privateEpoch,identity=await token();
    if(destroyed||saving||epoch!==privateEpoch||!identity)return;
    if(decision==='rejected'&&note.trim().length<10){status('Add a useful correction note before returning evidence.');return;}
    if(!w.confirm(decision==='verified'?'Verify this evidence? Canonical rewards and the member’s requested public sharing may follow.':'Return this evidence for correction with your review note?'))return;
    saving=true;
    try{const result=await request('/proofs/'+id+'/review',{method:'POST',auth:true,...scope(identity,epoch),body:{decision,review_note:note.trim(),expected_revision:revision}});if(!await sessionCurrent(identity,epoch))return;if(result.proof_id!==id||result.status!==decision)throw Error('Evidence review was not confirmed.');status(decision==='verified'?'Evidence verified. The member can check their saved evidence for actual public-post status.':'Evidence returned with your correction note.');await loadPrivate();}
    catch(error){if(!destroyed&&epoch===privateEpoch)status(error.message||'Review was not confirmed. Refresh before retrying.');}
    finally{saving=false;}
  }
  async function loadPrivate() {
    if (destroyed) return;
    closeProof();closePlanning();
    const epoch=++privateEpoch, t=await token();
    if (destroyed || epoch!==privateEpoch) return;
    privateToken=t;team=null;oversight=null;proofReviews=null;renderTeam();renderOwner();renderDetail();
    if (!t) return;
    privateBusy=true;
    const [membership,owner,reviews]=await Promise.allSettled([request('/team',{auth:true}),request('/oversight',{auth:true}),request('/proofs',{auth:true})]);
    const currentToken = await token();
    if (destroyed || epoch!==privateEpoch || t!==currentToken) return;
    team=membership.status==='fulfilled' ? membership.value : null;
    oversight=owner.status==='fulfilled' ? owner.value : null;
    proofReviews=oversight&&reviews.status==='fulfilled'?reviews.value:null;
    privateBusy=false;renderTeam();renderOwner();renderDetail();
  }
  async function changeTeam(join) {
    if (destroyed || joining) return;
    if (join && !byId('weJoinConsent')?.checked) { status('Confirm the team’s safety and participation terms first.'); return; }
    const epoch=privateEpoch, identity=await token();
    if (destroyed || joining || epoch!==privateEpoch) return;
    if (!identity) { signIn(); return; }
    if (join===false && !w.confirm('Leave the Environmental Justice Team? This does not cancel missions you already joined.')) return;
    if (destroyed || epoch!==privateEpoch) return;
    joining=true;renderTeam();
    try { await request('/team',{method:'POST',auth:true,...scope(identity,epoch),body:{join}}); if(!await sessionCurrent(identity,epoch))return; status(join ? 'Team membership saved.' : 'You left the team.'); }
    catch(error) { if(!destroyed&&epoch===privateEpoch) status(error.status===401 ? 'Sign in before joining.' : 'Membership was not confirmed. Check the membership status below before trying again.'); }
    finally { joining=false;if(!destroyed)await loadPrivate(); }
  }
  async function proposeMission(row, action, newsReviewId=null) {
    if (destroyed || saving) return;
    const epoch=privateEpoch, currentToken=await token();
    if (destroyed || saving || epoch!==privateEpoch) return;
    if (!currentToken) { signIn(); return; }
    if (team?.membership?.joined !== true) { status('Join the Environmental Justice Team before suggesting a mission.'); byId('weTeam').scrollIntoView?.({block:'nearest'}); return; }
    saving=true;renderDetail();
    try { const result=await request('/missions/propose',{method:'POST',auth:true,...scope(currentToken,epoch),body:{event_id:row.id,action_id:action.id,...(newsReviewId?{news_review_id:newsReviewId}:{})}});if(!await sessionCurrent(currentToken,epoch))return;status(result.created===false?'This mission already exists. Its saved source context was not replaced; inspect the existing mission before opening it.':'Mission suggestion saved for owner review. It is not open for participation yet.');await loadPrivate(); }
    catch(error) {if(!destroyed&&epoch===privateEpoch)status(error.message || 'Suggestion was not confirmed. Check oversight before trying again.');}
    finally {saving=false;renderDetail();}
  }
  async function joinMission(mission) {
    if (destroyed || saving) return;
    const epoch=privateEpoch, currentToken=await token();
    if (destroyed || saving || epoch!==privateEpoch) return;
    if (!currentToken) { signIn(); return; }
    saving=true;panel.querySelectorAll('button').forEach(b=>b.disabled=true);
    try { const result=await request('/missions/'+encodeURIComponent(mission.id)+'/join',{method:'POST',auth:true,...scope(currentToken,epoch),body:{}}); if(!await sessionCurrent(currentToken,epoch))return; if(!uuid(result.assignment_id))throw new Error('No assignment was confirmed.');status('Mission joined. Your assignment is saved. Review recording availability and consent before starting.'); }
    catch(error) {if(!destroyed&&epoch===privateEpoch)status(error.message || 'No assignment confirmed. Refresh before trying again.');}
    finally {saving=false;if(!destroyed){panel.querySelectorAll('button').forEach(b=>b.disabled=false);await loadPrivate();}}
  }
  async function reviewMission(id,decision) {
    if (destroyed || saving) return;
    const epoch=privateEpoch, identity=await token();
    if (destroyed || saving || epoch!==privateEpoch || !identity) return;
    if (!w.confirm(`${decision==='open' ? 'Approve and open' : decision==='paused' ? 'Pause' : 'Close'} this environmental mission?`)) return;
    if (destroyed || epoch!==privateEpoch) return;
    saving=true;byId('weOwner').querySelectorAll('button').forEach(b=>b.disabled=true);
    try {await request('/missions/'+encodeURIComponent(id)+'/review',{method:'POST',auth:true,...scope(identity,epoch),body:{decision}});if(!await sessionCurrent(identity,epoch))return;status('Mission review saved.');await loadFeed();}
    catch(error) {if(!destroyed&&epoch===privateEpoch)status(error.message || 'Review was not confirmed. Refresh oversight before retrying.');}
    finally {saving=false;if(!destroyed)await loadPrivate();}
  }
  async function loadFeed() {
    if (destroyed || feedBusy) return;
    feedBusy=true;requested=true;const epoch=++feedEpoch;abort=new AbortController();byId('weRefresh').disabled=true;status('Checking government sources…');
    /* the gate's code rides with a refusal (503 module_policy_unavailable, 404 module_disabled) and the host page is told which it
       was; a read that failed on the way is 'network', an answer the panel cannot accept is 'bad_response' */
    let code=null;
    try {
      let body;
      try {body=await request('',{signal:abort.signal});} catch(error){code=typeof error?.code==='string'?text(error.code,40):'network';throw error;}
      try {body=normalizeFeed(body);} catch(error){code='bad_response';throw error;}
      if(epoch!==feedEpoch)return;feed=body;lastCode=null;checkedAt=new Date().toISOString();if(!feed.events.some(row=>row.id===selected))selected='';byId('weFreshness').textContent='Checked '+timeLabel(checkedAt);status(body.sources.some(s=>s.status==='unavailable') ? 'Some sources are unavailable. Available observations are shown below.' : 'Select an observation to inspect its dates, source and possible work.');}
    catch(error) {if(epoch!==feedEpoch)return;feed=null;selected='';lastCode=code||'network';checkedAt=new Date().toISOString();status('Environmental sources are unavailable. No current observations can be confirmed. Refresh to try again.');}
    finally {if(epoch===feedEpoch){feedBusy=false;byId('weRefresh').disabled=false;renderList();renderSources();renderDetail();renderAssignments();syncPins();maybeAutostart();dispatchEvents();}}
  }
  /* the tour starts by itself once per opening of the tab, and only when the frame is at least a quarter in view, the page is
     visible, motion is allowed and the visitor has not pressed Pause in this page session (cinematic rules, 2026-11-17); never
     again in an opening where the visitor's hand on the globe stopped it or it ran to its end; and only once the feed has
     answered, so the play follows pins that carry something to tour (review RV2-1) */
  function maybeAutostart() {
    if (destroyed || !tabOpen || autostartDone || tourStopped || !feed || !active() || d.hidden || !frameVisible || pausedByVisitor || reducedMotion()) return;
    autostartDone=true;sendScene('play');
  }
  function onMode() {
    if (destroyed) return;
    const on=active();
    panel.hidden=!on;
    if (on&&!tabOpen) {autostartDone=false;tourStopped=false;stepAsked=false;} /* a fresh opening of the tab */
    tabOpen=on;
    /* the fixed order: the typed layers, then the pins (both off together when the tab changes) */
    syncLayers();syncPins();clearInterval(timer);timer=null;
    if (on) {if(!requested)void loadFeed();if(!privateBusy)void loadPrivate();timer=setInterval(()=>{if(active()&&!d.hidden)void loadFeed();},300000);maybeAutostart();}
    else {sceneState=null;stepAsked=false;renderScene();}
  }
  /* THE TOUR AND THE 2D VIEW: the controls send hu:environment-scene and hu:environment-view; the words follow the globe's own
     hu:environment-scene-state and hu:environment-view-state, never a guess */
  function renderScene() {
    if (destroyed) return;
    const play=byId('wePlay'),line=byId('weSceneStatus'),playing=sceneState?.playing===true;
    /* the label names the next action (Play tour / Pause tour), so the button carries no aria-pressed: a toggle keeps one label and
       says its state, or changes its label and says nothing more, never both (review G1R-11) */
    play.textContent=playing?'Pause tour':'Play tour';
    byId('weReplay').setAttribute('aria-pressed',String(replay==='quakes-24h'));
    let words='';
    if (sceneState) {
      const where=sceneState.total>0&&sceneState.index>=0?`Scene ${sceneState.index+1} of ${sceneState.total}`:'',title=text(sceneState.title,160);
      if (playing) words=[where,title].filter(Boolean).join(': ');
      else words=({'reduced-motion':'The tour does not start by itself: animations are off (reduced motion). Next and Previous step without motion.',hidden:'Paused while this page was hidden.',input:'Paused: you moved the globe. Play resumes the tour.',end:'The tour has ended. Play starts it again.',empty:'No significant event to tour right now.',off:''})[sceneState.reason]??(where?`Paused at ${where.toLowerCase()}${title?': '+title:''}`:'');
    }
    line.textContent=(words+(reducedMotion()&&!/reduced motion/.test(words)?' (animations off)':'')).trim();
  }
  /* the 2D map is a toggle that keeps its one label and says its state (aria-pressed, and the pressed colour by sight), the rule
     #wePlay follows the other way round (review RV2-6) */
  function renderView() {
    if (destroyed) return;
    const b=byId('weView2d');
    b.setAttribute('aria-pressed',String(viewState.mode==='2d'));b.textContent='2D map';
  }
  byId('weRefresh').onclick=()=>{void loadFeed();void loadPrivate();};
  byId('weMore').onclick=()=>{
    if(destroyed)return;
    const opening=!listOpen,before=shownIds.slice();
    if(opening)openLead=before;
    listOpen=opening;renderList();
    if(opening){const first=shownIds.find(id=>!before.includes(id));if(first!==undefined)rowButtons.get(first)?.focus?.();}
    else byId('weMore').scrollIntoView?.({block:'nearest',behavior:'auto'});
  };
  /* the list follows every keystroke; the globe, which rebuilds its events layer for a changed list, is told once the typing pauses
     (review G1R-9) */
  byId('weSearch').oninput=event=>{search=event.target.value.trim().toLocaleLowerCase();renderList();clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTimer=null;if(!destroyed)syncPins();},SEARCH_SYNC_MS);};
  byId('wePlay').onclick=()=>{if(sceneState?.playing===true){pausedByVisitor=true;sendScene('pause');}else sendScene('play');};
  byId('wePrev').onclick=()=>{stepAsked=true;sendScene('prev');};
  byId('weNext').onclick=()=>{stepAsked=true;sendScene('next');};
  byId('weReplay').onclick=()=>{replay=replay?null:'quakes-24h';renderScene();if(active())syncLayers();};
  byId('weView2d').onclick=()=>send({type:'hu:environment-view',mode:viewState.mode==='2d'?'3d':'2d'});
  listen(adapter.modeEvent || 'environment:mode',onMode);
  listen(adapter.authEvent || 'environment:auth',()=>{closeProof();closePlanning();privateEpoch++;privateBusy=false;team=null;oversight=null;proofReviews=null;privateToken=null;renderTeam();renderOwner();renderDetail();if(active())void loadPrivate();});
  listen('storage',event=>{if(adapter.sessionStorageKey && event.key===adapter.sessionStorageKey){closeProof();closePlanning();privateEpoch++;privateBusy=false;team=null;oversight=null;proofReviews=null;privateToken=null;renderTeam();renderOwner();renderDetail();if(active())void loadPrivate();}});
  listen('message',event=>{
    if(event.origin!==w.location.origin||event.source!==frame.contentWindow)return;const data=event.data||{};
    /* the layers and the pins are said again on every ready (landing on the tab before the frame booted, integration pass G1). Only
       a globe that has just booted (a boot id the panel has not heard, or the first ready of all) has no tour yet: its tour words
       start clean and the one autostart is armed again under the same rule. The same globe saying ready again (its missions read
       answering late, a hu:hello answered, a bfcache restore) never restarts a tour the visitor stopped or that ended, and never
       blanks the words of one still playing (review RV2-1) */
    if(data.type==='hu:globe-ready'){
      const boot=text(data.boot,64)||null,fresh=boot?boot!==globeBoot:globeBoot===undefined;
      if(fresh)globeBoot=boot;
      syncLayers();syncPins();
      if(fresh){sceneState=null;stepAsked=false;renderScene();autostartDone=false;maybeAutostart();}
    }
    /* the globe's own selection: the panel follows it and sends nothing back (select's fromGlobe). A scene the tour chose (via
       'tour') is named by the scene line and opens no card: the card is for what the visitor chooses (a row, a tap on the globe, Show
       on globe). Opened for every scene, it put 723 px above the posts at 390 with the fixtures and another card at each scene, and
       select() revealed the panel (closing an expanded map) and scrolled the card into view each time (release polish, 2026-11-18). A card the tour moved the globe away from closes, so the panel never describes what the globe no longer shows.
       A SCENE THE VISITOR STEPPED TO IS THEIR CHOICE (review of the release polish, RP-1): Next and Previous, pressed while the tour
       is not playing, reach the panel through the same arrival (via 'tour'), and the scene they bring opens its card like a row, with
       its dates and its source, and presses its row. Under reduced motion the tour never plays by itself and stepping is the only way
       through the significant events. The globe tells the scene state of the step (the scene it is at) before the scene arrives, so
       the arrival is matched to that scene: a late answer for the scene before it (its ShakeMap) takes nothing from the step, and a
       scene of a playing tour, Next pressed while it plays included, opens no card. */
    if(data.type==='hu:environment-selected'&&active()){
      const atScene=data.via==='tour'&&!!sceneState&&data.id===sceneState.id,stepped=atScene&&stepAsked&&sceneState.playing!==true;
      if(atScene)stepAsked=false;
      if(data.via==='tour'&&!stepped){if((selected&&selected!==data.id)||globeSelection){selected='';globeSelection=null;renderDetail();renderList();}}
      else if(feed?.events.some(row=>row.id===data.id))select(data.id,false,true);
      else if(typeof data.id==='string'&&data.id){adapter.revealPanel?.();globeSelection=cleanSelection(data);selected='';renderDetail();renderList();byId('weDetail').scrollIntoView?.({block:'nearest',behavior:'auto'});}
    }
    if(data.type==='hu:environment-layer-state')onLayerState(data);
    if(data.type==='hu:environment-scene-state'){sceneState={playing:data.playing===true,index:num(data.index)??0,total:num(data.total)??0,id:text(data.id,300)||null,title:text(data.title,160)||null,queue:data.queue==='quakes-24h'?'quakes-24h':'significant',reason:text(data.reason,20)||null};if(active()&&(sceneState.reason==='input'||sceneState.reason==='end'))tourStopped=true;renderScene();}
    if(data.type==='hu:environment-view-state'){viewState={mode:data.mode==='2d'?'2d':'3d',morphing:data.morphing===true};renderView();}
    if(data.type==='hu:globe-unavailable'&&active())status('The interactive globe is unavailable. All available observations and actions are still accessible in this list.');
  });
  listen('pagehide',()=>{clearInterval(timer);abort?.abort();privateEpoch++;send(layersMessage(false));});
  listen('pageshow',event=>{if(event.persisted)onMode();});
  /* the page hidden pauses the tour on the globe's side; coming back, the panel asks for it again only if it was playing */
  listenDoc('visibilitychange',()=>{if(destroyed)return;if(d.hidden)resumeOnShow=sceneState?.playing===true;else if(resumeOnShow){resumeOnShow=false;if(active()&&!pausedByVisitor&&!reducedMotion())sendScene('play');}});
  /* the frame at least a quarter in view, for the autostart rule; without an observer there is no proof it is, so no autostart */
  if (typeof w.IntersectionObserver==='function') {
    try {observer=new w.IntersectionObserver(entries=>{for(const entry of entries)frameVisible=entry.isIntersecting===true&&entry.intersectionRatio>=0.25;maybeAutostart();},{threshold:[0,0.25,0.5,1]});observer.observe(frame);}
    catch {observer=null;}
  }
  renderTeam();renderScene();renderView();
  /* the first public read happens at mount, before the tab is opened, so the host feed can carry the significant observations at
     once; the refresh timer still runs only while the tab is open and the page visible (onMode) */
  void loadFeed();
  onMode();
  return {refresh:loadFeed,destroy(){
    // Idempotent, and only the current owner of the host panel may clear its DOM or
    // switch off the globe pins: a stale instance's late cleanup must not erase a
    // newer mount (audit EQ2).
    if (destroyed) return;
    destroyed=true;proofEpoch++;planningEpoch++;clearInterval(timer);clearTimeout(searchTimer);abort?.abort();privateEpoch++;feedEpoch++;listeners.forEach(([type,fn])=>w.removeEventListener(type,fn));docListeners.forEach(([type,fn])=>d.removeEventListener(type,fn));
    try {observer?.disconnect();} catch {} observer=null;
    if (owners.get(panel)!==instance) return;
    owners.delete(panel);
    /* the host page is told there are no observations, the layers go off, and the pins-off object is the last word */
    feed=null;dispatchEvents('off');send(layersMessage(false));send({type:'hu:environment-pins',on:false,items:[]});panel.replaceChildren();panel.hidden=true; }};
}
