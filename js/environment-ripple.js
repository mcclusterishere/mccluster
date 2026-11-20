/* THE RIPPLE ON THE SELECTED EARTHQUAKE (event timeline slice S5, 2026-11-19; decision D17, default adopted pending Matthew's
   confirmation): when a quake is chosen, two rings travel outward over the ground from its epicentre to a stated regional radius
   (50 km below M5, rising with the magnitude to 300 km from M7) in about 2.4 s, and are gone. It is illustrative, never a
   recording of shaking, and says so ("Ripple is illustrative: not a recording of shaking"). When the camera is pushing in to the
   quake the rings wait for it to land (2.5 s at most), so the wave is seen from where the visitor arrives.

   How it is drawn, and what it never does. One GroundPrimitive (an ellipse at the full radius, so it lies on the ground: the
   ellipsoid for a guest, the terrain where terrain is loaded) is built once per selection, asynchronously, with an original ring
   material whose two uniforms, the fronts of the two rings, are the only thing written per frame, for at most 6 s under the
   bounded 'env-ripple' render hold. No per-frame property callback, no geometry rebuilt per frame, no pulse on every quake: Hitman's Halo
   recorded that breathing ground discs (58 discs with callback axes) cost 32.4 ms a frame against 1.4 ms static, and that
   pattern stays retired. Under prefers-reduced-motion nothing moves: the same radius is a still outline, kept while the quake is
   selected, asking for no frame after it is built. The pure timing and radius rules carry no Cesium and no clock
   (scripts/test/environment-ripple.test.mjs). Original code; the references were looked at for pacing only. */
(function (root) {
  'use strict';
  const RING_MS = 1600, GAP_MS = 800, RINGS = 2, DURATION_MS = GAP_MS * (RINGS - 1) + RING_MS, HOLD_MAX_MS = 6000, WAIT_MAX_MS = 2500;
  const LABEL = 'Ripple is illustrative: not a recording of shaking';
  const finite = v => typeof v === 'number' && Number.isFinite(v);

  /* ---------- pure ---------- */
  /* the regional radius (D17): 50 km below M5 (and with no magnitude), 125 km more per magnitude unit from M5, 300 km from M7 */
  function radiusM(mag) {
    if (!finite(mag) || mag < 5) return 50000;
    if (mag >= 7) return 300000;
    return Math.round(50000 + 125000 * (mag - 5));
  }
  /* the rings' fronts, 0 at the epicentre to 1 at the radius, at `elapsed` ms after the rings began; -1 for a ring not under way.
     Each ring takes 1.6 s and slows as it spreads (an ease-out), the second leaves 0.8 s after the first; all over at 2.4 s. */
  function fronts(elapsed) {
    const out = [];
    for (let k = 0; k < RINGS; k += 1) {
      const u = (elapsed - k * GAP_MS) / RING_MS;
      out.push(u >= 0 && u <= 1 ? Math.round((1 - (1 - u) * (1 - u)) * 10000) / 10000 : -1);
    }
    return out;
  }
  /* the ring's brightness at a front: full near the epicentre, a quarter by the time it reaches the radius */
  const intensity = front => (front < 0 ? 0 : 0.25 + 0.75 * (1 - Math.min(1, Math.max(0, (front - 0.55) / 0.45))));
  const done = elapsed => elapsed >= DURATION_MS;
  const pure = Object.freeze({ radiusM, fronts, intensity, done, RING_MS, GAP_MS, RINGS, DURATION_MS, HOLD_MAX_MS, WAIT_MAX_MS, LABEL });

  /* the ring material: `d` is the distance from the centre over the ellipse's own texture square (0 at the epicentre, 1 at the
     radius); a ring is a sharp leading edge with a soft tail behind it; `outline` draws the still circle instead */
  const SOURCE = [
    'uniform vec4 color;',
    'uniform float front1;',
    'uniform float front2;',
    'uniform float outline;',
    'float mccRing(float d, float front) {',
    '  if (front < 0.0) return 0.0;',
    '  float lead = 1.0 - smoothstep(front, front + 0.02, d);',
    '  float tail = smoothstep(front - 0.18, front, d);',
    '  float fade = 0.25 + 0.75 * (1.0 - clamp((front - 0.55) / 0.45, 0.0, 1.0));',
    '  return lead * tail * tail * fade;',
    '}',
    'czm_material czm_getMaterial(czm_materialInput materialInput) {',
    '  czm_material material = czm_getDefaultMaterial(materialInput);',
    '  float d = length(materialInput.st - vec2(0.5)) * 2.0;',
    '  float a = outline > 0.5 ? smoothstep(0.952, 0.972, d) * (1.0 - smoothstep(0.986, 1.0, d)) : max(mccRing(d, front1), mccRing(d, front2));',
    '  material.diffuse = color.rgb;',
    '  material.alpha = color.a * a * step(d, 1.0);',
    '  return material;',
    '}'
  ].join('\n');

  /* ---------- runtime ---------- */
  function create(options) {
    const o = options || {};
    const viewer = o.viewer, Cesium = o.Cesium;
    const add = typeof o.add === 'function' ? o.add : p => viewer.scene.primitives.add(p);
    const remove = typeof o.remove === 'function' ? o.remove : p => { try { viewer.scene.primitives.remove(p); } catch (e) {} return null; };
    const hold = typeof o.hold === 'function' ? o.hold : () => {};
    const release = typeof o.release === 'function' ? o.release : () => {};
    const requestRender = typeof o.requestRender === 'function' ? o.requestRender : () => {};
    const onEnd = typeof o.onEnd === 'function' ? o.onEnd : () => {};
    const clock = typeof o.now === 'function' ? o.now : () => Date.now();
    const schedule = o.setTimeout || ((fn, ms) => root.setTimeout(fn, ms));
    const unschedule = o.clearTimeout || (id => root.clearTimeout(id));
    let current = null, last = null;
    const supported = () => !!(viewer && Cesium && Cesium.GroundPrimitive && Cesium.Material && typeof Cesium.GroundPrimitive.isSupported === 'function' && Cesium.GroundPrimitive.isSupported(viewer.scene)
      && (typeof Cesium.GroundPrimitive.supportsMaterials !== 'function' || Cesium.GroundPrimitive.supportsMaterials(viewer.scene)));
    function material(still) {
      return new Cesium.Material({ fabric: { type: 'MccEnvironmentRipple', uniforms: { color: new Cesium.Color(0.93, 0.98, 1, 0.9), front1: -1, front2: -1, outline: still ? 1 : 0 }, source: SOURCE }, translucent: true });
    }
    /* spec { id, lon, lat, mag, still, wait }: `still` draws the outline (reduced motion); `wait` holds the rings until go() */
    function start(spec) {
      clear();
      const s = spec || {};
      if (!finite(s.lon) || !finite(s.lat) || !supported()) return null;
      const r = radiusM(s.mag), still = s.still === true;
      let prim;
      try {
        prim = new Cesium.GroundPrimitive({
          /* 96 points round the rim (EllipseGeometry steps round it by eight times the granularity, at any radius; PI / 90 gave 24),
             so the rings are never cut by flats once the push lands */
          geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.EllipseGeometry({ center: Cesium.Cartesian3.fromDegrees(s.lon, s.lat), semiMajorAxis: r, semiMinorAxis: r, granularity: Math.PI / 384 }) }),
          appearance: new Cesium.MaterialAppearance({ material: material(still), flat: true, translucent: true }), allowPicking: false, asynchronous: true
        });
      } catch (err) { return null; }
      add(prim);
      const t0 = clock();
      const c = { id: s.id || null, prim, radiusM: r, phase: still ? 'outline' : s.wait === true ? 'waiting' : 'rings', scheduledAt: t0, startedAt: null, step: null, timer: null, waitTimer: null, still };
      current = c;
      if (still) {
        /* the outline is built once and then left alone: a bounded hold only while Cesium builds it */
        hold('env-ripple', HOLD_MAX_MS);
        c.step = () => { if (prim.ready) { viewer.scene.preRender.removeEventListener(c.step); c.step = null; release('env-ripple'); requestRender('ripple-outline'); } };
        viewer.scene.preRender.addEventListener(c.step);
        requestRender('ripple-outline');
        return { radiusM: r, phase: c.phase, label: LABEL };
      }
      hold('env-ripple', HOLD_MAX_MS);
      if (c.phase === 'waiting') c.waitTimer = schedule(() => go(), WAIT_MAX_MS);
      c.step = () => {
        const u = prim.appearance && prim.appearance.material && prim.appearance.material.uniforms;
        if (!u || !prim.ready || c.phase === 'waiting') return;
        if (c.startedAt === null) c.startedAt = clock();
        const elapsed = clock() - c.startedAt, f = fronts(elapsed);
        u.front1 = f[0]; u.front2 = f[1];
        if (done(elapsed)) { if (current === c) { clear(); onEnd(); } }
      };
      /* the frames write the fronts; the timer ends the ripple on time even when frames are sparse (software GL) */
      c.timer = schedule(() => { if (current === c) { clear(); onEnd(); } }, HOLD_MAX_MS);
      viewer.scene.preRender.addEventListener(c.step);
      requestRender('ripple');
      return { radiusM: r, phase: c.phase, label: LABEL };
    }
    /* the push has landed (or was cancelled, or there was none): the rings may begin */
    function go() {
      const c = current;
      if (!c || c.phase !== 'waiting') return;
      if (c.waitTimer !== null) { unschedule(c.waitTimer); c.waitTimer = null; }
      c.phase = 'rings';
      requestRender('ripple-go');
    }
    function clear() {
      const c = current;
      if (!c) return;
      current = null;
      if (c.step) viewer.scene.preRender.removeEventListener(c.step);
      if (c.timer !== null) unschedule(c.timer);
      if (c.waitTimer !== null) unschedule(c.waitTimer);
      remove(c.prim);
      last = { id: c.id, startedAt: c.scheduledAt, ringsAt: c.startedAt, endedAt: clock(), radiusM: c.radiusM, phase: c.phase };
      release('env-ripple');
      requestRender('ripple-end');
    }
    function state() {
      const c = current;
      if (!c) return null;
      const elapsed = c.startedAt === null ? null : clock() - c.startedAt;
      return { active: true, id: c.id, phase: c.phase, startedAt: c.scheduledAt, ringsAt: c.startedAt, radiusM: c.radiusM, fronts: elapsed === null ? null : fronts(elapsed), built: !!c.prim.ready };
    }
    return Object.freeze({ start, go, clear, state, last: () => (last ? { ...last } : null), supported, pure });
  }
  root.MCC_ENVIRONMENT_RIPPLE = Object.freeze({ pure, create, LABEL });
})(window);
