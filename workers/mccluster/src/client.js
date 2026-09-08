import { corsHeaders, fail, reply } from './lib/http.js';

const MAX_BODY_BYTES = 16 * 1024;
const BOOKING_STATES = new Set([
  'new',
  'needs-reply',
  'qualified',
  'date-proposed',
  'confirmed',
  'completed',
  'archived',
  'declined'
]);

function configured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function sbHeaders(env, prefer) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
  if (prefer) headers.prefer = prefer;
  return headers;
}

async function sbRequest(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: sbHeaders(env, init.prefer),
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw Object.assign(new Error('McCluster database request failed'), {
      status: res.status,
      detail: data
    });
  }
  return data;
}

async function authUser(request, env) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization
    }
  });
  if (!res.ok) return null;
  return res.json();
}

function safeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) ? slug : null;
}

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function validEmail(value) {
  const email = clean(value, 320).toLowerCase();
  return email && email.includes('@') && !/\s/.test(email) ? email : null;
}

async function jsonBody(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body is too large'), { status: 413 });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error('Valid JSON is required'), { status: 400 });
  }
}

async function orgBySlug(env, rawSlug) {
  const slug = safeSlug(rawSlug);
  if (!slug) return null;
  const rows = await sbRequest(
    env,
    `orgs?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=id,slug,name,kind,settings&limit=1`
  );
  return rows?.[0] || null;
}

async function requireClientMember(request, env, rawSlug) {
  const user = await authUser(request, env);
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const org = await orgBySlug(env, rawSlug);
  if (!org || org.kind !== 'client') {
    throw Object.assign(new Error('Client tenant not found'), { status: 404 });
  }
  const memberships = await sbRequest(
    env,
    `org_members?org_id=eq.${encodeURIComponent(org.id)}&profile_id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`
  );
  const membership = memberships?.[0];
  if (!membership) throw Object.assign(new Error('Client tenant access required'), { status: 403 });
  return { user, org, role: membership.role };
}

function settingsObject(org) {
  return org?.settings && typeof org.settings === 'object' && !Array.isArray(org.settings)
    ? { ...org.settings }
    : {};
}

function contentObject(org) {
  const settings = settingsObject(org);
  return settings.site_content && typeof settings.site_content === 'object' && !Array.isArray(settings.site_content)
    ? { ...settings.site_content }
    : {};
}

async function writeOrgSettings(env, orgId, settings) {
  const rows = await sbRequest(
    env,
    `orgs?id=eq.${encodeURIComponent(orgId)}&select=id,slug,name,kind,settings`,
    { method: 'PATCH', body: { settings }, prefer: 'return=representation' }
  );
  return rows?.[0] || null;
}

function publishedContent(org) {
  const content = contentObject(org);
  const out = {};
  for (const [key, value] of Object.entries(content)) {
    if (!value || typeof value !== 'object' || value.published == null) continue;
    out[key] = value.published;
  }
  return out;
}

async function publicInquiry(request, env) {
  const body = await jsonBody(request);
  const org = await orgBySlug(env, body.org);
  if (!org || org.kind !== 'client') return fail(request, env, 'Unknown client', 404);

  const name = clean(body.name, 160);
  const email = validEmail(body.email);
  if (!name || !email) return fail(request, env, 'A valid name and email are required', 400);

  const row = {
    org_id: org.id,
    name,
    email,
    want: clean(body.want, 200),
    note: clean(body.note, 4000),
    page: clean(body.page, 500),
    source: clean(body.source || 'direct', 100) || 'direct',
    medium: body.medium ? clean(body.medium, 100) : null,
    campaign: body.campaign ? clean(body.campaign, 160) : null,
    gclid: body.gclid ? clean(body.gclid, 300) : null,
    status: 'new'
  };

  const rows = await sbRequest(env, 'leads?select=id,at,status', {
    method: 'POST',
    body: row,
    prefer: 'return=representation'
  });
  return reply(request, env, { ok: true, inquiry: rows?.[0] || null }, 201);
}

function authRedirectFor(request) {
  const origin = request.headers.get('origin') || '';
  if (origin === 'https://mcclusterishere.github.io') {
    return 'https://mcclusterishere.github.io/esmer/auth/?next=/esmer/book/';
  }
  if (origin === 'https://esmer.mccluster.org') {
    return 'https://esmer.mccluster.org/auth/?next=/book/';
  }
  return null;
}

async function accountStart(request, env) {
  const body = await jsonBody(request);
  const org = await orgBySlug(env, body.org);
  if (!org || org.kind !== 'client') return fail(request, env, 'Unknown client', 404);
  const email = validEmail(body.email);
  if (!email) return fail(request, env, 'A valid email is required', 400);

  const redirect = authRedirectFor(request);
  const payload = { email, create_user: true };
  if (redirect) payload.options = { email_redirect_to: redirect };

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: sbHeaders(env),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const detail = await res.text();
    throw Object.assign(new Error('Could not send sign-in link'), { status: res.status, detail });
  }
  return reply(request, env, { ok: true }, 202);
}

async function publicEvent(request, env) {
  const body = await jsonBody(request);
  const org = await orgBySlug(env, body.org);
  if (!org || org.kind !== 'client') return fail(request, env, 'Unknown client', 404);
  const allowed = new Set(['page_view', 'music_click', 'book_view', 'inquiry_submit']);
  const name = clean(body.name, 80);
  if (!allowed.has(name)) return fail(request, env, 'Unknown event', 400);
  const props = {
    org: org.slug,
    source: clean(body.source || 'site', 80),
    href: body.href ? clean(body.href, 500) : undefined
  };
  await sbRequest(env, 'events', {
    method: 'POST',
    body: {
      name,
      path: clean(body.path, 500),
      props
    },
    prefer: 'return=minimal'
  });
  return reply(request, env, { ok: true }, 202);
}

async function listInquiries(request, env, org) {
  const rows = await sbRequest(
    env,
    `leads?org_id=eq.${encodeURIComponent(org.id)}&order=at.desc&limit=100&select=id,at,name,email,want,note,page,source,status`
  );
  return reply(request, env, { items: rows || [] });
}

async function inquiryDetail(request, env, org, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(request, env, 'Invalid inquiry id', 400);
  if (request.method === 'GET') {
    const rows = await sbRequest(
      env,
      `leads?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(org.id)}&select=id,at,name,email,want,note,page,source,status&limit=1`
    );
    if (!rows?.length) return fail(request, env, 'Inquiry not found', 404);
    return reply(request, env, rows[0]);
  }
  if (request.method === 'PATCH') {
    const body = await jsonBody(request);
    const status = clean(body.status, 40);
    if (!BOOKING_STATES.has(status)) return fail(request, env, 'Invalid inquiry status', 400);
    const rows = await sbRequest(
      env,
      `leads?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(org.id)}&select=id,at,name,email,want,note,page,source,status`,
      { method: 'PATCH', body: { status }, prefer: 'return=representation' }
    );
    if (!rows?.length) return fail(request, env, 'Inquiry not found', 404);
    return reply(request, env, rows[0]);
  }
  return null;
}

async function listContacts(request, env, org) {
  const leads = await sbRequest(
    env,
    `leads?org_id=eq.${encodeURIComponent(org.id)}&order=at.desc&limit=500&select=name,email,at,status,want`
  );
  const seen = new Map();
  for (const lead of leads || []) {
    const key = String(lead.email || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, {
      name: lead.name,
      email: lead.email,
      last_interaction: lead.at,
      status: lead.status,
      last_interest: lead.want
    });
  }
  return reply(request, env, { items: [...seen.values()] });
}

async function analytics(request, env, org) {
  const leads = await sbRequest(
    env,
    `leads?org_id=eq.${encodeURIComponent(org.id)}&order=at.desc&limit=1000&select=id,at,status`
  );
  const now = Date.now();
  const thirtyDays = now - (30 * 24 * 60 * 60 * 1000);
  const inquiries30d = (leads || []).filter((row) => Date.parse(row.at) >= thirtyDays).length;
  const newInquiries = (leads || []).filter((row) => row.status === 'new' || row.status === 'needs-reply').length;

  let events = [];
  try {
    const since = new Date(thirtyDays).toISOString();
    events = await sbRequest(
      env,
      `events?at=gte.${encodeURIComponent(since)}&props->>org=eq.${encodeURIComponent(org.slug)}&limit=5000&select=name,uid,path,props,at`
    );
  } catch {
    events = [];
  }

  const visitorIds = new Set();
  let pageViews = 0;
  let musicClicks = 0;
  let bookViews = 0;
  for (const event of events || []) {
    if (event.uid) visitorIds.add(event.uid);
    if (event.name === 'page_view') pageViews += 1;
    if (event.name === 'music_click') musicClicks += 1;
    if (event.name === 'book_view') bookViews += 1;
  }

  return reply(request, env, {
    visitors30d: visitorIds.size || null,
    pageViews30d: pageViews,
    musicClicks,
    bookViews,
    inquiries30d,
    newInquiries
  });
}

async function getContent(request, env, org) {
  return reply(request, env, { content: contentObject(org) });
}

async function saveContent(request, env, member, key) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) return fail(request, env, 'Invalid content key', 400);
  const body = await jsonBody(request);
  const draft = body.draft;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return fail(request, env, 'draft must be an object', 400);
  }
  const serialized = JSON.stringify(draft);
  if (serialized.length > 12000) return fail(request, env, 'Draft is too large', 413);

  const settings = settingsObject(member.org);
  const content = contentObject(member.org);
  const previous = content[key] && typeof content[key] === 'object' ? content[key] : {};
  content[key] = {
    ...previous,
    draft,
    updated_at: new Date().toISOString(),
    updated_by: member.user.id
  };
  settings.site_content = content;
  const updated = await writeOrgSettings(env, member.org.id, settings);
  member.org = updated || member.org;
  return reply(request, env, { key, record: content[key] });
}

async function publishContent(request, env, member) {
  const body = await jsonBody(request);
  const key = clean(body.key, 64);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) return fail(request, env, 'Invalid content key', 400);
  const settings = settingsObject(member.org);
  const content = contentObject(member.org);
  const record = content[key];
  if (!record || !record.draft || typeof record.draft !== 'object') {
    return fail(request, env, 'No draft exists for this content', 409);
  }
  content[key] = {
    ...record,
    published: record.draft,
    published_at: new Date().toISOString(),
    published_by: member.user.id
  };
  settings.site_content = content;
  const updated = await writeOrgSettings(env, member.org.id, settings);
  member.org = updated || member.org;
  return reply(request, env, { key, record: content[key] });
}

async function listMedia(request, env, org) {
  const rows = await sbRequest(
    env,
    `media_assets?org_id=eq.${encodeURIComponent(org.id)}&order=created_at.desc&limit=200&select=id,asset_type,role,url,storage_path,mime_type,width,height,duration_seconds,metadata,created_at`
  );
  return reply(request, env, { items: rows || [] });
}

export async function handleClientRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  const isClientSurface =
    path === '/v1/inquiries' ||
    path === '/v1/account/start' ||
    path === '/v1/events' ||
    path.startsWith('/v1/public/') ||
    path.startsWith('/v1/clients/');
  if (!isClientSurface) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (!configured(env)) return fail(request, env, 'McCluster is not configured', 503);

  if (path === '/v1/inquiries' && request.method === 'POST') return publicInquiry(request, env);
  if (path === '/v1/account/start' && request.method === 'POST') return accountStart(request, env);
  if (path === '/v1/events' && request.method === 'POST') return publicEvent(request, env);

  const publicMatch = path.match(/^\/v1\/public\/([a-z0-9-]+)\/content$/);
  if (publicMatch && request.method === 'GET') {
    const org = await orgBySlug(env, publicMatch[1]);
    if (!org || org.kind !== 'client') return fail(request, env, 'Client tenant not found', 404);
    return reply(request, env, { content: publishedContent(org) });
  }

  const match = path.match(/^\/v1\/clients\/([a-z0-9-]+)(?:\/(.*))?$/);
  if (!match) return fail(request, env, 'Not found', 404);
  const slug = match[1];
  const tail = match[2] || 'me';
  const member = await requireClientMember(request, env, slug);

  if (tail === 'me' && request.method === 'GET') {
    return reply(request, env, {
      tenant: {
        id: member.org.id,
        slug: member.org.slug,
        name: member.org.name,
        role: member.role
      },
      user: {
        id: member.user.id,
        email: member.user.email
      }
    });
  }
  if (tail === 'inquiries' && request.method === 'GET') return listInquiries(request, env, member.org);
  const inquiryMatch = tail.match(/^inquiries\/([0-9a-f-]{36})$/i);
  if (inquiryMatch) {
    const response = await inquiryDetail(request, env, member.org, inquiryMatch[1]);
    if (response) return response;
  }
  if (tail === 'contacts' && request.method === 'GET') return listContacts(request, env, member.org);
  if (tail === 'analytics' && request.method === 'GET') return analytics(request, env, member.org);
  if (tail === 'content' && request.method === 'GET') return getContent(request, env, member.org);
  const contentMatch = tail.match(/^content\/([a-z0-9-]+)$/);
  if (contentMatch && request.method === 'PATCH') return saveContent(request, env, member, contentMatch[1]);
  if (tail === 'publish' && request.method === 'POST') return publishContent(request, env, member);
  if (tail === 'media' && request.method === 'GET') return listMedia(request, env, member.org);
  if (tail === 'press' && request.method === 'GET') return reply(request, env, { items: [] });
  if (tail === 'network' && request.method === 'GET') return reply(request, env, { items: [] });

  return fail(request, env, 'Not found', 404);
}
