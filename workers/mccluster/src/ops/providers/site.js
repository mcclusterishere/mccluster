/* ============================================================
   THE SITES — the plane's own edge and every satellite's.

   A probe here is deliberately the naive thing a visitor does: one
   HTTPS request, follow the redirects, read what came back. Provider
   dashboards report their own health; this reports the only health
   that matters, which is whether the page answers.

   The build stamp is the honest deploy marker: every asset URL on a
   McCluster page carries `?v=<commit>` written in at publish time, so
   the bytes being served name the commit that produced them. Comparing
   that against the repository head is how the board can say "deployed"
   or "behind" without trusting a deployment record.
   ============================================================ */

import { clampInt, opsError, text } from '../lib.js';

const TIMEOUT_MS = 8000;

function originOf(node) {
  const ref = text(node?.provider_ref || node?.node_key, 250);
  if (!ref) throw opsError('Estate node has no address', 400, { code: 'node_has_no_origin' });
  const url = ref.startsWith('http') ? ref : `https://${ref}`;
  try { return new URL(url).origin; }
  catch { throw opsError('Estate node address is not a URL', 400, { code: 'node_has_no_origin', value: ref }); }
}

export function extractStamp(html) {
  const match = String(html || '').match(/(?:href|src)="[^"]*\?v=([A-Za-z0-9._-]{4,40})"/);
  const stamp = match?.[1];
  return !stamp || stamp === '__STAMP__' ? null : stamp;
}

export async function probe(env, node, params = {}) {
  const origin = originOf(node);
  const path = text(params.path, 300) || text(node?.metadata?.health_path, 300) || '/';
  const target = `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  const started = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'mccluster-control-plane', 'cache-control': 'no-cache' }
    });
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('text/html') || contentType.includes('json') ? await res.text() : '';
    return {
      node_key: node.node_key,
      url: target,
      ok: res.ok,
      status: res.status,
      final_url: res.url || target,
      redirected: res.url ? res.url.replace(/\/$/, '') !== target.replace(/\/$/, '') : false,
      content_type: contentType || null,
      /* A site can answer 200 and still be a stale or empty shell, so
         the size and the stamp travel with the status code. */
      bytes: body ? body.length : null,
      build_stamp: extractStamp(body),
      elapsed_ms: Date.now() - started
    };
  } catch (error) {
    return {
      node_key: node.node_key,
      url: target,
      ok: false,
      status: null,
      error: error?.name === 'AbortError' ? `no answer in ${TIMEOUT_MS}ms` : text(error?.message, 300),
      elapsed_ms: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeEstate(env, nodes, params = {}) {
  const limit = clampInt(params.limit, 20, 1, 40);
  const sites = nodes.filter((node) => node.kind === 'site' && node.enabled !== false).slice(0, limit);
  const results = await Promise.all(sites.map((node) => probe(env, node, {})));
  return {
    probed: results.length,
    up: results.filter((r) => r.ok).length,
    down: results.filter((r) => !r.ok).map((r) => r.node_key),
    results
  };
}

/* Deploying a site is not a separate mechanism from deploying anything
   else: it is the workflow the node names, dispatched on the branch the
   node names. The estate row is the binding, so adding a satellite to
   the deploy surface is a row, not a code change. */
export function deployBinding(node) {
  const deploy = node?.metadata?.deploy;
  if (!deploy?.repository || !deploy?.workflow) {
    throw opsError('This node has no deploy binding', 400, {
      code: 'no_deploy_binding',
      node_key: node?.node_key || null,
      hint: 'Set metadata.deploy = {repository, workflow, branch} with ops.estate.upsert.'
    });
  }
  return {
    repository: text(deploy.repository, 200),
    workflow: text(deploy.workflow, 200),
    branch: text(deploy.branch, 250) || 'main'
  };
}
