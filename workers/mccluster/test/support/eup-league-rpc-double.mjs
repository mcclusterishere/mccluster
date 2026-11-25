// A stubbed plane for the League Worker routes: the three League RPCs as PostgREST answers them, plus the media
// lane's in-memory storage double for every storage call, behind the Worker runtime's fetch rules.
//
// It is NOT the SQL. Each test says what the store answers (`answer(call)`), and the double records every call so a
// test can prove which function was called, with which arguments, and that nothing else was. Default answers are
// shaped from the contract's own SHAPES (sampleResult), so a route under test always receives a well-formed row of
// the kind its action promises. The journey lane runs the same routes against the real pending SQL.
//
//   const plane = leaguePlane({ answer: (call) => value | Response | sqlError('EU011') | undefined (default) });
//   plane.fetchImpl                       hand it to handleEup as fetchImpl
//   plane.rpc()                           [{ name, body, ... }] every RPC call in order
//   plane.storage                         the storage double (createLeagueStorageDouble)
//   plane.all()                           every call, RPC and storage, in order
import { createLeagueStorageDouble, asWorkerFetch } from './eup-league-storage-double.mjs';
import { ENUMS, MEMBER_ACTIONS, MEDIA, MEDIA_SEAL, OWNER_ACTIONS, RPC, shapeFields } from '../../src/eup/league-contract.js';

export const U = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const OWNER = '11111111-1111-4111-8111-111111111111';
export const MEMBER = '22222222-2222-4222-8222-222222222222';
export const OTHER = '33333333-3333-4333-8333-333333333333';
export const TENANT = U(1);
export const SHA = 'ab'.repeat(32);
export const T0 = Date.parse('2026-11-10T12:00:00Z');
export const AT = new Date(T0).toISOString();
export const ORIGIN = 'https://matthew.mccluster.org';
export const SERVICE_KEY = 'fixture-service-key-not-a-secret';
export const env = Object.freeze({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ALLOWED_ORIGINS: ORIGIN });
export const MEMBER_TOKEN = 'fixture-member-session';
export const OTHER_TOKEN = 'fixture-other-session';
export const NAMES = Object.freeze({ owner: RPC.owner, member: RPC.member, seal: RPC.seal });
export const TABLES = Object.freeze({ owner: OWNER_ACTIONS, member: MEMBER_ACTIONS, media: MEDIA_SEAL });

/* A refusal as PostgREST answers it. The message is text the Worker must never pass on. */
export const sqlError = (sqlstate, { hint = null, status = 400 } = {}) => ({ sqlstate, hint, status });
export const DATABASE_TEXT = 'database text that must never reach a caller';

/* A value of a contract type word (SHAPES notation), for a well-formed default answer. */
export function sampleOf(type) {
  const t = String(type).replace(/\|null$/, '');
  if (t.endsWith('[]')) return [];
  if (t.startsWith('enum:')) return ENUMS[t.slice(5)][0];
  if (t.startsWith('shape:')) return sampleShape(t.slice(6));
  if (t.startsWith('document:')) return {};
  return { uuid: U(99), int: 1, text: 'Test fixture text', bool: false, timestamp: AT, sha256: SHA, seq: '1', json: {} }[t] ?? null;
}
export const sampleShape = (name) => Object.fromEntries(Object.entries(shapeFields(name)).map(([key, type]) => [key, sampleOf(type)]));
export function sampleResult(surface, action) {
  const spec = TABLES[surface][action];
  return spec.result.endsWith('[]') ? [] : sampleShape(spec.result);
}

/* An upload row as the SQL's upload shape carries it (storage only where the SQL fills it). */
export function uploadRow(patch = {}) {
  const mime = patch.mime || 'audio/webm';
  const type = MEDIA.types[mime];
  return { id: U(8), tenant: TENANT, created_at: AT, updated_at: AT, assignment_id: U(7), participant: MEMBER, kind: type.kind, mime, ext: type.ext,
    declared_bytes: 16, max_bytes: 1000, duration_seconds: null, state: 'staged', scan_state: 'not_scanned', expires_at: new Date(T0 + MEDIA.staged_ttl_seconds * 1000).toISOString(),
    bytes: null, sha256: null, family: null, rejected_reason: null, sealed_at: null, discarded_at: null, purged_at: null, storage: null, ...patch };
}
export const pathOf = (row) => `league/v1/t/${row.tenant}/a/${row.assignment_id}/u/${row.id}.${row.ext}`;
/* The sealed row for an object the storage double holds: its identity is the stored one. */
export function sealedRow(storage, row, sha256) {
  const object = storage.object(pathOf(row));
  return { ...row, state: 'sealed', bytes: object.size, declared_bytes: object.size, sha256, family: 'ebml', sealed_at: AT, storage: { object_id: object.id, etag: object.eTag, size: object.size } };
}

export function leaguePlane({ answer = () => undefined, now = () => T0 } = {}) {
  const storage = createLeagueStorageDouble({ origin: env.SUPABASE_URL, serviceKey: SERVICE_KEY, now });
  const all = [];
  const surfaceOf = { [RPC.owner]: 'owner', [RPC.member]: 'member', [RPC.seal]: 'media' };
  const fetchImpl = asWorkerFetch(async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (storage.handles(url)) {
      const response = await storage.fetch(input, init);
      all.push({ kind: 'storage', call: storage.calls.at(-1) });
      return response;
    }
    const m = /^https:\/\/fixture\.invalid\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url);
    if (!m) throw new Error(`stubbed plane: unexpected fetch ${url}`);
    const call = { kind: 'rpc', name: m[1], surface: surfaceOf[m[1]] ?? null, body: JSON.parse(init.body), headers: { ...init.headers }, method: init.method, redirect: init.redirect, signal: init.signal instanceof AbortSignal };
    all.push(call);
    const out = await answer(call);
    if (out instanceof Response) return out;
    if (out && typeof out === 'object' && typeof out.sqlstate === 'string') {
      return Response.json({ code: out.sqlstate, message: DATABASE_TEXT, details: DATABASE_TEXT, hint: out.hint }, { status: out.status });
    }
    if (out !== undefined) return Response.json(out);
    if (call.surface === 'media') return Response.json(uploadRow({ id: call.body.p_upload, state: 'rejected', rejected_reason: 'unrecognised' }));
    return Response.json(sampleResult(call.surface, call.body.p_action));
  });
  return { storage, fetchImpl, all: () => all, rpc: () => all.filter((c) => c.kind === 'rpc'), storageCalls: () => all.filter((c) => c.kind === 'storage') };
}

/* The two identity checks the Worker entry passes to handleEup, as doubles that count their calls. */
export function identities({ owner = OWNER, tokens = { [MEMBER_TOKEN]: MEMBER, [OTHER_TOKEN]: OTHER } } = {}) {
  const seen = { owner: 0, session: 0 };
  return {
    seen,
    requireHouseOwner: async () => { seen.owner += 1; if (!owner) throw Object.assign(new Error('McCluster house owner access required'), { status: 403 }); return { id: owner }; },
    authUser: async (request) => {
      seen.session += 1;
      const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') || '');
      return match && Object.hasOwn(tokens, match[1]) ? { id: tokens[match[1]], email: 'fixture@example.invalid' } : null;
    }
  };
}
