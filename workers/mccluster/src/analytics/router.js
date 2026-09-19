const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

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

function cleanTxt(value) {
  return String(value || '').replace(/^"|"$/g, '').replace(/"\s+"/g, '').replace(/\\(["\\])/g, '$1');
}

export async function handleAnalyticsRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

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