import { allowedOrigins, reply } from './lib/http.js';

const PREFIX = '/v1/action-archive';
const SLUG = /^[a-z0-9][a-z0-9-]{1,80}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const PUBLIC_ORIGIN = 'https://matthew.mccluster.org';

function response(request, env, data, status = 200, isPublic = false) {
  const result = reply(request, env, data, status);
  result.headers.set('cache-control', isPublic ? 'public, max-age=30' : 'private, no-store');
  result.headers.set('x-content-type-options', 'nosniff');
  result.headers.set('referrer-policy', 'no-referrer');
  return result;
}

function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function service(env, path, body) {
  const result = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await result.json().catch(() => null);
  if (!result.ok) {
    // No database details, bearer values, invitation hashes or private inputs
    // cross the public error boundary.
    const messages = {
      M_ACCOUNT_PROFILE_REQUIRED: ['Finish your M Account profile, then return to this invitation.', 409],
      INVITATION_UNAVAILABLE: ['This invitation is unavailable or expired. Ask the organizer for a new link.', 409],
      PROFILE_ALREADY_CLAIMED: ['This profile has already been claimed.', 409],
      ACCOUNT_ALREADY_LINKED_TO_COHORT: ['This account already has a profile in this cohort.', 409],
      PROVIDER_PAGE_FORBIDDEN: ['You can edit only your own claimed webpage.', 403],
      PROVIDER_PAGE_UNAVAILABLE: ['This provider webpage is unavailable.', 404]
    };
    const safe = messages[data?.message];
    if (safe) throw Object.assign(problem(...safe), { code: data.message });
    throw problem('The cohort service is temporarily unavailable. Try again.', 503);
  }
  return data;
}

async function authenticatedUser(request, env) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw problem('Sign in to your M Account first.', 401);
  const result = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization },
    signal: AbortSignal.timeout(10000)
  });
  const user = result.ok ? await result.json().catch(() => null) : null;
  if (!user?.id) throw problem('Sign in to your M Account first.', 401);
  return user;
}

async function bodyOf(request, allowedFields) {
  if (Number(request.headers.get('content-length') || 0) > 16384) throw problem('Request is too large.', 413);
  let body, reader;
  try {
    if (!request.body) throw problem('Send a valid JSON request.');
    reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) {
        await reader.cancel();
        throw problem('Request is too large.', 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    body = JSON.parse(text);
  } catch (error) {
    if (error.status) throw error;
    throw problem('Send a valid JSON request.');
  } finally {
    reader?.releaseLock();
  }
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !allowedFields.includes(key))) {
    throw problem('The request contains unsupported fields.');
  }
  return body;
}

export async function hashArchiveToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function pageLinks(project, person, mUid) {
  return {
    profile_url: `${PUBLIC_ORIGIN}/cohort-profile.html?project=${encodeURIComponent(project)}&person=${encodeURIComponent(person)}`,
    provider_url: `${PUBLIC_ORIGIN}/docket-516r-cohort.html?person=${encodeURIComponent(person)}`,
    account_profile_url: mUid ? `${PUBLIC_ORIGIN}/mccluster-creator.html?id=${encodeURIComponent(mUid)}` : null
  };
}

export async function handleActionArchive(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw problem('The cohort service is not configured.', 503);
    const origin = request.headers.get('origin');
    if (origin && !allowedOrigins(env).includes(origin)) throw problem('This origin is not allowed.', 403);
    const route = url.pathname.slice(PREFIX.length);

    if (route === '/invitation') {
      if (request.method !== 'POST') throw problem('Use POST to check an invitation.', 405);
      const body = await bodyOf(request, ['token']);
      if (typeof body.token !== 'string' || !TOKEN.test(body.token)) throw problem('This invitation link is invalid.');
      const invitation = await service(env, 'rpc/action_archive_invite_preview', { p_token_hash: await hashArchiveToken(body.token) });
      if (!invitation) throw problem('This invitation is unavailable or expired. Ask the organizer for a new link.', 409);
      return response(request, env, invitation);
    }

    if (route === '/claim') {
      if (request.method !== 'POST') throw problem('Use POST for an invitation claim.', 405);
      const user = await authenticatedUser(request, env);
      const body = await bodyOf(request, ['token']);
      if (typeof body.token !== 'string' || !TOKEN.test(body.token)) throw problem('This invitation link is invalid.');
      const result = await service(env, 'rpc/action_archive_claim', {
        p_token_hash: await hashArchiveToken(body.token), p_auth_user_id: user.id
      });
      return response(request, env, { ...result, ...pageLinks(result.project_slug, result.participant_slug, result.m_uid) });
    }

    if (route === '/me') {
      if (request.method !== 'GET') throw problem('Use GET to read your cohort profile.', 405);
      const user = await authenticatedUser(request, env);
      const project = url.searchParams.get('project');
      if (!project || !SLUG.test(project)) throw problem('Choose a valid cohort project.');
      const links = await service(env, `m_auth_user_links?auth_user_id=eq.${encodeURIComponent(user.id)}&is_primary=eq.true&select=m_uid&limit=1`);
      const mUid = links?.[0]?.m_uid;
      if (!mUid) return response(request, env, { participant: null });
      const people = await service(env, `m_people?id=eq.${encodeURIComponent(mUid)}&status=eq.active&select=id&limit=1`);
      if (!people?.length) return response(request, env, { participant: null });
      const archive = await service(env, 'rpc/action_archive_get', { p_project_slug: project });
      const participant = archive?.participants?.find(person => person.owner_m_uid === mUid) || null;
      return response(request, env, { participant: participant ? { ...participant, ...pageLinks(project, participant.slug, mUid) } : null });
    }

    const edit = route.match(/^\/pages\/([a-z0-9][a-z0-9-]{1,80})$/);
    if (edit) {
      if (request.method !== 'POST') throw problem('Use POST to save your webpage.', 405);
      const user = await authenticatedUser(request, env);
      const body = await bodyOf(request, ['project_slug', 'headline', 'bio', 'website_url']);
      if (!SLUG.test(body.project_slug || '') || typeof body.headline !== 'string' || body.headline.length > 300 ||
        typeof body.bio !== 'string' || body.bio.length > 4000 || typeof body.website_url !== 'string' || body.website_url.length > 2048) {
        throw problem('Check the webpage fields and their lengths.');
      }
      if (body.website_url) {
        let target;
        try { target = new URL(body.website_url); } catch { throw problem('Your website link must be a valid HTTPS URL.'); }
        if (target.protocol !== 'https:' || target.username || target.password) throw problem('Your website link must be a valid HTTPS URL.');
      }
      const page = await service(env, 'rpc/action_archive_update_provider', {
        p_project_slug: body.project_slug, p_participant_slug: edit[1], p_auth_user_id: user.id,
        p_headline: body.headline, p_bio: body.bio, p_website_url: body.website_url
      });
      return response(request, env, { saved: true, provider_page: page });
    }

    if (route === '/invitations') {
      if (request.method !== 'POST') throw problem('Use POST to create an invitation.', 405);
      const user = await authenticatedUser(request, env);
      const orgs = await service(env, 'orgs?slug=eq.mccluster&select=id&limit=1');
      if (!orgs?.[0]?.id) throw problem('Organizer access is unavailable.', 503);
      const members = await service(env, `org_members?org_id=eq.${encodeURIComponent(orgs[0].id)}&profile_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&select=org_id&limit=1`);
      if (!members?.length) throw problem('Only the organizer can create cohort invitations.', 403);
      const body = await bodyOf(request, ['project_slug', 'participant_slug']);
      if (!SLUG.test(body.project_slug || '') || !SLUG.test(body.participant_slug || '')) throw problem('Choose a valid cohort participant.');
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
      const expires = new Date(Date.now() + 14 * 86400000).toISOString();
      const invitation = await service(env, 'rpc/action_archive_issue_invite', {
        p_project_slug: body.project_slug, p_participant_slug: body.participant_slug,
        p_token_hash: await hashArchiveToken(token), p_expires_at: expires
      });
      // The token appears only in this authenticated, uncacheable response.
      // Its fragment is not included in HTTP request URLs or referrers.
      return response(request, env, { ...invitation, invitation_url: `${PUBLIC_ORIGIN}/cohort-claim.html#invite=${token}` });
    }

    const project = route.slice(1);
    if (!SLUG.test(project)) throw problem('Cohort not found.', 404);
    if (request.method !== 'GET' && request.method !== 'HEAD') throw problem('Use GET to read a cohort.', 405);
    const archive = await service(env, 'rpc/action_archive_get', { p_project_slug: project });
    if (!archive) throw problem('Cohort not found.', 404);
    const result = response(request, env, archive, 200, true);
    return request.method === 'HEAD' ? new Response(null, { status: result.status, headers: result.headers }) : result;
  } catch (error) {
    return response(request, env, { error: error.status ? error.message : 'The cohort service is temporarily unavailable. Try again.', ...(error.code ? { code: error.code } : {}) }, error.status || 503);
  }
}
