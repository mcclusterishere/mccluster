import Stripe from 'npm:stripe@14';

const stripe = new Stripe(Deno.env.get('STRIPE_SK')!);
const SB = Deno.env.get('SUPABASE_URL')!;
const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const j = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H });

async function rest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SRV);
  headers.set('Authorization', `Bearer ${SRV}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(typeof body === 'string' ? body : JSON.stringify(body));
  return body;
}

async function rpc(name: string, body: Record<string, unknown>) {
  return rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
}

async function sha(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function uuid(value: unknown) {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : '';
}

async function signProduct(product: any) {
  const path = String(product.asset_path || '');
  if (!path) throw new Error('asset_missing');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${SB}/storage/v1/object/sign/l3-product-files/${encodedPath}`, {
    method: 'POST',
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  const signed = await response.json().catch(() => ({}));
  if (!response.ok || !signed.signedURL) throw new Error('sign_failed');
  return String(signed.signedURL).startsWith('http') ? signed.signedURL : `${SB}/storage/v1${signed.signedURL}`;
}

async function bootstrapSession(sessionId: string) {
  if (!sessionId.startsWith('cs_')) return j({ error: 'bad_session' }, 400);

  const order = (await rest(`l3_orders?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`))?.[0];
  if (!order?.connected_account_id) return j({ error: 'order_not_found' }, 404);

  let session: any;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] }, { stripeAccount: order.connected_account_id });
  } catch {
    return j({ error: 'session_not_found' }, 404);
  }
  if (session.payment_status !== 'paid') return j({ error: 'payment_not_complete' }, 402);

  const product = (await rest(`l3_products?id=eq.${order.product_id}&select=id,title,asset_path,file_name,version&limit=1`))?.[0];
  if (!product?.asset_path) return j({ error: 'asset_missing' }, 409);

  const email = session.customer_details?.email || session.customer_email || order.customer_email || null;
  const paymentIntent = typeof session.payment_intent === 'object' ? session.payment_intent?.id : session.payment_intent;
  await rest(`l3_orders?id=eq.${order.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'paid',
      customer_email: email,
      customer_name: session.customer_details?.name || null,
      stripe_payment_intent_id: paymentIntent || null,
      paid_at: order.paid_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  let entitlement = (await rest(`l3_entitlements?order_id=eq.${order.id}&select=*&limit=1`))?.[0];
  if (!entitlement) {
    const inserted = await rest('l3_entitlements', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ order_id: order.id, product_id: order.product_id, customer_email: email }),
    });
    entitlement = inserted?.[0];
  }
  if (!entitlement || entitlement.revoked_at) return j({ error: 'download_revoked' }, 403);

  const issued = (await rpc('l3_issue_download_token', { p_entitlement: entitlement.id }))?.[0];
  if (!issued?.token) return j({ error: 'session_already_exchanged' }, 409);

  return j({
    download_token: issued.token,
    token_expires_at: issued.expires_at,
    expires_in: 600,
    file_name: product.file_name || `${product.title}.zip`,
    title: product.title,
    version: product.version,
  });
}

async function consumeToken(request: Request, token: string) {
  const preflight = (await rest(`l3_entitlements?token=eq.${token}&revoked_at=is.null&token_used_at=is.null&token_expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,product_id&limit=1`))?.[0];
  if (!preflight) return j({ error: 'download_token_invalid' }, 403);

  const product = (await rest(`l3_products?id=eq.${preflight.product_id}&select=id,title,asset_path,file_name,version&limit=1`))?.[0];
  if (!product?.asset_path) return j({ error: 'asset_missing' }, 409);

  let url: string;
  try { url = await signProduct(product); }
  catch { return j({ error: 'sign_failed' }, 500); }

  const consumed = (await rpc('l3_consume_download_token', { p_token: token }))?.[0];
  if (!consumed?.entitlement_id) return j({ error: 'download_token_used' }, 409);

  const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  await rest('l3_download_events', {
    method: 'POST',
    body: JSON.stringify({
      entitlement_id: consumed.entitlement_id,
      ip_hash: await sha(ip),
      user_agent: (request.headers.get('user-agent') || '').slice(0, 500),
    }),
  });

  return j({
    url,
    expires_in: 300,
    file_name: product.file_name || `${product.title}.zip`,
    title: product.title,
    version: product.version,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (request.method !== 'POST') return j({ error: 'POST only' }, 405);

  const body = await request.json().catch(() => ({}));
  const token = uuid(body.download_token);
  if (token) return consumeToken(request, token);

  const sessionId = String(body.session_id || '').trim();
  if (sessionId) return bootstrapSession(sessionId);
  return j({ error: 'session_id_or_download_token_required' }, 400);
});
