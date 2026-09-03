const STRIPE_API = 'https://api.stripe.com/v1';

function appendForm(form, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => appendForm(form, `${key}[${i}]`, item));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([child, item]) => appendForm(form, `${key}[${child}]`, item));
    return;
  }
  form.append(key, String(value));
}

function toForm(params = {}) {
  const form = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendForm(form, key, value));
  return form;
}

export function stripeConfigured(env) {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export async function stripeRequest(env, path, params = {}, options = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  const method = options.method || 'POST';
  const form = toForm(params);
  const url = new URL(`${STRIPE_API}/${path.replace(/^\//, '')}`);
  if (method === 'GET') {
    for (const [key, value] of form.entries()) url.searchParams.append(key, value);
  }
  const headers = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'content-type': 'application/x-www-form-urlencoded'
  };
  if (options.account) headers['Stripe-Account'] = options.account;
  const response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : form.toString() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Stripe request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.stripe = data?.error || null;
    throw error;
  }
  return data;
}

export function connectedAccountReady(account) {
  return Boolean(account?.charges_enabled && account?.payouts_enabled && account?.details_submitted);
}

export async function createConnectedAccount(env, input = {}) {
  return stripeRequest(env, 'accounts', {
    type: 'express',
    country: input.country || 'US',
    email: input.email || undefined,
    business_profile: {
      name: input.businessName || undefined,
      product_description: input.productDescription || 'Local mobility, rideshare and vehicle rental services'
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: {
      we_tenant_id: input.tenantId || '',
      we_tenant_slug: input.tenantSlug || ''
    }
  });
}

export async function retrieveConnectedAccount(env, accountId) {
  return stripeRequest(env, `accounts/${encodeURIComponent(accountId)}`, {}, { method: 'GET' });
}

export async function createAccountLink(env, accountId, input = {}) {
  return stripeRequest(env, 'account_links', {
    account: accountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: 'account_onboarding',
    collection_options: { fields: 'eventually_due' }
  });
}

export async function createWhiteLabelSubscriptionCheckout(env, input = {}) {
  return stripeRequest(env, 'checkout/sessions', {
    mode: 'subscription',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.email || undefined,
    allow_promotion_codes: true,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: 3300,
        recurring: { interval: 'month' },
        product_data: {
          name: 'Whip Equipped White Label',
          description: '$33/month customer-facing white label with 0% WE transaction fee'
        }
      }
    }],
    subscription_data: {
      metadata: { kind: 'we_white_label', tenant_id: input.tenantId, tenant_slug: input.tenantSlug }
    },
    metadata: { kind: 'we_white_label', tenant_id: input.tenantId, tenant_slug: input.tenantSlug }
  });
}

export async function createDirectCheckout(env, input = {}) {
  const paymentIntentData = {
    metadata: { kind: input.kind, tenant_id: input.tenantId, resource_id: input.resourceId }
  };
  if (Number(input.applicationFeeCents || 0) > 0) paymentIntentData.application_fee_amount = Math.round(input.applicationFeeCents);
  return stripeRequest(env, 'checkout/sessions', {
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: input.currency || 'usd',
        unit_amount: Math.round(input.amountCents),
        product_data: { name: input.description || 'Whip Equipped mobility service' }
      }
    }],
    payment_intent_data: paymentIntentData,
    metadata: { kind: input.kind, tenant_id: input.tenantId, resource_id: input.resourceId }
  }, { account: input.connectedAccountId });
}

export async function retrieveCheckoutSession(env, sessionId, connectedAccountId) {
  return stripeRequest(env, `checkout/sessions/${encodeURIComponent(sessionId)}`, {}, { method: 'GET', account: connectedAccountId });
}

export async function createManualPaymentIntent(env, input = {}) {
  const params = {
    amount: Math.round(input.amountCents),
    currency: input.currency || 'usd',
    capture_method: 'manual',
    automatic_payment_methods: { enabled: true },
    description: input.description || 'Whip Equipped ride authorization',
    metadata: { kind: input.kind, tenant_id: input.tenantId, resource_id: input.resourceId }
  };
  if (Number(input.applicationFeeCents || 0) > 0) params.application_fee_amount = Math.round(input.applicationFeeCents);
  return stripeRequest(env, 'payment_intents', params, { account: input.connectedAccountId });
}

export async function retrievePaymentIntent(env, paymentIntentId, connectedAccountId) {
  return stripeRequest(env, `payment_intents/${encodeURIComponent(paymentIntentId)}`, {}, { method: 'GET', account: connectedAccountId });
}

export async function capturePaymentIntent(env, paymentIntentId, connectedAccountId, amountCents) {
  return stripeRequest(env, `payment_intents/${encodeURIComponent(paymentIntentId)}/capture`, {
    amount_to_capture: amountCents ? Math.round(amountCents) : undefined
  }, { account: connectedAccountId });
}

export async function cancelPaymentIntent(env, paymentIntentId, connectedAccountId) {
  return stripeRequest(env, `payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, {}, { account: connectedAccountId });
}

export async function createRefund(env, input = {}) {
  return stripeRequest(env, 'refunds', {
    payment_intent: input.paymentIntentId,
    amount: input.amountCents ? Math.round(input.amountCents) : undefined,
    reason: input.reason || undefined,
    metadata: input.metadata || undefined
  }, { account: input.connectedAccountId });
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
async function matchesSecret(rawBody, timestamp, signature, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  return constantTimeEqual(hex(signed), signature);
}

export async function verifyStripeWebhook(rawBody, signatureHeader, secretList, toleranceSeconds = 300) {
  if (!secretList) throw new Error('Stripe webhook secret is not configured');
  if (!signatureHeader) throw new Error('Missing Stripe-Signature header');
  const parts = signatureHeader.split(',');
  const timestampPart = parts.find(part => part.startsWith('t='));
  const signatures = parts.filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  const timestamp = Number(timestampPart?.slice(2));
  if (!timestamp || !signatures.length) throw new Error('Invalid Stripe signature header');
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) throw new Error('Stripe webhook timestamp outside tolerance');
  const secrets = String(secretList).split(',').map(s => s.trim()).filter(Boolean);
  for (const secret of secrets) {
    for (const signature of signatures) {
      if (await matchesSecret(rawBody, timestamp, signature, secret)) return JSON.parse(rawBody);
    }
  }
  throw new Error('Invalid Stripe webhook signature');
}
