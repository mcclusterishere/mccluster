/* ============================================================
   /v1/ops — THE OPERATIONS SURFACE.

   The house could already answer "am I up?". This is how it answers
   "change something", with the same authority, audit and approval
   contract for a cache purge as for a host reboot.

   Request shape is the same for every action, which is the point: one
   client (the console, an MCP model, curl at 3am) learns one envelope
   and gets the whole estate.

     POST /v1/ops/run
     { "action": "site.deploy",
       "params": { "node_key": "matthew.mccluster.org" },
       "idempotency_key": "optional, makes a retry safe",
       "approval_id": "required for infra.mutate",
       "dry_run": true }

   Ordering inside a run is deliberate and worth keeping:

     actor -> policy -> hash -> replay -> authorize -> record -> execute -> finish

   Authorization happens before the provider is touched, the command is
   written down before the provider is touched, and the result is written
   down after. A crash anywhere after `record` leaves an `allowed` row with
   no finish — which is exactly what an operator needs to see, rather than
   silence.
   ============================================================ */

import { fail, logEvent, reply } from '../lib/http.js';
import { ACTION_LIST, getAction } from './catalog.js';
import { actionOrThrow, execute, providerStatus, resolveTarget, targetKey } from './actions.js';
import { loadActionPolicy, loadEstate } from './estate.js';
import {
  authorize, decideApproval, findReplay, finishCommand, listApprovals, listCommands,
  recordCommand, requestApproval, requestHash, resolveActor
} from './authority.js';
import { opsError, text, truncate } from './lib.js';

const MAX_BODY = 512 * 1024;

async function readJson(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
    throw opsError('payload too large', 413, { code: 'payload_too_large' });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw opsError('payload too large', 413, { code: 'payload_too_large' });
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw opsError('invalid json', 400, { code: 'invalid_json' }); }
}

/* The resource an approval binds to. It is derived from what was asked
   for, not from what the estate resolved to, so the hash can be computed
   before any database read and stays identical between the approval
   request and the run that uses it. */
function resourceOf(action, params, env) {
  return {
    type: action.target || action.domain,
    id: targetKey(action, params, env)
  };
}

async function policyFor(env, action) {
  const policy = await loadActionPolicy(env);
  const row = policy.get(action.id);
  if (!row) {
    throw opsError('That action is not enabled on this control plane', 403, {
      code: 'action_not_in_policy',
      action: action.id,
      hint: 'ops_action_policy has no row for it. The database, not the code, decides what may run.'
    });
  }
  if (row.enabled === false) {
    throw opsError('That action is switched off on this control plane', 403, {
      code: 'action_disabled', action: action.id
    });
  }
  /* The database's capability wins over the catalogue's. If an owner
     promotes an action to a higher rung in ops_action_policy, that takes
     effect immediately and without a deploy. */
  return row;
}

export async function runAction(request, env, {
  actor, actionId, params = {}, idempotencyKey = null, approvalId = null, dryRun = false, actorKind = 'human'
}) {
  const action = actionOrThrow(actionId);
  const policy = await policyFor(env, action);
  const capability = policy.capability || action.capability;
  const resource = resourceOf(action, params, env);
  const hash = await requestHash({ actionId: action.id, nodeKey: resource.id, params });

  /* A retry with the same key does not run again. Losing a response to a
     reboot must not cost a second reboot. */
  if (idempotencyKey && !dryRun) {
    const previous = await findReplay(env, actor.orgId, idempotencyKey);
    if (previous && ['executed', 'failed'].includes(previous.status)) {
      return {
        status: 200,
        body: {
          ok: previous.status === 'executed',
          replayed: true,
          action: action.id,
          command_id: previous.id,
          result: previous.result ?? null,
          error: previous.error ?? null
        }
      };
    }
  }

  await authorize(env, {
    actor: { ...actor, actorKind },
    capability,
    resourceType: resource.type,
    resourceId: resource.id,
    hash,
    approvalId
  });

  if (dryRun) {
    /* A dry run proves the gate and the target without touching the
       provider: it is how an operator checks that an approval matches
       before spending it. */
    const node = await resolveTarget(env, action, params).catch((error) => ({ error: error.message }));
    return {
      status: 200,
      body: {
        ok: true,
        dry_run: true,
        action: action.id,
        capability,
        mutates: Boolean(policy.mutates ?? action.mutates),
        request_hash: hash,
        resource,
        target: node && !node.error
          ? { kind: node.kind, node_key: node.node_key, provider: node.provider, provider_ref: node.provider_ref }
          : node,
        would_execute: true
      }
    };
  }

  const commandId = await recordCommand(env, {
    actor: { ...actor, actorKind },
    capability,
    actionId: action.id,
    resourceType: resource.type,
    resourceId: resource.id,
    hash,
    idempotencyKey,
    approvalId,
    status: 'allowed',
    metadata: { params: truncate(params, 4000), domain: action.domain }
  }).catch((error) => {
    logEvent('error', { event: 'ops_command_record_failed', action: action.id, message: error.message });
    return null;
  });

  const startedAt = Date.now();
  try {
    const result = await execute(action, { env, actor, params });
    await finishCommand(env, commandId, 'executed', result);
    logEvent('info', {
      event: 'ops_action_executed', action: action.id, capability,
      resource: `${resource.type}:${resource.id}`, elapsed_ms: Date.now() - startedAt
    });
    return {
      status: 200,
      body: { ok: true, action: action.id, capability, command_id: commandId, elapsed_ms: Date.now() - startedAt, result }
    };
  } catch (error) {
    await finishCommand(env, commandId, 'failed', null, error?.message);
    logEvent('error', {
      event: 'ops_action_failed', action: action.id, capability,
      resource: `${resource.type}:${resource.id}`, status: error?.status || 500,
      message: error instanceof Error ? error.message : String(error)
    });
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      status: error?.status || 500,
      detail: { ...(error?.detail || {}), command_id: commandId, action: action.id }
    });
  }
}

/* The board. One call that says whether each layer of the house is
   answering, assembled from the same audited read actions the operator
   would otherwise run one at a time. Every probe fails alone: an
   unconfigured provider or a dead API greys one panel instead of
   blanking the whole thing. */
async function estateState(request, env, actor) {
  const providers = providerStatus(env);
  const wanted = [
    ['sites', 'site.estate.probe', {}],
    ['worker', 'cloudflare.worker.state', {}],
    ['edge', 'cloudflare.account.state', {}],
    ['database', 'supabase.project.state', {}],
    ['migrations', 'supabase.migrations.list', { limit: 5 }],
    ['host', 'vps.state', {}],
    ['control_repo', 'github.repo.state', { node_key: 'mcclusterishere/mccluster' }],
    ['core_queue', 'core.jobs.list', { limit: 10 }]
  ];

  const panels = await Promise.all(wanted.map(async ([key, actionId, params]) => {
    const action = getAction(actionId);
    const provider = action?.domain === 'ovh' ? 'ovh' : action?.domain;
    if (provider && providers[provider] && !providers[provider].configured) {
      return [key, { available: false, reason: 'provider_not_configured', required_secrets: providers[provider].required_secrets }];
    }
    try {
      const run = await runAction(request, env, { actor, actionId, params, actorKind: 'system' });
      return [key, { available: true, ...run.body.result }];
    } catch (error) {
      return [key, { available: false, reason: error?.detail?.code || 'error', message: text(error?.message, 300) }];
    }
  }));

  const estate = await loadEstate(env).catch(() => []);
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    operator: { id: actor.user.id, email: actor.user.email, role: actor.role },
    providers,
    estate: {
      nodes: estate.length,
      enabled: estate.filter((node) => node.enabled !== false).length,
      by_kind: estate.reduce((acc, node) => { acc[node.kind] = (acc[node.kind] || 0) + 1; return acc; }, {})
    },
    panels: Object.fromEntries(panels)
  };
}

function catalogBody(env) {
  const providers = providerStatus(env);
  return {
    ok: true,
    contract: 'mccluster-infrastructure-control/v1',
    authority: {
      capabilities: ['infra.read', 'infra.operate', 'infra.mutate'],
      note: 'infra.mutate is high risk: it needs a control_approvals row an owner approved, bound to the exact request hash.'
    },
    providers,
    actions: ACTION_LIST.map((action) => ({
      id: action.id,
      domain: action.domain,
      capability: action.capability,
      mutates: action.mutates,
      target: action.target || null,
      required: action.required || [],
      input: action.input,
      summary: action.summary,
      available: providers[action.domain === 'ovh' ? 'ovh' : action.domain]?.configured !== false
    }))
  };
}

export async function handleOpsRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/v1/ops' && !path.startsWith('/v1/ops/')) return null;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(request, env, 'McCluster is not configured', 503);
  }

  try {
    /* Even the catalogue is house-only. What the backend can reach is
       itself operational information. */
    const actor = await resolveActor(request, env);

    if (path === '/v1/ops' && request.method === 'GET') {
      return reply(request, env, { ...catalogBody(env), operator: { id: actor.user.id, role: actor.role } });
    }

    if (path === '/v1/ops/state' && request.method === 'GET') {
      return reply(request, env, await estateState(request, env, actor));
    }

    if (path === '/v1/ops/estate' && request.method === 'GET') {
      const run = await runAction(request, env, {
        actor,
        actionId: 'ops.estate.list',
        params: {
          kind: url.searchParams.get('kind') || undefined,
          provider: url.searchParams.get('provider') || undefined
        }
      });
      return reply(request, env, run.body, run.status);
    }

    if (path === '/v1/ops/run' && request.method === 'POST') {
      const body = await readJson(request);
      const run = await runAction(request, env, {
        actor,
        actionId: body.action,
        params: body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {},
        idempotencyKey: text(body.idempotency_key, 200) || null,
        approvalId: text(body.approval_id, 40) || null,
        dryRun: body.dry_run === true
      });
      return reply(request, env, run.body, run.status);
    }

    if (path === '/v1/ops/runs' && request.method === 'GET') {
      const rows = await listCommands(env, actor.orgId, {
        limit: url.searchParams.get('limit'),
        actionId: url.searchParams.get('action')
      });
      return reply(request, env, { ok: true, commands: rows });
    }

    if (path === '/v1/ops/approvals' && request.method === 'GET') {
      const rows = await listApprovals(env, actor.orgId, {
        state: url.searchParams.get('state') || 'pending',
        limit: url.searchParams.get('limit')
      });
      return reply(request, env, { ok: true, approvals: rows });
    }

    /* Asking for permission is a first-class call, and it takes the same
       action + params as the run itself so the operator never has to
       compute a hash by hand — get it wrong and the approval would not
       bind to anything. */
    if (path === '/v1/ops/approvals' && request.method === 'POST') {
      const body = await readJson(request);
      const action = actionOrThrow(body.action);
      const policy = await policyFor(env, action);
      const params = body.params && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : {};
      const resource = resourceOf(action, params, env);
      const hash = await requestHash({ actionId: action.id, nodeKey: resource.id, params });
      const approvalId = await requestApproval(request, env, {
        orgId: actor.orgId,
        capability: policy.capability || action.capability,
        resourceType: resource.type,
        resourceId: resource.id,
        hash,
        reason: body.reason,
        ttlSeconds: body.ttl_seconds
      });
      return reply(request, env, {
        ok: true,
        approval_id: approvalId,
        action: action.id,
        capability: policy.capability || action.capability,
        request_hash: hash,
        resource,
        next: 'An owner approves it with POST /v1/ops/approvals/{id}/decide, then re-run with approval_id set and identical params.'
      }, 201);
    }

    const decide = path.match(/^\/v1\/ops\/approvals\/([0-9a-f-]{36})\/decide$/i);
    if (decide && request.method === 'POST') {
      const body = await readJson(request);
      const state = text(body.state, 20);
      if (!['approved', 'denied'].includes(state)) {
        return fail(request, env, 'state must be approved or denied', 400, { code: 'invalid_parameter' });
      }
      const row = await decideApproval(request, env, { approvalId: decide[1], state });
      return reply(request, env, { ok: true, approval: row });
    }

    return fail(request, env, 'Not found', 404, { code: 'unknown_ops_route' });
  } catch (error) {
    const status = error?.status || 500;
    if (status >= 500) {
      logEvent('error', {
        event: 'ops_request_failed', path, method: request.method,
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return fail(request, env, error?.message || 'Operations request failed', status, error?.detail);
  }
}

export { policyFor, resourceOf };
