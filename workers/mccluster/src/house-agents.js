// McCluster House Agents v1 — same M Account, Worker and Supabase plane.
// System identities are not m_people, and drafts do not become network_posts.
// Operator writes are house-owner only. Public reads are published-only.
import { reply, fail } from './lib/http.js';
import { compileCharacterBlueprint } from './character-studio.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTRY = /^[A-Z]{2}$/;
const publishedSelect = 'id,handle,display_name,identity_kind,narrative_board,country_code,region_key,region_label,latitude,longitude,editorial_mission,disclosure,published_at';

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function cleanText(value, max = 2000) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && [...text].length <= max ? text : null;
}
export function parseCountry(value) {
  if (value == null || value === '') return null;
  const country = String(value).toUpperCase();
  if (!COUNTRY.test(country)) throw httpError('Invalid country code', 400);
  return country;
}
export function publicAgent(row) {
  // Explicit allowlist: private persona instructions, budget, canon references,
  // unapproved origins, org IDs and Core/memory references never go public.
  const numberOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    actor_type: 'fictional_system_account',
    account_id: String(row.id || ''),
    handle: String(row.handle || ''),
    display_name: String(row.display_name || ''),
    identity_kind: String(row.identity_kind || ''),
    narrative_board: String(row.narrative_board || ''),
    story_country: String(row.country_code || ''),
    story_region: row.region_key || null,
    region_label: row.region_label || null,
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    editorial_mission: String(row.editorial_mission || ''),
    disclosure: String(row.disclosure || ''),
    verified_human: false,
    verified_region_resident: false,
    active_real_world_mission: false
  };
}
export function fictionalRegionCounts(accounts) {
  const byRegion = new Map(), byCountry = new Map();
  for (const a of accounts) {
    const country = String(a.story_country || '');
    if (COUNTRY.test(country)) byCountry.set(country, (byCountry.get(country) || 0) + 1);
    // Unlocated fictional characters may appear in country discovery but MUST
    // NOT generate false state pins or fabricated place counts.
    if (!a.story_region || !Number.isFinite(a.latitude) || !Number.isFinite(a.longitude)) continue;
    const key = a.story_region;
    const old = byRegion.get(key);
    if (old) old.fictional_system_accounts += 1;
    else byRegion.set(key, {
      region_key: key,
      region_label: a.region_label,
      story_country: country,
      latitude: a.latitude,
      longitude: a.longitude,
      fictional_system_accounts: 1,
      human_members: null, // suppression is handled by action_globe_public_regions
      verified_actions: null,
      population_type: 'fictional_characters_not_members'
    });
  }
  return {
    regions: [...byRegion.values()].sort((a, b) => a.region_key.localeCompare(b.region_key)),
    countries: [...byCountry].sort((a, b) => a[0].localeCompare(b[0])).map(([story_country, fictional_system_accounts]) => ({
      story_country, fictional_system_accounts
    }))
  };
}
async function db(env, path, options = {}) {
  const url = env.SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const raw = await res.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!res.ok) {
    const unavailable = res.status === 404 || ['PGRST205', 'PGRST202'].includes(data?.code);
    throw httpError(unavailable ? 'House agents schema has not been activated yet' : 'House agent database operation failed', unavailable ? 503 : res.status);
  }
  return data;
}
async function houseOrg(env) {
  const rows = await db(env, 'orgs?slug=eq.mccluster&select=id&limit=1');
  if (!rows?.[0]?.id) throw httpError('McCluster house workspace is not configured', 503);
  return rows[0].id;
}
async function checkedJson(request) {
  const raw = await request.text();
  if (raw.length > 16_000) throw httpError('Body too large', 413);
  let body;
  try { body = JSON.parse(raw); } catch { throw httpError('Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError('Expected JSON object');
  return body;
}
function noStore(response) {
  response.headers.set('cache-control', 'private, no-store');
  return response;
}
async function publicList(request, env, url) {
  const country = parseCountry(url.searchParams.get('country'));
  const countryFilter = country ? '&country_code=eq.' + country : '';
  const rows = await db(env, 'house_agent_published_world_v1?select=' + publishedSelect + countryFilter + '&order=handle.asc&limit=100');
  const accounts = (rows || []).map(publicAgent);
  const response = reply(request, env, {
    accounts,
    count: accounts.length,
    kind: 'fictional_system_accounts',
    human_member_count: null,
    description: 'AI-produced PRIM3 characters; not verified real members or people at these places.'
  });
  response.headers.set('cache-control', 'public, max-age=30');
  return response;
}
async function publicRegions(request, env, url) {
  const country = parseCountry(url.searchParams.get('country'));
  const countryFilter = country ? '&country_code=eq.' + country : '';
  const rows = await db(env, 'house_agent_published_world_v1?select=' + publishedSelect + countryFilter + '&order=handle.asc&limit=250');
  const totals = fictionalRegionCounts((rows || []).map(publicAgent));
  const response = reply(request, env, totals);
  response.headers.set('cache-control', 'public, max-age=30');
  return response;
}

export async function handleHouseAgents(request, env, { requireHouseOwner } = {}) {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
  if (!path.startsWith('/v1/house-agents')) return null;

  if (path === '/v1/house-agents/public' && request.method === 'GET') return publicList(request, env, url);
  if (path === '/v1/house-agents/public/regions' && request.method === 'GET') return publicRegions(request, env, url);

  // Permission before reading any owner content (including whether drafts exist).
  if (typeof requireHouseOwner !== 'function') throw httpError('Owner authorization unavailable', 503);
  const owner = await requireHouseOwner(request, env);
  const orgId = await houseOrg(env);


  // Character Studio is the private authoring plane. Preview is side-effect
  // free; save is one transactional RPC and always returns an inert draft.
  if (path === '/v1/house-agents/owner/characters/preview' && request.method === 'POST') {
    const blueprint = compileCharacterBlueprint(await checkedJson(request));
    return noStore(reply(request, env, { blueprint, saved: false, published: false, model_called: false }));
  }
  if (path === '/v1/house-agents/owner/characters' && request.method === 'POST') {
    const blueprint = compileCharacterBlueprint(await checkedJson(request));
    const account = await db(env, 'rpc/house_character_create_draft_v1', {
      method: 'POST',
      body: JSON.stringify({ p_org_id: orgId, p_author_id: owner.id, p_blueprint: blueprint })
    });
    return noStore(reply(request, env, { character: account, saved: true, published: false, agent_running: false }, 201));
  }
  const revisions = path.match(/^\/v1\/house-agents\/owner\/characters\/([0-9a-f-]{36})\/revisions$/i);
  if (revisions && request.method === 'GET') {
    if (!UUID.test(revisions[1])) return fail(request, env, 'Invalid character ID');
    const items = await db(env, 'house_character_revisions?org_id=eq.' + encodeURIComponent(orgId) +
      '&account_id=eq.' + encodeURIComponent(revisions[1]) +
      '&select=id,account_id,revision,compilation_version,blueprint,created_at&order=revision.desc&limit=25');
    return noStore(reply(request, env, { revisions: items || [], scope: 'owner', published: false }));
  }

  if (path === '/v1/house-agents/owner' && request.method === 'GET') {
    const accounts = await db(env,
      'house_system_accounts?org_id=eq.' + encodeURIComponent(orgId) +
      '&select=id,character_id,handle,display_name,identity_kind,narrative_board,distribution_country,distribution_basis,region_key,region_provenance,editorial_mission,personality,agent_contract,canon_refs,disclosure,account_status,canon_approved,region_approved,rights_verified,external_publish_enabled,auto_reply_enabled,daily_draft_target,monthly_autospend_limit_cents,published_at,created_at,updated_at&order=handle.asc&limit=100'
    );
    return noStore(reply(request, env, { accounts: accounts || [], count: (accounts || []).length, scope: 'owner' }));
  }
  if (path === '/v1/house-agents/owner/drafts' && request.method === 'GET') {
    const accountId = url.searchParams.get('account_id');
    if (accountId && !UUID.test(accountId)) return fail(request, env, 'Invalid account ID');
    const match = accountId ? '&account_id=eq.' + encodeURIComponent(accountId) : '';
    const drafts = await db(env,
      'house_agent_drafts?org_id=eq.' + encodeURIComponent(orgId) + match +
      '&select=id,account_id,working_title,body,media_asset_refs,story_spoiler_level,status,operator_note,approved_at,created_at,updated_at&order=created_at.desc&limit=100'
    );
    return noStore(reply(request, env, { drafts: drafts || [], scope: 'owner' }));
  }
  if (path === '/v1/house-agents/owner/drafts' && request.method === 'POST') {
    const body = await checkedJson(request), accountId = body.account_id;
    if (typeof accountId !== 'string' || !UUID.test(accountId)) return fail(request, env, 'Invalid account ID');
    const words = cleanText(body.body, 2000);
    if (!words) return fail(request, env, 'Draft body required (1–2000 characters)');
    const title = body.working_title === undefined ? '' : String(body.working_title).trim();
    if ([...title].length > 160) return fail(request, env, 'Draft title too long');
    if (body.media_asset_refs !== undefined && (!Array.isArray(body.media_asset_refs) || body.media_asset_refs.length > 8)) {
      return fail(request, env, 'At most eight reviewed media references');
    }
    const spoiler = body.story_spoiler_level || 'public';
    if (!['public', 'fan', 'creator', 'canon_root'].includes(spoiler)) return fail(request, env, 'Invalid spoiler classification');
    const accounts = await db(env, 'house_system_accounts?id=eq.' + encodeURIComponent(accountId) +
      '&org_id=eq.' + encodeURIComponent(orgId) + '&account_status=neq.archived&select=id&limit=1');
    if (!accounts?.[0]) return fail(request, env, 'House character not found', 404);
    const rows = await db(env, 'house_agent_drafts', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        org_id: orgId, account_id: accountId,
        body: words, working_title: title,
        media_asset_refs: body.media_asset_refs || [],
        story_spoiler_level: spoiler,
        operator_note: 'Prepared under McCluster house owner; generation/publishing not requested.'
      })
    });
    return noStore(reply(request, env, { draft: rows?.[0] || null, published: false }, 201));
  }
  const review = path.match(/^\/v1\/house-agents\/owner\/drafts\/([0-9a-f-]{36})\/review$/i);
  if (review && request.method === 'POST') {
    const draftId = review[1];
    if (!UUID.test(draftId)) return fail(request, env, 'Invalid draft ID');
    const body = await checkedJson(request);
    if (!['approve', 'reject'].includes(body.decision)) return fail(request, env, 'decision must be approve or reject');
    const drafts = await db(env, 'house_agent_drafts?id=eq.' + encodeURIComponent(draftId) +
      '&org_id=eq.' + encodeURIComponent(orgId) + '&select=id,status,story_spoiler_level&limit=1');
    const draft = drafts?.[0];
    if (!draft) return fail(request, env, 'Draft not found', 404);
    if (!['draft', 'under_review'].includes(draft.status)) return fail(request, env, 'Draft already reviewed', 409);
    if (body.decision === 'approve' && draft.story_spoiler_level !== 'public') {
      return fail(request, env, 'Nonpublic spoilers may not be approved for publication', 409);
    }
    const approved = body.decision === 'approve';
    const patch = {
      status: approved ? 'approved' : 'rejected',
      approved_at: approved ? new Date().toISOString() : null,
      approved_by: approved ? owner.id : null,
      operator_note: typeof body.note === 'string' ? body.note.slice(0, 1000) : '',
      updated_at: new Date().toISOString()
    };
    const rows = await db(env, 'house_agent_drafts?id=eq.' + encodeURIComponent(draftId) +
      '&org_id=eq.' + encodeURIComponent(orgId) + '&status=in.(draft,under_review)', {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(patch)
    });
    if (!rows?.[0]) return fail(request, env, 'Draft review raced with another operator', 409);
    // Review is not live publication; a separate rights-governed publisher
    // must later convert approved drafts into canonical native network posts.
    return noStore(reply(request, env, { draft: rows[0], published: false, external_publish_queued: false }));
  }

  return fail(request, env, 'Unknown house-agent route or method', 404);
}
