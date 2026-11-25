/* The Overview's module lines tell the owner what this Worker actually does. The C5 line used to say
   "CORE_REPLAY_STORE not configured" whatever wrangler.toml set, and the League line said "no publication"
   after the member loop began publishing to the campaign audience. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleEup, EUP_PREFIX } from '../src/eup/router.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const BASE = { SUPABASE_URL: 'https://db.fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
const denied = async () => Response.json({ message: 'denied' }, { status: 403 });
async function modulesFor(extraEnv) {
  const response = await handleEup(new Request(`https://fixture.invalid${EUP_PREFIX}/overview`), { ...BASE, ...extraEnv },
    { requireHouseOwner: async () => ({ id: OWNER_ID }), fetchImpl: denied, now: () => Date.parse('2026-11-10T12:00:00Z') });
  assert.equal(response.status, 200);
  return Object.fromEntries((await response.json()).modules.map((m) => [m.id, m]));
}

test('the C5 line reports the replay store this Worker uses, by the same rule as the signature check', async () => {
  const shared = (await modulesFor({ CORE_REPLAY_STORE: 'supabase' })).c5.detail;
  assert.match(shared, /shared core_signed_nonces table/);
  assert.doesNotMatch(shared, /not configured/);
  assert.match((await modulesFor({ CORE_REPLAY_STORE: ' Supabase ' })).c5.detail, /shared core_signed_nonces table/, 'trimmed and case-insensitive, as the verifier reads it');
  assert.match((await modulesFor({ CORE_REPLAY_STORE: 'isolate' })).c5.detail, /per isolate only/);
  for (const value of [undefined, '', 'redis']) {
    assert.match((await modulesFor(value === undefined ? {} : { CORE_REPLAY_STORE: value })).c5.detail, /signed mutating requests are refused/, String(value));
  }
  for (const value of ['supabase', 'isolate', undefined]) {
    assert.match((await modulesFor(value ? { CORE_REPLAY_STORE: value } : {})).c5.detail, /claims v2 .*pending/, 'the pending claims v2 gate is always named');
  }
});

test('the deployed configuration is the shared store, and that is what the Overview will say', async () => {
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const value = (toml.match(/^CORE_REPLAY_STORE\s*=\s*"([^"]*)"/m) || [])[1];
  assert.equal(value, 'supabase');
  assert.match((await modulesFor({ CORE_REPLAY_STORE: value })).c5.detail, /shared core_signed_nonces table/);
});

test('the League line names the member loop and publication, and that nothing runs until the module is enabled', async () => {
  const detail = (await modulesFor({})).league.detail;
  assert.doesNotMatch(detail, /no points, payment, publication/);
  assert.match(detail, /publication to the campaign audience/);
  assert.match(detail, /until the owner installs and enables the module/);
});
