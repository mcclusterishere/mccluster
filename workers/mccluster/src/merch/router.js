/* MERCH MARKETPLACE v1 — anyone can sell their merch on McCluster.

   Owner, 2026-10-30: "treat this as a marketplace so others can also sell
   their merch on it ... its productization we're aiming at here."

   WHY HERE. This module lives in Worker `mccluster` beside the Client Connect
   rail it reuses (../connect.js): a seller is an org with an
   org_stripe_accounts row, its Express account is created and onboarded by
   the same helpers, and the charge is the same DIRECT charge with
   application_fee_amount that connect.js describes. Nothing here is a new
   backend, auth or billing system: identity is Supabase Auth, data is
   Supabase `zmnhbrjyhxzhkxmhkexs` (supabase/pending/merch_marketplace_v1.sql),
   owner authority is the existing `ops.use` grant on the house org, and the
   only proof of payment is the canonical `stripe-webhook` Edge Function
   (which already receives connected-account events and books them in the
   commerce ledger).

   Routes (all under /v1/merch):
     public   GET  listings[?seller=slug]     published listings of approved, Connect-ready sellers
              GET  listings/:id               one listing with its variants
              GET  sellers/:slug              a shop page
              POST checkout                   {listing_id, variant_id, quantity} -> Stripe Checkout on the seller's account
              GET  orders/status?token=       the buyer's order, by the random token from checkout
     seller   POST seller/apply               {slug, display_name, bio}
              GET  seller                     the signed-in seller: status, Stripe, tax, listings, orders
              POST seller/onboard             Stripe Express onboarding link (owner)
              POST seller/payouts-link        Stripe Express dashboard login link (owner)
              POST seller/account-session     Stripe Account Session for the seller's OWN account, enabling only
                                              the sales tax components (+ notification banner) (owner, approved)
              PATCH seller/profile            {display_name, bio, logo_path}
              POST seller/uploads             {content_type} -> one signed upload URL for a recorded path
              POST seller/listings            create; PATCH seller/listings/:id update
              POST seller/listings/:id/publish
              POST seller/orders/:id/fulfil   {status: fulfilled|shipped|delivered, carrier, tracking_number}
              POST seller/orders/:id/refund   {amount_cents?} (owner) refund on the seller's account, fee returned
     owner    GET  admin                      sellers, listings, orders and platform fee totals
              POST admin/sellers/:org/(approve|suspend)   {reason}
              POST admin/listings/:id/(remove|restore)    {reason}

   No browser value chooses a price, fee, currency, seller or Stripe
   account: the database function prices the order from its rows and the
   Worker re-checks the 15% with its own constant (./fee.js) before asking
   Stripe for anything. */
import { reply, fail } from '../lib/http.js';
import { stripeConfigured, stripeRequest, createAccountLink, retrieveConnectedAccount } from '../whip/stripe.js';
import { livemode, createClientAccount, railPatchFromAccount, publicRail } from '../connect.js';
import { resolveWorkspaces } from '../workspaces.js';
import { requireCapability } from '../lib/capabilities.js';
import { orderFeeMismatch, MARKETPLACE_PLATFORM_FEE_BPS } from './fee.js';

export const MERCH_PREFIX = '/v1/merch';
export const MEDIA_BUCKET = 'marketplace-media';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/* the only embedded components a seller's Account Session may open */
export const TAX_COMPONENTS = Object.freeze({
  tax_settings: { enabled: true },
  tax_registrations: { enabled: true },
  notification_banner: { enabled: true }
});
const CHECKOUT_MINUTES = 31; // Stripe's floor is 30; the order holds its unit for 35

/* Known refusals from the database functions, as the buyer or seller should read them. */
const DB_REFUSALS = {
  out_of_stock: [409, 'That option just sold out'],
  listing_unavailable: [404, 'This item is not for sale right now'],
  variant_unavailable: [409, 'Choose an available option'],
  seller_not_ready: [409, 'This shop cannot take payments right now'],
  invalid_quantity: [400, 'Choose a quantity from 1 to 10'],
  slug_taken: [409, 'That shop address is taken'],
  invalid_slug: [400, 'Shop address: 3–40 lowercase letters, numbers or dashes'],
  image_not_owned: [400, 'Use images uploaded to this shop'],
  logo_not_owned: [400, 'Use an image uploaded to this shop'],
  listing_removed: [403, 'McCluster removed this listing. Contact support to restore it'],
  listing_needs_a_variant: [400, 'Add at least one option (size, colour or "One size")'],
  pod_not_available_in_v1: [400, 'Print on demand is coming next; v1 sells what you ship'],
  tracking_required: [400, 'Enter the carrier and tracking number'],
  unknown_order: [404, 'Order not found'],
  unknown_listing: [404, 'Listing not found'],
  unknown_seller: [404, 'Seller not found'],
  invalid_status: [400, 'Not a valid status'],
  stock_changed: [409, 'Stock changed since you opened this (an order came in or a checkout expired). Reload and set it again'],
  stock_write_outside_function: [409, 'Stock changes through its own action. Reload and set it again'],
  unknown_variant: [404, 'Option not found'],
  invalid_stock: [400, 'Stock: 0 to 1,000,000'],
  marketplace_listings_v1_seller_ships: [400, 'v1 sells only what you ship']
};

function sbHeaders(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    accept: 'application/json', 'content-type': 'application/json', ...extra };
}
async function sb(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: sbHeaders(env, init.headers || {}) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (data && (data.code === 'PGRST205' || data.code === '42P01' || data.code === 'PGRST202')) {
      throw Object.assign(new Error('The marketplace is not switched on yet'), { status: 503, code: 'marketplace_not_ready' });
    }
    const message = String((data && (data.message || data.error)) || 'Database request failed');
    const known = Object.keys(DB_REFUSALS).find((k) => message.includes(k));
    if (known) throw Object.assign(new Error(DB_REFUSALS[known][1]), { status: DB_REFUSALS[known][0], code: known });
    throw Object.assign(new Error(res.status >= 500 ? 'Database request failed' : message), { status: res.status >= 500 ? 503 : 400 });
  }
  return data;
}
const rpc = (env, name, args) => sb(env, `rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

async function sessionUser(request, env) {
  const h = request.headers.get('authorization') || '';
  if (!/^bearer\s+\S+/i.test(h)) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: h } });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && UUID.test(String(u.id || '')) ? u : null;
}
async function requireUser(request, env) {
  const user = await sessionUser(request, env);
  if (!user) throw Object.assign(new Error('Sign in to sell on McCluster'), { status: 401 });
  return user;
}
/* The seller org this account acts for: an org it owns or staffs that is a marketplace seller. */
async function sellerFor(env, user, roles = ['owner', 'staff']) {
  const members = await sb(env, `org_members?profile_id=eq.${user.id}&role=in.(${roles.join(',')})&select=org_id,role`);
  const ids = (members || []).map((m) => m.org_id).filter((id) => UUID.test(String(id)));
  if (!ids.length) return null;
  const rows = await sb(env, `marketplace_sellers?org_id=in.(${ids.join(',')})&select=*&order=created_at.asc&limit=1`);
  const seller = rows && rows[0];
  if (!seller) return null;
  return { ...seller, role: members.find((m) => m.org_id === seller.org_id).role };
}
async function requireSeller(env, user, roles) {
  const seller = await sellerFor(env, user, roles);
  if (!seller) throw Object.assign(new Error(roles && roles.length === 1 ? 'Only the shop owner can do that' : 'Apply to sell first'), { status: roles && roles.length === 1 ? 403 : 404 });
  return seller;
}
/* The house operator: the `ops.use` grant on the house org, exactly as Control's music desk checks it. */
async function requireOperator(request, env) {
  const user = await requireUser(request, env);
  const { workspaces } = await resolveWorkspaces(env, user);
  const house = workspaces.find((w) => w.slug === 'mccluster' && w.enabled);
  if (!house) throw Object.assign(new Error('McCluster operator access required'), { status: 403 });
  await requireCapability(env, { role: house.role }, 'ops.use');
  return user;
}

async function railFor(env, orgId) {
  const rows = await sb(env, `org_stripe_accounts?org_id=eq.${orgId}&livemode=is.${livemode(env)}&select=*`);
  return (rows && rows[0]) || null;
}
async function patchRail(env, orgId, patch) {
  const rows = await sb(env, `org_stripe_accounts?org_id=eq.${orgId}&livemode=is.${livemode(env)}`, {
    method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  return (rows && rows[0]) || null;
}
/* Stripe Tax must be active on the seller's account before a sale: the
   seller is the merchant of record and owes the tax. Fail closed. */
async function taxStatus(env, account) {
  if (!account || !stripeConfigured(env)) return { status: 'unknown' };
  try {
    const settings = await stripeRequest(env, 'tax/settings', {}, { method: 'GET', account });
    return { status: settings.status || 'unknown', missing: settings.status_details?.pending?.missing_fields || [] };
  } catch (error) {
    return { status: 'unavailable', error: error.stripe?.code || 'tax_settings_unavailable' };
  }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cents = (v, min, max) => (Number.isSafeInteger(v) && v >= min && v <= max ? v : null);
function siteOrigin(env) { return String(env.MARKET_PUBLIC_URL || env.PUBLIC_APP_URL || 'https://matthew.mccluster.org').replace(/\/+$/, ''); }
function mediaUrl(env, path) { return path ? `${env.SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${String(path).split('/').map(encodeURIComponent).join('/')}` : null; }
function withMedia(env, listing) {
  return { ...listing, image_urls: (listing.images || []).map((p) => mediaUrl(env, p)),
    seller: listing.seller ? { ...listing.seller, logo_url: mediaUrl(env, listing.seller.logo_path) } : undefined };
}
function send(request, env, body, status = 200, cache = 'private, no-store') {
  const res = reply(request, env, body, status);
  res.headers.set('cache-control', cache);
  return res;
}
async function readJson(request) {
  try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; }
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* The listing fields a seller may set, validated before the database checks them again. */
export function cleanListing(body, { partial = false } = {}) {
  const out = {};
  if (!partial || 'title' in body) { out.title = str(body.title, 120); if (!out.title) throw Object.assign(new Error('Give the item a title'), { status: 400 }); }
  if (!partial || 'description' in body) out.description = str(body.description, 5000);
  if (!partial || 'price_cents' in body) {
    out.price_cents = cents(body.price_cents, 100, 1000000);
    if (out.price_cents === null) throw Object.assign(new Error('Price: $1.00 to $10,000.00'), { status: 400 });
  }
  if (!partial || 'shipping_cents' in body) {
    out.shipping_cents = cents(body.shipping_cents ?? 0, 0, 100000);
    if (out.shipping_cents === null) throw Object.assign(new Error('Shipping: $0.00 to $1,000.00'), { status: 400 });
  }
  if (!partial || 'inventory_policy' in body) out.inventory_policy = body.inventory_policy === 'untracked' ? 'untracked' : 'tracked';
  if (!partial || 'images' in body) {
    const images = Array.isArray(body.images) ? body.images : [];
    if (images.length > 8 || images.some((p) => typeof p !== 'string' || p.length > 200)) throw Object.assign(new Error('Up to 8 images'), { status: 400 });
    out.images = images;
  }
  return out;
}
export function cleanVariants(list) {
  if (!Array.isArray(list)) return null;
  if (list.length > 50) throw Object.assign(new Error('Up to 50 options'), { status: 400 });
  return list.map((v, i) => {
    const label = str(v && v.label, 80);
    if (!label) throw Object.assign(new Error('Every option needs a name'), { status: 400 });
    const sku = str(v.sku, 64);
    if (sku && !/^[A-Za-z0-9._-]{1,64}$/.test(sku)) throw Object.assign(new Error('SKU: letters, numbers, dot, dash, underscore'), { status: 400 });
    const options = {};
    for (const [k, val] of Object.entries(v.options && typeof v.options === 'object' ? v.options : {}).slice(0, 4)) {
      const key = str(k, 20).toLowerCase(); const value = str(val, 40);
      if (key && value) options[key] = value;
    }
    const price = v.price_cents == null || v.price_cents === '' ? null : cents(v.price_cents, 100, 1000000);
    if (v.price_cents != null && v.price_cents !== '' && price === null) throw Object.assign(new Error('Option price: $1.00 to $10,000.00'), { status: 400 });
    const count = v.inventory_count == null || v.inventory_count === '' ? null : cents(v.inventory_count, 0, 1000000);
    /* the count the seller loaded, so a stock change is a compare-and-set, never a snapshot overwrite */
    const expected = !('expected_inventory' in v) ? undefined
      : v.expected_inventory == null || v.expected_inventory === '' ? null : cents(Number(v.expected_inventory), 0, 1000000);
    return { id: UUID.test(String(v.id || '')) ? v.id : null, label, options, sku: sku || null, price_cents: price,
      inventory_count: count, expected_inventory: expected, active: v.active !== false, position: i };
  });
}

/* Saving a listing never writes stock from the dashboard's snapshot: an
   existing option's count changes only when the seller changed it, and then
   as a compare-and-set against the count they loaded
   (public.marketplace_variant_set_stock, enforced by the variant guard), so a
   sale or reservation made in between is never erased. */
async function saveVariants(env, seller, listingId, variants, actor) {
  if (!variants) return;
  const existing = await sb(env, `marketplace_variants?listing_id=eq.${listingId}&select=id,inventory_count`);
  const known = new Map((existing || []).map((r) => [r.id, r]));
  const kept = new Set();
  for (const v of variants) {
    const row = { label: v.label, options: v.options, sku: v.sku, price_cents: v.price_cents, active: v.active, position: v.position };
    if (v.id && known.has(v.id)) {
      kept.add(v.id);
      await sb(env, `marketplace_variants?id=eq.${v.id}&listing_id=eq.${listingId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (v.expected_inventory !== undefined && v.inventory_count !== v.expected_inventory) {
        await rpc(env, 'marketplace_variant_set_stock', { p_variant: v.id, p_seller_org: seller.org_id, p_expected: v.expected_inventory, p_count: v.inventory_count, p_actor: actor || null });
      }
    } else {
      await sb(env, 'marketplace_variants', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ ...row, inventory_count: v.inventory_count, listing_id: listingId, seller_org_id: seller.org_id }) });
    }
  }
  /* an option sold before cannot be deleted (its orders point at it): it is switched off */
  const gone = [...known.keys()].filter((id) => !kept.has(id));
  if (gone.length) await sb(env, `marketplace_variants?id=in.(${gone.join(',')})&listing_id=eq.${listingId}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) });
}

async function sellerDashboard(env, seller) {
  let rail = await railFor(env, seller.org_id);
  if (rail?.stripe_account_id && stripeConfigured(env)) {
    try { rail = (await patchRail(env, seller.org_id, railPatchFromAccount(await retrieveConnectedAccount(env, rail.stripe_account_id)))) || rail; } catch { /* keep the stored state */ }
  }
  const [listings, variants, orders, tax] = await Promise.all([
    sb(env, `marketplace_listings?seller_org_id=eq.${seller.org_id}&select=*&order=created_at.desc&limit=200`),
    sb(env, `marketplace_variants?seller_org_id=eq.${seller.org_id}&select=*&order=position.asc`),
    sb(env, `marketplace_orders?seller_org_id=eq.${seller.org_id}&status=neq.pending&select=id,listing_id,variant_id,quantity,title_snapshot,variant_label,sku,subtotal_cents,shipping_cents,tax_cents,total_cents,platform_fee_cents,amount_refunded_cents,currency,status,buyer_email,shipping_address,carrier,tracking_number,livemode,paid_at,shipped_at,delivered_at,refunded_at,canceled_at,created_at&order=created_at.desc&limit=200`),
    rail?.stripe_account_id ? taxStatus(env, rail.stripe_account_id) : Promise.resolve({ status: 'not_started' })
  ]);
  const byListing = {};
  for (const v of variants || []) (byListing[v.listing_id] ||= []).push(v);
  return {
    seller: { org_id: seller.org_id, slug: seller.slug, display_name: seller.display_name, bio: seller.bio, logo_path: seller.logo_path,
      logo_url: mediaUrl(env, seller.logo_path), status: seller.status, status_reason: seller.status_reason, role: seller.role },
    stripe: publicRail(rail),
    tax,
    platform_fee_bps: MARKETPLACE_PLATFORM_FEE_BPS,
    listings: (listings || []).map((l) => withMedia(env, { ...l, variants: byListing[l.id] || [] })),
    orders: (orders || []).filter((o) => o.status !== 'canceled')
  };
}

export async function handleMerchRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== MERCH_PREFIX && !path.startsWith(MERCH_PREFIX + '/')) return null;
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'The marketplace is not configured', 503);
  const rest = path.slice(MERCH_PREFIX.length + 1);
  const method = request.method;
  try {
    return await route(request, env, url, rest, method);
  } catch (error) {
    const res = fail(request, env, error.message || 'Marketplace request failed', error.status || 500, error.code ? { code: error.code } : undefined);
    res.headers.set('cache-control', 'private, no-store');
    return res;
  }
}

async function route(request, env, url, rest, method) {
  /* ---------------- public ---------------- */
  if (rest === 'listings' && method === 'GET') {
    const seller = url.searchParams.get('seller');
    if (seller && !SLUG.test(seller)) return fail(request, env, 'Unknown shop', 404);
    const rows = await rpc(env, 'marketplace_public_listings', { p_seller_slug: seller || null, p_listing: null });
    return send(request, env, { listings: (rows || []).map((l) => withMedia(env, l)) }, 200, 'public, max-age=30');
  }
  const one = rest.match(/^listings\/([0-9a-f-]{36})$/i);
  if (one && method === 'GET') {
    const rows = await rpc(env, 'marketplace_public_listings', { p_seller_slug: null, p_listing: one[1] });
    if (!rows || !rows[0]) return fail(request, env, 'This item is not for sale right now', 404);
    return send(request, env, { listing: withMedia(env, rows[0]) }, 200, 'public, max-age=15');
  }
  const shop = rest.match(/^sellers\/([a-z0-9-]{3,40})$/);
  if (shop && method === 'GET') {
    const [sellers, listings] = await Promise.all([
      sb(env, `marketplace_sellers?slug=eq.${shop[1]}&status=eq.approved&select=slug,display_name,bio,logo_path&limit=1`),
      rpc(env, 'marketplace_public_listings', { p_seller_slug: shop[1], p_listing: null })
    ]);
    const seller = sellers && sellers[0];
    if (!seller) return fail(request, env, 'Unknown shop', 404);
    return send(request, env, { seller: { ...seller, logo_url: mediaUrl(env, seller.logo_path) }, listings: (listings || []).map((l) => withMedia(env, l)) }, 200, 'public, max-age=30');
  }
  if (rest === 'orders/status' && method === 'GET') {
    const token = String(url.searchParams.get('token') || '');
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return fail(request, env, 'Order not found', 404);
    const order = await rpc(env, 'marketplace_order_by_token', { p_token: token });
    if (!order) return fail(request, env, 'Order not found', 404);
    return send(request, env, { order });
  }
  if (rest === 'checkout' && method === 'POST') return checkout(request, env);

  /* ---------------- seller ---------------- */
  if (rest === 'seller/apply' && method === 'POST') {
    const user = await requireUser(request, env);
    const body = await readJson(request);
    const slug = str(body.slug, 40).toLowerCase();
    const name = str(body.display_name, 80);
    if (!name) return fail(request, env, 'Name your shop', 400);
    if (!SLUG.test(slug)) return fail(request, env, DB_REFUSALS.invalid_slug[1], 400);
    const result = await rpc(env, 'marketplace_seller_apply', { p_user: user.id, p_slug: slug, p_display_name: name, p_bio: str(body.bio, 2000), p_livemode: livemode(env) });
    return send(request, env, result, result.created ? 201 : 200);
  }
  if (rest === 'seller' && method === 'GET') {
    const user = await requireUser(request, env);
    const seller = await sellerFor(env, user);
    if (!seller) return send(request, env, { seller: null, platform_fee_bps: MARKETPLACE_PLATFORM_FEE_BPS });
    return send(request, env, await sellerDashboard(env, seller));
  }
  if (rest === 'seller/onboard' && method === 'POST') {
    const user = await requireUser(request, env);
    const seller = await requireSeller(env, user, ['owner']);
    if (!stripeConfigured(env)) return fail(request, env, 'Stripe is not configured on this Worker', 503);
    let rail = await railFor(env, seller.org_id);
    if (!rail) {
      await sb(env, 'org_stripe_accounts', { method: 'POST', headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ org_id: seller.org_id, livemode: livemode(env), account_reference: `merch-${seller.slug}` }) });
      rail = await railFor(env, seller.org_id);
    }
    if (!rail.stripe_account_id) {
      const account = await createClientAccount(env, {
        org: { id: seller.org_id, slug: seller.slug, name: seller.display_name },
        email: user.email, productDescription: 'Merchandise (apparel, prints and goods) sold through the McCluster marketplace and shipped by the seller',
        url: `${siteOrigin(env)}/market/shop.html?s=${encodeURIComponent(seller.slug)}`
      });
      rail = await patchRail(env, seller.org_id, railPatchFromAccount(account));
    }
    const back = `${siteOrigin(env)}/market/sell.html`;
    const link = await createAccountLink(env, rail.stripe_account_id, { returnUrl: `${back}?stripe=return`, refreshUrl: `${back}?stripe=refresh` });
    if (rail.onboarding_status === 'not_started') await patchRail(env, seller.org_id, { onboarding_status: 'onboarding' });
    return send(request, env, { url: link.url, expires_at: link.expires_at });
  }
  if (rest === 'seller/payouts-link' && method === 'POST') {
    const user = await requireUser(request, env);
    const seller = await requireSeller(env, user, ['owner']);
    const rail = await railFor(env, seller.org_id);
    if (!rail?.stripe_account_id || !rail.details_submitted) return fail(request, env, 'Finish Stripe onboarding first', 409);
    const link = await stripeRequest(env, `accounts/${encodeURIComponent(rail.stripe_account_id)}/login_links`, {});
    return send(request, env, { url: link.url });
  }
  /* SALES TAX, set up by the seller in Stripe's own embedded components
     (tax settings: head office and product type; tax registrations: the
     states it collects in). Express accounts have no Stripe Dashboard page
     for tax, so this is the seller's way in. The Account Session is minted
     for the caller's own seller org only (no org or account is read from
     the request), only for its owner, only once McCluster approved the shop
     and Stripe has its details, and it enables nothing but the tax
     components and the notification banner. Checkout keeps refusing until
     Stripe reports the tax settings active. */
  if (rest === 'seller/account-session' && method === 'POST') {
    const user = await requireUser(request, env);
    const seller = await requireSeller(env, user, ['owner']);
    if (seller.status !== 'approved') return fail(request, env, 'Sales tax opens once McCluster approves your shop', 403, { code: 'seller_not_approved' });
    if (!stripeConfigured(env)) return fail(request, env, 'Stripe is not configured on this Worker', 503);
    const publishable = String(env.STRIPE_PUBLISHABLE_KEY || '');
    if (!/^pk_(live|test)_/.test(publishable) || publishable.startsWith('pk_live') !== livemode(env)) {
      return fail(request, env, 'Stripe embedded components are not configured', 503, { code: 'publishable_key_missing' });
    }
    const rail = await railFor(env, seller.org_id);
    if (!rail?.stripe_account_id || !rail.details_submitted) return fail(request, env, 'Finish Stripe onboarding first', 409, { code: 'connect_not_ready' });
    const session = await stripeRequest(env, 'account_sessions', { account: rail.stripe_account_id, components: TAX_COMPONENTS });
    return send(request, env, { client_secret: session.client_secret, expires_at: session.expires_at, publishable_key: publishable, components: Object.keys(TAX_COMPONENTS) });
  }
  if (rest === 'seller/profile' && method === 'PATCH') {
    const user = await requireUser(request, env);
    const seller = await requireSeller(env, user);
    const body = await readJson(request);
    const patch = {};
    if ('display_name' in body) { patch.display_name = str(body.display_name, 80); if (!patch.display_name) return fail(request, env, 'Name your shop', 400); }
    if ('bio' in body) patch.bio = str(body.bio, 2000);
    if ('logo_path' in body) patch.logo_path = body.logo_path ? str(body.logo_path, 200) : null;
    await sb(env, `marketplace_sellers?org_id=eq.${seller.org_id}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    return send(request, env, { ok: true });
  }
  if (rest === 'seller/uploads' && method === 'POST') {
    const user = await requireUser(request, env);
    const seller = await requireSeller(env, user);
    const body = await readJson(request);
    const ext = IMAGE_TYPES[String(body.content_type || '').toLowerCase()];
    if (!ext) return fail(request, env, 'Upload a JPEG, PNG or WebP image', 400);
    const size = Number(body.byte_size || 0);
    if (!(size > 0) || size > 10485760) return fail(request, env, 'Images are limited to 10 MB', 413);
    const objectName = `${seller.org_id}/${crypto.randomUUID()}.${ext}`;
    /* the record comes first: an image is this seller's because the server says so, never because of its path */
    await sb(env, 'marketplace_assets', { method: 'POST', headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ object_name: objectName, seller_org_id: seller.org_id, uploaded_by: user.id, content_type: String(body.content_type).toLowerCase() }) });
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/upload/sign/${MEDIA_BUCKET}/${objectName}`, { method: 'POST', headers: sbHeaders(env) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.url) return fail(request, env, 'Could not create the upload', 502);
    return send(request, env, { path: objectName, upload_url: `${env.SUPABASE_URL}/storage/v1${data.url}`, public_url: mediaUrl(env, objectName) }, 201);
  }
  if (rest === 'seller/listings' && method === 'POST') {
    const user = await requireUser(request, env);
    const seller = await requireSeller(env, user);
    const body = await readJson(request);
    const fields = cleanListing(body);
    const variants = cleanVariants(body.variants) || [{ id: null, label: 'One size', options: {}, sku: null, price_cents: null, inventory_count: fields.inventory_policy === 'tracked' ? 0 : null, active: true, position: 0 }];
    const rows = await sb(env, 'marketplace_listings', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ ...fields, seller_org_id: seller.org_id, status: 'draft' }) });
    await saveVariants(env, seller, rows[0].id, variants, user.id);
    return send(request, env, { id: rows[0].id, status: 'draft' }, 201);
  }
  const lst = rest.match(/^seller\/listings\/([0-9a-f-]{36})(\/publish)?$/i);
  if (lst) {
    const user = await requireUser(request, env);
    const seller = await requireSeller(env, user);
    const rows = await sb(env, `marketplace_listings?id=eq.${lst[1]}&seller_org_id=eq.${seller.org_id}&select=id,status`);
    const listing = rows && rows[0];
    if (!listing) return fail(request, env, 'Listing not found', 404);
    if (listing.status === 'removed') return fail(request, env, DB_REFUSALS.listing_removed[1], 403, { code: 'listing_removed' });
    if (lst[2] && method === 'POST') {
      return send(request, env, await rpc(env, 'marketplace_listing_request_publish', { p_listing: listing.id, p_actor: user.id }));
    }
    if (!lst[2] && method === 'PATCH') {
      const body = await readJson(request);
      const fields = cleanListing(body, { partial: true });
      /* back to draft: off sale, or no longer waiting for approval/Stripe */
      if (body.unpublish === true && ['published', 'pending_review'].includes(listing.status)) fields.status = 'draft';
      if (Object.keys(fields).length) {
        await sb(env, `marketplace_listings?id=eq.${listing.id}&seller_org_id=eq.${seller.org_id}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(fields) });
      }
      await saveVariants(env, seller, listing.id, cleanVariants(body.variants), user.id);
      return send(request, env, { id: listing.id, ok: true });
    }
    return fail(request, env, 'Method not allowed', 405);
  }
  const ord = rest.match(/^seller\/orders\/([0-9a-f-]{36})\/(fulfil|refund)$/i);
  if (ord && method === 'POST') {
    const user = await requireUser(request, env);
    const seller = await requireSeller(env, user, ord[2] === 'refund' ? ['owner'] : ['owner', 'staff']);
    const body = await readJson(request);
    if (ord[2] === 'fulfil') {
      const status = ['fulfilled', 'shipped', 'delivered'].includes(body.status) ? body.status : null;
      if (!status) return fail(request, env, 'Not a valid status', 400);
      const carrier = str(body.carrier, 40), tracking = str(body.tracking_number, 64);
      if (status === 'shipped' && (!carrier || !/^[A-Za-z0-9 -]{4,64}$/.test(tracking))) return fail(request, env, DB_REFUSALS.tracking_required[1], 400);
      return send(request, env, await rpc(env, 'marketplace_order_seller_update', { p_order: ord[1], p_seller_org: seller.org_id, p_status: status, p_carrier: carrier || null, p_tracking: tracking || null, p_actor: user.id }));
    }
    return refund(request, env, seller, ord[1], body);
  }

  /* ---------------- owner (ops.use on the house org) ---------------- */
  if (rest === 'admin' && method === 'GET') {
    await requireOperator(request, env);
    const [sellers, rails, listings, orders] = await Promise.all([
      sb(env, 'marketplace_sellers?select=org_id,slug,display_name,bio,status,status_reason,approved_at,created_at&order=created_at.desc&limit=500'),
      sb(env, `org_stripe_accounts?livemode=is.${livemode(env)}&account_reference=like.merch-*&select=org_id,onboarding_status,charges_enabled,payouts_enabled,details_submitted`),
      sb(env, 'marketplace_listings?select=id,seller_org_id,title,status,price_cents,shipping_cents,images,removed_reason,published_at,updated_at&order=updated_at.desc&limit=500'),
      sb(env, 'marketplace_orders?status=neq.pending&select=id,seller_org_id,title_snapshot,variant_label,quantity,total_cents,tax_cents,platform_fee_cents,amount_refunded_cents,status,livemode,paid_at,created_at&order=created_at.desc&limit=500')
    ]);
    const railBy = Object.fromEntries((rails || []).map((r) => [r.org_id, r]));
    const live = (orders || []).filter((o) => o.livemode && o.paid_at);
    const fullRefund = (o) => o.status === 'refunded';
    const totals = {
      orders: live.length,
      gross_cents: live.reduce((s, o) => s + (o.total_cents || 0), 0),
      refunded_cents: live.reduce((s, o) => s + (o.amount_refunded_cents || 0), 0),
      /* refund_application_fee returns the fee on a full refund; partial refunds return it pro rata at Stripe, which a later reconciler books */
      platform_fee_cents: live.filter((o) => !fullRefund(o)).reduce((s, o) => s + (o.platform_fee_cents || 0), 0),
      test_orders: (orders || []).filter((o) => !o.livemode && o.paid_at).length
    };
    return send(request, env, {
      platform_fee_bps: MARKETPLACE_PLATFORM_FEE_BPS,
      sellers: (sellers || []).map((s) => ({ ...s, stripe: railBy[s.org_id] || null })),
      listings: (listings || []).map((l) => withMedia(env, l)),
      orders: orders || [], totals
    });
  }
  const adminSeller = rest.match(/^admin\/sellers\/([0-9a-f-]{36})\/(approve|suspend)$/i);
  if (adminSeller && method === 'POST') {
    const user = await requireOperator(request, env);
    const body = await readJson(request);
    return send(request, env, await rpc(env, 'marketplace_seller_set_status', { p_org: adminSeller[1], p_status: adminSeller[2] === 'approve' ? 'approved' : 'suspended', p_actor: user.id, p_reason: str(body.reason, 500) || null }));
  }
  const adminListing = rest.match(/^admin\/listings\/([0-9a-f-]{36})\/(remove|restore)$/i);
  if (adminListing && method === 'POST') {
    const user = await requireOperator(request, env);
    const body = await readJson(request);
    return send(request, env, await rpc(env, 'marketplace_listing_set_removed', { p_listing: adminListing[1], p_actor: user.id, p_removed: adminListing[2] === 'remove', p_reason: str(body.reason, 500) || null }));
  }
  return fail(request, env, 'Not found', 404);
}

/* A buyer pays the seller directly. The database prices the order and takes
   the unit; Stripe Checkout runs on the seller's connected account with
   McCluster's fee, Stripe Tax on, US shipping. If Stripe will not open the
   checkout, the unit goes straight back. */
async function checkout(request, env) {
  if (!stripeConfigured(env)) return fail(request, env, 'Payments are not configured', 503);
  const body = await readJson(request);
  const listingId = String(body.listing_id || ''), variantId = String(body.variant_id || '');
  const quantity = Number(body.quantity || 1);
  if (!UUID.test(listingId) || !UUID.test(variantId)) return fail(request, env, 'Choose an item and an option', 400);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) return fail(request, env, DB_REFUSALS.invalid_quantity[1], 400);

  /* who sells it, from the database, before any stock is taken */
  const owners = await sb(env, `marketplace_listings?id=eq.${listingId}&select=seller_org_id&limit=1`);
  const sellerOrg = owners && owners[0] && owners[0].seller_org_id;
  if (!sellerOrg) return fail(request, env, DB_REFUSALS.listing_unavailable[1], 404);
  const rail = await railFor(env, sellerOrg);
  if (!rail?.stripe_account_id) return fail(request, env, DB_REFUSALS.seller_not_ready[1], 409, { code: 'seller_not_ready' });
  /* fail closed on tax: never sell untaxed because the seller's Stripe Tax is not set up */
  const tax = await taxStatus(env, rail.stripe_account_id);
  if (tax.status !== 'active') {
    return fail(request, env, 'This shop has not finished its sales tax setup, so it cannot take orders yet', 409, { code: 'seller_tax_not_ready', tax_status: tax.status });
  }

  const token = randomToken();
  const order = await rpc(env, 'marketplace_order_create', { p_listing: listingId, p_variant: variantId, p_quantity: quantity, p_livemode: livemode(env), p_token_hash: await sha256Hex(token) });
  const release = () => rpc(env, 'marketplace_order_release', { p_order: order.id, p_session: null }).catch(() => null);
  const mismatch = orderFeeMismatch(order);
  if (mismatch || order.stripe_account_id !== rail.stripe_account_id) {
    await release();
    return fail(request, env, 'This order could not be priced safely', 500, { code: mismatch || 'account_mismatch' });
  }
  const site = siteOrigin(env);
  const metadata = {
    kind: 'marketplace_sale',
    marketplace_order_id: order.id,
    marketplace_listing_id: listingId,
    mccluster_org_id: order.seller_org_id
  };
  let session;
  try {
    session = await stripeRequest(env, 'checkout/sessions', {
      mode: 'payment',
      line_items: [{
        quantity: order.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: order.unit_price_cents,
          tax_behavior: 'exclusive',
          product_data: { name: `${order.title} · ${order.variant_label}`.slice(0, 250), tax_code: 'txcd_99999999' }
        }
      }],
      shipping_address_collection: { allowed_countries: ['US'] },
      shipping_options: [{ shipping_rate_data: {
        type: 'fixed_amount', display_name: 'Shipped by the seller',
        fixed_amount: { amount: order.shipping_cents, currency: 'usd' }, tax_behavior: 'exclusive', tax_code: 'txcd_92010001'
      } }],
      automatic_tax: { enabled: true },
      payment_intent_data: { application_fee_amount: order.platform_fee_cents, metadata },
      metadata,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
      success_url: `${site}/market/order.html?t=${token}&done=1`,
      cancel_url: `${site}/market/item.html?id=${listingId}`
    }, { account: order.stripe_account_id, idempotencyKey: `merch-checkout-${order.id}` });
  } catch (error) {
    await release();
    const taxProblem = /tax/i.test(String(error.message || ''));
    return fail(request, env, taxProblem ? 'This shop has not finished its sales tax setup, so it cannot take orders yet' : 'Stripe could not open the checkout', taxProblem ? 409 : 502,
      { code: taxProblem ? 'seller_tax_not_ready' : 'stripe_declined' });
  }
  const attached = await rpc(env, 'marketplace_order_attach_session', { p_order: order.id, p_session: session.id });
  if (attached !== true) return fail(request, env, 'Stripe could not open the checkout', 502, { code: 'session_not_attached' });
  return send(request, env, { url: session.url, order_token: token, order_id: order.id }, 201);
}

/* The seller refunds on its own account; refund_application_fee gives the
   buyer's money back out of both the seller and McCluster's fee. The webhook
   records it when Stripe confirms. */
async function refund(request, env, seller, orderId, body) {
  const rows = await sb(env, `marketplace_orders?id=eq.${orderId}&seller_org_id=eq.${seller.org_id}&select=id,status,payment_intent_id,stripe_account_id,total_cents,amount_refunded_cents`);
  const order = rows && rows[0];
  if (!order) return fail(request, env, 'Order not found', 404);
  if (!['paid', 'fulfilled', 'shipped', 'delivered'].includes(order.status) || !order.payment_intent_id) return fail(request, env, 'Only a paid order can be refunded', 409);
  const left = order.total_cents - order.amount_refunded_cents;
  const amount = body.amount_cents == null ? left : Number(body.amount_cents);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > left) return fail(request, env, `Refund between $0.01 and $${(left / 100).toFixed(2)}`, 400);
  const result = await stripeRequest(env, 'refunds', {
    payment_intent: order.payment_intent_id, amount, refund_application_fee: true,
    metadata: { marketplace_order_id: order.id }
  }, { account: order.stripe_account_id, idempotencyKey: `merch-refund-${order.id}-${order.amount_refunded_cents}-${amount}` });
  return send(request, env, { refund: { id: result.id, status: result.status, amount: result.amount }, recorded_when: 'Stripe confirms the refund (charge.refunded)' }, 202);
}
