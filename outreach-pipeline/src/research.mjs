/* Recent activity research: 2025 and 2026 hooks, each with the URL it came from.
   A hook is kept only when the fetched page names the person and carries a 2025 or 2026 date,
   so the letter can point at something they actually did, not at a guess. */
const YEAR_RE = /\b(2025|2026)\b/;

export async function researchHooks({ person, search, fetchPage, max = 5 }) {
  const queries = [`"${person.name}" 2026`, `"${person.name}" ${person.organization || ''} 2025`.trim(), `"${person.name}" interview OR essay OR podcast`];
  const seen = new Set();
  const hooks = [];
  for (const q of queries) {
    const results = [...await search.search(q, { news: true, count: 10, freshness: 'py' }), ...await search.search(q, { count: 10, freshness: 'py' })];
    for (const r of results) {
      if (!r?.url || seen.has(r.url)) continue;
      seen.add(r.url);
      const page = await fetchPage(r.url);
      if (!page.ok || !page.text.includes(person.name.split(/\s+/).slice(-1)[0])) continue;
      const dated = YEAR_RE.test(String(r.published || '')) || YEAR_RE.test(page.text.slice(0, 4000)) || YEAR_RE.test(r.url);
      if (!dated) continue;
      const year = (String(r.published || '').match(YEAR_RE) || page.text.slice(0, 4000).match(YEAR_RE) || r.url.match(YEAR_RE))[1];
      const at = page.text.indexOf(person.name);
      hooks.push({ url: r.url, title: r.title || '', published: r.published || null, year, excerpt: page.text.slice(Math.max(0, at - 200), at + 600).trim(), sha256: page.sha256 });
      if (hooks.length >= max) return hooks;
    }
  }
  return hooks;
}
