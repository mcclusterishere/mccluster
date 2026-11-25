/* THE SCENE DIRECTOR: a tour over the significant environmental events, and the replay of the last 24 hours of
   earthquakes in recorded order.
   Adapted from gods-eye-view src/director/camera.js (shortest-arc interpolation), src/director/playback.js (queue phases) and src/cameraVerbs.js (manual-input interrupt), MIT, Copyright (c) 2026 Bilawal Sidhu, see THIRD-PARTY-NOTICES.

   Every move is one viewer.camera.flyTo with Cesium's cubic in-out easing, flying over the midpoint of the short
   longitude arc so the camera never takes the long way round the antimeridian. The flight holds the render governor
   ('env-director', bounded to duration + 600 ms); the dwell at a scene draws no frames at all. Any pointer, touch,
   wheel or key input pauses the tour; so does a hidden document. Under prefers-reduced-motion nothing moves by
   itself: play is refused, and next/prev/focus jump with camera.setView. The pure helpers below carry no viewer and
   no clock, so the queue and the flight arithmetic are unit-tested on their own.
   Event timeline slice S6 (2026-11-19): a flight stopped on its way leaves the state naming the scene the camera last arrived at,
   never the one it was flying to; the replay keeps its flights but is playback of the page's one time cursor (each arrival moves
   the cursor, js/environment-layers.js), and a visitor's scrub of that cursor stops it and seeks it without moving the camera. */
(function (root) {
  'use strict';
  const HOLD_TOUR_MS = 5000, HOLD_REPLAY_MS = 2500, LIMIT_TOUR = 12, LIMIT_REPLAY = 50, DAY_MS = 86400000, SAFETY_MS = 600;
  const RAD = Math.PI / 180;

  /* ---------- pure ---------- */
  function normalizeLon(lon) {
    let x = ((((Number(lon) || 0) + 180) % 360) + 360) % 360 - 180;
    if (x === -180 && lon > 0) x = 180;
    return x;
  }
  /* the gods-eye-view angle rule: the midpoint along the shorter of the two ways round */
  function shortestArcMidLon(a, b) {
    return normalizeLon(a + (((((b - a) + 540) % 360) + 360) % 360 - 180) / 2);
  }
  function greatCircleDeg(a, b) {
    const la1 = a.lat * RAD, la2 = b.lat * RAD, dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / RAD;
  }
  /* seconds: longer with distance and with a change of height, never under 1.2 s or over 4.5 s */
  function flightDuration(from, to) {
    const h0 = from && from.height > 0 ? from.height : 1, h1 = to && to.height > 0 ? to.height : 1;
    const seconds = 0.8 + 0.045 * greatCircleDeg(from, to) + 0.4 * Math.abs(Math.log10(h1 / h0));
    return Math.min(4.5, Math.max(1.2, seconds));
  }
  const NATURAL_HEIGHTS = { fire: 300000, cyclone: 1500000, storm: 1500000, volcano: 250000 };
  function heightFor(kind, measure) {
    const m = measure || {};
    if (kind === 'quake') return (Number(m.mag) || 0) >= 7 ? 1600000 : 900000;
    if (kind === 'alert') return Math.max(250000, (Number(m.bboxSpanDeg) || 0) * 111000 * 1.6);
    if (kind === 'natural') return Object.prototype.hasOwnProperty.call(NATURAL_HEIGHTS, m.category) ? NATURAL_HEIGHTS[m.category] : 600000;
    if (kind === 'cyclone') return 2000000;
    if (kind === 'perimeter') return 120000;
    if (kind === 'station') return 500000;
    if (kind === 'fire_cell') return 400000;
    return 600000;
  }
  const KINDS = { usgs: 'quake', nws: 'alert', eonet: 'natural', nhc: 'cyclone' };
  const kindOf = item => KINDS[String(item && item.id || '').split(':')[0]] || 'event';
  const placed = item => item && typeof item.lat === 'number' && typeof item.lon === 'number' && Number.isFinite(item.lat) && Number.isFinite(item.lon);
  const time = iso => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
  function magnitudeOf(item) {
    const fact = (Array.isArray(item.facts) ? item.facts : []).find(f => f && f.label === 'Magnitude');
    const n = fact ? Number(fact.value) : NaN;
    return Number.isFinite(n) ? n : null;
  }
  function sceneOf(item, holdMs) {
    const kind = kindOf(item);
    const measure = kind === 'quake' ? { mag: magnitudeOf(item) } : kind === 'natural' ? { category: item.category } : {};
    const height = heightFor(kind, measure);
    return { id: item.id, layer: 'events', kind, title: String(item.title || ''), lon: item.lon, lat: item.lat, height_m: height, pitch_deg: height < 400000 ? -60 : -90, hold_ms: holdMs, observed_at: typeof item.observed_at === 'string' ? item.observed_at : null };
  }
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function buildQueue(items, options) {
    const list = (Array.isArray(items) ? items : []).filter(placed);
    const o = options || {};
    if (o.queue === 'quakes-24h') {
      const quakes = list.filter(i => i.category === 'quake' && time(i.observed_at) !== null);
      if (!quakes.length) return [];
      const newest = Math.max(...quakes.map(i => time(i.observed_at)));
      return quakes.filter(i => time(i.observed_at) >= newest - DAY_MS)
        .sort((a, b) => time(a.observed_at) - time(b.observed_at) || byId(a, b))
        .slice(0, o.limit || LIMIT_REPLAY).map(i => sceneOf(i, HOLD_REPLAY_MS));
    }
    return list.filter(i => i.significant === true)
      .sort((a, b) => { const ta = time(a.observed_at), tb = time(b.observed_at); if (ta === null && tb === null) return byId(a, b); if (ta === null) return 1; if (tb === null) return -1; return tb - ta || byId(a, b); })
      .slice(0, o.limit || LIMIT_TOUR).map(i => sceneOf(i, HOLD_TOUR_MS));
  }
  /* THE REPLAY IS PLAYBACK OF THE TIME CURSOR (event timeline slice S6, 2026-11-19; decision D15 as clarified, default adopted pending
     Matthew's confirmation): the scene a replay stands at for a cursor time is the last quake recorded at or before it, -1 before
     the first, the last one for a cursor at live (null) */
  function seekIndex(scenes, atMs) {
    const list = Array.isArray(scenes) ? scenes : [];
    if (atMs === null || atMs === undefined) return list.length - 1;
    let k = -1;
    list.forEach((s, i) => { const t = time(s && s.observed_at); if (t !== null && t <= atMs) k = i; });
    return k;
  }
  const pure = Object.freeze({ buildQueue, flightDuration, shortestArcMidLon, greatCircleDeg, heightFor, normalizeLon, kindOf, seekIndex });

  /* ---------- runtime ---------- */
  function create(options) {
    const o = options || {};
    const viewer = o.viewer, Cesium = o.Cesium, governor = o.governor || { hold() {}, release() {}, requestRender() {} };
    const tell = typeof o.tell === 'function' ? o.tell : () => {};
    const reducedMotion = typeof o.reducedMotion === 'function' ? o.reducedMotion : () => false;
    const hidden = typeof o.hidden === 'function' ? o.hidden : () => false;
    const schedule = o.setTimeout || ((fn, ms) => root.setTimeout(fn, ms));
    const unschedule = o.clearTimeout || (id => root.clearTimeout(id));
    const onArrive = typeof o.onArrive === 'function' ? o.onArrive : () => {};
    let queueName = 'significant', queue = [], index = 0, playing = false, reason = null, destroyed = false;
    let flight = null, dwell = null;
    /* event timeline slice S6: the scene the camera last arrived at (by id), and whether the index was put back on it (a flight
       stopped on its way, a seek of the time cursor), so that Play and Next go on from there */
    let arrivedId = null, resumeNext = false;
    const arrivedIndex = () => (arrivedId === null ? -1 : queue.findIndex(s => s.id === arrivedId));
    const detachers = [];

    const state = () => { const scene = queue[index] || null; return { playing, index, total: queue.length, id: scene ? scene.id : null, title: scene ? scene.title : null, queue: queueName, reason }; };
    const tellState = () => tell({ type: 'hu:environment-scene-state', ...state() });
    function cameraPose() {
      const c = viewer.camera.positionCartographic;
      return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), height: c.height };
    }
    function clearDwell() { if (dwell !== null) { unschedule(dwell); dwell = null; } }
    /* a flight that is cancelled resolves through its own cancel callback (Cesium calls it); a flight whose callbacks never
       come resolves through the safety timer. Either way the hold is released exactly once. */
    function fly(scene, after) {
      if (flight) flight.finish('cancel');
      const destination = Cesium.Cartesian3.fromDegrees(scene.lon, scene.lat, scene.height_m);
      const orientation = { heading: 0, pitch: Cesium.Math.toRadians(scene.pitch_deg), roll: 0 };
      if (reducedMotion()) { viewer.camera.setView({ destination, orientation }); after('instant'); return; }
      const from = cameraPose();
      const duration = flightDuration(from, { lon: scene.lon, lat: scene.lat, height: scene.height_m });
      const bound = Math.round(duration * 1000 + SAFETY_MS);
      let done = false, safety = null;
      const record = { finish };
      function finish(how) {
        if (done) return;
        done = true;
        if (safety !== null) unschedule(safety);
        if (flight === record) flight = null;
        governor.release('env-director');
        after(how);
      }
      flight = record;
      governor.hold('env-director', bound);
      safety = schedule(() => finish('timeout'), bound);
      viewer.camera.flyTo({ destination, orientation, duration, easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT, flyOverLongitude: shortestArcMidLon(from.lon, scene.lon), complete: () => finish('complete'), cancel: () => finish('cancel') });
    }
    function arrive(scene, how) {
      if (destroyed || how === 'cancel') return;
      arrivedId = scene.id; resumeNext = false;
      onArrive(scene);
      if (playing) { clearDwell(); dwell = schedule(() => { dwell = null; advance(); }, scene.hold_ms); }
    }
    function go() { const scene = queue[index]; if (!scene) return; fly(scene, how => arrive(scene, how)); }
    function advance() {
      if (destroyed || !playing) return;
      if (index >= queue.length - 1) { playing = false; reason = 'end'; tellState(); return; }
      index += 1; tellState(); go();
    }
    function refuse(why) { playing = false; reason = why; tellState(); }
    function play() {
      if (destroyed) return;
      if (reducedMotion()) return refuse('reduced-motion');
      if (hidden()) return refuse('hidden');
      if (!queue.length) return refuse('empty');
      /* play on a tour already under way is idempotent: the scene in flight or in its dwell is never restarted (the panel may
         say play twice when the globe says ready twice, a hello answered after boot; review G1R-4) */
      if (playing && (flight || dwell !== null)) { tellState(); return; }
      if (reason === 'end') index = 0;
      /* put back on a scene (or before the first) by a stopped flight or a seek: go on with the next one, the first after the last */
      else if (resumeNext || index < 0) index = index + 1 >= queue.length ? 0 : index + 1;
      resumeNext = false;
      clearDwell();
      playing = true; reason = null; tellState(); go();
    }
    function pause(why) {
      if (destroyed) return;
      clearDwell();
      const flying = !!flight;
      if (viewer && viewer.camera && typeof viewer.camera.cancelFlight === 'function') viewer.camera.cancelFlight();
      if (flight) flight.finish('cancel');
      /* A FLIGHT STOPPED ON ITS WAY NEVER REACHED ITS SCENE (event timeline slice S6; the reconciliation's V8 finding): the state named
         the scene it was flying to while the globe still showed the one before it ("Paused at scene 2 of 12: <the alert>" beside the
         label of scene 1). It names the scene the camera last arrived at again (none when it has not arrived at any), and Play or
         Next go on from there; Previous goes back from there. */
      if (flying) { index = arrivedIndex(); resumeNext = true; }
      playing = false; reason = why === undefined ? null : why; tellState();
    }
    function step(delta) {
      if (destroyed || !queue.length) return;
      clearDwell();
      if (flight) flight.finish('cancel');
      index = index < 0 ? (delta > 0 ? 0 : queue.length - 1) : (index + delta + queue.length) % queue.length;
      resumeNext = false;
      reason = null; tellState(); go();
    }
    function stop() { if (destroyed) return; pause('off'); index = 0; arrivedId = null; resumeNext = false; tellState(); }
    /* the replay follows the visitor's time cursor (event timeline slice S6, D15): the caller has stopped any flight (a scrub never
       moves the camera); the replay stands at the last quake at or before the cursor and Play or Next go on with the one after it */
    function seek(atMs) {
      if (destroyed || queueName !== 'quakes-24h') return;
      if (playing || flight) pause('time');
      clearDwell();
      index = seekIndex(queue, typeof atMs === 'number' && Number.isFinite(atMs) ? atMs : null);
      resumeNext = true; playing = false; reason = 'time'; tellState();
    }
    function interrupt(why) { if (destroyed) return; if (playing || flight) pause(why || 'input'); }
    function setQueue(items, opts) {
      if (destroyed) return;
      const currentId = queue[index] ? queue[index].id : null;
      queueName = opts && opts.queue === 'quakes-24h' ? 'quakes-24h' : 'significant';
      queue = buildQueue(items, { queue: queueName });
      if (arrivedId !== null && !queue.some(s => s.id === arrivedId)) arrivedId = null;
      const keep = currentId === null ? -1 : queue.findIndex(s => s.id === currentId);
      if (keep >= 0) index = keep;
      /* a state that names no scene (a flight stopped before any arrival, a cursor before the first quake) keeps naming none */
      else if (currentId === null && index < 0 && !playing) index = -1;
      else {
        index = 0; resumeNext = false;
        if (playing) { clearDwell(); if (flight) flight.finish('cancel'); if (queue.length) go(); else { playing = false; reason = 'empty'; } }
      }
      if (reason === 'end' && queue.length) reason = null;
      tellState();
    }
    /* any manual input reclaims the camera (the gods-eye-view cancelFlight reflex) */
    function attachInput(targets) {
      const t = targets || {};
      const stopNow = () => interrupt('input');
      if (t.canvas && typeof t.canvas.addEventListener === 'function') for (const name of ['pointerdown', 'touchstart', 'wheel']) {
        t.canvas.addEventListener(name, stopNow, { passive: true });
        detachers.push(() => t.canvas.removeEventListener(name, stopNow));
      }
      if (t.document && typeof t.document.addEventListener === 'function') {
        t.document.addEventListener('keydown', stopNow);
        detachers.push(() => t.document.removeEventListener('keydown', stopNow));
      }
    }
    const director = Object.freeze({
      pure, setQueue, play, pause, next: () => step(1), prev: () => step(-1), stop, interrupt, attachInput, state, seek,
      queueIds: () => queue.map(s => s.id), scene: () => queue[index] || null,
      destroy() { if (destroyed) return; pause('off'); detachers.splice(0).forEach(fn => fn()); destroyed = true; }
    });
    root.__mccSceneDirector = () => ({ ...state(), queueIds: director.queueIds() });
    return director;
  }
  root.MCC_GLOBE_DIRECTOR = Object.freeze({ pure, create });
})(window);
