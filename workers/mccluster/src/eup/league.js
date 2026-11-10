/* E=Up → Environmental Justice League: the owner routes, and the League transport both surfaces share.

   Every League route is a row of ROUTES in ./league-contract.js, the frozen wire contract. This file and
   ./league-member.js turn a matched row into calls of exactly the function the row names, and never decide what
   the SQL decides (supabase/pending/eup_league_v1.sql rechecks the actor, revisions, keys, audience and policy in
   its own transaction):
     owner  /v1/eup/league/*         → eup_league_command         reached through ./router.js after the verified
                                                                   house-owner check (requireHouseOwner)
     member /v1/eup/member/league/*  → eup_league_member_command  ./league-member.js, reached through the one member
                                                                   branch of ./router.js after the verified session
     media  POST uploads/:id/complete → eup_league_media_seal     ./league-member.js, through the media module's ctx.seal
   The actor is ALWAYS the verified session user. No body field, query value or header names an account.

   What the Worker answers alone, before any RPC (HTTP_REASONS in the contract): a body over LIMITS.body_max_bytes
   (413), a body that is not JSON (415) or not an object (400), a path id that is not a uuid (404), a missing or
   malformed idempotency_key or expected_revision where the route says so (400), and a document the contract's own
   checkDocument refuses (422; for uploads.begin first the two refinements the SQL also makes: 415 and 413). The
   document check is the contract's, the same one the SQL runs on the same specs; it only saves a round trip.

   Errors: a refusal from the store is mapped by SQLSTATE only. EUM codes and 55P03/57014 go to the one shared
   mapping, MODULE_POLICY_ERRORS in ./modules.js (the contract's errorFor returns null for them); every other code
   goes to the contract's errorFor for the route's surface. Every answer carries a fixed sentence: no database or
   storage text, URL, token or key ever reaches a caller, and nothing here logs.

   Absent on purpose: points, payment, commission, live broadcast and publication wider than a campaign's released
   audience (NOT_IMPLEMENTED_SEGMENTS stay 501). Nothing here reads or writes a public projection (action_missions,
   action_proofs, network_posts, network_groups, ...), the held consumer environment SQL or another bucket.
   First complete mission target: "Write a song for a healthier world". */
import { CAMPAIGN_FIXTURE } from './league-fixture.js';
import { modulePolicyRefusal } from './modules.js';
import { purgeDue, signReviewRead } from './league-media.js';
import {
  DOCUMENTS, ERROR_FALLBACK, HTTP_REASONS, LIMITS, MEDIA, MEDIA_SEAL, MEMBER_ACTIONS, MODULE_ERRORS, NOT_IMPLEMENTED_SEGMENTS,
  OWNER_ACTIONS, PATTERNS, REFUSED_MEMBER_FIELDS, RPC, RPC_ARGUMENTS, checkDocument, errorFor, matchRoute, mediaType, refusedMemberField
} from './league-contract.js';

/* How long one RPC (the call and its answer) may take. The API role's statement and lock timeouts are 8 s, and the
   League functions set lock_timeout 5 s, so a healthy store always answers first. Not policy: a transport bound. */
export const LEAGUE_RPC_TIMEOUT_MS = 10000;
const ACTIONS = Object.freeze({ owner: OWNER_ACTIONS, member: MEMBER_ACTIONS, media: MEDIA_SEAL });

/* One fixed sentence per reason. */
const TEXT = Object.freeze({
  authentication_required: 'Authentication required',
  json_required: 'JSON required',
  body_required: 'Body required',
  invalid_json: 'Invalid JSON',
  body_too_large: 'Body too large',
  idempotency_key_required: 'Idempotency key required (8 to 128 letters, digits, dots, underscores, colons or hyphens)',
  expected_revision_required: 'Expected revision required',
  field_refused: `A member request never names an account (${REFUSED_MEMBER_FIELDS.join(', ')}): the account is always the signed-in one`,
  invalid: 'The League request is not valid',
  not_found: 'Not found',
  not_available: 'Not available',
  not_implemented: 'Points, payouts, live broadcast and publication beyond a campaign\'s released audience are separate decisions and are not implemented',
  storage_unavailable: 'League storage unavailable',
  schema_not_applied: 'Environmental Justice League schema is not applied (pending eup_league_v1.sql)',
  owner_required: 'House owner required',
  revision_conflict: 'The record changed since it was read; reload and decide again',
  retry_conflict: 'Nothing was written; the same request can be sent again with the same key',
  exists: 'It already exists',
  capacity_exhausted: 'No seat is free',
  self_review_denied: 'Nobody approves, reviews or resolves their own work',
  idempotency_conflict: 'This idempotency key was already used for a different request',
  policy_unavailable: 'The League is not configured for this yet',
  audience_not_released: 'Not released to this account',
  entitlement_required: 'Taking part is not open under the current League policy',
  requirements_changed: 'The requirements or the notice changed; read them again and accept the current version',
  media_binding: 'The media is not the upload that was sealed for this work',
  consent_scope: 'The consent does not match this proof, its revision, the notice or its expiry',
  moderation_hold: 'The proof is held',
  rate_limited: 'A limit was reached',
  media_type_not_allowed: 'This media type is not allowed here',
  media_too_large: 'The file is larger than allowed',
  module_policy_unavailable: 'Module policy unavailable',
  module_not_installed: 'The League module is not installed',
  module_draining: 'The League is draining: new work is stopped; records, withdrawals and revocations stay open',
  module_disabled: 'The League is disabled: new work is stopped; records, withdrawals and revocations stay open',
  module_policy_changed: 'The League module policy changed; send the request again',
  module_busy: 'The League is busy; the same request can be sent again with the same key'
});

/* The Error for a reason. `status` defaults to the contract's HTTP_REASONS row. */
export function leagueFailure(fail, reason, status = HTTP_REASONS[reason], text = TEXT[reason]) {
  return fail(Number.isInteger(status) ? status : 503, text || TEXT.storage_unavailable, reason);
}
const unavailable = (fail) => leagueFailure(fail, 'storage_unavailable', 503);

/* [status, reason] for a refused League call. surface: 'owner' for eup_league_command; 'member' for the member
   function and for the seal (a member route calls both). */
export function leagueRefusal(sqlstate, surface, hint = null) {
  const code = typeof sqlstate === 'string' ? sqlstate : '';
  if (code.startsWith(MODULE_ERRORS.prefix) || MODULE_ERRORS.also.includes(code)) {
    const pair = modulePolicyRefusal(code);
    return pair ? [pair[0], pair[1]] : [ERROR_FALLBACK.owner_status, ERROR_FALLBACK.code];
  }
  const answer = errorFor(code, surface === 'owner' ? 'owner' : 'member', hint);
  return [answer.status, answer.code];
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const release = (response) => { try { response?.body?.cancel().catch(() => {}); } catch { /* nothing left to release */ } };

/* One service-role call of a League function. `args` carries the function's own argument names
   (RPC_ARGUMENTS); they are sent in that order and nothing else is sent. A redirect (never followed), the deadline,
   an unreachable store, an answer that is not JSON and any SQLSTATE the tables do not name are all
   503 storage_unavailable, and none of them returns data. fetchImpl is called bare, never as a method. */
export async function leagueRpc(env, { fetchImpl = globalThis.fetch, fail, timeoutMs = LEAGUE_RPC_TIMEOUT_MS } = {}, surface, args = {}) {
  const fn = surface === 'media' ? 'seal' : surface;
  const name = Object.hasOwn(RPC, fn) ? RPC[fn] : null;
  if (!name || !env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY || typeof fetchImpl !== 'function') throw unavailable(fail);
  const body = Object.fromEntries(RPC_ARGUMENTS[fn].map((key) => [key, args[key] === undefined ? null : args[key]]));
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const controller = new AbortController();
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : LEAGUE_RPC_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), deadline);
  const expired = new Promise((_, reject) => { controller.signal.addEventListener('abort', () => reject(new Error('league rpc deadline')), { once: true }); });
  expired.catch(() => {});
  let pending = null;
  let response = null;
  let text;
  try {
    pending = Promise.resolve(fetchImpl(`${String(env.SUPABASE_URL).replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    }));
    response = await Promise.race([pending, expired]);
    if (!response || typeof response.status !== 'number' || (response.status >= 300 && response.status < 400)) throw new Error('not an answer');
    text = await Promise.race([response.text(), expired]);
  } catch {
    if (response) release(response);
    else if (pending) pending.then(release, () => {});
    throw unavailable(fail);
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (!response.ok) {
    const code = isPlainObject(data) && typeof data.code === 'string' ? data.code : '';
    const hint = isPlainObject(data) && typeof data.hint === 'string' ? data.hint : null;
    const [status, reason] = leagueRefusal(code, surface, hint);
    throw leagueFailure(fail, reason, status);
  }
  if (data === undefined) throw unavailable(fail);
  return data;
}

/* The result an action promises: a list for a 'shape[]' result, an object otherwise. Anything else is a
   malformed answer: 503 and no data. */
function expectResult(spec, data, fail) {
  const list = typeof spec?.result === 'string' && spec.result.endsWith('[]');
  if (list ? !Array.isArray(data) : !isPlainObject(data)) throw unavailable(fail);
  return data;
}

/* One command of a surface's function: { action, actor, id, document, revision, key } in the contract's terms.
   ctx = { fetchImpl, fail, timeoutMs }. */
export async function leagueCall(env, ctx, surface, { action, actor, id = '', document = null, revision = null, key = null } = {}) {
  const table = ACTIONS[surface === 'owner' ? 'owner' : 'member'];
  const spec = typeof action === 'string' && Object.hasOwn(table, action) ? table[action] : null;
  if (!spec) throw leagueFailure(ctx.fail, 'invalid', 422);
  const data = await leagueRpc(env, ctx, surface === 'owner' ? 'owner' : 'member',
    { p_action: action, p_actor: actor, p_id: id || '', p_document: document, p_revision: revision, p_key: key });
  return expectResult(spec, data, ctx.fail);
}

/* The owner command, as ./overview.js calls it: leagueCommand(env, fetchImpl, fail, { action, actor, ... }). */
export function leagueCommand(env, fetchImpl, fail, { timeoutMs, ...params } = {}) {
  return leagueCall(env, { fetchImpl, fail, timeoutMs }, 'owner', params);
}

/* ------------------------------------------------------------------ request shaping (both surfaces) */

/* The request body: JSON (415), at most LIMITS.body_max_bytes (413), present (400), an object (400). */
export async function readJsonBody(request, fail) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw leagueFailure(fail, 'json_required');
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d{1,15}$/.test(declared.trim()) && Number(declared.trim()) > LIMITS.body_max_bytes) throw leagueFailure(fail, 'body_too_large');
  const reader = request.body && typeof request.body.getReader === 'function' ? request.body.getReader() : null;
  if (!reader) throw leagueFailure(fail, 'body_required');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.body_max_bytes) {
        reader.cancel().catch(() => {});
        throw leagueFailure(fail, 'body_too_large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error?.reason === 'body_too_large') throw error;
    throw leagueFailure(fail, 'invalid_json');
  }
  if (size === 0) throw leagueFailure(fail, 'body_required');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw leagueFailure(fail, 'invalid_json'); }
  if (!isPlainObject(parsed)) throw leagueFailure(fail, 'invalid_json');
  return parsed;
}

/* The path after the surface prefix, segment by segment percent-decoded, or null when a segment does not decode
   or decodes to something with a slash in it (it could then pose as another route). */
export function routePath(segments) {
  const out = [];
  for (const segment of segments) {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { return null; }
    if (decoded.includes('/')) return null;
    out.push(decoded);
  }
  return out.join('/');
}

/* The action spec a route calls: the owner table, the member table, or the seal. */
export function routeAction(route) {
  const table = ACTIONS[route.rpc];
  return table && Object.hasOwn(table, route.action) ? table[route.action] : null;
}

/* The two refinements of 22023 the SQL makes for uploads.begin before its document check (REFUSAL_HINTS), repeated
   here on the static media table so the Worker refuses the same way before the RPC: a MIME type the table does not
   know, or one of another kind, is 415; more bytes than the hard ceiling is 413. The policy caps stay the SQL's. */
function uploadRefinement(document, fail) {
  if (typeof document.mime === 'string') {
    const type = mediaType(document.mime);
    if (!type || (typeof document.kind === 'string' && type.kind !== document.kind)) throw leagueFailure(fail, 'media_type_not_allowed');
  }
  if (typeof document.bytes === 'number' && document.bytes > MEDIA.hard_max_bytes) throw leagueFailure(fail, 'media_too_large');
}

/* What a matched route sends, decided before any RPC: { id, document, revision, key, body }. */
export async function prepareCall(request, url, route, params, fail) {
  const spec = routeAction(route);
  if (!spec) throw leagueFailure(fail, route.surface === 'member' ? 'not_available' : 'not_found');
  const body = route.method === 'GET' ? null : await readJsonBody(request, fail);
  if (route.surface === 'member' && body && refusedMemberField(body) !== null) throw leagueFailure(fail, 'field_refused');
  let key = null;
  if (route.idempotency_key) {
    key = body?.idempotency_key;
    if (typeof key !== 'string' || !PATTERNS.idempotency_key.test(key)) throw leagueFailure(fail, 'idempotency_key_required');
  }
  let revision = null;
  if (route.expected_revision) {
    revision = body?.expected_revision;
    if (!Number.isSafeInteger(revision) || revision < route.revision_min || revision > LIMITS.revision_max) throw leagueFailure(fail, 'expected_revision_required');
  }
  let id = route.id ? params[route.id] : '';
  /* The seal's document is what the media module measured, never the request: that route builds none here. */
  const docSpec = route.rpc !== 'media' && spec.document ? DOCUMENTS[spec.document] : null;
  let document = docSpec ? {} : null;
  if (document && route.wrapper && body && body[route.wrapper] !== undefined) {
    const inner = body[route.wrapper];
    if (!isPlainObject(inner)) throw leagueFailure(fail, 'invalid', 422, `${TEXT.invalid}: ${route.wrapper} must be an object`);
    document = { ...inner };
  }
  if (document && body) for (const field of route.fields) if (body[field] !== undefined) document[field] = body[field];
  for (const [name, to] of Object.entries(route.query)) {
    const raw = url?.searchParams?.get(name) ?? null;
    if (raw === null || raw === '') {
      if (route.required_query.includes(name)) throw leagueFailure(fail, to === 'revision' ? 'expected_revision_required' : 'invalid');
      continue;
    }
    if (to === 'id') {
      if (!PATTERNS.uuid.test(raw)) throw leagueFailure(fail, route.surface === 'member' ? 'not_available' : 'not_found');
      id = raw.toLowerCase();
      continue;
    }
    if (!document) continue;
    if (docSpec.fields?.[to]?.type === 'integer') {
      if (!PATTERNS.query_integer.test(raw)) throw leagueFailure(fail, to === 'revision' ? 'expected_revision_required' : 'invalid');
      document[to] = Number(raw);
    } else {
      document[to] = raw;
    }
  }
  if (document) {
    for (const [param, to] of Object.entries(route.params)) document[to] = params[param];
    for (const [field, value] of Object.entries(route.fixed)) document[field] = value;
    if (route.action === 'uploads.begin') uploadRefinement(document, fail);
    const problem = checkDocument(docSpec, document);
    if (problem) throw leagueFailure(fail, 'invalid', 422, `${TEXT.invalid}: ${problem.slice(0, 200)}`);
  }
  return { id, document, revision, key, body };
}

/* The media module's context. seal is added by the member route that owns it. */
export const mediaContext = (env, ctx, extra = {}) => ({ env, fetchImpl: ctx.fetchImpl ?? globalThis.fetch, fail: ctx.fail, now: typeof ctx.now === 'function' ? ctx.now : Date.now, ...extra });
export const rpcContext = (ctx) => ({ fetchImpl: ctx.fetchImpl ?? globalThis.fetch, fail: ctx.fail, timeoutMs: ctx.rpcTimeoutMs });

/* ------------------------------------------------------------------ owner routes */

/* POST media/purge, in the order MEDIA.order.purge names: ask which of the named uploads are due; refuse (409,
   before deleting anything) when one is neither due nor already purged; delete the due objects; and only when
   every deletion succeeded record media.purged with exactly the uploads asked for. */
async function purgeRoute(env, ctx, route, call) {
  const { fail } = ctx;
  const uploads = call.document.uploads;
  const command = (action, extra) => leagueCall(env, rpcContext(ctx), 'owner', { action, actor: ctx.user.id, ...extra });
  const due = await command('media.due', { document: { uploads } });
  const rows = Array.isArray(due.uploads) ? due.uploads : null;
  const asked = new Set(uploads.map((u) => u.toLowerCase()));
  if (!rows || rows.length !== asked.size || !rows.every((row) => isPlainObject(row) && typeof row.id === 'string' && asked.has(row.id.toLowerCase()))) throw unavailable(fail);
  if (rows.some((row) => row.due !== true && row.state !== 'purged')) throw leagueFailure(fail, 'revision_conflict', 409, 'An upload asked for is neither due nor purged; nothing was deleted');
  const { failed } = await purgeDue(mediaContext(env, ctx), due);
  if (failed.length) throw unavailable(fail);
  const result = await command(route.action, { document: call.document, key: call.key });
  return { ok: true, [route.response]: result };
}

/* /v1/eup/league/* : every owner row of ROUTES. ctx = { user, parts, url, fetchImpl, now, fail, rpcTimeoutMs }. */
export async function handleLeague(request, env, ctx) {
  const { user, parts = [], url, fail } = ctx;
  const rest = routePath(parts);
  if (rest === null) throw leagueFailure(fail, 'not_found');
  if (NOT_IMPLEMENTED_SEGMENTS.includes(rest.split('/')[0])) throw leagueFailure(fail, 'not_implemented');
  const hit = matchRoute('owner', request.method, rest);
  if (!hit) throw leagueFailure(fail, 'not_found', 404, 'League route not found');
  const { route, params } = hit;
  /* The draft catalogue the owner may create from: static, unpublished, unpriced, not a seed. */
  if (route.action === null) return { ok: true, [route.response]: CAMPAIGN_FIXTURE };
  const call = await prepareCall(request, url, route, params, fail);
  if (route.media === 'purgeDue') return purgeRoute(env, ctx, route, call);
  const result = await leagueCall(env, rpcContext(ctx), 'owner', { action: route.action, actor: user.id, id: call.id, document: call.document, revision: call.revision, key: call.key });
  /* GET proofs/:id/media: the proof at the revision asked for, then one short signed read per upload it lists. */
  if (route.media === 'signReviewRead') return { ok: true, [route.response]: result, media: await signReviewRead(mediaContext(env, ctx), result) };
  return { ok: true, [route.response]: result };
}
