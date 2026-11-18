/* THE GLOBE'S RENDER GOVERNOR: on-demand rendering only while the environmental layers are on.
   Adapted from gods-eye-view src/renderGovernor.js, MIT, Copyright (c) 2026 Bilawal Sidhu, see THIRD-PARTY-NOTICES.

   Two modes, one window. DISABLED (the boot default, the ANALYTICS surface, and after hu:environment-layers
   on:false) leaves scene.requestRenderMode false and scene.maximumRenderTimeChange at Cesium's own value: the
   continuous loop exactly as the World has always drawn it. Holds are recorded but change nothing. ENABLED (on
   hu:environment-layers on:true) sets scene.maximumRenderTimeChange to 60 seconds and draws on demand whenever no
   owner holds the loop: Cesium then renders only when the camera moves, a tile or primitive asks for a frame, or
   the simulation clock (SYSTEM_CLOCK, so wall time) has advanced more than a minute since the last frame, which
   moves the day/night terminator, the SunLight and the city lights at most one frame a minute while idle (the sun
   moves 0.25 degrees a minute: invisible per step).

   Holds are keyed by owner in a Map, never counted: a double hold or a double release cannot corrupt the mode.
   Every environmental hold passes a bound (maxMs) and releases itself when it runs out. The page's existing
   per-frame pulses (the mission halos, the live badges) and its per-tick data layers take ONE unbounded hold named 'legacy'
   (legacyAnimators below, synced by js/action-globe.js), so whenever one of them is on the viewer stays
   continuous as before. The camera holds from moveStart to moveEnd with a 15 s safety release; a 2D/3D morph holds
   from morphStart to morphComplete (3 s at most). While enabled, entity, primitive and imagery-layer changes ask
   for a frame by themselves; every environmental mutation asks through requestRender(reason). The governor does
   no per-frame work of its own. */
(function (root) {
  'use strict';
  const IDLE_MAX_TIME_CHANGE = 60;
  const RECENT_CAP = 16;
  const CAMERA_SAFETY_MS = 15000;
  const MORPH_MAX_MS = 3000;

  /* The legacy rule: anything of the old page that animates per frame or re-draws per tick keeps the loop
     continuous. PULSE is false under prefers-reduced-motion, when the halos stand still. */
  function legacyAnimators(s) {
    if (!s) return false;
    const pulse = s.pulse === true && ((Number(s.halos) || 0) > 0 || (Number(s.livePins) || 0) > 0);
    return pulse || s.dataLayersOn === true || s.intelOn === true || s.cctvOn === true || s.haloObjects === true;
  }

  function create(viewer, options) {
    const opts = options || {};
    const schedule = opts.setTimeout || ((fn, ms) => root.setTimeout(fn, ms));
    const unschedule = opts.clearTimeout || (id => root.clearTimeout(id));
    const now = opts.now || (() => Date.now());
    const scene = viewer.scene;
    let restoreMaxChange = scene.maximumRenderTimeChange;
    const holds = new Map();
    const recent = [];
    const removers = [];
    let enabled = false, destroyed = false;

    const requestFrame = () => { if (scene && typeof scene.requestRender === 'function') scene.requestRender(); };
    function apply() {
      if (!enabled) { if (scene.requestRenderMode !== false) scene.requestRenderMode = false; return; }
      const onDemand = holds.size === 0;
      if (scene.requestRenderMode !== onDemand) {
        scene.requestRenderMode = onDemand;
        /* the last release draws one settling frame, so nothing changed under a hold is left unpainted */
        if (onDemand) requestFrame();
      }
    }
    function hold(owner, maxMs) {
      if (!owner || destroyed) return;
      const previous = holds.get(owner);
      if (previous) unschedule(previous);
      let timer = null;
      if (Number.isFinite(maxMs) && maxMs > 0) timer = schedule(() => { if (holds.get(owner) === timer) { holds.delete(owner); apply(); } }, maxMs);
      holds.set(owner, timer);
      apply();
    }
    function release(owner) {
      if (!holds.has(owner)) return;
      const timer = holds.get(owner);
      if (timer) unschedule(timer);
      holds.delete(owner);
      apply();
    }
    function enable() {
      if (destroyed || enabled) return;
      enabled = true;
      /* Cesium's own value (0 by default) comes back on disable(), whatever the page set before */
      restoreMaxChange = scene.maximumRenderTimeChange;
      scene.maximumRenderTimeChange = IDLE_MAX_TIME_CHANGE;
      apply();
    }
    function disable() {
      enabled = false;
      for (const [owner, timer] of [...holds]) if (timer) { unschedule(timer); holds.delete(owner); }
      scene.requestRenderMode = false;
      scene.maximumRenderTimeChange = restoreMaxChange;
    }
    function requestRender(reason) {
      requestFrame();
      if (enabled && holds.size === 0) {
        recent.push({ reason: String(reason || 'unspecified'), at: now() });
        if (recent.length > RECENT_CAP) recent.shift();
      }
    }
    function listen(event, fn) {
      if (!event || typeof event.addEventListener !== 'function') return;
      event.addEventListener(fn);
      removers.push(() => { try { event.removeEventListener(fn); } catch (e) {} });
    }
    const camera = viewer.camera || {}, entities = viewer.entities || {}, imagery = viewer.imageryLayers || {}, primitives = scene.primitives || {};
    listen(camera.moveStart, () => hold('camera', CAMERA_SAFETY_MS));
    listen(camera.moveEnd, () => release('camera'));
    listen(scene.morphStart, () => hold('morph', MORPH_MAX_MS));
    listen(scene.morphComplete, () => release('morph'));
    /* the entity-based layers (missions, news, completed, audience, travel, labels), the primitive collections
       and the imagery layers draw themselves a frame on every change; nothing is recorded for these */
    for (const event of [entities.collectionChanged, primitives.primitiveAdded, primitives.primitiveRemoved, imagery.layerAdded, imagery.layerRemoved, imagery.layerMoved, imagery.layerShownOrHidden]) listen(event, requestFrame);

    const governor = Object.freeze({
      enable, disable, enabled: () => enabled, hold, release, requestRender,
      sync: (owner, on) => { if (on) hold(owner); else release(owner); },
      diagnostics: () => ({ enabled, mode: enabled && holds.size === 0 ? 'on-demand' : 'continuous', holds: [...holds.keys()].sort(), recentRequests: recent.slice(), maximumRenderTimeChange: scene.maximumRenderTimeChange }),
      destroy() { if (destroyed) return; disable(); removers.splice(0).forEach(fn => fn()); holds.clear(); recent.length = 0; destroyed = true; }
    });
    root.__mccGlobeGovernor = () => governor.diagnostics();
    return governor;
  }
  /* THE CAMERA GUARD (the slice G1 integration pass saw it on the real page in two of five runs; the review could not reproduce it;
     review G1R-12): Cesium 1.131's zoom toward the cursor rotates the camera about cross(pickedNormal, centreNormal). With the
     pointer at the exact centre pixel the two picks coincide, the axis is the zero vector, Camera.rotate normalises it into NaN
     and the render loop stops ("An error occurred while rendering. Rendering has stopped"). A rotation about a zero-length axis,
     or by a non-finite angle, is no rotation: it is skipped and the globe keeps drawing. Defensive, per viewer, idempotent; it is
     Cesium's defect, not the slice's, and is not claimed as one. */
  function guardCamera(viewer) {
    const camera = viewer && viewer.camera;
    if (!camera || typeof camera.rotate !== 'function' || camera.__mccRotateGuarded) return false;
    const rotate = camera.rotate.bind(camera);
    camera.rotate = function (axis, angle) {
      const finite = !!axis && Number.isFinite(axis.x) && Number.isFinite(axis.y) && Number.isFinite(axis.z);
      if (!finite || !(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z > 0) || (angle !== undefined && !Number.isFinite(angle))) return undefined;
      return rotate(axis, angle);
    };
    camera.__mccRotateGuarded = true;
    return true;
  }
  root.MCC_GLOBE_GOVERNOR = Object.freeze({ create, legacyAnimators, guardCamera, IDLE_MAX_TIME_CHANGE });
})(window);
