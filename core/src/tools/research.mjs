const MAX_QUERY = 1000;
const MAX_RESULTS = 10;

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.local')) return null;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return null;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function unwrapDuckDuckGoUrl(raw) {
  const value = decodeHtml(raw);
  try {
    const url = new URL(value, 'https://duckduckgo.com');
    const redirected = url.searchParams.get('uddg');
    return safeHttpUrl(redirected || url.toString());
  } catch {
    return null;
  }
}

function parseDuckDuckGo(html, limit) {
  const results = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) && results.length < limit) {
    const url = unwrapDuckDuckGoUrl(match[1]);
    if (!url) continue;
    const title = decodeHtml(match[2]);
    const tail = html.slice(match.index, Math.min(html.length, match.index + 5000));
    const snippetMatch = tail.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    results.push({
      rank: results.length + 1,
      title,
      url,
      snippet: decodeHtml(snippetMatch?.[1] || '')
    });
  }
  return results;
}

async function braveSearch(query, limit, env) {
  const key = text(env.BRAVE_SEARCH_API_KEY, 1000);
  if (!key) return null;
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(limit));
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-subscription-token': key,
      'user-agent': 'McCluster-Core/1.0'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Brave Search failed: ${response.status}`);
  const body = await response.json();
  return (body?.web?.results || []).slice(0, limit).map((item, index) => ({
    rank: index + 1,
    title: text(item.title, 1000),
    url: safeHttpUrl(item.url),
    snippet: text(item.description, 3000)
  })).filter((item) => item.url);
}

async function duckDuckGoSearch(query, limit) {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'McCluster-Core/1.0 (+https://mccluster.org)'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Public search fallback failed: ${response.status}`);
  const html = await response.text();
  if (html.length > 2_000_000) throw new Error('Public search response exceeded size limit');
  return parseDuckDuckGo(html, limit);
}

export async function researchWeb(args = {}, env = process.env) {
  const objective = text(args.objective, MAX_QUERY);
  if (!objective) throw Object.assign(new Error('objective is required'), { status: 400 });
  const constraints = args.source_constraints && typeof args.source_constraints === 'object' ? args.source_constraints : {};
  const queryParts = [objective];
  if (Array.isArray(constraints.domains) && constraints.domains.length === 1) {
    const domain = String(constraints.domains[0] || '').replace(/[^a-zA-Z0-9.-]/g, '');
    if (domain) queryParts.push(`site:${domain}`);
  }
  const query = queryParts.join(' ').slice(0, MAX_QUERY);
  const limit = Math.min(MAX_RESULTS, Math.max(1, Number(args.limit || 5)));
  const fetchedAt = new Date().toISOString();

  let provider = 'brave';
  let results = await braveSearch(query, limit, env);
  if (!results) {
    provider = 'duckduckgo-html';
    results = await duckDuckGoSearch(query, limit);
  }

  return {
    objective,
    query,
    provider,
    fetched_at: fetchedAt,
    result_count: results.length,
    results,
    provenance: {
      generated_by: 'mccluster-core:research.web:v1',
      fetched_at: fetchedAt,
      source_type: 'public-search-results',
      direct_page_fetch: false,
      note: 'Results are discovery evidence with source URLs; downstream agents must not treat snippets as canonical truth without source verification.'
    }
  };
}
