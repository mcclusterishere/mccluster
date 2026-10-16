/* Whip Equipped (owner, 2026-10-15): open sign-up, rides not live yet.
   Ride requests answer 503 service_not_live with a machine code, a human
   message and the driver sign-up link, through the real entry; nothing is
   dispatched or written. The driver application is validated, consented,
   created offline and unverified, and never implies approval. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.html$/.test(url)) {
      const text = readFileSync(new URL(url), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  }
});

const { default: entry } = await import('../src/entry.js');
const G = await import('../src/whip/launch-gate.js');

const SB = 'https://sb.test';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service' };
const ORIGIN = 'https://matthew.mccluster.org';
const USER = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const GOOD = { display_name: 'Dana Driver', license_plate: 'ab 123', phone: '+1 (203) 555-0100', vehicle_make: 'Toyota', vehicle_model: 'Camry', vehicle_color: 'Blue', seats: 4, application_consent: true, consent_version: G.DRIVER_CONSENT_VERSION };

function fakeSupabase({ existing = [], consentColumns = true } = {}) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = String(input), method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    const auth = init.headers?.authorization || (init.headers && typeof init.headers.get === 'function' ? init.headers.get('authorization') : '');
    if (url === `${SB}/auth/v1/user`) return auth === 'Bearer good' ? json({ id: USER, email: 'dana@example.com' }) : json({}, 401);
    if (url.startsWith(`${SB}/rest/v1/drivers?auth_user_id=`)) return json(existing);
    if (url.startsWith(`${SB}/rest/v1/tenants?slug=eq.whip-equipped`)) return json([{ id: TENANT }]);
    if (url.startsWith(`${SB}/rest/v1/drivers?select=*`) && method === 'POST') {
      if (!consentColumns) return json({ code: 'PGRST204', message: "Could not find the 'application_consent_at' column of 'drivers' in the schema cache" }, 400);
      return json([{ id: 'd1', ...body }], 201);
    }
    if (url.startsWith(`${SB}/rest/v1/rides`)) throw new Error('no ride may be written while rides are not live: ' + url);
    return json({ unexpected: url }, 500);
  };
  impl.calls = calls;
  return impl;
}

function req(path, { method = 'GET', body, token = 'good' } = {}) {
  const headers = { origin: ORIGIN };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return new Request(`https://api.mccluster.org${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

test('service status: rides not live, Whip Equipped LLC, the driver sign-up link; no McCluster branding', async () => {
  const r = await G.whipLaunchGate(req('/api/service-status', { token: null }), env);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.rides_live, false);
  assert.equal(b.operator, 'Whip Equipped LLC');
  assert.equal(b.driver_signup_url, 'https://matthew.mccluster.org/whip/driver/');
  assert.match(b.message, /rides aren't live yet/);
  assert.match(b.message, /Are you a driver, or know one\? Have them sign up today/);
  assert.doesNotMatch(JSON.stringify({ ...b, driver_signup_url: '' }), /McCluster/i);
  assert.match(b.driver_consent_text, /does not make me a driver/);
});

test('a ride request through the real entry: 503 service_not_live with code, message and the sign-up link; nothing dispatched', async () => {
  const fake = fakeSupabase();
  globalThis.fetch = fake;
  for (const path of ['/api/rides', '/api/rides/abc/payment-intent', '/api/rides/abc/accept']) {
    for (const token of ['good', null]) {
      const r = await entry.fetch(req(path, { method: 'POST', body: { dropoff_label: 'Airport', fare_cents: 2500 }, token }), env, {});
      assert.equal(r.status, 503, path);
      assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
      const b = await r.json();
      assert.equal(b.code, 'service_not_live');
      assert.equal(b.error, b.message, 'the lifted apps show data.error; it is the human message');
      assert.match(b.message, /rides aren't live yet/);
      assert.equal(b.driver_signup_url, G.DRIVER_SIGNUP_URL);
      assert.equal(b.operator, 'Whip Equipped LLC');
    }
  }
  assert.equal(fake.calls.filter((c) => c.url.includes('/rest/v1/')).length, 0, 'no database call at all for a ride request');
});

test('WHIP_RIDES_LIVE=true hands ride requests back to the lifted chain', async () => {
  assert.equal(await G.whipLaunchGate(req('/api/rides', { method: 'POST', body: {} }), { ...env, WHIP_RIDES_LIVE: 'true' }), null);
  assert.equal(G.ridesLive({}), false);
  assert.equal(G.ridesLive({ WHIP_RIDES_LIVE: 'yes' }), false, 'only the exact word true turns rides on');
});

test('other Whip routes pass straight through', async () => {
  for (const [m, p] of [['GET', '/api/rentals/vehicles'], ['GET', '/api/drivers/me'], ['POST', '/api/auth/signup'], ['GET', '/api/offers']]) {
    assert.equal(await G.whipLaunchGate(req(p, { method: m, body: m === 'POST' ? {} : undefined }), env), null, p);
  }
});

test('driver application validation: only what the schema holds, consent required, nothing that implies approval', () => {
  const ok = G.validateDriverApplication(GOOD);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.application, { display_name: 'Dana Driver', license_plate: 'AB 123', phone: '+1 (203) 555-0100', vehicle_make: 'Toyota', vehicle_model: 'Camry', vehicle_color: 'Blue', seats: 4, tenant_slug: 'whip-equipped' });
  const fields = (b) => G.validateDriverApplication(b).errors.map((e) => e.field).sort();
  assert.deepEqual(fields({ ...GOOD, application_consent: undefined }), ['application_consent']);
  assert.deepEqual(fields({ ...GOOD, application_consent: 'yes' }), ['application_consent'], 'consent is a real true, not a truthy string');
  assert.deepEqual(fields({ ...GOOD, consent_version: 'old' }), ['consent_version']);
  assert.deepEqual(fields({ ...GOOD, display_name: 'D' }), ['display_name']);
  assert.deepEqual(fields({ ...GOOD, license_plate: '!' }), ['license_plate']);
  assert.deepEqual(fields({ ...GOOD, license_plate: 'ABCDEFGHIJKL' }), ['license_plate']);
  assert.deepEqual(fields({ ...GOOD, phone: '12' }), ['phone']);
  assert.equal(G.validateDriverApplication({ ...GOOD, phone: '' }).application.phone, null);
  assert.deepEqual(fields({ ...GOOD, seats: 0 }), ['seats']);
  assert.deepEqual(fields({ ...GOOD, seats: 2.5 }), ['seats']);
  assert.deepEqual(fields({ ...GOOD, vehicle_make: 'x'.repeat(41) }), ['vehicle_make']);
  for (const k of ['online', 'identity_verified', 'approved', 'status', 'rating', 'tenant_id', 'auth_user_id']) assert.deepEqual(fields({ ...GOOD, [k]: true }), [k], k);
  assert.equal(G.validateDriverApplication(null).ok, false);
  assert.equal(G.validateDriverApplication([]).ok, false);
});

test('driver sign-up: signed in, saved offline and unverified with its consent, and told it is not approval', async () => {
  const fake = fakeSupabase();
  globalThis.fetch = fake;
  const r = await entry.fetch(req('/api/drivers/me', { method: 'POST', body: GOOD }), env, {});
  assert.equal(r.status, 201);
  const b = await r.json();
  assert.equal(b.application, 'received');
  assert.equal(b.approved, false);
  assert.match(b.message, /not approval/);
  assert.match(b.message, /background check/);
  const insert = fake.calls.find((c) => c.method === 'POST' && c.url.startsWith(`${SB}/rest/v1/drivers`));
  assert.equal(insert.body.online, false);
  assert.equal(insert.body.identity_verified, undefined, 'the default (false) stands; the applicant never sets it');
  assert.equal(insert.body.auth_user_id, USER);
  assert.equal(insert.body.tenant_id, TENANT);
  assert.equal(insert.body.license_plate, 'AB 123');
  assert.equal(insert.body.application_consent_version, G.DRIVER_CONSENT_VERSION);
  assert.ok(Date.parse(insert.body.application_consent_at));
  assert.deepEqual(Object.keys(insert.body).sort(), ['application_consent_at', 'application_consent_version', 'auth_user_id', 'display_name', 'license_plate', 'online', 'phone', 'rating', 'seats', 'tenant_id', 'vehicle_color', 'vehicle_make', 'vehicle_model'].sort(), 'only columns the schema has');
});

test('driver sign-up refuses: signed out (401), invalid (400 with fields), already applied (200, no second row)', async () => {
  let fake = fakeSupabase();
  globalThis.fetch = fake;
  assert.equal((await entry.fetch(req('/api/drivers/me', { method: 'POST', body: GOOD, token: null }), env, {})).status, 401);
  const bad = await entry.fetch(req('/api/drivers/me', { method: 'POST', body: { ...GOOD, application_consent: false } }), env, {});
  assert.equal(bad.status, 400);
  const bb = await bad.json();
  assert.equal(bb.code, 'invalid_driver_application');
  assert.deepEqual(bb.errors.map((e) => e.field), ['application_consent']);
  fake = fakeSupabase({ existing: [{ id: 'd0', auth_user_id: USER, online: false }] });
  globalThis.fetch = fake;
  const again = await entry.fetch(req('/api/drivers/me', { method: 'POST', body: GOOD }), env, {});
  assert.equal(again.status, 200);
  assert.equal((await again.json()).application, 'already_received');
  assert.ok(!fake.calls.some((c) => c.method === 'POST' && c.url.startsWith(`${SB}/rest/v1/drivers`)));
});

test('before the consent columns exist, sign-up says it is not ready (503) instead of saving without consent', async () => {
  globalThis.fetch = fakeSupabase({ consentColumns: false });
  const r = await entry.fetch(req('/api/drivers/me', { method: 'POST', body: GOOD }), env, {});
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'driver_signup_not_ready');
});

test('the wrapper runs in front of the lifted Whip handlers in index.js; the lifted files are untouched', async () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ whipLaunchGate \} from '\.\/whip\/launch-gate\.js'/);
  assert.ok(src.indexOf('await whipLaunchGate(request, env)') < src.indexOf('await whip.fetch(request, env)'));
  for (const f of ['identity-gateway.js', 'gateway.js', 'router.js', 'worker.js', 'security.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/whip/${f}`, import.meta.url), 'utf8'), /launch-gate|service_not_live/, f);
  }
});
