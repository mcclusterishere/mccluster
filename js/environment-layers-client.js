/* THE PUBLIC LAYER CLIENT: the six environmental layer routes of the McCluster Worker, fetched from inside the globe
   frame with no credential of any kind. The origin is a construction constant (never read from the page URL or a
   message), the request carries only an accept header, credentials are omitted, nothing is stored in the browser and
   nothing is kept across activations. The Worker's gate is honoured and shown honestly: 503 module_policy_unavailable
   or 404 module_disabled puts every layer in the 'policy' state at once, aborts what is still pending, arms no
   refresh timer (no retry loop against a disabled module) and tries again only on the next activation. A network
   failure or a timeout retries once after 5 s, then waits for the provider's refresh window. A refresh whose
   generated_at did not change hands nothing on, so geometry is rebuilt only when the data changed.
   Routes, schemas and windows: docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md. */
(function (root) {
  'use strict';
  const API_ORIGIN = 'https://api.mccluster.org';
  const BASE = '/v1/world/environment';
  const ROUTES = Object.freeze({
    fires: Object.freeze({ path: BASE + '/layers/fires', schema: 'world-environment-fires/v1', window: 1800 }),
    perimeters: Object.freeze({ path: BASE + '/layers/perimeters', schema: 'world-environment-perimeters/v1', window: 600 }),
    alerts: Object.freeze({ path: BASE + '/layers/alerts', schema: 'world-environment-alerts/v1', window: 120 }),
    eonet: Object.freeze({ path: BASE + '/layers/eonet', schema: 'world-environment-eonet/v1', window: 600 }),
    tides: Object.freeze({ path: BASE + '/layers/tides', schema: 'world-environment-tides/v1', window: 900 }),
    shakemap: Object.freeze({ path: null, schema: 'world-environment-shakemap/v1', window: 300 })
  });
  const LAYERS = Object.freeze(['fires', 'perimeters', 'alerts', 'eonet', 'tides']);
  const POLICY_CODES = Object.freeze(['module_policy_unavailable', 'module_disabled']);
  const EVENT_ID = /^[a-z]{2}[a-z0-9]{2,30}$/;
  const RETRY_MS = 5000, TIMEOUT_MS = 20000;
  const isoOrNull = v => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);

  /* a layer is available if any of its sources is, else stale if any is, else unavailable */
  function statusFromSources(sources) {
    const list = Array.isArray(sources) ? sources.filter(s => s && typeof s === 'object') : [];
    if (list.some(s => s.status === 'available')) return 'available';
    if (list.some(s => s.status === 'stale')) return 'stale';
    return 'unavailable';
  }

  function create(options) {
    const o = options || {};
    const fetchImpl = o.fetchImpl || ((url, init) => root.fetch(url, init));
    const schedule = o.setTimeout || ((fn, ms) => root.setTimeout(fn, ms));
    const unschedule = o.clearTimeout || (id => root.clearTimeout(id));
    const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : TIMEOUT_MS;
    const hidden = typeof o.hidden === 'function' ? o.hidden : () => false;
    let policy = null, active = false, generation = 0, callbacks = null;
    const pending = new Set(), timers = new Map(), lastGenerated = new Map(), shakemaps = new Map();

    const policyResult = () => ({ ok: false, status: 'policy', reason: policy.reason, http: policy.http });
    async function request(path, schema) {
      const controller = new AbortController();
      pending.add(controller);
      const timer = schedule(() => { controller.timedOut = true; controller.abort(); }, timeoutMs);
      try {
        let response;
        try {
          response = await fetchImpl(API_ORIGIN + path, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal });
        } catch (error) {
          if (controller.policyAborted && policy) return policyResult();
          return { ok: false, status: 'unavailable', reason: controller.timedOut ? 'timeout' : 'network', http: null };
        }
        const http = Number(response && response.status) || null;
        let body;
        try { body = await response.json(); } catch (e) { body = undefined; }
        /* the gate refused another layer while this body was being read (the abort lands in the read, not the fetch): one module
           policy governs every route, so this layer is in the policy state too, never 'unavailable http_503' beside it (review G1R-2) */
        if (policy) return policyResult();
        if (body && typeof body === 'object' && body.ok === false && POLICY_CODES.includes(body.code) && (http === 503 || http === 404)) return { ok: false, status: 'policy', reason: body.code, http };
        if (!response.ok) return { ok: false, status: 'unavailable', reason: 'http_' + http, http };
        if (!body || typeof body !== 'object' || body.ok !== true || body.schema !== schema) return { ok: false, status: 'unavailable', reason: 'bad_response', http };
        const first = Array.isArray(body.sources) ? body.sources.find(s => s && typeof s === 'object') : null;
        return { ok: true, status: statusFromSources(body.sources), http, body, fetched_at: first ? isoOrNull(first.fetched_at) : null, generated_at: isoOrNull(body.generated_at) };
      } finally {
        unschedule(timer);
        pending.delete(controller);
      }
    }
    function enterPolicy(result) {
      if (policy) return;
      policy = { reason: result.reason, http: result.http };
      for (const controller of [...pending]) { controller.policyAborted = true; controller.abort(); }
      for (const timer of timers.values()) unschedule(timer);
      timers.clear();
      if (callbacks) for (const layer of [...LAYERS, 'shakemap']) callbacks.onState(layer, policyResult());
    }
    async function fetchLayer(layer) {
      const route = ROUTES[layer];
      if (!route || !route.path) return { ok: false, status: 'unavailable', reason: 'invalid_layer', http: null };
      if (policy) return policyResult();
      const result = await request(route.path, route.schema);
      if (result.status === 'policy') enterPolicy(result);
      return result;
    }
    function arm(layer, ms, fn) {
      const previous = timers.get(layer);
      if (previous) unschedule(previous);
      const id = schedule(() => { timers.delete(layer); fn(); }, ms);
      timers.set(layer, id);
    }
    function emit(layer, result) { if (callbacks && active) callbacks.onState(layer, result); }
    async function run(layer, allowRetry) {
      if (!active || policy) return;
      const gen = generation;
      if (!lastGenerated.has(layer)) emit(layer, { ok: false, status: 'loading', reason: null, http: null });
      const result = await fetchLayer(layer);
      /* once the gate has refused, enterPolicy has already told every layer: nothing said after it may contradict that */
      if (!active || gen !== generation || result.status === 'policy' || policy) return;
      const windowMs = ROUTES[layer].window * 1000;
      if (!result.ok) {
        emit(layer, result);
        if (allowRetry && (result.reason === 'network' || result.reason === 'timeout')) arm(layer, RETRY_MS, () => run(layer, false));
        else arm(layer, windowMs, () => refresh(layer));
        return;
      }
      const changed = !lastGenerated.has(layer) || lastGenerated.get(layer) !== result.generated_at;
      lastGenerated.set(layer, result.generated_at);
      if (changed) { callbacks.onData(layer, result.body, result); emit(layer, result); }
      arm(layer, windowMs, () => refresh(layer));
    }
    function refresh(layer) {
      if (!active || policy) return;
      if (hidden()) { arm(layer, ROUTES[layer].window * 1000, () => refresh(layer)); return; }
      run(layer, true);
    }
    function start(handlers) {
      const h = handlers || {};
      callbacks = { onState: typeof h.onState === 'function' ? h.onState : () => {}, onData: typeof h.onData === 'function' ? h.onData : () => {} };
      stopTimers();
      active = true; generation += 1; policy = null;
      shakemaps.clear(); lastGenerated.clear();
      for (const layer of Array.isArray(h.layers) ? h.layers.filter(l => LAYERS.includes(l)) : LAYERS) run(layer, true);
    }
    function stopTimers() { for (const timer of timers.values()) unschedule(timer); timers.clear(); }
    function stop() {
      active = false; generation += 1; callbacks = null;
      for (const controller of [...pending]) controller.abort();
      stopTimers();
      shakemaps.clear(); lastGenerated.clear();
    }
    function shakemap(eventId) {
      const id = String(eventId === null || eventId === undefined ? '' : eventId).replace(/^usgs:/, '');
      if (!EVENT_ID.test(id)) return Promise.resolve({ ok: false, status: 'unavailable', reason: 'invalid_event', http: null, event_id: id });
      if (policy) return Promise.resolve(policyResult());
      if (shakemaps.has(id)) return shakemaps.get(id);
      const promise = request(BASE + '/quakes/' + id + '/shakemap', ROUTES.shakemap.schema).then(result => {
        if (result.status === 'policy') enterPolicy(result);
        if (!result.ok && shakemaps.get(id) === promise) shakemaps.delete(id);
        return result;
      });
      shakemaps.set(id, promise);
      return promise;
    }
    return Object.freeze({ fetchLayer, start, stop, shakemap, refresh, isPolicy: () => policy !== null, policy: () => (policy ? { ...policy } : null), active: () => active });
  }
  root.MCC_ENVIRONMENT_LAYERS_CLIENT = Object.freeze({ ROUTES, LAYERS, POLICY_CODES, create, statusFromSources });
})(window);
