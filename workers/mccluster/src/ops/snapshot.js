/* ============================================================
   THE UNATTENDED READING.

   Every five minutes the Worker's cron takes the same readings an
   operator would take by hand and writes them to ops_infra_snapshots.
   Nobody has to be watching for the house to notice that the site
   stopped answering, the host stopped running, or a Worker named
   `mccluster-core` appeared on the account.

   This path is read-only by construction. It calls provider read
   functions directly rather than going through runAction, because
   there is no human actor behind a cron and inventing one to satisfy
   an authorization check would weaken the check for everybody. Nothing
   reachable from here can change anything: the imports are the read
   halves of the adapters, and that is the whole security argument.
   ============================================================ */

import { loadEstate } from './estate.js';
import { providerStatus } from './actions.js';
import * as cloudflare from './providers/cloudflare.js';
import * as supabase from './providers/supabase-admin.js';
import * as ovh from './providers/ovh.js';
import * as site from './providers/site.js';
import { text } from './lib.js';

async function attempt(name, fn) {
  try {
    return [name, { ok: true, ...(await fn()) }];
  } catch (error) {
    return [name, { ok: false, code: error?.detail?.code || 'error', message: text(error?.message, 300) }];
  }
}

export async function captureEstateSnapshot(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const providers = providerStatus(env);
  const nodes = await loadEstate(env, { force: true });
  const worker = nodes.find((node) => node.kind === 'worker' && node.enabled !== false) || null;
  const host = nodes.find((node) => node.kind === 'host' && node.enabled !== false) || null;

  const readings = await Promise.all([
    attempt('sites', () => site.probeEstate(env, nodes, { limit: 12 })),
    providers.cloudflare.configured
      ? attempt('edge', () => cloudflare.accountState(env))
      : Promise.resolve(['edge', { ok: false, code: 'provider_not_configured' }]),
    providers.cloudflare.configured && worker
      ? attempt('worker', () => cloudflare.workerState(env, worker))
      : Promise.resolve(['worker', { ok: false, code: 'provider_not_configured' }]),
    providers.supabase.configured
      ? attempt('database', () => supabase.projectState(env))
      : Promise.resolve(['database', { ok: false, code: 'provider_not_configured' }]),
    providers.ovh.configured && host
      ? attempt('host', () => ovh.vpsState(env, host))
      : Promise.resolve(['host', { ok: false, code: 'provider_not_configured' }])
  ]);

  const snapshot = Object.fromEntries(readings);

  /* What "ok" means for the whole house, decided in one place so the
     board, the alert and the history cannot disagree: every site that
     is supposed to answer answers, the host is running if we can see
     it, and no forbidden Worker exists on the account. */
  const sitesDown = snapshot.sites?.ok ? (snapshot.sites.down || []) : [];
  const forbidden = snapshot.edge?.ok ? (snapshot.edge.forbidden_present || []) : [];
  const hostStopped = snapshot.host?.ok ? snapshot.host.running === false : false;
  const ok = sitesDown.length === 0 && forbidden.length === 0 && !hostStopped;

  const orgRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const orgRows = orgRes.ok ? await orgRes.json().catch(() => []) : [];
  const orgId = Array.isArray(orgRows) ? orgRows[0]?.id || null : null;

  const row = {
    org_id: orgId,
    source: 'worker-cron',
    ok,
    snapshot: {
      checked_at: new Date().toISOString(),
      providers,
      estate_nodes: nodes.length,
      concerns: {
        sites_down: sitesDown,
        forbidden_workers: forbidden,
        host_stopped: hostStopped
      },
      readings: snapshot
    }
  };

  await fetch(`${env.SUPABASE_URL}/rest/v1/ops_infra_snapshots`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!ok) {
    console.error(JSON.stringify({
      level: 'error', service: 'mccluster', event: 'ops_estate_degraded',
      sites_down: sitesDown, forbidden_workers: forbidden, host_stopped: hostStopped
    }));
  }

  return row;
}
