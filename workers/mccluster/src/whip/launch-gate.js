/* WHIP EQUIPPED: OPEN SIGN-UP, RIDES NOT LIVE YET (owner, 2026-10-15).

   "People should be able to sign up to Whip Equipped real quick. When they
   try to use it, it'll just tell them the service is not done, but if you
   know a driver, or you are a driver, have them sign up today."

   Whip Equipped LLC is Matthew McCluster's separate company, never a
   McCluster Corp brand (docs/control-plane/DOMAINS-AND-ENTITIES.md). Its
   handlers in this folder are lifted from the Whip-Equipped satellite and
   kept byte-identical (README.md), so this McCluster-side wrapper runs in
   front of them in workers/mccluster/src/index.js and touches only:

     GET  /api/service-status   anyone   { rides_live, operator, message, driver_signup_url }
     POST /api/rides            -> 503 service_not_live while rides are not live (no dispatch, no row)
     POST /api/rides/:id/payment-intent, POST /api/rides/:id/accept
                                -> the same 503 (no ride can exist to pay for or accept)
     POST /api/drivers/me       the driver sign-up: validated, with a recorded consent

   Everything else passes straight through to the lifted chain.

   Rides go live only when the owner sets the Worker variable
   WHIP_RIDES_LIVE to "true" (a var, not a secret); until then every ride
   request answers HTTP 503 with a machine code, a human message and the
   driver sign-up link.

   Driver sign-up collects only what Whip's existing schema holds
   (supabase/replay_migrations/0037_whip_mobility.sql, public.drivers:
   display name, phone, vehicle make/model/colour, plate, seats) plus the
   applicant's consent (application_consent_at / application_consent_version,
   supabase/pending/whip_driver_application_consent_v1.sql). A new row is an
   APPLICATION: online=false and identity_verified=false, as the lifted
   handler already creates it. Whip Equipped's own checks (identity, driver
   licence, insurance, background check and the local rideshare/TNC rules)
   decide who drives; nothing here approves anyone. Until the consent
   columns exist the sign-up answers 503 driver_signup_not_ready rather
   than create an application without its consent. */

export const DRIVER_SIGNUP_URL = 'https://matthew.mccluster.org/whip/driver/';
export const DRIVER_CONSENT_VERSION = 'whip-driver-application-2026-10-15';
export const OPERATOR = 'Whip Equipped LLC';
export const NOT_LIVE_MESSAGE = "Whip Equipped rides aren't live yet. Are you a driver, or know one? Have them sign up today.";
export const DRIVER_CONSENT_TEXT =
  'I am applying to drive with Whip Equipped LLC. I agree that Whip Equipped LLC may store what I entered here and contact me about my application. ' +
  'Applying does not make me a driver: Whip Equipped\'s own checks (identity, driver licence, insurance, background check and local rideshare rules) decide who drives.';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

export function ridesLive(env) {
  return String((env && env.WHIP_RIDES_LIVE) || '').trim().toLowerCase() === 'true';
}

export function serviceStatus(env) {
  const live = ridesLive(env);
  return {
    rides_live: live,
    operator: OPERATOR,
    message: live ? 'Whip Equipped rides are live.' : NOT_LIVE_MESSAGE,
    driver_signup_url: DRIVER_SIGNUP_URL,
    driver_consent_version: DRIVER_CONSENT_VERSION,
    driver_consent_text: DRIVER_CONSENT_TEXT
  };
}

export function notLive() {
  return json({
    error: NOT_LIVE_MESSAGE,
    code: 'service_not_live',
    message: NOT_LIVE_MESSAGE,
    operator: OPERATOR,
    driver_signup_url: DRIVER_SIGNUP_URL
  }, 503, { 'retry-after': '86400' });
}

/* ---------- the driver application ---------- */
const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export function validateDriverApplication(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const errors = [];
  const name = clean(b.display_name);
  if (name.length < 2 || name.length > 80) errors.push({ field: 'display_name', message: 'Your name, 2 to 80 characters.' });
  const plate = clean(b.license_plate).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{0,9}$/.test(plate) || plate.replace(/[^A-Z0-9]/g, '').length < 2) errors.push({ field: 'license_plate', message: 'A licence plate: 2 to 10 letters, numbers, spaces or dashes.' });
  let phone = null;
  if (b.phone != null && clean(b.phone) !== '') {
    phone = clean(b.phone);
    const digits = phone.replace(/\D/g, '');
    if (!/^\+?[0-9 ().-]{7,24}$/.test(phone) || digits.length < 7 || digits.length > 15) errors.push({ field: 'phone', message: 'A phone number, or leave it empty.' });
  }
  const vehicle = {};
  for (const k of ['vehicle_make', 'vehicle_model', 'vehicle_color']) {
    const v = clean(b[k]);
    if (v.length > 40) errors.push({ field: k, message: 'At most 40 characters.' });
    vehicle[k] = v || null;
  }
  let seats = 4;
  if (b.seats != null && b.seats !== '') {
    seats = Number(b.seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > 8) errors.push({ field: 'seats', message: 'Seats: a whole number from 1 to 8.' });
  }
  if (b.application_consent !== true) errors.push({ field: 'application_consent', message: 'Tick the box to agree to apply.' });
  if (b.consent_version !== DRIVER_CONSENT_VERSION) errors.push({ field: 'consent_version', message: 'Reload the page to see the current consent text.' });
  /* anything that would imply approval is refused outright: the applicant never sets it */
  for (const k of ['online', 'identity_verified', 'approved', 'status', 'rating', 'tenant_id', 'auth_user_id']) {
    if (b[k] !== undefined) errors.push({ field: k, message: 'Not something an applicant can set.' });
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    application: { display_name: name, license_plate: plate, phone, ...vehicle, seats, tenant_slug: 'whip-equipped' }
  };
}

function sbHeaders(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...extra };
}
async function sb(env, path, init, fetchImpl) {
  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: sbHeaders(env, (init && init.headers) || {}) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}
async function userOf(request, env, fetchImpl) {
  const auth = request.headers.get('authorization') || '';
  if (!/^bearer\s+\S+/i.test(auth)) return null;
  const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? u : null;
}
/* PostgREST: the column is not there yet (the pending migration is not applied) */
const missingColumn = (r) => !!r && r.data && (r.data.code === 'PGRST204' || r.data.code === '42703');

export async function driverSignup(request, env, fetchImpl = fetch) {
  const user = await userOf(request, env, fetchImpl);
  if (!user) return json({ error: 'Sign in to apply to drive with Whip Equipped.', code: 'sign_in_required' }, 401);
  const body = await request.json().catch(() => null);
  const v = validateDriverApplication(body);
  if (!v.ok) return json({ error: v.errors.map((e) => e.message).join(' '), code: 'invalid_driver_application', errors: v.errors }, 400);

  const existing = await sb(env, `drivers?auth_user_id=eq.${encodeURIComponent(user.id)}&select=*`, {}, fetchImpl);
  if (!existing.ok) return json({ error: 'Whip Equipped sign-up is unavailable right now.', code: 'unavailable' }, 502);
  if (Array.isArray(existing.data) && existing.data.length) {
    return json({ driver: existing.data[0], application: 'already_received', message: 'We already have your application. Whip Equipped will be in touch.' });
  }
  const tenants = await sb(env, 'tenants?slug=eq.whip-equipped&select=id', {}, fetchImpl);
  const tenant = tenants.ok && Array.isArray(tenants.data) ? tenants.data[0] : null;
  if (!tenant) return json({ error: 'Whip Equipped sign-up is unavailable right now.', code: 'unavailable' }, 502);

  const a = v.application;
  const now = new Date().toISOString();
  /* an application: offline and unverified, exactly as the lifted handler creates a driver, plus its consent */
  const row = {
    tenant_id: tenant.id, auth_user_id: user.id, display_name: a.display_name, phone: a.phone, rating: 5,
    vehicle_make: a.vehicle_make, vehicle_model: a.vehicle_model, vehicle_color: a.vehicle_color,
    license_plate: a.license_plate, seats: a.seats, online: false,
    application_consent_at: now, application_consent_version: DRIVER_CONSENT_VERSION
  };
  const created = await sb(env, 'drivers?select=*', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify(row) }, fetchImpl);
  if (missingColumn(created)) {
    return json({ error: 'Whip Equipped driver sign-up opens very soon. Please try again shortly.', code: 'driver_signup_not_ready', driver_signup_url: DRIVER_SIGNUP_URL }, 503);
  }
  if (!created.ok || !Array.isArray(created.data) || !created.data[0]) return json({ error: 'Your application was not saved. Please try again.', code: 'not_saved' }, 502);
  return json({
    driver: created.data[0],
    application: 'received',
    approved: false,
    message: 'Thanks, your application is in. Applying is not approval: Whip Equipped\'s own checks (identity, driver licence, insurance, background check and local rideshare rules) decide who drives.'
  }, 201);
}

/* the wrapper: null means "not mine, hand it to the lifted chain" */
export async function whipLaunchGate(request, env, { fetchImpl = fetch } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/service-status' && (request.method === 'GET' || request.method === 'HEAD')) return json(serviceStatus(env));
  if (!ridesLive(env) && request.method === 'POST' && (path === '/api/rides' || /^\/api\/rides\/[^/]+\/(payment-intent|accept)$/.test(path))) return notLive();
  if (path === '/api/drivers/me' && request.method === 'POST') return driverSignup(request, env, fetchImpl);
  return null;
}
