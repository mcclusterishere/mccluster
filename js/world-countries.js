/* THE WORLD'S COUNTRIES (owner, 2026-10-15): "The globe hasn't been broken up in a satisfying visual way to know 'this is
   America and its boundaries' — highlighted red, white and blue, the flag. Each country with its flag. Country boundaries
   need to be drawn and decorated so people can see them from a zoomed-out view. When they zoom in … that decoration should
   go away automatically (they could keep it on if they want)."
   AND THE STATES (owner, 2026-10-20): "The map needs to be clearly defined with clearly defined borders, and even within
   the countries clearly defined states within the countries, drawn accurately."

   - Borders: Natural Earth 1:10m Admin 0, US point of view (public domain), simplified to 10%: data/geo/world-borders-10m.json,
     the lines two countries share, drawn once (tools/build-world-countries.mjs). They are the map, not decoration: they stay
     while the camera comes down, in one colour whose opacity is a single uniform, and only give way below H_OFF, where the
     street map or aerial imagery (with its own borders) is the subject. The coastline is the imagery's.
   - Countries: data/geo/world-countries-10m.json, each country's shape (decode below), for taps, flags, labels, the live
     badges and the selected country's outline. 243 of them: Singapore, Hong Kong, Malta, Monaco … are on the map now.
   - States: data/geo/world-states/<A2>.json (tools/build-world-states.mjs), lines only, fetched one country at a time for
     the countries in view once the camera is below STATES_FAR, and always for a selected country. Thinner and dimmer than
     the borders, so a border still reads as a border.
   - Flags: flag-icons (MIT), whole flags scaled into one atlas (assets/flags/flag-sprite-4x3.webp, tools/build-flag-sprite.mjs),
     one billboard per country at Natural Earth's label point. A flag is a nation's own artwork: it is scaled, never redrawn.
   - The United States: a red, white and blue ribbon along its outline, a faint thirteen-stripe wash over its land, and its flag.
   - The fade: each country's decoration (flag, label, ribbon) eases out as the camera comes down and as the country's main
     body fills the view (fadeTarget below); prefers-reduced-motion makes it instant. "Countries" in the layer row cycles:
     fade as I zoom (default) → keep them on → off. The choice is kept in this browser only (nothing is sent anywhere).
   - A tap on a country names it and counts the published missions pinned there, and filters the mission pins to it. The
     count is read from the mission rows themselves: a row's country_code (the country-level regions contract), else its
     region's country_code from action_globe_public_regions. With neither, the honest answer is "No missions here yet".
   - A STATE (owner, 2026-10-21: "once you've selected a country ... select a state thereafter, but only after selecting
     the country already and double tapping the state"). With a country selected, a double tap inside it picks the state
     under it (data/geo/world-state-areas/<A2>.json, fetched when the country is selected): the state is lit, the card
     names it, and the page is told (onSelect's country.state). A double tap on the picked state, or a single tap inside
     the country, goes back to the whole country; a single tap with no state picked lets the country go, as before, once
     the double-tap gap has passed. A double tap on a country not yet selected selects the country only.
   - THE NEWS HEAT MAP (owner, 2026-10-21: "instead of pins on the map ... aggregate each mention of a state or country
     with a heat map of how many articles or mentions it has ... so people aren't just needlessly searching for tiny pins").
     heat({countries}) shades each country by the stories that mention it (GET /v1/world/news-heat, the last day), on the
     shared scale in js/heat-scale.js; a selected country shows its states instead, counted from the places of its stories
     (opts.heatCells) with the state shapes; the card gives the count, and a legend says what the colours mean. The shading
     shows while the borders do.

   The pure parts (decode, fades, preference, point-in-country, counts) are exported for node --test; the browser part
   needs Cesium. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HuCountries = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DATA_URL = 'data/geo/world-countries-10m.json';
  const BORDERS_URL = 'data/geo/world-borders-10m.json';
  const STATES_DIR = 'data/geo/world-states/';
  const AREAS_DIR = 'data/geo/world-state-areas/';
  const SPRITE_URL = 'assets/flags/flag-sprite-4x3.webp';
  const SPRITE_INDEX = 'assets/flags/flag-sprite-4x3.json';
  const PREF_KEY = 'hu_world_countries';
  const MODES = ['auto', 'always', 'off'];
  /* heights in metres above the ellipsoid. Below H_OFF nothing is decorated (the street map / aerial imagery is the
     subject there); a country's own fill test only applies below FILL_CONSIDER, so a whole-Earth view keeps Russia's flag. */
  const H_OFF = 700e3, H_ON = 1400e3, FILL_CONSIDER = 9e6, FILL_FULL = 0.55, FILL_GONE = 0.95;
  /* the stripes wash is the strongest decoration, so it only shows from far out, whatever the mode */
  const WASH_OFF = 2.5e6, WASH_ON = 4.5e6;
  /* the states come in from a continent's height (a whole-Earth view would be a tangle of them) */
  const STATES_FAR = 7.5e6, STATES_NEAR = 5e6;
  const FADE_MS = 220;
  /* two taps make a double tap within this many milliseconds and CSS pixels of each other */
  const TAP_GAP = 350, TAP_SLOP = 30;

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  function lonSpan(w, e) { let d = e - w; if (d < 0) d += 360; return d; }
  /* do two [west, south, east, north] boxes overlap? Longitudes may wrap the antimeridian (west > east). */
  function intersects(a, b) {
    if (a[3] < b[1] || b[3] < a[1]) return false;
    const aw = a[0], as = lonSpan(a[0], a[2]), bw = b[0], bs = lonSpan(b[0], b[2]);
    for (const k of [-360, 0, 360]) { const s = bw + k; if (s <= aw + as && aw <= s + bs) return true; }
    return false;
  }
  /* The decoration's target opacity, 0..1. view: the visible [w,s,e,n] in degrees, or null when the whole Earth shows.
     box: the country's main-body box. mode: 'auto' | 'always' | 'off'. */
  function fadeTarget(o) {
    const mode = o && o.mode;
    if (mode === 'off') return 0;
    if (mode === 'always') return 1;
    const h = Number(o && o.height);
    if (!Number.isFinite(h)) return 1;
    let a = clamp01((h - H_OFF) / (H_ON - H_OFF));
    const v = o.view, b = o.box;
    if (a > 0 && h < FILL_CONSIDER && Array.isArray(v) && Array.isArray(b) && intersects(v, b)) {
      const fill = Math.max(lonSpan(b[0], b[2]) / Math.max(1e-6, lonSpan(v[0], v[2])), (b[3] - b[1]) / Math.max(1e-6, v[3] - v[1]));
      a = Math.min(a, clamp01((FILL_GONE - fill) / (FILL_GONE - FILL_FULL)));
    }
    return a;
  }
  /* the borders' opacity, 0..1: on from space down to H_ON, gone by H_OFF where the street map or aerial imagery takes over */
  function lineTarget(height, mode) {
    if (mode === 'off') return 0;
    if (mode === 'always') return 1;
    const h = Number(height);
    return Number.isFinite(h) ? clamp01((h - H_OFF) / (H_ON - H_OFF)) : 1;
  }
  /* the states' opacity: in as the camera comes down to a continent, out with the borders */
  function stateTarget(height, mode) {
    if (mode === 'off') return 0;
    const h = Number(height);
    if (!Number.isFinite(h)) return 0;
    return Math.min(lineTarget(h, mode), clamp01((STATES_FAR - h) / (STATES_FAR - STATES_NEAR)));
  }
  /* a stored line or ring: whole hundredths of a degree, each point a step from the one before → [[lon, lat], ...] */
  function undelta(d) {
    const out = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < (d ? d.length : 0); i += 2) { x += d[i]; y += d[i + 1]; out.push([x / 100, y / 100]); }
    return out;
  }
  /* data/geo/world-countries-10m.json (or a data/geo/world-state-areas file) → GeoJSON-shaped features, each ring closed again */
  function decode(data) {
    return ((data && (data.countries || data.states)) || []).map((c) => {
      const polys = (c.p || []).map((poly) => poly.map((r) => { const ring = undelta(r); if (ring.length) ring.push(ring[0].slice()); return ring; }).filter((ring) => ring.length >= 4)).filter((poly) => poly.length);
      return { type: 'Feature', properties: c.properties, geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys } };
    });
  }
  function washTarget(height, mode) { if (mode === 'off') return 0; const h = Number(height); return Number.isFinite(h) ? clamp01((h - WASH_OFF) / (WASH_ON - WASH_OFF)) : 1; }
  /* one frame of the ease toward the target; reduced motion (or no time) jumps there */
  function stepAlpha(cur, target, dtMs, reduced) {
    if (reduced || !(dtMs > 0)) return target;
    const next = cur + (target - cur) * (1 - Math.exp(-dtMs / FADE_MS));
    return Math.abs(target - next) < 0.01 ? target : next;
  }
  function readMode(storage) { try { const v = storage && storage.getItem(PREF_KEY); return MODES.includes(v) ? v : 'auto'; } catch (e) { return 'auto'; } }
  function writeMode(storage, mode) { if (!MODES.includes(mode)) return false; try { storage.setItem(PREF_KEY, mode); return true; } catch (e) { return false; } }
  function nextMode(mode) { return MODES[(MODES.indexOf(mode) + 1) % MODES.length] || 'auto'; }
  /* is tap b ({t, x, y}: milliseconds, CSS pixels) the second of a double tap that began with tap a? */
  function isDoubleTap(a, b) { return !!a && !!b && b.t - a.t >= 0 && b.t - a.t <= TAP_GAP && Math.hypot(b.x - a.x, b.y - a.y) <= TAP_SLOP; }

  function inRing(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function polygonsOf(f) { const g = f && f.geometry; if (!g) return []; return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  /* the country under a point (degrees), or null: box first, then the rings (holes respected) */
  function countryAt(features, lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    for (const f of features || []) {
      const b = f.properties && f.properties.bbox;
      if (b && (lat < b[1] || lat > b[3] || lon < b[0] || lon > b[2])) continue;
      for (const poly of polygonsOf(f)) if (inRing(poly[0], lon, lat) && !poly.slice(1).some((h) => inRing(h, lon, lat))) return f;
    }
    return null;
  }
  const A2 = /^[A-Z]{2}$/;
  /* a mission row's country: its own country_code, else its region's, else the country its own published pin sits in;
     never guessed from a region key's spelling. The pin matters in production: the public regions read is k>=5 suppressed
     and can return no rows while the missions read returns every pin. */
  function missionCountry(m, regionCountry, features) {
    const own = m && typeof m.country_code === 'string' ? m.country_code.toUpperCase() : '';
    if (A2.test(own)) return own;
    const r = m && regionCountry && regionCountry[m.region_key];
    if (typeof r === 'string' && A2.test(r.toUpperCase())) return r.toUpperCase();
    if (!m || !features || m.longitude == null || m.latitude == null) return null;
    const f = countryAt(features, Number(m.longitude), Number(m.latitude)), a2 = f && f.properties && f.properties.a2;
    return typeof a2 === 'string' && A2.test(a2) ? a2 : null;
  }
  function regionCountryIndex(regions) { const out = {}; (regions || []).forEach((r) => { if (r && r.region_key && typeof r.country_code === 'string') out[r.region_key] = r.country_code; }); return out; }
  /* distinct published missions per country; a mission pinned twice in one country counts once */
  function missionCounts(missions, regions, features) {
    const idx = regionCountryIndex(regions), seen = {}, out = {};
    (missions || []).forEach((m) => { const c = missionCountry(m, idx, features); if (!c || !m.mission_id) return; const k = c + '|' + m.mission_id; if (seen[k]) return; seen[k] = 1; out[c] = (out[c] || 0) + 1; });
    return out;
  }
  function countText(n) { return n > 0 ? n + (n === 1 ? ' mission' : ' missions') + ' pinned here' : 'No missions here yet'; }
  function escHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ---------------- the browser part ---------------- */
  function mount(viewer, opts) {
    const C = window.Cesium, o = opts || {}, quiet = !!o.quiet;
    const reducedQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const st = { mode: quiet ? 'auto' : readMode(safeStorage()), features: [], ready: false, selected: null, items: [], washAlpha: 1, lineAlpha: 1, stateAlpha: 0, borders: null, borderCount: 0, rwb: null, wash: null, flags: null, labels: null, highlight: null, outline: null, lastT: 0, camKey: '', failed: false, stateIndex: null, stateIndexAsked: false, stateIndexP: null, states: new Map(), selectedStates: null, selectGen: 0, areas: new Map(), selectedState: null, stateFill: null, stateOutline: null, tap: null, tapTimer: 0, down: null, heat: null, heatTotal: 0, heatFill: null, heatIds: {}, stateHeat: null, stateCounts: null, heatGen: 0 };
    const scratchColor = new C.Color(), scratchCarto = new C.Cartographic(), scratchCart3 = new C.Cartesian3(), scratchRect = new C.Rectangle(), view = [0, 0, 0, 0];
    const INK = C.Color.fromCssColorString('#f4f1ea');
    /* the borders are the map: clear enough to read on the day and the night side, in the feed's small globe too */
    const BORDER = quiet ? { width: 1.5, alpha: 0.7 } : { width: 1.8, alpha: 0.85 };
    const STATE = quiet ? { width: 0.9, alpha: 0.3 } : { width: 1, alpha: 0.34 };
    const lineMat = (alpha) => C.Material.fromType('Color', { color: new C.Color(INK.red, INK.green, INK.blue, alpha) });
    const borderMat = lineMat(BORDER.alpha), stateMat = lineMat(0), selectedStateMat = lineMat(0);
    const button = addButton();
    const card = addCard();
    const legend = addLegend();
    const Heat = window.HuHeat;
    /* when each tap went down, by the event's own clock: a busy frame can hold a tap's handling back, not its time */
    viewer.scene.canvas.addEventListener('pointerdown', (e) => { if (e.isPrimary) st.down = { t: e.timeStamp }; }, true);
    paintButton();

    function safeStorage() { try { return window.localStorage; } catch (e) { return null; } }
    function addButton() {
      if (quiet) return null;
      const row = document.querySelector('.globe-data');
      if (!row) return null;
      const b = document.createElement('button');
      b.id = 'ctlCountries'; b.type = 'button'; b.className = 'globe-ctl globe-ctl--countries';
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4.5h12.5l-2.5 4 2.5 4H5"/></svg><span class="globe-ctl__badge" aria-hidden="true"></span>';
      b.onclick = () => setMode(nextMode(st.mode));
      row.appendChild(b);
      return b;
    }
    function paintButton() {
      if (!button) return;
      const t = { auto: 'Countries: borders, states and flags; flags fade as you zoom in (tap to keep them on)', always: 'Countries: kept on while you zoom (tap to hide)', off: 'Countries: hidden (tap to show)' }[st.mode];
      button.setAttribute('aria-pressed', st.mode === 'off' ? 'false' : 'true');
      button.setAttribute('aria-label', t); button.title = t; button.dataset.mode = st.mode;
    }
    function setMode(m) { st.mode = m; writeMode(safeStorage(), m); paintButton(); if (m === 'off') select(null); st.camKey = ''; }
    /* what the colours mean: the ramp, few to many, and the window it counts */
    function addLegend() {
      const el = document.createElement('div');
      el.className = 'heat-legend'; el.id = 'heatLegend'; el.hidden = true;
      el.innerHTML = '<span class="heat-legend__title">News mentions · last 24 h</span><i class="heat-legend__bar"></i><span class="heat-legend__ends"><small>Fewer</small><small>More</small></span>';
      if (window.HuHeat) el.querySelector('i').style.background = window.HuHeat.gradient();
      document.body.appendChild(el);
      return el;
    }
    function addCard() {
      const el = document.createElement('div');
      el.className = 'country-card'; el.id = 'countryCard'; el.hidden = true;
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      return el;
    }
    function paintCard(f, sf) {
      if (!f) { card.hidden = true; card.innerHTML = ''; return; }
      const p = f.properties, counts = missionCounts(o.missions ? o.missions() : [], o.regions ? o.regions() : [], st.features);
      const n = p.a2 ? counts[p.a2] || 0 : 0, idx = st.stateIndex, sp = sf && sf.properties;
      /* with the heat map on: how many stories mention it; the missions line only where missions show */
      const news = st.heat && Heat ? '<small class="country-card__news">' + escHtml(Heat.stories(sp ? (st.stateCounts && st.stateCounts[sp.key]) || 0 : st.heat[p.a2] || 0) + ' in the last 24 hours') + '</small>' : '';
      const missions = !st.heat || !o.missionsOn || o.missionsOn() ? '<small>' + escHtml(countText(n)) + '</small>' : '';
      const text = sp
        ? '<b>' + escHtml(sp.name) + '</b><small>' + escHtml(p.name) + '</small>' + news
        : '<b>' + escHtml(p.name) + '</b>' + news + missions + (p.a2 && idx && idx[p.a2] ? '<small class="country-card__hint">Double-tap a state to choose it</small>' : '');
      card.innerHTML = (p.flag && !quiet ? '<img class="country-card__flag" src="assets/flags/4x3/' + p.a2.toLowerCase() + '.svg" alt="" width="32" height="24">' : '') +
        '<span class="country-card__text">' + text + '</span>' +
        '<button type="button" class="country-card__close" aria-label="' + (sp ? 'Show all of ' + escHtml(p.name) : 'Show every country') + '">×</button>';
      card.querySelector('button').onclick = () => (sp ? selectState(null) : select(null));
      card.hidden = false;
      return n;
    }
    /* what the page is told: the country, and the state picked in it, with its shape (the feed keeps the stories placed in it) */
    function told(f, n, sf) {
      if (!f) return null;
      const sp = sf && sf.properties;
      return { code: f.properties.a2, a3: f.properties.a3, name: f.properties.name, missions: n || 0, state: sp ? { key: sp.key, name: sp.name, type: sp.type || null, polygons: polygonsOf(sf) } : null };
    }
    function dropState() { for (const k of ['stateFill', 'stateOutline']) if (st[k]) { viewer.scene.primitives.remove(st[k]); st[k] = null; } st.selectedState = null; }
    function selectState(sf) {
      const f = st.features.find((x) => (x.properties.a2 || x.properties.a3) === st.selected);
      if (!f) return;
      dropState();
      if (sf) {
        st.selectedState = sf;
        st.stateFill = viewer.scene.primitives.add(polygonPrimitive(sf, C.Color.WHITE.withAlpha(0.2)));
        st.stateOutline = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: ringInstances(sf, 'hu-state-selected', BORDER.width, INK.withAlpha(0.95)), appearance: new C.PolylineColorAppearance({ translucent: true }), asynchronous: false }));
      }
      const n = paintCard(f, sf);
      if (o.onSelect) o.onSelect(told(f, n, sf));
      if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
    }
    /* the state under a double tap in the selected country; the picked state again goes back to the whole country */
    function pickState(lon, lat) {
      const code = st.selected, gen = st.selectGen;
      if (!code) return;
      loadAreas(code).then((areas) => {
        if (!areas || gen !== st.selectGen || st.selected !== code) return;
        const sf = countryAt(areas, lon, lat);
        if (!sf) return;
        selectState(st.selectedState && st.selectedState.properties.key === sf.properties.key ? null : sf);
      });
    }
    function select(f) {
      const code = f ? f.properties.a2 || f.properties.a3 : null;
      for (const k of ['highlight', 'outline', 'selectedStates']) if (st[k]) { viewer.scene.primitives.remove(st[k]); st[k] = null; }
      dropState();
      if (!f) st.selectGen++;
      st.selected = f ? code : null;
      const n = paintCard(f);
      if (f) {
        st.highlight = viewer.scene.primitives.add(polygonPrimitive(f, C.Color.WHITE.withAlpha(st.heat ? 0.07 : 0.16)));
        /* the chosen country's whole outline, its coast too, and its states whatever the height */
        st.outline = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: ringInstances(f, 'hu-country-selected', BORDER.width + 1, INK.withAlpha(0.95)), appearance: new C.PolylineColorAppearance({ translucent: true }), asynchronous: false }));
        /* only the latest selection draws: a select() made again before the file arrives (refresh() re-applies one) leaves no stray lines */
        const gen = ++st.selectGen;
        if (f.properties.a2) loadStates(f.properties.a2).then((lines) => { if (lines && gen === st.selectGen && st.selected === code && !st.selectedStates) st.selectedStates = viewer.scene.primitives.add(linePrimitive(lines, STATE.width, selectedStateMat)); });
        /* its states' shapes too, so a double tap answers at once; and the card's hint once the index says it has states */
        if (f.properties.a2) { loadAreas(f.properties.a2); stateIndexP().then(() => { if (gen === st.selectGen && st.selected === code && !st.selectedState) paintCard(f); }); }
      }
      drawStateHeat();
      if (o.onSelect) o.onSelect(told(f, n, null));
      if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
    }
    /* THE HEAT MAP: one fill per country with stories, coloured by how many; the selected country's own fill steps aside
       for its states' */
    function heatInstances(f, id, color) {
      return polygonsOf(f).map((poly, k) => new C.GeometryInstance({
        id: id + '-' + k,
        geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(poly[0].slice(0, -1).flat()), poly.slice(1).map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h.slice(0, -1).flat())))), height: 2500, granularity: C.Math.RADIANS_PER_DEGREE * 2, vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT, arcType: C.ArcType.GEODESIC }),
        attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(color), show: new C.ShowGeometryInstanceAttribute(true) },
      }));
    }
    const heatColor = (t) => { const c = Heat.at(Heat.HEAT, t); return new C.Color(c[0], c[1], c[2], c[3]); };
    function setHeat(data) {
      st.heat = data && data.countries && typeof data.countries === 'object' ? data.countries : null;
      st.heatTotal = st.heat ? Number(data.total) || 0 : 0;
      drawHeat();
      if (legend && legend.hidden !== !st.heat) { legend.hidden = !st.heat; if (o.onLegend) o.onLegend(); }
      if (st.selected) { const f = st.features.find((x) => (x.properties.a2 || x.properties.a3) === st.selected); if (f) { drawStateHeat(); paintCard(f, st.selectedState); } }
      if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
    }
    function drawHeat() {
      if (st.heatFill) { viewer.scene.primitives.remove(st.heatFill); st.heatFill = null; }
      st.heatIds = {};
      if (!st.heat || !st.ready || !Heat) return;
      const level = Heat.levels(Object.values(st.heat)), instances = [];
      for (const f of st.features) {
        const code = f.properties.a2, n = code ? Number(st.heat[code]) || 0 : 0;
        if (n <= 0) continue;
        const list = heatInstances(f, 'hu-heat-' + code, heatColor(level(n)));
        st.heatIds[code] = list.map((x) => x.id);
        instances.push(...list);
      }
      if (instances.length) st.heatFill = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: instances, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: true }));
    }
    /* the selected country's states, coloured by the stories placed in each (when there are any to place) */
    function drawStateHeat() {
      if (st.stateHeat) { viewer.scene.primitives.remove(st.stateHeat); st.stateHeat = null; }
      st.stateCounts = null;
      showCountryHeat();
      const code = st.selected, gen = ++st.heatGen;
      if (!st.heat || !code || !(Number(st.heat[code]) > 0) || !o.heatCells || !/^[A-Z]{2}$/.test(code)) return;
      Promise.all([loadAreas(code), o.heatCells(code)]).then(([areas, cells]) => {
        if (gen !== st.heatGen || st.selected !== code || !areas || !Array.isArray(cells) || !st.heat) return;
        const counts = {};
        for (const c of cells) { if (!Array.isArray(c)) continue; const sf = countryAt(areas, Number(c[0]), Number(c[1])); if (sf) counts[sf.properties.key] = (counts[sf.properties.key] || 0) + (Number(c[2]) || 0); }
        st.stateCounts = counts;
        const level = Heat.levels(Object.values(counts)), instances = [];
        for (const sf of areas) { const n = counts[sf.properties.key] || 0; if (n > 0) instances.push(...heatInstances(sf, 'hu-heat-state-' + sf.properties.key, heatColor(level(n)))); }
        if (instances.length) { st.stateHeat = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: instances, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: true })); showCountryHeat(); }
        const f = st.features.find((x) => (x.properties.a2 || x.properties.a3) === code);
        if (f) paintCard(f, st.selectedState);
        if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
      });
    }
    /* a country's own fill shows unless its states are drawn in its place */
    function showCountryHeat() {
      if (!st.heatFill) return;
      const apply = () => { for (const code in st.heatIds) { const hide = code === st.selected && !!st.stateHeat; for (const id of st.heatIds[code]) { const a = st.heatFill.getGeometryInstanceAttributes(id); if (a) a.show = C.ShowGeometryInstanceAttribute.toValue(!hide, a.show); } } };
      /* an asynchronous primitive takes its attributes once it is ready (Cesium 1.131 has no readyPromise) */
      if (st.heatFill.ready) apply(); else { const p = st.heatFill; setTimeout(() => { if (st.heatFill === p) showCountryHeat(); }, 200); }
    }
    function polygonInstances(f, color) {
      return polygonsOf(f).map((poly, k) => new C.GeometryInstance({
        id: 'hu-country-fill-' + (f.properties.a3 || f.properties.key || '') + '-' + k,
        geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(poly[0].slice(0, -1).flat()), poly.slice(1).map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h.slice(0, -1).flat())))), height: 3000, vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT, arcType: C.ArcType.GEODESIC }),
        attributes: color ? { color: C.ColorGeometryInstanceAttribute.fromColor(color) } : undefined,
      }));
    }
    function polygonPrimitive(f, color) {
      const instances = polygonInstances(f, color), appearance = new C.PerInstanceColorAppearance({ flat: true, translucent: true });
      return new C.Primitive({ geometryInstances: instances, appearance, asynchronous: false });
    }
    /* lines on the ellipsoid, 3 km up, not ground-clamped: measured in Chromium's software GL, ground-clamped polylines
       (a shadow volume per segment) doubled the frame time; from where the lines show, 3 km is invisible, and with
       depthTestAgainstTerrain off (Cesium's default) mountains do not cut them. */
    const positions = (pts) => C.Cartesian3.fromDegreesArrayHeights(pts.flatMap((p) => [p[0], p[1], 3000]));
    function ringInstances(f, id, width, color) {
      return polygonsOf(f).flatMap((poly, k) => poly.map((ring, r) => new C.GeometryInstance({
        id: id + '-' + k + '-' + r,
        geometry: new C.PolylineGeometry({ positions: positions(ring), width, arcType: C.ArcType.GEODESIC, vertexFormat: color ? C.PolylineColorAppearance.VERTEX_FORMAT : C.PolylineMaterialAppearance.VERTEX_FORMAT }),
        attributes: color ? { color: C.ColorGeometryInstanceAttribute.fromColor(color) } : undefined,
      })));
    }
    /* stored lines (each [[lon, lat], ...]) in one primitive whose colour is one material: a fade is one uniform */
    function linePrimitive(lines, width, material) {
      const instances = lines.filter((l) => l.length >= 2).map((l) => new C.GeometryInstance({ geometry: new C.PolylineGeometry({ positions: positions(l), width, arcType: C.ArcType.GEODESIC, vertexFormat: C.PolylineMaterialAppearance.VERTEX_FORMAT }) }));
      return new C.Primitive({ geometryInstances: instances, appearance: new C.PolylineMaterialAppearance({ material, translucent: true }), asynchronous: true });
    }
    /* THE STATES: data/geo/world-states/index.json says which countries have them and where; one file per country, fetched
       once, when the country is in view below STATES_FAR or is selected */
    function stateIndex() {
      if (!st.stateIndexAsked) { st.stateIndexAsked = true; st.stateIndexP = fetch(STATES_DIR + 'index.json').then((r) => (r.ok ? r.json() : null)).then((d) => { st.stateIndex = d && d.countries ? d.countries : {}; st.camKey = ''; return st.stateIndex; }).catch(() => (st.stateIndex = {})); }
      return st.stateIndex;
    }
    function stateIndexP() { stateIndex(); return st.stateIndexP; }
    /* a country's states as shapes (data/geo/world-state-areas, the same countries as the index), fetched once */
    function loadAreas(a2) {
      if (!st.areas.has(a2)) st.areas.set(a2, stateIndexP().then((idx) => (idx && idx[a2] ? fetch(AREAS_DIR + a2 + '.json').then((r) => (r.ok ? r.json() : null)).then((d) => (d ? decode(d) : null)) : null)).catch(() => null));
      return st.areas.get(a2);
    }
    function loadStates(a2) {
      const have = st.states.get(a2);
      if (have) return have.promise;
      const idx = stateIndex();
      if (idx && !idx[a2]) return Promise.resolve(null);
      const it = { primitive: null, lines: null, promise: null };
      it.promise = fetch(STATES_DIR + a2 + '.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
        it.lines = d && Array.isArray(d.lines) ? d.lines.map(undelta) : [];
        if (it.lines.length) it.primitive = viewer.scene.primitives.add(linePrimitive(it.lines, STATE.width, stateMat));
        if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
        return it.lines;
      }).catch(() => null);
      st.states.set(a2, it);
      return it.promise;
    }
    function statesInView() {
      const idx = stateIndex();
      if (!idx || !st.view || !(st.height < STATES_FAR) || st.mode === 'off') return;
      let asked = 0;
      for (const a2 of Object.keys(idx)) {
        if (st.states.has(a2) || !intersects(st.view, idx[a2].bbox)) continue;
        loadStates(a2);
        if (++asked >= 24) { st.camKey = ''; break; } /* the rest on the next frames, a few at a time */
      }
    }
    function build(data, borders, sprite) {
      st.features = decode(data).filter((f) => f && f.properties && Array.isArray(f.properties.label));
      const borderLines = ((borders && borders.lines) || []).map(undelta);
      st.borderCount = borderLines.length;
      st.borders = viewer.scene.primitives.add(linePrimitive(borderLines, BORDER.width, borderMat));
      const usInst = [];
      st.items = st.features.map((f) => {
        const p = f.properties, us = !quiet && p.a2 === 'US';
        if (us) usInst.push(...ringInstances(f, 'hu-country-us', 9, null));
        return { f, code: p.a2 || p.a3, us, box: p.main_bbox || p.bbox, alpha: 1, applied: -1, flag: null, label: null };
      });
      /* the United States' ribbon: red down the middle, white, then blue at both edges (Old Glory red, white, Old Glory blue) */
      const rwb = new C.Material({ translucent: true, fabric: { type: 'HuRedWhiteBlue', uniforms: { alpha: 1 }, source: 'czm_material czm_getMaterial(czm_materialInput materialInput){czm_material m=czm_getDefaultMaterial(materialInput);float t=abs(materialInput.st.t-0.5)*2.0;vec3 c=t<0.34?vec3(0.698,0.133,0.204):(t<0.68?vec3(1.0):vec3(0.235,0.231,0.431));m.diffuse=c;m.alpha=alpha;return m;}' } });
      if (usInst.length) st.rwb = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: usInst, appearance: new C.PolylineMaterialAppearance({ material: rwb, translucent: true }), asynchronous: true }));
      const usF = st.features.find((f) => f.properties.a2 === 'US');
      if (usF && !quiet) {
        /* thirteen stripes, faint, over the land (Stripe repeats in pairs: 6.5 pairs = 13 stripes) */
        const stripes = C.Material.fromType('Stripe', { horizontal: true, evenColor: new C.Color(0.698, 0.133, 0.204, 0.2), oddColor: new C.Color(1, 1, 1, 0.1), repeat: 6.5, offset: 0 });
        const appearance = new C.MaterialAppearance({ material: stripes, flat: true, translucent: true, materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED });
        const inst = polygonsOf(usF).map((poly, k) => new C.GeometryInstance({ id: 'hu-country-us-wash-' + k, geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(poly[0].slice(0, -1).flat())), height: 3000, vertexFormat: C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat, arcType: C.ArcType.GEODESIC }) }));
        st.wash = viewer.scene.primitives.add(new C.Primitive({ geometryInstances: inst, appearance, asynchronous: true }));
        st.washMat = stripes; st.washBase = [0.2, 0.1];
      }
      st.rwbMat = rwb;
      st.flags = viewer.scene.primitives.add(new C.BillboardCollection({ scene: viewer.scene }));
      st.labels = viewer.scene.primitives.add(new C.LabelCollection({ scene: viewer.scene }));
      const cell = sprite && sprite.index && sprite.index.cell, order = sprite && sprite.index && sprite.index.order;
      st.items.forEach((it) => {
        if (quiet) return;
        const p = it.f.properties, pos = C.Cartesian3.fromDegrees(p.label[0], p.label[1], 0);
        const n = order && p.flag ? order.indexOf(p.a2) : -1;
        if (n >= 0 && sprite.img) {
          const c = document.createElement('canvas'); c.width = cell[0]; c.height = cell[1];
          c.getContext('2d').drawImage(sprite.img, (n % sprite.index.cols) * cell[0], Math.floor(n / sprite.index.cols) * cell[1], cell[0], cell[1], 0, 0, cell[0], cell[1]);
          const w = it.us ? 30 : 20;
          it.flag = st.flags.add({ position: pos, image: c, width: w, height: w * 0.75, scaleByDistance: new C.NearFarScalar(4e6, 1.15, 2.2e7, 0.75), distanceDisplayCondition: new C.DistanceDisplayCondition(0, flagReach(p.rank, it.us)), id: { layer: 'countries', code: it.code } });
        }
        if (p.rank <= 2) it.label = st.labels.add({ position: pos, text: p.a2 === 'US' ? 'United States' : p.name, font: '600 11px Inter, system-ui, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.fromCssColorString('#03060c'), outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.TOP, pixelOffset: new C.Cartesian2(0, it.flag ? (it.us ? 13 : 10) : 0), horizontalOrigin: C.HorizontalOrigin.CENTER, scaleByDistance: new C.NearFarScalar(4e6, 1.05, 2.2e7, 0.8), id: { layer: 'countries', code: it.code } });
      });
      st.ready = true;
      /* counts that arrived before the shapes */
      if (st.heat) { drawHeat(); if (legend) { legend.hidden = false; if (o.onLegend) o.onLegend(); } }
      viewer.scene.preRender.addEventListener(frame);
      if (o.onReady) o.onReady();
    }
    /* how far out a flag still shows: the big countries always, smaller ones as the camera comes closer, scaled to the
       screen so a phone's smaller Earth is not a wall of flags (Natural Earth's LABELRANK: 2 = largest) */
    function flagReach(rank, us) {
      if (us || rank <= 2) return Number.POSITIVE_INFINITY;
      const k = Math.max(0.5, Math.min(1.2, (window.innerWidth || 1000) / 1000));
      return k * (rank <= 3 ? 1.6e7 : rank <= 4 ? 1.15e7 : rank <= 5 ? 8.5e6 : 6e6);
    }
    function viewBox() {
      const r = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid, scratchRect);
      if (!r) return null;
      view[0] = C.Math.toDegrees(r.west); view[1] = C.Math.toDegrees(r.south); view[2] = C.Math.toDegrees(r.east); view[3] = C.Math.toDegrees(r.north);
      /* a view that reaches past a pole or wraps the whole Earth is the whole Earth */
      return lonSpan(view[0], view[2]) >= 359 ? null : view;
    }
    function frame() {
      if (!st.ready) return;
      const now = performance.now(), dt = st.lastT ? Math.min(1000, now - st.lastT) : 0;
      st.lastT = now;
      const cam = viewer.camera, pw = cam.positionWC, dw = cam.directionWC;
      const key = st.mode + (pw.x | 0) + ',' + (pw.y | 0) + ',' + (pw.z | 0) + ',' + Math.round(dw.x * 1e3) + ',' + Math.round(dw.y * 1e3);
      const moved = key !== st.camKey;
      const reduced = !!(reducedQ && reducedQ.matches);
      let busy = false;
      if (moved) { st.camKey = key; st.height = cam.positionCartographic.height; st.view = viewBox(); statesInView(); }
      for (const it of st.items) {
        if (moved || it.target === undefined) it.target = fadeTarget({ height: st.height, view: st.view, box: it.box, mode: st.mode });
        it.alpha = stepAlpha(it.alpha, it.target, dt, reduced);
        if (it.alpha !== it.target) busy = true;
        if (Math.abs(it.alpha - it.applied) < 0.004 && !(it.applied === -1)) continue;
        apply(it);
      }
      const lt = lineTarget(st.height, st.mode), stt = stateTarget(st.height, st.mode);
      st.lineAlpha = stepAlpha(st.lineAlpha, lt, dt, reduced);
      st.stateAlpha = stepAlpha(st.stateAlpha, stt, dt, reduced);
      if (st.lineAlpha !== lt || st.stateAlpha !== stt) busy = true;
      borderMat.uniforms.color.alpha = BORDER.alpha * st.lineAlpha;
      if (st.borders) st.borders.show = st.lineAlpha > 0.01;
      stateMat.uniforms.color.alpha = STATE.alpha * st.stateAlpha;
      st.states.forEach((s) => { if (s.primitive) s.primitive.show = st.stateAlpha > 0.01; });
      /* a selected country keeps its states while its borders show, however far out the camera is */
      selectedStateMat.uniforms.color.alpha = STATE.alpha * Math.max(st.stateAlpha, st.lineAlpha);
      if (st.selectedStates) st.selectedStates.show = st.lineAlpha > 0.01;
      if (st.outline) st.outline.show = st.lineAlpha > 0.01;
      /* the heat shows while the borders do: below them the street map or the imagery is the subject */
      if (st.heatFill) st.heatFill.show = st.lineAlpha > 0.15;
      if (st.stateHeat) st.stateHeat.show = st.lineAlpha > 0.15;
      if (legend) { const hide = !st.heat || st.lineAlpha <= 0.15; if (legend.hidden !== hide) { legend.hidden = hide; if (o.onLegend) o.onLegend(); } }
      const wt = washTarget(st.height, st.mode);
      st.washAlpha = stepAlpha(st.washAlpha, Math.min(wt, usAlpha()), dt, reduced);
      if (st.wash && st.washMat) { const u = st.washMat.uniforms; u.evenColor.alpha = st.washBase[0] * st.washAlpha; u.oddColor.alpha = st.washBase[1] * st.washAlpha; st.wash.show = st.washAlpha > 0.01; }
      const any = st.items.some((it) => it.alpha > 0.01);
      if (st.flags) st.flags.show = any;
      if (st.labels) st.labels.show = any;
      if (busy && viewer.scene.requestRenderMode) viewer.scene.requestRender();
    }
    function usAlpha() { const us = st.items.find((x) => x.us); return us ? us.alpha : 0; }
    function apply(it) {
      const a = it.alpha;
      it.applied = a;
      if (it.us) { if (st.rwbMat) st.rwbMat.uniforms.alpha = 0.95 * a; if (st.rwb) st.rwb.show = a > 0.01; }
      if (it.flag) { scratchColor.red = scratchColor.green = scratchColor.blue = 1; scratchColor.alpha = a; it.flag.color = scratchColor; it.flag.show = a > 0.01; }
      if (it.label) { scratchColor.red = scratchColor.green = scratchColor.blue = 1; scratchColor.alpha = a; it.label.fillColor = scratchColor; scratchColor.red = 0.012; scratchColor.green = 0.024; scratchColor.blue = 0.047; scratchColor.alpha = 0.9 * a; it.label.outlineColor = scratchColor; it.label.show = a > 0.01; }
    }
    /* a tap: true when it landed on a country while the borders show (the caller then stops); other taps pass */
    function click(windowPosition) {
      if (!st.ready || st.mode === 'off') return false;
      const down = st.down, tap = { t: down ? down.t : performance.now(), x: windowPosition.x, y: windowPosition.y }, first = st.tap;
      st.down = null;
      st.tap = null;
      clearTimeout(st.tapTimer); st.tapTimer = 0;
      /* the second tap of a double tap: in the country already selected it picks the state; after the tap that selected
         a country it is that same double tap, and the country stays selected */
      if (isDoubleTap(first, tap)) { if (first.inSelected) pickState(first.lon, first.lat); return true; }
      const hit = viewer.camera.pickEllipsoid(windowPosition, viewer.scene.globe.ellipsoid, scratchCart3);
      if (!hit) { if (st.selected) { select(null); return true; } return false; }
      C.Cartographic.fromCartesian(hit, viewer.scene.globe.ellipsoid, scratchCarto);
      const lon = C.Math.toDegrees(scratchCarto.longitude), lat = C.Math.toDegrees(scratchCarto.latitude);
      const f = countryAt(st.features, lon, lat);
      if (!f || st.lineAlpha < 0.15) { if (st.selected) { select(null); return true; } return false; }
      const code = f.properties.a2 || f.properties.a3;
      if (code === st.selected) {
        /* perhaps the first tap of a double tap on a state: a single tap's answer waits out the gap (a picked state goes
           back to the whole country; with none picked, the country is let go, as before) */
        st.tap = Object.assign(tap, { inSelected: true, lon, lat });
        st.tapTimer = setTimeout(() => {
          st.tapTimer = 0;
          /* a second press already down in time is the double tap, held back by a busy frame: its tap decides */
          if (st.down && st.down.t - tap.t <= TAP_GAP) return;
          st.tap = null;
          if (st.selected !== code) return;
          if (st.selectedState) selectState(null); else { select(null); st.items.forEach((x) => { x.applied = -1; }); }
        }, TAP_GAP);
        return true;
      }
      select(f);
      st.tap = tap;
      st.items.forEach((x) => { x.applied = -1; });
      return true;
    }
    /* the mission filter the page applies while a country is selected */
    function keep(m) {
      if (!st.selected) return true;
      return missionCountry(m, regionCountryIndex(o.regions ? o.regions() : []), st.features) === st.selected;
    }
    function loadSprite() {
      return Promise.all([fetch(SPRITE_INDEX).then((r) => (r.ok ? r.json() : null)), new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = SPRITE_URL; })])
        .then(([index, img]) => ({ index, img })).catch(() => ({ index: null, img: null }));
    }
    const getJson = (url) => fetch(url).then((r) => { if (!r.ok) throw Error(url + ' ' + r.status); return r.json(); });
    Promise.all([getJson(DATA_URL), getJson(BORDERS_URL), quiet ? Promise.resolve(null) : loadSprite()])
      .then(([data, borders, sprite]) => build(data, borders, sprite))
      .catch((e) => { st.failed = true; try { console.warn('[world countries] ' + (e && e.message || e)); } catch (_) {} });
    const api = {
      /* the page calls this when the missions arrive: a country picked before then is applied again (card count, pin filter) */
      refresh: () => { if (!st.selected) return; const keepState = st.selectedState; select(st.features.find((f) => (f.properties.a2 || f.properties.a3) === st.selected) || null); if (keepState && st.selected) selectState(keepState); },
      heat: setHeat, click, keep, select: (code) => select(code ? st.features.find((f) => f.properties.a2 === code || f.properties.a3 === code) || null : null), setMode,
      ready: () => st.ready,
      /* Natural Earth's label point for a country, where the globe marks it (the live badges in js/action-globe.js) */
      point: (code) => { const f = st.features.find((x) => x.properties.a2 === code); return f && Array.isArray(f.properties.label) ? f.properties.label.slice(0, 2) : null; },
      /* the country a point falls in on the drawn map: its ISO code (or Natural Earth's own code where it has none), else null */
      at: (lon, lat) => { const f = countryAt(st.features, lon, lat); return f ? f.properties.a2 || f.properties.a3 : null; },
      state: () => ({ ready: st.ready, failed: st.failed, mode: st.mode, selected: st.selected, count: st.items.length, borders: st.borderCount, lines: Math.round(st.lineAlpha * 100) / 100, statesAlpha: Math.round(st.stateAlpha * 100) / 100, states: [...st.states.entries()].filter(([, s]) => s.primitive).map(([k]) => k).sort(), selectedStates: !!st.selectedStates, selectedState: st.selectedState ? st.selectedState.properties.key : null, heat: st.heat ? { countries: Object.keys(st.heatIds).length, total: st.heatTotal, shown: !!(st.heatFill && st.heatFill.show), states: st.stateCounts ? Object.keys(st.stateCounts).length : 0, stateFill: !!st.stateHeat } : null, flags: st.flags ? st.flags.length : 0, labels: st.labels ? st.labels.length : 0, height: Math.round(st.height || 0), wash: Math.round(st.washAlpha * 100) / 100, alpha: Object.fromEntries(st.items.filter((x) => ['US', 'CA', 'MX', 'BR', 'RU', 'FR', 'GB', 'CU'].includes(x.code)).map((x) => [x.code, Math.round(x.alpha * 100) / 100])), card: card.hidden ? null : card.textContent }),
    };
    window.__huCountries = api.state;
    window.__huCountryAt = api.at;
    /* hooks for the browser test, like __huGlobeSettled: put the camera somewhere without aiming a gesture, and spin it */
    window.__huCountriesCam = { view: (lon, lat, h) => viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, h) }), spin: (rad) => viewer.camera.rotate(C.Cartesian3.UNIT_Z, rad),
      /* where a place is on the canvas, in CSS pixels, to tap it */
      screen: (lon, lat) => { const w = C.SceneTransforms.worldToWindowCoordinates(viewer.scene, C.Cartesian3.fromDegrees(lon, lat, 0)); return w ? { x: w.x, y: w.y } : null; },
      /* a tap at a canvas point that went down at time t (ms, the events' clock): the globe's own tap, without the input queue */
      tap: (x, y, t) => { st.down = { t }; return click(new C.Cartesian2(x, y)); } };
    return api;
  }

  return { decode, undelta, fadeTarget, lineTarget, stateTarget, washTarget, stepAlpha, readMode, writeMode, nextMode, isDoubleTap, countryAt, missionCountry, missionCounts, regionCountryIndex, countText, intersects, PREF_KEY, MODES, STATES_FAR, STATES_NEAR, TAP_GAP, TAP_SLOP, mount };
});
