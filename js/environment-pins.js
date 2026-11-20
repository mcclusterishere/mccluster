/* Environmental observations share the existing Cesium viewer. This module never
   fetches Halo, requests a location or accepts member/assignment information.
   Since slice G1 (2026-11-17) it is the compatibility shim over js/environment-layers.js: the panel keeps
   sending hu:environment-pins and js/action-globe.js keeps calling create()/set/draw/destroy/focus/pick, while
   the drawing is done by the typed batched primitives of MCC_ENVIRONMENT_LAYERS (loaded before this file in
   action-globe.html). normalize() keeps today's validation and adds, ONLY when a row carries them, the G1 item's
   additive keys: category, location_kind, observed_at, fetched_at, facts and significant (the source link rides
   with observed_at: the legacy {id,title,lat,lon,stale} message carried neither). The pins message may also carry
   `sources`, the feed providers' terms as the panel copied them from the feed's own source records (id, label, url,
   attribution, licence, coverage; review G1R-10): normalizeSources() keeps those six public fields, clipped, https
   links only, and the typed layers answer a selection with them instead of a client copy. The legacy entity renderer
   below is kept only as the fallback that scripts/test/world-environment.test.mjs runs without the layers; it is
   never reached on the real page. */
(function (root) {
  'use strict';
  const LIMIT = 600;
  const iso = v => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);
  /* https only, no userinfo, no whitespace (a regex, so the shim needs no URL global in the unit-test vm) */
  const httpsUrl = v => (typeof v === 'string' && v.length <= 2000 && /^https:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/.test(v) ? v : '');
  function normalize(rows) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).slice(0, LIMIT).flatMap(row => {
      if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]{0,299}$/.test(row.id) || seen.has(row.id)) return [];
      if (typeof row.lat !== 'number' || typeof row.lon !== 'number' || !Number.isFinite(row.lat) || !Number.isFinite(row.lon) || Math.abs(row.lat) > 90 || Math.abs(row.lon) > 180) return [];
      seen.add(row.id);
      const out = { id: row.id, lat: row.lat, lon: row.lon, title: String(row.title || 'Environmental observation').slice(0, 160), stale: row.stale === true };
      if (typeof row.category === 'string') out.category = row.category.slice(0, 40);
      if (typeof row.location_kind === 'string') out.location_kind = row.location_kind.slice(0, 20);
      if ('observed_at' in row) {
        out.observed_at = iso(row.observed_at);
        const url = row.source && typeof row.source === 'object' ? httpsUrl(row.source.url) : '';
        if (url) out.source = { label: typeof row.source.label === 'string' ? row.source.label.slice(0, 120) : '', url };
      }
      if ('fetched_at' in row) out.fetched_at = iso(row.fetched_at);
      if (Array.isArray(row.facts)) out.facts = row.facts.filter(f => f && typeof f.label === 'string' && typeof f.value === 'string').slice(0, 16).map(f => ({ label: f.label.slice(0, 80), value: f.value.slice(0, 320) }));
      if (row.significant === true) out.significant = true;
      return [out];
    });
  }
  /* the feed providers' terms that ride with the pins: at most eight records of six public fields, nothing else */
  function normalizeSources(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).slice(0, 8).flatMap(s => {
      if (!s || typeof s.id !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(s.id) || seen.has(s.id)) return [];
      seen.add(s.id);
      const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
      return [{ id: s.id, label: str(s.label, 120), url: httpsUrl(s.url), attribution: str(s.attribution, 200), license: str(s.license, 200), coverage: str(s.coverage, 300) }];
    });
  }
  function create(getViewer, getCesium, tell) {
    const layers = root.MCC_ENVIRONMENT_LAYERS;
    if (layers && typeof layers.setEvents === 'function') {
      return {
        set(data) { const d = data || {}; layers.setEvents(normalize(d.items), Object.assign({ on: d.on === true, selected: typeof d.selected === 'string' ? d.selected : '' }, Array.isArray(d.sources) ? { sources: normalizeSources(d.sources) } : {})); },
        draw() { layers.redraw(); },
        destroy() { layers.setEvents([], { on: false, selected: '' }); },
        focus(id) { layers.focus(id); },
        /* the tap's position lets a quake's glyph answer a tap within 22 px of it (event timeline slice S5) */
        pick(picked, position) { return layers.pick(picked, position) === true; }
      };
    }
    /* the legacy entity renderer: the fallback only */
    let rows = [], pins = [], on = false, selected = '';
    function draw() {
      const viewer = getViewer(), C = getCesium();
      if (!viewer || !C) return;
      pins.forEach(pin => viewer.entities.remove(pin)); pins = [];
      if (!on) return;
      pins = rows.map(row => viewer.entities.add({
        position: C.Cartesian3.fromDegrees(row.lon, row.lat, 3000),
        point: { pixelSize: row.id === selected ? 17 : 11, color: C.Color.fromCssColorString(row.stale ? '#a1abb6' : '#76dfb5'), outlineColor: C.Color.fromCssColorString('#10251e'), outlineWidth: 3 },
        label: { text: row.title, font: '600 12px system-ui,sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -24), distanceDisplayCondition: new C.DistanceDisplayCondition(0, row.id === selected ? 25000000 : 1000000) },
        properties: { environmentEventId: row.id }
      }));
      viewer.scene.requestRender?.();
    }
    return {
      set(data) { on = data.on === true; rows = normalize(data.items); selected = rows.some(row => row.id === data.selected) ? data.selected : ''; draw(); },
      draw,
      destroy() { on = false; rows = []; selected = ''; draw(); },
      focus(id) {
        const viewer = getViewer(), C = getCesium(), row = on && rows.find(row => row.id === id);
        if (!viewer || !C || !row) return;
        selected = row.id; draw();
        viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(row.lon, row.lat, 1300000), duration: root.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1 });
      },
      pick(picked) {
        const id = picked?.id?.properties?.environmentEventId?.getValue?.();
        if (!on || !rows.some(row => row.id === id)) return false;
        selected = id; draw(); tell({ type: 'hu:environment-selected', id }); return true;
      }
    };
  }
  root.MCC_ENVIRONMENT_PINS = Object.freeze({ normalize, normalizeSources, create });
})(window);
