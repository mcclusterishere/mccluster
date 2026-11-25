/* Pluggable web and news search. Pick with OUTREACH_SEARCH_PROVIDER:
     brave   Brave Search API (web + news), key in OUTREACH_SEARCH_API_KEY
     serper  Serper.dev Google results (search + news), key in OUTREACH_SEARCH_API_KEY
     fixture offline results from a JSON file (tests, dry runs)
     none    no search; the run records that discovery is not configured and drafts nothing
   Every provider returns [{ url, title, snippet, published }]. */
import fs from 'node:fs';

export function createSearch(config, { fetchImpl = globalThis.fetch, fixturePath } = {}) {
  const provider = config.searchProvider;
  if (provider === 'fixture') return fixtureSearch(fixturePath);
  if (provider === 'brave') return braveSearch(config.searchApiKey, fetchImpl);
  if (provider === 'serper') return serperSearch(config.searchApiKey, fetchImpl);
  return { name: 'none', async search() { return []; }, configured: false };
}

function requireKey(key, name) { if (!key) throw new Error(`${name} search needs OUTREACH_SEARCH_API_KEY`); }

export function braveSearch(apiKey, fetchImpl) {
  requireKey(apiKey, 'brave');
  return {
    name: 'brave', configured: true,
    async search(query, { news = false, count = 10, freshness } = {}) {
      const u = new URL(`https://api.search.brave.com/res/v1/${news ? 'news' : 'web'}/search`);
      u.searchParams.set('q', query); u.searchParams.set('count', String(Math.min(20, count)));
      if (freshness) u.searchParams.set('freshness', freshness);
      const res = await fetchImpl(u, { headers: { accept: 'application/json', 'x-subscription-token': apiKey } });
      if (!res.ok) throw new Error(`brave search ${res.status}`);
      const body = await res.json();
      const list = news ? body.results || [] : body.web?.results || [];
      return list.map((r) => ({ url: r.url, title: r.title || '', snippet: r.description || '', published: r.page_age || r.age || null }));
    },
  };
}

export function serperSearch(apiKey, fetchImpl) {
  requireKey(apiKey, 'serper');
  return {
    name: 'serper', configured: true,
    async search(query, { news = false, count = 10, freshness } = {}) {
      const body = { q: query, num: Math.min(20, count) };
      if (freshness === 'py') body.tbs = 'qdr:y';
      const res = await fetchImpl(`https://google.serper.dev/${news ? 'news' : 'search'}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`serper search ${res.status}`);
      const out = await res.json();
      const list = news ? out.news || [] : out.organic || [];
      return list.map((r) => ({ url: r.link, title: r.title || '', snippet: r.snippet || '', published: r.date || null }));
    },
  };
}

/* Fixture file shape: { "queries": { "<exact query or prefix*>": [results] } }. */
export function fixtureSearch(file) {
  const data = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : { queries: {} };
  const log = [];
  return {
    name: 'fixture', configured: true, log,
    async search(query) {
      log.push(query);
      if (data.queries[query]) return data.queries[query];
      for (const [k, v] of Object.entries(data.queries)) if (k.endsWith('*') && query.startsWith(k.slice(0, -1))) return v;
      return [];
    },
  };
}
