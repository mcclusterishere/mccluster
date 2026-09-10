/*
  Registries of catalogs.

  catalogs.js reaches datasets. This reaches CATALOGS -- directories whose
  records are themselves data sources with their own machine-readable APIs.
  One registry crawl yields thousands of endpoints, each of which then yields
  its own datasets, so coverage compounds instead of accumulating.

  re3data alone lists 3,523 research data repositories, and each detail record
  publishes the API type and base URL that repository serves. That is not a
  list of links; it is a list of things this system can already speak to.

  A registry deliberately produces ENDPOINTS, not datasets. Whether an endpoint
  is then crawled is a separate decision -- some are behind agreements, some
  serve protocols not implemented here, and a directory listing something is
  not permission to ingest it.
*/

export const REGISTRY_PROTOCOLS = Object.freeze({
  RE3DATA: 're3data'
});

/*
  Protocols an endpoint may advertise. OAI-PMH dominates research repositories;
  the rest are recorded so coverage gaps are visible rather than silently
  dropped.
*/
export const ENDPOINT_PROTOCOLS = Object.freeze({
  'OAI-PMH': 'oai-pmh',
  'REST': 'rest',
  'SPARQL': 'sparql',
  'SWORD': 'sword',
  'FTP': 'ftp',
  'other': 'other'
});

function registry({ key, name, protocol, listEndpoint, detailEndpoint, homepage, attribution }) {
  return Object.freeze({ key, name, protocol, listEndpoint, detailEndpoint, homepage, attribution });
}

export const REGISTRIES = Object.freeze([
  registry({
    key: 're3data',
    name: 're3data — Registry of Research Data Repositories',
    protocol: REGISTRY_PROTOCOLS.RE3DATA,
    listEndpoint: 'https://www.re3data.org/api/v1/repositories',
    detailEndpoint: 'https://www.re3data.org/api/v1/repository',
    homepage: 'https://www.re3data.org',
    attribution: 're3data.org — Registry of Research Data Repositories'
  })
]);

export function registryByKey(key) {
  return REGISTRIES.find((r) => r.key === key) ?? null;
}

/*
  re3data answers XML, and the Workers runtime has no DOM parser. These records
  are flat and predictable, so tag extraction is sufficient and avoids shipping a
  parser. Attribute-bearing tags are matched with their attributes intact so the
  apiType can be read off the same match.
*/
function tagValues(xml, tag) {
  const out = [];
  const re = new RegExp(`<(?:[a-z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-z0-9]+:)?${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(decodeEntities(m[1].trim()));
  return out;
}

function tagMatches(xml, tag) {
  const out = [];
  const re = new RegExp(`<(?:[a-z0-9]+:)?${tag}\\b([^>]*)>([\\s\\S]*?)</(?:[a-z0-9]+:)?${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push({ attrs: m[1] ?? '', value: decodeEntities(m[2].trim()) });
  return out;
}

function attr(attrs, name) {
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs ?? '');
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Repository ids held by the registry. */
export function parseRepositoryIds(xml) {
  return Object.freeze(tagValues(String(xml ?? ''), 'id').filter((id) => /^r3d\d+$/.test(id)));
}

/**
 * One repository's detail record, reduced to what decides whether it is
 * reachable: its name, its site, and every API it advertises.
 */
export function parseRepository(xml) {
  const doc = String(xml ?? '');
  const apis = tagMatches(doc, 'api').map((m) => Object.freeze({
    type: attr(m.attrs, 'apiType') ?? 'other',
    normalized: ENDPOINT_PROTOCOLS[attr(m.attrs, 'apiType') ?? 'other'] ?? 'other',
    url: m.value
  })).filter((a) => /^https?:\/\//i.test(a.url));

  return Object.freeze({
    id: tagValues(doc, 're3data.orgIdentifier')[0] ?? tagValues(doc, 'reDataIdentifier')[0] ?? null,
    name: tagValues(doc, 'repositoryName')[0] ?? null,
    url: tagValues(doc, 'repositoryURL')[0] ?? null,
    // A registry entry is a pointer, never a grant. Terms are carried through
    // so the decision to crawl can be made against them.
    dataAccessRestrictions: Object.freeze(tagValues(doc, 'dataAccessRestriction')),
    dataLicenseNames: Object.freeze(tagValues(doc, 'dataLicenseName')),
    apis: Object.freeze(apis),
    crawlable: apis.some((a) => a.normalized !== 'other')
  });
}

/** Fetch the registry's repository ids. */
export async function listRepositories(reg, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(reg.listEndpoint, {
    headers: { accept: 'application/xml', 'user-agent': 'mccluster-seek-first-registry/1.0 (+https://mccluster.org)' },
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`${reg.key} registry list failed: HTTP ${response.status}`);
  return parseRepositoryIds(await response.text());
}

/** Fetch and reduce one repository's detail record. */
export async function fetchRepository(reg, id, { fetchImpl = fetch } = {}) {
  if (!/^r3d\d+$/.test(String(id))) throw new Error(`invalid repository id: ${id}`);
  const response = await fetchImpl(`${reg.detailEndpoint}/${id}`, {
    headers: { accept: 'application/xml', 'user-agent': 'mccluster-seek-first-registry/1.0 (+https://mccluster.org)' },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`${reg.key} repository ${id} failed: HTTP ${response.status}`);
  return parseRepository(await response.text());
}

/** Group discovered endpoints by protocol, so coverage gaps are countable. */
export function coverageByProtocol(repositories) {
  const counts = {};
  for (const repo of repositories) {
    for (const api of repo.apis) {
      counts[api.normalized] = (counts[api.normalized] ?? 0) + 1;
    }
  }
  return Object.freeze(counts);
}
