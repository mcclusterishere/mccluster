/* ============================================================
   OVH — the VPS that runs Core.

   Core is the persistent execution half of the plane: Cloudflare is
   ingress, Supabase is truth, and the host is where long work actually
   runs. Until now nothing in the backend could see whether that host
   was up, let alone act on it — the owner had to open the OVH panel.

   OVH signs every call: SHA-1 over
   secret + "+" + consumerKey + "+" + method + "+" + url + "+" + body + "+" + timestamp
   with the timestamp taken from OVH's own clock, because the API rejects
   a request whose timestamp has drifted. Workers have no wall-clock
   guarantee relative to OVH, so the drift is measured once and reused.

   Power actions (reboot, stop) are `infra.mutate`: stopping this host
   stops the company's execution layer, so it takes a human approval.
   Snapshot and start are `infra.operate` — the first is how you make a
   reboot reversible, and the second only ever makes the house more alive.
   ============================================================ */

import { clampInt, notConfigured, opsError, providerFetch, text } from '../lib.js';

const ENDPOINTS = {
  'ovh-eu': 'https://eu.api.ovh.com/1.0',
  'ovh-ca': 'https://ca.api.ovh.com/1.0',
  'ovh-us': 'https://api.us.ovhcloud.com/1.0',
  'kimsufi-eu': 'https://eu.api.kimsufi.com/1.0',
  'soyoustart-eu': 'https://eu.api.soyoustart.com/1.0'
};

let driftMs = null;

export function configured(env) {
  return Boolean(env.OVH_APPLICATION_KEY && env.OVH_APPLICATION_SECRET && env.OVH_CONSUMER_KEY);
}

export function baseUrl(env) {
  const key = text(env.OVH_ENDPOINT, 40) || 'ovh-eu';
  const base = ENDPOINTS[key];
  if (!base) {
    throw opsError('OVH_ENDPOINT is not a known OVH region', 500, {
      code: 'invalid_configuration', allowed: Object.keys(ENDPOINTS)
    });
  }
  return base;
}

async function sha1Hex(value) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* OVH publishes its own clock unauthenticated. One reading is enough:
   the offset between this isolate and OVH does not move, and asking on
   every call would double the request count for no accuracy. */
async function ovhNow(env) {
  if (driftMs === null) {
    try {
      const res = await fetch(`${baseUrl(env)}/auth/time`);
      const remote = Number(await res.text());
      driftMs = Number.isFinite(remote) ? remote * 1000 - Date.now() : 0;
    } catch {
      driftMs = 0;
    }
  }
  return Math.floor((Date.now() + driftMs) / 1000);
}

export async function signature(env, method, url, body, timestamp) {
  const raw = [
    env.OVH_APPLICATION_SECRET,
    env.OVH_CONSUMER_KEY,
    method,
    url,
    body || '',
    timestamp
  ].join('+');
  return `$1$${await sha1Hex(raw)}`;
}

async function call(env, method, path, payload) {
  if (!configured(env)) {
    throw notConfigured('OVH', ['OVH_APPLICATION_KEY', 'OVH_APPLICATION_SECRET', 'OVH_CONSUMER_KEY']);
  }
  const url = `${baseUrl(env)}${path}`;
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const timestamp = await ovhNow(env);
  const { body: result } = await providerFetch('OVH', url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-ovh-application': env.OVH_APPLICATION_KEY,
      'x-ovh-consumer': env.OVH_CONSUMER_KEY,
      'x-ovh-timestamp': String(timestamp),
      'x-ovh-signature': await signature(env, method, url, body, timestamp)
    },
    ...(body ? { body } : {})
  });
  return result;
}

function serviceName(node, env) {
  const name = text(node?.provider_ref, 120) || text(env.OVH_VPS_SERVICE_NAME, 120);
  if (!name) {
    throw opsError(
      'This host node has no OVH service name yet',
      400,
      {
        code: 'host_not_bound',
        hint: 'Run vps.list to see the account, then ops.estate.upsert to bind provider_ref to the serviceName.'
      }
    );
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw opsError('OVH service name is invalid', 400, { code: 'invalid_service_name' });
  return name;
}

export async function listVps(env, _node, _params, { estate } = {}) {
  const names = await call(env, 'GET', '/vps');
  const bound = new Set(
    (estate || []).filter((node) => node.provider === 'ovh' && node.provider_ref).map((node) => node.provider_ref)
  );
  const details = await Promise.all(
    (Array.isArray(names) ? names : []).slice(0, 20).map(async (name) => {
      const info = await call(env, 'GET', `/vps/${encodeURIComponent(name)}`).catch(() => null);
      return {
        service_name: name,
        registered_in_estate: bound.has(name),
        display_name: info?.displayName || null,
        state: info?.state || null,
        offer: info?.offerType || info?.model?.name || null,
        zone: info?.zone || null
      };
    })
  );
  return { count: Array.isArray(names) ? names.length : 0, vps: details };
}

export async function vpsState(env, node) {
  const name = serviceName(node, env);
  const [info, disks, image, tasks] = await Promise.all([
    call(env, 'GET', `/vps/${encodeURIComponent(name)}`),
    call(env, 'GET', `/vps/${encodeURIComponent(name)}/disks`).catch(() => null),
    call(env, 'GET', `/vps/${encodeURIComponent(name)}/currentImage`).catch(() => null),
    call(env, 'GET', `/vps/${encodeURIComponent(name)}/tasks`).catch(() => null)
  ]);
  return {
    service_name: name,
    state: info?.state || null,
    /* `state` is OVH's word for powered on. Anything else is the single
       most important fact on the whole operations board, because Core
       stops existing when it is not "running". */
    running: String(info?.state || '').toLowerCase() === 'running',
    display_name: info?.displayName || null,
    offer: info?.offerType || null,
    zone: info?.zone || null,
    cluster: info?.cluster || null,
    vcore: info?.vcore ?? null,
    memory_mb: info?.memoryLimit ?? null,
    netboot: info?.netbootMode || null,
    image: image ? { id: image.id, name: image.name } : null,
    disk_ids: Array.isArray(disks) ? disks : [],
    open_task_ids: Array.isArray(tasks) ? tasks : []
  };
}

export async function monitoring(env, node, params) {
  const name = serviceName(node, env);
  const period = ['lastday', 'lastweek', 'lastmonth', 'lastyear', 'today'].includes(text(params?.period, 20))
    ? params.period : 'lastday';
  const types = ['cpu:max', 'mem:max', 'net:rx', 'net:tx'];
  const wanted = text(params?.type, 20) ? [text(params.type, 20)] : types;
  const series = await Promise.all(wanted.map(async (type) => {
    const data = await call(
      env, 'GET',
      `/vps/${encodeURIComponent(name)}/monitoring?period=${encodeURIComponent(period)}&type=${encodeURIComponent(type)}`
    ).catch(() => null);
    const points = Array.isArray(data?.values) ? data.values.filter((p) => Number.isFinite(p?.value)) : [];
    const values = points.map((p) => p.value);
    return {
      type,
      unit: data?.unit || null,
      points: points.length,
      latest: values.length ? values[values.length - 1] : null,
      peak: values.length ? Math.max(...values) : null,
      mean: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : null
    };
  }));
  return { service_name: name, period, series };
}

export async function tasks(env, node) {
  const name = serviceName(node, env);
  const ids = await call(env, 'GET', `/vps/${encodeURIComponent(name)}/tasks`);
  const details = await Promise.all(
    (Array.isArray(ids) ? ids : []).slice(0, 10).map((id) =>
      call(env, 'GET', `/vps/${encodeURIComponent(name)}/tasks/${encodeURIComponent(id)}`).catch(() => ({ id }))
    )
  );
  return {
    service_name: name,
    tasks: details.map((task) => ({
      id: task.id, type: task.type || null, state: task.state || null,
      progress: task.progress ?? null, started_at: task.startDate || null
    }))
  };
}

export async function createSnapshot(env, node, params) {
  const name = serviceName(node, env);
  const result = await call(env, 'POST', `/vps/${encodeURIComponent(name)}/createSnapshot`, {
    description: text(params?.description, 200) || 'McCluster control plane snapshot'
  });
  return { service_name: name, task_id: result?.id || null, state: result?.state || null };
}

async function power(env, node, verb) {
  const name = serviceName(node, env);
  const result = await call(env, 'POST', `/vps/${encodeURIComponent(name)}/${verb}`);
  return { service_name: name, action: verb, task_id: result?.id || null, state: result?.state || null };
}

export function start(env, node) { return power(env, node, 'start'); }
export function reboot(env, node) { return power(env, node, 'reboot'); }
export function stop(env, node) { return power(env, node, 'stop'); }

export function __resetDrift() { driftMs = null; }
export const __limits = { clampInt };
