import { GeoAdapterError } from './errors.js';

/*
  App identity is derived from authentication. Callers do not get to declare
  which product they are. body.consumer is rejected at the HTTP boundary.

  JWT / app token
          ↓
  platform_apps.app_key
          ↓
  class + capabilities
          ↓
  lane decision
*/

export const CAPABILITIES = Object.freeze({
  VIEWER: 'VIEWER',
  POLICY: 'POLICY',
  MOBILITY: 'MOBILITY',
  TRAFFIC: 'TRAFFIC',
  RESEARCH: 'RESEARCH',
  INTERNAL: 'INTERNAL'
});

export const APP_CLASSES = Object.freeze({
  INTERNAL: 'INTERNAL',
  NONPROFIT_RESEARCH: 'NONPROFIT_RESEARCH',
  COMMERCIAL: 'COMMERCIAL',
  ACADEMIC: 'ACADEMIC'
});

function app(appId, appClass, capabilities, platformApps) {
  return Object.freeze({
    app: appId,
    class: appClass,
    capabilities: Object.freeze([...capabilities]),
    platform_apps: Object.freeze([...platformApps])
  });
}

const INTERNAL_CAPS = Object.freeze([
  CAPABILITIES.VIEWER,
  CAPABILITIES.POLICY,
  CAPABILITIES.MOBILITY,
  CAPABILITIES.TRAFFIC,
  CAPABILITIES.RESEARCH,
  CAPABILITIES.INTERNAL
]);

const WHIP_CAPS = Object.freeze([CAPABILITIES.MOBILITY, CAPABILITIES.TRAFFIC]);
const EU_CAPS = Object.freeze([CAPABILITIES.POLICY]);
const VIEWER_CAPS = Object.freeze([CAPABILITIES.VIEWER]);

export const APP_PROFILES = Object.freeze({
  INTERNAL_GEV: app('INTERNAL_GEV', APP_CLASSES.INTERNAL, INTERNAL_CAPS, ['mccluster-web', 'mccluster-gev']),
  EQUITY_UPRISE: app('EQUITY_UPRISE', APP_CLASSES.NONPROFIT_RESEARCH, EU_CAPS, ['equity-uprise-web']),
  WHIP_RIDER: app('WHIP_RIDER', APP_CLASSES.COMMERCIAL, WHIP_CAPS, ['whip-rider-web', 'whip-rider-ios']),
  WHIP_DRIVER: app('WHIP_DRIVER', APP_CLASSES.COMMERCIAL, WHIP_CAPS, ['whip-driver-web', 'whip-driver-ios']),
  WHIP_RENTALS: app('WHIP_RENTALS', APP_CLASSES.COMMERCIAL, WHIP_CAPS, ['whip-rentals-web', 'whip-rentals-ios']),
  ESMER: app('ESMER', APP_CLASSES.COMMERCIAL, VIEWER_CAPS, ['esmer-web'])
});

const APP_BY_KEY = new Map();
for (const profile of Object.values(APP_PROFILES)) {
  for (const key of profile.platform_apps) APP_BY_KEY.set(key, profile);
}

export function identityFromAppKey(appKey) {
  const key = String(appKey || '').trim();
  const profile = APP_BY_KEY.get(key);
  if (!profile) {
    throw new GeoAdapterError(
      'Unknown McCluster application identity',
      403,
      'unknown_app',
      { app_key: key || null }
    );
  }
  return Object.freeze({
    app: profile.app,
    app_key: key,
    class: profile.class,
    capabilities: profile.capabilities
  });
}

export function rejectCallerConsumer(body) {
  if (body && Object.prototype.hasOwnProperty.call(body, 'consumer')) {
    throw new GeoAdapterError(
      'consumer is not a request field. App identity is derived from authentication.',
      400,
      'consumer_not_accepted'
    );
  }
}

function parseTokenMap(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a[i] || 0) ^ (b[i] || 0);
  }
  return mismatch === 0;
}

export function appKeyFromToken(rawTokens, presented) {
  const token = String(presented || '');
  if (!token) return null;
  const map = parseTokenMap(rawTokens);
  if (!map) return null;
  let matched = null;
  for (const [appKey, secret] of Object.entries(map)) {
    if (timingSafeEqual(secret, token)) matched = appKey;
  }
  return matched;
}

function claimedAppKey(user) {
  return user?.app_metadata?.mccluster_app
    || user?.user_metadata?.mccluster_app
    || user?.app_metadata?.app_key
    || null;
}

export function resolveRequestIdentity(request, env = {}, user = null) {
  const fromJwt = claimedAppKey(user);
  if (fromJwt) return identityFromAppKey(fromJwt);

  const presented = request?.headers?.get?.('x-mccluster-app-token');
  const fromToken = appKeyFromToken(env?.GEO_APP_TOKENS, presented);
  if (fromToken) return identityFromAppKey(fromToken);

  throw new GeoAdapterError(
    'Spatial app identity is required',
    403,
    'unidentified_app'
  );
}
