// Core-side service for the compute contribution ledger
// (docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md, pending SQL
// supabase/pending/compute_contribution_ledger_v1.sql).
//
// Every write goes through the service-role RPCs over the same PostgREST
// client as the rest of the compute store; nothing here is a second data
// plane. Nodes never reach these calls: the scheduler (the Core instance that
// holds the scheduler lease, or the single scheduler when no election is
// configured) reserves at submission, settles an accepted completion and
// releases on fail, cancel or expiry. Every call carries an operation_key and
// the SQL is idempotent on it, so a retry after a lost reply is safe.
//
// Off by default: CORE_CONTRIBUTION_LEDGER_ENABLED=1 turns the wiring in
// jobs-service.mjs on. With the variable unset nothing here is called.
import crypto from 'node:crypto';
import { rest } from '../supabase.mjs';

export const LEDGER_ENV_FLAG = 'CORE_CONTRIBUTION_LEDGER_ENABLED';
export const DEFAULT_RESERVATION_SECONDS = 3600;
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;
const KEY_CHARS = /[^!-~]/g;
const HOLDER_ID = /^[a-z0-9][a-z0-9._-]{0,78}$/;

export function ledgerEnabled(env = process.env) {
  return String(env?.[LEDGER_ENV_FLAG] ?? '').trim() === '1';
}

// rpc(name, payload) posts to Supabase rpc/<name> and resolves the decoded
// body; every call carries a network timeout so a black-holed write fails.
export function createLedgerRpc(restImpl = rest, { timeoutMs = DEFAULT_RPC_TIMEOUT_MS } = {}) {
  const timeout = Math.max(100, Math.trunc(Number(timeoutMs) || DEFAULT_RPC_TIMEOUT_MS));
  return async (name, payload) => (await restImpl(`rpc/${name}`, {
    method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout)
  })).body;
}

// The (holder_id, term) the ledger fences on. With an election: this instance's
// holder id and the term it holds (null while it is not active, which the SQL
// refuses as STALE_TERM whenever any scheduler row exists for the org). Without
// an election (today's single scheduler) the holder is the Core id and the term
// null; the SQL accepts that only while the org has no scheduler row at all.
export function schedulerIdentity(election = null, env = process.env) {
  if (election && typeof election === 'object') {
    const active = typeof election.isActive === 'function' ? election.isActive() : false;
    return { holder_id: election.holderId ?? null, term: active && Number.isInteger(Number(election.term)) ? Number(election.term) : null, active, configured: true };
  }
  const raw = String(env?.MCCLUSTER_SCHEDULER_HOLDER_ID || env?.MCCLUSTER_CORE_ID || 'core-single').trim();
  return { holder_id: HOLDER_ID.test(raw) ? raw : 'core-single', term: null, active: true, configured: false };
}

// Deterministic, printable-ASCII operation keys (the SQL's arbiter). A settle
// or release key names the scheduler (holder, term) so a new holder after a
// failover settles the same (task, attempt) under a fresh key, as the contract
// requires, while a retry by the same holder replays.
export function operationKey(kind, parts = []) {
  const joined = [kind, ...parts.map((part) => (part === null || part === undefined ? 'none' : String(part)))].join(':');
  const clean = joined.replace(KEY_CHARS, '_');
  return clean.length <= 200 ? clean : `${clean.slice(0, 135)}:${crypto.createHash('sha256').update(clean).digest('hex')}`;
}

export function leaseTokenHash(leaseToken) {
  return crypto.createHash('sha256').update(String(leaseToken ?? ''), 'utf8').digest('hex');
}

// The class that prices a task: the one whose implementations list names the
// task's implementation, else the only class when the table has one row
// (the pilot), else null.
export function resolveModelClass(classes, { implementation = null } = {}) {
  const list = Array.isArray(classes) ? classes.filter((row) => row && typeof row === 'object') : [];
  if (implementation) {
    const match = list.find((row) => Array.isArray(row.implementations) && row.implementations.includes(implementation));
    if (match) return match;
  }
  return list.length === 1 ? list[0] : null;
}

// The Ollama adapter's own floors (inference-settings.mjs): it never generates
// with num_predict under 16 and never runs a context under 2048, so a task
// that asks for less is capped at these, not at what it asked for.
export const MIN_EVAL_CAP = 16;
export const MIN_PROMPT_CAP = 2048;
export const MAX_PROMPT_CAP = 32768;

// Current receipts carry the context sent to their execution node. Receipts
// predating that setting keep their original request-based validation bound.
export function taskCounterCaps({ input = {}, modelClass = null, executionContext = null } = {}) {
  if (!modelClass) return null;
  const maxEval = Number(modelClass.max_eval_count);
  const maxPrompt = Number(modelClass.max_prompt_eval_count);
  if (![maxEval, maxPrompt].every((n) => Number.isSafeInteger(n) && n >= 1)) return null;
  const asked = (value) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 999_999_999 ? value : null);
  const predict = asked(input?.num_predict);
  const ctx = asked(input?.num_ctx);
  return {
    max_eval_count: predict === null ? maxEval : Math.min(maxEval, Math.max(MIN_EVAL_CAP, predict)),
    max_prompt_eval_count: Math.min(maxPrompt, MAX_PROMPT_CAP, executionContext ?? (ctx === null ? MAX_PROMPT_CAP : Math.max(MIN_PROMPT_CAP, ctx)))
  };
}

// The task's max units: the generation cap times the output weight plus the
// prompt cap times the input weight. Integer micro-units; null without a class.
export function estimateMaxUnitsMicro({ input = {}, modelClass = null } = {}) {
  const caps = taskCounterCaps({ input, modelClass });
  if (!caps) return null;
  const out = Number(modelClass.out_unit_micro);
  const inp = Number(modelClass.in_unit_micro);
  if (![out, inp].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  // The execution node is chosen after reservation. Its resident context can
  // raise a small request to any supported size. Charge only measured tokens.
  const promptBound = Math.min(Number(modelClass.max_prompt_eval_count), MAX_PROMPT_CAP);
  const maxUnits = caps.max_eval_count * out + promptBound * inp;
  return Number.isSafeInteger(maxUnits) ? maxUnits : null;
}

export async function listModelClasses({ restImpl = rest } = {}) {
  const params = new URLSearchParams({ select: '*', order: 'model_class.asc', limit: '50' });
  const { body = [] } = await restImpl(`ops_compute_model_classes?${params}`);
  return Array.isArray(body) ? body : [];
}

function requireRpc(deps) {
  if (typeof deps?.rpc !== 'function') throw new TypeError('contribution ledger deps.rpc(name, payload) is required');
  return deps.rpc;
}

// The five calls the contract names, each a thin, typed wrapper over its RPC.
// modelClass and unitVersion pin the class the task was priced with: the SQL
// refuses UNIT_VERSION_STALE when the class moved on since the Core read it,
// and holds the settle to the pinned pair.
export async function reserve({ opKey, accountId, taskId, maxUnitsMicro, deadlineSeconds = DEFAULT_RESERVATION_SECONDS, modelClass = null, unitVersion = null }, deps) {
  if (!Number.isSafeInteger(maxUnitsMicro) || maxUnitsMicro < 0) throw Object.assign(new Error('maxUnitsMicro must be a non-negative integer'), { code: 'LEDGER_ARGUMENT' });
  return requireRpc(deps)('compute_ledger_reserve', {
    p_op_key: opKey, p_account_id: accountId, p_task_id: taskId, p_max_units_micro: maxUnitsMicro,
    p_deadline_seconds: Math.max(60, Math.min(604_800, Math.trunc(Number(deadlineSeconds) || DEFAULT_RESERVATION_SECONDS))),
    p_model_class: modelClass == null ? null : String(modelClass),
    p_unit_version: Number.isSafeInteger(Number(unitVersion)) && Number(unitVersion) >= 1 ? Number(unitVersion) : null
  });
}

export async function settle({ opKey, taskId, leaseToken, leaseTokenHash: tokenHash = null, attempt, metering, outputSha256, scheduler }, deps) {
  return requireRpc(deps)('compute_ledger_settle', {
    p_op_key: opKey, p_task_id: taskId, p_lease_token_hash: tokenHash || leaseTokenHash(leaseToken), p_attempt: attempt,
    p_metering: metering && typeof metering === 'object' ? metering : {}, p_output_sha256: outputSha256,
    p_scheduler_holder_id: scheduler?.holder_id ?? null, p_scheduler_term: scheduler?.term ?? null
  });
}

export async function release({ opKey, taskId, reason, scheduler }, deps) {
  return requireRpc(deps)('compute_ledger_release', {
    p_op_key: opKey, p_task_id: taskId, p_reason: String(reason || 'released').slice(0, 200),
    p_scheduler_holder_id: scheduler?.holder_id ?? null, p_scheduler_term: scheduler?.term ?? null
  });
}

export async function balances({ accountId }, deps) {
  return requireRpc(deps)('compute_ledger_balances', { p_account_id: accountId });
}

export async function receipt({ taskId }, deps) {
  return requireRpc(deps)('compute_ledger_receipt', { p_task_id: taskId });
}

export async function correct({ opKey, correctionOf = null, accountId, spendMicro = 0, unitsMicro = 0, reason }, deps) {
  return requireRpc(deps)('compute_ledger_correct', {
    p_op_key: opKey, p_correction_of: correctionOf, p_account_id: accountId,
    p_spend_micro: spendMicro, p_units_micro: unitsMicro, p_reason: reason
  });
}
