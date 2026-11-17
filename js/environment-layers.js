/* THE ENVIRONMENTAL GLOBE'S TYPED LAYERS (slice G1, 2026-11-17): earthquakes, satellite fire detections, fire
   perimeters, weather alerts, natural events, coastal water levels and ShakeMap contours on the one Cesium viewer,
   drawn as batched primitives (one collection per layer type, rebuilt only when the data changed, never per frame)
   with per-layer pick ids. Every visual encodes a quantity the source reported and the legend says which. Nothing
   flashes: the selection fades softly through instance attributes, and the one illustrative animation is a labelled
   ripple on the selected earthquake, one ground primitive whose material alpha changes for at most 6 s under a
   bounded render hold (the alpha-only pattern is adapted from gods-eye-view src/render/cesium/draw.js pulseAlpha and
   runPulses, MIT, Copyright (c) 2026 Bilawal Sidhu, see THIRD-PARTY-NOTICES; Hitman's Halo recorded that 58 discs
   with callback axes cost 32.4 ms a frame against 1.4 ms static). Geometry is never touched after construction.
   This file fetches nothing itself (js/environment-layers-client.js does, without any credential), reads no clock in
   its pure encodings, and every selection answers with source, recorded time, retrieval time, coverage and status;
   a fetch time never stands in for an observation time. */
(function (root) {
  'use strict';
  const ENV = 'mcc-environment/v1';
  const LAYER_KEYS = Object.freeze(['fires', 'perimeters', 'alerts', 'eonet', 'tides']);
  const GREY = '#9aa0a6';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isoOrNull = v => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  /* ENCODINGS_BEGIN: pure, clock-free, unit-tested on their own (scripts/test/environment-layers-encodings.test.mjs) */
  /* Radiated energy E grows as 10^(1.5 M) (Gutenberg-Richter); the disc's AREA is proportional to E, so its radius is
     r(M) = 25 km * 10^(0.75 (M - 5)): M4 4.4 km, M5 25 km, M6 141 km, M7 790 km, capped at 1,000 km from about M7.14
     and floored at 300 m. It shows magnitude, never the area affected. */
  function quakeRadiusM(mag) {
    if (typeof mag !== 'number' || !Number.isFinite(mag)) return null;
    return clamp(25000 * 10 ** (0.75 * (mag - 5)), 300, 1000000);
  }
  function depthColour(km) {
    if (typeof km !== 'number' || !Number.isFinite(km)) return GREY;
    return km < 33 ? '#ff5a3c' : km < 70 ? '#ffb347' : km < 300 ? '#ffe066' : '#8bb8ff';
  }
  /* the Worker formats the quake facts as `${n}` and `${n} km` (vendor evidence.mjs) */
  function quakeFromFacts(facts) {
    const list = Array.isArray(facts) ? facts : [];
    const value = label => { const f = list.find(x => x && x.label === label && typeof x.value === 'string'); return f ? f.value.trim() : ''; };
    const magText = value('Magnitude'), depthText = value('Depth');
    const mag = magText ? Number(magText) : NaN, depth = depthText ? parseFloat(depthText) : NaN;
    return { mag: Number.isFinite(mag) ? mag : null, depth_km: Number.isFinite(depth) ? depth : null };
  }
  function frpColour(mw) {
    if (typeof mw !== 'number' || !Number.isFinite(mw)) return GREY;
    return mw < 5 ? '#ffd166' : mw < 20 ? '#ffa62b' : mw < 60 ? '#ff5e2b' : mw < 200 ? '#ff2d55' : '#ffffff';
  }
  /* a summary cell's radius grows with the square root of its summed radiative power: area proportional to MW */
  function cellRadiusPx(sumMw) {
    const s = typeof sumMw === 'number' && Number.isFinite(sumMw) && sumMw > 0 ? sumMw : 0;
    return clamp(4 + 2.2 * Math.sqrt(s / 10), 4, 40);
  }
  const cellColour = cell => (cell && typeof cell.frp_sum_mw === 'number' && cell.frp_sum_mw > 0 ? frpColour(cell.frp_max_mw) : GREY);
  const SEVERITY = { Extreme: ['#b3001b', 0.3], Severe: ['#ff6a00', 0.26], Moderate: ['#ffcc00', 0.22], Minor: ['#3fa7ff', 0.18] };
  function severityTint(severity) {
    const row = Object.prototype.hasOwnProperty.call(SEVERITY, severity) ? SEVERITY[severity] : [GREY, 0.16];
    return { hex: row[0], alpha: row[1] };
  }
  /* 5 km pedestal plus 30 km per metre above the station's MLLW datum: 1 m is a 35 km column */
  const stationColumnM = valueM => 5000 + 30000 * Math.max(0, typeof valueM === 'number' && Number.isFinite(valueM) ? valueM : 0);
  function stationColour(q, valueM) {
    if (typeof valueM === 'number' && Number.isFinite(valueM) && valueM < 0) return '#6d8a84';
    return q === 'v' ? '#35c4a8' : '#9ddfcf';
  }
  const MMI_PALETTE = ['#ffffff', '#ffffff', '#bfccff', '#a0e6ff', '#80ffff', '#7aff93', '#ffff00', '#ffc800', '#ff9100', '#ff0000', '#c80000'];
  function mmiColour(contour) {
    const own = contour && typeof contour.color === 'string' && /^#[0-9a-f]{6}$/i.test(contour.color) ? contour.color.toLowerCase() : null;
    if (own) return own;
    const m = Math.round(Number(contour && contour.mmi) || 0);
    return MMI_PALETTE[clamp(m, 1, 10)];
  }
  const EONET_COLOURS = { fire: '#ff7a1a', cyclone: '#7cc7ff', tornado: '#9ad0ff', storm: '#7cc7ff', volcano: '#c04dff', ice: '#b8f3ff', flood: '#4aa3ff', heat: '#ff3d5e', dust: '#c8b89a', landslide: '#a0724a', snow: '#ffffff', quake: '#ff5a3c', wave: '#2bd9c7', other: '#cfd8dc' };
  const eonetColour = kind => (Object.prototype.hasOwnProperty.call(EONET_COLOURS, kind) ? EONET_COLOURS[kind] : EONET_COLOURS.other);
  const lod = heightM => (heightM <= 400000 ? 'near' : 'far');
  function pickId(spec) {
    const out = { env: ENV, layer: spec.layer, id: spec.id, kind: spec.kind };
    if (spec.part !== undefined) out.part = spec.part;
    if (spec.index !== undefined) out.index = spec.index;
    return Object.freeze(out);
  }
  const isEnvPick = picked => !!(picked && picked.id && typeof picked.id === 'object' && picked.id.env === ENV);
  const providerOf = id => String(id || '').split(':')[0];
  const KINDS = { usgs: 'quake', nws: 'alert', eonet: 'natural', nhc: 'cyclone' };
  const kindOf = item => KINDS[providerOf(item && item.id)] || 'event';
  const notSupplied = 'not supplied';
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v : fallback);
  const timeText = iso => isoOrNull(iso) || notSupplied;
  const num = (v, unit) => (typeof v === 'number' && Number.isFinite(v) ? `${v}${unit ? ' ' + unit : ''}` : null);
  const firstVertex = polygons => { const ring = Array.isArray(polygons) && Array.isArray(polygons[0]) && Array.isArray(polygons[0][0]) ? polygons[0][0] : null; const p = ring && Array.isArray(ring[0]) ? ring[0] : null; return p && typeof p[0] === 'number' && typeof p[1] === 'number' ? { lon: p[0], lat: p[1] } : { lon: null, lat: null }; };
  function shakemapLabel(sm) {
    const s = sm || {};
    return `modelled shaking (MMI), USGS ShakeMap v${s.version === null || s.version === undefined ? '?' : s.version} (${text(s.review_status, 'review status not supplied')}), max MMI ${s.max_mmi === null || s.max_mmi === undefined ? 'not supplied' : s.max_mmi}, computed ${timeText(s.process_time)}`;
  }
  /* the facts of one selectable thing, with its own time under its own label; the fetch time is never here */
  function factsFor(kind, item) {
    const out = { title: '', facts: [], observed_at: null, observed_label: 'unknown', observed_date_only: false, lat: null, lon: null, modelled: false };
    const it = item || {};
    const push = (label, value) => { out.facts.push({ label, value: value === null || value === undefined ? notSupplied : String(value) }); };
    const own = (label, iso) => { out.observed_at = isoOrNull(iso); out.observed_label = label; };
    if (kind === 'fire_detection') {
      const row = Array.isArray(it.row) ? it.row : [];
      out.title = `Satellite fire detection (${text(row[5], 'satellite not supplied')})`;
      push('Satellite', text(row[5], notSupplied));
      push('Radiative power', num(row[2], 'MW') || 'not reported');
      push('Confidence', text(row[3], 'not reported'));
      push('Acquired', timeText(row[4]));
      push('Overpass', row[6] === 'D' ? 'day' : row[6] === 'N' ? 'night' : 'not reported');
      own('Acquired', row[4]); out.lon = finite(row[0]); out.lat = finite(row[1]);
    } else if (kind === 'fire_cell') {
      const c = Array.isArray(it.cell) ? it.cell : [];
      const west = finite(c[0]), south = finite(c[1]);
      out.title = `Fire detections · 1° area at ${south}°, ${west}° (south-west corner)`;
      push('Detections', finite(c[2]));
      push('Summed radiative power', typeof c[3] === 'number' && c[3] > 0 ? `${c[3]} MW` : 'FRP not reported');
      push('Peak radiative power', num(c[4], 'MW') || 'not reported');
      push('Latest overpass', timeText(c[5]));
      push('Area', `1° cell, south-west corner ${south}°, ${west}°`);
      own('Acquired', c[5]); out.lon = west === null ? null : west + 0.5; out.lat = south === null ? null : south + 0.5;
    } else if (kind === 'perimeter') {
      out.title = text(it.name, 'Fire perimeter');
      push('Name', text(it.name, notSupplied));
      push('GIS acres', typeof it.gis_acres === 'number' && Number.isFinite(it.gis_acres) ? it.gis_acres.toLocaleString('en-US') : notSupplied);
      push('Captured', timeText(it.polygon_captured_at));
      push('Last edited', timeText(it.last_edited_at));
      push('Discovered', timeText(it.discovered_at));
      if (typeof it.polygons_dropped === 'number' && it.polygons_dropped > 0) push('Geometry', `polygons dropped: ${it.polygons_dropped}`);
      if (it.geometry_truncated === true) push('Geometry limit', 'geometry truncated');
      if (typeof it.rings_skipped === 'number' && it.rings_skipped > 0) push('Rings skipped here', `${it.rings_skipped} ring(s) not closed by the provider were left out, never closed`);
      own('Captured', it.polygon_captured_at); Object.assign(out, firstVertex(it.polygons));
    } else if (kind === 'alert' && it && typeof it === 'object' && 'headline' in it) {
      out.title = text(it.headline, text(it.event, 'Alert'));
      push('Event', text(it.event, notSupplied)); push('Severity', text(it.severity, notSupplied)); push('Certainty', text(it.certainty, notSupplied)); push('Urgency', text(it.urgency, notSupplied));
      push('Area', text(it.area, notSupplied)); push('Sent', timeText(it.sent)); push('Onset', timeText(it.onset)); push('Expires', timeText(it.expires)); push('Ends', timeText(it.ends));
      own('Sent', it.sent); Object.assign(out, firstVertex(it.polygons));
    } else if (kind === 'natural' && it && it.event) {
      const e = it.event, p = it.point || {};
      out.title = text(e.title, 'Natural event');
      push('Categories', Array.isArray(e.categories) && e.categories.length ? e.categories.join(', ') : notSupplied);
      const date = isoOrNull(p.date);
      push('Reported', date ? (p.placeholder_time === true ? `${date.slice(0, 10)} · date only (time of day not reported)` : date) : notSupplied);
      if (typeof p.magnitude === 'number' && Number.isFinite(p.magnitude)) push('Magnitude', `${p.magnitude}${p.unit ? ' ' + p.unit : ''}`);
      if (Array.isArray(e.reported_by) && e.reported_by.length) push('Sources', e.reported_by.join(', '));
      if ((typeof e.track_count === 'number' && e.track_count > 1) || e.track_truncated === true) push('Track', `track points: ${e.track_count}${e.track_truncated === true ? ' (truncated)' : ''}`);
      own('Reported', p.date); out.observed_date_only = p.placeholder_time === true;
      if (p.type === 'Point' && Array.isArray(p.coordinates)) { out.lon = finite(p.coordinates[0]); out.lat = finite(p.coordinates[1]); } else Object.assign(out, firstVertex(p.polygons));
    } else if (kind === 'station') {
      out.title = [text(it.name, ''), text(it.place, '')].filter(Boolean).join(' · ') || `Station ${it.station}`;
      push('Station', `${text(it.name, 'unnamed')} (${text(it.station, '?')}) · ${text(it.place, notSupplied)}`);
      push('Observed water level', typeof it.value_m === 'number' && Number.isFinite(it.value_m) ? `${it.value_m} m above MLLW` : notSupplied);
      push('Quality', text(it.quality, notSupplied));
      push('Observed', timeText(it.observed_at));
      push('Status', `${text(it.status, 'unknown')}${it.reason ? ` (${it.reason})` : ''}`);
      own('Observed', it.observed_at); out.lon = finite(it.lon); out.lat = finite(it.lat);
    } else if (kind === 'shakemap') {
      const q = it.quake || {}, sm = it.shakemap || {};
      out.title = text(q.title, 'Earthquake');
      for (const f of Array.isArray(q.facts) ? q.facts : []) if (f && typeof f.label === 'string') push(f.label, f.value);
      push('ShakeMap', shakemapLabel(sm));
      if (it.contour) push('Contour', `MMI ${it.contour.mmi}${it.contour.color ? ' · USGS colour ' + it.contour.color : ''}`);
      own('Computed', sm.process_time); out.modelled = true; out.lon = finite(q.lon); out.lat = finite(q.lat);
    } else {
      /* a feed item (the pins message): earthquake, placed alert, natural event, cyclone */
      out.title = text(it.title, 'Environmental observation');
      for (const f of Array.isArray(it.facts) ? it.facts : []) if (f && typeof f.label === 'string') push(f.label, f.value);
      if (kind === 'quake' && !out.facts.some(f => f.label === 'Magnitude')) push('Magnitude', 'Magnitude not supplied');
      out.observed_at = isoOrNull(it.observed_at); out.observed_label = out.observed_at ? 'Observed' : 'unknown';
      out.lon = finite(it.lon); out.lat = finite(it.lat);
    }
    return out;
  }
  const LEGEND = {
    events: 'Dots mark the feed\'s reported event positions (USGS, NWS, NASA EONET, NOAA NHC); an alert\'s dot is a vertex of its own polygon, never a centroid.',
    quakes: 'Disc area shows magnitude (energy, 10^1.5M), not the area affected; capped at 1,000 km; colour shows depth: red shallow (<33 km) to blue deep (>=300 km).',
    fires: 'Each dot is a satellite detection (375 m pixel), colour shows radiative power (MW): pale yellow <5 to white-hot >=200; far away, circles summarise a 1-degree area and their size shows the summed radiative power. A detection is not a confirmed fire or a perimeter.',
    perimeters: 'Fire perimeters as NIFC publishes them (generalised to about 200 m); operational mapping, not a legal boundary.',
    alerts: 'Alert polygons as NWS publishes them, tinted by severity (Extreme, Severe, Moderate, Minor); alerts that name zones only are listed, never placed.',
    eonet: 'Reported positions joined in order: not a forecast or an inferred path.',
    tides: 'Column height shows the observed water level above the station datum (MLLW, metres); preliminary readings are not yet verified by NOAA. Observations, never predictions or currents.',
    shakemap: 'Contours show modelled shaking intensity (MMI) from USGS ShakeMap: a versioned estimate, never a measurement at every place.'
  };
  const legendFor = layer => LEGEND[layer] || '';
  const RIPPLE_LABEL = 'Ripple is illustrative: not a recording of shaking';
  const POLICY_LINE = 'Environmental layers are not available right now';
  const encodings = Object.freeze({ quakeRadiusM, depthColour, quakeFromFacts, frpColour, cellRadiusPx, cellColour, severityTint, stationColumnM, stationColour, mmiColour, eonetColour, lod, pickId, isEnvPick, providerOf, kindOf, factsFor, shakemapLabel, legendFor, RIPPLE_LABEL, POLICY_LINE });
  /* ENCODINGS_END */

  /* the feed providers' fixed terms (workers/mccluster/src/world-environment.js FEED_SOURCE_TERMS and vendor evidence.mjs) */
  const FEED_TERMS = Object.freeze({
    usgs: Object.freeze({ id: 'usgs', label: 'USGS', url: 'https://earthquake.usgs.gov/', attribution: 'U.S. Geological Survey, Earthquake Hazards Program', license: 'Public domain (U.S. Government work)', coverage: 'Global earthquakes reported in the past day' }),
    nws: Object.freeze({ id: 'nws', label: 'NOAA NWS', url: 'https://www.weather.gov/', attribution: 'NOAA National Weather Service', license: 'Public domain (U.S. Government work)', coverage: 'United States active alerts' }),
    eonet: Object.freeze({ id: 'eonet', label: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/', attribution: 'NASA Earth Observatory Natural Event Tracker (EONET)', license: 'NASA open data; each event names the sources EONET drew it from', coverage: 'Global open event reports in the last 30 days; not exhaustive' }),
    nhc: Object.freeze({ id: 'nhc', label: 'NOAA NHC', url: 'https://www.nhc.noaa.gov/', attribution: 'NOAA National Hurricane Center', license: 'Public domain (U.S. Government work)', coverage: 'Atlantic, eastern and central Pacific; not global cyclone coverage' })
  });

  /* ---------- runtime ---------- */
  const DOT_HEIGHT = 2000, BUILD_MAX_MS = 30000, FADE_MS = 400, FADE_MAX_MS = 1000, RIPPLE_MS = 4500, RIPPLE_MAX_MS = 6000, REPLAY_FADE_MS = 300, FOCUS_SAFETY_MS = 600, PENDING_FOCUS_MS = 30000;
  let viewer = null, Cesium = null, tell = () => {}, governor = null, director = null, client = null, doc = null, mounted = false;
  let on = false, eventsOn = false, lodState = 'far', replayMode = null, pendingFocus = null, pendingFocusTimer = null, viewTarget = '3d';
  const layersOn = { fires: true, perimeters: true, alerts: true, eonet: true, tides: true };
  const data = { events: [], fires: null, perimeters: null, alerts: null, eonet: null, tides: null };
  const states = { events: null, fires: null, perimeters: null, alerts: null, eonet: null, tides: null, shakemap: null };
  const results = { fires: null, perimeters: null, alerts: null, eonet: null, tides: null };
  const prims = { events: {}, fires: {}, perimeters: {}, alerts: {}, eonet: {}, tides: {}, shakemap: {} };
  const counts = { events: 0, quakes: 0, quakeDiscs: 0, firesNear: 0, cells: 0, perimeters: 0, perimeterRings: 0, alerts: { drawn: 0, zone_only: 0, rejected: 0 }, eonetPoints: 0, eonetTracks: 0, eonetPolygons: 0, tides: 0, tideLabels: 0, shakemapLines: 0 };
  const picks = new Map();
  const building = new Set();
  const deferred = [];
  let selected = null, fade = null, ripple = null, lastRipple = null, shakemap = null, selectedLabel = null, eventsSignature = '', legendLines = [], buildListener = null;
  const pendingMessages = [];

  const now = () => Date.now();
  const motionAllowed = () => !(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const css = (hex, alpha) => Cesium.Color.fromCssColorString(hex).withAlpha(alpha === undefined ? 1 : alpha);
  const degrees = (lon, lat, h) => Cesium.Cartesian3.fromDegrees(lon, lat, h || 0);
  const requestRender = reason => { if (governor) governor.requestRender(reason); else if (viewer && viewer.scene.requestRender) viewer.scene.requestRender(); };
  const hold = (owner, maxMs) => { if (governor) governor.hold(owner, maxMs); };
  const release = owner => { if (governor) governor.release(owner); };
  const groundOk = () => !!(Cesium.GroundPrimitive && typeof Cesium.GroundPrimitive.isSupported === 'function' && Cesium.GroundPrimitive.isSupported(viewer.scene));
  const linesOk = () => !!(Cesium.GroundPolylinePrimitive && typeof Cesium.GroundPolylinePrimitive.isSupported === 'function' && Cesium.GroundPolylinePrimitive.isSupported(viewer.scene));
  const visible = layer => (layer === 'events' || layer === 'shakemap' ? eventsOn : on && layersOn[layer] === true);

  /* ---------- primitives: add, remove, and hold the loop continuous while Cesium builds asynchronously ---------- */
  function addPrim(p) {
    viewer.scene.primitives.add(p);
    if (p && 'ready' in p && !p.ready) { building.add(p); watchBuild(); }
    return p;
  }
  function removePrim(p) {
    if (!p) return null;
    building.delete(p);
    try { viewer.scene.primitives.remove(p); } catch (e) {}
    return null;
  }
  function watchBuild() {
    hold('env-build', BUILD_MAX_MS);
    if (buildListener) return;
    buildListener = () => {
      for (const p of [...building]) if (p.isDestroyed() || p.ready) building.delete(p);
      if (deferred.length) for (const fn of deferred.splice(0)) { try { fn(); } catch (e) {} }
      if (!building.size) { viewer.scene.postRender.removeEventListener(buildListener); buildListener = null; release('env-build'); requestRender('env-built'); }
    };
    viewer.scene.postRender.addEventListener(buildListener);
  }
  /* a ring exactly as the provider closed it: at least four positions, the last equal to the first; else skipped and counted */
  function ringPositions(ring) {
    if (!Array.isArray(ring) || ring.length < 4) return null;
    const first = ring[0], last = ring[ring.length - 1];
    if (!Array.isArray(first) || !Array.isArray(last) || first[0] !== last[0] || first[1] !== last[1]) return null;
    const flat = [];
    let prev = null;
    for (const p of ring) {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
      flat.push(p[0], p[1]); prev = p;
    }
    if (flat.length < 8) return null;
    return Cesium.Cartesian3.fromDegreesArray(flat);
  }
  function polygonInstance(polygon, colour, alpha, pick) {
    const outer = ringPositions(polygon[0]);
    if (!outer) return null;
    const holes = [];
    for (const h of polygon.slice(1)) { const pos = ringPositions(h); if (pos) holes.push(new Cesium.PolygonHierarchy(pos)); }
    return new Cesium.GeometryInstance({ geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(outer, holes), vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }), id: pick, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(css(colour, alpha)) } });
  }
  function lineInstance(positions, width, colour, alpha, pick) {
    return new Cesium.GeometryInstance({ geometry: new Cesium.GroundPolylineGeometry({ positions, width }), id: pick, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(css(colour, alpha)) } });
  }
  const groundFill = instances => (instances.length && groundOk() ? addPrim(new Cesium.GroundPrimitive({ geometryInstances: instances, appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }), allowPicking: true })) : null);
  const groundLines = instances => (instances.length && linesOk() ? addPrim(new Cesium.GroundPolylinePrimitive({ geometryInstances: instances, appearance: new Cesium.PolylineColorAppearance({ translucent: true }), allowPicking: true })) : null);
  /* one id can live in two layers (a feed alert's dot in 'events' and its polygon in 'alerts'; an EONET event's dot and its
     track), so entries are keyed by layer and id; a lookup by id alone prefers the events layer (the feed's ids) */
  const key = (layer, id) => layer + '\n' + id;
  const LOOKUP_ORDER = ['events', 'fires', 'cells', 'perimeters', 'alerts', 'eonet', 'tides'];
  const getEntry = (layer, id) => picks.get(key(layer, id)) || null;
  function findEntry(id, preferLayer) {
    if (typeof id !== 'string' || !id) return null;
    if (preferLayer) { const e = getEntry(preferLayer, id); if (e) return e; }
    for (const layer of LOOKUP_ORDER) { const e = picks.get(key(layer, id)); if (e) return e; }
    return null;
  }
  function entry(layer, id, kind, item, extra) { const e = Object.assign({ id, layer, kind, item, pick: pickId({ layer, id, kind }), fills: [], points: [], polylines: [], base: null }, extra || {}); picks.set(key(layer, id), e); return e; }
  function dropLayerPicks(layer) { const prefix = layer + '\n'; for (const k of [...picks.keys()]) if (k.startsWith(prefix)) picks.delete(k); }

  /* ---------- the events layer (the pins items): quake discs and dots, dots for the other feed events ---------- */
  function rebuildEvents() {
    const P = prims.events;
    P.discs = removePrim(P.discs); P.dots = removePrim(P.dots);
    dropLayerPicks('events');
    const discs = [], dots = new Cesium.PointPrimitiveCollection();
    counts.events = data.events.length; counts.quakes = 0; counts.quakeDiscs = 0;
    for (const item of data.events) {
      const kind = kindOf(item);
      const e = entry('events', item.id, kind, item);
      let colour = kind === 'alert' ? '#ffb347' : kind === 'cyclone' ? '#7cc7ff' : kind === 'natural' ? eonetColour(item.category) : '#cfd8dc', size = 7;
      if (kind === 'quake') {
        counts.quakes += 1;
        const q = quakeFromFacts(item.facts), r = quakeRadiusM(q.mag);
        colour = q.mag === null ? GREY : depthColour(q.depth_km); size = 6; e.radius = r; e.mag = q.mag;
        if (r !== null && groundOk()) {
          discs.push(new Cesium.GeometryInstance({ geometry: new Cesium.EllipseGeometry({ center: degrees(item.lon, item.lat), semiMajorAxis: r, semiMinorAxis: r, granularity: Math.PI / 32, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }), id: e.pick, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(css(colour, 0.35)), show: new Cesium.ShowGeometryInstanceAttribute(true) } }));
          e.fills.push({ primitive: () => prims.events.discs, colour: css(colour, 0.35) });
          counts.quakeDiscs += 1;
        }
      }
      const dot = dots.add({ position: degrees(item.lon, item.lat, DOT_HEIGHT), pixelSize: size, color: css(colour, item.stale ? 0.6 : 1), outlineColor: css('#10251e'), outlineWidth: 1, id: e.pick });
      e.points.push({ point: dot, colour: css(colour, item.stale ? 0.6 : 1), size });
    }
    P.discs = groundFill(discs);
    P.dots = addPrim(dots);
    if (selected && selected.layer === 'events') selected = getEntry('events', selected.id);
    if (replayMode) applyReplay(director && director.scene() ? findEntry(director.scene().id, 'events') : null);
  }
  function eventsState() {
    const items = data.events;
    const by = { usgs: 0, nws: 0, eonet: 0, nhc: 0 };
    for (const i of items) if (Object.prototype.hasOwnProperty.call(by, providerOf(i.id))) by[providerOf(i.id)] += 1;
    const fetched = items.map(i => isoOrNull(i.fetched_at)).filter(Boolean).sort().pop() || null;
    return { status: !items.length ? 'unavailable' : items.some(i => !i.stale) ? 'available' : 'stale', reason: null, http: null, schema: 'world-environment/v1', generated_at: null, fetched_at: fetched, last_success_at: fetched, coverage: '', attribution: '', license: '', url: '', count: items.length, total: items.length, truncated: false, sources: [], digest: { by_provider: by } };
  }
  function setEvents(items, options) {
    const o = options || {};
    eventsOn = o.on === true;
    const list = Array.isArray(items) ? items : [];
    const signature = list.map(i => `${i.id}|${i.lat}|${i.lon}|${i.stale ? 1 : 0}|${i.category || ''}|${JSON.stringify(i.facts || [])}`).join('\n');
    const changed = signature !== eventsSignature;
    data.events = list; eventsSignature = signature;
    if (mounted && changed) {
      rebuildEvents();
      states.events = eventsState();
      tellLayerState('events');
      if (director) director.setQueue(data.events, { queue: replayMode || 'significant' });
    } else if (mounted && director && !changed && director.state().total === 0 && data.events.length) director.setQueue(data.events, { queue: replayMode || 'significant' });
    if (mounted && typeof o.selected === 'string' && o.selected && o.selected !== (selected && selected.id) && findEntry(o.selected, 'events')) select(o.selected, 'panel', { layer: 'events' });
    if (mounted && selected && selected.layer === 'events' && !getEntry('events', selected.id)) clearSelection();
    if (mounted && pendingFocus && picks.has(pendingFocus)) { const id = pendingFocus; pendingFocus = null; focus(id); }
    if (mounted) { applyVisibility(); updateLegend(); requestRender('events'); }
  }

  /* ---------- fires: footprints near, summary cells far ---------- */
  function rebuildFires() {
    const P = prims.fires, body = data.fires;
    P.near = removePrim(P.near); P.far = removePrim(P.far);
    dropLayerPicks('fires'); dropLayerPicks('cells');
    counts.firesNear = 0; counts.cells = 0;
    if (!body) return;
    const footprint = typeof body.footprint_m === 'number' && body.footprint_m > 0 ? body.footprint_m : 375;
    const instances = [];
    for (const row of Array.isArray(body.detections) ? body.detections.slice(0, 10000) : []) {
      if (!Array.isArray(row) || typeof row[0] !== 'number' || typeof row[1] !== 'number' || !Number.isFinite(row[0]) || !Number.isFinite(row[1])) continue;
      const id = `fire:${row[5]}:${row[4]}:${row[0]}:${row[1]}`;
      if (getEntry('fires', id)) continue;
      const e = entry('fires', id, 'fire_detection', { id, row });
      const colour = css(frpColour(row[2]), 0.8);
      if (groundOk()) {
        instances.push(new Cesium.GeometryInstance({ geometry: new Cesium.EllipseGeometry({ center: degrees(row[0], row[1]), semiMajorAxis: footprint / 2, semiMinorAxis: footprint / 2, granularity: Math.PI / 8, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }), id: e.pick, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(colour) } }));
        e.fills.push({ primitive: () => prims.fires.near, colour });
        counts.firesNear += 1;
      }
    }
    P.near = groundFill(instances);
    const far = new Cesium.PointPrimitiveCollection();
    for (const c of body.summary && Array.isArray(body.summary.cells) ? body.summary.cells : []) {
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
      const id = `cell:${c[0]}:${c[1]}`;
      if (getEntry('cells', id)) continue;
      const cell = { west: c[0], south: c[1], detections: c[2], frp_sum_mw: c[3], frp_max_mw: c[4], latest_acquired_at: c[5] };
      const e = entry('cells', id, 'fire_cell', { id, cell: c });
      const r = cellRadiusPx(cell.frp_sum_mw), colour = css(cellColour(cell), 0.85);
      const point = far.add({ position: degrees(c[0] + 0.5, c[1] + 0.5, DOT_HEIGHT), pixelSize: 2 * r, color: colour, outlineColor: css('#10251e', 0.8), outlineWidth: 1, id: e.pick });
      e.points.push({ point, colour, size: 2 * r });
      counts.cells += 1;
    }
    P.far = addPrim(far);
  }
  /* ---------- perimeters: fill with holes, outline per exterior ring ---------- */
  function rebuildPerimeters() {
    const P = prims.perimeters, body = data.perimeters;
    P.fill = removePrim(P.fill); P.outline = removePrim(P.outline);
    dropLayerPicks('perimeters'); counts.perimeters = 0; counts.perimeterRings = 0;
    if (!body) return;
    const fills = [], lines = [];
    for (const row of Array.isArray(body.perimeters) ? body.perimeters : []) {
      if (!row || typeof row !== 'object') continue;
      const id = `wfigs:${String(row.id)}`;
      if (getEntry('perimeters', id)) continue;
      const e = entry('perimeters', id, 'perimeter', row);
      let drawn = 0, skipped = 0;
      for (const polygon of Array.isArray(row.polygons) ? row.polygons : []) {
        if (!Array.isArray(polygon) || !polygon.length) continue;
        const inst = polygonInstance(polygon, '#ff7a1a', 0.28, e.pick);
        if (!inst) { skipped += 1; continue; }
        fills.push(inst); drawn += 1;
        const ring = ringPositions(polygon[0]);
        if (ring && linesOk()) { lines.push(lineInstance(ring, 2, '#ffb27a', 0.9, e.pick)); counts.perimeterRings += 1; }
      }
      e.item = Object.assign({}, row, { rings_skipped: skipped });
      if (drawn) { e.fills.push({ primitive: () => prims.perimeters.fill, colour: css('#ff7a1a', 0.28) }); counts.perimeters += 1; }
    }
    P.fill = groundFill(fills); P.outline = groundLines(lines);
  }
  /* ---------- alerts: the alert's own polygon tinted by severity; zone-only and rejected never drawn ---------- */
  function rebuildAlerts() {
    const P = prims.alerts, body = data.alerts;
    P.fill = removePrim(P.fill); P.outline = removePrim(P.outline);
    dropLayerPicks('alerts'); counts.alerts = { drawn: 0, zone_only: 0, rejected: 0 };
    if (!body) return;
    const fills = [], lines = [];
    for (const a of Array.isArray(body.alerts) ? body.alerts : []) {
      if (!a || typeof a !== 'object' || typeof a.id !== 'string') continue;
      if (a.geometry === 'zone_only') { counts.alerts.zone_only += 1; continue; }
      if (a.geometry === 'rejected') { counts.alerts.rejected += 1; continue; }
      if (a.geometry !== 'polygon' || !Array.isArray(a.polygons) || getEntry('alerts', a.id)) continue;
      const tint = severityTint(a.severity), e = entry('alerts', a.id, 'alert', a);
      let drawn = 0;
      for (const polygon of a.polygons) {
        if (!Array.isArray(polygon) || !polygon.length) continue;
        const inst = polygonInstance(polygon, tint.hex, tint.alpha, e.pick);
        if (!inst) continue;
        fills.push(inst); drawn += 1;
        const ring = ringPositions(polygon[0]);
        if (ring && linesOk()) lines.push(lineInstance(ring, 1.5, tint.hex, 0.9, e.pick));
      }
      if (drawn) { e.fills.push({ primitive: () => prims.alerts.fill, colour: css(tint.hex, tint.alpha) }); counts.alerts.drawn += 1; }
    }
    P.fill = groundFill(fills); P.outline = groundLines(lines);
  }
  /* ---------- natural events: every reported point, the reported positions joined in order, reported polygons ---------- */
  function rebuildEonet() {
    const P = prims.eonet, body = data.eonet;
    P.points = removePrim(P.points); P.tracks = removePrim(P.tracks); P.polygons = removePrim(P.polygons);
    dropLayerPicks('eonet'); counts.eonetPoints = 0; counts.eonetTracks = 0; counts.eonetPolygons = 0;
    if (!body) return;
    const points = new Cesium.PointPrimitiveCollection(), tracks = [], polygons = [];
    for (const ev of Array.isArray(body.events) ? body.events : []) {
      if (!ev || typeof ev.id !== 'string' || !Array.isArray(ev.track) || getEntry('eonet', ev.id)) continue;
      const colour = eonetColour(ev.kind), e = entry('eonet', ev.id, 'natural', { event: ev, point: null });
      const track = [];
      let lastPoint = null;
      ev.track.forEach((t, index) => {
        if (!t || typeof t !== 'object') return;
        if (t.type === 'Point' && Array.isArray(t.coordinates) && typeof t.coordinates[0] === 'number' && typeof t.coordinates[1] === 'number') {
          const latest = index === ev.track.length - 1;
          const c = css(colour, latest ? 0.9 : 0.55);
          const point = points.add({ position: degrees(t.coordinates[0], t.coordinates[1], DOT_HEIGHT), pixelSize: latest ? 11 : 7, color: c, outlineColor: css('#10251e'), outlineWidth: 1, id: pickId({ layer: 'eonet', id: ev.id, kind: 'natural', part: 'point', index }) });
          e.points.push({ point, colour: c, size: latest ? 11 : 7 });
          counts.eonetPoints += 1;
          const prev = track[track.length - 1];
          if (!prev || prev[0] !== t.coordinates[0] || prev[1] !== t.coordinates[1]) track.push([t.coordinates[0], t.coordinates[1]]);
          lastPoint = t;
        } else if (t.type === 'Polygon' && Array.isArray(t.polygons)) {
          for (const polygon of t.polygons) {
            const inst = Array.isArray(polygon) && polygon.length ? polygonInstance(polygon, colour, 0.22, pickId({ layer: 'eonet', id: ev.id, kind: 'natural', part: 'polygon', index })) : null;
            if (inst) { polygons.push(inst); counts.eonetPolygons += 1; }
          }
          lastPoint = lastPoint || t;
          if (!e.fills.length) e.fills.push({ primitive: () => prims.eonet.polygons, colour: css(colour, 0.22) });
        }
      });
      e.item.point = ev.track[ev.track.length - 1] || null;
      if (track.length >= 2 && linesOk()) { tracks.push(lineInstance(Cesium.Cartesian3.fromDegreesArray(track.flat()), 1.5, colour, 0.75, pickId({ layer: 'eonet', id: ev.id, kind: 'natural', part: 'track', index: 0 }))); counts.eonetTracks += 1; }
    }
    P.points = addPrim(points); P.tracks = groundLines(tracks); P.polygons = groundFill(polygons);
  }
  /* ---------- coastal water levels: columns by observed level above MLLW, labelled ---------- */
  function rebuildTides() {
    const P = prims.tides, body = data.tides;
    P.columns = removePrim(P.columns); P.labels = removePrim(P.labels);
    dropLayerPicks('tides'); counts.tides = 0; counts.tideLabels = 0;
    if (!body) return;
    const columns = new Cesium.PolylineCollection(), labels = new Cesium.LabelCollection();
    for (const r of body.latest && Array.isArray(body.latest.readings) ? body.latest.readings : []) {
      if (!r || r.status !== 'available' || typeof r.value_m !== 'number' || !Number.isFinite(r.value_m) || typeof r.lon !== 'number' || typeof r.lat !== 'number') continue;
      const id = `coops:${r.station}`;
      if (getEntry('tides', id)) continue;
      const e = entry('tides', id, 'station', r);
      const h = stationColumnM(r.value_m), colour = css(stationColour(r.q, r.value_m), 1);
      const polyline = columns.add({ positions: [degrees(r.lon, r.lat, 0), degrees(r.lon, r.lat, h)], width: 6, material: Cesium.Material.fromType('Color', { color: colour }), id: e.pick });
      e.polylines.push({ polyline, colour });
      labels.add({ position: degrees(r.lon, r.lat, h), text: `${r.value_m} m MLLW${r.q === 'p' ? ' · preliminary' : ''}${r.value_m < 0 ? ' · below datum' : ''}`, font: '600 12px system-ui,sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -8), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8e6), id: e.pick });
      counts.tides += 1; counts.tideLabels += 1;
    }
    P.columns = addPrim(columns); P.labels = addPrim(labels);
  }
  /* ---------- ShakeMap contours for the selected earthquake, drawn exactly as received ---------- */
  function drawShakemap(quakeEntry, body) {
    clearShakemapLines();
    counts.shakemapLines = 0;
    const lines = [];
    for (const c of Array.isArray(body.contours) ? body.contours : []) {
      if (!c || !Array.isArray(c.lines)) continue;
      for (const line of c.lines) {
        const flat = [];
        let prev = null;
        for (const p of Array.isArray(line) ? line : []) { if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') { flat.length = 0; break; } if (prev && prev[0] === p[0] && prev[1] === p[1]) continue; flat.push(p[0], p[1]); prev = p; }
        if (flat.length < 4) continue;
        lines.push(lineInstance(Cesium.Cartesian3.fromDegreesArray(flat), 2.5, mmiColour(c), 0.95, pickId({ layer: 'shakemap', id: `shakemap:${body.event_id}:${c.mmi}`, kind: 'shakemap' })));
        counts.shakemapLines += 1;
      }
    }
    prims.shakemap.lines = groundLines(lines);
    shakemap = { quakeId: quakeEntry.id, body, contours: Array.isArray(body.contours) ? body.contours : [] };
    if (counts.shakemapLines) dimDisc(quakeEntry, 0.18);
  }
  function clearShakemapLines() { prims.shakemap.lines = removePrim(prims.shakemap.lines); counts.shakemapLines = 0; }
  function clearShakemap() { if (shakemap) { const q = findEntry(shakemap.quakeId, 'events'); if (q) dimDisc(q, null); } clearShakemapLines(); shakemap = null; }
  function dimDisc(e, alpha) {
    for (const f of e.fills) {
      const target = alpha === null ? f.colour : Cesium.Color.fromAlpha(f.colour, alpha);
      writeColour(Object.assign({}, f, { pick: e.pick }), target);
    }
  }
  function shakemapFor(e) {
    if (!client || !on) return;
    const id = e.id;
    client.shakemap(id).then(result => {
      if (!selected || selected.id !== id) return;
      states.shakemap = Object.assign(layerStateOf('shakemap', result), { digest: result.ok ? { event_id: result.body.event_id, available: result.body.available === true, reason: result.body.reason || null, version: result.body.version === undefined ? null : result.body.version, max_mmi: result.body.max_mmi === undefined ? null : result.body.max_mmi } : { event_id: id.replace(/^usgs:/, ''), available: false, reason: result.reason, version: null, max_mmi: null } });
      tellLayerState('shakemap');
      if (result.ok && result.body.available === true) { drawShakemap(e, result.body); tellSelected(e, selected.via, { shakemap: result.body }); }
      else { clearShakemap(); shakemap = { quakeId: id, body: result.ok ? result.body : null, unavailable: result.ok ? result.body.reason : result.reason, contours: [] }; tellSelected(e, selected.via, { shakemapUnavailable: result.ok ? result.body.reason : result.reason }); }
      updateLegend(); requestRender('shakemap');
    }).catch(() => {});
  }

  /* ---------- selection: a soft fade through instance attributes, never a rebuild, never blinking ---------- */
  function writeColour(fill, colour) {
    const prim = fill.primitive();
    if (!prim || prim.isDestroyed()) return;
    const apply = () => { try { const attrs = prim.getGeometryInstanceAttributes(fill.pick || fill.ownerPick); if (attrs) attrs.color = Cesium.ColorGeometryInstanceAttribute.toValue(colour, attrs.color); } catch (e) {} };
    if (prim.ready) apply(); else { deferred.push(apply); watchBuild(); }
  }
  const mix = (a, b, t) => new Cesium.Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t, a.alpha + (b.alpha - a.alpha) * t);
  const highlightOf = base => { const m = mix(base, Cesium.Color.WHITE, 0.5); m.alpha = Math.min(1, base.alpha + 0.25); return m; };
  function targetsOf(e, toHighlight) {
    const list = [];
    for (const f of e.fills) list.push({ set: c => writeColour(Object.assign({}, f, { pick: e.pick }), c), from: toHighlight ? f.colour : highlightOf(f.colour), to: toHighlight ? highlightOf(f.colour) : f.colour });
    for (const p of e.points) list.push({ set: c => { p.point.color = c; p.point.pixelSize = toHighlight ? p.size + 3 : p.size; }, from: toHighlight ? p.colour : highlightOf(p.colour), to: toHighlight ? highlightOf(p.colour) : p.colour });
    for (const l of e.polylines) list.push({ set: c => { l.polyline.material.uniforms.color = c; }, from: toHighlight ? l.colour : highlightOf(l.colour), to: toHighlight ? highlightOf(l.colour) : l.colour });
    return list;
  }
  function startFade(previous, next, durationMs, owner, maxMs) {
    const targets = [...(previous ? targetsOf(previous, false) : []), ...(next ? targetsOf(next, true) : [])];
    stopFade();
    if (!targets.length) return;
    if (!motionAllowed() || !viewer.scene.preRender) { for (const t of targets) t.set(t.to); return; }
    const t0 = now(), duration = durationMs || FADE_MS, own = owner || 'env-select';
    hold(own, maxMs || FADE_MAX_MS);
    const step = () => {
      const k = Math.min(1, (now() - t0) / duration), eased = k * k * (3 - 2 * k);
      for (const t of targets) t.set(k >= 1 ? t.to : mix(t.from, t.to, eased));
      if (k >= 1) { viewer.scene.preRender.removeEventListener(step); if (fade && fade.step === step) fade = null; release(own); requestRender('fade-end'); }
    };
    fade = { step, owner: own, targets };
    viewer.scene.preRender.addEventListener(step);
    requestRender('fade');
  }
  function stopFade() { if (!fade) return; viewer.scene.preRender.removeEventListener(fade.step); for (const t of fade.targets) t.set(t.to); release(fade.owner); fade = null; }
  /* the one illustrative animation: alpha only, bounded, labelled */
  function startRipple(e) {
    clearRipple();
    if (!motionAllowed() || !groundOk()) return;
    const lonLat = positionOf(e);
    if (!lonLat) return;
    const r = Math.max(15000, 1.6 * (e.radius || 0));
    const colour = css('#ffffff', 0.32);
    let prim;
    try {
      prim = new Cesium.GroundPrimitive({ geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.EllipseGeometry({ center: degrees(lonLat.lon, lonLat.lat), semiMajorAxis: r, semiMinorAxis: r, granularity: Math.PI / 32 }) }), appearance: new Cesium.MaterialAppearance({ material: Cesium.Material.fromType('Color', { color: colour }), flat: true, translucent: true }), allowPicking: false, asynchronous: false });
    } catch (err) { return; }
    addPrim(prim);
    const t0 = now();
    const step = () => {
      const t = now() - t0;
      if (t >= RIPPLE_MS) { clearRipple(); updateLegend(); return; }
      const uniforms = prim.appearance && prim.appearance.material && prim.appearance.material.uniforms;
      if (uniforms && uniforms.color) uniforms.color.alpha = 0.32 * (1 - (t % 1500) / 1500);
    };
    /* the frames write the alpha; the timer ends the ripple on time even when frames are sparse (software GL) */
    ripple = { prim, step, startedAt: t0, timer: root.setTimeout(() => { if (ripple && ripple.prim === prim) { clearRipple(); updateLegend(); } }, RIPPLE_MS) };
    hold('env-ripple', RIPPLE_MAX_MS);
    viewer.scene.preRender.addEventListener(step);
    requestRender('ripple');
  }
  function clearRipple() { if (!ripple) return; viewer.scene.preRender.removeEventListener(ripple.step); root.clearTimeout(ripple.timer); removePrim(ripple.prim); lastRipple = { startedAt: ripple.startedAt, endedAt: now() }; ripple = null; release('env-ripple'); requestRender('ripple-end'); }
  function positionOf(e) {
    const f = factsFor(e.kind, e.item);
    return f.lat === null || f.lon === null ? null : { lon: f.lon, lat: f.lat };
  }
  function updateSelectedLabel() {
    if (selectedLabel) { prims.events.label = removePrim(prims.events.label); selectedLabel = null; }
    if (!selected) return;
    const pos = positionOf(selected);
    if (!pos) return;
    const labels = new Cesium.LabelCollection();
    labels.add({ position: degrees(pos.lon, pos.lat, DOT_HEIGHT), text: factsFor(selected.kind, selected.item).title.slice(0, 80), font: '600 12px system-ui,sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -16), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, id: selected.pick });
    selectedLabel = labels; prims.events.label = addPrim(labels);
  }
  function clearSelection() {
    const previous = selected; selected = null;
    clearShakemap(); clearRipple(); updateSelectedLabel();
    if (previous) startFade(previous, null);
    requestRender('deselect');
  }
  /* select by id (a feed id resolves to the events layer unless options.layer names another); pick() selects the exact entry */
  function select(id, via, options) {
    const e = typeof id === 'string' ? findEntry(id, options && options.layer) : null;
    if (!e) { if (id === null || id === '') clearSelection(); return false; }
    return selectEntry(e, via, options);
  }
  function selectEntry(e, via, options) {
    const previous = selected && selected !== e ? selected : null;
    if (selected === e) { if (via !== 'panel') tellSelected(e, via, options); return true; }
    selected = e; e.via = via || 'pick';
    clearShakemap(); clearRipple();
    startFade(previous, e);
    updateSelectedLabel();
    if (e.kind === 'quake') { if (motionAllowed()) startRipple(e); shakemapFor(e); }
    if (replayMode && e.layer === 'events') applyReplay(e);
    if (via !== 'panel') tellSelected(e, via, options);
    updateLegend(); requestRender('select');
    return true;
  }
  function sourceOf(e) {
    if (e.layer === 'events') {
      const terms = FEED_TERMS[providerOf(e.id)] || { id: providerOf(e.id), label: '', url: '', attribution: '', license: '', coverage: '' };
      const own = e.item.source && typeof e.item.source === 'object' ? e.item.source : {};
      return { source: { id: terms.id, label: own.label || terms.label, url: own.url || terms.url, attribution: terms.attribution, license: terms.license }, coverage: terms.coverage, status: e.item.stale ? 'stale' : 'available', reason: null, fetched_at: isoOrNull(e.item.fetched_at) };
    }
    const layer = e.layer === 'cells' ? 'fires' : e.layer;
    const st = states[layer];
    let src = st && Array.isArray(st.sources) ? st.sources[0] : null;
    if (layer === 'fires' && st && Array.isArray(st.sources) && e.item.row) src = st.sources.find(s => s && typeof s.label === 'string' && s.label.includes(String(e.item.row[5]))) || src;
    const s = src || {};
    return { source: { id: s.id || layer, label: s.label || '', url: s.url || '', attribution: s.attribution || '', license: s.license || '' }, coverage: s.coverage || (st ? st.coverage : '') || '', status: st ? st.status : 'unavailable', reason: st ? st.reason : null, fetched_at: s.fetched_at || (st ? st.fetched_at : null) || null };
  }
  function tellSelected(e, via, options) {
    const o = options || {};
    const sm = o.shakemap || (shakemap && shakemap.quakeId === e.id && shakemap.body && shakemap.body.available === true ? shakemap.body : null);
    const facts = sm ? factsFor('shakemap', { quake: e.item, shakemap: sm, contour: o.contour || null }) : factsFor(e.kind, e.item);
    if (sm) { const own = factsFor(e.kind, e.item); facts.observed_at = own.observed_at; facts.observed_label = own.observed_label; facts.observed_date_only = own.observed_date_only; }
    if (sm && Array.isArray(sm.contours) && !sm.contours.length) facts.facts.push({ label: 'ShakeMap contours', value: 'ShakeMap exists but has no contour (deep event)' });
    if (o.shakemapUnavailable) facts.facts.push({ label: 'ShakeMap', value: `no contours shown: ${o.shakemapUnavailable}` });
    const src = sourceOf(e);
    tell({ type: 'hu:environment-selected', id: e.id, layer: e.layer, kind: e.kind, title: facts.title, facts: facts.facts, source: src.source, observed_at: facts.observed_at, observed_label: facts.observed_label, observed_date_only: facts.observed_date_only, fetched_at: src.fetched_at, coverage: src.coverage, status: src.status, reason: src.reason, lat: facts.lat, lon: facts.lon, via: via || 'pick', illustrative: ripple ? RIPPLE_LABEL : null, modelled: !!sm });
  }
  function pick(picked) {
    if (!mounted || !isEnvPick(picked)) return false;
    const p = picked.id;
    const e = p.layer === 'shakemap' ? (shakemap ? findEntry(shakemap.quakeId, 'events') : null) : getEntry(p.layer, p.id);
    if (!e) return false;
    const contour = p.layer === 'shakemap' && shakemap ? shakemap.contours.find(c => `shakemap:${shakemap.body.event_id}:${c.mmi}` === p.id) || null : null;
    if (p.layer === 'shakemap' && selected === e) { tellSelected(e, 'pick', { contour }); return true; }
    return selectEntry(e, 'pick', contour ? { contour } : undefined);
  }

  /* ---------- the quake replay: discs later than the current scene hidden, the current one fading in ---------- */
  function applyReplay(current) {
    const discs = prims.events.discs;
    if (!discs) return;
    const run = () => {
      if (!prims.events.discs || prims.events.discs.isDestroyed()) return;
      const t = replayMode && current && current.item ? Date.parse(current.item.observed_at) : NaN;
      for (const e of picks.values()) {
        if (e.layer !== 'events' || e.kind !== 'quake' || !e.fills.length) continue;
        const attrs = prims.events.discs.getGeometryInstanceAttributes(e.pick);
        if (!attrs) continue;
        const show = !replayMode || !Number.isFinite(t) || (Date.parse(e.item.observed_at) || 0) <= t;
        attrs.show = Cesium.ShowGeometryInstanceAttribute.toValue(show, attrs.show);
      }
      if (replayMode && current && current.fills.length && motionAllowed()) {
        const target = current.fills[0];
        startFade(null, Object.assign({}, current, { fills: [Object.assign({}, target, { colour: target.colour })], points: [], polylines: [] }), REPLAY_FADE_MS, 'env-replay', FADE_MAX_MS);
      }
      requestRender('replay');
    };
    if (discs.ready) run(); else { deferred.push(run); watchBuild(); }
  }

  /* ---------- visibility, level of detail, legend ---------- */
  function applyVisibility() {
    const P = prims;
    const set = (p, show) => { if (p && !p.isDestroyed()) p.show = show; };
    set(P.events.discs, visible('events')); set(P.events.dots, visible('events')); set(P.events.label, visible('events') && !!selected);
    set(P.fires.near, visible('fires') && lodState === 'near'); set(P.fires.far, visible('fires') && lodState === 'far');
    set(P.perimeters.fill, visible('perimeters')); set(P.perimeters.outline, visible('perimeters'));
    set(P.alerts.fill, visible('alerts')); set(P.alerts.outline, visible('alerts'));
    set(P.eonet.points, visible('eonet')); set(P.eonet.tracks, visible('eonet')); set(P.eonet.polygons, visible('eonet'));
    set(P.tides.columns, visible('tides')); set(P.tides.labels, visible('tides'));
    set(P.shakemap.lines, visible('shakemap'));
  }
  function onCameraChanged() {
    if (!viewer) return;
    const next = lod(viewer.camera.positionCartographic.height);
    if (next !== lodState) { lodState = next; applyVisibility(); requestRender('lod'); }
  }
  function updateLegend() {
    if (!doc) return;
    const box = doc.getElementById('envLegend'), list = doc.getElementById('envLegendList');
    legendLines = [];
    if (!box || !list) return;
    box.hidden = !on;
    if (!on) { list.replaceChildren(); return; }
    const terms = layer => { const st = states[layer]; const s = st && Array.isArray(st.sources) ? st.sources.filter(x => x && typeof x === 'object') : []; const attribution = [...new Set(s.map(x => x.attribution).filter(Boolean))].join('; '); const license = [...new Set(s.map(x => x.license).filter(Boolean))].join('; '); return [attribution, license].filter(Boolean).join(' · '); };
    const policy = client && client.isPolicy();
    if (policy) legendLines.push(POLICY_LINE);
    if (visible('events') && counts.events) { legendLines.push(`${LEGEND.events}`); if (counts.quakeDiscs) legendLines.push(`Earthquakes: ${LEGEND.quakes} ${FEED_TERMS.usgs.attribution} · ${FEED_TERMS.usgs.license}`); }
    for (const [layer, count] of [['fires', counts.firesNear + counts.cells], ['perimeters', counts.perimeters], ['alerts', counts.alerts.drawn], ['eonet', counts.eonetPoints + counts.eonetPolygons], ['tides', counts.tides]]) {
      if (!visible(layer) || !count) continue;
      legendLines.push(`${LEGEND[layer]} ${terms(layer)}`.trim());
    }
    if (counts.shakemapLines && visible('shakemap')) legendLines.push(`${LEGEND.shakemap} ${terms('shakemap')}`.trim());
    if (ripple) legendLines.push(RIPPLE_LABEL);
    if (!motionAllowed()) legendLines.push('(animations off)');
    const items = legendLines.map(line => { const li = doc.createElement('li'); li.textContent = line; return li; });
    list.replaceChildren(...items);
  }

  /* ---------- the layer client: states and data ---------- */
  const DIGESTS = {
    fires: body => ({ cells: (body.summary && Array.isArray(body.summary.cells) ? body.summary.cells : []).slice(0, 10), cell_degrees: 1, count: body.count, total: body.total, windows: Array.isArray(body.windows) ? body.windows : [] }),
    perimeters: body => ({ top: (Array.isArray(body.perimeters) ? body.perimeters : []).slice(0, 10).map(p => Object.assign({ id: p.id, name: p.name, gis_acres: p.gis_acres, polygon_captured_at: p.polygon_captured_at, last_edited_at: p.last_edited_at, discovered_at: p.discovered_at }, firstVertex(p.polygons))) }),
    alerts: body => ({ counts: body.counts && typeof body.counts === 'object' ? body.counts : { polygon: 0, zone_only: 0, rejected: 0 } }),
    eonet: body => ({ count: body.count, kinds: (Array.isArray(body.events) ? body.events : []).reduce((m, e) => { m[e.kind] = (m[e.kind] || 0) + 1; return m; }, {}) }),
    tides: body => ({ answered: body.latest ? body.latest.answered : 0, stations: body.latest ? body.latest.stations : 0 })
  };
  function layerStateOf(layer, result) {
    const r = result || {};
    const body = r.ok ? r.body : null;
    const sources = body && Array.isArray(body.sources) ? body.sources.filter(s => s && typeof s === 'object') : [];
    const first = sources[0] || {};
    const route = root.MCC_ENVIRONMENT_LAYERS_CLIENT && root.MCC_ENVIRONMENT_LAYERS_CLIENT.ROUTES[layer];
    let count = 0, total = 0, truncated = false;
    if (body) {
      if (layer === 'tides') { count = body.latest ? Number(body.latest.answered) || 0 : 0; total = body.latest ? Number(body.latest.stations) || 0 : 0; }
      else if (layer === 'shakemap') { count = body.counts ? Number(body.counts.lines) || 0 : 0; total = count; truncated = body.truncated === true; }
      else { count = Number(body.count) || 0; total = Number(body.total) || 0; truncated = body.truncated === true; }
    }
    return {
      status: r.status || 'unavailable', reason: r.ok ? (r.status === 'available' ? null : (first.reason || null)) : (r.reason || null), http: r.http === undefined ? null : r.http,
      schema: body ? body.schema : (route ? route.schema : null), generated_at: body ? isoOrNull(body.generated_at) : null,
      fetched_at: first.fetched_at || null, last_success_at: first.last_success_at || null, coverage: first.coverage || '', attribution: first.attribution || '', license: first.license || '', url: first.url || '',
      count, total, truncated, sources, digest: body && DIGESTS[layer] ? DIGESTS[layer](body) : null
    };
  }
  function tellLayerState(layer) {
    const st = states[layer];
    if (!st) return;
    tell(Object.assign({ type: 'hu:environment-layer-state', layer }, st));
  }
  const REBUILD = { fires: rebuildFires, perimeters: rebuildPerimeters, alerts: rebuildAlerts, eonet: rebuildEonet, tides: rebuildTides };
  function onLayerState(layer, result) {
    if (layer === 'shakemap') { states.shakemap = Object.assign(layerStateOf('shakemap', result), { digest: states.shakemap ? states.shakemap.digest : null }); tellLayerState('shakemap'); return; }
    if (!LAYER_KEYS.includes(layer)) return;
    results[layer] = result;
    states[layer] = layerStateOf(layer, result);
    tellLayerState(layer);
    updateLegend();
  }
  function onLayerData(layer, body) {
    if (!LAYER_KEYS.includes(layer) || !body) return;
    data[layer] = body;
    REBUILD[layer]();
    if (pendingFocus && findEntry(pendingFocus)) { const id = pendingFocus; pendingFocus = null; focus(id); }
    if (selected && selected.layer !== 'events' && !getEntry(selected.layer, selected.id)) clearSelection();
    applyVisibility(); updateLegend(); requestRender('layer-' + layer);
  }

  /* ---------- activation ---------- */
  function activate() {
    on = true;
    if (governor) governor.enable();
    for (const layer of LAYER_KEYS) { states[layer] = null; results[layer] = null; }
    states.shakemap = null;
    applyVisibility();
    if (client) client.start({ onState: onLayerState, onData: onLayerData });
    if (director) director.setQueue(data.events, { queue: replayMode || 'significant' });
    updateLegend(); requestRender('activate');
  }
  function deactivate() {
    if (director) director.stop();
    stopFade(); clearRipple(); clearShakemap();
    if (client) client.stop();
    for (const owner of ['env-select', 'env-ripple', 'env-focus', 'env-director', 'env-replay', 'env-build']) release(owner);
    on = false;
    applyVisibility();
    if (governor) governor.disable();
    updateLegend(); requestRender('deactivate');
  }
  function setLayers(d) {
    const next = d.on === true;
    if (d.layers && typeof d.layers === 'object') for (const k of LAYER_KEYS) if (typeof d.layers[k] === 'boolean' && layersOn[k] !== d.layers[k]) { layersOn[k] = d.layers[k]; if (states[k]) { if (!d.layers[k]) tell(Object.assign({ type: 'hu:environment-layer-state', layer: k }, states[k], { status: 'off' })); else tellLayerState(k); } }
    const replay = d.replay === 'quakes-24h' ? 'quakes-24h' : null;
    const replayChanged = replay !== replayMode;
    replayMode = replay;
    if (next && !on) activate();
    else if (!next && on) deactivate();
    else if (next) { if (replayChanged && director) director.setQueue(data.events, { queue: replayMode || 'significant' }); applyVisibility(); }
    if (replayChanged) applyReplay(replayMode && director && director.scene() ? findEntry(director.scene().id, 'events') : null);
    updateLegend(); requestRender('layers');
  }
  function focus(id) {
    if (typeof id !== 'string' || !id || !mounted) return;
    const e = findEntry(id, 'events');
    if (!e) {
      pendingFocus = id;
      root.clearTimeout(pendingFocusTimer);
      pendingFocusTimer = root.setTimeout(() => { if (pendingFocus === id) pendingFocus = null; }, PENDING_FOCUS_MS);
      return;
    }
    pendingFocus = null;
    if (director) director.interrupt('input');
    select(id, 'focus');
    const pos = positionOf(e);
    if (!pos) return;
    const pure = director ? director.pure : (root.MCC_GLOBE_DIRECTOR ? root.MCC_GLOBE_DIRECTOR.pure : null);
    const measure = e.kind === 'quake' ? { mag: e.mag } : e.kind === 'natural' ? { category: e.item.event ? e.item.event.kind : e.item.category } : {};
    const height = pure ? pure.heightFor(e.kind, measure) : 900000;
    const destination = degrees(pos.lon, pos.lat, height), orientation = { heading: 0, pitch: Cesium.Math.toRadians(height < 400000 ? -60 : -90), roll: 0 };
    if (!motionAllowed() || !pure) { viewer.camera.setView({ destination, orientation }); requestRender('focus'); return; }
    const c = viewer.camera.positionCartographic;
    const duration = pure.flightDuration({ lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), height: c.height }, { lon: pos.lon, lat: pos.lat, height });
    const bound = Math.round(duration * 1000 + FOCUS_SAFETY_MS);
    hold('env-focus', bound);
    const done = () => release('env-focus');
    viewer.camera.flyTo({ destination, orientation, duration, easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT, flyOverLongitude: pure.shortestArcMidLon(Cesium.Math.toDegrees(c.longitude), pos.lon), complete: done, cancel: done });
  }
  function sceneAction(action) {
    if (!director) return;
    if (action === 'play') director.play(); else if (action === 'pause') director.pause(); else if (action === 'next') director.next(); else if (action === 'prev') director.prev(); else if (action === 'stop') director.stop();
  }
  function view(mode) {
    if (!viewer || !Cesium.SceneMode) return;
    const target = mode === '2d' ? '2d' : '3d';
    const scene = viewer.scene, is2d = scene.mode === Cesium.SceneMode.SCENE2D;
    viewTarget = target;
    if ((target === '2d') === is2d) { tell({ type: 'hu:environment-view-state', mode: target, morphing: false }); return; }
    const duration = motionAllowed() ? 1.2 : 0;
    if (target === '2d') scene.morphTo2D(duration); else scene.morphTo3D(duration);
    requestRender('view');
  }
  function onMorphStart() { tell({ type: 'hu:environment-view-state', mode: viewTarget, morphing: true }); }
  function onMorphComplete() { const mode = viewer && viewer.scene.mode === Cesium.SceneMode.SCENE2D ? '2d' : '3d'; viewTarget = mode; tell({ type: 'hu:environment-view-state', mode, morphing: false }); requestRender('morphed'); }

  function onMessage(d) {
    if (!d || typeof d.type !== 'string' || !/^hu:environment-/.test(d.type) || d.type === 'hu:environment-pins') return false;
    if (!mounted) { pendingMessages.push(d); return true; }
    if (d.type === 'hu:environment-layers') setLayers(d);
    else if (d.type === 'hu:environment-focus') focus(d.id);
    else if (d.type === 'hu:environment-scene') sceneAction(d.action);
    else if (d.type === 'hu:environment-view') view(d.mode);
    return true;
  }
  function mount(options) {
    const o = options || {};
    if (mounted || !o.viewer || !o.Cesium) return false;
    viewer = o.viewer; Cesium = o.Cesium; tell = typeof o.tell === 'function' ? o.tell : () => {};
    governor = o.governor || null; director = o.director || null; doc = o.document || root.document || null;
    client = o.client || (root.MCC_ENVIRONMENT_LAYERS_CLIENT ? root.MCC_ENVIRONMENT_LAYERS_CLIENT.create({ hidden: () => !!(doc && doc.hidden) }) : null);
    lodState = lod(viewer.camera.positionCartographic.height);
    viewer.camera.changed.addEventListener(onCameraChanged);
    if (viewer.scene.morphStart) viewer.scene.morphStart.addEventListener(onMorphStart);
    if (viewer.scene.morphComplete) viewer.scene.morphComplete.addEventListener(onMorphComplete);
    if (director && typeof director.attachInput === 'function') director.attachInput({ canvas: viewer.scene.canvas, document: doc });
    mounted = true;
    if (data.events.length) { eventsSignature = ''; setEvents(data.events, { on: eventsOn }); }
    for (const d of pendingMessages.splice(0)) onMessage(d);
    root.__mccEnvironmentLayers = debug;
    root.__mccFrameSampler = ms => new Promise(resolve => {
      const deltas = []; let last = root.performance.now();
      const fn = () => { const t = root.performance.now(); deltas.push(t - last); last = t; };
      viewer.scene.postRender.addEventListener(fn);
      root.setTimeout(() => { viewer.scene.postRender.removeEventListener(fn); deltas.shift(); const sorted = deltas.slice().sort((a, b) => a - b); resolve({ frames: deltas.length, meanMs: deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length * 10) / 10 : null, p95Ms: sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 10) / 10 : null }); }, Math.max(100, Number(ms) || 3000));
    });
    return true;
  }
  function debug() {
    const terminal = s => s && s.status !== 'loading';
    return {
      on, lod: lodState, ready: !on || (LAYER_KEYS.every(k => terminal(states[k])) && building.size === 0), built: building.size === 0,
      counts: JSON.parse(JSON.stringify(counts)), states: Object.fromEntries(Object.entries(states).map(([k, s]) => [k, s ? { status: s.status, reason: s.reason, count: s.count, total: s.total, truncated: s.truncated, fetched_at: s.fetched_at, last_success_at: s.last_success_at, attribution: s.attribution, license: s.license, coverage: s.coverage } : null])),
      selected: selected ? { id: selected.id, layer: selected.layer, kind: selected.kind } : null, ripple: ripple ? { active: true, startedAt: ripple.startedAt } : null, lastRipple: lastRipple ? { ...lastRipple } : null, pendingFocus, legend: legendLines.slice(),
      replay: replayMode, layersOn: Object.assign({}, layersOn), eventsOn, policy: !!(client && client.isPolicy()), picks: picks.size, shakemap: shakemap ? { quakeId: shakemap.quakeId, lines: counts.shakemapLines, unavailable: shakemap.unavailable || null } : null
    };
  }
  function destroy() {
    if (!mounted) return;
    deactivate();
    for (const group of Object.values(prims)) for (const k of Object.keys(group)) group[k] = removePrim(group[k]);
    if (buildListener) { viewer.scene.postRender.removeEventListener(buildListener); buildListener = null; }
    viewer.camera.changed.removeEventListener(onCameraChanged);
    if (viewer.scene.morphStart) viewer.scene.morphStart.removeEventListener(onMorphStart);
    if (viewer.scene.morphComplete) viewer.scene.morphComplete.removeEventListener(onMorphComplete);
    picks.clear(); building.clear(); deferred.length = 0; selected = null; selectedLabel = null; shakemap = null;
    root.clearTimeout(pendingFocusTimer); pendingFocus = null;
    mounted = false;
  }
  root.MCC_ENVIRONMENT_LAYERS = Object.freeze({
    encodings, FEED_TERMS, isEnvPick, pickId, mount, onMessage, setEvents, redraw: () => { if (mounted) { applyVisibility(); updateLegend(); requestRender('redraw'); } }, focus, pick, select, destroy, debug,
    clearSelection: () => { if (mounted) clearSelection(); }
  });
})(window);
