/* THE WORLD'S COUNTRIES (owner, 2026-10-15): "The globe hasn't been broken up in a satisfying visual way to know 'this is
   America and its boundaries' — highlighted red, white and blue, the flag. Each country with its flag. Country boundaries
   need to be drawn and decorated so people can see them from a zoomed-out view. When they zoom in … that decoration should
   go away automatically (they could keep it on if they want)."

   - Borders: Natural Earth 1:110m Admin 0 (public domain), data/geo/world-countries-110m.json (tools/build-world-countries.mjs).
     One polyline primitive for every border; colour per country is a per-instance attribute, so a fade is a
     few typed-array writes, never a rebuild.
   - Flags: flag-icons (MIT), whole flags scaled into one atlas (assets/flags/flag-sprite-4x3.webp, tools/build-flag-sprite.mjs),
     one billboard per country at Natural Earth's label point. A flag is a nation's own artwork: it is scaled, never redrawn.
   - The United States: a red, white and blue ribbon for its border, a faint thirteen-stripe wash over its land, and its flag.
   - The fade: each country's decoration eases out as the camera comes down and as the country's main body fills the view
     (fadeTarget below); prefers-reduced-motion makes it instant. "Countries" in the layer row cycles: fade as I zoom (default)
     → keep them on → off. The choice is kept in this browser only (a convenience; nothing is sent anywhere).
   - A tap on a country (while its decoration shows) names it and counts the published missions pinned there, and filters the
     mission pins to it. The count is read from the mission rows themselves: a row's country_code (the country-level regions
     contract), else its region's country_code from action_globe_public_regions. With neither, the honest answer is
     "No missions here yet". Nothing is estimated.

   The pure parts (fade, preference, point-in-country, counts) are exported for node --test; the browser part needs Cesium. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HuCountries = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DATA_URL = 'data/geo/world-countries-110m.json';
  const SPRITE_URL = 'assets/flags/flag-sprite-4x3.webp';
  const SPRITE_INDEX = 'assets/flags/flag-sprite-4x3.json';
  const PREF_KEY = 'hu_world_countries';
  const MODES = ['auto', 'always', 'off'];
  /* heights in metres above the ellipsoid. Below H_OFF nothing is decorated (the street map / aerial imagery is the
     subject there); a country's own fill test only applies below FILL_CONSIDER, so a whole-Earth view keeps Russia's flag. */
  const H_OFF = 700e3, H_ON = 1400e3, FILL_CONSIDER = 9e6, FILL_FULL = 0.55, FILL_GONE = 0.95;
  /* the stripes wash is the strongest decoration, so it only shows from far out, whatever the mode */
  const WASH_OFF = 2.5e6, WASH_ON = 4.5e6;
  const FADE_MS = 220;

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
    const st = { mode: quiet ? 'auto' : readMode(safeStorage()), features: [], ready: false, selected: null, items: [], washAlpha: 1, outline: null, rwb: null, wash: null, flags: null, labels: null, highlight: null, lastT: 0, camKey: '', failed: false };
    const scratchRect = new C.Rectangle(), scratchColor = new C.Color(), scratchU8 = new Uint8Array(4), scratchShow = new Uint8Array(1), scratchCarto = new C.Cartographic(), scratchCart3 = new C.Cartesian3(), view = [0, 0, 0, 0];
    const outlineBase = C.Color.fromCssColorString('#f4f1ea');
    const button = addButton();
    const card = addCard();
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
      const t = { auto: 'Countries: borders and flags, fading as you zoom in (tap to keep them on)', always: 'Countries: kept on while you zoom (tap to hide)', off: 'Countries: hidden (tap to show)' }[st.mode];
      button.setAttribute('aria-pressed', st.mode === 'off' ? 'false' : 'true');
      button.setAttribute('aria-label', t); button.title = t; button.dataset.mode = st.mode;
    }
    function setMode(m) { st.mode = m; writeMode(safeStorage(), m); paintButton(); if (m === 'off') select(null); st.camKey = ''; }
    function addCard() {
      const el = document.createElement('div');
      el.className = 'country-card'; el.id = 'countryCard'; el.hidden = true;
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      return el;
    }
    function paintCard(f) {
      if (!f) { card.hidden = true; card.innerHTML = ''; return; }
      const p = f.properties, counts = missionCounts(o.missions ? o.missions() : [], o.regions ? o.regions() : [], st.features);
      const n = p.a2 ? counts[p.a2] || 0 : 0;
      card.innerHTML = (p.flag && !quiet ? '<img class="country-card__flag" src="assets/flags/4x3/' + p.a2.toLowerCase() + '.svg" alt="" width="32" height="24">' : '') +
        '<span class="country-card__text"><b>' + escHtml(p.name) + '</b><small>' + escHtml(countText(n)) + '</small></span>' +
        '<button type="button" class="country-card__close" aria-label="Show every country">×</button>';
      card.querySelector('button').onclick = () => select(null);
      card.hidden = false;
      return n;
    }
    function select(f) {
      const code = f ? f.properties.a2 || f.properties.a3 : null;
      if (st.highlight) { viewer.scene.primitives.remove(st.highlight); st.highlight = null; }
      st.selected = f ? code : null;
      const n = paintCard(f);
      if (f) st.highlight = viewer.scene.primitives.add(polygonPrimitive(f, C.Color.WHITE.withAlpha(0.16)));
      if (o.onSelect) o.onSelect(f ? { code: f.properties.a2, a3: f.properties.a3, name: f.properties.name, missions: n || 0 } : null);
    }
    function polygonInstances(f, color) {
      return polygonsOf(f).map((poly, k) => new C.GeometryInstance({
        id: 'hu-country-fill-' + (f.properties.a3 || '') + '-' + k,
        geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(poly[0].slice(0, -1).flat()), poly.slice(1).map((h) => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h.slice(0, -1).flat())))), height: 3000, vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT, arcType: C.ArcType.GEODESIC }),
        attributes: color ? { color: C.ColorGeometryInstanceAttribute.fromColor(color) } : undefined,
      }));
    }
    function polygonPrimitive(f, color) {
      const instances = polygonInstances(f, color), appearance = new C.PerInstanceColorAppearance({ flat: true, translucent: true });
      return new C.Primitive({ geometryInstances: instances, appearance, asynchronous: false });
    }
    function ringInstances(f, id, width, color) {
      return polygonsOf(f).flatMap((poly, k) => poly.map((ring, r) => new C.GeometryInstance({
        id: id + '-' + k + '-' + r,
        geometry: ground ? new C.GroundPolylineGeometry({ positions: C.Cartesian3.fromDegreesArray(ring.flat()), width, arcType: C.ArcType.GEODESIC }) : new C.PolylineGeometry({ positions: C.Cartesian3.fromDegreesArrayHeights(ring.flatMap((p) => [p[0], p[1], 3000])), width, arcType: C.ArcType.GEODESIC, vertexFormat: color ? C.PolylineColorAppearance.VERTEX_FORMAT : C.PolylineMaterialAppearance.VERTEX_FORMAT }),
        attributes: color ? { color: C.ColorGeometryInstanceAttribute.fromColor(color) } : undefined,
      })));
    }
    let ground = false;
    function build(data, sprite) {
      /* lines on the ellipsoid, 3 km up, not ground-clamped: measured in Chromium's software GL, ground-clamped polylines
         (a shadow volume per segment) doubled the frame time; from where the decoration shows, 3 km is invisible, and with
         depthTestAgainstTerrain off (Cesium's default) mountains do not cut the lines. */
      ground = false;
      const Line = ground ? C.GroundPolylinePrimitive : C.Primitive;
      st.features = (data.features || []).filter((f) => f && f.properties && Array.isArray(f.properties.label));
      const plain = [], usInst = [];
      st.items = st.features.map((f) => {
        const p = f.properties, us = !quiet && p.a2 === 'US';
        const id = 'hu-country-' + (p.a2 || p.a3);
        const inst = us ? ringInstances(f, id, 9, null) : ringInstances(f, id, quiet ? .7 : 1.4, outlineBase.withAlpha(quiet ? .25 : .5));
        (us ? usInst : plain).push(...inst);
        return { f, code: p.a2 || p.a3, us, box: p.main_bbox || p.bbox, ids: inst.map((x) => x.id), attrs: null, alpha: 1, applied: -1, flag: null, label: null };
      });
      st.outline = viewer.scene.primitives.add(new Line({ geometryInstances: plain, appearance: new C.PolylineColorAppearance({ translucent: true }), asynchronous: true }));
      /* the United States' ribbon: red down the middle, white, then blue at both edges (Old Glory red, white, Old Glory blue) */
      const rwb = new C.Material({ translucent: true, fabric: { type: 'HuRedWhiteBlue', uniforms: { alpha: 1 }, source: 'czm_material czm_getMaterial(czm_materialInput materialInput){czm_material m=czm_getDefaultMaterial(materialInput);float t=abs(materialInput.st.t-0.5)*2.0;vec3 c=t<0.34?vec3(0.698,0.133,0.204):(t<0.68?vec3(1.0):vec3(0.235,0.231,0.431));m.diffuse=c;m.alpha=alpha;return m;}' } });
      if (usInst.length) st.rwb = viewer.scene.primitives.add(new Line({ geometryInstances: usInst, appearance: new C.PolylineMaterialAppearance({ material: rwb, translucent: true }), asynchronous: true }));
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
      viewer.scene.preRender.addEventListener(frame);
    }
    /* how far out a flag still shows: the big countries always, smaller ones as the camera comes closer, scaled to the
       screen so a phone's smaller Earth is not a wall of flags (Natural Earth's LABELRANK: 2 = largest) */
    function flagReach(rank, us) {
      if (us || rank <= 2) return Number.POSITIVE_INFINITY;
      const k = Math.max(0.5, Math.min(1.2, (window.innerWidth || 1000) / 1000));
      return k * (rank <= 3 ? 1.6e7 : rank <= 4 ? 1.15e7 : rank <= 5 ? 8.5e6 : 6e6);
    }
    function cacheAttrs() {
      let all = true;
      st.items.forEach((it) => {
        if (it.attrs || it.us) return;
        if (!st.outline || !st.outline.ready) { all = false; return; }
        it.attrs = it.ids.map((id) => st.outline.getGeometryInstanceAttributes(id)).filter(Boolean);
      });
      return all;
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
      if (moved) { st.camKey = key; st.height = cam.positionCartographic.height; st.view = viewBox(); }
      const attrsReady = cacheAttrs();
      for (const it of st.items) {
        if (moved || it.target === undefined) it.target = fadeTarget({ height: st.height, view: st.view, box: it.box, mode: st.mode });
        it.alpha = stepAlpha(it.alpha, it.target, dt, reduced);
        if (it.alpha !== it.target) busy = true;
        if (Math.abs(it.alpha - it.applied) < 0.004 && !(it.applied === -1)) continue;
        if (!it.us && !attrsReady && !it.attrs) { busy = true; continue; }
        apply(it);
      }
      const wt = washTarget(st.height, st.mode);
      st.washAlpha = stepAlpha(st.washAlpha, Math.min(wt, usAlpha()), dt, reduced);
      if (st.wash && st.washMat) { const u = st.washMat.uniforms; u.evenColor.alpha = st.washBase[0] * st.washAlpha; u.oddColor.alpha = st.washBase[1] * st.washAlpha; st.wash.show = st.washAlpha > 0.01; }
      const any = st.items.some((it) => it.alpha > 0.01);
      if (st.outline) st.outline.show = any;
      if (st.flags) st.flags.show = any;
      if (st.labels) st.labels.show = any;
      if (busy && viewer.scene.requestRenderMode) viewer.scene.requestRender();
    }
    function usAlpha() { const us = st.items.find((x) => x.us); return us ? us.alpha : 0; }
    function apply(it) {
      const a = it.alpha;
      it.applied = a;
      if (it.us) { if (st.rwbMat) st.rwbMat.uniforms.alpha = 0.95 * a; if (st.rwb) st.rwb.show = a > 0.01; }
      else if (it.attrs) {
        C.Color.clone(outlineBase, scratchColor); scratchColor.alpha = (it.code === st.selected ? 0.95 : quiet ? 0.25 : 0.5) * a;
        C.ColorGeometryInstanceAttribute.toValue(scratchColor, scratchU8);
        C.ShowGeometryInstanceAttribute.toValue(a > 0.01, scratchShow);
        for (const at of it.attrs) { at.color = scratchU8; at.show = scratchShow; }
      }
      if (it.flag) { scratchColor.red = scratchColor.green = scratchColor.blue = 1; scratchColor.alpha = a; it.flag.color = scratchColor; it.flag.show = a > 0.01; }
      if (it.label) { scratchColor.red = scratchColor.green = scratchColor.blue = 1; scratchColor.alpha = a; it.label.fillColor = scratchColor; scratchColor.red = 0.012; scratchColor.green = 0.024; scratchColor.blue = 0.047; scratchColor.alpha = 0.9 * a; it.label.outlineColor = scratchColor; it.label.show = a > 0.01; }
    }
    /* a tap: true when it landed on a decorated country (the caller then stops); taps on faded or hidden countries pass */
    function click(windowPosition) {
      if (!st.ready || st.mode === 'off') return false;
      const hit = viewer.camera.pickEllipsoid(windowPosition, viewer.scene.globe.ellipsoid, scratchCart3);
      if (!hit) { if (st.selected) { select(null); return true; } return false; }
      C.Cartographic.fromCartesian(hit, viewer.scene.globe.ellipsoid, scratchCarto);
      const f = countryAt(st.features, C.Math.toDegrees(scratchCarto.longitude), C.Math.toDegrees(scratchCarto.latitude));
      const it = f && st.items.find((x) => x.f === f);
      if (!it || it.alpha < 0.15) { if (st.selected) { select(null); return true; } return false; }
      const code = f.properties.a2 || f.properties.a3;
      select(code === st.selected ? null : f);
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
    Promise.all([fetch(DATA_URL).then((r) => { if (!r.ok) throw Error('countries ' + r.status); return r.json(); }), quiet ? Promise.resolve(null) : loadSprite()])
      .then(([data, sprite]) => build(data, sprite))
      .catch((e) => { st.failed = true; try { console.warn('[world countries] ' + (e && e.message || e)); } catch (_) {} });
    const api = {
      /* the page calls this when the missions arrive: a country picked before then is applied again (card count, pin filter) */
      refresh: () => { if (st.selected) select(st.features.find((f) => (f.properties.a2 || f.properties.a3) === st.selected) || null); },
      click, keep, select: (code) => select(code ? st.features.find((f) => f.properties.a2 === code || f.properties.a3 === code) || null : null), setMode,
      /* Natural Earth's label point for a country, where the globe marks it (the live badges in js/action-globe.js) */
      ready: () => st.ready,
      point: (code) => { const f = st.features.find((x) => x.properties.a2 === code); return f && Array.isArray(f.properties.label) ? f.properties.label.slice(0, 2) : null; },
      state: () => ({ ready: st.ready, failed: st.failed, mode: st.mode, selected: st.selected, ground, count: st.items.length, flags: st.flags ? st.flags.length : 0, labels: st.labels ? st.labels.length : 0, height: Math.round(st.height || 0), wash: Math.round(st.washAlpha * 100) / 100, alpha: Object.fromEntries(st.items.filter((x) => ['US', 'CA', 'MX', 'BR', 'RU', 'FR', 'GB', 'CU'].includes(x.code)).map((x) => [x.code, Math.round(x.alpha * 100) / 100])), card: card.hidden ? null : card.textContent }),
    };
    window.__huCountries = api.state;
    /* hooks for the browser test, like __huGlobeSettled: put the camera somewhere without aiming a gesture, and spin it */
    window.__huCountriesCam = { view: (lon, lat, h) => viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, h) }), spin: (rad) => viewer.camera.rotate(C.Cartesian3.UNIT_Z, rad) };
    return api;
  }

  return { fadeTarget, washTarget, stepAlpha, readMode, writeMode, nextMode, countryAt, missionCountry, missionCounts, regionCountryIndex, countText, intersects, PREF_KEY, MODES, mount };
});
