const TYPE_BY_SOURCE = Object.freeze({
  paper: 'article-journal',
  article: 'article-journal',
  report: 'report',
  dataset: 'dataset',
  software: 'software',
  webpage: 'webpage',
  website: 'webpage',
  book: 'book',
  chapter: 'chapter',
  thesis: 'thesis',
  policy: 'report',
  government: 'report',
  other: 'document'
});

function clean(value) {
  return String(value ?? '').trim();
}

function authorObjects(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.flatMap((author) => {
    if (typeof author === 'string') {
      const literal = clean(author);
      return literal ? [{ literal }] : [];
    }
    if (!author || typeof author !== 'object') return [];
    const family = clean(author.family || author.last || author.last_name);
    const given = clean(author.given || author.first || author.first_name);
    const literal = clean(author.literal || author.name);
    if (family || given) return [{ ...(family ? { family } : {}), ...(given ? { given } : {}) }];
    return literal ? [{ literal }] : [];
  });
}

function authorText(value) {
  return authorObjects(value).map((author) => {
    if (author.literal) return author.literal;
    return [author.family, author.given].filter(Boolean).join(', ');
  }).filter(Boolean);
}

function bibEscape(value) {
  return clean(value)
    .replace(/\\/g, '\\\\')
    .replace(/[{}]/g, (ch) => '\\' + ch)
    .replace(/\s+/g, ' ');
}

function risType(sourceType) {
  const type = clean(sourceType).toLowerCase();
  if (type === 'paper' || type === 'article') return 'JOUR';
  if (type === 'report' || type === 'policy' || type === 'government') return 'RPRT';
  if (type === 'dataset') return 'DATA';
  if (type === 'software') return 'COMP';
  if (type === 'book') return 'BOOK';
  if (type === 'thesis') return 'THES';
  return 'ELEC';
}

function bibType(sourceType) {
  const type = clean(sourceType).toLowerCase();
  if (type === 'paper' || type === 'article') return 'article';
  if (type === 'book') return 'book';
  if (type === 'thesis') return 'phdthesis';
  return 'misc';
}

export function sourceToCsl(source) {
  const year = Number(source?.published_year);
  return {
    id: clean(source?.citation_key),
    type: TYPE_BY_SOURCE[clean(source?.source_type).toLowerCase()] || 'document',
    title: clean(source?.title),
    author: authorObjects(source?.authors),
    ...(Number.isInteger(year) && year > 0 ? { issued: { 'date-parts': [[year]] } } : {}),
    ...(clean(source?.doi) ? { DOI: clean(source.doi) } : {}),
    ...(clean(source?.canonical_url) ? { URL: clean(source.canonical_url) } : {}),
    ...(clean(source?.category) ? { 'collection-title': clean(source.category) } : {})
  };
}

export function sourcesToBibtex(sources) {
  return sources.map((source) => {
    const key = clean(source.citation_key).replace(/[^A-Za-z0-9_:-]/g, '_') || 'source';
    const fields = [];
    const authors = authorText(source.authors);
    if (authors.length) fields.push(`  author = {${bibEscape(authors.join(' and '))}}`);
    fields.push(`  title = {${bibEscape(source.title)}}`);
    if (Number.isInteger(Number(source.published_year))) fields.push(`  year = {${Number(source.published_year)}}`);
    if (clean(source.doi)) fields.push(`  doi = {${bibEscape(source.doi)}}`);
    if (clean(source.canonical_url)) fields.push(`  url = {${bibEscape(source.canonical_url)}}`);
    return `@${bibType(source.source_type)}{${key},\n${fields.join(',\n')}\n}`;
  }).join('\n\n');
}

export function sourcesToRis(sources) {
  return sources.map((source) => {
    const lines = [`TY  - ${risType(source.source_type)}`];
    for (const author of authorText(source.authors)) lines.push(`AU  - ${author}`);
    lines.push(`TI  - ${clean(source.title)}`);
    if (Number.isInteger(Number(source.published_year))) lines.push(`PY  - ${Number(source.published_year)}`);
    if (clean(source.doi)) lines.push(`DO  - ${clean(source.doi)}`);
    if (clean(source.canonical_url)) lines.push(`UR  - ${clean(source.canonical_url)}`);
    if (clean(source.relevance)) lines.push(`N1  - ${clean(source.relevance).replace(/\r?\n/g, ' ')}`);
    lines.push('ER  - ');
    return lines.join('\n');
  }).join('\n\n');
}

export function exportCitations(sources, format) {
  const normalized = Array.isArray(sources) ? sources : [];
  switch (format) {
    case 'csl-json':
      return {
        content_type: 'application/vnd.citationstyles.csl+json',
        data: normalized.map(sourceToCsl)
      };
    case 'bibtex':
      return { content_type: 'application/x-bibtex', data: sourcesToBibtex(normalized) };
    case 'ris':
      return { content_type: 'application/x-research-info-systems', data: sourcesToRis(normalized) };
    default:
      throw Object.assign(new Error('format must be csl-json, bibtex, or ris'), { status: 400 });
  }
}
