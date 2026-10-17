/* Supersedes the older account ladder for optional layers: every non-owner
   receives no optional globe layer until a reviewed release policy enables it. */
import { globeRelease, GLOBE_RELEASE_VERSION } from '../../../packages/release-policy/globe.mjs';
import { reply } from './lib/http.js';
import { bearerUser } from './world-layers.js';
import { service, uuid, privacyAcknowledged, missionCompleted, approximateLocation } from './world-cctv.js';

export const LEVELS = Object.freeze(['public', 'fan', 'creator_business', 'eup', 'fellow', 'owner']);

/* Whip Equipped LLC's own driver sign-up (the Driver app on Matthew's property, whip/driver/) */
export const WHIP_DRIVER_SIGNUP_URL = 'https://matthew.mccluster.org/whip/driver/';

/* Legacy feature prerequisites remain separate from the release policy below. */
export const LAYER_RULES = Object.freeze({
  ion: { min: 'fan', label: 'Enhanced terrain and imagery' },
  flights: { min: 'public', label: 'Flights' },
  satellites: { min: 'fan', label: 'Satellites' },
  launches: { min: 'fan', label: 'Space missions' },
  /* /v1/intel/geo (INTEL-TO-MISSION-CANON.md §5): the API serves a public audience too, but only ONE layer is free */
  intel: { min: 'fan', label: 'Intel events' },
  music: { min: 'fan', label: 'Music' },
  cctv: { min: 'fan', cctv: true, label: 'CCTV' },
  audience: { min: 'creator_business', label: 'Your audience' },
  /* Whip Equipped LLC is Matthew McCluster's separate company, not a McCluster Corp brand. Any signed-in member may
     open it; rides are not live yet, so opening it says so and asks drivers (or people who know one) to sign up. */
  transport: { min: 'fan', label: 'Whip Equipped transport', operator: 'Whip Equipped LLC', service_live: false, driver_signup_url: WHIP_DRIVER_SIGNUP_URL }
});

const rank = (level) => LEVELS.indexOf(level);

async function isCreator(env, userId, fetchImpl) {
  const links = await service(env, `m_auth_user_links?auth_user_id=eq.${userId}&is_primary=eq.true&select=m_uid&limit=1`, fetchImpl).catch(() => []);
  const mUid = links[0] && links[0].m_uid;
  if (!uuid(mUid)) return false;
  const rows = await service(env, `music_creator_profiles?m_uid=eq.${mUid}&status=eq.active&select=handle&limit=1`, fetchImpl).catch(() => []);
  return rows.length > 0;
}
export async function isHouseOwner(env, userId, fetchImpl) {
  const orgs = await service(env, 'orgs?slug=eq.mccluster&select=id&limit=1', fetchImpl).catch(() => []);
  const houseId = orgs[0] && orgs[0].id;
  if (!houseId) return false;
  const rows = await service(env, `org_members?org_id=eq.${encodeURIComponent(houseId)}&profile_id=eq.${userId}&role=eq.owner&select=role&limit=1`, fetchImpl).catch(() => []);
  return rows.length > 0;
}

/* TODO(ladder) hooks: each returns false until docs/control-plane/POLICY-FELLOWSHIP-LADDER.md defines a verifiable rule */
export const LADDER_HOOKS = {
  eup: async () => false,
  fellow: async () => false
};

export async function worldAccess(request, env, fetchImpl = fetch) {
  const user = await bearerUser(request, env, fetchImpl);
  let level = 'public', cctv = { signed_in: false, privacy_acknowledged: false, mission_completed: false };
  if (user && uuid(user.id)) {
    level = 'fan';
    const [creator, owner, completed, eup, fellow] = await Promise.all([
      isCreator(env, user.id, fetchImpl), isHouseOwner(env, user.id, fetchImpl),
      missionCompleted(env, user.id, fetchImpl).catch(() => false),
      LADDER_HOOKS.eup(env, user, fetchImpl), LADDER_HOOKS.fellow(env, user, fetchImpl)
    ]);
    if (creator) level = 'creator_business';
    if (eup) level = 'eup';
    if (fellow) level = 'fellow';
    if (owner) level = 'owner';
    cctv = { signed_in: true, privacy_acknowledged: privacyAcknowledged(user), mission_completed: !!completed };
  }
  const unlocked = [], locked = [];
  for (const [id, rule] of Object.entries(LAYER_RULES)) {
    let reason = null, next = null;
    if (globeRelease(id, env) === 'withdrawn') { reason = 'feature_withdrawn'; next = null; }
    else if (level !== 'owner') { reason = 'admin_preview'; next = null; }
    else if (rank(level) < rank(rule.min)) { reason = rule.min === 'fan' ? 'sign_in_required' : `${rule.min}_required`; next = rule.min === 'fan' ? 'sign_in' : rule.min === 'creator_business' ? 'become_a_creator' : 'see_the_ladder'; }
    else if (rule.cctv && !(cctv.signed_in && cctv.privacy_acknowledged && cctv.mission_completed)) {
      reason = !cctv.privacy_acknowledged ? 'privacy_acknowledgement_required' : 'mission_required';
      next = !cctv.privacy_acknowledged ? 'acknowledge_privacy' : 'complete_a_mission';
    }
    if (reason) locked.push({ id, reason, next_step: next }); else unlocked.push(id);
  }
  return { release: { version: GLOBE_RELEASE_VERSION, admin_preview: level === 'owner' }, level, levels: LEVELS, unlocked_layers: unlocked, locked_layers: locked, layers: LAYER_RULES, approximate_location: approximateLocation(request), ladder: 'docs/control-plane/POLICY-FELLOWSHIP-LADDER.md (pending)' };
}

export async function handleWorldAccess(request, env, { fetchImpl = fetch } = {}) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path !== '/v1/world/access') return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const res = reply(request, env, { error: 'Method not allowed' }, 405);
    res.headers.set('cache-control', 'private, no-store');
    return res;
  }
  const body = await worldAccess(request, env, fetchImpl);
  const res = reply(request, env, body);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
