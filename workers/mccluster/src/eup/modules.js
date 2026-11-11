/* E=Up → Modules: persisted install / enable / drain / disable for the product modules McCluster runs.
   Reached only through ./router.js after the verified house-owner check. The four service-only RPCs in
   supabase/pending/eup_module_policy_v1.sql recheck house ownership, the expected revision and the
   idempotency key in their own transaction; the acting owner is always the verified session user and is
   never read from a request body. This file creates no permission, holds no state and caches nothing:
   every request reads the policy again.

   It is also the ONE mapping of the module-policy SQLSTATEs (EUM00..EUM07) for the Worker. Other sections
   import MODULE_POLICY_ERRORS / modulePolicyRefusal instead of keeping a copy. */
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MAX_BODY_BYTES = 4096;
const PENDING_FILE = 'eup_module_policy_v1.sql';

export const MODULE_POLICY_SCHEMA = 'equity-uprise.module-policy/v1';
export const MODULE_INSTALLATION = 'mccluster';
export const MODULE_IDS = Object.freeze(['environment', 'league', 'intake']);
export const MODULE_STATES = Object.freeze(['enabled', 'draining', 'disabled']);

const table = (rows) => Object.freeze(Object.fromEntries(Object.entries(rows).map(([code, pair]) => [code, Object.freeze(pair)])));
/* SQLSTATE → [HTTP status, reason].
   guard    what a refused DOMAIN write means (a League or intake command, a job claim, a guarded table write).
            42883 is the guard function itself being absent: the policy SQL is not applied, so no module is installed.
   command  what a refused OWNER policy command or owner read means (the three routes below).
   consumer the same guard refusals on the pinned product's public route, with the codes and statuses the
            vendored environment server answers itself (disabled is 404 there, not 409). */
export const MODULE_POLICY_ERRORS = Object.freeze({
  guard: table({
    EUM00: [503, 'module_policy_unavailable'], EUM01: [503, 'module_not_installed'], '42883': [503, 'module_not_installed'],
    EUM02: [503, 'module_draining'], EUM03: [409, 'module_disabled'], EUM04: [409, 'module_policy_changed'],
    '55P03': [503, 'module_busy'], '57014': [503, 'module_busy']
  }),
  command: table({
    '42501': [403, 'owner_required'], '40001': [409, 'revision_conflict'], '22023': [422, 'invalid'],
    EUM01: [404, 'module_not_installed'], EUM05: [409, 'drain_required'], EUM06: [409, 'idempotency_conflict'],
    EUM07: [409, 'module_already_installed'], '55P03': [503, 'drain_busy'], '57014': [503, 'drain_busy'],
    PGRST202: [503, 'schema_not_applied'], '42883': [503, 'schema_not_applied']
  }),
  consumer: table({
    EUM01: [503, 'module_not_installed'], EUM02: [503, 'module_draining'], EUM03: [404, 'module_disabled'], EUM04: [409, 'module_policy_changed']
  })
});
/* What the owner is told. Fixed text per reason: a database message is never passed through. */
const MESSAGES = Object.freeze({
  owner_required: 'House owner required',
  revision_conflict: 'The module policy changed since it was read; reload and decide again',
  invalid: 'The module command is not valid',
  module_not_installed: 'The module is not installed',
  drain_required: 'An enabled module must be drained before it is disabled',
  idempotency_conflict: 'This idempotency key was already used for a different command',
  module_already_installed: 'The module is already installed',
  drain_busy: 'Writes are still in flight; nothing changed. The same command can be sent again with the same key',
  schema_not_applied: `Module policy schema is not applied (pending ${PENDING_FILE})`,
  storage_unavailable: 'Module policy storage unavailable',
  module_policy_unavailable: 'Module policy unavailable',
  module_draining: 'The module is draining',
  module_disabled: 'The module is disabled',
  module_policy_changed: 'The module policy changed',
  module_busy: 'The module is busy'
});

/* The shared helper for a refused domain write. Accepts a SQLSTATE string or anything carrying one in
   `.code` (a PostgREST error body, a database driver error). Returns the frozen [status, reason] pair from
   MODULE_POLICY_ERRORS.guard, or null when the error is not a module-policy refusal. */
export function modulePolicyRefusal(error) {
  const code = typeof error === 'string' ? error : (error && typeof error === 'object' && typeof error.code === 'string' ? error.code : '');
  return Object.hasOwn(MODULE_POLICY_ERRORS.guard, code) ? MODULE_POLICY_ERRORS.guard[code] : null;
}

const plain = (status, message, reason) => Object.assign(new Error(message), { status, reason });
const unavailable = (fail) => fail(503, MESSAGES.storage_unavailable, 'storage_unavailable');

/* One service-role RPC. A refusal is looked up in `errors` only; anything it does not name, a redirect, an
   unreachable store and an unreadable error body are all 503 storage_unavailable. */
async function call(env, fetchImpl, fail, name, args, errors = MODULE_POLICY_ERRORS.command) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) throw unavailable(fail);
  let response;
  try {
    response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', redirect: 'manual',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(args)
    });
  } catch { throw unavailable(fail); }
  if (response.status >= 300 && response.status < 400) throw unavailable(fail);
  let result = null;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const code = typeof result?.code === 'string' ? result.code : '';
    const [status, reason] = Object.hasOwn(errors, code) ? errors[code] : [503, 'storage_unavailable'];
    throw fail(status, MESSAGES[reason] || MESSAGES.storage_unavailable, reason);
  }
  return result;
}

/* The gate read is refused like a guarded write, plus the one extra case a direct RPC has: the function is absent. */
const READ_ERRORS = table({ ...MODULE_POLICY_ERRORS.guard, PGRST202: [503, 'schema_not_applied'] });
const revisionOk = (value) => Number.isSafeInteger(value) && value >= 0;
/* The exact shape the pinned product accepts (vendor/equity-uprise/src/server/module-policy.mjs). */
function policyShape(value, module) {
  return Boolean(value) && typeof value === 'object' && value.schema === MODULE_POLICY_SCHEMA && value.installationId === MODULE_INSTALLATION
    && value.moduleId === module && MODULE_STATES.includes(value.state) && revisionOk(value.revision);
}

/* One module's persisted policy, for a route gate or a job's pre-check. No identity is involved (a public
   route has to be gateable). It throws on anything but a well-formed row: a missing row, an unapplied schema,
   an unreachable store and a malformed answer are all refusals, never "enabled" by default.
   Returns { schema, installationId, moduleId, state, revision }. */
export async function readModulePolicy(env, fetchImpl, module) {
  if (!MODULE_IDS.includes(module)) throw plain(503, MESSAGES.module_policy_unavailable, 'module_policy_unavailable');
  const value = await call(env, fetchImpl, plain, 'eup_module_policy_read', { p_module: module }, READ_ERRORS);
  if (!policyShape(value, module)) throw plain(503, MESSAGES.module_policy_unavailable, 'module_policy_unavailable');
  return { schema: value.schema, installationId: value.installationId, moduleId: value.moduleId, state: value.state, revision: value.revision };
}

const text = (value) => (typeof value === 'string' ? value : null);
/* One row of the append-only command log. `prior_state` / `prior_revision` are null for an install. */
function commandRow(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    seq: Number.isSafeInteger(c.seq) ? c.seq : null, module_id: text(c.module_id), command: text(c.command), requested_state: text(c.requested_state),
    expected_revision: revisionOk(c.expected_revision) ? c.expected_revision : null, reason: text(c.reason), actor: text(c.actor),
    prior_state: text(c.prior_state), prior_revision: revisionOk(c.prior_revision) ? c.prior_revision : null,
    idempotency_key: text(c.idempotency_key), receipt: c.receipt && typeof c.receipt === 'object' ? c.receipt : null, created_at: text(c.created_at)
  };
}
/* A module's last command as the owner read returns it: the same row without the prior columns (its receipt carries them). */
function lastCommand(c) {
  const row = commandRow(c);
  if (!row) return null;
  const { module_id: _module, prior_state: _state, prior_revision: _revision, ...rest } = row;
  return rest;
}
/* The owner view, normalised to one row per registered module in registry order. A module the store did not
   answer for, or answered for with a state or revision this code cannot read, makes the whole read fail:
   a partial answer is never completed with a guess. */
function controlShape(value, fail) {
  const rows = Array.isArray(value?.modules) ? value.modules : null;
  if (!rows || value.installationId !== MODULE_INSTALLATION) throw unavailable(fail);
  const modules = MODULE_IDS.map((id) => {
    const row = rows.find((r) => r && r.moduleId === id);
    if (!row || typeof row.installed !== 'boolean') throw unavailable(fail);
    if (!row.installed) return { moduleId: id, installed: false, state: null, revision: null, updated_at: null, updated_by: null, last_command: null };
    if (!MODULE_STATES.includes(row.state) || !revisionOk(row.revision)) throw unavailable(fail);
    return { moduleId: id, installed: true, state: row.state, revision: row.revision, updated_at: text(row.updated_at), updated_by: text(row.updated_by), last_command: lastCommand(row.last_command) };
  });
  return { installationId: MODULE_INSTALLATION, modules, commands: (Array.isArray(value.commands) ? value.commands : []).map(commandRow).filter(Boolean) };
}
/* Owner read: every registered module (installed or not), its state, revision and last command, and the
   latest commands. `actor` must be the verified session user; the RPC rechecks house ownership. */
export async function moduleControl(env, fetchImpl, fail, actor, limit = 50) {
  return controlShape(await call(env, fetchImpl, fail, 'eup_module_control_read', { p_actor: actor, p_limit: limit }), fail);
}

async function body(request, fail) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw fail(415, 'JSON required', 'json_required');
  const reader = request.body?.getReader();
  if (!reader) throw fail(400, 'Body required', 'body_required');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw fail(413, 'Body too large', 'body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let b;
  try { b = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail(400, 'Invalid JSON', 'invalid_json'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw fail(400, 'Invalid JSON', 'invalid_json');
  if (typeof b.idempotency_key !== 'string' || !KEY.test(b.idempotency_key)) throw fail(400, 'Idempotency key required (8 to 128 safe characters)', 'idempotency_key_required');
  /* The store counts characters, not UTF-16 units, and refuses control characters; say so here, before any call. */
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  const length = [...reason].length;
  if (length < 1 || length > 500 || CONTROL_CHARACTER.test(reason)) throw fail(422, 'A reason of 1 to 500 characters is required', 'reason_required');
  return { key: b.idempotency_key, reason, state: b.state, expected_revision: b.expected_revision };
}
/* A receipt is the stored outcome of one command. If the store answers 200 with anything else, the command may
   have been recorded: the caller is told the outcome is unknown (503) and reads the module back. */
function receiptShape(value, module, fail) {
  if (!value || typeof value !== 'object' || !policyShape(value.policy, module) || typeof value.changed !== 'boolean') throw unavailable(fail);
  const prior = value.prior && typeof value.prior === 'object' ? { state: text(value.prior.state), revision: revisionOk(value.prior.revision) ? value.prior.revision : null } : null;
  return { policy: { schema: value.policy.schema, installationId: value.policy.installationId, moduleId: value.policy.moduleId, state: value.policy.state, revision: value.policy.revision }, changed: value.changed, prior, recorded_at: text(value.recorded_at) };
}

/* GET  /v1/eup/modules                    → { ok, installationId, modules[], commands[] }
   POST /v1/eup/modules/:module/install    { idempotency_key, reason }                          → { ok, receipt }
   POST /v1/eup/modules/:module/state      { idempotency_key, expected_revision, state, reason } → { ok, receipt } */
export async function handleModules(request, env, { user, parts, url, fetchImpl = fetch, fail }) {
  const method = request.method;
  if (parts.length === 0) {
    if (method !== 'GET') throw fail(405, 'Method not allowed', 'method_not_allowed');
    const asked = url?.searchParams.get('limit');
    let limit = 50;
    if (asked !== null && asked !== undefined) {
      if (!/^\d{1,3}$/.test(asked) || Number(asked) < 1 || Number(asked) > 200) throw fail(400, 'limit must be 1 to 200', 'invalid_request');
      limit = Number(asked);
    }
    return { ok: true, ...(await moduleControl(env, fetchImpl, fail, user.id, limit)) };
  }
  const [module, verb] = parts;
  if (!MODULE_IDS.includes(module)) throw fail(404, 'Unknown module', 'unknown_module');
  if (parts.length !== 2 || (verb !== 'install' && verb !== 'state')) throw fail(404, 'Module route not found', 'not_found');
  if (method !== 'POST') throw fail(405, 'Method not allowed', 'method_not_allowed');
  const b = await body(request, fail);
  if (verb === 'install') {
    return { ok: true, receipt: receiptShape(await call(env, fetchImpl, fail, 'eup_module_policy_install', { p_actor: user.id, p_module: module, p_key: b.key, p_reason: b.reason }), module, fail) };
  }
  if (!MODULE_STATES.includes(b.state)) throw fail(422, 'state must be enabled, draining or disabled', 'invalid');
  if (!revisionOk(b.expected_revision)) throw fail(400, 'Expected revision required', 'expected_revision_required');
  return { ok: true, receipt: receiptShape(await call(env, fetchImpl, fail, 'eup_module_policy_command', { p_actor: user.id, p_module: module, p_state: b.state, p_expected_revision: b.expected_revision, p_key: b.key, p_reason: b.reason }), module, fail) };
}
