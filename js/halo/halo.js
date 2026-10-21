/* HITMAN'S HALO ON THE ADMIN GLOBE: the console (owner, 2026-10-21: "put all the capabilities of Hitman Halo into the admin
   experience of the globe section … more advanced than [God's Eye View] with the user interface of the current globe we have
   on our website").

   Mounted only by js/action-globe.js (haloSync), only on the full-screen globe, and only while the Worker says this session is
   the house owner; it unmounts the moment that answer goes. It drives the globe through window.HuGlobe and nothing else:
     Layers  the globe's own (flights, satellites, space missions, intel, CCTV) and Halo's (js/halo/layers.js), plus Google's
             photoreal 3D cities through the Worker's ion route
     Vision  night vision, thermal, CRT, anime, noir and snow (js/halo/vision.js), with sharpen and bloom
     Tools   the telemetry HUD (js/halo/hud.js), follow, orbit, a shareable view link, back to the whole Earth
   and a place search (the Worker's /v1/world/geocode). A tap on anything Halo draws opens what its provider said, with Follow.
   The owner's setup is remembered in this browser only (localStorage halo:prefs). Keys: 1–7 vision, H HUD, O orbit, Esc stop. */
(function () {
  'use strict';

  const PREFS = 'halo:prefs';
  const GROUPS = [
    { name: 'Air', items: [{ id: 'flights', label: 'Flights', core: true }, { id: 'military', label: 'Military flights' }] },
    { name: 'Sea', items: [{ id: 'vessels', label: 'Ships (AIS)' }] },
    { name: 'Space', items: [{ id: 'satellites', label: 'Satellites', core: true }, { id: 'launches', label: 'Space missions', core: true }] },
    { name: 'Hazards', items: [{ id: 'quakes', label: 'Earthquakes' }, { id: 'fires', label: 'Active fires' }, { id: 'perimeters', label: 'Wildfire perimeters' }, { id: 'cyclones', label: 'Tropical cyclones' }] },
    { name: 'Intelligence', items: [{ id: 'intel', label: 'Intel events', core: true }, { id: 'cctv', label: 'CCTV', core: true }] },
    { name: 'Map', items: [{ id: 'photoreal', label: 'Photoreal 3D cities', special: true }] }
  ];
  const CROSSHAIR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';

  let G = null, V = null, C = null, mounted = false;
  let ui = {}, vision = null, hud = null, layers = null, offLayers = null;
  let followTarget = null, followTick = null, orbitTick = null, orbitLast = 0, photo = null, photoPhase = 'off';
  let tab = 'layers', open = false;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => (G ? G.esc(String(s)) : String(s));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function prefs() { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (e) { return {}; } }
  function savePrefs() {
    if (!mounted) return;
    const on = [];
    GROUPS.forEach((g) => g.items.forEach((it) => { if (isOn(it)) on.push(it.id); }));
    try { localStorage.setItem(PREFS, JSON.stringify({ style: vision ? vision.get() : 'normal', hud: !!(hud && hud.shown()), layers: on, tab, open })); } catch (e) { /* private mode */ }
  }

  /* ---------- layers ---------- */
  function isOn(it) {
    if (it.special) return photoPhase === 'on' || photoPhase === 'loading';
    return it.core ? G.layer.on(it.id) : !!(layers && layers.on(it.id));
  }
  function stateOf(it) {
    if (it.special) return { state: photoPhase, text: { off: '', loading: 'Loading…', on: 'On', unavailable: 'Unavailable' }[photoPhase] || '' };
    if (it.core) {
      if (G.layer.locked(it.id)) return { state: 'locked', text: 'Locked', hidden: true };
      const on = G.layer.on(it.id), n = G.layer.count(it.id);
      return { state: on ? 'on' : 'off', text: on ? n.toLocaleString('en-US') : '' };
    }
    const s = layers && layers.status(it.id);
    if (!s) return { state: 'off', text: '' };
    const words = { off: '', loading: 'Loading…', locked: 'Owner only', error: 'Unavailable', unavailable: s.reason === 'needs a key' ? 'Needs a key' : 'Unavailable' };
    return { state: s.state, text: s.state === 'on' ? s.count.toLocaleString('en-US') + (s.stale ? ' · stale' : '') : (words[s.state] || '') };
  }
  function paintRow(it) {
    const row = ui.panel && ui.panel.querySelector('[data-halo-layer="' + it.id + '"]');
    if (!row) return;
    const st = stateOf(it), box = row.querySelector('input');
    row.hidden = !!st.hidden;
    row.dataset.state = st.state;
    box.checked = isOn(it);
    row.querySelector('.halo-row__state').textContent = st.text;
  }
  function paintLayers() { GROUPS.forEach((g) => g.items.forEach(paintRow)); paintCredits(); }
  function paintCredits() {
    if (!ui.credits) return;
    const parts = [];
    if (layers) layers.ids.forEach((id) => { const s = layers.status(id); if (s && s.on && s.credit) parts.push(s.credit); });
    if (photoPhase === 'on') parts.push('Photoreal 3D: Google');
    ui.credits.textContent = parts.join(' · ');
    ui.credits.hidden = !parts.length;
  }
  async function toggle(it) {
    if (it.special) { await setPhotoreal(!isOn(it)); }
    else if (it.core) { await G.layer.toggle(it.id); }
    else if (layers) { await layers.toggle(it.id); }
    paintRow(it); paintCredits(); savePrefs();
  }

  /* Google Photorealistic 3D Tiles, through the Worker's ion route (the account token never reaches the page). The globe hides
     while the city mesh stands in for it, as God's Eye View does, so the two never fight over the ground. */
  async function setPhotoreal(on) {
    if (!on) {
      photoPhase = 'off';
      if (photo) { if (V.scene.primitives.contains(photo)) V.scene.primitives.remove(photo); photo = null; }
      V.scene.globe.show = true; G.setPhotoreal(false); V.scene.requestRender();
      return;
    }
    const assets = G.ion();
    if (!assets || !Number.isInteger(assets.photoreal)) { photoPhase = 'unavailable'; return; }
    photoPhase = 'loading'; paintLayers();
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
    V.scene.requestRender();
  }

  /* ---------- follow and orbit ---------- */
  function follow(target) {
    stopFollow();
    if (!target || typeof target.position !== 'function') return;
    const p0 = target.position();
    if (!p0) return;
    followTarget = target;
    V.camera.lookAt(p0, new C.HeadingPitchRange(V.camera.heading, C.Math.toRadians(-35), target.range || 80000));
    let last = p0;
    followTick = () => {
      const p = followTarget && followTarget.position();
      if (!p) return;
      if (C.Cartesian3.distance(p, last) < 0.5) return;
      last = p;
      V.camera.lookAt(p, new C.HeadingPitchRange(V.camera.heading, V.camera.pitch, C.Cartesian3.magnitude(V.camera.position)));
    };
    V.scene.preRender.addEventListener(followTick);
    ui.follow.hidden = false;
    ui.follow.querySelector('b').textContent = target.label || 'target';
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
    if (!on || reduced()) { paintTools(); return; }
    orbitLast = 0;
    orbitTick = (scene, time) => {
      const now = performance.now(), dt = orbitLast ? Math.min(0.1, (now - orbitLast) / 1000) : 0;
      orbitLast = now;
      if (followTarget) V.camera.rotateRight(C.Math.toRadians(6) * dt);
      else V.camera.rotate(C.Cartesian3.UNIT_Z, -C.Math.toRadians(4) * dt);
      V.scene.requestRender();
    };
    V.scene.preRender.addEventListener(orbitTick);
    paintTools();
  }

  /* ---------- the sheet for a picked thing ---------- */
  function pick(e) {
    if (!mounted || !e) return false;
    const id = e.id;
    if (id && id.haloPick && layers) {
      const d = layers.describe(id);
      if (!d) return false;
      openDetail(d);
      return true;
    }
    /* the globe's own flights and satellites open as before, and gain Follow */
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
  function openDetail(d) {
    const rows = d.rows.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('');
    const link = d.link ? '<p><a class="cctv-act" href="' + esc(d.link) + '" target="_blank" rel="noopener noreferrer">Official page ↗</a></p>' : '';
    G.sheet(d.title, '<p class="cctv-meta">' + esc(d.credit) + '</p><dl class="flight-facts">' + rows + '</dl>' + link + '<p class="cctv-note">' + esc(d.note) + '</p>');
    addFollow({ label: d.title, range: d.range, position: d.position });
  }
  function addFollow(target) {
    const body = document.getElementById('cctvBody');
    if (!body) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cctv-act halo-follow-btn'; b.textContent = 'Follow';
    b.onclick = () => { follow(target); G.closeSheet(); };
    body.appendChild(b);
  }

  /* ---------- search ---------- */
  async function search(q) {
    q = String(q || '').trim();
    if (q.length < 2) return;
    ui.results.hidden = false;
    ui.results.innerHTML = '<li class="halo__hint">Searching…</li>';
    let body = null;
    try {
      const t = G.token();
      const r = await fetch(G.api + '/v1/world/geocode?q=' + encodeURIComponent(q.slice(0, 120)), { headers: t ? { accept: 'application/json', authorization: 'Bearer ' + t } : { accept: 'application/json' }, cache: 'no-store' });
      body = r.ok ? await r.json() : null;
    } catch (e) { body = null; }
    const list = body && Array.isArray(body.results) ? body.results.filter((x) => x && typeof x.lon === 'number' && typeof x.lat === 'number').slice(0, 6) : [];
    if (!list.length) { ui.results.innerHTML = '<li class="halo__hint">' + (body ? 'No place found.' : 'Search is unavailable right now.') + '</li>'; return; }
    ui.results.innerHTML = '';
    list.forEach((x) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.textContent = x.name || (x.lat.toFixed(3) + ', ' + x.lon.toFixed(3));
      if (x.kind) { const k = document.createElement('small'); k.textContent = x.kind; b.appendChild(k); }
      b.onclick = () => { flyToPlace(x); ui.results.hidden = true; };
      li.appendChild(b); ui.results.appendChild(li);
    });
    if (body.attribution) { const li = document.createElement('li'); li.className = 'halo__hint'; li.textContent = String(body.attribution).slice(0, 80); ui.results.appendChild(li); }
  }
  function flyToPlace(x) {
    stopFollow();
    const b = Array.isArray(x.bbox) && x.bbox.length === 4 && x.bbox.every((n) => typeof n === 'number' && isFinite(n)) ? x.bbox : null;
    const big = b && (Math.abs(b[2] - b[0]) > 0.02 || Math.abs(b[3] - b[1]) > 0.02);
    if (big) V.camera.flyTo({ destination: C.Rectangle.fromDegrees(b[0], b[1], b[2], b[3]), duration: reduced() ? 0 : 1.6 });
    else V.camera.flyTo({ destination: C.Cartesian3.fromDegrees(x.lon, x.lat, 2500), orientation: { heading: 0, pitch: C.Math.toRadians(-45), roll: 0 }, duration: reduced() ? 0 : 1.8 });
  }

  /* ---------- share a view: camera, vision, HUD and layers in the link's hash (owner only, like everything here) ---------- */
  function viewState() {
    const c = V.camera.positionCartographic;
    const on = [];
    GROUPS.forEach((g) => g.items.forEach((it) => { if (isOn(it)) on.push(it.id); }));
    return { c: [C.Math.toDegrees(c.longitude), C.Math.toDegrees(c.latitude), Math.round(c.height), V.camera.heading, V.camera.pitch].map((n) => Math.round(n * 1e5) / 1e5), s: vision ? vision.get() : 'normal', h: !!(hud && hud.shown()), l: on };
  }
  function shareLink() {
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify(viewState())))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = new URL(location.href); url.searchParams.set('halo', '1'); url.hash = 'halo=' + enc;
    return url.toString();
  }
  function readShared() {
    const m = /(?:^#|&)halo=([A-Za-z0-9_-]{1,2000})/.exec(location.hash || '');
    if (!m) return null;
    try {
      const v = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
      return v && typeof v === 'object' ? v : null;
    } catch (e) { return null; }
  }
  async function copyShare() {
    const url = shareLink(), out = ui.share;
    try { await navigator.clipboard.writeText(url); out.textContent = 'Link copied. It opens for the owner only.'; }
    catch (e) { out.innerHTML = ''; const i = document.createElement('input'); i.readOnly = true; i.value = url; i.className = 'halo__link'; i.setAttribute('aria-label', 'View link'); out.appendChild(i); i.select(); }
  }
  async function apply(v, fly) {
    if (!v) return;
    if (Array.isArray(v.c) && v.c.length === 5 && v.c.every((n) => typeof n === 'number' && isFinite(n)) && Math.abs(v.c[1]) <= 90 && Math.abs(v.c[0]) <= 180) {
      const view = { destination: C.Cartesian3.fromDegrees(v.c[0], v.c[1], Math.max(50, Math.min(4e7, v.c[2]))), orientation: { heading: v.c[3], pitch: v.c[4], roll: 0 } };
      if (fly) V.camera.flyTo(Object.assign(view, { duration: reduced() ? 0 : 1.2 })); else V.camera.setView(view);
    }
    if (vision && typeof v.s === 'string') vision.set(v.s);
    if (hud && typeof v.h === 'boolean') hud.show(v.h);
    if (Array.isArray(v.l)) {
      for (const g of GROUPS) for (const it of g.items) {
        if (v.l.includes(it.id) && !isOn(it) && !(it.core && G.layer.locked(it.id))) await toggle(it);
      }
    }
    paintTools(); paintVision(); paintLayers();
  }

  /* ---------- the panel ---------- */
  function setOpen(next) {
    open = !!next;
    ui.panel.hidden = !open;
    ui.pill.setAttribute('aria-expanded', open ? 'true' : 'false');
    savePrefs();
  }
  function setTab(next) {
    tab = next;
    ui.panel.querySelectorAll('[role="tab"]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    ui.panel.querySelectorAll('[role="tabpanel"]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    savePrefs();
  }
  function paintVision() {
    if (!ui.panel || !vision) return;
    const cur = vision.get();
    ui.panel.querySelectorAll('[data-halo-style]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.haloStyle === cur ? 'true' : 'false'));
  }
  function paintTools() {
    if (!ui.panel) return;
    const set = (k, on) => { const b = ui.panel.querySelector('[data-halo-tool="' + k + '"]'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    set('hud', !!(hud && hud.shown()));
    set('orbit', !!orbitTick);
    const stop = ui.panel.querySelector('[data-halo-tool="stop"]');
    if (stop) stop.hidden = !followTarget;
    const orbit = ui.panel.querySelector('[data-halo-tool="orbit"]');
    if (orbit) orbit.disabled = reduced();
  }

  function build() {
    const pill = document.createElement('button');
    pill.type = 'button'; pill.className = 'halo-pill'; pill.setAttribute('aria-expanded', 'false'); pill.setAttribute('aria-controls', 'haloPanel');
    pill.innerHTML = CROSSHAIR + '<span>Halo</span>';
    const panel = document.createElement('section');
    panel.className = 'halo'; panel.id = 'haloPanel'; panel.hidden = true; panel.setAttribute('aria-label', 'Hitman’s Halo');
    const styles = (window.HaloVision ? HaloVision.STYLES : []).map((s) => '<button type="button" data-halo-style="' + esc(s.id) + '" aria-pressed="false"><span>' + esc(s.label) + '</span><kbd>' + esc(s.key) + '</kbd></button>').join('');
    const groups = GROUPS.map((g) => '<div class="halo__group"><h3>' + esc(g.name) + '</h3>' + g.items.map((it) =>
      '<label class="halo-row" data-halo-layer="' + it.id + '" data-state="off"><input type="checkbox"><span class="halo-row__name">' + esc(it.label) + '</span><span class="halo-row__state" aria-live="polite"></span></label>').join('') + '</div>').join('');
    panel.innerHTML =
      '<header class="halo__head"><h2>Hitman’s Halo</h2><button type="button" class="halo__close" aria-label="Close Halo">×</button></header>' +
      '<form class="halo__search" role="search"><input type="search" name="q" aria-label="Search a place" placeholder="Search a place" autocomplete="off" maxlength="120" enterkeyhint="search"><button type="submit">Go</button></form>' +
      '<ul class="halo__results" hidden></ul>' +
      '<div class="halo__tabs" role="tablist" aria-label="Halo">' +
      ['layers', 'vision', 'tools'].map((k) => '<button type="button" role="tab" id="haloTab-' + k + '" data-tab="' + k + '" aria-controls="haloPane-' + k + '" aria-selected="false">' + k.charAt(0).toUpperCase() + k.slice(1) + '</button>').join('') + '</div>' +
      '<div class="halo__body">' +
      '<div role="tabpanel" id="haloPane-layers" data-pane="layers" aria-labelledby="haloTab-layers">' + groups + '</div>' +
      '<div role="tabpanel" id="haloPane-vision" data-pane="vision" aria-labelledby="haloTab-vision" hidden><div class="halo-styles">' + styles + '</div>' +
      '<div class="halo-tools"><label class="halo-row"><input type="checkbox" data-halo-fx="sharpen"><span class="halo-row__name">Sharpen</span><span class="halo-row__state"></span></label>' +
      '<label class="halo-row"><input type="checkbox" data-halo-fx="bloom"><span class="halo-row__name">Bloom</span><span class="halo-row__state"></span></label></div>' +
      '<p class="halo__hint">Visual treatments only: they change how the Earth looks, not what any sensor saw.</p></div>' +
      '<div role="tabpanel" id="haloPane-tools" data-pane="tools" aria-labelledby="haloTab-tools" hidden><div class="halo-tools">' +
      '<button type="button" data-halo-tool="hud" aria-pressed="false">Telemetry HUD <kbd>H</kbd></button>' +
      '<button type="button" data-halo-tool="orbit" aria-pressed="false">Orbit <kbd>O</kbd></button>' +
      '<button type="button" data-halo-tool="stop" hidden>Stop following <kbd>Esc</kbd></button>' +
      '<button type="button" data-halo-tool="share">Copy a link to this view</button>' +
      '<button type="button" data-halo-tool="home">Back to the whole Earth</button>' +
      '<p class="halo__share" aria-live="polite"></p></div></div>' +
      '</div>' +
      '<p class="halo__credits" hidden></p>';
    const followBar = document.createElement('div');
    followBar.className = 'halo-follow'; followBar.hidden = true;
    followBar.innerHTML = '<span>Following <b></b></span><button type="button">Stop</button>';
    const hudHost = document.createElement('div');
    hudHost.className = 'halo-hud-host';
    document.body.append(pill, panel, followBar, hudHost);
    ui = { pill, panel, follow: followBar, hudHost, results: $('.halo__results', panel), credits: $('.halo__credits', panel), share: $('.halo__share', panel) };

    pill.onclick = () => setOpen(!open);
    $('.halo__close', panel).onclick = () => { setOpen(false); pill.focus(); };
    $('.halo__search', panel).onsubmit = (e) => { e.preventDefault(); search(e.target.q.value); };
    panel.querySelectorAll('[role="tab"]').forEach((b) => {
      b.onclick = () => setTab(b.dataset.tab);
      b.onkeydown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const tabs = [...panel.querySelectorAll('[role="tab"]')], i = tabs.indexOf(b), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        setTab(n.dataset.tab); n.focus();
      };
    });
    GROUPS.forEach((g) => g.items.forEach((it) => {
      const row = panel.querySelector('[data-halo-layer="' + it.id + '"] input');
      row.onchange = (e) => { e.preventDefault(); row.checked = isOn(it); toggle(it); };
    }));
    panel.querySelectorAll('[data-halo-style]').forEach((b) => { b.onclick = () => { if (vision) vision.set(b.dataset.haloStyle); paintVision(); savePrefs(); }; });
    panel.querySelectorAll('[data-halo-fx]').forEach((b) => { b.onchange = () => { if (!vision) return; b.dataset.haloFx === 'sharpen' ? vision.setSharpen(b.checked) : vision.setBloom(b.checked); }; });
    panel.querySelector('[data-halo-tool="hud"]').onclick = () => { if (hud) hud.show(!hud.shown()); paintTools(); savePrefs(); };
    panel.querySelector('[data-halo-tool="orbit"]').onclick = () => setOrbit(!orbitTick);
    panel.querySelector('[data-halo-tool="stop"]').onclick = stopFollow;
    panel.querySelector('[data-halo-tool="share"]').onclick = copyShare;
    panel.querySelector('[data-halo-tool="home"]').onclick = () => { stopFollow(); setOrbit(false); G.home(); };
    followBar.querySelector('button').onclick = stopFollow;
  }

  function onKey(e) {
    if (!mounted || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'Escape') { if (followTarget) { stopFollow(); return; } if (orbitTick) { setOrbit(false); return; } return; }
    const style = window.HaloVision && HaloVision.STYLES.find((s) => s.key === e.key);
    if (style && vision) { vision.set(style.id); paintVision(); savePrefs(); return; }
    if (e.key === 'h' || e.key === 'H') { if (hud) { hud.show(!hud.shown()); paintTools(); savePrefs(); } return; }
    if (e.key === 'o' || e.key === 'O') setOrbit(!orbitTick);
  }

  function mount(globe, opts) {
    if (mounted) { if (opts && opts.open && !open) setOpen(true); return; }
    G = globe; V = G && G.viewer(); C = window.Cesium;
    if (!V || !C || !G.owner()) return;
    mounted = true;
    document.documentElement.classList.add('halo-on');
    vision = window.HaloVision ? HaloVision.mount(V) : null;
    layers = window.HaloLayers ? HaloLayers.create(G) : null;
    build();
    hud = window.HaloHud ? HaloHud.mount(V, ui.hudHost) : null;
    if (layers) offLayers = layers.onChange(() => paintLayers());
    document.addEventListener('keydown', onKey);
    const p = prefs(), shared = readShared();
    setTab(['layers', 'vision', 'tools'].includes(p.tab) ? p.tab : 'layers');
    setOpen(!!(opts && opts.open) || !!p.open);
    if (shared) apply(shared, false);
    else apply({ s: typeof p.style === 'string' ? p.style : 'normal', h: !!p.hud, l: Array.isArray(p.layers) ? p.layers : [] }, false);
    paintVision(); paintTools(); paintLayers();
    /* the globe's own layers change outside this console too (its menu, access changes) */
    ui.poll = setInterval(paintLayers, 2000);
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    clearInterval(ui.poll);
    document.removeEventListener('keydown', onKey);
    stopFollow(); setOrbit(false);
    if (photo || photoPhase !== 'off') { photoPhase = 'off'; if (photo && V.scene.primitives.contains(photo)) V.scene.primitives.remove(photo); photo = null; V.scene.globe.show = true; G.setPhotoreal(false); }
    if (offLayers) offLayers();
    if (layers) layers.destroy();
    if (vision) vision.destroy();
    if (hud) hud.destroy();
    [ui.pill, ui.panel, ui.follow, ui.hudHost].forEach((el) => el && el.remove());
    ui = {}; layers = null; vision = null; hud = null; offLayers = null;
    document.documentElement.classList.remove('halo-on');
  }

  /* a hook for the browser test, like __huGlobeSettled */
  function state() {
    const l = {};
    GROUPS.forEach((g) => g.items.forEach((it) => { const s = stateOf(it); l[it.id] = { on: isOn(it), state: s.state, text: s.text }; }));
    return { mounted, open, tab, style: vision ? vision.get() : null, hud: !!(hud && hud.shown()), orbit: !!orbitTick, following: followTarget ? followTarget.label : null, photoreal: photoPhase, layers: l, readout: hud && hud.readout ? hud.readout() : null };
  }

  window.HaloConsole = Object.freeze({ mount, unmount, pick, state, follow, stopFollow, _share: { viewState: () => (mounted ? viewState() : null), link: () => (mounted ? shareLink() : null) } });
})();
