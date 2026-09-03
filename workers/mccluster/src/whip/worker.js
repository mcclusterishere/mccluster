import {
  stripeConfigured,
  createConnectedAccount,
  retrieveConnectedAccount,
  connectedAccountReady,
  createAccountLink,
  createWhiteLabelSubscriptionCheckout,
  createDirectCheckout,
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
async function requireOperator(req, env, tenantId) {
  const user = await requireUser(req, env);
  if (user.demo && req.headers.get('x-we-role') === 'operator') return user;
  let rows = await sb(env, `operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&auth_user_id=eq.${encodeURIComponent(user.id)}&select=*`);
  if (!rows?.length && user.email) rows = await sb(env, `operator_members?tenant_id=eq.${encodeURIComponent(tenantId)}&email=eq.${encodeURIComponent(user.email)}&select=*`);
  if (!rows?.length) throw Object.assign(new Error('Operator access required'), { status: 403 });
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

async function processStripeEvent(env, event) {
  const prior = await sb(env, `stripe_events?event_id=eq.${encodeURIComponent(event.id)}&select=event_id`);
  if (prior?.length) return { duplicate: true };
  const object = event.data?.object || {};
  const connectedAccountId = event.account || null;

  if (event.type === 'account.updated') {
    const rows = await sb(env, `tenants?stripe_account_id=eq.${encodeURIComponent(object.id)}&select=id`);
    for (const row of rows || []) await patchTenant(env, row.id, {
      stripe_charges_enabled: Boolean(object.charges_enabled), stripe_payouts_enabled: Boolean(object.payouts_enabled), stripe_details_submitted: Boolean(object.details_submitted)
    });
  }

  if (event.type === 'checkout.session.completed') {
    const kind = object.metadata?.kind;
    const tenantId = object.metadata?.tenant_id;
    const resourceId = object.metadata?.resource_id;
    if (kind === 'we_white_label' && tenantId) {
      await patchTenant(env, tenantId, {
        stripe_customer_id: typeof object.customer === 'string' ? object.customer : null,
        stripe_subscription_id: typeof object.subscription === 'string' ? object.subscription : null,
        subscription_status: 'active', white_label_enabled: true, platform_fee_percent: 0
      });
    }
    if (kind === 'rental' && resourceId) {
      await patchRental(env, resourceId, {
        payment_status: object.payment_status === 'paid' ? 'paid' : 'processing',
        stripe_checkout_session_id: object.id,
        stripe_payment_intent_id: typeof object.payment_intent === 'string' ? object.payment_intent : null
      });
      await updatePayments(env, `stripe_checkout_session_id=eq.${encodeURIComponent(object.id)}`, {
        status: object.payment_status === 'paid' ? 'paid' : 'processing',
        stripe_payment_intent_id: typeof object.payment_intent === 'string' ? object.payment_intent : null
      });
    }
  }

  if (event.type === 'checkout.session.async_payment_succeeded') {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === 'rental' && resourceId) await patchRental(env, resourceId, { payment_status: 'paid' });
    await updatePayments(env, `stripe_checkout_session_id=eq.${encodeURIComponent(object.id)}`, { status: 'paid' });
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === 'rental' && resourceId) await patchRental(env, resourceId, { payment_status: 'failed' });
    await updatePayments(env, `stripe_checkout_session_id=eq.${encodeURIComponent(object.id)}`, { status: 'failed' });
  }

  if (event.type === 'payment_intent.amount_capturable_updated') {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === 'ride' && resourceId) await patchRide(env, resourceId, { payment_status: 'authorized', stripe_payment_intent_id: object.id });
    await updatePayments(env, `stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status: 'authorized' });
  }
  if (event.type === 'payment_intent.succeeded') {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === 'ride' && resourceId) await patchRide(env, resourceId, { payment_status: 'paid', stripe_payment_intent_id: object.id });
    if (object.metadata?.kind === 'rental' && resourceId) await patchRental(env, resourceId, { payment_status: 'paid', stripe_payment_intent_id: object.id });
    await updatePayments(env, `stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status: 'paid' });
  }
  if (event.type === 'payment_intent.payment_failed') {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === 'ride' && resourceId) await patchRide(env, resourceId, { payment_status: 'failed' });
    if (object.metadata?.kind === 'rental' && resourceId) await patchRental(env, resourceId, { payment_status: 'failed' });
    await updatePayments(env, `stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status: 'failed' });
  }
  if (event.type === 'payment_intent.canceled') {
    const resourceId = object.metadata?.resource_id;
    if (object.metadata?.kind === 'ride' && resourceId) await patchRide(env, resourceId, { payment_status: 'canceled' });
    await updatePayments(env, `stripe_payment_intent_id=eq.${encodeURIComponent(object.id)}`, { status: 'canceled' });
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const tenantId = object.metadata?.tenant_id;
    if (tenantId) {
      const active = event.type !== 'customer.subscription.deleted' && ['active','trialing'].includes(object.status);
      await patchTenant(env, tenantId, {
        stripe_subscription_id: object.id,
        subscription_status: object.status || (active ? 'active' : 'canceled'),
        white_label_enabled: active,
        platform_fee_percent: active ? 0 : 0.03
      });
    }
  }

  await sb(env, 'stripe_events', { method: 'POST', body: JSON.stringify({ event_id: event.id, event_type: event.type, stripe_account_id: connectedAccountId }) });
  return { duplicate: false };
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
        const body = await req.json().catch(() => ({}));
        const link = await createAccountLink(env, t.stripe_account_id, {
          returnUrl: body.return_url || appUrl(env, `/operator.html?tenant=${encodeURIComponent(t.id)}&stripe=return`),
          refreshUrl: body.refresh_url || appUrl(env, `/operator.html?tenant=${encodeURIComponent(t.id)}&stripe=refresh`)
        });
        return reply(env, { url: link.url, expires_at: link.expires_at });
      }

      const connectStatusMatch = path.match(/^\/api\/operators\/([^/]+)\/stripe\/status$/);
      if (connectStatusMatch && req.method === 'GET') {
        const tenantId = connectStatusMatch[1]; await requireOperator(req, env, tenantId); const t = await tenantById(env, tenantId);
        if (!t?.stripe_account_id) return reply(env, { connected: false, ready: false });
        const account = await retrieveConnectedAccount(env, t.stripe_account_id);
        const updated = await patchTenant(env, t.id, { stripe_charges_enabled: Boolean(account.charges_enabled), stripe_payouts_enabled: Boolean(account.payouts_enabled), stripe_details_submitted: Boolean(account.details_submitted) });
        return reply(env, { connected: true, ready: connectedAccountReady(account), account_id: account.id, charges_enabled: account.charges_enabled, payouts_enabled: account.payouts_enabled, details_submitted: account.details_submitted, tenant: updated });
      }

      const whiteLabelMatch = path.match(/^\/api\/operators\/([^/]+)\/white-label\/checkout$/);
      if (whiteLabelMatch && req.method === 'POST') {
        const tenantId = whiteLabelMatch[1]; await requireOperator(req, env, tenantId); const t = await tenantById(env, tenantId); if (!t) return fail(env, 'Tenant not found', 404);
        const body = await req.json().catch(() => ({}));
        const session = await createWhiteLabelSubscriptionCheckout(env, {
          tenantId: t.id, tenantSlug: t.slug, email: t.contact_email,
          successUrl: body.success_url || appUrl(env, `/operator.html?tenant=${encodeURIComponent(t.id)}&white_label=success`),
          cancelUrl: body.cancel_url || appUrl(env, `/operator.html?tenant=${encodeURIComponent(t.id)}&white_label=cancel`)
        });
        await recordPayment(env, { tenant_id: t.id, resource_type: 'white_label_subscription', resource_id: t.id, stripe_checkout_session_id: session.id, amount_cents: 3300, application_fee_cents: 0, status: 'checkout_created' });
        return reply(env, { checkout_url: session.url, session_id: session.id });
      }

      const operatorDashboard = path.match(/^\/api\/operators\/([^/]+)\/dashboard$/);
      if (operatorDashboard && req.method === 'GET') {
        const tenantId = operatorDashboard[1]; await requireOperator(req, env, tenantId); const t = await tenantById(env, tenantId); if (!t) return fail(env, 'Tenant not found', 404);
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
        const user = await requireUser(req, env); const body = await req.json(); const t = await tenant(env, body.tenant_slug || 'whip-equipped'); const fare = Math.max(0, Number(body.fare_cents || 0));
        const platformFee = t.white_label_enabled ? 0 : Math.round(fare * Number(t.platform_fee_percent || 0.03));
        const ride = { tenant_id: t.id, rider_id: requestIdentity(req, user, 'demo-rider'), rider_name: body.rider_name || user.user_metadata?.full_name || 'Rider', status: 'REQUESTED', pickup_label: body.pickup_label || 'Current location', pickup_lat: body.pickup_lat ?? null, pickup_lng: body.pickup_lng ?? null, dropoff_label: body.dropoff_label, dropoff_lat: body.dropoff_lat ?? null, dropoff_lng: body.dropoff_lng ?? null, miles: body.miles ?? null, minutes: body.minutes ?? null, ride_tier: body.ride_tier || 'WE Standard', fare_cents: fare, platform_fee_cents: platformFee, pickup_pin: String(Math.floor(1000 + Math.random() * 9000)), payment_status: 'unpaid' };
        if (!ride.dropoff_label || !fare) return fail(env, 'dropoff_label and fare_cents are required');
        const rows = await sb(env, 'rides?select=*', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(ride) }); return reply(env, { ride: rows[0] }, 201);
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
        if (!body.driver_id) return fail(env, 'driver_id is required'); const drivers = await sb(env, `drivers?id=eq.${encodeURIComponent(body.driver_id)}&select=*`), driver = drivers?.[0]; if (!driver) return fail(env, 'Driver not found', 404);
        const ride = await patchRide(env, current.id, { status: 'ACCEPTED', driver_id: driver.id, accepted_at: new Date().toISOString(), driver_name: driver.display_name, driver_vehicle: [driver.vehicle_color, driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(' '), driver_plate: driver.license_plate, driver_rating: driver.rating }); return reply(env, { ride });
      }
      const statusMatch = path.match(/^\/api\/rides\/([^/]+)\/status$/);
      if (statusMatch && req.method === 'PATCH') {
        const body = await req.json(), current = await getRide(env, statusMatch[1]); if (!current) return fail(env, 'Ride not found', 404); const next = String(body.status || '').toUpperCase();
        if (!TRANSITIONS[current.status]?.includes(next)) return fail(env, `Illegal transition ${current.status} -> ${next}`, 409); if (current.driver_id && body.driver_id && current.driver_id !== body.driver_id) return fail(env, 'Ride belongs to another driver', 403);
        const t = await tenantById(env, current.tenant_id);
        if (next === 'COMPLETED' && current.stripe_payment_intent_id) {
          if (current.payment_status !== 'authorized') return fail(env, 'Ride payment is not authorized for capture', 402);
          await capturePaymentIntent(env, current.stripe_payment_intent_id, t.stripe_account_id, current.fare_cents);
        }
        if (next === 'CANCELED' && current.stripe_payment_intent_id && !['paid','canceled'].includes(current.payment_status)) {
          await cancelPaymentIntent(env, current.stripe_payment_intent_id, t.stripe_account_id);
        }
        const timestamps = {}; if (next === 'DRIVER_ARRIVED') timestamps.arrived_at = new Date().toISOString(); if (next === 'IN_PROGRESS') timestamps.started_at = new Date().toISOString(); if (next === 'COMPLETED') timestamps.completed_at = new Date().toISOString();
        return reply(env, { ride: await patchRide(env, current.id, { status: next, ...timestamps }) });
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
        const days = Math.max(1, Number(body.rental_days || 1)), daily = Number(vehicle.daily_rate_cents), extras = Math.max(0, Number(body.extras_cents || 0)), protection = Math.max(0, Number(body.protection_cents || 0)), tax = Math.max(0, Number(body.tax_cents || 0));
        const subtotal = daily * days + extras + protection, total = subtotal + tax, platform = t.white_label_enabled ? 0 : Math.round(total * Number(t.platform_fee_percent || 0.03));
        const booking = { tenant_id: t.id, vehicle_id: vehicle.id, renter_id: requestIdentity(req, user, 'demo-renter'), status: 'CHECKIN_REQUIRED', start_at: body.start_at, end_at: body.end_at, pickup_label: body.pickup_label || vehicle.location_label, rental_days: days, daily_rate_cents: daily, extras_cents: extras, protection_cents: protection, tax_cents: tax, platform_fee_cents: platform, total_cents: total, payment_status: 'unpaid' };
        if (!booking.start_at || !booking.end_at) return fail(env, 'start_at and end_at are required');
        const rows = await sb(env, 'rental_bookings?select=*', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(booking) }); return reply(env, { booking: rows[0], vehicle }, 201);
      }
      const rentalMatch = path.match(/^\/api\/rentals\/bookings\/([^/]+)$/);
      if (rentalMatch && req.method === 'GET') { await requireUser(req, env); const booking = await getRental(env, rentalMatch[1]); if (!booking) return fail(env, 'Rental booking not found', 404); const vehicleRows = await sb(env, `rental_vehicles?id=eq.${encodeURIComponent(booking.vehicle_id)}&select=*`); return reply(env, { booking, vehicle: vehicleRows?.[0] || null }); }

      const rentalCheckout = path.match(/^\/api\/rentals\/bookings\/([^/]+)\/checkout$/);
      if (rentalCheckout && req.method === 'POST') {
        const user = await requireUser(req, env); const booking = await getRental(env, rentalCheckout[1]); if (!booking) return fail(env, 'Rental booking not found', 404); let t = await tenantById(env, booking.tenant_id); t = await ensureStripeTenant(env, t); const vehicleRows = await sb(env, `rental_vehicles?id=eq.${encodeURIComponent(booking.vehicle_id)}&select=*`); const vehicle = vehicleRows?.[0];
        const body = await req.json().catch(() => ({}));
        const session = await createDirectCheckout(env, {
          amountCents: booking.total_cents, applicationFeeCents: booking.platform_fee_cents, connectedAccountId: t.stripe_account_id,
          kind: 'rental', tenantId: t.id, resourceId: booking.id, description: `${vehicle?.name || 'Vehicle'} rental`, customerEmail: user.email,
          successUrl: body.success_url || appUrl(env, `/?rental_payment=success&booking_id=${encodeURIComponent(booking.id)}`),
          cancelUrl: body.cancel_url || appUrl(env, `/?rental_payment=cancel&booking_id=${encodeURIComponent(booking.id)}`)
        });
        await recordPayment(env, { tenant_id: t.id, resource_type: 'rental', resource_id: booking.id, connected_account_id: t.stripe_account_id, stripe_checkout_session_id: session.id, amount_cents: booking.total_cents, application_fee_cents: booking.platform_fee_cents, status: 'checkout_created' });
        await patchRental(env, booking.id, { stripe_checkout_session_id: session.id, payment_status: 'checkout_created' });
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
