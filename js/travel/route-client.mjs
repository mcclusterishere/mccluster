import { normalizeRouteRequest, normalizeRoute, boundedJson } from './route-core.mjs';

// POST keeps precise endpoints out of request URLs, browser history and click
// telemetry. The Worker forwards only coordinates, never identity or trip text.
export async function fetchRoute(input, { signal, request = fetch } = {}) {
  const body = normalizeRouteRequest(input);
  const controller = new AbortController(), cancel = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Directions cancelled', 'AbortError');
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 18000);
  try {
    const response = await request('https://api.mccluster.org/v1/travel/route', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'origin', cache: 'no-store'
    });
    controller.signal.throwIfAborted();
    let data;
    try { data = await boundedJson(response); }
    catch (error) { if (response.ok) throw error; }
    controller.signal.throwIfAborted();
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error.slice(0, 400) : 'Street directions are unavailable. Please try again.';
      throw Object.assign(new Error(message), { status: response.status, retryAfter: Math.min(86400, Math.max(0, Number(data?.retryAfter) || Number(response.headers.get('retry-after')) || 0)) });
    }
    const route = normalizeRoute(data?.route);
    if (route.mode !== body.mode || route.origin.some((v, i) => v !== body.origin[i]) || route.destination.some((v, i) => v !== body.destination[i])) {
      throw new Error('Those directions belong to a different trip. Please try again.');
    }
    controller.signal.throwIfAborted();
    return route;
  } catch (error) {
    if (timedOut && !signal?.aborted) throw new Error('Street directions took too long. Please try again.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
