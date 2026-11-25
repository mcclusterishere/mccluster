/* Discovery: category queries over web and news, then candidate extraction.
   Categories map to the frames they may land in. A and B need the $1M floor; C does not. */
export const CATEGORIES = Object.freeze([
  { key: 'venture_gp', label: 'general partner at a top tier venture fund', frames: ['A', 'B', 'C'], queries: [
    'general partner venture capital firm new fund 2026',
    'managing partner venture fund raises 2026',
    'Midas List general partner 2026',
    'venture capital partner blog email me founders',
  ] },
  { key: 'exited_founder', label: 'founder with a major exit', frames: ['A', 'B', 'C'], queries: [
    'founder sold company acquired for million 2025',
    'startup acquired billion founder 2026',
    'founder IPO 2025 company went public',
    'founder after exit angel investor writes newsletter',
  ] },
  { key: 'operator', label: 'operator, executive, gatekeeper or connector with industry leverage', frames: ['C', 'A', 'B'], queries: [
    'chief operating officer named 2026 technology company',
    'head of platform partnerships appointed 2026',
    'accelerator managing director appointed 2026',
    'university entrepreneurship center director announces 2026',
  ] },
]);

const ROLE_WORDS = '(?:chief [a-z]+ officer|general partner|managing partner|founding partner|partner|co[- ]?founder|cofounder|founder|chief executive|ceo|coo|cto|president|managing director|executive director|director|head of [a-z ]{3,30})';
const NAME = "([A-Z][a-z'\\u00C0-\\u017F]+(?:\\s[A-Z]\\.)?\\s[A-Z][a-z'\\u00C0-\\u017F]+(?:\\s[A-Z][a-z'\\u00C0-\\u017F]+)?)";
const PATTERNS = [
  new RegExp(`${NAME},\\s(?:the\\s)?(${ROLE_WORDS})\\s(?:of|at)\\s([A-Z][\\w&.' ]{1,40})`, 'gu'),
  new RegExp(`(${ROLE_WORDS})\\s${NAME}\\s(?:of|at)\\s([A-Z][\\w&.' ]{1,40})`, 'gu'),
  new RegExp(`([A-Z][\\w&.']{1,30}(?:\\s[A-Z][\\w&.']{1,30})?)\\s(?:co[- ]?)?founder\\s(?:and\\s[A-Za-z ]+\\s)?${NAME}`, 'gu'),
];
const NOT_NAMES = new Set(['united states', 'new york', 'san francisco', 'silicon valley', 'the company', 'venture capital', 'general partner', 'managing partner']);

/* Heuristic extraction from search titles and snippets. An LLM extractor can replace it (extractWithLlm). */
export function extractCandidates(results, category) {
  const found = new Map();
  for (const r of results) {
    const text = `${r.title || ''}. ${r.snippet || ''}`;
    for (const [i, re] of PATTERNS.entries()) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        let name, role, org;
        if (i === 0) [name, role, org] = [m[1], m[2], m[3]];
        else if (i === 1) [role, name, org] = [m[1], m[2], m[3]];
        else [org, name, role] = [m[1], m[2], 'founder'];
        name = name.trim();
        if (NOT_NAMES.has(name.toLowerCase()) || name.split(/\s+/).length > 3) continue;
        const key = name.toLowerCase();
        const prev = found.get(key);
        const entry = prev || { name, role: role.trim(), organization: String(org || '').trim().replace(/[.,]$/, ''), category: category.key, discoverySources: [] };
        entry.discoverySources.push({ url: r.url, title: r.title, snippet: r.snippet, published: r.published || null });
        found.set(key, entry);
      }
    }
  }
  return [...found.values()];
}

export async function extractWithLlm(llm, results, category) {
  if (!llm) return null;
  const prompt = `From these search results, list real people who are a ${category.label}. Only people named in the results. Return JSON {"people":[{"name":"","role":"","organization":"","result_index":0}]}.\n\n${results.map((r, i) => `[${i}] ${r.title}\n${r.snippet}\n${r.url}`).join('\n\n')}`;
  const out = await llm.json(prompt);
  return (out?.people || []).filter((p) => p?.name && results[p.result_index]).map((p) => ({
    name: String(p.name).trim(), role: String(p.role || '').trim(), organization: String(p.organization || '').trim(), category: category.key,
    discoverySources: [{ url: results[p.result_index].url, title: results[p.result_index].title, snippet: results[p.result_index].snippet }],
  }));
}

export async function discover({ search, llm = null, categories = CATEGORIES, exclude = () => false, limit = 400 }) {
  const byName = new Map();
  const queriesRun = [];
  for (const category of categories) {
    for (const q of category.queries) {
      const web = await search.search(q, { count: 20, freshness: 'py' });
      const news = await search.search(q, { news: true, count: 20, freshness: 'py' });
      queriesRun.push(q);
      const results = [...web, ...news].filter((r) => r?.url);
      const people = (await extractWithLlm(llm, results, category).catch(() => null)) || extractCandidates(results, category);
      for (const p of people) {
        const key = p.name.toLowerCase();
        if (exclude(p)) continue;
        if (byName.has(key)) byName.get(key).discoverySources.push(...p.discoverySources);
        else byName.set(key, p);
        if (byName.size >= limit) return { candidates: [...byName.values()], queriesRun };
      }
    }
  }
  return { candidates: [...byName.values()], queriesRun };
}
