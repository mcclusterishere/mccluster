import {
  stripeConfigured,
  createConnectedAccount,
  retrieveConnectedAccount,
  connectedAccountReady,
  createAccountLink,
  createWhiteLabelSubscriptionCheckout,
  createDirectCheckout,
  retrieveCheckoutSession,
  createManualPaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  verifyStripeWebhook
} from './stripe.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const TRANSITIONS = {
  REQUESTED: ['ACCEPTED','CANCELED'],
  ACCEPTED: ['DRIVER_EN_ROUTE','CANCELED'],
  DRIVER_EN_ROUTE: ['DRIVER_ARRIVED','CANCELED'],
  DRIVER_ARRIVED: ['VERIFIED','CANCELED'],
  VERIFIED: ['IN_PROGRESS','CANCELED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [], CANCELED: []
};
const RENTAL_TRANSITIONS = {
  BOOKED: ['CHECKIN_REQUIRED','CANCELED'],
  CHECKIN_REQUIRED: ['READY_FOR_PICKUP','CANCELED'],
  READY_FOR_PICKUP: ['ACTIVE','CANCELED'],
  ACTIVE: ['RETURN_DUE'],
  RETURN_DUE: ['COMPLETED'],
  COMPLETED: [], CANCELED: []
};

/* Rental money is quoted by the server from the dates, the vehicle's stored
   daily rate and a server-side catalogue. The browser names options, never
   amounts: client-supplied cents are ignored. */
const RENTAL_PROTECTION_PLANS = { none: 0, standard: 900 };          // cents per day
const RENTAL_EXTRAS = { refuel: 5500, mount: 800, seat: 1400 };     // cents per rental
const RENTAL_TAX_BPS = 700;
const WHIP_CURRENCY = 'usd';
function cents(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n) : NaN; }
/* Bill full calendar rental days in the pickup time zone, not elapsed UTC
   hours. A 49-hour fall-DST interval from 10am to 10am is two local days;
   a genuine 25-hour late return outside that shift is two billable days. */
function rentalDays(start, end, zone) {
  const elapsedDays = Math.max(1, Math.ceil((end - start) / 86_400_000));
  if (!zone) return elapsedDays;
  let parts;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: String(zone), year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    parts = [start, end].map(value => Object.fromEntries(fmt.formatToParts(new Date(value)).map(p => [p.type, p.value])));
  } catch { return { error: 'Invalid rental time zone' }; }
  const [a,b] = parts;
  const date = p => Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day));
  const clock = p => Number(p.hour)*3600 + Number(p.minute)*60 + Number(p.second);
  const civil = (date(b)-date(a))/86_400_000;
  const days = Math.max(1, civil + (clock(b)>clock(a) ? 1 : 0));
  if (!Number.isInteger(days) || days<1 || Math.abs((end-start)-civil*86_400_000)>90_000_000)
    return { error: 'Rental dates need a consistent pickup and return time' };
  return days;
}
export function rentalQuote(vehicle, tenant, body = {}) {
  const start = Date.parse(body?.start_at), end = Date.parse(body?.end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: 'start_at and end_at are required' };
  if (end <= start) return { error: 'end_at must be after start_at' };
  const days = rentalDays(start, end, vehicle?.time_zone || tenant?.time_zone || body?.time_zone || null);
  if (typeof days === 'object') return days;
  const plan = body?.protection_plan == null ? 'standard' : String(body.protection_plan);
  if (!Object.hasOwn(RENTAL_PROTECTION_PLANS, plan)) return { error: 'Unknown protection plan' };
  const extraIds = Array.isArray(body?.extras) ? [...new Set(body.extras.map(String))] : [];
  if (extraIds.some(id => !Object.hasOwn(RENTAL_EXTRAS, id))) return { error: 'Unknown rental extra' };
  const daily = cents(vehicle?.daily_rate_cents); if (!(daily > 0)) return { error: 'Vehicle has no daily rate' };
  const extras = extraIds.reduce((sum, id) => sum + RENTAL_EXTRAS[id], 0), protection = RENTAL_PROTECTION_PLANS[plan] * days;
  const subtotal = daily * days + extras + protection, tax = Math.round(subtotal * RENTAL_TAX_BPS / 10_000), total = subtotal + tax;
  const platform = tenant?.white_label_enabled ? 0 : Math.round(total * Number(tenant?.platform_fee_percent || 0.03));
  return { days, daily_rate_cents: daily, extras_cents: extras, protection_cents: protection, tax_cents: tax, platform_fee_cents: platform, total_cents: total, protection_plan: plan, extras: extraIds };
}

function cors(env) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-we-user-id,x-we-role',
    'access-control-max-age': '86400'
  };
}
function reply(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...cors(env) } });
}
function fail(env, message, status = 400, detail) {
  return reply(env, { error: message, detail }, status);
}
function requiredEnv(env) { return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY); }
function sbHeaders(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...extra };
}
async function sb(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: sbHeaders(env, init.headers || {}) });
  const text = await res.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  return data;
}
async function tenant(env, slug = 'whip-equipped') {
  const rows = await sb(env, `tenants?slug=eq.${encodeURIComponent(slug)}&select=*`);
  if (!rows?.length) throw new Error('Tenant not found');
  return rows[0];
}
async function tenantById(env, id) {
  const rows = await sb(env, `tenants?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}
async function patchTenant(env, id, patch) {
  const rows = await sb(env, `tenants?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  return rows?.[0] || null;
}
async function authUser(req, env) {
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: auth } });
    if (res.ok) return res.json();
  }
  if (env.ALLOW_DEMO_IDENTITIES === 'true') {
    return { id: req.headers.get('x-we-user-id') || 'demo-user', email: 'demo@whipequipped.local', demo: true };
  }
  return null;
}
async function requireUser(req, env) {
  const user = await authUser(req, env);
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
  return user;
}
async function requireOperator(req, env, tenantId, roles = ['owner','admin']) {
  const user = await requireUser(req, env);
  // Demo role headers and email matching are not operator authority. Require
  // an immutable authenticated account ID linked to the operator and role.
  if (user.demo) throw Object.assign(new Error('Verified operator login required'), { status: 403 });
  const rows = await sb(env, `operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&auth_user_id=eq.${encodeURIComponent(user.id)}&select=role,auth_user_id&limit=1`);
  if (!rows?.length || !roles.includes(rows[0].role))
    throw Object.assign(new Error('Insufficient operator role'), { status: 403 });
  return user;
}
function requestIdentity(req, user, fallback) { return user?.id || req.headers.get('x-we-user-id') || fallback; }
function safeSlug(value) { return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
function appUrl(env, path = '') { return `${String(env.PUBLIC_APP_URL || 'https://example.com').replace(/\/$/, '')}${path}`; }

async function getRide(env, id) { const rows = await sb(env, `rides?id=eq.${encodeURIComponent(id)}&select=*`); return rows?.[0] || null; }
async function patchRide(env, id, patch) {
  const rows = await sb(env, `rides?id=eq.${encodeURIComponent(id)}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  return rows?.[0] || null;
}
async function getRental(env, id) { const rows = await sb(env, `rental_bookings?id=eq.${encodeURIComponent(id)}&select=*`); return rows?.[0] || null; }
async function patchRental(env, id, patch) {
  const rows = await sb(env, `rental_bookings?id=eq.${encodeURIComponent(id)}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  return rows?.[0] || null;
}
async function recordPayment(env, payment) {
  const rows = await sb(env, 'payments?select=*', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payment) });
  return rows?.[0] || null;
}
async function updatePayments(env, filter, patch) {
  return sb(env, `payments?${filter}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
}
async function ensureStripeTenant(env, t) {
  if (!stripeConfigured(env)) throw Object.assign(new Error('Stripe payments are not configured'), { status: 503 });
  if (!t.stripe_account_id) throw Object.assign(new Error('Operator must finish Stripe Connect onboarding before accepting payments'), { status: 409 });
  if (!t.stripe_charges_enabled) {
    const account = await retrieveConnectedAccount(env, t.stripe_account_id);
    const refreshed = await patchTenant(env, t.id, {
      stripe_charges_enabled: Boolean(account.charges_enabled), stripe_payouts_enabled: Boolean(account.payouts_enabled), stripe_details_submitted: Boolean(account.details_submitted)
    });
    if (!refreshed?.stripe_charges_enabled) throw Object.assign(new Error('Stripe account is not ready to accept charges'), { status: 409 });
    return refreshed;
  }
  return t;
}

/* A verified Stripe signature proves Stripe sent the event, not which
   McCluster tenant or transaction it may change. Each state change below first
   binds the event to the resource it names: that resource's tenant must own
   the connected account the event arrived on, a stored intent/session id must
   match, and amount and currency must equal the ledger's. Mismatches are
   claimed (so Stripe stops retrying) and reported, never applied. */
function ignored(reason) { return { ignored: true, reason }; }
/* Keep a lease in the existing event_type column while an event is in
   flight, and change it to the real Stripe type ONLY after all ledger writes
   succeed. Existing completed rows already contain the real event type. This
   requires no production schema change. A duplicate pending delivery gets 503
   (Stripe retries), never a premature 200. A crashed Worker lease can be
   recovered with a conditional compare-and-swap after fifteen minutes. */
const STRIPE_EVENT_LEASE_MS = 15 * 60_000;
async function claimStripeEvent(env, event, connectedAccountId) {
  const key = encodeURIComponent(event.id);
  const marker = 'processing:' + Date.now() + ':' + event.type;
  try {
    await sb(env, 'stripe_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ event_id: event.id, event_type: marker, stripe_account_id: connectedAccountId }) });
    return { marker };
  } catch (error) {
    if (!/23505|duplicate key|already exists|conflict/i.test(String(error?.message || ''))) throw error;
  }
  const rows = await sb(env, 'stripe_events?event_id=eq.' + key + '&select=event_type');
  const previous = rows?.[0]?.event_type;
  if (previous === event.type) return { duplicate: true };
  const pending = /^processing:(\d+):(.+)$/.exec(previous || '');
  if (!pending || pending[2] !== event.type)
    throw Object.assign(new Error('Stripe event has a conflicting claim'), { status: 409 });
  const age = Date.now() - Number(pending[1]);
  if (age >= STRIPE_EVENT_LEASE_MS) {
    const taken = await sb(env,
      'stripe_events?event_id=eq.' + key + '&event_type=eq.' + encodeURIComponent(previous) + '&select=event_id',
      { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ event_type: marker }) });
    if (taken?.length === 1) return { marker };
  }
  throw Object.assign(new Error('Stripe event processing is in progress; retry delivery'), { status: 503 });
}
async function finishStripeEvent(env, event, marker) {
  const rows = await sb(env,
    'stripe_events?event_id=eq.' + encodeURIComponent(event.id) + '&event_type=eq.' + encodeURIComponent(marker) + '&select=event_id',
    { method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ event_type: event.type, processed_at: new Date().toISOString() }) });
  if (rows?.length !== 1)
    throw Object.assign(new Error('Stripe event completion was not confirmed'), { status: 503 });
}
async function releaseStripeEvent(env, event, marker) {
  try {
    await sb(env, 'stripe_events?event_id=eq.' + encodeURIComponent(event.id) + '&event_type=eq.' + encodeURIComponent(marker),
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  } catch { /* lease will be retryable after the recovery deadline */ }
}
function sameAccount(tenant, connectedAccountId) { return Boolean(tenant?.stripe_account_id) && connectedAccountId === tenant.stripe_account_id; }
function sameCurrency(object) { return String(object?.currency || '').toLowerCase() === WHIP_CURRENCY; }
async function boundRide(env, object, connectedAccountId) {
  const id = object.metadata?.resource_id; if (!id) return { error: 'resource_missing' };
  const ride = await getRide(env, id); if (!ride) return { error: 'ride_not_found' };
  if (object.metadata?.tenant_id && object.metadata.tenant_id !== ride.tenant_id) return { error: 'tenant_mismatch' };
  const tenant = await tenantById(env, ride.tenant_id);
  if (!sameAccount(tenant, connectedAccountId)) return { error: 'account_mismatch' };
  if (ride.stripe_payment_intent_id && ride.stripe_payment_intent_id !== object.id) return { error: 'payment_intent_mismatch' };
  if (cents(object.amount) !== cents(ride.fare_cents) || !sameCurrency(object)) return { error: 'amount_mismatch' };
  return { ride, tenant };
}
async function boundRental(env, object, connectedAccountId, shape) {
  const id = object.metadata?.resource_id; if (!id) return { error: 'resource_missing' };
  const booking = await getRental(env, id); if (!booking) return { error: 'rental_not_found' };
  if (object.metadata?.tenant_id && object.metadata.tenant_id !== booking.tenant_id) return { error: 'tenant_mismatch' };
  const tenant = await tenantById(env, booking.tenant_id);
  if (!sameAccount(tenant, connectedAccountId)) return { error: 'account_mismatch' };
  if (shape === 'session') {
    if (booking.stripe_checkout_session_id && booking.stripe_checkout_session_id !== object.id) return { error: 'session_mismatch' };
    if (cents(object.amount_total) !== cents(booking.total_cents)) return { error: 'amount_mismatch' };
  } else {
    if (booking.stripe_payment_intent_id && booking.stripe_payment_intent_id !== object.id) return { error: 'payment_intent_mismatch' };
    if (cents(object.amount) !== cents(booking.total_cents)) return { error: 'amount_mismatch' };
  }
  if (!sameCurrency(object)) return { error: 'amount_mismatch' };
  return { booking, tenant };
}
async function boundPlatformTenant(env, object, connectedAccountId) {
  // Platform subscriptions are not Connect events: one arriving on a connected
  // account is not this platform's to apply.
  if (connectedAccountId) return { error: 'account_mismatch' };
  const id = object.metadata?.tenant_id; if (!id) return { error: 'resource_missing' };
  const tenant = await tenantById(env, id); if (!tenant) return { error: 'tenant_not_found' };
  return { tenant };
}
async function applyStripeEvent(env, event, object, connectedAccountId) {
  if (event.type === 'account.updated') {
    if (!connectedAccountId || connectedAccountId !== object.id) return ignored('account_mismatch');
    const rows = await sb(env, `tenants?stripe_account_id=eq.${encodeURIComponent(object.id)}&select=id`);
    for (const row of rows || []) await patchTenant(env, row.id, {
      stripe_charges_enabled: Boolean(object.charges_enabled), stripe_payouts_enabled: Boolean(object.payouts_enabled), stripe_details_submitted: Boolean(object.details_submitted)
    });
    return { applied: event.type, tenants: (rows || []).length };
  }

  if (event.type === 'checkout.session.completed') {
    const kind = object.metadata?.kind;
    if (kind === 'we_white_label') {
      const bound = await boundPlatformTenant(env, object, connectedAccountId); if (bound.error) return ignored(bound.error);
      if (bound.tenant.stripe_subscription_id && typeof object.subscription === 'string' && bound.tenant.stripe_subscription_id !== object.subscription) return ignored('subscription_mismatch');
      await patchTenant(env, bound.tenant.id, {
        stripe_customer_id: typeof object.customer === 'string' ? object.customer : null,
        stripe_subscription_id: typeof object.subscription === 'string' ? object.subscription : null,
        subscription_status: 'active', white_label_enabled: true, platform_fee_percent: 0
      });
      return { applied: event.type };
    }
    if (kind === 'rental') {
      const bound = await boundRental(env, object, connectedAccountId, 'session'); if (bound.error) return ignored(bound.error);
      const intent = typeof object.payment_intent === 'string' ? object.payment_intent : null;
      await patchRental(env, bound.booking.id, { payment_status: object.payment_status === 'paid' ? 'paid' : 'processing', stripe_checkout_session_id: object.id, stripe_payment_intent_id: intent });
      await updatePayments(env, `tenant_id=eq.${encodeURIComponent(bound.tenant.id)}&stripe_checkout_session_id=eq.${encodeURIComponent(object.id)}`, { status: object.payment_status === 'paid' ? 'paid' : 'processing', stripe_payment_intent_id: intent });
      return { applied: event.type };
    }
    return ignored('unknown_kind');
  }

  if (event.type === 'checkout.session.async_payment_succeeded' || event.type === 'checkout.session.async_payment_failed') {
    if (object.metadata?.kind !== 'rental') return ignored('unknown_kind');
    const bound = await boundRental(env, object, connectedAccountId, 'session'); if (bound.error) return ignored(bound.error);
    const status = event.type.endsWith('succeeded') ? 'paid' : 'failed';
    await patchRental(env, bound.booking.id, { payment_status: status });
    await updatePayments(env, `tenant_id=eq.${encodeURIComponent(bound.tenant.id)}&stripe_checkout_session_id=eq.${encodeURIComponent(object.id)}`, { status });
    return { applied: event.type };
  }

  if (event.type === 'payment_intent.amount_capturable_updated' || event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
    const kind = object.metadata?.kind;
    const status = event.type === 'payment_intent.amount_capturable_updated' ? 'authorized' : event.type === 'payment_intent.succeeded' ? 'paid' : event.type === 'payment_intent.payment_failed' ? 'failed' : 'canceled';
    let tenant;
    if (kind === 'ride') {
      const bound = await boundRide(env, object, connectedAccountId); if (bound.error) return ignored(bound.error);
      tenant = bound.tenant;
      await patchRide(env, bound.ride.id, status === 'failed' || status === 'canceled' ? { payment_status: status } : { payment_status: status, stripe_payment_intent_id: object.id });
    } else if (kind === 'rental' && (status === 'paid' || status === 'failed')) {
      const bound = await boundRental(env, object, connectedAccountId, 'intent'); if (bound.error) return ignored(bound.error);
      tenant = bound.tenant;
      await patchRental(env, bound.booking.id, status === 'paid' ? { payment_status: 'paid', stripe_payment_intent_id: object.id } : { payment_status: 'failed' });
    } else return ignored('unknown_kind');
    await updatePayments(env, `tenant_id=eq.${encodeURIComponent(tenant.id)}&stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status });
    return { applied: event.type };
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const bound = await boundPlatformTenant(env, object, connectedAccountId); if (bound.error) return ignored(bound.error);
    if (bound.tenant.stripe_subscription_id && bound.tenant.stripe_subscription_id !== object.id) return ignored('subscription_mismatch');
    const active = event.type !== 'customer.subscription.deleted' && ['active','trialing'].includes(object.status);
    await patchTenant(env, bound.tenant.id, {
      subscription_status: object.status || (active ? 'active' : 'canceled'),
      white_label_enabled: active,
      platform_fee_percent: active ? 0 : 0.03
    });
    return { applied: event.type };
  }
  return ignored('unhandled_event');
}
export async function processStripeEvent(env, event) {
  const object = event.data?.object || {}, connectedAccountId = event.account || null;
  const claim = await claimStripeEvent(env, event, connectedAccountId);
  if (claim.duplicate) return { duplicate: true };
  try {
    const result = await applyStripeEvent(env, event, object, connectedAccountId);
    await finishStripeEvent(env, event, claim.marker);
    return { duplicate: false, ...result };
  } catch (error) {
    await releaseStripeEvent(env, event, claim.marker);
    throw error;
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (!requiredEnv(env)) return fail(env, 'Backend environment is not configured', 503);
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/api/stripe/webhook' && req.method === 'POST') {
        const raw = await req.text();
        const event = await verifyStripeWebhook(raw, req.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
        const result = await processStripeEvent(env, event);
        return reply(env, { received: true, ...result });
      }

      if (path === '/health' && req.method === 'GET') return reply(env, {
        ok: true, service: 'whip-equipped-core', version: 3,
        products: ['rider','driver','rentals','operators'],
        payments: stripeConfigured(env) ? 'stripe-configured' : 'stripe-not-configured'
      });

      if (path === '/api/config' && req.method === 'GET') {
        let t;
        const hostname = url.searchParams.get('hostname');
        if (hostname) {
          const domains = await sb(env, `tenant_domains?hostname=eq.${encodeURIComponent(hostname.toLowerCase())}&verified=eq.true&select=tenant_id`);
          t = domains?.[0] ? await tenantById(env, domains[0].tenant_id) : null;
        }
        if (!t) t = await tenant(env, url.searchParams.get('tenant') || 'whip-equipped');
        return reply(env, { tenant: {
          id: t.id, slug: t.slug, name: t.name, logo_url: t.logo_url, primary_color: t.primary_color,
          secondary_color: t.secondary_color, tagline: t.tagline, white_label_enabled: t.white_label_enabled,
          platform_fee_percent: Number(t.platform_fee_percent), subscription_status: t.subscription_status
        }, stripe_publishable_key: env.STRIPE_PUBLISHABLE_KEY || null });
      }

      // OPERATOR / WHITE-LABEL ONBOARDING
      if (path === '/api/operators' && req.method === 'POST') {
        const user = await requireUser(req, env); const body = await req.json();
        const slug = safeSlug(body.slug || body.name); if (!body.name || !slug) return fail(env, 'name is required');
        const rows = await sb(env, 'tenants?select=*', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
          name: body.name, slug, contact_email: body.email || user.email || null,
          primary_color: body.primary_color || '#F04449', secondary_color: body.secondary_color || '#F6AD62',
          tagline: body.tagline || 'IN THIS TOGETHER', white_label_enabled: false, platform_fee_percent: 0.03, subscription_status: 'network'
        }) });
        const t = rows[0];
        await sb(env, 'operator_members', { method: 'POST', body: JSON.stringify({ tenant_id: t.id, auth_user_id: user.id, email: body.email || user.email, role: 'owner' }) });
        return reply(env, { tenant: t }, 201);
      }

      const connectAccountMatch = path.match(/^\/api\/operators\/([^/]+)\/stripe\/account$/);
      if (connectAccountMatch && req.method === 'POST') {
        const tenantId = connectAccountMatch[1]; await requireOperator(req, env, tenantId);
        let t = await tenantById(env, tenantId); if (!t) return fail(env, 'Tenant not found', 404);
        if (!stripeConfigured(env)) return fail(env, 'Stripe is not configured', 503);
        if (!t.stripe_account_id) {
          const body = await req.json().catch(() => ({}));
          const account = await createConnectedAccount(env, { tenantId: t.id, tenantSlug: t.slug, email: body.email || t.contact_email, businessName: t.name });
          t = await patchTenant(env, t.id, { stripe_account_id: account.id, stripe_charges_enabled: Boolean(account.charges_enabled), stripe_payouts_enabled: Boolean(account.payouts_enabled), stripe_details_submitted: Boolean(account.details_submitted) });
        }
        return reply(env, { tenant: t });
      }

      const onboardingMatch = path.match(/^\/api\/operators\/([^/]+)\/stripe\/onboarding-link$/);
      if (onboardingMatch && req.method === 'POST') {
        const tenantId = onboardingMatch[1]; await requireOperator(req, env, tenantId); const t = await tenantById(env, tenantId);
        if (!t?.stripe_account_id) return fail(env, 'Create the connected account first', 409);
        // Stripe onboarding must return to the platform's verified operator
        // room. Caller-chosen URLs could redirect operators to a phishing
        // domain after sensitive financial onboarding.
        const link = await createAccountLink(env, t.stripe_account_id, {
          returnUrl: appUrl(env, `/whip/rider/operator.html?tenant=${encodeURIComponent(t.id)}&stripe=return`),
          refreshUrl: appUrl(env, `/whip/rider/operator.html?tenant=${encodeURIComponent(t.id)}&stripe=refresh`)
        });
        return reply(env, { url: link.url, expires_at: link.expires_at });
      }

      const connectStatusMatch = path.match(/^\/api\/operators\/([^/]+)\/stripe\/status$/);
      if (connectStatusMatch && req.method === 'GET') {
        const tenantId = connectStatusMatch[1]; await requireOperator(req, env, tenantId, ['owner','admin','finance']); const t = await tenantById(env, tenantId);
        if (!t?.stripe_account_id) return reply(env, { connected: false, ready: false });
        const account = await retrieveConnectedAccount(env, t.stripe_account_id);
        const updated = await patchTenant(env, t.id, { stripe_charges_enabled: Boolean(account.charges_enabled), stripe_payouts_enabled: Boolean(account.payouts_enabled), stripe_details_submitted: Boolean(account.details_submitted) });
        return reply(env, { connected: true, ready: connectedAccountReady(account), account_id: account.id, charges_enabled: account.charges_enabled, payouts_enabled: account.payouts_enabled, details_submitted: account.details_submitted, tenant: updated });
      }

      const whiteLabelMatch = path.match(/^\/api\/operators\/([^/]+)\/white-label\/checkout$/);
      if (whiteLabelMatch && req.method === 'POST') {
        const tenantId = whiteLabelMatch[1]; await requireOperator(req, env, tenantId); const t = await tenantById(env, tenantId); if (!t) return fail(env, 'Tenant not found', 404);
        const session = await createWhiteLabelSubscriptionCheckout(env, {
          tenantId: t.id, tenantSlug: t.slug, email: t.contact_email,
          successUrl: appUrl(env, `/whip/rider/operator.html?tenant=${encodeURIComponent(t.id)}&white_label=success`),
          cancelUrl: appUrl(env, `/whip/rider/operator.html?tenant=${encodeURIComponent(t.id)}&white_label=cancel`)
        });
        await recordPayment(env, { tenant_id: t.id, resource_type: 'white_label_subscription', resource_id: t.id, stripe_checkout_session_id: session.id, amount_cents: 3300, application_fee_cents: 0, status: 'checkout_created' });
        return reply(env, { checkout_url: session.url, session_id: session.id });
      }

      const operatorDashboard = path.match(/^\/api\/operators\/([^/]+)\/dashboard$/);
      if (operatorDashboard && req.method === 'GET') {
        const tenantId = operatorDashboard[1]; await requireOperator(req, env, tenantId, ['owner','admin','finance']); const t = await tenantById(env, tenantId); if (!t) return fail(env, 'Tenant not found', 404);
        const [rides, rentals, vehicles, payments] = await Promise.all([
          sb(env, `rides?tenant_id=eq.${t.id}&select=id,status,fare_cents,requested_at&order=requested_at.desc&limit=25`),
          sb(env, `rental_bookings?tenant_id=eq.${t.id}&select=id,status,total_cents,payment_status,created_at&order=created_at.desc&limit=25`),
          sb(env, `rental_vehicles?tenant_id=eq.${t.id}&select=*`),
          sb(env, `payments?tenant_id=eq.${t.id}&select=*&order=created_at.desc&limit=50`)
        ]);
        return reply(env, { tenant: t, rides, rentals, vehicles, payments });
      }

      // PARTNER / AFFILIATE CATALOG
      if (path === '/api/partners' && req.method === 'GET') {
        const category = url.searchParams.get('category'); const enabled = url.searchParams.get('include_candidates') === '1' ? '' : '&enabled=eq.true';
        const filter = category ? `&category=eq.${encodeURIComponent(category)}` : '';
        const rows = await sb(env, `partner_catalog?select=*${enabled}${filter}&order=name.asc`);
        return reply(env, { partners: rows || [] });
      }
      const partnerReferral = path.match(/^\/api\/partners\/([^/]+)\/referrals$/);
      if (partnerReferral && req.method === 'POST') {
        const user = await requireUser(req, env); const body = await req.json();
        const partners = await sb(env, `partner_catalog?slug=eq.${encodeURIComponent(partnerReferral[1])}&enabled=eq.true&select=*`); const partner = partners?.[0];
        if (!partner) return fail(env, 'Partner is not live', 404);
        const t = await tenant(env, body.tenant_slug || 'whip-equipped');
        const rows = await sb(env, 'partner_referrals?select=*', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ partner_id: partner.id, tenant_id: t.id, customer_id: user.id, resource_type: body.resource_type || null, resource_id: body.resource_id || null, source: body.source || 'app', metadata: body.metadata || {} }) });
        return reply(env, { referral: rows[0], partner }, 201);
      }

      // RIDESHARE
      if (path === '/api/rides' && req.method === 'POST') {
        await requireUser(req, env);
        // Legacy ride creation accepted client-chosen fare, trip length and
        // endpoints. It cannot safely create paid work. The signed-quote gate
        // in the separately reviewed booking PR intercepts this route before
        // reaching the core. Fail closed when that gate is not installed.
        return fail(env, 'A verified server-issued quote is required to book a ride', 428);
      }
      const rideMatch = path.match(/^\/api\/rides\/([^/]+)$/);
      if (rideMatch && req.method === 'GET') { await requireUser(req, env); const ride = await getRide(env, rideMatch[1]); return ride ? reply(env, { ride }) : fail(env, 'Ride not found', 404); }

      const ridePaymentMatch = path.match(/^\/api\/rides\/([^/]+)\/payment-intent$/);
      if (ridePaymentMatch && req.method === 'POST') {
        await requireUser(req, env); const ride = await getRide(env, ridePaymentMatch[1]); if (!ride) return fail(env, 'Ride not found', 404); let t = await tenantById(env, ride.tenant_id); t = await ensureStripeTenant(env, t);
        if (ride.stripe_payment_intent_id) return reply(env, { payment_intent_id: ride.stripe_payment_intent_id, connected_account_id: t.stripe_account_id, publishable_key: env.STRIPE_PUBLISHABLE_KEY || null, status: ride.payment_status });
        const intent = await createManualPaymentIntent(env, { amountCents: ride.fare_cents, applicationFeeCents: ride.platform_fee_cents, connectedAccountId: t.stripe_account_id, kind: 'ride', tenantId: t.id, resourceId: ride.id, description: `${ride.ride_tier}: ${ride.pickup_label} to ${ride.dropoff_label}` });
        await recordPayment(env, { tenant_id: t.id, resource_type: 'ride', resource_id: ride.id, connected_account_id: t.stripe_account_id, stripe_payment_intent_id: intent.id, amount_cents: ride.fare_cents, application_fee_cents: ride.platform_fee_cents, status: intent.status });
        await patchRide(env, ride.id, { stripe_payment_intent_id: intent.id, payment_status: intent.status });
        return reply(env, { payment_intent_id: intent.id, client_secret: intent.client_secret, connected_account_id: t.stripe_account_id, publishable_key: env.STRIPE_PUBLISHABLE_KEY || null, status: intent.status });
      }

      if (path === '/api/offers' && req.method === 'GET') { const rows = await sb(env, 'rides?status=eq.REQUESTED&payment_status=in.(authorized,paid,unpaid)&order=requested_at.asc&limit=20&select=*'); return reply(env, { offers: rows || [] }); }
      const acceptMatch = path.match(/^\/api\/rides\/([^/]+)\/accept$/);
      if (acceptMatch && req.method === 'POST') {
        const body = await req.json(), current = await getRide(env, acceptMatch[1]); if (!current) return fail(env, 'Ride not found', 404); if (current.status !== 'REQUESTED') return fail(env, 'Ride is no longer available', 409);
        if (!body.driver_id) return fail(env, 'driver_id is required');
        const drivers = await sb(env, `drivers?id=eq.${encodeURIComponent(body.driver_id)}&select=*`), driver = drivers?.[0];
        if (!driver || !driver.online || driver.tenant_id !== current.tenant_id)
          return fail(env, 'An available driver from this operator is required', 403);
        // The final update checks status, assignment and payment again INSIDE
        // the database update. Two drivers cannot both claim one REQUESTED ride.
        // The outer gateway separately verifies the authenticated driver's ID.
        const accepted = await sb(env,
          `rides?id=eq.${encodeURIComponent(current.id)}&tenant_id=eq.${encodeURIComponent(driver.tenant_id)}&status=eq.REQUESTED&driver_id=is.null&payment_status=in.(authorized,paid)&select=*`,
          {method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({
            status:'ACCEPTED',driver_id:driver.id,accepted_at:new Date().toISOString(),
            driver_name:driver.display_name,
            driver_vehicle:[driver.vehicle_color,driver.vehicle_make,driver.vehicle_model].filter(Boolean).join(' '),
            driver_plate:driver.license_plate,driver_rating:driver.rating
          })});
        if (!accepted?.length) return fail(env, 'Ride already accepted or payment is unavailable', 409);
        return reply(env, { ride:accepted[0] });
      }
      const statusMatch = path.match(/^\/api\/rides\/([^/]+)\/status$/);
      if (statusMatch && req.method === 'PATCH') {
        const body = await req.json(), current = await getRide(env, statusMatch[1]); if (!current) return fail(env, 'Ride not found', 404); const next = String(body.status || '').toUpperCase();
        if (!TRANSITIONS[current.status]?.includes(next)) return fail(env, `Illegal transition ${current.status} -> ${next}`, 409); if (current.driver_id && body.driver_id && current.driver_id !== body.driver_id) return fail(env, 'Ride belongs to another driver', 403);
        if (next === 'COMPLETED' && current.stripe_payment_intent_id && current.payment_status !== 'authorized') return fail(env, 'Ride payment is not authorized for capture', 402);
        const timestamps = {}; if (next === 'DRIVER_ARRIVED') timestamps.arrived_at = new Date().toISOString(); if (next === 'IN_PROGRESS') timestamps.started_at = new Date().toISOString(); if (next === 'COMPLETED') timestamps.completed_at = new Date().toISOString();
        // The transition is claimed INSIDE the database update: the row must
        // still hold the status this request read, so two concurrent cancel or
        // complete requests cannot both act, and the Stripe side effect below
        // runs for the one request that won.
        const claimed = await sb(env,
          `rides?id=eq.${encodeURIComponent(current.id)}&status=eq.${encodeURIComponent(current.status)}${current.driver_id ? `&driver_id=eq.${encodeURIComponent(current.driver_id)}` : ''}&select=*`,
          { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: next, ...timestamps, updated_at: new Date().toISOString() }) });
        if (!claimed?.length) return fail(env, 'Ride changed before this update; refresh and try again', 409);
        if (current.stripe_payment_intent_id && (next === 'COMPLETED' || (next === 'CANCELED' && !['paid','canceled'].includes(current.payment_status)))) {
          const t = await tenantById(env, current.tenant_id);
          try {
            // The key binds the action to this ride, so a retried request can
            // never capture or release the same authorization twice.
            if (next === 'COMPLETED') await capturePaymentIntent(env, current.stripe_payment_intent_id, t.stripe_account_id, current.fare_cents, `whip-ride-${current.id}-capture`);
            else await cancelPaymentIntent(env, current.stripe_payment_intent_id, t.stripe_account_id, `whip-ride-${current.id}-cancel`);
          } catch (error) {
            // The money did not move: give the ride back the status it had.
            await sb(env, `rides?id=eq.${encodeURIComponent(current.id)}&status=eq.${encodeURIComponent(next)}&select=id`,
              { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: current.status, completed_at: current.completed_at ?? null, updated_at: new Date().toISOString() }) }).catch(() => {});
            return fail(env, `Payment ${next === 'COMPLETED' ? 'capture' : 'release'} failed: ${error.message}`, 502);
          }
        }
        return reply(env, { ride: claimed[0] });
      }
      const presenceMatch = path.match(/^\/api\/drivers\/([^/]+)\/presence$/);
      if (presenceMatch && req.method === 'PATCH') {
        const body = await req.json(), rows = await sb(env, `drivers?id=eq.${encodeURIComponent(presenceMatch[1])}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ online: Boolean(body.online), lat: body.lat ?? null, lng: body.lng ?? null, heading: body.heading ?? null, last_seen_at: new Date().toISOString() }) }); return reply(env, { driver: rows?.[0] || null });
      }
      const activeDriver = path.match(/^\/api\/drivers\/([^/]+)\/active$/);
      if (activeDriver && req.method === 'GET') { const rows = await sb(env, `rides?driver_id=eq.${encodeURIComponent(activeDriver[1])}&status=not.in.(COMPLETED,CANCELED)&order=requested_at.desc&limit=1&select=*`); return reply(env, { ride: rows?.[0] || null }); }
      const activeRider = path.match(/^\/api\/riders\/([^/]+)\/active$/);
      if (activeRider && req.method === 'GET') { const rows = await sb(env, `rides?rider_id=eq.${encodeURIComponent(activeRider[1])}&status=not.in.(COMPLETED,CANCELED)&order=requested_at.desc&limit=1&select=*`); return reply(env, { ride: rows?.[0] || null }); }

      // RENTALS
      if (path === '/api/rentals/vehicles' && req.method === 'GET') {
        const t = await tenant(env, url.searchParams.get('tenant') || 'whip-equipped'); const category = url.searchParams.get('category'); const filter = category && category !== 'all' ? `&category=eq.${encodeURIComponent(category)}` : '';
        const rows = await sb(env, `rental_vehicles?tenant_id=eq.${t.id}&available=eq.true${filter}&order=daily_rate_cents.asc&select=*`); return reply(env, { vehicles: rows || [] });
      }
      if (path === '/api/rentals/bookings' && req.method === 'POST') {
        const user = await requireUser(req, env); const body = await req.json(), t = await tenant(env, body.tenant_slug || 'whip-equipped');
        const vehicleRows = await sb(env, `rental_vehicles?id=eq.${encodeURIComponent(body.vehicle_id || '')}&tenant_id=eq.${t.id}&available=eq.true&select=*`), vehicle = vehicleRows?.[0]; if (!vehicle) return fail(env, 'Rental vehicle not found or unavailable', 404);
        const quote = rentalQuote(vehicle, t, body); if (quote.error) return fail(env, quote.error, 400);
        const booking = { tenant_id: t.id, vehicle_id: vehicle.id, renter_id: requestIdentity(req, user, 'demo-renter'), status: 'CHECKIN_REQUIRED', start_at: body.start_at, end_at: body.end_at, pickup_label: body.pickup_label || vehicle.location_label, rental_days: quote.days, daily_rate_cents: quote.daily_rate_cents, extras_cents: quote.extras_cents, protection_cents: quote.protection_cents, tax_cents: quote.tax_cents, platform_fee_cents: quote.platform_fee_cents, total_cents: quote.total_cents, payment_status: 'unpaid' };
        const rows = await sb(env, 'rental_bookings?select=*', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(booking) }); return reply(env, { booking: rows[0], vehicle }, 201);
      }
      const rentalMatch = path.match(/^\/api\/rentals\/bookings\/([^/]+)$/);
      if (rentalMatch && req.method === 'GET') { await requireUser(req, env); const booking = await getRental(env, rentalMatch[1]); if (!booking) return fail(env, 'Rental booking not found', 404); const vehicleRows = await sb(env, `rental_vehicles?id=eq.${encodeURIComponent(booking.vehicle_id)}&select=*`); return reply(env, { booking, vehicle: vehicleRows?.[0] || null }); }

      const rentalCheckout = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/checkout$/);
      if (rentalCheckout && req.method === 'POST') {
        const user = await requireUser(req, env);
        const booking = await getRental(env, rentalCheckout[1]); if (!booking) return fail(env, 'Rental booking not found', 404);
        if (booking.payment_status === 'paid' || booking.payment_status === 'processing')
          return fail(env, 'Payment already submitted; check the booking status', 409);
        let t = await tenantById(env, booking.tenant_id); t = await ensureStripeTenant(env, t);
        if (booking.stripe_checkout_session_id) {
          /* Never replace a still-payable checkout and then ignore its webhook.
             Reuse the exact session or fail closed if it expired or completed. */
          const existing = await retrieveCheckoutSession(env, booking.stripe_checkout_session_id, t.stripe_account_id);
          if (existing.status === 'open' && existing.url)
            return reply(env, { checkout_url: existing.url, session_id: existing.id, amount_cents: booking.total_cents, reused: true });
          return fail(env, 'The earlier checkout is no longer open; check payment status or create a new rental booking', 409);
        }
        const vehicleRows = await sb(env, 'rental_vehicles?id=eq.' + encodeURIComponent(booking.vehicle_id) + '&select=*');
        const vehicle = vehicleRows?.[0];
        const rentalReturn = status => appUrl(env, '/whip/rentals/?rental_payment=' + status + '&booking_id=' + encodeURIComponent(booking.id));
        /* Stripe deduplicates concurrent and lost-response POSTs for this exact
           booking. Combined with the stored-session gate, a second payable
           Checkout Session cannot replace the original. */
        const session = await createDirectCheckout(env, {
          amountCents: booking.total_cents, applicationFeeCents: booking.platform_fee_cents, connectedAccountId: t.stripe_account_id,
          kind: 'rental', tenantId: t.id, resourceId: booking.id, description: (vehicle?.name || 'Vehicle') + ' rental', customerEmail: user.email,
          successUrl: rentalReturn('success'), cancelUrl: rentalReturn('cancel'),
          idempotencyKey: 'whip-rental-' + booking.id + '-checkout-v1'
        });
        const bound = await sb(env,
          'rental_bookings?id=eq.' + encodeURIComponent(booking.id) + '&stripe_checkout_session_id=is.null&select=id',
          { method: 'PATCH', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ stripe_checkout_session_id: session.id, payment_status: 'checkout_created', updated_at: new Date().toISOString() }) });
        if (bound?.length !== 1) {
          const latest = await getRental(env, booking.id);
          if (latest?.stripe_checkout_session_id !== session.id)
            throw Object.assign(new Error('Another checkout was recorded; inspect the booking before retrying'), { status: 409 });
          return reply(env, { checkout_url: session.url, session_id: session.id, amount_cents: booking.total_cents, reused: true });
        }
        await recordPayment(env, { tenant_id: t.id, resource_type: 'rental', resource_id: booking.id, connected_account_id: t.stripe_account_id, stripe_checkout_session_id: session.id, amount_cents: booking.total_cents, application_fee_cents: booking.platform_fee_cents, status: 'checkout_created' });
        return reply(env, { checkout_url: session.url, session_id: session.id, amount_cents: booking.total_cents });
      }

      const rentalStatus = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/status$/);
      if (rentalStatus && req.method === 'PATCH') {
        const body = await req.json(), current = await getRental(env, rentalStatus[1]); if (!current) return fail(env, 'Rental booking not found', 404); const next = String(body.status || '').toUpperCase();
        if (!RENTAL_TRANSITIONS[current.status]?.includes(next)) return fail(env, `Illegal rental transition ${current.status} -> ${next}`, 409);
        if (next === 'ACTIVE' && current.payment_status !== 'paid') return fail(env, 'Rental payment must be completed before pickup', 402);
        const patch = { status: next }; if (next === 'ACTIVE') patch.activated_at = new Date().toISOString(); if (next === 'COMPLETED') patch.completed_at = new Date().toISOString(); return reply(env, { booking: await patchRental(env, current.id, patch) });
      }
      const rentalCheckin = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/checkin$/);
      if (rentalCheckin && req.method === 'PATCH') {
        const body = await req.json(), current = await getRental(env, rentalCheckin[1]); if (!current) return fail(env, 'Rental booking not found', 404); if (!['CHECKIN_REQUIRED','READY_FOR_PICKUP'].includes(current.status)) return fail(env, 'Check-in is closed for this rental', 409);
        const allowed = ['license_verified','pretrip_photos_complete','pickup_instructions_seen']; const patch = {}; for (const key of allowed) if (key in body) patch[key] = Boolean(body[key]); const merged = { ...current, ...patch }; if (merged.license_verified && merged.pretrip_photos_complete && merged.pickup_instructions_seen) patch.status = 'READY_FOR_PICKUP'; return reply(env, { booking: await patchRental(env, current.id, patch) });
      }
      const rentalReturn = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/return$/);
      if (rentalReturn && req.method === 'PATCH') {
        const body = await req.json(), current = await getRental(env, rentalReturn[1]); if (!current) return fail(env, 'Rental booking not found', 404); if (current.status !== 'RETURN_DUE') return fail(env, 'Rental is not in return workflow', 409); return reply(env, { booking: await patchRental(env, current.id, { return_photos_complete: Boolean(body.return_photos_complete), fuel_return_confirmed: Boolean(body.fuel_return_confirmed) }) });
      }
      const renterRentals = path.match(/^\/api\/renters\/([^/]+)\/rentals$/);
      if (renterRentals && req.method === 'GET') { const rows = await sb(env, `rental_bookings?renter_id=eq.${encodeURIComponent(renterRentals[1])}&order=created_at.desc&limit=50&select=*`); return reply(env, { bookings: rows || [] }); }

      return fail(env, 'Not found', 404);
    } catch (error) {
      return fail(env, error.message || 'Backend request failed', error.status || 500, error.stripe || undefined);
    }
  }
};
