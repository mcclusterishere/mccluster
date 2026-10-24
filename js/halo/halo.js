/* HITMAN'S HALO: the owner's operations view on the full-screen globe, built to the owner's four screens (2026-10-21,
   docs/design/halo/reference/, docs/design/halo/HALO-VIEW-DESIGN.md): World, Missions, People and Intelligence around one
   Earth, with a list panel, a detail panel, the counts that matter and an activity timeline.

   Mounted only by js/action-globe.js (haloSync), only on the full-screen globe, only while the Worker says this session is the
   house owner; it unmounts the moment that answer goes. It drives the globe through window.HuGlobe and reads only the Worker
   (js/halo/data.js, js/halo/layers.js). What it shows is real or says it is missing: no demo rows, no invented people, no one's
   location (members have shared none; the People view puts mission places on the Earth, never a person).

   Everything Hitman's Halo could do stays: live layers (World data), Google's photoreal 3D cities, the visual modes and the
   telemetry HUD (the Layers menu), place search, follow and orbit, share links. Keys: 1–7 vision, H HUD, O orbit, Esc steps
   back (menus, then following, then orbit, then the selection). The owner's setup is remembered in this browser only. */
(function () {
  'use strict';

  const PREFS = 'halo:prefs';
  const CONTROL = 'control.html#create:action-network';
  const BRIEFS = 'brief.html';
  const VIEWS = ['world', 'missions', 'people', 'intel'];
  const META = {
    world: { tab: 'World', title: 'World', sub: 'Live sources on one Earth.', time: 'Activity' },
    missions: { tab: 'Missions', title: 'Mission control', sub: 'Coordinate teams. Track evidence. Verify outcomes.', time: 'Mission activity' },
    people: { tab: 'People', title: 'People', sub: 'Teams. Assignments. Activity.', time: 'Team activity' },
    intel: { tab: 'Intelligence', title: 'Intelligence', sub: 'Signals. Sources. Evidence.', time: 'Evidence timeline' }
  };

  /* plain interface glyphs (not marks) */
  const svg = (d, extra) => '<svg viewBox="0 0 24 24" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';
  const ICON = {
    plane: svg('<path d="M2.5 13.5 21 4l-6 17-3.5-7z"/><path d="M11.5 14 21 4"/>'),
    cloud: svg('<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.2 4.4 4.4 0 0 0 7 18z"/>'),
    building: svg('<path d="M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20"/>'),
    sat: svg('<path d="M4 6l3-3 4 4-3 3zM13 17l3-3 4 4-3 3zM8.5 8.5l7 7"/><circle cx="12" cy="12" r="2.4"/>'),
    camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c2.6-.3 4.6 1.2 5 4.3"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
    layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
    chev: svg('<path d="m9 6 6 6-6 6"/>'),
    down: svg('<path d="m6 9 6 6 6-6"/>'),
    up: svg('<path d="m6 15 6-6 6 6"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    locate: svg('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/>'),
    north: svg('<path d="M12 3 18 20l-6-4-6 4z"/>'),
    mouse: svg('<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 7v3"/>'),
    hand: svg('<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.5 0-4-1.3-5.4-3.5L4 14.5a1.6 1.6 0 0 1 2.6-1.8L8 14.5"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    image: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>'),
    doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
    wave: svg('<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>'),
    flame: svg('<path d="M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.7 3-5.8 3.6-9.8 2.6 1.6 4.3 4.3 4.3 6.6.9-.7 1.5-1.9 1.6-3.2 2 1.7 3.5 4 3.5 6.5 0 3.6-2.5 6.1-6.5 6.1z"/>'),
    ship: svg('<path d="M3 15h18l-2.5 5h-13zM6 15V9h12v6M9 9V5h6v4"/>'),
    quake: svg('<path d="M2 12h4l2-5 3 10 3-14 2.5 9H22"/>'),
    storm: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3c-5 0-8 3-8 6M12 21c5 0 8-3 8-6M3 12c0 5 3 8 6 8M21 12c0-5-3-8-6-8"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>'),
    pin: svg('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
    filter: svg('<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>'),
    sort: svg('<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>'),
    db: svg('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'),
    flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    expand: svg('<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>')
  };

  /* WORLD DATA: only implemented sources belong in the operational layer picker. */
  const GROUPS = [
    { id: 'air', name: 'Air & sea', icon: 'plane', items: [{ id: 'flights', label: 'Aircraft', core: true }, { id: 'military', label: 'Military aircraft', short: 'Military' }, { id: 'vessels', label: 'Ships (AIS)', short: 'Ships' }] },
    { id: 'earth', name: 'Earth & weather', icon: 'cloud', items: [{ id: 'airquality', label: 'Air quality (Canada AQHI)', short: 'Air quality' }, { id: 'quakes', label: 'Earthquakes', short: 'Quakes' }, { id: 'fires', label: 'Thermal hotspots (NASA FIRMS)', short: 'Thermal' }, { id: 'tides', label: 'Water levels (NOAA)', short: 'NOAA' }, { id: 'cyclones', label: 'Tropical cyclones (NOAA)', short: 'Cyclones' }, { id: 'perimeters', label: 'Wildfire perimeters', short: 'Perimeters' }] },
    { id: 'space', name: 'Space', icon: 'sat', items: [{ id: 'satellites', label: 'Satellites', core: true }, { id: 'launches', label: 'Launches', core: true }] },
    { id: 'places', name: 'Places & media', icon: 'camera', items: [{ id: 'cctv', label: 'Cameras (CCTV)', short: 'Cameras', core: true }] },
    { id: 'ops', name: 'Field operations', icon: 'people', items: [{ id: 'missions', label: 'Missions', own: true }, { id: 'regions', label: 'Member regions (5 or more)', short: 'People', globe: true }, { id: 'intel', label: 'Intel events (evidence)', short: 'Evidence', core: true }] }
  ];
  const CONTEXT = ['Satellite imagery', 'Street map', 'Photoreal 3D cities', 'Country borders'];
  const ALL_ITEMS = GROUPS.flatMap((g) => g.items);
  const TONE = { cyan: '#45b8f4', amber: '#f2b448', red: '#ff7a7a', green: '#4fdf98', mute: '#7f90a6', white: '#eef3f9' };

  let G = null, V = null, C = null, mounted = false;
  let ui = {}, vision = null, hud = null, layers = null, data = null, offs = [];
  let routeReady = false, restoringRoute = false;
  let view = 'world', sel = null, dtab = 'overview';
  let tabs = { missions: 'active', people: 'all', intel: 'feed' }, sorts = { missions: 'priority', people: 'activity' }, query = { missions: '', people: '', intel: '' };
  let area = 'earth', hours = 24, expanded = {}, missionsOn = true, collapsed = false, sheetOpen = false, mapFocus = false;
  let followTarget = null, followTick = null, orbitTick = null, orbitLast = 0, photo = null, photoPhase = 'off';
  let marks = null, saved = null, paintQueued = false, listSig = '', detailSig = '', markSig = '', thumbs = {}, timelineFor = null;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => (G ? G.esc(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wide = () => !!(window.matchMedia && matchMedia('(min-width:1100px)').matches);
  const desk = () => !!(window.matchMedia && matchMedia('(min-width:1200px)').matches);
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const ms = (iso) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
  const n = (v) => (fin(v) ? v.toLocaleString('en-US') : '0');

  function ago(t) {
    if (!fin(t)) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
  function due(iso) {
    const t = ms(iso);
    if (t === null) return 'No end date';
    const d = new Date(t), today = new Date(), day = (x) => x.toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 864e5);
    if (day(d) === day(today)) return 'Today, ' + hhmm(t) + ' UTC';
    if (day(d) === day(tomorrow)) return 'Tomorrow, ' + hhmm(t) + ' UTC';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getUTCFullYear() === today.getUTCFullYear() ? undefined : 'numeric', timeZone: 'UTC' });
  }
  function initials(name) { const p = String(name || '?').trim().split(/\s+/); return esc(((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()); }
  function avatar(name, url, extra) {
    const img = typeof url === 'string' && /^https:\/\//.test(url) ? '<img src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : initials(name);
    return '<span class="hx-avatar">' + img + (extra || '') + '</span>';
  }
  function km(a, b) {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* ---------- prefs ---------- */
  function prefs() { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs() {
    if (!mounted) return;
    try { localStorage.setItem(PREFS, JSON.stringify({ view, style: vision ? vision.get() : 'normal', hud: !!(hud && hud.shown()), layers: ALL_ITEMS.filter(isOn).map((it) => it.id), expanded, hours, collapsed })); } catch (e) { /* private mode */ }
  }

  /* ---------- data, as the views need it ---------- */
  const body = (k) => (data ? data.peek(k).body : null);
  const missions = () => { const b = body('missions'); return b && Array.isArray(b.missions) ? b.missions : []; };
  const peopleList = () => { const b = body('people'); return b && Array.isArray(b.people) ? b.people : []; };
  const evidence = () => { const b = body('evidence'); const a = b && (b.evidence || b.items || b.records); return Array.isArray(a) ? a : []; };
  const placed = (m) => m && m.place && fin(m.place.lat) && fin(m.place.lon);
  const missionById = (id) => missions().find((m) => m.id === id) || null;
  const personById = (id) => peopleList().find((p) => p.m_uid === id) || null;
  function missionTone(m) { return m.review ? 'amber' : m.status === 'active' ? 'cyan' : m.status === 'blocked' ? 'red' : m.status === 'completed' ? 'mute' : 'mute'; }
  function missionWord(m) { return { active: 'Active', planned: 'Planned', blocked: 'Paused', completed: 'Closed' }[m.status] || 'Unknown'; }
  function missionProgress(m) {
    const c = m.counts || {}, joined = fin(c.joined) ? c.joined : 0, verified = fin(c.verified) ? c.verified : 0;
    const total = Math.max(joined, verified);
    return { known: fin(c.joined) && fin(c.verified), done: verified, total, pct: total ? Math.round(verified / total * 100) : 0 };
  }
  const shortId = (id) => String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase();

  /* ---------- layers: one switchboard for the globe's, Halo's and this view's own ---------- */
  function isOn(it) {
    if (it.planned) return false;
    if (it.own) return missionsOn;
    if (it.globe) return !!(G.regions && G.regions.shown());
    return it.core ? G.layer.on(it.id) : !!(layers && layers.on(it.id));
  }
  function stateOf(it) {
    if (it.planned) return { state: 'planned', text: 'Planned' };
    if (it.own) { const s = data.peek('missions'), k = missions().filter(placed).length; return { state: missionsOn ? (s.error && !s.body ? 'error' : 'on') : 'off', text: missionsOn ? (s.body ? n(k) : s.error ? 'Unavailable' : 'Loading…') : '', fetched: s.at }; }
    if (it.globe) return { state: isOn(it) ? 'on' : 'off', text: isOn(it) ? 'Shown' : '' };
    if (it.core) {
      if (G.layer.locked(it.id)) return { state: 'locked', text: 'Locked' };
      const on = G.layer.on(it.id), c = G.layer.count(it.id);
      return { state: on ? 'on' : 'off', text: on ? n(c) : '' };
    }
    const s = layers && layers.status(it.id);
    if (!s) return { state: 'off', text: '' };
    const words = { off: '', loading: 'Loading…', locked: 'Owner only', error: 'Unavailable', unavailable: s.reason === 'needs a key' ? 'Needs a key' : 'Unavailable' };
    return { state: s.state, text: s.state === 'on' ? n(s.count) + (s.stale ? ' · stale' : '') : (words[s.state] || ''), stale: s.stale, fetched: s.fetched, reason: s.reason };
  }
  async function setItem(it, on) {
    if (!V && !it.own) return;
    if (it.planned || isOn(it) === !!on) return;
    if (it.own) { missionsOn = !!on; markSig = ''; }
    else if (it.globe) { if (G.regions) G.regions.show(!!on); }
    else if (it.core) { if (!G.layer.locked(it.id)) await G.layer.toggle(it.id); }
    else if (layers) await layers.set(it.id, !!on);
    savePrefs(); schedulePaint();
  }
  /* how a source is doing, in the screen's words: observed and fresh, calculated, stale, partial, missing a key, unavailable */
  function health(it) {
    const s = stateOf(it);
    if (it.own) return dataHealth('missions');
    if (it.id === 'cctv') return { tone: 'hollow', text: 'Catalog loaded · snapshots checked when opened' };
    if (it.core && it.id !== 'satellites') return { tone: 'hollow', text: 'Snapshot loaded · freshness varies by source' };
    if (it.id === 'satellites') return { tone: 'cyan', text: 'Calculated from orbital elements' };
    if (it.id === 'tides' && s.state === 'on') return { tone: 'hollow', text: 'Reference: ' + n(layers.status('tides').count) + ' stations' };
    if (s.state === 'locked') return { tone: 'amber', text: 'Locked for this session' };
    if (s.state === 'unavailable') return { tone: 'amber', text: s.reason === 'needs a key' ? 'Needs a key' : 'Provider unavailable' };
    if (s.state === 'error') return { tone: 'red', text: 'Could not reach the Worker' };
    if (s.state === 'loading') return { tone: 'mute', text: 'Loading…' };
    if (s.stale) return { tone: 'amber', text: 'Stale: last good answer ' + ago(s.fetched) };
    if (fin(s.fetched) && s.fetched) return { tone: 'green', text: 'Updated ' + ago(s.fetched) };
    return { tone: 'green', text: 'Live' };
  }

  /* ---------- Google Photorealistic 3D Tiles, through the Worker's ion route ---------- */
  async function setPhotoreal(on) {
    if (!on) {
      photoPhase = 'off';
      if (photo) { if (V.scene.primitives.contains(photo)) V.scene.primitives.remove(photo); photo = null; }
      V.scene.globe.show = true; G.setPhotoreal(false); V.scene.requestRender(); paintBase();
      return;
    }
    const assets = G.ion();
    if (!assets || !Number.isInteger(assets.photoreal)) { photoPhase = 'unavailable'; paintBase(); return; }
    photoPhase = 'loading'; paintBase();
    try {
      const coarse = !!(window.matchMedia && matchMedia('(pointer:coarse)').matches);
      const tiles = await C.Cesium3DTileset.fromIonAssetId(assets.photoreal, { maximumScreenSpaceError: coarse ? 24 : 16, showCreditsOnScreen: true });
      if (!mounted || photoPhase !== 'loading') { tiles.destroy(); return; }
      photo = V.scene.primitives.add(tiles);
      V.scene.globe.show = false; G.setPhotoreal(true); photoPhase = 'on';
    } catch (e) {
      photoPhase = 'unavailable';
      try { console.warn('[halo] photoreal: ' + (e && e.message || e)); } catch (_) { /* console gone */ }
    }
    V.scene.requestRender(); paintBase();
  }
  function setBase(mode) {
    if (mode === '3d') { setPhotoreal(true); return; }
    if (photoPhase !== 'off') setPhotoreal(false);
    if (G.basemap) G.basemap.set(mode === 'map' ? 'map' : 'auto');
    paintBase();
  }
  function paintBase() {
    if (!ui.root) return;
    const m = photoPhase === 'on' || photoPhase === 'loading' ? '3d' : G.basemap && G.basemap.get() === 'map' ? 'map' : 'sat';
    $$('[data-base]', ui.root).forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.base === m ? 'true' : 'false');
      if (!V) { b.disabled=true; return; }
      if (b.dataset.base === '3d') { b.disabled = photoPhase === 'unavailable'; b.title = photoPhase === 'unavailable' ? '3D cities are unavailable. Try again later.' : ''; }
    });
  }

  /* ---------- follow and orbit ---------- */
  function follow(target) {
    stopFollow();
    if (!V || !target || typeof target.position !== 'function') return;
    const p0 = target.position();
    if (!p0) return;
    followTarget = target;
    V.camera.lookAt(p0, new C.HeadingPitchRange(V.camera.heading, C.Math.toRadians(-35), target.range || 80000));
    let last = p0;
    followTick = () => {
      const p = followTarget && followTarget.position();
      if (!p || C.Cartesian3.distance(p, last) < 0.5) return;
      last = p;
      V.camera.lookAt(p, new C.HeadingPitchRange(V.camera.heading, V.camera.pitch, C.Cartesian3.magnitude(V.camera.position)));
    };
    V.scene.preRender.addEventListener(followTick);
    ui.follow.hidden = false;
    $('b', ui.follow).textContent = target.label || 'target';
    paintTools();
  }
  function stopFollow() {
    if (followTick) { V.scene.preRender.removeEventListener(followTick); followTick = null; }
    if (followTarget) { followTarget = null; V.camera.lookAtTransform(C.Matrix4.IDENTITY); }
    if (ui.follow) ui.follow.hidden = true;
    paintTools();
  }
  function setOrbit(on) {
    if (orbitTick) { V.scene.preRender.removeEventListener(orbitTick); orbitTick = null; }
    if (!V || !on || reduced()) { paintTools(); return; }
    orbitLast = 0;
    orbitTick = () => {
      const now = performance.now(), dt = orbitLast ? Math.min(0.1, (now - orbitLast) / 1000) : 0;
      orbitLast = now;
      if (followTarget) V.camera.rotateRight(C.Math.toRadians(6) * dt);
      else V.camera.rotate(C.Cartesian3.UNIT_Z, -C.Math.toRadians(4) * dt);
      V.scene.requestRender();
    };
    V.scene.preRender.addEventListener(orbitTick);
    paintTools();
  }
  /* the height at which the whole Earth fits the space left for it (as js/action-globe.js homeAltitude does) */
  function wholeEarth() {
    const canvas = V.scene.canvas, fov = V.camera.frustum.fovy || Math.PI / 3, aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const R = C.Ellipsoid.WGS84.maximumRadius, angle = Math.atan(Math.tan(fov / 2) * Math.min(1, aspect) * 0.9);
    return R / Math.sin(angle) - R;
  }
  function flyTo(lon, lat, height) {
    if (!V || !fin(lon) || !fin(lat)) return;
    stopFollow();
    /* a pick from a list turns the Earth to it and keeps the whole Earth in view, as on the owner's screens; Go there zooms */
    const h = fin(height) ? height : Math.max(V.camera.positionCartographic.height, wholeEarth());
    V.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, h), duration: reduced() ? 0 : 1.4 });
  }

  /* ---------- selection ---------- */
  function select(next, opts) {
    sel = next;
    dtab = 'overview';
    detailSig = ''; markSig = '';
    const o = opts || {};
    if (next && o.fly !== false) {
      const at = whereIs(next);
      if (at) flyTo(at.lon, at.lat, at.height);
    }
    document.documentElement.dataset.haloDetail = sel ? 'open' : 'closed';
    if (ui.right) ui.right.dataset.open = sel ? 'true' : 'false';
    rememberRoute(); schedulePaint();
  }
  function whereIs(s) {
    if (!s) return null;
    if (s.kind === 'mission') { const m = missionById(s.id); return placed(m) ? { lon: m.place.lon, lat: m.place.lat } : null; }
    if (s.kind === 'person') { const p = personById(s.id), m = p && (p.missions || []).map((x) => missionById(x.id)).find(placed); return m ? { lon: m.place.lon, lat: m.place.lat } : null; }
    if (s.kind === 'obs' && s.d && s.d.position) { const c = C.Cartographic.fromCartesian(s.d.position()); return { lon: C.Math.toDegrees(c.longitude), lat: C.Math.toDegrees(c.latitude), close: Math.max(s.d.range * 12, 1.5e6) }; }
    if (s.kind === 'evidence') { const e = evidence().find((x) => x.id === s.id); return e && fin(e.lat) && fin(e.lon) ? { lon: e.lon, lat: e.lat } : null; }
    if (s.kind === 'feed') { const f = feed().find((x) => x.key === s.id); return f && fin(f.lat) ? { lon: f.lon, lat: f.lat } : null; }
    return null;
  }
  /* the detail column on a desk shows something even before a tap: the first thing in the list */
  function current() {
    if (sel) return sel;
    if (!desk()) return null;
    if (view === 'people') { const p = peopleSorted()[0]; return p ? { kind: 'person', id: p.m_uid, auto: true } : null; }
    if (view === 'intel') { const f = feedFiltered()[0]; return f ? f.sel : null; }
    const m = (view === 'missions' ? missionsFiltered() : missionsSorted(missions()))[0];
    return m ? { kind: 'mission', id: m.id, auto: true } : null;
  }

  /* ---------- the globe: Halo's own marks (missions, mission places, observations) ---------- */
  function markItems() {
    const out = [], cur = current();
    if (view === 'world' || view === 'missions') {
      if (view === 'missions' || missionsOn) missions().filter(placed).forEach((m) => out.push({ key: 'mission:' + m.id, sel: { kind: 'mission', id: m.id }, lon: m.place.lon, lat: m.place.lat, tone: missionTone(m), label: m.title, sub: m.place.label, chosen: !!(cur && cur.kind === 'mission' && cur.id === m.id) }));
    } else if (view === 'people') {
      const at = {};
      peopleList().forEach((p) => (p.missions || []).forEach((x) => { const m = missionById(x.id); if (placed(m)) { const k = m.id; at[k] = at[k] || { m, people: [] }; at[k].people.push(p.m_uid); } }));
      const mine = cur && cur.kind === 'person' ? cur.id : null;
      Object.values(at).forEach(({ m, people }) => out.push({ key: 'place:' + m.id, sel: { kind: 'mission', id: m.id }, lon: m.place.lon, lat: m.place.lat, tone: mine && people.includes(mine) ? 'amber' : 'cyan', label: (m.place.label || m.title) + ' · ' + people.length, chosen: !!(mine && people.includes(mine)) }));
    } else if (view === 'intel') {
      const cur2 = cur && cur.kind;
      /* a layer's own points are already on the Earth: Halo marks the chosen one, and the evidence that has no layer */
      feedFiltered().filter((f) => fin(f.lat) && fin(f.lon)).slice(0, 80).forEach((f) => {
        const chosen = !!(cur2 && sameSel(cur, f.sel));
        if (f.sel.kind === 'obs' && !chosen) return;
        out.push({ key: 'feed:' + f.key, sel: f.sel, lon: f.lon, lat: f.lat, tone: f.prov === 'calculated' ? 'cyan' : f.prov === 'reference' ? 'white' : 'amber', label: f.sel.kind === 'obs' ? '' : f.title, chosen });
      });
    }
    return out;
  }
  const sameSel = (a, b) => !!(a && b && a.kind === b.kind && (a.id === b.id || (a.kind === 'obs' && a.d && b.d && a.d.title === b.d.title)));
  function drawMarks() {
    if (!marks) return;
    const items = markItems();
    const sig = view + '|' + items.map((i) => i.key + (i.chosen ? '*' : '') + i.tone).join(',');
    if (sig === markSig) return;
    markSig = sig;
    marks.points.removeAll(); marks.labels.removeAll();
    const many = items.length > 14, labelled = [];
    /* the chosen one is labelled first; any other is labelled only with no labelled neighbour within 900 km */
    items.slice().sort((a, b) => (b.chosen ? 1 : 0) - (a.chosen ? 1 : 0)).forEach((i) => {
      const position = C.Cartesian3.fromDegrees(i.lon, i.lat, 0), color = C.Color.fromCssColorString(TONE[i.tone] || TONE.cyan);
      marks.points.add({ position, pixelSize: i.chosen ? 15 : 10, color, outlineColor: i.chosen ? C.Color.WHITE : color.withAlpha(0.32), outlineWidth: i.chosen ? 3 : 6, id: { haloPick: true, layer: 'halo-mark', sel: i.sel } });
      const room = !labelled.some((o) => km(o, i) < 900);
      if (i.label && room && (i.chosen || (!many && view !== 'world'))) {
        labelled.push(i);
        marks.labels.add({ position, text: String(i.label || '').toUpperCase().slice(0, 40) + (i.sub && i.chosen ? '\n' + String(i.sub).slice(0, 40) : ''), font: (i.chosen ? '600 ' : '500 ') + '13px Inter, system-ui, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.fromCssColorString('#020610'), outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: C.HorizontalOrigin.LEFT, verticalOrigin: C.VerticalOrigin.CENTER, pixelOffset: new C.Cartesian2(14, 0), showBackground: false });
      }
    });
    V.scene.requestRender();
  }

  /* ---------- pick: what a tap on the Earth opens ---------- */
  function pick(e) {
    if (!mounted || !e) return false;
    const id = e.id;
    if (id && id.haloPick && id.layer === 'halo-mark' && id.sel) { select(id.sel); openSheetIfPhone(); return true; }
    if (id && id.haloPick && layers) {
      const d = layers.describe(id);
      if (!d) return false;
      G.closeSheet();
      select({ kind: 'obs', id: id.layer + ':' + (id.item && (id.item.id || id.item.hex || id.item.mmsi || (id.item.lon + ',' + id.item.lat))), layer: id.layer, d, item: id.item }, { fly: false });
      return true;
    }
    if (id && id.layer === 'flights' && id.aircraft) {
      const a = id.aircraft;
      G.openAircraft(id);
      addFollow({ label: a.callsign || a.id || 'aircraft', range: 60000, position: () => C.Cartesian3.fromDegrees(a.lon, a.lat, Math.max(0, a.altitude ?? 9000)) });
      return true;
    }
    if (id && id.layer === 'satellites' && id.sat) {
      const sat = id.sat;
      G.openSatellite(sat);
      addFollow({ label: sat.name || 'satellite', range: 900000, position: () => G.satPosition(sat) });
      return true;
    }
    return false;
  }
  function openSheetIfPhone() { /* on a phone a selection opens its detail sheet (data-open), nothing more to do */ }
  function addFollow(target) {
    const b = document.getElementById('cctvBody');
    if (!b) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'cctv-act hx-follow-btn'; btn.textContent = 'Follow';
    btn.onclick = () => { follow(target); G.closeSheet(); };
    b.appendChild(btn);
  }

  /* ---------- search: the owner's own things first, then places ---------- */
  async function search(q) {
    q = String(q || '').trim();
    const list = ui.results;
    if (q.length < 2) { list.hidden = true; return; }
    list.hidden = false;
    const low = q.toLowerCase(), local = [];
    missions().forEach((m) => { if ((m.title || '').toLowerCase().includes(low) || (m.place && (m.place.label || '').toLowerCase().includes(low))) local.push({ label: m.title, kind: 'Mission', go: () => { setView('missions'); select({ kind: 'mission', id: m.id }); } }); });
    peopleList().forEach((p) => { if ((p.name || '').toLowerCase().includes(low)) local.push({ label: p.name, kind: 'Person', go: () => { setView('people'); select({ kind: 'person', id: p.m_uid }); } }); });
    feed().forEach((f) => { if ((f.title + ' ' + (f.place || '')).toLowerCase().includes(low)) local.push({ label: f.title, kind: 'Signal', go: () => { setView('intel'); select(f.sel); } }); });
    const paint = (places, note) => {
      list.innerHTML = '';
      local.slice(0, 6).concat(places).forEach((r) => {
        const li = document.createElement('li'), b = document.createElement('button');
        b.type = 'button'; b.innerHTML = '<span>' + esc(r.label) + '</span><small>' + esc(r.kind) + '</small>';
        b.onclick = () => { list.hidden = true; r.go(); };
        li.appendChild(b); list.appendChild(li);
      });
      if (note) { const li = document.createElement('li'); li.className = 'hx-note'; li.textContent = note; list.appendChild(li); }
    };
    paint([], 'Searching places…');
    let b = null;
    try {
      const t = G.token();
      const r = await fetch(G.api + '/v1/world/geocode?q=' + encodeURIComponent(q.slice(0, 120)), { headers: t ? { accept: 'application/json', authorization: 'Bearer ' + t } : { accept: 'application/json' }, cache: 'no-store' });
      b = r.ok ? await r.json() : null;
    } catch (e) { b = null; }
    if (ui.search.value.trim() !== q) return;
    const places = (b && Array.isArray(b.results) ? b.results : []).filter((x) => x && fin(x.lon) && fin(x.lat)).slice(0, 6)
      .map((x) => ({ label: x.name || (x.lat.toFixed(3) + ', ' + x.lon.toFixed(3)), kind: x.kind || 'Place', go: () => flyToPlace(x) }));
    paint(places, places.length || local.length ? (b && b.attribution ? String(b.attribution).slice(0, 80) : '') : (b ? 'Nothing found.' : 'Place search is unavailable right now.'));
  }
  function flyToPlace(x) {
    if (!V) return;
    stopFollow();
    const bb = Array.isArray(x.bbox) && x.bbox.length === 4 && x.bbox.every(fin) ? x.bbox : null;
    const big = bb && (Math.abs(bb[2] - bb[0]) > 0.02 || Math.abs(bb[3] - bb[1]) > 0.02);
    if (big) V.camera.flyTo({ destination: C.Rectangle.fromDegrees(bb[0], bb[1], bb[2], bb[3]), duration: reduced() ? 0 : 1.6 });
    else V.camera.flyTo({ destination: C.Cartesian3.fromDegrees(x.lon, x.lat, 2500), orientation: { heading: 0, pitch: C.Math.toRadians(-45), roll: 0 }, duration: reduced() ? 0 : 1.8 });
  }

  /* ---------- share a view (owner only, like everything here) ---------- */
  function viewState() {
    if (!V) return { v: view, item: sel };
    const c = V.camera.positionCartographic;
    return { v: view, item: sel && {kind:sel.kind,id:sel.id}, section: tabs.intel, c: [C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude), Math.round(c.height), V.camera.heading, V.camera.pitch].map((x) => Math.round(x * 1e5) / 1e5), s: vision ? vision.get() : 'normal', h: !!(hud && hud.shown()), l: ALL_ITEMS.filter(isOn).map((it) => it.id) };
  }
  function shareLink() {
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify(viewState())))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = new URL(location.href); url.searchParams.set('halo', '1'); url.searchParams.delete('item'); url.searchParams.delete('section'); url.searchParams.delete('hours'); url.searchParams.delete('q'); url.searchParams.delete('sort'); url.hash = 'halo=' + enc;
    return url.toString();
  }
  function readShared() {
    const m = /(?:^#|&)halo=([A-Za-z0-9_-]{1,2000})/.exec(location.hash || '');
    if (!m) return null;
    try { const v = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))))); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
  }
  async function copyShare() {
    const url = shareLink(), out = ui.share;
    try { await navigator.clipboard.writeText(url); out.textContent = 'Link copied. It opens for the owner only.'; }
    catch (e) { out.innerHTML = ''; const i = document.createElement('input'); i.readOnly = true; i.value = url; i.setAttribute('aria-label', 'View link'); out.appendChild(i); i.select(); }
  }
  async function apply(v, fly) {
    if (!v) return;
    if (V && Array.isArray(v.c) && v.c.length === 5 && v.c.every(fin) && Math.abs(v.c[1]) <= 90 && Math.abs(v.c[0]) <= 180) {
      const to = { destination: C.Cartesian3.fromDegrees(v.c[0], v.c[1], Math.max(50, Math.min(4e7, v.c[2]))), orientation: { heading: v.c[3], pitch: v.c[4], roll: 0 } };
      if (fly) V.camera.flyTo(Object.assign(to, { duration: reduced() ? 0 : 1.2 })); else V.camera.setView(to);
    }
    if (VIEWS.includes(v.v)) setView(v.v);
    if (v.item && ['mission','person','evidence','brief','source'].includes(v.item.kind) && typeof v.item.id === 'string') select(v.item,{fly:false});
    if (vision && typeof v.s === 'string') vision.set(v.s);
    if (hud && typeof v.h === 'boolean') hud.show(v.h);
    /* the layer list is the exact state: what it names is on, everything else off (a shared view reproduces as shared) */
    if (Array.isArray(v.l)) for (const it of ALL_ITEMS) { if (it.planned) continue; const want = v.l.includes(it.id); if (want !== isOn(it)) await setItem(it, want); }
    paintTools(); paintVision(); schedulePaint();
  }

  /* ---------- the views' lists ---------- */
  function missionsSorted(list) {
    const rank = (m) => (m.review ? 0 : { active: 1, blocked: 2, planned: 3, completed: 4 }[m.status] ?? 5);
    const by = sorts.missions;
    return list.slice().sort((a, b) => by === 'due' ? (ms(a.ends_at) ?? 9e15) - (ms(b.ends_at) ?? 9e15) : by === 'newest' ? (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0) : rank(a) - rank(b) || (ms(b.updated_at) ?? 0) - (ms(a.updated_at) ?? 0));
  }
  function missionsFiltered() {
    const t = tabs.missions, q = query.missions.toLowerCase();
    return missionsSorted(missions().filter((m) => (t === 'active' ? m.status === 'active' : t === 'planned' ? m.status === 'planned' : t === 'review' ? m.review : m.status === 'blocked' || m.status === 'completed'))
      .filter((m) => !q || ((m.title || '') + ' ' + (m.place ? m.place.label : '') + ' ' + (m.domain || '')).toLowerCase().includes(q)));
  }
  function peopleSorted() {
    const t = tabs.people, q = query.people.toLowerCase();
    return peopleList().filter((p) => (t === 'all' ? true : t === 'mission' ? p.state === 'on_mission' || p.state === 'awaiting_review' : p.state === 'available'))
      .filter((p) => !q || ((p.name || '') + ' ' + (p.headline || '') + ' ' + (p.skills || []).join(' ')).toLowerCase().includes(q))
      .sort((a, b) => sorts.people === 'name' ? String(a.name).localeCompare(String(b.name)) : (ms(b.last_activity_at) ?? 0) - (ms(a.last_activity_at) ?? 0));
  }

  /* the Intelligence feed: what the sources said, each labelled observed, calculated, reported or reference */
  function feed() {
    const out = [];
    evidence().forEach((e) => {
      if (!e || !e.id) return;
      const t = ms(e.observed_at) ?? ms(e.retrieved_at);
      out.push({ key: 'ev:' + e.id, sel: { kind: 'evidence', id: e.id }, title: String(e.title || e.kind || 'Evidence').slice(0, 120), place: e.region_label || '', source: e.publisher || e.attribution || 'Intelligence evidence', icon: 'doc', prov: 'reported', review: e.review_status === 'unreviewed', t, lat: fin(e.lat) ? e.lat : null, lon: fin(e.lon) ? e.lon : null });
    });
    if (layers) {
      layers.items('quakes').filter((q) => fin(q.mag) && q.mag >= 4).sort((a, b) => b.mag - a.mag).slice(0, 12).forEach((q) => {
        const d = layers.describe({ haloPick: true, layer: 'quakes', item: q });
        out.push({ key: 'q:' + q.id, sel: { kind: 'obs', id: 'quakes:' + q.id, layer: 'quakes', d, item: q }, title: 'M' + q.mag.toFixed(1) + ' earthquake', place: q.place, source: 'USGS', icon: 'quake', prov: 'observed', t: ms(q.time), lat: q.lat, lon: q.lon, tone: q.mag >= 6 ? 'red' : 'amber' });
      });
      layers.items('cyclones').forEach((s) => {
        const d = layers.describe({ haloPick: true, layer: 'cyclones', item: s });
        out.push({ key: 'c:' + s.id, sel: { kind: 'obs', id: 'cyclones:' + s.id, layer: 'cyclones', d, item: s }, title: (s.classification || 'Cyclone') + ' ' + (s.name || ''), place: s.basin, source: 'NOAA NHC', icon: 'storm', prov: 'observed', t: (layers.status('cyclones') || {}).fetched || null, lat: s.lat, lon: s.lon });
      });
      layers.items('fires').filter((f) => fin(f.frp)).sort((a, b) => b.frp - a.frp).slice(0, 6).forEach((f, i) => {
        const d = layers.describe({ haloPick: true, layer: 'fires', item: f });
        out.push({ key: 'f:' + i + ':' + f.lon + ',' + f.lat, sel: { kind: 'obs', id: 'fires:' + f.lon + ',' + f.lat, layer: 'fires', d, item: f }, title: 'Thermal hotspot · ' + f.frp.toFixed(0) + ' MW', place: f.lat.toFixed(2) + ', ' + f.lon.toFixed(2), source: 'NASA FIRMS', icon: 'flame', prov: 'observed', t: ms(f.acq), lat: f.lat, lon: f.lon });
      });
      const ships = layers.status('vessels');
      if (ships && ships.state === 'on') out.push({ key: 'ais', sel: { kind: 'source', id: 'vessels' }, title: 'Vessel positions', place: n(ships.count) + ' ships', source: 'AIS feed', icon: 'ship', prov: 'observed', t: ships.fetched || null });
    }
    if (G.layer.on('satellites')) out.push({ key: 'sats', sel: { kind: 'source', id: 'satellites' }, title: 'Satellite positions', place: n(G.layer.count('satellites')) + ' objects', source: 'Orbital model (CelesTrak elements)', icon: 'sat', prov: 'calculated', t: Date.now() });
    return out.sort((a, b) => (b.t ?? 0) - (a.t ?? 0));
  }
  function feedFiltered() {
    const q = query.intel.toLowerCase(), since = Date.now() - hours * 3600e3;
    let rect = null;
    if (area === 'view') { try { rect = V.camera.computeViewRectangle(); } catch (e) { rect = null; } }
    return feed().filter((f) => (f.t === null || f.t === undefined || f.t >= since || f.key === 'ais' || f.key === 'sats'))
      .filter((f) => !q || (f.title + ' ' + (f.place || '') + ' ' + f.source).toLowerCase().includes(q))
      .filter((f) => !rect || !fin(f.lat) || C.Rectangle.contains(rect, C.Cartographic.fromDegrees(f.lon, f.lat)));
  }

  /* ---------- sources (Intelligence → Sources and World → Source health) ---------- */
  function sources() {
    const rows = ALL_ITEMS.filter((it) => !it.planned && !it.globe).map((it) => ({ id: it.id, name: it.label, on: isOn(it), h: isOn(it) ? health(it) : { tone: 'hollow', text: 'Off' }, prov: it.id === 'satellites' ? 'calculated' : it.id === 'tides' ? 'reference' : 'observed' }));
    const hb = body('health'), hs = data.peek('health');
    if (hb || hs.error) {
      const sh = hb && hb.source_health, stale = sh && sh.stale;
      rows.push({ id: 'intel-connector', name: 'Intelligence connector', on: true, prov: 'reported', h: hs.error ? { tone: 'red', text: (hb ? 'Stale data · ' : '') + hs.error } : stale ? { tone: 'amber', text: 'Stale: last success ' + ago(ms(sh.last_success_at)) } : sh && sh.last_success_at ? { tone: 'green', text: 'Updated ' + ago(ms(sh.last_success_at)) } : { tone: 'amber', text: 'No successful run yet' } });
    }
    const ms2 = data.peek('missions');
    rows.push({ id: 'missions-data', name: 'Missions and evidence', on: true, prov: 'reported', h: dataHealth('missions') });
    return rows;
  }

  function dataHealth(key) {
    const s = data.peek(key), b = s.body;
    if (s.error) return { tone: 'red', text: (b ? 'Stale data · ' : '') + s.error };
    if (!b) return { tone: 'mute', text: s.loading ? 'Loading…' : 'Not loaded' };
    const missing = Object.entries(b.sources || {}).filter(([,v]) => v !== 'ok').map(([k]) => k);
    if (b.truncated || missing.length) return { tone: 'amber', text: [b.truncated ? 'Partial results · list capped' : '', missing.length ? 'Unavailable: ' + missing.join(', ') : ''].filter(Boolean).join(' · ') };
    return { tone: 'green', text: 'Updated ' + ago(s.at) };
  }
  function coverage(key) {
    const s = data.peek(key), b = s.body, h = dataHealth(key);
    return '<p class="hx-note" role="status">' + esc(h.text) + (b && fin(b.total) ? ' · Showing ' + n((b.missions || b.people || []).length) + ' of ' + n(b.total) : '') + '</p>';
  }
  function taskLink(task, id) { return 'control.html?haloTask=' + task + (id ? '&amp;mission=' + encodeURIComponent(id) : '') + '#create:action-network'; }
  function briefLink(b) { return BRIEFS + '?from=halo&amp;country=' + encodeURIComponent(b.country || '') + '&amp;day=' + encodeURIComponent(b.day || ''); }
  function rememberRoute(replace = false) {
    if (!mounted) return;
    const u = new URL(location.href); u.searchParams.set('halo', view);
    if (sel && ['mission','person','evidence','brief','source'].includes(sel.kind)) u.searchParams.set('item', sel.kind + ':' + sel.id); else u.searchParams.delete('item');
    if(tabs[view])u.searchParams.set('section',tabs[view]);else u.searchParams.delete('section');
    if(query[view])u.searchParams.set('q',query[view].slice(0,200));else u.searchParams.delete('q');
    if(sorts[view])u.searchParams.set('sort',sorts[view]);else u.searchParams.delete('sort');
    u.searchParams.set('hours',String(hours));
    if (u.href !== location.href) { if (routeReady && !restoringRoute && !replace) history.pushState(null, '', u); else history.replaceState(null, '', u); }
  }

  /* ---------- painting ---------- */
  function schedulePaint() {
    if (paintQueued || !mounted) return;
    paintQueued = true;
    /* not on the animation frame: the panels must not wait for the Earth's next render, which can be slow */
    setTimeout(() => { paintQueued = false; if (mounted) paint(); }, 0);
  }
  function paint() {
    paintStrip(); paintList(); drawMarks(); paintDetail(); paintTimeline(); paintOperator(); paintBase();
    if (!V) $$('[data-fly],[data-follow],[data-toggle-source]',ui.right).forEach(b => b.disabled = true);
  }

  function stat(v, label, tone, title) { return '<li data-tone="' + (tone || 'cyan') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><b>' + esc(v) + '</b>' + esc(label) + '</li>'; }
  function paintStrip() {
    const c = (body('missions') || {}).counts || null, pb = body('people'), pc = pb && pb.counts, ok = !!c;
    const v = (x) => (ok && fin(x) ? n(x) : '—');
    let html = '';
    if (view === 'world') {
      html = stat(v(c && c.active), 'Active missions') + stat(pb && fin(pb.online) ? n(pb.online) : '—', 'Members online', 'ink', 'Shown only when five or more are online') + stat(v(c && c.review), 'Awaiting review', 'amber');
    } else if (view === 'missions') {
      html = stat(v(c && c.active), 'Active') + stat(v(c && c.blocked), 'Paused', 'amber') + stat(v(c && c.review), 'Awaiting review', 'amber') + stat(v(c && c.completed), 'Closed', 'ink');
    } else if (view === 'people') {
      const pv = (x) => (pc && fin(x) ? n(x) : '—');
      html = stat(pv(pc && pc.people), 'People') + stat(pb && fin(pb.online) ? n(pb.online) : '—', 'Online', 'ink', 'Shown only when five or more are online') + stat(pv(pc && pc.on_mission), 'On missions', 'ink') + stat(pv(pc && pc.awaiting_review), 'Awaiting review', 'amber');
    } else {
      const s = sources().filter((r) => r.on), need = evidence().filter((e) => e.review_status === 'unreviewed').length;
      html = stat(n(s.length), 'Enabled sources') + stat(n(need), 'Need review', 'amber') + stat(n(s.filter((r) => r.h.tone === 'amber').length), 'Partial or stale', 'amber') + stat(n(s.filter((r) => r.h.tone === 'red').length), 'Unavailable', 'red');
    }
    if (ui.stats.innerHTML !== html) ui.stats.innerHTML = html;
    const meta = META[view];
    ui.title.innerHTML = '<h1>' + esc(meta.title) + '</h1><p>' + esc(meta.sub) + '</p>';
    const act = view === 'missions' ? { href: taskLink('missions'), text: 'New mission' } : view === 'people' ? { href: taskLink('missions'), text: 'Manage missions' } : view === 'intel' ? { href: BRIEFS, text: 'Daily briefs' } : null;
    ui.action.hidden = !act;
    if (act) { ui.action.href = act.href; ui.action.innerHTML = ICON.plus + esc(act.text); }
    const bad = ['missions', 'people', 'evidence', 'health'].some((k) => ['red','amber'].includes(dataHealth(k).tone));
    ui.live.dataset.state = bad || !body('missions') ? 'warn' : 'ok';
    ui.live.title = bad ? 'Some owner data could not be refreshed' : 'Data loaded; see source health for coverage';
  }
  function paintClock() { if (ui.clock) ui.clock.textContent = hhmm(Date.now()) + ' UTC'; }
  function paintOperator() {
    const b = body('profile'), p = b && b.profile, name = (p && p.display_name) || 'Owner';
    const html = avatar(name, p && p.avatar_url);
    if (ui.opAvatar.dataset.sig !== html) { ui.opAvatar.dataset.sig = html; ui.opAvatar.outerHTML = html.replace('class="hx-avatar"', 'class="hx-avatar" data-op'); ui.opAvatar = $('[data-op]', ui.root); ui.opAvatar.dataset.sig = html; }
    ui.operator.setAttribute('aria-label', 'Account: ' + name);
  }

  /* the left panel: built once per view, its list repainted when what it shows changes */
  function buildLeft() {
    const head = { world: ['World data', ''], missions: ['Missions', ''], people: ['Team', ''], intel: ['Intelligence feed', ''] }[view];
    ui.leftTitle.textContent = head[0];
    ui.leftBody.innerHTML = '';
    listSig = '';
    if (view === 'world') {
      ui.leftBody.innerHTML = '<button type="button" class="hx-btn" data-camera-list>Browse camera snapshots</button><p class="hx-note">Listed cameras are not guaranteed live streams.</p><ul class="hx-groups">' + GROUPS.map((g) => '<li class="hx-group" data-group="' + g.id + '"><div class="hx-group__row"><span class="hx-group__icon">' + ICON[g.icon] + '</span><span><span class="hx-group__name">' + esc(g.name) + '</span><span class="hx-group__sub">' + esc(g.items.slice(0, 3).map((i) => i.short || i.label).join(' · ') + (g.items.length > 3 ? ' +' + (g.items.length - 3) : '')) + '</span></span><label class="hx-switch"><input type="checkbox" aria-label="' + esc(g.name) + ': all available layers"><i></i></label><button type="button" class="hx-disclose" aria-expanded="false" aria-controls="hxg-' + g.id + '" aria-label="Show ' + esc(g.name) + ' layers">' + ICON.down + '</button></div>' +
        '<ul class="hx-layers" id="hxg-' + g.id + '" hidden>' + g.items.map((it) => '<li class="hx-layer" data-item="' + it.id + '" data-state="off"><span class="hx-layer__name">' + esc(it.label) + '</span><span class="hx-layer__state" aria-live="polite"></span><label class="hx-switch"><input type="checkbox" aria-label="' + esc(it.label) + '"' + (it.planned ? ' disabled' : '') + '><i></i></label></li>').join('') + '</ul></li>').join('') + '</ul>' +
        '<div class="hx-section"><p class="hx-label">Source health</p><ul class="hx-health"></ul><button type="button" class="hx-more" data-go="sources">View all sources ' + ICON.arrow + '</button></div>';
      const cam = $('[data-camera-list]', ui.leftBody); if (cam) cam.onclick = () => { select(null); G.cameras(); };
      GROUPS.forEach((g) => {
        const li = $('[data-group="' + g.id + '"]', ui.leftBody), dis = $('.hx-disclose', li), list = $('.hx-layers', li);
        const open = (o) => { dis.setAttribute('aria-expanded', o ? 'true' : 'false'); list.hidden = !o; expanded[g.id] = o; };
        open(!!expanded[g.id]);
        dis.onclick = () => { open(list.hidden); savePrefs(); };
        $('.hx-group__row .hx-switch input', li).onchange = async (e) => { const on = e.target.checked; for (const it of g.items) if (!it.planned) await setItem(it, on); paintWorld(); };
        g.items.forEach((it) => { const box = $('[data-item="' + it.id + '"] input', li); box.onchange = async () => { await setItem(it, box.checked); paintWorld(); }; });
      });
      $('[data-go="sources"]', ui.leftBody).onclick = () => { tabs.intel = 'sources'; setView('intel'); };
    } else {
      const placeholder = { missions: 'Find a mission…', people: 'Search people, roles, skills…', intel: 'Search signals and sources…' }[view];
      const segs = { missions: [['active', 'Active'], ['planned', 'Planned'], ['review', 'Review']], people: [['all', 'All'], ['mission', 'Assigned'], ['available', 'Available']], intel: [['feed', 'Feed'], ['briefs', 'Briefs'], ['sources', 'Sources']] }[view];
      let filters = '';
      if (view === 'missions') filters = '<div class="hx-filters"><label class="hx-filter">' + ICON.sort + '<span class="hx-sr">Sort</span><select data-sort="missions"><option value="priority">Priority</option><option value="due">Due date</option><option value="newest">Newest</option></select></label></div>';
      if (view === 'people') filters = '<div class="hx-filters"><label class="hx-filter">' + ICON.sort + '<span class="hx-sr">Sort</span><select data-sort="people"><option value="activity">Last activity</option><option value="name">Name</option></select></label></div>';
      if (view === 'intel') filters = '<div class="hx-filters"><label class="hx-filter">' + ICON.filter + '<span class="hx-sr">Area</span><select data-area><option value="earth">Whole Earth</option><option value="view">In view</option></select></label><label class="hx-filter">' + ICON.clock + '<span class="hx-sr">Time</span><select data-hours><option value="1">Last hour</option><option value="6">Last 6 hours</option><option value="24">Last 24 hours</option></select></label></div>';
      ui.leftBody.innerHTML = '<label class="hx-find">' + ICON.search + '<span class="hx-sr">' + esc(placeholder) + '</span><input type="search" autocomplete="off" maxlength="80" placeholder="' + esc(placeholder) + '"></label>' +
        '<div class="hx-seg" role="tablist" aria-label="' + esc(head[0]) + '">' + segs.map(([k, l]) => '<button type="button" role="tab" data-seg="' + k + '" aria-selected="false">' + esc(l) + ' <span class="hx-count">0</span></button>').join('') + '</div>' + filters + '<div class="hx-list"></div>';
      const input = $('.hx-find input', ui.leftBody);
      input.value = query[view];
      input.oninput = () => { query[view] = input.value; rememberRoute(true); schedulePaint(); };
      $$('[data-seg]', ui.leftBody).forEach((b) => { b.onclick = () => { tabs[view] = b.dataset.seg; if (!sel || !sel.pinned) sel = null; rememberRoute(); schedulePaint(); }; });
      const s = $('[data-sort]', ui.leftBody); if (s) { s.value = sorts[view]; s.onchange = () => { sorts[view] = s.value; rememberRoute(); schedulePaint(); }; }
      const a = $('[data-area]', ui.leftBody); if (a) { a.value = area; a.onchange = () => { area = a.value; schedulePaint(); }; }
      const hsel = $('[data-hours]', ui.leftBody); if (hsel) { hsel.value = String(hours); hsel.onchange = () => setHours(+hsel.value); }
    }
  }
  function paintWorld() {
    const items = ALL_ITEMS;
    let avail = 0;
    items.forEach((it) => { if (!it.planned) avail++; });
    ui.leftSub.textContent = avail + ' available · ' + CONTEXT.length + ' context';
    GROUPS.forEach((g) => {
      const li = $('[data-group="' + g.id + '"]', ui.leftBody);
      if (!li) return;
      const live = g.items.filter((it) => !it.planned), on = live.filter(isOn);
      const box = $('.hx-group__row .hx-switch input', li);
      box.checked = on.length > 0; box.indeterminate = on.length > 0 && on.length < live.length; box.disabled = !live.length;
      g.items.forEach((it) => {
        const row = $('[data-item="' + it.id + '"]', li), st = stateOf(it);
        row.dataset.state = st.state; $('input', row).checked = isOn(it);
        $('.hx-layer__state', row).textContent = st.text;
        $('input', row).disabled = st.state === 'locked' || (!V && !it.own);
      });
    });
    const hl = $('.hx-health', ui.leftBody), on = ALL_ITEMS.filter((it) => !it.planned && isOn(it));
    const rows = on.slice(0, 5).map((it) => { const h = health(it), g = GROUPS.find((x) => x.items.includes(it)); return '<li><span class="hx-group__icon">' + ICON[it.id === 'tides' ? 'wave' : it.id === 'satellites' ? 'sat' : it.own ? 'db' : g.icon] + '</span><span><b>' + esc(it.label) + '</b><small><span class="hx-dot" data-tone="' + h.tone + '"></span>' + esc(h.text) + '</small></span></li>'; }).join('');
    const html = rows || '<li><span class="hx-group__icon">' + ICON.layers + '</span><span><b>No layers on</b><small>Turn a group on above to watch its source here.</small></span></li>';
    if (hl.innerHTML !== html) hl.innerHTML = html;
  }

  function missionCard(m, cur) {
    const p = missionProgress(m), team = (m.team || []), c = m.counts || {};
    const faces = team.slice(0, 3).map((t) => avatar(t.name, t.avatar_url)).join('');
    const who = team.length ? esc(String(team[0].name || '').split(/\s+/)[0]) + (team.length > 1 ? ' +' + (team.length - 1) : '') : 'No one yet';
    return '<li><button type="button" class="hx-card" data-sel="mission:' + esc(m.id) + '" aria-current="' + (cur ? 'true' : 'false') + '">' +
      '<span class="hx-thumb" data-tone="' + missionTone(m) + '">' + ICON.flag + '</span><span>' +
      '<span class="hx-card__title">' + esc(m.title) + '</span><span class="hx-card__place">' + esc(placed(m) ? m.place.label : 'No place on the map') + '</span>' +
      '<span class="hx-status" data-tone="' + missionTone(m) + '">' + esc(m.review ? 'Evidence ready' : missionWord(m)) + '</span>' +
      '<span class="hx-bar"><i style="width:' + p.pct + '%"></i></span>' +
      '<span class="hx-card__meta"><span>' + (p.known ? n(p.done) : '—') + ' of ' + (p.known ? n(p.total) : '—') + ' verified' + (fin(c.pending_proofs) && c.pending_proofs ? ' · ' + n(c.pending_proofs) + ' to review' : '') + '</span><span>' + esc(m.ends_at ? 'Due ' + due(m.ends_at) : '') + '</span></span>' +
      '<span class="hx-faces"><span>' + faces + '</span>' + who + '</span></span>' + ICON.chev.replace('<svg', '<svg class="hx-card__chev"') + '</button></li>';
  }
  function personRow(p, cur) {
    const state = { on_mission: ['On mission', 'cyan'], awaiting_review: ['Awaiting review', 'amber'], available: ['Available', 'green'] }[p.state] || ['Unknown', 'mute'];
    const m = (p.missions || [])[0];
    return '<li><button type="button" class="hx-person" data-sel="person:' + esc(p.m_uid) + '" aria-current="' + (cur ? 'true' : 'false') + '">' + avatar(p.name, p.avatar_url) +
      '<span><span class="hx-person__top"><span><span class="hx-person__name">' + esc(p.name || 'Member') + '</span><span class="hx-person__role">' + esc(p.headline || roleWord(p.role)) + '</span></span><span class="hx-pill" data-tone="' + state[1] + '">' + esc(state[0]) + '</span></span>' +
      '<span class="hx-person__meta"><span>' + esc(m ? m.title : 'No mission') + '</span><span>' + esc(p.last_activity_at ? ago(ms(p.last_activity_at)) : 'No activity yet') + '</span></span></span>' + ICON.chev.replace('<svg', '<svg class="hx-card__chev"') + '</button></li>';
  }
  const roleWord = (r) => ({ owner: 'House owner', admin: 'House admin', member: 'House team', participant: 'Mission participant' }[r] || 'Member');
  function feedCard(f, cur) {
    const prov = { observed: ['Observed', 'cyan'], calculated: ['Calculated', 'cyan'], reported: ['Reported', 'mute'], reference: ['Reference', 'mute'] }[f.prov] || ['Observed', 'cyan'];
    return '<li><button type="button" class="hx-card" data-feed="' + esc(f.key) + '" aria-current="' + (cur ? 'true' : 'false') + '"><span class="hx-thumb" data-tone="' + (f.tone || (f.prov === 'calculated' ? 'cyan' : 'amber')) + '">' + ICON[f.icon] + '</span><span>' +
      '<span class="hx-card__title">' + esc(f.title) + '</span><span class="hx-card__place">' + esc(f.place || '') + '</span><span class="hx-card__place">' + esc(f.source) + '</span>' +
      '<span class="hx-card__meta"><span><span class="hx-status" data-tone="' + prov[1] + '">' + esc(prov[0]) + '</span>' + (f.review ? ' <span class="hx-status" data-tone="amber">Needs review</span>' : '') + '</span><span>' + esc(fin(f.t) ? ago(f.t) : '') + '</span></span></span>' + ICON.chev.replace('<svg', '<svg class="hx-card__chev"') + '</button></li>';
  }
  function empty(title, text) { return '<div class="hx-empty"><b>' + esc(title) + '</b>' + esc(text) + '</div>'; }
  function loadingOr(key, title, text) {
    const s = data.peek(key);
    if (!s.body && s.loading) return empty('Loading…', '');
    if (!s.body && s.error) return empty(s.error === 'not deployed' ? 'Not deployed yet' : 'Could not load', s.error === 'not deployed' ? 'This source is not available yet.' : 'This source could not be refreshed. Retry or check again shortly.');
    return empty(title, text);
  }
  function paintList() {
    if (view === 'world') { paintWorld(); return; }
    const cur = current(), list = $('.hx-list', ui.leftBody);
    if (!list) return;
    const counts = {};
    let html = '';
    if (view === 'missions') {
      const all = missions();
      counts.active = all.filter((m) => m.status === 'active').length; counts.planned = all.filter((m) => m.status === 'planned').length; counts.review = all.filter((m) => m.review).length;
      const rows = missionsFiltered();
      html = rows.length ? '<ul class="hx-cards">' + rows.map((m) => missionCard(m, cur && cur.kind === 'mission' && cur.id === m.id)).join('') + '</ul>' : loadingOr('missions', 'No missions here', tabs.missions === 'review' ? 'Nothing is waiting for review.' : 'Missions are written in the Control Room.');
      const closed = all.filter((m) => m.status === 'blocked' || m.status === 'completed').length;
      html += tabs.missions === 'closed' ? '<button type="button" class="hx-more" data-closed="0">' + ICON.arrow.replace('<svg', '<svg style="transform:scaleX(-1)"') + ' Back to active missions</button>' : '<button type="button" class="hx-more" data-closed="1">View paused and closed (' + n(closed) + ') ' + ICON.arrow + '</button>';
      html = coverage('missions') + html; ui.leftSub.textContent = n(all.length) + ' missions';
    } else if (view === 'people') {
      const all = peopleList();
      counts.all = all.length; counts.mission = all.filter((p) => p.state === 'on_mission' || p.state === 'awaiting_review').length; counts.available = all.filter((p) => p.state === 'available').length;
      const rows = peopleSorted();
      html = rows.length ? '<ul class="hx-people">' + rows.map((p) => personRow(p, cur && cur.kind === 'person' && cur.id === p.m_uid)).join('') + '</ul>' : loadingOr('people', 'No one here yet', 'People appear when they join a mission or the house team.');
      html += '<p class="hx-note">' + ICON.lock.replace('<svg', '<svg width="12" height="12" style="vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:1.8"') + ' No one has shared a location with Halo. The Earth shows mission places, never a person.</p>';
      html = coverage('people') + html; ui.leftSub.textContent = 'Showing ' + n(rows.length) + ' of ' + n(all.length);
    } else {
      const f = feedFiltered(), briefs = (data.peekBriefs().body || {}).briefs || [], src = sources();
      counts.feed = f.length; counts.briefs = briefs.length; counts.sources = src.length;
      if (tabs.intel === 'feed') html = f.length ? '<ul class="hx-cards">' + f.map((x) => feedCard(x, cur && sameSel(cur, x.sel))).join('') + '</ul>' : empty('Nothing in this window', 'Turn on Earthquakes, Thermal or Cyclones in World, widen the time, or wait for evidence to arrive.');
      else if (tabs.intel === 'briefs') html = briefs.length ? '<ul class="hx-cards">' + briefs.map((b) => '<li><button type="button" class="hx-card" data-brief="' + esc(b.country) + '" aria-current="' + (cur && cur.kind === 'brief' && cur.id === b.country ? 'true' : 'false') + '"><span class="hx-thumb">' + ICON.doc + '</span><span><span class="hx-card__title">' + esc(b.country_name || b.country) + '</span><span class="hx-card__place">' + esc(String(b.overview || '').slice(0, 90)) + '</span><span class="hx-card__meta"><span class="hx-status" data-tone="' + (b.status === 'ready' || b.status === 'published' ? 'green' : 'amber') + '">' + esc(b.editorial_status || b.status || '') + '</span><span>' + esc(b.day || '') + '</span></span></span>' + ICON.chev.replace('<svg', '<svg class="hx-card__chev"') + '</button></li>').join('') + '</ul>' : (data.peekBriefs().loading ? empty('Loading…', '') : empty('No briefs yet', 'Daily country briefs are written through the day.'));
      else html = '<ul class="hx-health">' + src.map((r) => '<li><span class="hx-group__icon">' + ICON[r.id === 'satellites' ? 'sat' : r.id === 'tides' ? 'wave' : r.id === 'missions-data' ? 'flag' : 'db'] + '</span><button type="button" class="hx-more" style="display:block;text-align:left;width:100%" data-source="' + esc(r.id) + '"><b>' + esc(r.name) + '</b><small><span class="hx-dot" data-tone="' + r.h.tone + '"></span>' + esc(r.h.text) + '</small></button></li>').join('') + '</ul><a class="hx-more" href="' + BRIEFS + '">Open the daily briefs ' + ICON.arrow + '</a>';
      html = (tabs.intel === 'briefs' ? coverage('briefs') : coverage('evidence')) + html;
      ui.leftSub.textContent = tabs.intel === 'feed' ? n(f.length) + ' signals' : tabs.intel === 'briefs' ? n(briefs.length) + ' briefs' : n(src.length) + ' sources';
    }
    $$('[data-seg]', ui.leftBody).forEach((b) => { b.setAttribute('aria-selected', b.dataset.seg === tabs[view] ? 'true' : 'false'); $('.hx-count', b).textContent = n(counts[b.dataset.seg] || 0); });
    if (html === listSig) return;
    listSig = html;
    list.innerHTML = html;
    $$('[data-sel]', list).forEach((b) => { b.onclick = () => { const [k, ...rest] = b.dataset.sel.split(':'); select({ kind: k, id: rest.join(':') }); }; });
    $$('[data-feed]', list).forEach((b) => { b.onclick = () => { const f = feed().find((x) => x.key === b.dataset.feed); if (f) select(f.sel); }; });
    $$('[data-brief]', list).forEach((b) => { b.onclick = () => select({ kind: 'brief', id: b.dataset.brief }, { fly: false }); });
    $$('[data-source]', list).forEach((b) => { b.onclick = () => select({ kind: 'source', id: b.dataset.source }, { fly: false }); });
    $$('[data-closed]', list).forEach((b) => { b.onclick = () => { tabs.missions = b.dataset.closed === '1' ? 'closed' : 'active'; rememberRoute(); schedulePaint(); }; });
  }

  /* ---------- the detail panel ---------- */
  const dl = (rows) => '<dl class="hx-rows">' + rows.filter(Boolean).map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>';
  const pill = (text, tone, dot) => '<span class="hx-pill' + (dot ? ' hx-pill--dot' : '') + '" data-tone="' + tone + '">' + esc(text) + '</span>';
  function dtabsHtml(list) { return '<div class="hx-dtabs" role="tablist">' + list.map(([k, l]) => '<button type="button" role="tab" data-dtab="' + k + '" aria-selected="' + (dtab === k ? 'true' : 'false') + '">' + esc(l) + '</button>').join('') + '</div>'; }
  function head(crumb, title, place, pills) {
    return '<div class="hx-detail__top"><p class="hx-crumb">' + esc(crumb) + '</p><button type="button" class="hx-close" aria-label="Close"><span>×</span></button></div><h2>' + esc(title) + '</h2>' + (place ? '<p class="hx-place">' + esc(place) + '</p>' : '') + (pills ? '<div class="hx-pills">' + pills + '</div>' : '');
  }
  function nearMissions(lat, lon, limit) {
    if (!fin(lat) || !fin(lon)) return [];
    return missions().filter(placed).map((m) => ({ m, d: km({ lat, lon }, m.place) })).filter((x) => x.d <= 300).sort((a, b) => a.d - b.d).slice(0, limit || 3);
  }
  function missionLink(m, note) {
    return '<button type="button" class="hx-card" data-sel="mission:' + esc(m.id) + '" style="grid-template-columns:48px minmax(0,1fr) 20px;min-height:64px;padding:10px 0"><span class="hx-thumb" style="width:48px;height:48px" data-tone="' + missionTone(m) + '">' + ICON.flag + '</span><span><span class="hx-card__title">' + esc(m.title) + '</span><span class="hx-card__place">' + esc(note || (placed(m) ? m.place.label : '')) + '</span><span class="hx-status" data-tone="' + missionTone(m) + '">' + esc(m.review ? 'Evidence ready' : missionWord(m)) + '</span></span>' + ICON.chev.replace('<svg', '<svg class="hx-card__chev"') + '</button>';
  }
  function evidenceList(items) {
    return '<ul class="hx-evidence">' + items.map((e) => {
      const kind = { photo: 'image', video: 'image', link: 'link', text: 'doc', artifact: 'doc' }[e.type] || 'doc';
      const tone = e.status === 'pending' ? 'amber' : e.status === 'verified' ? 'green' : 'red';
      const thumb = thumbs[e.id] ? '<img src="' + esc(thumbs[e.id]) + '" alt="">' : ICON[kind];
      return '<li><span class="hx-thumb" data-proof="' + esc(e.id) + '" data-type="' + esc(e.type || '') + '">' + thumb + '</span>' + ICON[kind].replace('<svg', '<svg class="hx-ico"') + '<span>' + esc(cap(e.type || 'Evidence')) + '<small>' + esc((e.by ? e.by + ' · ' : '') + (e.statement || '')) + '</small><small><span class="hx-status" data-tone="' + tone + '" style="margin:0">' + esc(e.status || '') + '</span></small></span><time>' + esc(ms(e.created_at) ? hhmm(ms(e.created_at)) : '') + '</time></li>';
    }).join('') + '</ul>';
  }
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  /* a mission's page is a page of this site (mnet.html?mission=…), never a script or another host */
  const sitePath = (p) => typeof p === 'string' && /^[a-z0-9_-]+\.html(\?[a-z0-9_=&%.-]*)?$/i.test(p);
  /* photo proofs: the Worker's short-lived signed link, fetched only when the owner opens the mission */
  function loadThumbs(root) {
    $$('[data-proof][data-type="photo"]', root).forEach(async (el) => {
      const id = el.dataset.proof;
      if (thumbs[id] !== undefined) return;
      thumbs[id] = null;
      try {
        const t = G.token();
        const r = await fetch(G.api + '/v1/mnet/missions/proofs/' + encodeURIComponent(id) + '/media', { headers: { accept: 'application/json', authorization: 'Bearer ' + t }, cache: 'no-store' });
        const b = r.ok ? await r.json() : null;
        if (b && typeof b.url === 'string' && /^https:\/\//.test(b.url)) { thumbs[id] = b.url; const img = document.createElement('img'); img.alt = ''; img.src = b.url; el.textContent = ''; el.appendChild(img); }
      } catch (e) { /* the icon stays */ }
    });
  }

  function detailMission(m) {
    const p = missionProgress(m), team = m.team || [], ev = m.evidence || [], c = m.counts || {};
    const last = Math.max(0, ...ev.map((e) => ms(e.created_at) || 0), ...team.map((t) => ms(t.since) || 0));
    const pills = pill(m.review ? 'Evidence ready' : missionWord(m), missionTone(m), true) + (m.domain ? pill(m.domain, 'mute') : '');
    let html = head('Mission / ' + shortId(m.id), m.title, placed(m) ? m.place.label : 'No place on the map', pills);
    html += dtabsHtml([['overview', 'Overview'], ['team', 'Team'], ['evidence', 'Evidence'], ['activity', 'Activity']]);
    const teamGrid = (list) => '<ul class="hx-team">' + list.map((t) => '<li>' + avatar(t.name, t.avatar_url, '<i data-tone="' + ({ verified: 'green', submitted: 'amber', in_progress: 'cyan' }[t.status] || 'mute') + '"></i>') + '<span>' + esc(String(t.name || 'Member').split(/\s+/)[0]) + '</span></li>').join('') + '</ul>';
    if (dtab === 'overview') {
      html += (m.description ? '<p class="hx-lead">' + esc(String(m.description).split('\n')[0].slice(0, 160)) + '</p>' : '') +
        '<div class="hx-bar" style="height:6px;margin-top:12px"><i style="width:' + p.pct + '%"></i></div><div class="hx-progress"><span>' + (p.known ? n(p.done) : '—') + ' of ' + (p.known ? n(p.total) : '—') + ' verified</span><span>' + (p.known ? p.pct + '%' : '—') + '</span></div>' +
        '<dl class="hx-kv"><div><dt>Team</dt><dd>' + n(c.joined || team.length) + (fin(m.capacity) ? ' of ' + n(m.capacity) : '') + '</dd></div><div><dt>Due</dt><dd>' + esc(due(m.ends_at)) + '</dd></div></dl>' +
        '<div class="hx-section" style="border-top:0;margin-top:4px"><p class="hx-label">Team</p>' + (team.length ? teamGrid(team.slice(0, 6)) + '<p class="hx-note">' + esc(last ? 'Last activity ' + ago(last) : '') + '</p>' : '<p class="hx-note">No one has joined yet.</p>') + '</div>' +
        '<div class="hx-section"><p class="hx-label">Next steps</p><ul class="hx-chips" style="display:grid;gap:6px">' + nextSteps(m).map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div>' +
        (ev.length ? '<div class="hx-section"><p class="hx-label">Recent evidence · ' + n(ev.length) + (ev.length === 1 ? ' item' : ' items') + '</p>' + evidenceList(ev.slice(0, 3)) + '</div>' : '');
    } else if (dtab === 'team') html += team.length ? '<div class="hx-section" style="border-top:0">' + teamGrid(team) + dl(team.map((t) => [t.name || 'Member', cap(String(t.status || '').replace('_', ' ')) + (t.since ? ' · ' + ago(ms(t.since)) : '')])) + '</div>' : '<p class="hx-note">No one has joined yet.</p>';
    else if (dtab === 'evidence') html += ev.length ? '<div class="hx-section" style="border-top:0">' + evidenceList(ev) + '</div>' : '<p class="hx-note">No evidence submitted yet.</p>';
    else html += '<div class="hx-section" style="border-top:0">' + activityList(missionEvents(m)) + '</div>';
    const foot = (m.review ? '<a class="hx-cta" href="' + taskLink('reviews', m.id) + '">Review evidence ' + ICON.arrow + '</a>' : '<a class="hx-cta" href="' + taskLink('missions', m.id) + '">Open in the Control Room ' + ICON.arrow + '</a>') +
      '<div class="hx-pair">' + (sitePath(m.path) ? '<a class="hx-btn" href="' + esc(m.path) + '">Open mission</a>' : '<button type="button" class="hx-btn" disabled title="Not published">Open mission</button>') + '<button type="button" class="hx-btn" data-history>' + ICON.clock + 'Activity</button></div>';
    return { html, foot };
  }
  function nextSteps(m) {
    const out = [], c = m.counts || {};
    if (fin(c.pending_proofs) && c.pending_proofs) out.push('Review ' + n(c.pending_proofs) + ' submitted ' + (c.pending_proofs === 1 ? 'proof' : 'proofs'));
    if (m.status === 'planned') out.push('Draft: publish it in the Control Room when it is ready');
    if (m.status === 'blocked') out.push('Paused: resume or close it in the Control Room');
    if (m.status === 'active' && !(c.joined > 0)) out.push('No one has joined yet');
    if (m.status === 'active' && !placed(m)) out.push('Give it a place so it shows on the Earth');
    if (!out.length) out.push(m.status === 'completed' ? 'Closed' : 'Nothing waiting on you');
    return out;
  }
  function detailPerson(p) {
    const state = { on_mission: ['On mission', 'cyan'], awaiting_review: ['Awaiting review', 'amber'], available: ['Available', 'green'] }[p.state] || ['Unknown', 'mute'];
    let html = '<div class="hx-detail__top"><p class="hx-crumb">Team member</p><button type="button" class="hx-close" aria-label="Close"><span>×</span></button></div>' +
      '<div style="display:grid;grid-template-columns:80px minmax(0,1fr);gap:14px;align-items:center;margin-top:6px">' + avatar(p.name, p.avatar_url).replace('class="hx-avatar"', 'class="hx-avatar" style="width:80px;height:80px;font-size:24px"') +
      '<div><h2 style="margin:0">' + esc(p.name || 'Member') + '</h2><p class="hx-place">' + esc(p.headline || roleWord(p.role)) + '</p></div></div><div class="hx-pills">' + pill(state[0], state[1], true) + pill(roleWord(p.role), 'mute') + '</div>';
    html += dtabsHtml([['overview', 'Overview'], ['assignments', 'Assignments'], ['activity', 'Activity']]);
    const mine = (p.missions || []).map((x) => ({ x, m: missionById(x.id) }));
    const subs = missions().flatMap((m) => (m.evidence || []).filter((e) => e.m_uid && e.m_uid === p.m_uid).map((e) => Object.assign({ mission: m.title }, e)));
    if (dtab === 'overview') {
      const first = mine.find((y) => y.m);
      html += '<div class="hx-section" style="border-top:0;margin-top:6px"><p class="hx-label">Current mission</p>' + (first ? missionLink(first.m, cap(String(first.x.status || '').replace('_', ' '))) + (() => { const pr = missionProgress(first.m); return '<div class="hx-bar"><i style="width:' + pr.pct + '%"></i></div><div class="hx-progress"><span>Mission progress · ' + n(pr.done) + ' of ' + n(pr.total) + ' verified</span><span>' + esc(due(first.m.ends_at)) + '</span></div>'; })() : '<p class="hx-note">Not on a mission.</p>') + '</div>' +
        '<div class="hx-section"><p class="hx-label">Last activity</p>' + dl([['Activity', p.last_activity ? cap(p.last_activity) : 'None yet'], ['When', p.last_activity_at ? ago(ms(p.last_activity_at)) + ' · ' + hhmm(ms(p.last_activity_at)) + ' UTC' : '—'], ['Location', 'Not shared']]) + '<p class="hx-note">' + ICON.lock.replace('<svg', '<svg width="12" height="12" style="vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:1.8"') + ' Halo never shows where a person is; no one has shared a location.</p></div>' +
        ((p.skills || []).length ? '<div class="hx-section"><p class="hx-label">Skills</p><ul class="hx-chips">' + p.skills.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div>' : '') +
        (subs.length ? '<div class="hx-section"><p class="hx-label">Recent submissions</p>' + evidenceList(subs.slice(0, 4)) + '</div>' : '');
    } else if (dtab === 'assignments') html += mine.length ? '<div class="hx-section" style="border-top:0">' + mine.map((y) => y.m ? missionLink(y.m, cap(String(y.x.status || '').replace('_', ' '))) : '<p class="hx-note">' + esc(y.x.title || 'A mission') + '</p>').join('') + '</div>' : '<p class="hx-note">No assignments.</p>';
    else html += '<div class="hx-section" style="border-top:0">' + activityList(personEvents(p)) + '</div>';
    const first = mine.find((y) => y.m);
    const foot = '<div class="hx-pair">' + (first ? '<button type="button" class="hx-btn" data-sel="mission:' + esc(first.m.id) + '">View mission</button>' : '<button type="button" class="hx-btn" disabled>View mission</button>') + '<a class="hx-btn" href="' + CONTROL + '">Control Room</a></div>';
    return { html, foot };
  }
  function detailObs(s) {
    const d = s.d, it = s.item || {}, prov = layers ? layers.provenance(s.layer) : 'observed';
    const pills = pill(cap(prov), prov === 'observed' ? 'cyan' : 'mute', true) + (layers && layers.status(s.layer) && layers.status(s.layer).stale ? pill('Stale', 'amber', true) : '');
    let html = head('Selected observation', d.title, it.place || (fin(it.lat) ? it.lat.toFixed(3) + ', ' + it.lon.toFixed(3) : ''), pills);
    html += dtabsHtml([['overview', 'Overview'], ['sources', 'Source']]);
    if (dtab === 'overview') {
      const big = s.layer === 'quakes' && fin(it.mag) ? ['Magnitude', it.mag.toFixed(1), ''] : s.layer === 'cyclones' && fin(it.intensity) ? ['Wind', Math.round(it.intensity), 'kt'] : s.layer === 'fires' && fin(it.frp) ? ['Radiative power', it.frp.toFixed(1), 'MW'] : null;
      if (d.tide) html += '<div class="hx-section" style="border-top:0" data-tide="' + esc(d.tide) + '"><p class="hx-label">Water level</p><p class="hx-note">Loading the last 24 hours…</p></div>';
      else if (big) html += '<div class="hx-section" style="border-top:0"><p class="hx-label">' + esc(big[0]) + '</p><p class="hx-big">' + esc(big[1]) + (big[2] ? '<small>' + esc(big[2]) + '</small>' : '') + '</p></div>';
      html += dl(d.rows) + '<p class="hx-note">' + esc(d.note) + '</p>';
      const near = fin(it.lat) ? nearMissions(it.lat, it.lon, 2) : [];
      if (near.length) html += '<div class="hx-section"><p class="hx-label">Missions within 300 km</p>' + near.map((x) => missionLink(x.m, Math.round(x.d) + ' km away')).join('') + '</div>';
    } else html += dl([['Source', d.credit || ''], ['Provenance', cap(prov)], ['Retrieved', layers && layers.status(s.layer) && layers.status(s.layer).fetched ? ago(layers.status(s.layer).fetched) : '—']]);
    const foot = (d.link ? '<a class="hx-cta" href="' + esc(d.link) + '" target="_blank" rel="noopener noreferrer">View source ' + ICON.external + '</a>' : '') + '<div class="hx-pair"><button type="button" class="hx-btn" data-follow>' + ICON.locate + 'Follow</button><button type="button" class="hx-btn" data-fly>' + ICON.pin + 'Go there</button></div>';
    return { html, foot };
  }
  function detailEvidence(e) {
    const pills = pill('Reported', 'mute', true) + (e.review_status === 'unreviewed' ? pill('Needs review', 'amber', true) : e.review_status ? pill(cap(e.review_status), e.review_status === 'accepted' ? 'green' : 'red', true) : '');
    let html = head('Evidence / ' + esc(e.kind || 'record'), String(e.title || 'Evidence').slice(0, 160), e.region_label || '', pills);
    html += (e.summary ? '<p class="hx-lead" style="font-size:14.5px;color:var(--hx-ink-2)">' + esc(String(e.summary).slice(0, 400)) + '</p>' : '') +
      dl([['Publisher', e.publisher || '—'], ['Observed', e.observed_at ? new Date(e.observed_at).toUTCString().slice(5, 22) + ' UTC' : '—'], ['Retrieved', e.retrieved_at ? ago(ms(e.retrieved_at)) : '—'], ['Licence', e.license || '—'], ['Location from', e.geo_source || '—']]);
    const near = nearMissions(e.lat, e.lon, 2);
    if (near.length) html += '<div class="hx-section"><p class="hx-label">Missions within 300 km</p>' + near.map((x) => missionLink(x.m, Math.round(x.d) + ' km away')).join('') + '</div>';
    const url = typeof e.source_url === 'string' && /^https:\/\//.test(e.source_url) ? e.source_url : '';
    const foot = (e.review_status === 'unreviewed' ? '<p class="hx-note">Needs review. Review actions are not available in this view.</p>' : '') + '<div class="hx-pair">' + (url ? '<a class="hx-btn" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + ICON.external + 'View source</a>' : '<button type="button" class="hx-btn" disabled>View source</button>') + '<button type="button" class="hx-btn" data-fly' + (fin(e.lat) ? '' : ' disabled') + '>' + ICON.pin + 'Go there</button></div>';
    return { html, foot };
  }
  function detailBrief(code) {
    const b = ((data.peekBriefs().body || {}).briefs || []).find((x) => x.country === code);
    if (!b) return null;
    const list = (a) => (Array.isArray(a) && a.length ? '<ul>' + a.slice(0, 6).map((x) => '<li>' + esc(typeof x === 'string' ? x : x && (x.text || x.title) || '') + '</li>').join('') + '</ul>' : '');
    let html = head('Daily brief / ' + (b.day || ''), b.country_name || b.country, '', pill(b.editorial_status || b.status || 'Brief', 'mute', true));
    html += '<div class="hx-brief"><p>' + esc(b.overview || '') + '</p>' + (b.happened && b.happened.length ? '<p class="hx-label">What happened</p>' + list(b.happened) : '') + (b.may_mean && b.may_mean.length ? '<p class="hx-label">What it may mean</p>' + list(b.may_mean) : '') + (b.uncertain && b.uncertain.length ? '<p class="hx-label">Uncertain</p>' + list(b.uncertain) : '') +
      (Array.isArray(b.sources) && b.sources.length ? '<p class="hx-label">Sources</p><ul>' + b.sources.slice(0, 8).map((x) => '<li>' + (x && /^https:\/\//.test(x.url || '') ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title || x.domain || x.url) + '</a>' : esc(x && x.title || '')) + '</li>').join('') + '</ul>' : '') + '</div>';
    return { html, foot: '<a class="hx-btn" href="' + briefLink(b) + '">Open this brief</a>' };
  }
  function detailSource(id) {
    const r = sources().find((x) => x.id === id);
    if (!r) return null;
    const it = ALL_ITEMS.find((x) => x.id === id);
    const html = head('Source', r.name, cap(r.prov), pill(r.h.text, r.h.tone === 'green' ? 'green' : r.h.tone === 'red' ? 'red' : r.h.tone === 'cyan' ? 'cyan' : 'amber', true)) +
      dl([['State', r.on ? 'On' : 'Off'], ['Kind', cap(r.prov)], it && layers && layers.status(it.id) ? ['Credit', layers.status(it.id).credit || '—'] : null, it && stateOf(it).text ? ['Holding', stateOf(it).text] : null]) +
      '<p class="hx-note">' + esc(r.prov === 'calculated' ? 'Positions are calculated from published orbital elements; they are not imagery.' : r.prov === 'reference' ? 'Reference data: where the stations are, not a reading.' : 'Each point is what the provider reported; missing reports do not mean absence.') + '</p>';
    const foot = it && !it.planned ? '<button type="button" class="hx-btn" data-toggle-source="' + esc(id) + '">' + (isOn(it) ? 'Turn off' : 'Turn on') + '</button>' : '';
    return { html, foot };
  }
  function paintDetail() {
    const cur = current();
    document.documentElement.dataset.haloDetail = sel ? 'open' : 'closed';
    ui.right.dataset.open = sel ? 'true' : 'false';
    const resolve = () => {
      if (!cur) return { html: '<div class="hx-detail__top"><p class="hx-crumb">Nothing selected</p></div>' + empty('Select a list item or map pin', 'Its detail opens here, with what its source said and how fresh it is.'), foot: '' };
      if (cur.kind === 'mission') { const m = missionById(cur.id); return m ? detailMission(m) : null; }
      if (cur.kind === 'person') { const p = personById(cur.id); return p ? detailPerson(p) : null; }
      if (cur.kind === 'obs') return detailObs(cur);
      if (cur.kind === 'evidence') { const e = evidence().find((x) => x.id === cur.id); return e ? detailEvidence(e) : null; }
      if (cur.kind === 'brief') return detailBrief(cur.id);
      if (cur.kind === 'source') return detailSource(cur.id);
      return null;
    };
    const out = resolve() || { html: '<div class="hx-detail__top"><p class="hx-crumb">Gone</p><button type="button" class="hx-close" aria-label="Close"><span>×</span></button></div>' + empty('No longer here', 'It left the source’s latest answer.'), foot: '' };
    const sig = out.html + '|' + out.foot;
    if (sig === detailSig) return;
    detailSig = sig;
    const top = ui.detailBody.scrollTop;
    ui.detailBody.innerHTML = out.html; ui.detailFoot.innerHTML = out.foot;
    if (cur && sel && cur === sel) ui.detailBody.scrollTop = top;
    const close = $('.hx-close', ui.detailBody); if (close) close.onclick = () => select(null);
    $$('[data-dtab]', ui.detailBody).forEach((b) => { b.onclick = () => { dtab = b.dataset.dtab; detailSig = ''; paintDetail(); }; });
    $$('[data-sel]', ui.right).forEach((b) => { b.onclick = () => { const [k, ...rest] = b.dataset.sel.split(':'); if (k === 'mission' && view !== 'missions' && view !== 'world') setView('missions'); select({ kind: k, id: rest.join(':') }); }; });
    const hist = $('[data-history]', ui.detailFoot); if (hist) hist.onclick = () => { dtab = 'activity'; detailSig = ''; paintDetail(); };
    const fol = $('[data-follow]', ui.detailFoot); if (fol && cur && cur.d) fol.onclick = () => follow({ label: cur.d.title, range: cur.d.range, position: cur.d.position });
    const fly = $('[data-fly]', ui.detailFoot); if (fly) fly.onclick = () => { const at = whereIs(cur); if (at) flyTo(at.lon, at.lat, at.close || 1.5e6); };
    const tog = $('[data-toggle-source]', ui.detailFoot); if (tog) tog.onclick = async () => { const it = ALL_ITEMS.find((x) => x.id === tog.dataset.toggleSource); if (it) { await setItem(it, !isOn(it)); detailSig = ''; schedulePaint(); } };
    loadThumbs(ui.detailBody);
    const tideBox = $('[data-tide]', ui.detailBody);
    if (tideBox) paintTide(tideBox, tideBox.dataset.tide);
  }
  async function paintTide(box, id) {
    const b = await data.tide(id);
    if (!box.isConnected) return;
    if (!b || !Array.isArray(b.observations)) { box.innerHTML = '<p class="hx-label">Water level</p><p class="hx-note">' + esc(data.peekTide(id).error === 'not deployed' ? 'Water levels are not available yet.' : 'NOAA did not answer for this station.') + '</p>'; return; }
    const pts = b.observations.map((o) => [ms(o[0]), o[1]]).filter((p) => fin(p[0]) && fin(p[1]));
    const latest = b.latest && fin(b.latest.value) ? b.latest : null;
    box.innerHTML = '<p class="hx-label">Water level</p>' + (latest ? '<p class="hx-big">' + latest.value.toFixed(2) + '<small>' + esc(b.units || 'm') + '</small></p><p class="hx-note">' + esc((b.datum || 'MLLW') + ' datum · ' + (latest.quality || '') + ' · observed ' + ago(ms(latest.observed_at))) + '</p>' : '<p class="hx-note">No recent reading.</p>') + '<div data-chart></div><p class="hx-note">' + esc(b.note || 'Observed water level, not a tide prediction.') + '</p>';
    if (window.HaloChart) HaloChart.line($('[data-chart]', box), pts, { unit: b.units || 'm', label: 'Water level (' + (b.datum || 'MLLW') + ')', decimals: 2 });
  }

  /* ---------- the timeline ---------- */
  function missionEvents(m) {
    const out = [];
    (m.evidence || []).forEach((e) => { const t = ms(e.created_at); if (t) out.push({ t, label: cap(e.type || 'Evidence') + ' received · ' + m.title, tone: e.status === 'pending' ? 'amber' : 'cyan', sel: { kind: 'mission', id: m.id } }); });
    (m.team || []).forEach((p) => { const t = ms(p.since); if (t) out.push({ t, label: (p.name || 'Someone') + ' ' + (p.status === 'verified' ? 'verified' : p.status === 'submitted' ? 'submitted' : 'joined') + ' · ' + m.title, tone: 'cyan', sel: { kind: 'mission', id: m.id } }); });
    return out;
  }
  function personEvents(p) {
    const out = [];
    const t = ms(p.last_activity_at);
    if (t) out.push({ t, label: (p.name || 'Member') + ' ' + (p.last_activity || 'was active'), tone: p.state === 'awaiting_review' ? 'amber' : 'cyan', sel: { kind: 'person', id: p.m_uid } });
    missions().forEach((m) => (m.evidence || []).forEach((e) => { if (e.m_uid && e.m_uid === p.m_uid && ms(e.created_at)) out.push({ t: ms(e.created_at), label: (p.name || 'Member') + ' submitted ' + (e.type || 'evidence'), tone: 'amber', sel: { kind: 'person', id: p.m_uid } }); }));
    return out;
  }
  function events() {
    let ev = [];
    if (view === 'missions' || view === 'world') missions().forEach((m) => { ev = ev.concat(missionEvents(m)); });
    if (view === 'people') peopleList().forEach((p) => { ev = ev.concat(personEvents(p)); });
    if (view === 'intel' || view === 'world') feed().filter((f) => fin(f.t) && f.key !== 'sats' && f.key !== 'ais').forEach((f) => ev.push({ t: f.t, label: f.title + (f.place ? ' · ' + f.place : ''), tone: f.review ? 'amber' : f.tone || 'cyan', sel: f.sel }));
    if (timelineFor) ev = ev.filter((e) => sameSel(e.sel, timelineFor));
    return ev;
  }
  function activityList(ev) {
    if (!ev.length) return '<p class="hx-note">No activity recorded yet.</p>';
    return dl(ev.sort((a, b) => b.t - a.t).slice(0, 20).map((e) => [hhmm(e.t) + ' UTC · ' + ago(e.t), e.label]));
  }
  function setHours(h) {
    hours = [1, 6, 24].includes(h) ? h : 24;
    if (ui.window) ui.window.value = String(hours);
    const hs = $('[data-hours]', ui.leftBody); if (hs) hs.value = String(hours);
    savePrefs(); rememberRoute(); schedulePaint();
  }
  function paintTimeline() {
    ui.timeTitle.textContent = META[view].time;
    const now = Date.now(), span = hours * 3600e3, from = now - span, axis = ui.axis;
    const ev = events().filter((e) => e.t >= from && e.t <= now + 60e3).sort((a, b) => a.t - b.t).slice(-60);
    const step = hours === 1 ? 15 * 60e3 : hours === 6 ? 3600e3 : 4 * 3600e3;
    const ticksHtml = [];
    for (let t = Math.ceil(from / (step / (hours === 1 ? 3 : 4))) * (step / (hours === 1 ? 3 : 4)); t <= now; t += step / (hours === 1 ? 3 : 4)) {
      const major = Math.abs(t % step) < 1;
      const room = (axis.clientWidth || 300) * step / span >= 52;
      ticksHtml.push('<span class="hx-axis__tick" style="left:' + ((t - from) / span * 100).toFixed(3) + '%' + (major ? '' : ';height:5px;top:calc(50% - 2px)') + '">' + (major && room && (t - from) / span > 0.06 ? '<b>' + hhmm(t) + '</b>' : '') + '</span>');
    }
    /* events closer than a dot's width share one dot that counts them; a tap opens the latest */
    const cur = current(), px = Math.max(1, axis.clientWidth || 300), groups = [];
    ev.forEach((e) => { const x = (e.t - from) / span * px, g = groups[groups.length - 1]; if (g && x - g.x < 16) { g.list.push(e); g.x = x; } else groups.push({ x, list: [e] }); });
    const dots = groups.map((g, i) => {
      const e = g.list[g.list.length - 1], tone = g.list.some((x) => x.tone === 'red') ? 'red' : g.list.some((x) => x.tone === 'amber') ? 'amber' : 'cyan';
      const label = g.list.length > 1 ? g.list.length + ' events · latest ' + hhmm(e.t) + ' UTC: ' + e.label : hhmm(e.t) + ' UTC: ' + e.label;
      return '<button type="button" class="hx-axis__ev" data-ev="' + i + '" data-tone="' + tone + '" aria-pressed="' + (cur && g.list.some((x) => sameSel(cur, x.sel)) ? 'true' : 'false') + '" style="left:' + (g.x / px * 100).toFixed(3) + '%" aria-label="' + esc(label) + '">' + (g.list.length > 1 ? '<span>' + g.list.length + '</span>' : '') + '</button>';
    }).join('');
    const html = '<span class="hx-axis__line"></span>' + ticksHtml.join('') + dots + '<span class="hx-axis__now" style="left:100%" title="Now"></span><span class="hx-axis__flag"></span>' + (ev.length ? '' : '<p class="hx-axis__empty">Nothing in the last ' + (hours === 1 ? 'hour' : hours + ' hours') + '</p>');
    if (axis.dataset.sig === html) return;
    axis.dataset.sig = html; axis.innerHTML = html;
    const flag = $('.hx-axis__flag', axis);
    const show = (b, g) => {
      const e = g.list[g.list.length - 1], at = parseFloat(b.style.left);
      flag.textContent = (g.list.length > 1 ? g.list.length + ' events · ' : '') + hhmm(e.t) + ' · ' + e.label;
      /* the label stays inside the axis: right-aligned near now, left-aligned near the start */
      flag.style.left = b.style.left; flag.style.transform = at > 70 ? 'translateX(calc(-100% + 14px))' : at < 30 ? 'translateX(-14px)' : 'translateX(-50%)';
      flag.dataset.show = 'true';
    };
    $$('[data-ev]', axis).forEach((b) => {
      const g = groups[+b.dataset.ev];
      b.onmouseenter = () => show(b, g); b.onfocus = () => show(b, g);
      b.onmouseleave = () => { flag.dataset.show = 'false'; }; b.onblur = b.onmouseleave;
      b.onclick = () => { show(b, g); select(g.list[g.list.length - 1].sel); };
    });
    const latest = groups.filter((g) => g.list.some((x) => x.tone === 'amber')).pop() || groups[groups.length - 1];
    if (latest && wide()) { const b = $('[data-ev="' + groups.indexOf(latest) + '"]', axis); if (b) show(b, latest); }
  }

  /* ---------- the Layers menu (map style, vision, HUD, tools) ---------- */
  function paintVision() {
    if (!ui.root || !vision) return;
    const c = vision.get();
    $$('[data-style]', ui.root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === c ? 'true' : 'false'));
  }
  function paintTools() {
    if (!ui.root) return;
    const set = (k, on) => { const b = $('[data-tool="' + k + '"]', ui.root); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    set('hud', !!(hud && hud.shown())); set('orbit', !!orbitTick);
    const stop = $('[data-tool="stop"]', ui.root); if (stop) stop.hidden = !followTarget;
    const orbit = $('[data-tool="orbit"]', ui.root); if (orbit) orbit.disabled = !V || reduced();
  }
  function setPop(open) {
    ui.pop.hidden = !open;
    ui.layersBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) ui.results.hidden = true;
  }

  /* ---------- the frame ---------- */
  /* the same World door the bar gives everyone (js/tabbar.js MCC_BAR.navigation.world), this site's World page without it */
  function feedHref() {
    const w = window.MCC_BAR && window.MCC_BAR.navigation && window.MCC_BAR.navigation.world;
    return typeof w === 'string' && /^(https:\/\/[a-z0-9.-]*mccluster\.org\/|[a-z0-9-]+\.html)/i.test(w) ? w : 'mnet.html?view=feed';
  }
  /* Mobile-only immersive globe. The panel and timeline return without changing
     any source, map selection or camera coordinates. */
  function setMapFocus(on) {
    mapFocus = !!on && !wide();
    document.documentElement.dataset.haloMap = mapFocus ? 'focus' : 'split';
    if (mapFocus) {
      sheetOpen = false;
      ui.left.dataset.expanded = 'false';
      $('.hx-grip', ui.root).setAttribute('aria-label', 'Expand the list');
      $('.hx-collapse', ui.root).setAttribute('aria-label', 'Expand the panel');
      setPop(false);
    }
    if (ui.mapFocus) {
      ui.mapFocus.setAttribute('aria-pressed', mapFocus ? 'true' : 'false');
      ui.mapFocus.setAttribute('aria-label', mapFocus ? 'Show the data drawer and timeline' : 'Expand the interactive globe');
      $('span', ui.mapFocus).textContent = mapFocus ? 'Show panels' : 'Full globe';
    }
    /* Keep camera position while Cesium resizes its canvas to the new layout. */
    if (mounted && V) requestAnimationFrame(() => {
      if (mounted) { V.resize(); V.scene.requestRender(); }
    });
  }
  function onViewportResize() {
    if (wide() && mapFocus) setMapFocus(false);
  }
  function build() {
    const root = document.createElement('div');
    root.className = 'hx'; root.id = 'haloShell';
    const styles = (V && window.HaloVision ? HaloVision.STYLES : []).map((s) => '<button type="button" data-style="' + esc(s.id) + '" aria-pressed="false"><span>' + esc(s.label) + '</span><kbd>' + esc(s.key) + '</kbd></button>').join('');
    const base = '<div class="hx-base" role="group" aria-label="Base map"><button type="button" data-base="sat" aria-pressed="true">Satellite</button><button type="button" data-base="map" aria-pressed="false">Map</button><button type="button" data-base="3d" aria-pressed="false">3D cities</button></div>';
    root.innerHTML =
      '<div class="hx-top" role="banner"><div class="hx-top__row"><a class="hx-brand" href="action-globe.html?explore=1&amp;halo=1" aria-label="Hitman’s Halo"><img src="assets/img/hm-mark-96.png" alt="" width="96" height="96"><span>Hitman’s Halo</span></a>' +
      /* the World feed, one tap away: the owner's bar globe opens Halo, so Halo carries the way to the World (2026-10-22) */
      '<a class="hx-feed" href="' + esc(feedHref()) + '" aria-label="Open the World feed"><span class="hx-feed__short">Feed</span><span class="hx-feed__long">World feed</span></a>' +
      '<button type="button" class="hx-operator"><span class="hx-operator__label">Owner</span>' + ICON.down + '<span class="hx-avatar" data-op>?</span></button></div>' +
      '<div class="hx-tabs" role="tablist" aria-label="Halo">' + VIEWS.map((v) => '<button type="button" role="tab" id="hxTab-' + v + '" data-view="' + v + '" aria-controls="hxLeft" aria-selected="false">' + esc(META[v].tab) + '</button>').join('') + '</div></div>' +
      '<div class="hx-strip"><div class="hx-title"></div><div class="hx-clock"><time></time><span class="hx-live" role="img" aria-label="Connection"></span></div><ul class="hx-stats" aria-label="Counts"></ul><a class="hx-action" href="#" hidden></a></div>' +
      '<section class="hx-left hx-panel" id="hxLeft" role="tabpanel" aria-labelledby="hxTab-world" data-expanded="false"><button type="button" class="hx-grip" aria-label="Expand the list"></button><div class="hx-panel__head"><div><h2></h2><p></p></div><button type="button" class="hx-collapse" aria-label="Expand the panel"><span>' + ICON.up + '</span></button></div><div class="hx-panel__body"></div></section>' +
      '<div class="hx-map"><form class="hx-search" role="search">' + ICON.search + '<input type="search" name="q" aria-label="Search places, missions, people" placeholder="Search places, missions, people…" autocomplete="off" maxlength="120" enterkeyhint="search"></form><ul class="hx-results" hidden></ul>' +
      '<button type="button" class="hx-layers-btn" aria-expanded="false" aria-controls="hxPop">' + ICON.layers + 'Layers</button>' +
      '<button type="button" class="hx-map-focus" aria-pressed="false" aria-label="Expand the interactive globe">' + ICON.expand + '<span>Full globe</span></button>' +
      '<div class="hx-pop" id="hxPop" hidden><p class="hx-label">Base map</p>' + base + '<p class="hx-label">Vision</p><div class="hx-styles">' + styles + '</div>' +
      '<div class="hx-tools" style="margin-top:6px"><button type="button" class="hx-tool" data-fx="sharpen" aria-pressed="false">Sharpen</button><button type="button" class="hx-tool" data-fx="bloom" aria-pressed="false">Bloom</button></div><p class="hx-note">Visual treatments only: they change how the Earth looks, not what any sensor saw.</p>' +
      '<p class="hx-label">Tools</p><div class="hx-tools"><button type="button" class="hx-tool" data-tool="hud" aria-pressed="false">Telemetry HUD <kbd>H</kbd></button><button type="button" class="hx-tool" data-tool="orbit" aria-pressed="false">Orbit <kbd>O</kbd></button><button type="button" class="hx-tool" data-tool="stop" hidden>Stop following <kbd>Esc</kbd></button><button type="button" class="hx-tool" data-tool="share">Copy a link to this view</button><button type="button" class="hx-tool" data-tool="home">Back to the whole Earth</button></div><p class="hx-share" aria-live="polite"></p></div>' +
      '<div class="hx-ctl" role="toolbar" aria-label="Globe controls" aria-orientation="vertical"><button type="button" class="hx-compass" data-ctl="north" aria-label="Face north">' + ICON.north + '<b>N</b></button><button type="button" data-ctl="in" aria-label="Zoom in">' + ICON.plus + '</button><button type="button" data-ctl="out" aria-label="Zoom out">' + ICON.minus + '</button><button type="button" data-ctl="locate" aria-label="Near me (approximate)">' + ICON.locate + '</button></div>' +
      '<p class="hx-hint"><span class="hx-hint__narrow">' + ICON.hand + 'Drag to turn · Pinch to zoom</span><span class="hx-hint__wide">' + ICON.mouse + 'Drag to orbit · Scroll to zoom</span></p><ul class="hx-legend" aria-label="Legend"></ul>' + base + '</div>' +
      '<section class="hx-right hx-panel hx-detail" aria-label="Detail" data-open="false"><div class="hx-detail__body"></div><div class="hx-detail__foot"></div></section>' +
      '<section class="hx-time" aria-label="Activity timeline"><h2></h2><div class="hx-time__mode" role="group" aria-label="Timeline mode"><button type="button" aria-pressed="true">Current</button><button type="button" disabled title="Replay is not available yet">Replay</button></div><div class="hx-axis"></div><label><span class="hx-sr">Window</span><select class="hx-window"><option value="1">Last 1 h</option><option value="6">Last 6 h</option><option value="24">Last 24 h</option></select></label></section>' +
      '<div class="hx-follow" hidden><span>Following <b></b></span><button type="button">Stop</button></div><div class="hx-hud-host"></div>';
    document.body.appendChild(root);
    ui = {
      root, map: $('.hx-map', root), stats: $('.hx-stats', root), title: $('.hx-title', root), action: $('.hx-action', root), clock: $('.hx-clock time', root), live: $('.hx-live', root),
      operator: $('.hx-operator', root), opAvatar: $('[data-op]', root), left: $('.hx-left', root), leftTitle: $('.hx-panel__head h2', root), leftSub: $('.hx-panel__head p', root), leftBody: $('.hx-panel__body', root),
      right: $('.hx-right', root), detailBody: $('.hx-detail__body', root), detailFoot: $('.hx-detail__foot', root), search: $('.hx-search input', root), results: $('.hx-results', root),
      layersBtn: $('.hx-layers-btn', root), mapFocus: $('.hx-map-focus', root), pop: $('.hx-pop', root), share: $('.hx-share', root), legend: $('.hx-legend', root), compass: $('.hx-compass svg', root),
      timeTitle: $('.hx-time h2', root), axis: $('.hx-axis', root), window: $('.hx-window', root), follow: $('.hx-follow', root), hudHost: $('.hx-hud-host', root)
    };
    $$('.hx-tabs [role="tab"]', root).forEach((b) => {
      b.onclick = () => setView(b.dataset.view);
      b.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const i = VIEWS.indexOf(b.dataset.view), next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
        setView(next); $('#hxTab-' + next).focus();
      };
    });
    const refresh = document.createElement('button'); refresh.type='button'; refresh.className='hx-btn'; refresh.textContent='Refresh data'; refresh.onclick=async()=>{refresh.disabled=true;try{await data.retry();await data.briefs(true);}finally{refresh.disabled=false;schedulePaint();}}; ui.leftTitle.after(refresh);
    ui.operator.onclick = () => { const chip = document.getElementById('mccAuthChip'); if (chip) chip.click(); else location.href = 'account.html'; };
    const toggleSheet = () => {
      if (wide()) { collapsed = !collapsed; ui.left.dataset.collapsed = collapsed ? 'true' : 'false'; savePrefs(); }
      else { sheetOpen = !sheetOpen; ui.left.dataset.expanded = sheetOpen ? 'true' : 'false'; }
      const open = wide() ? !collapsed : sheetOpen;
      $('.hx-grip', root).setAttribute('aria-label', open ? 'Shrink the list' : 'Expand the list');
      $('.hx-collapse', root).setAttribute('aria-label', open ? 'Collapse the panel' : 'Expand the panel');
    };
    $('.hx-grip', root).onclick = toggleSheet; $('.hx-collapse', root).onclick = toggleSheet;
    $('.hx-search', root).onsubmit = (e) => { e.preventDefault(); search(ui.search.value); };
    let typing = 0;
    ui.search.oninput = () => { clearTimeout(typing); typing = setTimeout(() => search(ui.search.value), 350); };
    ui.layersBtn.onclick = () => setPop(ui.pop.hidden);
    ui.mapFocus.onclick = () => setMapFocus(!mapFocus);
    $$('[data-base]', root).forEach((b) => { b.onclick = () => setBase(b.dataset.base); });
    $$('[data-style]', root).forEach((b) => { b.onclick = () => { if (vision) vision.set(b.dataset.style); paintVision(); savePrefs(); }; });
    $$('[data-fx]', root).forEach((b) => { b.onclick = () => { if (!vision) return; const on = b.getAttribute('aria-pressed') !== 'true'; b.dataset.fx === 'sharpen' ? vision.setSharpen(on) : vision.setBloom(on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }; });
    $('[data-tool="hud"]', root).onclick = () => { if (hud) hud.show(!hud.shown()); paintTools(); savePrefs(); };
    $('[data-tool="orbit"]', root).onclick = () => setOrbit(!orbitTick);
    $('[data-tool="stop"]', root).onclick = stopFollow;
    $('[data-tool="share"]', root).onclick = copyShare;
    $('[data-tool="home"]', root).onclick = () => { stopFollow(); setOrbit(false); G.home(); };
    $$('[data-ctl]', root).forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.ctl;
        if (k === 'in' || k === 'out') { if (G.zoom) G.zoom(k === 'in'); }
        else if (k === 'locate') { if (G.locate) G.locate(); }
        else { stopFollow(); const c = V.camera.positionCartographic; V.camera.flyTo({ destination: C.Cartesian3.fromRadians(c.longitude, c.latitude, c.height), orientation: { heading: 0, pitch: V.camera.pitch, roll: 0 }, duration: reduced() ? 0 : 0.6 }); }
      };
    });
    ui.window.onchange = () => setHours(+ui.window.value);
    $('button', ui.follow).onclick = stopFollow;
    document.addEventListener('click', onDocClick, true);
  }
  function onDocClick(e) {
    if (!ui.root) return;
    if (!ui.pop.hidden && !ui.pop.contains(e.target) && !ui.layersBtn.contains(e.target)) setPop(false);
    if (!ui.results.hidden && !ui.results.contains(e.target) && !$('.hx-search', ui.root).contains(e.target)) ui.results.hidden = true;
  }
  function paintLegend() {
    const L = {
      world: missionsOn ? [['cyan', 'Active'], ['amber', 'Evidence ready'], ['red', 'Paused']] : [],
      missions: [['cyan', 'Active'], ['amber', 'Evidence ready'], ['red', 'Paused'], ['hollow', 'Selected']],
      people: [['cyan', 'Mission place'], ['amber', 'Selected person’s mission']],
      intel: [['amber', 'Observed'], ['cyan', 'Calculated'], ['hollow', 'Reference']]
    }[view];
    const html = L.map(([t, l]) => '<li><span class="hx-dot" data-tone="' + t + '"></span>' + esc(l) + '</li>').join('');
    if (ui.legend.innerHTML !== html) ui.legend.innerHTML = html;
  }
  function setView(next) {
    if (mapFocus) setMapFocus(false); /* switching views restores the data preview */
    if (!VIEWS.includes(next)) next = 'world';
    const changed = next !== view || !ui.leftBody.childElementCount;
    view = next;
    document.documentElement.dataset.haloView = view;
    $$('.hx-tabs [role="tab"]', ui.root).forEach((b) => { const on = b.dataset.view === view; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    ui.left.setAttribute('aria-labelledby', 'hxTab-' + view);
    if (changed) {
      if (sel && !(view === 'world' || (view === 'missions' && sel.kind === 'mission') || (view === 'people' && sel.kind === 'person') || (view === 'intel' && ['obs', 'evidence', 'brief', 'source', 'feed'].includes(sel.kind)))) select(null);
      timelineFor = null; markSig = ''; detailSig = '';
      buildLeft();
      /* Intelligence reads the Earth's own observations: earthquakes and cyclones come on with it */
      if (view === 'intel') { if (layers) ['quakes', 'cyclones'].forEach((id) => { if (!layers.on(id)) layers.set(id, true); }); data.get('evidence'); data.get('health'); data.briefs().then(schedulePaint); }
      if (view === 'missions' || view === 'world') data.get('missions');
      if (view === 'people') { data.get('people'); data.get('missions'); }
    }
    paintLegend(); savePrefs(); rememberRoute(); schedulePaint();
  }

  function readRouteFilters(q) {
    const v=q.get('halo'),section=q.get('section');
    const allowed={missions:['active','planned','review','closed'],people:['all','mission','available'],intel:['feed','briefs','sources']};
    if(allowed[v]){if(allowed[v].includes(section))tabs[v]=section;query[v]=(q.get('q')||'').slice(0,200);}
    if(['priority','due','title','newest','activity','name'].includes(q.get('sort'))&&sorts[v])sorts[v]=q.get('sort');
    if([1,6,24].includes(+q.get('hours')))hours=+q.get('hours');
  }
  function restoreRoute() {
    if(!mounted)return;restoringRoute=true;const q=new URLSearchParams(location.search),v=q.get('halo'),item=q.get('item')||'';
    readRouteFilters(q);
    if(ui.window)ui.window.value=String(hours);
    setView(VIEWS.includes(v)?v:'world');buildLeft();
    if(/^(mission|person|evidence|brief|source):.{1,150}$/.test(item)){const [kind,...id]=item.split(':');select({kind,id:id.join(':')},{fly:false});}else select(null,{fly:false});restoringRoute=false;
  }
  function onKey(e) {
    if (!mounted || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (e.key === 'Escape') {
      if (!ui.pop.hidden) { setPop(false); ui.layersBtn.focus(); return; }
      if (!ui.results.hidden) { ui.results.hidden = true; return; }
      if (followTarget) { stopFollow(); return; }
      if (orbitTick) { setOrbit(false); return; }
      if (sel) { select(null, { fly: false }); return; }
      return;
    }
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const style = window.HaloVision && HaloVision.STYLES.find((s) => s.key === e.key);
    if (style && vision) { vision.set(style.id); paintVision(); savePrefs(); return; }
    if (e.key === 'h' || e.key === 'H') { if (hud) { hud.show(!hud.shown()); paintTools(); savePrefs(); } return; }
    if (e.key === 'o' || e.key === 'O') setOrbit(!orbitTick);
  }
  function onCamera() {
    if (V && ui.compass) ui.compass.style.transform = 'rotate(' + (-C.Math.toDegrees(V.camera.heading)).toFixed(1) + 'deg)';
  }

  function mount(globe, opts) {
    if (mounted) return;
    G = globe; V = G && G.viewer(); C = window.Cesium;
    if (!G || !G.owner()) return;
    mounted = true;
    const html = document.documentElement;
    html.classList.add('halo-on'); html.classList.toggle('halo-no-map', !V); document.title='Hitman’s Halo · McCluster';
    /* the Earth in space, as on the owner's screens: stars on, the World's own mission pins step aside for Halo's */
    if (V) saved = { sky: V.scene.skyBox ? V.scene.skyBox.show : null, bg: V.scene.backgroundColor.clone(), missions: G.missions ? G.missions.shown() : null };
    if (V && V.scene.skyBox) V.scene.skyBox.show = true;
    if (V) V.scene.backgroundColor = C.Color.fromCssColorString('#020610');
    if (V && G.missions) G.missions.show(false);
    vision = V && window.HaloVision ? HaloVision.mount(V) : null;
    layers = V && window.HaloLayers ? HaloLayers.create(G) : null;
    data = window.HaloData ? HaloData.create(G) : null;
    build();
    setMapFocus(false);
    hud = V && window.HaloHud ? HaloHud.mount(V, ui.hudHost) : null;
    if (V) marks = { points: V.scene.primitives.add(new C.PointPrimitiveCollection()), labels: V.scene.primitives.add(new C.LabelCollection()) };
    if (layers) offs.push(layers.onChange(() => schedulePaint()));
    if (data) offs.push(data.on(() => schedulePaint()));
    document.addEventListener('keydown', onKey); window.addEventListener('popstate', restoreRoute);
    window.addEventListener('resize', onViewportResize);
    if (V) V.camera.changed.addEventListener(onCamera);
    const p = prefs(), shared = readShared(), route = new URLSearchParams(location.search);
    readRouteFilters(route);
    expanded = p.expanded && typeof p.expanded === 'object' ? p.expanded : { air: true };
    hours = [1,6,24].includes(+route.get('hours')) ? +route.get('hours') : [1, 6, 24].includes(p.hours) ? p.hours : 24; ui.window.value = String(hours);
    collapsed = !!p.collapsed; ui.left.dataset.collapsed = collapsed ? 'true' : 'false';
    ['missions', 'people', 'profile'].forEach((k) => data.get(k));
    setView((opts && opts.view) || (VIEWS.includes(p.view) ? p.view : 'world'));
    if (shared) apply(shared, false);
    /* a first visit has no saved layers: the globe keeps what it shows by default */
    else apply({ s: typeof p.style === 'string' ? p.style : 'normal', h: !!p.hud, l: Array.isArray(p.layers) ? p.layers : null }, false);
    const item=route.get('item')||'';if (/^(mission|person|evidence|brief|source):.{1,150}$/.test(item)) {const [kind,...id]=item.split(':');select({kind,id:id.join(':')},{fly:false});}
    if (!V) {ui.left.dataset.expanded='true';ui.map.innerHTML='<p class="hx-empty">The 3D map is unavailable in this browser. Your data remains available below. <button type="button" class="hx-btn" data-retry-map>Retry map</button></p>'; $('[data-retry-map]',ui.map).onclick=()=>location.reload();}
    paintVision(); paintTools(); paintClock(); onCamera(); routeReady=true;
    ui.poll = setInterval(() => { if (!document.hidden) schedulePaint(); }, 2000);
    ui.tick = setInterval(paintClock, 15000);
    /* the Earth's frame changed size: let Cesium see it, then frame the whole Earth in the space left for it */
    requestAnimationFrame(() => { if (!mounted || !V) return; V.resize(); if (!shared) G.home(); });
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    clearInterval(ui.poll); clearInterval(ui.tick);
    document.removeEventListener('keydown', onKey); window.removeEventListener('popstate', restoreRoute); routeReady=false;
    window.removeEventListener('resize', onViewportResize);
    document.removeEventListener('click', onDocClick, true);
    if (V) V.camera.changed.removeEventListener(onCamera);
    stopFollow(); setOrbit(false);
    if (photo || photoPhase !== 'off') { photoPhase = 'off'; if (photo && V.scene.primitives.contains(photo)) V.scene.primitives.remove(photo); photo = null; V.scene.globe.show = true; G.setPhotoreal(false); }
    offs.forEach((off) => off()); offs = [];
    if (marks) { V.scene.primitives.remove(marks.points); V.scene.primitives.remove(marks.labels); marks = null; }
    if (layers) layers.destroy();
    if (vision) vision.destroy();
    if (hud) hud.destroy();
    if (data) data.destroy();
    if (saved) { if (V.scene.skyBox && saved.sky !== null) V.scene.skyBox.show = saved.sky; V.scene.backgroundColor = saved.bg; if (G.missions && saved.missions !== null) G.missions.show(saved.missions); saved = null; }
    G.closeSheet(); if (ui.root) ui.root.remove();
    ui = {}; layers = null; vision = null; hud = null; data = null; sel = null; mapFocus = false;
    const html = document.documentElement;
    html.classList.remove('halo-on', 'halo-no-map'); delete html.dataset.haloView; delete html.dataset.haloDetail; delete html.dataset.haloMap;
    requestAnimationFrame(() => { try { V.resize(); } catch (e) { /* gone */ } });
  }

  /* a hook for the browser test, like __huGlobeSettled */
  function state() {
    if (!mounted) return { mounted: false, view: null, selected: null, detailOpen: false, layers: {}, marks: 0 };
    const l = {};
    ALL_ITEMS.forEach((it) => { const s = stateOf(it); l[it.id] = { on: isOn(it), state: s.state, text: s.text }; });
    const cur = current();
    return { mounted, view, selected: cur ? { kind: cur.kind, id: cur.id } : null, detailOpen: !!sel, style: vision ? vision.get() : null, hud: !!(hud && hud.shown()), orbit: !!orbitTick, following: followTarget ? followTarget.label : null, photoreal: photoPhase, layers: l, readout: hud && hud.readout ? hud.readout() : null, marks: marks ? marks.points.length : 0, hours, mapFocus, panelExpanded: sheetOpen };
  }

  window.HaloConsole = Object.freeze({ mount, unmount, pick, state, follow, stopFollow, setView: (v) => mounted && setView(v), select: (s) => mounted && select(s), _share: { viewState: () => (mounted ? viewState() : null), link: () => (mounted ? shareLink() : null) } });
})();
