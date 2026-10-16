/* Profile edit gate: the Worker's part is only the Persona inquiry route
   accepting a 'profile_edit' submission (src/identity/router.js).
   docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md. Local mocks; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIdentity, PERSONA_LEVELS } from '../src/identity/router.js';

const USER = '00000000-0000-4000-8000-0000000000a1';
const SUB = '30000000-0000-4000-8000-000000000002';
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', PERSONA_ENABLED: 'true', PERSONA_API_KEY: 'persona-test', PERSONA_TEMPLATE_ID: 'itmpl_Test123' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(handlers) {
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { const u = String(url); calls.push({ url: u, init }); for (const [m, fn] of handlers) if (u.includes(m)) return fn(u, init); throw new Error('unexpected fetch ' + u); };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const inquiry = () => new Request('https://api.mccluster.org/v1/identity/persona/inquiry', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer member' }, body: JSON.stringify({ submission_id: SUB }) });

test('the ID check serves V2 and profile edit requests, nothing else', () => {
  assert.deepEqual([...PERSONA_LEVELS].sort(), ['profile_edit', 'v2_halo_full']);
});

test('a submitted profile edit opens one Persona inquiry keyed to its submission', async () => {
  const m = mockFetch([
    ['/auth/v1/user', () => json({ id: USER })],
    ['/rest/v1/rpc/identity_submission_for_persona', () => json({ id: SUB, level: 'profile_edit', status: 'submitted', persona_inquiry_id: null })],
    ['api.withpersona.com/api/v1/inquiries', () => json({ data: { type: 'inquiry', id: 'inq_Edit1234567', attributes: { status: 'created' } }, meta: { 'one-time-link': 'https://withpersona.example/verify?code=x' } }, 201)],
    ['/rest/v1/rpc/identity_record_persona_inquiry', () => json({ submission_id: SUB })]
  ]);
  try {
    const res = await handleIdentity(inquiry(), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).inquiry_id, 'inq_Edit1234567');
    assert.equal(m.calls.find((c) => c.url.includes('withpersona')).init.headers['idempotency-key'], `mccluster-identity-${SUB}`);
  } finally { m.restore(); }
});

test('a profile edit still needs its video first; a V1 never uses the ID check; Persona off answers 503', async () => {
  for (const [sub, code] of [[{ id: SUB, level: 'profile_edit', status: 'awaiting_capture' }, 409], [{ id: SUB, level: 'v1_live_intro', status: 'submitted' }, 409]]) {
    const m = mockFetch([['/auth/v1/user', () => json({ id: USER })], ['/rest/v1/rpc/identity_submission_for_persona', () => json(sub)]]);
    try {
      assert.equal((await handleIdentity(inquiry(), env)).status, code);
      assert.ok(!m.calls.some((c) => c.url.includes('withpersona')));
    } finally { m.restore(); }
  }
  const off = await handleIdentity(inquiry(), { ...env, PERSONA_ENABLED: 'false' });
  assert.equal(off.status, 503);
});
