const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

function timeoutMs(value, fallback = 2_500) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(250, Math.min(15_000, n)) : fallback;
}

export function assertLoopbackUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Engine probe must use HTTP(S)');
  if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error('Engine probes must target loopback only');
  return url;
}

export async function probeHttpExecutor(executor, fetchImpl = fetch) {
  const target = executor.health_url || executor.url;
  if (!target) return { healthy: false, reason: 'missing executor url' };
  let url;
  try { url = assertLoopbackUrl(target); }
  catch (error) { return { healthy: false, reason: error.message }; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(executor.health_timeout_ms));
  try {
    const method = String(executor.health_method || 'GET').toUpperCase();
    const res = await fetchImpl(url, {
      method,
      headers: { accept: 'application/json', ...(executor.health_headers || {}) },
      signal: controller.signal
    });
    return {
      healthy: res.ok,
      status: res.status,
      reason: res.ok ? null : `HTTP ${res.status}`,
      checked_at: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      status: null,
      reason: error.name === 'AbortError' ? 'probe timeout' : String(error.message || error),
      checked_at: new Date().toISOString()
    };
  } finally { clearTimeout(timer); }
}

export async function probeExecutors(manifest, fetchImpl = fetch) {
  const health = new Map();
  const implementations = [...manifest.executors.entries()];
  await Promise.all(implementations.map(async ([implementation, executor]) => {
    if (!executor || executor.type !== 'http') {
      health.set(implementation, { healthy: false, reason: `unsupported executor type: ${executor?.type || 'missing'}` });
      return;
    }
    if (executor.healthcheck === false) {
      health.set(implementation, { healthy: true, reason: 'healthcheck disabled by node owner', checked_at: new Date().toISOString() });
      return;
    }
    health.set(implementation, await probeHttpExecutor(executor, fetchImpl));
  }));
  return health;
}

export function healthyCapabilities(manifest, health) {
  return manifest.publicCapabilities.filter((capability) => health.get(capability.implementation)?.healthy === true);
}

export function engineHealthSummary(health) {
  return [...health.entries()].map(([implementation, result]) => ({ implementation, ...result }));
}
