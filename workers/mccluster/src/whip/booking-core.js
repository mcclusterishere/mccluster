/* Whip Equipped booking authority. No rider-provided fares, roles or URLs.
 * Quotes are HMAC-authenticated, identity-bound, short lived and commercial
 * routing only. This module has no production side effects. */
import { normalizeRouteRequest } from '../../../../js/travel/route-core.mjs';

export const BOOKING_QUOTE_TTL_MS = 120000;
const MAX_FARE_CENTS = 150000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const bytesToBase64 = data => btoa(Array.from(data, b => String.fromCharCode(b)).join(''))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const base64ToBytes = value => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value) || value.length > 10000) throw new Error('Invalid quote token.');
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(decoded, ch => ch.charCodeAt(0));
};
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const integer = (value, name, maximum, { allowZero = false } = {}) => {
  const str = String(value ?? '');
  if (!/^\d{1,7}$/.test(str)) throw fail('fare_not_configured', 'Whip pricing requires reviewed operator configuration.', 503);
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num > maximum || (!allowZero && num < 1))
    throw fail('fare_not_configured', 'Whip pricing requires reviewed operator configuration.', 503);
  return num;
};
export function bookingSettings(env) {
  const fields = {
    base: integer(env.WHIP_FARE_BASE_CENTS, 'base', 20000),
    mile: integer(env.WHIP_FARE_PER_MILE_CENTS, 'mile', 10000),
    minute: integer(env.WHIP_FARE_PER_MINUTE_CENTS, 'minute', 5000),
    booking: integer(env.WHIP_FARE_BOOKING_CENTS, 'booking', 15000, { allowZero: true }),
    minimum: integer(env.WHIP_FARE_MIN_CENTS, 'minimum', 40000),
    taxBps: integer(env.WHIP_FARE_TAX_BPS, 'tax', 3500, { allowZero: true })
  };
  return fields;
}
export function bookingReadiness(env) {
  const commercialRouting = env.TRAVEL_ROUTING_PROVIDER === 'tomtom' && !!env.TRAVEL_TOMTOM_API_KEY;
  const launchApproval = env.WHIP_RIDES_LIVE === 'true' && env.WHIP_LAUNCH_APPROVED === 'true';
  const payment = !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET && !!env.STRIPE_PUBLISHABLE_KEY;
  const persistence = env.WHIP_BOOKING_DATABASE_READY === 'true';
  const quoteAuth = typeof env.WHIP_BOOKING_QUOTE_SECRET === 'string' && env.WHIP_BOOKING_QUOTE_SECRET.length >= 32;
  let prices = false;
  try { bookingSettings(env); prices = env.WHIP_FARES_APPROVED === 'true'; } catch {}
  return { live: !!(commercialRouting && launchApproval && payment && persistence && quoteAuth && prices),
    commercialRouting, launchApproval, payment, persistence, quoteAuth, prices };
}
export function bookingLocations(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 10)
    throw fail('invalid_locations', 'Select a starting point and destination.');
  const origin = input.origin, destination = input.destination;
  try { normalizeRouteRequest({ origin, destination, mode: 'drive' }); }
  catch { throw fail('invalid_locations', 'Select two distinct points on the globe or from the address search.'); }
  const label = (value, title) => {
    if (typeof value !== 'string') throw fail('invalid_locations', title + ' must be a selected address.');
    const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!cleaned || cleaned.length > 160) throw fail('invalid_locations', title + ' must be a selected address.');
    return cleaned;
  };
  const tenantSlug = String(input.tenant_slug || 'whip-equipped');
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(tenantSlug)) throw fail('invalid_tenant', 'Choose a valid Whip operator.');
  if (input.tier !== undefined && input.tier !== 'standard') throw fail('tier_unavailable', 'Only WE Standard is available in this booking pilot.');
  return { origin: [...origin], destination: [...destination], pickup_label: label(input.pickup_label, 'Pickup'),
    dropoff_label: label(input.dropoff_label, 'Destination'), tenant_slug: tenantSlug, tier: 'standard' };
}
export function calculateFare(route, env, platformFeePercent = 0.03) {
  const settings = bookingSettings(env);
  if (!route || route.mode !== 'drive' || !Number.isFinite(route.distanceMeters) || !Number.isFinite(route.durationSeconds) ||
    route.distanceMeters < 30 || route.distanceMeters > 300000 || route.durationSeconds <= 0 || route.durationSeconds > 21600)
    throw fail('route_unavailable', 'No valid driving route reaches your selected addresses.', 422);
  if (typeof platformFeePercent !== 'number' || !Number.isFinite(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 0.20)
    throw fail('operator_fare_unavailable', 'The operator fee has not been approved.', 503);
  const distanceCents = Math.ceil(route.distanceMeters * settings.mile / 1609.344);
  const timeCents = Math.ceil(route.durationSeconds * settings.minute / 60);
  const preTax = Math.max(settings.minimum, settings.base + settings.booking + distanceCents + timeCents);
  const taxCents = Math.ceil(preTax * settings.taxBps / 10000);
  const fareCents = preTax + taxCents;
  if (!Number.isSafeInteger(fareCents) || fareCents > MAX_FARE_CENTS)
    throw fail('fare_unavailable', 'The estimated route exceeds the current booking limit.', 422);
  const platformFeeCents = Math.round(fareCents * platformFeePercent);
  return { fare_cents: fareCents, platform_fee_cents: platformFeeCents,
    breakdown: { base_cents:settings.base, distance_cents:distanceCents,
      time_cents:timeCents, booking_cents:settings.booking,
      minimum_adjustment_cents:Math.max(0,settings.minimum - (settings.base+settings.booking+distanceCents+timeCents)),
      tax_cents:taxCents }, miles: Math.round(route.distanceMeters / 1609.344 * 100) / 100,
    minutes: Math.max(1,Math.ceil(route.durationSeconds / 60)) };
}
async function signingKey(env) {
  const secret = env.WHIP_BOOKING_QUOTE_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) throw fail('quote_unavailable', 'Booking security is not configured.', 503);
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign','verify']);
}
export async function signQuote(payload, env) {
  const data = encoder.encode(JSON.stringify(payload));
  if (data.length > 5200) throw fail('invalid_quote', 'Quote exceeds the size limit.');
  const key = await signingKey(env);
  return bytesToBase64(data) + '.' + bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, data)));
}
export async function verifyQuote(token, env, subject, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 10000 || token.split('.').length !== 2)
    throw fail('invalid_quote', 'Request a new ride quote.');
  const [raw, mac] = token.split('.');
  let bytes, sig, payload;
  try { bytes = base64ToBytes(raw); sig = base64ToBytes(mac); payload = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(bytes)); }
  catch { throw fail('invalid_quote', 'Request a new ride quote.'); }
  if (sig.length !== 32 || !await crypto.subtle.verify('HMAC', await signingKey(env), sig, bytes))
    throw fail('invalid_quote', 'Request a new ride quote.', 401);
  if (!payload || payload.v !== 1 || payload.sub !== subject || !UUID.test(payload.quote_id) ||
    !UUID.test(payload.tenant_id) || !Number.isSafeInteger(payload.exp) ||
    payload.exp < now || payload.exp > now + BOOKING_QUOTE_TTL_MS ||
    !Number.isSafeInteger(payload.iat) || payload.iat > now + 10000 ||
    payload.exp - payload.iat !== BOOKING_QUOTE_TTL_MS ||
    !Number.isSafeInteger(payload.fare_cents) || payload.fare_cents < 1 || payload.fare_cents > MAX_FARE_CENTS ||
    !Number.isSafeInteger(payload.platform_fee_cents) || payload.platform_fee_cents < 0 ||
    !Number.isFinite(payload.miles) || !Number.isSafeInteger(payload.minutes) ||
    typeof payload.pickup_label !== 'string' || typeof payload.dropoff_label !== 'string' ||
    payload.pickup_label.length > 160 || payload.dropoff_label.length > 160 ||
    !Array.isArray(payload.origin) || !Array.isArray(payload.destination) ||
    payload.tier !== 'standard')
    throw fail('quote_expired', 'That quote has expired or belongs to a different rider. Request a new one.', 409);
  try { normalizeRouteRequest({origin:payload.origin,destination:payload.destination,mode:'drive'}); }
  catch { throw fail('invalid_quote', 'Request a new ride quote.'); }
  return payload;
}
export function bookingRequestId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('invalid_request_id', 'A unique booking request ID is required.');
  return value.toLowerCase();
}
export function bookingProblem(error) {
  return {status:error?.status && Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503,
    code:typeof error?.code==='string'?error.code:'booking_unavailable',
    error: typeof error?.code==='string' ? error.message : 'Whip booking is temporarily unavailable.'};
}
