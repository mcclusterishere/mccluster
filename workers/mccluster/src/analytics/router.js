import { requireCapability } from '../lib/capabilities.js';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const HOUSE_SLUG = 'mccluster';
const MAX_AUTH_PAGES = 100;
const AUTH_PAGE_SIZE = 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function sb(env, path, init = {}) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...(init.headers || {})
  };
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function sbJson(env, path, init = {}) {
  const res = await sb(env, path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error('Analytics database read failed'), { status: 502, detail: body });
  return body;
}

function countFromRange(value) {
  const total = String(value || '').split('/').pop();
  const n = Number(total);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid analytics count response');
  return n;
}

async function sbCount(env, table, column = 'id', sinceIso = null) {
  const q = new URLSearchParams({ select: column });
  if (sinceIso) q.set('created_at', `gte.${sinceIso}`);
  const res = await sb(env, `${table}?${q.toString()}`, {
    headers: { prefer: 'count=exact', range: '0-0' }
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`Could not count ${table}`), { status: 502, detail: detail.slice(0, 300) });
  }
  return countFromRange(res.headers.get('content-range'));
}

function cleanTxt(value) {
  return String(value || '').replace(/^"|"$/g, '').replace(/"\s+"/g, '').replace(/\\(["\\])/g, '$1');
}

async function requireHouseOps(env, user) {
  if (!user?.id) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const orgs = await sbJson(env, `orgs?slug=eq.${HOUSE_SLUG}&select=id,slug&limit=1`);
  const org = Array.isArray(orgs) ? orgs[0] : null;
  if (!org?.id) throw Object.assign(new Error('McCluster organization is not configured'), { status: 503 });

  const memberships = await sbJson(
    env,
    `org_members?org_id=eq.${encodeURIComponent(org.id)}&profile_id=eq.${encodeURIComponent(user.id)}&select=org_id,profile_id,role&limit=1`
  );
  const membership = Array.isArray(memberships) ? memberships[0] : null;
  await requireCapability(env, membership, 'ops.use');
  return { org, membership };
}

async function listAuthUsers(env) {
  const users = [];
  for (let page = 1; page <= MAX_AUTH_PAGES; page++) {
    const url = `${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${AUTH_PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json'
      }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error('Auth user summary is unavailable'), { status: 502, detail: data });
    const pageUsers = Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : [];
    users.push(...pageUsers);
    if (pageUsers.length < AUTH_PAGE_SIZE) return users;
  }
  throw Object.assign(new Error('Auth user summary exceeded the safe pagination limit'), { status: 503 });
}

function durationMs(amount, unit) {
  if (unit.startsWith('hour') || unit === 'h') return amount * 60 * 60 * 1000;
  if (unit.startsWith('week') || unit === 'w') return amount * 7 * 24 * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

export function parseBusinessWindow(value, now = new Date()) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  let amount;
  let unit;
  let m = raw.match(/^(\d{1,4})\s*(h|d|w)$/);
  if (m) {
    amount = Number(m[1]);
    unit = m[2];
  } else {
    m = raw.match(/\b(?:last|past|previous|from\s+the\s+last)\s+(\d{1,4})\s*(hours?|days?|weeks?)\b/);
    if (!m) return null;
    amount = Number(m[1]);
    unit = m[2];
  }

  if (!Number.isFinite(amount) || amount < 1) return null;
  const max = unit.startsWith('hour') || unit === 'h' ? 24 * 365 : unit.startsWith('week') || unit === 'w' ? 260 : 1825;
  amount = Math.min(amount, max);
  const ms = durationMs(amount, unit);
  const since = new Date(now.getTime() - ms);
  const noun = unit.startsWith('hour') || unit === 'h' ? 'hour' : unit.startsWith('week') || unit === 'w' ? 'week' : 'day';
  return {
    amount,
    unit: noun,
    label: `last ${amount} ${noun}${amount === 1 ? '' : 's'}`,
    since: since.toISOString(),
    until: now.toISOString(),
    rolling: true
  };
}

function localDay(iso, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(iso));
    const vals = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${vals.year}-${vals.month}-${vals.day}`;
  } catch {
    return String(iso || '').slice(0, 10);
  }
}

export async function businessSnapshot(env, windowSpec = null) {
  const users = await listAuthUsers(env);
  const sinceMs = windowSpec ? Date.parse(windowSpec.since) : null;
  const inWindow = (row) => !windowSpec || (Number.isFinite(sinceMs) && Date.parse(row?.created_at || '') >= sinceMs);
  const createdUsers = users.filter(inWindow);
  const confirmed = users.filter((u) => Boolean(u?.email_confirmed_at || u?.confirmed_at));
  const unconfirmed = users.filter((u) => !u?.email_confirmed_at && !u?.confirmed_at);
  const confirmedCreated = createdUsers.filter((u) => Boolean(u?.email_confirmed_at || u?.confirmed_at));
  const unconfirmedCreated = createdUsers.filter((u) => !u?.email_confirmed_at && !u?.confirmed_at);

  const timeZone = env.MCCLUSTER_TIMEZONE || 'America/New_York';
  const byDayMap = new Map();
  for (const user of createdUsers) {
    const day = localDay(user.created_at, timeZone);
    byDayMap.set(day, (byDayMap.get(day) || 0) + 1);
  }

  const since = windowSpec?.since || null;
  const [
    postsTotal, followsTotal, reactionsTotal, profilesTotal,
    postsWindow, followsWindow, reactionsWindow, profilesWindow
  ] = await Promise.all([
    sbCount(env, 'network_posts'),
    sbCount(env, 'network_follows', 'follower_m_uid'),
    sbCount(env, 'network_reactions', 'post_id'),
    sbCount(env, 'network_profiles', 'm_uid'),
    since ? sbCount(env, 'network_posts', 'id', since) : Promise.resolve(null),
    since ? sbCount(env, 'network_follows', 'follower_m_uid', since) : Promise.resolve(null),
    since ? sbCount(env, 'network_reactions', 'post_id', since) : Promise.resolve(null),
    since ? sbCount(env, 'network_profiles', 'm_uid', since) : Promise.resolve(null)
  ]);

  return {
    generated_at: new Date().toISOString(),
    timezone: timeZone,
    window: windowSpec,
    users: {
      total: users.length,
      created_in_window: windowSpec ? createdUsers.length : null,
      confirmed_total: confirmed.length,
      unconfirmed_total: unconfirmed.length,
      confirmed_in_window: windowSpec ? confirmedCreated.length : null,
      unconfirmed_in_window: windowSpec ? unconfirmedCreated.length : null,
      percent_created_in_window: windowSpec && users.length
        ? Math.round((createdUsers.length / users.length) * 1000) / 10
        : null,
      created_by_day: windowSpec
        ? [...byDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }))
        : []
    },
    mnet: {
      profiles: { total: profilesTotal, created_in_window: profilesWindow },
      posts: { total: postsTotal, created_in_window: postsWindow },
      follows: { total: followsTotal, created_in_window: followsWindow },
      reactions: { total: reactionsTotal, created_in_window: reactionsWindow }
    }
  };
}

function metricLabel(subject) {
  if (subject === 'posts') return 'Mnet posts';
  if (subject === 'follows') return 'Mnet follows';
  if (subject === 'reactions') return 'Mnet reactions';
  if (subject === 'profiles') return 'Mnet profiles';
  return 'users';
}

export function answerBusinessQuestion(question, snapshot) {
  const q = String(question || '').trim();
  const lower = q.toLowerCase();
  if (!q) return { understood: false, error: 'question is required' };

  const wantsDaily = /\b(by day|daily|each day|per day)\b/.test(lower);
  const wantsPercent = /%|\bpercent(?:age)?\b|\bwhat share\b/.test(lower);
  const windowed = Boolean(snapshot.window);
  const temporalIntent = /\b(joined|new|created|signed\s*up|recent|today|yesterday|week|month|day|hour)\b/.test(lower);

  // Never convert a time-scoped question into an all-time answer merely
  // because the time phrase was outside the bounded parser's vocabulary.
  // Ambiguity is safer than a confident lie in an operator console.
  if (temporalIntent && !windowed) {
    return {
      understood: false,
      answer: 'I understood that as a time-scoped question, but not the window. Use a rolling window like "last 24 hours", "last 5 days", or "last 2 weeks".',
      supported_window_examples: ['24h', '5d', '2w']
    };
  }

  if (/\b(users?|accounts?|signups?|members?)\b/.test(lower)) {
    let metric = 'users.total';
    let value = snapshot.users.total;

    if (/\bunconfirmed\b|\bunverified\b|not confirmed/.test(lower)) {
      metric = windowed ? 'users.unconfirmed_in_window' : 'users.unconfirmed_total';
      value = windowed ? snapshot.users.unconfirmed_in_window : snapshot.users.unconfirmed_total;
    } else if (/\bconfirmed\b|\bverified\b/.test(lower)) {
      metric = windowed ? 'users.confirmed_in_window' : 'users.confirmed_total';
      value = windowed ? snapshot.users.confirmed_in_window : snapshot.users.confirmed_total;
    } else if (windowed) {
      metric = 'users.created_in_window';
      value = snapshot.users.created_in_window;
    }

    if (wantsDaily && windowed) {
      return {
        understood: true,
        metric: 'users.created_by_day',
        value: snapshot.users.created_by_day,
        answer: `${snapshot.users.created_in_window} users joined in the ${snapshot.window.label}.`,
        context: { total_users: snapshot.users.total, window: snapshot.window }
      };
    }

    const percent = windowed ? snapshot.users.percent_created_in_window : null;
    let answer = metric === 'users.total'
      ? `There are ${value} total users.`
      : `${value} users match that question for the ${snapshot.window.label}.`;
    if (windowed && (wantsPercent || metric === 'users.created_in_window')) {
      answer += ` That is ${percent}% of ${snapshot.users.total} total users.`;
    }
    return { understood: true, metric, value, answer, context: { total_users: snapshot.users.total, percent, window: snapshot.window } };
  }

  const subject = /\bposts?\b/.test(lower) ? 'posts'
    : /\bfollows?|followers?\b/.test(lower) ? 'follows'
      : /\breactions?|likes?\b/.test(lower) ? 'reactions'
        : /\bprofiles?\b/.test(lower) ? 'profiles'
          : null;

  if (subject) {
    const bucket = snapshot.mnet[subject];
    const value = windowed ? bucket.created_in_window : bucket.total;
    const metric = `mnet.${subject}.${windowed ? 'created_in_window' : 'total'}`;
    return {
      understood: true,
      metric,
      value,
      answer: windowed
        ? `${value} ${metricLabel(subject)} were created in the ${snapshot.window.label}.`
        : `There are ${value} total ${metricLabel(subject)}.`,
      context: { total: bucket.total, window: snapshot.window }
    };
  }

  return {
    understood: false,
    answer: 'I can currently answer platform-user and Mnet growth/count questions without guessing.',
    supported_examples: [
      'How many users do we have?',
      'How many users joined in the last 5 days?',
      'What percentage of users joined in the last 7 days?',
      'Show new users by day for the last 2 weeks.',
      'How many Mnet posts were created in the last 30 days?',
      'How many follows do we have?'
    ]
  };
}

async function handleBusinessSnapshot(request, env, user, url) {
  await requireHouseOps(env, user);
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);
  const rawWindow = url.searchParams.get('window') || '';
  const windowSpec = rawWindow ? parseBusinessWindow(rawWindow) : null;
  if (rawWindow && !windowSpec) return json({ ok: false, error: 'Invalid window. Use values like 24h, 5d, or 2w.' }, 400);
  return json({ ok: true, snapshot: await businessSnapshot(env, windowSpec) });
}

async function handleBusinessQuestion(request, env, user) {
  await requireHouseOps(env, user);
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const question = String(body?.question || '').trim();
  if (!question) return json({ ok: false, error: 'question is required' }, 400);
  const explicitWindow = String(body?.window || '').trim();
  const windowSpec = explicitWindow
    ? parseBusinessWindow(explicitWindow)
    : parseBusinessWindow(question);
  if (explicitWindow && !windowSpec) return json({ ok: false, error: 'Invalid window. Use values like 24h, 5d, or 2w.' }, 400);

  const snapshot = await businessSnapshot(env, windowSpec);
  const result = answerBusinessQuestion(question, snapshot);
  return json({ ok: true, question, ...result, generated_at: snapshot.generated_at });
}

export async function handleAnalyticsRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/v1/analytics/business') {
    return handleBusinessSnapshot(request, env, user, url);
  }
  if (path === '/v1/analytics/ask') {
    return handleBusinessQuestion(request, env, user);
  }

  const match = path.match(/^\/v1\/analytics\/domains\/([0-9a-f-]{36})\/verify$/i);
  if (!match) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!user?.id) return json({ ok: false, error: 'Authentication required' }, 401);

  const domainId = match[1];
  const domainRes = await sb(env,
    `analytics_site_domains?id=eq.${encodeURIComponent(domainId)}&select=id,site_id,hostname,verification_token,verified_at,verification_method&limit=1`
  );
  if (!domainRes.ok) return json({ ok: false, error: 'Domain lookup failed' }, 502);
  const domains = await domainRes.json();
  const domain = domains[0];
  if (!domain) return json({ ok: false, error: 'Domain not found' }, 404);

  const siteRes = await sb(env,
    `analytics_sites?id=eq.${encodeURIComponent(domain.site_id)}&select=id,owner_user_id,status&limit=1`
  );
  if (!siteRes.ok) return json({ ok: false, error: 'Site lookup failed' }, 502);
  const sites = await siteRes.json();
  const site = sites[0];
  if (!site || site.owner_user_id !== user.id) return json({ ok: false, error: 'Forbidden' }, 403);
  if (site.status !== 'active') return json({ ok: false, error: 'Site is not active' }, 409);

  if (domain.verified_at) {
    return json({ ok: true, verified: true, hostname: domain.hostname, method: domain.verification_method });
  }

  const qname = `_mccluster-analytics.${domain.hostname}`;
  let dns;
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(qname)}&type=TXT`, {
      headers: { accept: 'application/dns-json' }
    });
    if (!r.ok) throw new Error(`dns ${r.status}`);
    dns = await r.json();
  } catch {
    return json({ ok: false, error: 'DNS verification unavailable' }, 502);
  }

  const answers = Array.isArray(dns?.Answer) ? dns.Answer : [];
  const found = answers.some((answer) => cleanTxt(answer?.data) === domain.verification_token);
  if (!found) {
    return json({
      ok: true,
      verified: false,
      hostname: domain.hostname,
      record: { type: 'TXT', name: qname, value: domain.verification_token }
    });
  }

  const verifiedAt = new Date().toISOString();
  const patch = await sb(env, `analytics_site_domains?id=eq.${encodeURIComponent(domain.id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ verified_at: verifiedAt, verification_method: 'dns', updated_at: verifiedAt })
  });
  if (!patch.ok) return json({ ok: false, error: 'Could not save verification' }, 502);

  return json({ ok: true, verified: true, hostname: domain.hostname, method: 'dns', verified_at: verifiedAt });
}
