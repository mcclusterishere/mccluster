import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SK')!);
const SB = Deno.env.get('SUPABASE_URL')!;
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: H });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SRV);
  headers.set('Authorization', `Bearer ${SRV}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error('Database operation failed');
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const authorization = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: 'sign_in_first' }, 401);
    const auth = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRV, Authorization: authorization } });
    const actor = auth.ok ? await auth.json() : null;
    if (!actor?.id) return json({ error: 'sign_in_first' }, 401);
    const org = (await rest('orgs?slug=eq.level-3-media&select=id&limit=1'))?.[0];
    if (!org) return json({ error: 'organization_unavailable' }, 503);
    const owner = (await rest(`org_members?org_id=eq.${org.id}&profile_id=eq.${actor.id}&role=eq.owner&select=org_id&limit=1`))?.[0];
    if (!owner) return json({ error: 'owner_required' }, 403);

    const body = await req.json().catch(() => null);
    if (!body || !UUID.test(String(body.order_id || ''))) return json({ error: 'valid_order_id_required' }, 400);
    // A client-supplied UUID identifies one deliberate refund attempt, including retries.
    // It is NOT a substitute for the durable atomic reservation required for concurrency.
    if (!UUID.test(String(body.refund_request_id || ''))) return json({ error: 'refund_request_id_required' }, 400);
    const order = (await rest(`l3_orders?id=eq.${encodeURIComponent(body.order_id)}&org_id=eq.${org.id}&select=*&limit=1`))?.[0];
    if (!order?.stripe_payment_intent_id || !order?.connected_account_id) return json({ error: 'order_not_refundable' }, 409);
    if (['refunded', 'disputed'].includes(order.status)) return json({ error: 'already_closed' }, 409);
    if (order.status !== 'paid' && order.status !== 'partially_refunded') return json({ error: 'order_not_paid' }, 409);

    const intent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id, { expand: ['latest_charge'] }, { stripeAccount: order.connected_account_id });
    const charge = intent.latest_charge;
    if (!charge || typeof charge === 'string' || !charge.paid || charge.payment_intent !== order.stripe_payment_intent_id) {
      return json({ error: 'payment_not_verified' }, 409);
    }
    const total = Number(charge.amount);
    const refunded = Number(charge.amount_refunded || 0);
    const remaining = total - refunded;
    if (!Number.isSafeInteger(remaining) || remaining <= 0) return json({ error: 'nothing_refundable' }, 409);
    const amount = body.amount_cents === undefined || body.amount_cents === null ? remaining : body.amount_cents;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) return json({ error: 'invalid_refund_amount', remaining_cents: remaining }, 400);

    const refund = await stripe.refunds.create(
      { charge: charge.id, amount, metadata: { order_id: order.id, refund_request_id: body.refund_request_id } },
      { stripeAccount: order.connected_account_id, idempotencyKey: `l3-refund-${body.refund_request_id}` }
    );
    // Re-read Stripe's authoritative aggregate after refund creation.
    const current = await stripe.charges.retrieve(charge.id, {}, { stripeAccount: order.connected_account_id });
    const complete = Number(current.amount_refunded || 0) >= Number(current.amount);
    await rest(`l3_orders?id=eq.${order.id}&org_id=eq.${org.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: complete ? 'refunded' : 'partially_refunded', refunded_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    if (complete) await rest(`l3_entitlements?order_id=eq.${order.id}`, {
      method: 'PATCH', body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
    await rest('l3_activity', {
      method: 'POST',
      body: JSON.stringify({
        org_id: org.id, actor_user_id: actor.id, action: 'order_refund',
        subject_type: 'order', subject_id: order.id,
        details: { refund_id: refund.id, refund_request_id: body.refund_request_id, amount_cents: refund.amount },
      }),
    });
    return json({ ok: true, refund_id: refund.id, amount_cents: refund.amount, status: refund.status, fully_refunded: complete });
  } catch (error) {
    console.error('Level 3 refund operation failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'refund_operation_failed', message: 'Check Stripe and the refund ledger before retrying with the same refund_request_id.' }, 502);
  }
});
