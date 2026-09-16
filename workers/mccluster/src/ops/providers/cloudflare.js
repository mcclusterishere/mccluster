/* ============================================================
   CLOUDFLARE — the edge.

   Reads are broad (what Workers exist, what is deployed, what the zone
   resolves to, what storage the account holds). Writes are narrow and
   deliberately few, because the two Cloudflare changes that can take
   the house off the air are a Worker rollback and a DNS record — both
   are `infra.mutate`, so both cross a human approval.

   Deliberately absent: deploying a Worker. Worker code ships from
   `workers/mccluster` through `npx wrangler deploy` against a reviewed
   commit, and giving the backend a second, unreviewed path to replace
   its own running code would be exactly the "competing backend" AGENTS.md
   forbids. Rolling back to a version that was already reviewed and
   deployed is the recovery lever; uploading new script bytes is not.
   ============================================================ */

import { clampInt, notConfigured, opsError, providerFetch, text } from '../lib.js';

const API = 'https://api.cloudflare.com/client/v4';

export function configured(env) {
  return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
}

function headers(env) {
  if (!configured(env)) {
    throw notConfigured('Cloudflare', ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
  }
  return {
    authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    'content-type': 'application/json'
  };
}

/* Cloudflare answers 200 with `success:false` for real failures, so an
   ok HTTP status is not an ok result here. */
async function call(env, path, init = {}) {
  const { body } = await providerFetch('Cloudflare', `${API}${path}`, {
    ...init,
    headers: { ...headers(env), ...(init.headers || {}) }
  });
  if (body && body.success === false) {
    throw opsError('Cloudflare rejected the request', 400, {
      code: 'provider_error',
      provider: 'Cloudflare',
      errors: Array.isArray(body.errors) ? body.errors.slice(0, 5) : null
    });
  }
  return body?.result !== undefined ? body.result : body;
}

function account(env) {
  return env.CLOUDFLARE_ACCOUNT_ID;
}

function workerName(node, env) {
  const name = text(node?.provider_ref || node?.node_key, 120) || text(env.CLOUDFLARE_WORKER_NAME, 120) || 'mccluster';
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw opsError('Estate node does not name a Cloudflare Worker', 400, { code: 'node_not_a_worker' });
  }
  return name;
}

/* A zone node carries the zone id once it is known; before that, the
   name is resolved against the account and cached back by the caller. */
async function zoneId(env, node) {
  const fromNode = text(node?.metadata?.zone_id, 40);
  if (fromNode) return fromNode;
  const configuredZone = text(env.CLOUDFLARE_ZONE_ID, 40);
  const name = text(node?.provider_ref || node?.node_key, 200);
  if (!name && configuredZone) return configuredZone;
  const zones = await call(env, `/zones?name=${encodeURIComponent(name)}&account.id=${encodeURIComponent(account(env))}`);
  const id = Array.isArray(zones) ? zones[0]?.id : null;
  if (!id) {
    if (configuredZone) return configuredZone;
    throw opsError('Cloudflare zone not found', 404, { code: 'zone_not_found', zone: name });
  }
  return id;
}

export async function accountState(env) {
  const workers = await call(env, `/accounts/${account(env)}/workers/scripts`);
  return {
    account_id: account(env),
    workers: (Array.isArray(workers) ? workers : []).map((w) => ({
      name: w.id, modified_on: w.modified_on, usage_model: w.usage_model || null
    })),
    /* AGENTS.md rule 9 in data form: if a second Worker with a forbidden
       name ever appears on the account, the board says so instead of an
       agent discovering it months later. */
    forbidden_present: (Array.isArray(workers) ? workers : [])
      .map((w) => w.id)
      .filter((name) => ['mccluster-core', 'here-agent-platform'].includes(String(name).toLowerCase()))
  };
}

export async function workerState(env, node) {
  const name = workerName(node, env);
  const [script, deployments, domains] = await Promise.all([
    call(env, `/accounts/${account(env)}/workers/services/${encodeURIComponent(name)}`).catch(() => null),
    call(env, `/accounts/${account(env)}/workers/scripts/${encodeURIComponent(name)}/deployments`).catch(() => null),
    call(env, `/accounts/${account(env)}/workers/domains?service=${encodeURIComponent(name)}`).catch(() => null)
  ]);
  const latest = Array.isArray(deployments?.deployments) ? deployments.deployments[0] : null;
  return {
    worker: name,
    environments: Array.isArray(script?.environments)
      ? script.environments.map((e) => ({ environment: e.environment, modified_on: e.modified_on }))
      : [],
    current_deployment: latest ? {
      id: latest.id,
      created_on: latest.created_on,
      source: latest.source || null,
      versions: (latest.versions || []).map((v) => ({ version_id: v.version_id, percentage: v.percentage }))
    } : null,
    custom_domains: (Array.isArray(domains) ? domains : []).map((d) => ({ hostname: d.hostname, zone_name: d.zone_name }))
  };
}

export async function workerDeployments(env, node, params) {
  const name = workerName(node, env);
  const limit = clampInt(params.limit, 10, 1, 50);
  const result = await call(env, `/accounts/${account(env)}/workers/scripts/${encodeURIComponent(name)}/deployments`);
  const list = Array.isArray(result?.deployments) ? result.deployments : [];
  return {
    worker: name,
    deployments: list.slice(0, limit).map((d) => ({
      id: d.id, created_on: d.created_on, author_email: d.author_email || null,
      message: d.annotations?.['workers/message'] || null,
      versions: (d.versions || []).map((v) => v.version_id)
    }))
  };
}

export async function listDns(env, node, params) {
  const zone = await zoneId(env, node);
  const query = new URLSearchParams({ per_page: '100' });
  if (params?.name) query.set('name', text(params.name, 250));
  if (params?.type) query.set('type', text(params.type, 10).toUpperCase());
  const records = await call(env, `/zones/${zone}/dns_records?${query}`);
  return {
    zone_id: zone,
    records: (Array.isArray(records) ? records : []).map((r) => ({
      id: r.id, name: r.name, type: r.type, content: r.content, proxied: r.proxied, ttl: r.ttl
    }))
  };
}

export async function listStorage(env) {
  const id = account(env);
  const [kv, r2, d1] = await Promise.all([
    call(env, `/accounts/${id}/storage/kv/namespaces?per_page=100`).catch(() => null),
    call(env, `/accounts/${id}/r2/buckets`).catch(() => null),
    call(env, `/accounts/${id}/d1/database?per_page=100`).catch(() => null)
  ]);
  return {
    kv_namespaces: (Array.isArray(kv) ? kv : []).map((n) => ({ id: n.id, title: n.title })),
    r2_buckets: (Array.isArray(r2?.buckets) ? r2.buckets : []).map((b) => ({ name: b.name, created: b.creation_date })),
    d1_databases: (Array.isArray(d1) ? d1 : []).map((d) => ({ uuid: d.uuid, name: d.name, version: d.version }))
  };
}

export async function purgeCache(env, node, params) {
  const zone = await zoneId(env, node);
  const files = Array.isArray(params.files) ? params.files.map((f) => text(f, 500)).filter(Boolean).slice(0, 30) : [];
  if (!files.length && params.everything !== true) {
    throw opsError('purge needs files, or everything:true', 400, { code: 'missing_parameter', parameter: 'files' });
  }
  const payload = files.length ? { files } : { purge_everything: true };
  await call(env, `/zones/${zone}/purge_cache`, { method: 'POST', body: JSON.stringify(payload) });
  return { zone_id: zone, purged: files.length ? files.length : 'everything' };
}

export async function rollbackWorker(env, node, params) {
  const name = workerName(node, env);
  const versionId = text(params.version_id, 80);
  if (!/^[0-9a-f-]{16,64}$/i.test(versionId)) {
    throw opsError('version_id is required', 400, { code: 'missing_parameter', parameter: 'version_id' });
  }
  const result = await call(env, `/accounts/${account(env)}/workers/scripts/${encodeURIComponent(name)}/deployments?force=true`, {
    method: 'POST',
    body: JSON.stringify({
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
      annotations: {
        'workers/message': text(params.message, 200) || 'Rollback from the McCluster control plane',
        'workers/triggered_by': 'rollback'
      }
    })
  });
  return { worker: name, deployment_id: result?.id || null, version_id: versionId };
}

export async function upsertDns(env, node, params) {
  const zone = await zoneId(env, node);
  const name = text(params.name, 250);
  const type = text(params.type, 10).toUpperCase();
  const content = text(params.content, 500);
  if (!name || !type || !content) {
    throw opsError('name, type and content are required', 400, { code: 'missing_parameter' });
  }
  const existing = await call(env, `/zones/${zone}/dns_records?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`);
  const current = Array.isArray(existing) ? existing[0] : null;
  const payload = {
    name, type, content,
    ttl: clampInt(params.ttl, 1, 1, 86_400),
    ...(params.proxied === undefined ? {} : { proxied: params.proxied === true })
  };
  const result = current
    ? await call(env, `/zones/${zone}/dns_records/${current.id}`, { method: 'PUT', body: JSON.stringify(payload) })
    : await call(env, `/zones/${zone}/dns_records`, { method: 'POST', body: JSON.stringify(payload) });
  return {
    zone_id: zone, record_id: result?.id || null, name, type, content,
    replaced: Boolean(current),
    /* The previous value is the only thing that makes this reversible
       by hand at 3am, so it goes into the audit result. */
    previous_content: current?.content || null
  };
}
