/* THE PUSH ON A SELECTION (event timeline slice S5, 2026-11-19; decision D14, default adopted pending Matthew's confirmation):
   when a visitor chooses an event (a tap on its glyph, its post's "Show on globe", its row in the panel's list), the camera pushes
   in to a regional frame over it: for an earthquake about 120 km away at M4.5 out to 300 km from M7.5, looking down at -45 to -60
   degrees, its heading kept, in 1.6 to 2 s with Cesium's cubic in-out easing, the event at the centre of the globe's view. Any
   other kind keeps the frame it had (its height above it, straight down from 400 km), now cancellable too. The visitor's hand
   always wins: a pointer, a touch, a wheel or a key on the globe cancels the push at once and the camera stays where it is; a new
   selection cancels it too. Nothing moves by itself under prefers-reduced-motion: a tap selects without moving, and a chosen
   post or row jumps to the same frame with camera.setView-like placement (no animation). The tour and the replay never push:
   they keep the director's own flights. A push holds the render governor ('env-focus') only while it flies, bounded by its
   duration plus 600 ms. The pure helpers carry no viewer and no clock and are unit-tested on their own
   (scripts/test/environment-camera.test.mjs). Pacing is taken as a visual reference only; this is original code. */
(function (root) {
  'use strict';
  const RAD = Math.PI / 180;
  const PUSH = Object.freeze({ nearM: 120000, farM: 300000, nearPitch: -45, farPitch: -60, minS: 1.6, maxS: 2, safetyMs: 600 });
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const finite = v => typeof v === 'number' && Number.isFinite(v);

  /* ---------- pure ---------- */
  /* an earthquake's regional frame: 120 km at M4.5 and below, 60 km more per magnitude unit, 300 km from M7.5; the pitch steepens
     with the range from -45 to -60 degrees, so a wider frame still reads as the ground around the event */
  function quakeFrame(mag) {
    const m = finite(mag) ? mag : 4.5;
    const rangeM = Math.round(clamp(PUSH.nearM + 60000 * (m - 4.5), PUSH.nearM, PUSH.farM));
    const pitchDeg = PUSH.nearPitch + (PUSH.farPitch - PUSH.nearPitch) * (rangeM - PUSH.nearM) / (PUSH.farM - PUSH.nearM);
    return { rangeM, pitchDeg, keepHeading: true };
  }
  /* every other kind keeps the frame the focus always gave it: its height (js/globe-scene-director.js heightFor), straight down
     from 400 km, -60 degrees below that, north up */
  function frameFor(kind, measure, heightFor) {
    if (kind === 'quake') return quakeFrame(measure && measure.mag);
    const h = typeof heightFor === 'function' ? heightFor(kind, measure || {}) : 600000;
    return { rangeM: h, pitchDeg: h < 400000 ? -60 : -90, keepHeading: false };
  }
  function greatCircleDeg(a, b) {
    const la1 = a.lat * RAD, la2 = b.lat * RAD, dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / RAD;
  }
  /* seconds: 1.6 for a push within view, up to 2 for one across a hemisphere */
  function pushSeconds(from, to) {
    const d = from && to && finite(from.lat) && finite(from.lon) && finite(to.lat) && finite(to.lon) ? greatCircleDeg(from, to) : 0;
    return Math.round((PUSH.minS + (PUSH.maxS - PUSH.minS) * Math.min(1, d / 90)) * 1000) / 1000;
  }
  /* which selections push: an explicit choice (a tap, a post, a row, a deep link), never the tour's or the replay's arrivals; under
     reduced motion a tap does not move the camera and a chosen post or row jumps */
  function pushMode(via, reduced) {
    if (via !== 'pick' && via !== 'focus') return 'none';
    if (!reduced) return 'flight';
    return via === 'focus' ? 'jump' : 'none';
  }
  const INPUTS = Object.freeze(['pointerdown', 'touchstart', 'wheel']);
  const pure = Object.freeze({ quakeFrame, frameFor, pushSeconds, pushMode, greatCircleDeg, PUSH, INPUTS });

  /* ---------- runtime ---------- */
  function create(options) {
    const o = options || {};
    const viewer = o.viewer, Cesium = o.Cesium;
    const hold = typeof o.hold === 'function' ? o.hold : () => {};
    const release = typeof o.release === 'function' ? o.release : () => {};
    const requestRender = typeof o.requestRender === 'function' ? o.requestRender : () => {};
    const reducedMotion = typeof o.reducedMotion === 'function' ? o.reducedMotion : () => false;
    const schedule = o.setTimeout || ((fn, ms) => root.setTimeout(fn, ms));
    const unschedule = o.clearTimeout || (id => root.clearTimeout(id));
    let flight = null, last = null, destroyed = false;
    const detachers = [];
    function cameraLonLat() {
      const c = viewer.camera.positionCartographic;
      return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), height: c.height };
    }
    function pose(target, frame) {
      const heading = frame.keepHeading ? viewer.camera.heading : 0;
      const sphere = new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(target.lon, target.lat, 0), 0);
      return { sphere, offset: new Cesium.HeadingPitchRange(finite(heading) ? heading : 0, frame.pitchDeg * RAD, frame.rangeM) };
    }
    /* target { id, lon, lat }, frame { rangeM, pitchDeg, keepHeading }, via 'pick' | 'focus'; onSettled(how) is called once, when
       the camera is where it will stay ('complete', 'cancel', 'jump', 'none' or 'timeout') */
    function push(target, frame, via, onSettled) {
      const settled = typeof onSettled === 'function' ? onSettled : () => {};
      if (destroyed || !viewer || !target || !finite(target.lon) || !finite(target.lat) || !frame) { settled('none'); return 'none'; }
      cancel('selection');
      const mode = pushMode(via, reducedMotion());
      if (mode === 'none') { last = { id: target.id, mode, how: 'none', at: Date.now() }; settled('none'); return mode; }
      const p = pose(target, frame);
      if (mode === 'jump') {
        viewer.camera.viewBoundingSphere(p.sphere, p.offset);
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        last = { id: target.id, mode, how: 'jump', at: Date.now() };
        requestRender('push-jump'); settled('jump');
        return mode;
      }
      const duration = pushSeconds(cameraLonLat(), target), bound = Math.round(duration * 1000 + PUSH.safetyMs);
      let done = false, safety = null;
      const record = { id: target.id, startedAt: Date.now(), duration, finish };
      function finish(how) {
        if (done) return;
        done = true;
        if (safety !== null) unschedule(safety);
        if (flight === record) flight = null;
        release('env-focus');
        last = { id: target.id, mode, how, at: Date.now(), duration };
        settled(how);
      }
      flight = record;
      hold('env-focus', bound);
      safety = schedule(() => finish('timeout'), bound);
      viewer.camera.flyToBoundingSphere(p.sphere, { offset: p.offset, duration, easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT, complete: () => finish('complete'), cancel: () => finish('cancel') });
      requestRender('push');
      return mode;
    }
    /* the visitor's hand, or a new selection: the push stops where it is, at once */
    function cancel(why) {
      if (!flight) return false;
      const f = flight;
      try { viewer.camera.cancelFlight(); } catch (e) {}
      f.finish('cancel');
      if (last) last.reason = why || 'input';
      return true;
    }
    function attachInput(targets) {
      const t = targets || {};
      const stop = () => cancel('input');
      if (t.canvas && typeof t.canvas.addEventListener === 'function') for (const name of INPUTS) {
        t.canvas.addEventListener(name, stop, { passive: true });
        detachers.push(() => t.canvas.removeEventListener(name, stop));
      }
      if (t.document && typeof t.document.addEventListener === 'function') {
        t.document.addEventListener('keydown', stop);
        detachers.push(() => t.document.removeEventListener('keydown', stop));
      }
    }
    const state = () => ({ flying: !!flight, id: flight ? flight.id : null, duration: flight ? flight.duration : null, last: last ? { ...last } : null });
    function destroy() { if (destroyed) return; cancel('off'); detachers.splice(0).forEach(fn => fn()); destroyed = true; }
    return Object.freeze({ push, cancel, attachInput, state, destroy, pure });
  }
  root.MCC_ENVIRONMENT_CAMERA = Object.freeze({ pure, create });
})(window);
