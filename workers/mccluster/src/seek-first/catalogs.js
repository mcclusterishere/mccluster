import { SOURCE_CLASSES, PERSISTENCE } from './source-registry.js';

/*
  Catalog federation.

  The adapter registry describes sources one hand-written function at a time.
  That is the right shape for a live feed with real semantics — AIS, ADS-B,
  earthquakes — and it is the wrong shape for the long tail. There are millions
  of published datasets and they are not going to be added one commit each.

  Almost all of them sit behind a small number of machine-readable catalog
  protocols. Implementing a protocol once makes every dataset behind every
  endpoint speaking it addressable. Verified live while writing this:

    EU Open Data Portal    1,905,648 datasets
    Socrata Discovery      every US city/state portal on Socrata
    Planetary Computer     136 STAC collections (each many scenes)
    Earth Search (AWS)     9 STAC collections

  So a catalog is registered, not a dataset.

  THE LICENCE RULE. A catalog is not a licence. The first Planetary Computer
  collection read during development reports license "proprietary", and Socrata
  domains mix open and restricted assets freely. Treating "it came from an open
  portal" as "it is open" would quietly ingest material we have no right to
  retain. classifyLicence() therefore FAILS CLOSED: anything it cannot place
  with confidence is RESTRICTED with persistence denied, and has to be
  explicitly recognised before it can be stored.
*/

export const CATALOG_PROTOCOLS = Object.freeze({
  EU_HUB: 'eu-hub',
  SOCRATA: 'socrata',
  STAC: 'stac',
  CKAN: 'ckan'
});

function catalog({
  key,
  name,
  protocol,
  endpoint,
  homepage = null,
  // The floor a dataset can be classified at, never the ceiling. A per-dataset
  // licence may only ever narrow what the catalog claims.
  defaultSourceClass = SOURCE_CLASSES.RESTRICTED,
  lane = 'OPEN',
  attribution = null,
  pageSize = 100
}) {
  return Object.freeze({
    key, name, protocol, endpoint, homepage,
    defaultSourceClass, lane, attribution, pageSize
  });
}

export const CATALOGS = Object.freeze([
  catalog({
    key: 'eu_open_data',
    name: 'EU Open Data Portal',
    protocol: CATALOG_PROTOCOLS.EU_HUB,
    endpoint: 'https://data.europa.eu/api/hub/search/search',
    homepage: 'https://data.europa.eu',
    attribution: 'European Union Open Data Portal',
    pageSize: 100
  }),
  catalog({
    key: 'socrata_us',
    name: 'Socrata Discovery (US government portals)',
    protocol: CATALOG_PROTOCOLS.SOCRATA,
    endpoint: 'https://api.us.socrata.com/api/catalog/v1',
    homepage: 'https://www.tylertech.com/products/data-insights',
    attribution: 'Socrata / Tyler Technologies open data domains',
    pageSize: 100
  }),
  catalog({
    key: 'planetary_computer',
    name: 'Microsoft Planetary Computer (STAC)',
    protocol: CATALOG_PROTOCOLS.STAC,
    endpoint: 'https://planetarycomputer.microsoft.com/api/stac/v1',
    homepage: 'https://planetarycomputer.microsoft.com',
    attribution: 'Microsoft Planetary Computer',
    pageSize: 100
  }),
  catalog({
    key: 'earth_search',
    name: 'Earth Search (AWS Open Data, STAC)',
    protocol: CATALOG_PROTOCOLS.STAC,
    endpoint: 'https://earth-search.aws.element84.com/v1',
    homepage: 'https://earth-search.aws.element84.com',
    attribution: 'Element 84 Earth Search / AWS Open Data',
    pageSize: 100
  }),
  catalog({
    key: 'data_gov',
    name: 'data.gov (CKAN)',
    protocol: CATALOG_PROTOCOLS.CKAN,
    endpoint: 'https://catalog.data.gov/api/3/action',
    homepage: 'https://data.gov',
    attribution: 'U.S. General Services Administration, data.gov',
    pageSize: 100
  })
]);

export function catalogByKey(key) {
  return CATALOGS.find((entry) => entry.key === key) || null;
}

/* ── licence classification ─────────────────────────────────────────────── */

/*
  Ordered most-permissive to least. Each pattern must be specific enough that a
  match is a real identification: "attribution" alone is not evidence of
  CC-BY, and a bare "open" is not evidence of anything.
*/
const LICENCE_RULES = Object.freeze([
  { id: 'cc0', sourceClass: SOURCE_CLASSES.PUBLIC_OPEN, commercialUse: true,
    test: /\bcc0\b|creative commons zero|public domain dedication|\bpddl\b/i },
  { id: 'us-public-domain', sourceClass: SOURCE_CLASSES.PUBLIC_OPEN, commercialUse: true,
    test: /u\.?s\.? government work|public domain(?! dedication)|\busgovpd\b/i },
  { id: 'cc-by', sourceClass: SOURCE_CLASSES.PUBLIC_OPEN, commercialUse: true,
    test: /\bcc[-\s]?by\b(?![-\s]?(nc|nd))|creative commons attribution(?![-\s]?(non|no))/i },
  { id: 'odc-by', sourceClass: SOURCE_CLASSES.PUBLIC_OPEN, commercialUse: true,
    test: /open data commons attribution|\bodc[-\s]?by\b/i },
  { id: 'odbl', sourceClass: SOURCE_CLASSES.PUBLIC_OPEN, commercialUse: true,
    test: /open database license|\bodbl\b/i },
  { id: 'ogl', sourceClass: SOURCE_CLASSES.PUBLIC_OPEN, commercialUse: true,
    test: /open government licence|open government license|\bogl\b/i },
  { id: 'copernicus', sourceClass: SOURCE_CLASSES.PUBLIC_OPEN, commercialUse: true,
    test: /copernicus (sentinel )?(data )?(terms|licen[cs]e)|copernicus dem licen[cs]e/i },
  { id: 'mit-bsd-apache', sourceClass: SOURCE_CLASSES.PUBLIC_OPEN, commercialUse: true,
    test: /\bmit license\b|\bbsd[-\s]?[23]|apache license/i },
  // Non-commercial: usable on the academic lane, never on the commercial one.
  { id: 'cc-by-nc', sourceClass: SOURCE_CLASSES.ACADEMIC, commercialUse: false,
    test: /\bcc[-\s]?by[-\s]?nc\b|non[-\s]?commercial/i },
  // Named and explicitly closed. Distinct from "unknown" so the reason survives.
  { id: 'proprietary', sourceClass: SOURCE_CLASSES.RESTRICTED, commercialUse: false,
    test: /proprietary|all rights reserved|\bcopyright\b(?!.*\bcc\b)/i }
]);

/**
 * Map a licence string onto an entitlement class. Fails closed.
 *
 * Returns { licenceRaw, licenceId, sourceClass, commercialUse,
 *           persistence, recognised }.
 */
export function classifyLicence(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text) {
    for (const rule of LICENCE_RULES) {
      if (rule.test.test(text)) {
        return Object.freeze({
          licenceRaw: text,
          licenceId: rule.id,
          sourceClass: rule.sourceClass,
          commercialUse: rule.commercialUse,
          persistence: rule.sourceClass === SOURCE_CLASSES.RESTRICTED
            ? PERSISTENCE.NONE
            : PERSISTENCE.PERSISTENT,
          recognised: true
        });
      }
    }
  }
  // Unrecognised, absent, or empty. Nothing is assumed.
  return Object.freeze({
    licenceRaw: text || null,
    licenceId: 'unknown',
    sourceClass: SOURCE_CLASSES.RESTRICTED,
    commercialUse: false,
    persistence: PERSISTENCE.NONE,
    recognised: false
  });
}

/**
 * Classify from several pieces of evidence, best first.
 *
 * STAC sets license to the literal "proprietary" for anything that is not an
 * SPDX identifier and puts the real terms behind a rel="license" link, so the
 * declared field alone reports NAIP, Landsat, Sentinel-2 and Copernicus DEM as
 * restricted when every one of them is open. The link's title is the
 * authoritative statement; its href is weaker corroboration. First positive
 * identification wins; if none of them land, this still fails closed.
 */
export function classifyLicenceFrom(candidates) {
  const verdicts = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const verdict = classifyLicence(candidate);
    if (verdict.recognised) verdicts.push(verdict);
  }
  // A positive, open identification outranks a placeholder. "proprietary" is
  // what STAC writes for anything that is not an SPDX id, so on its own it
  // means "look elsewhere", not "closed" -- while a rel="license" link titled
  // "Public Domain" is an actual statement about the terms.
  const open = verdicts.find((v) => v.sourceClass !== SOURCE_CLASSES.RESTRICTED);
  if (open) return open;
  // Nothing open was identified. An explicit closed statement still beats
  // silence, because the reason is worth keeping.
  return verdicts[0] ?? classifyLicence(null);
}

/* ── normalization ──────────────────────────────────────────────────────── */

/** EU hub returns i18n maps like {en: 'Title'}; Socrata and STAC return strings. */
function text(value, { max = 500 } = {}) {
  if (typeof value === 'string') return value.trim().slice(0, max) || null;
  if (value && typeof value === 'object') {
    const picked = value.en ?? value.EN ?? Object.values(value).find((v) => typeof v === 'string');
    return typeof picked === 'string' ? picked.trim().slice(0, max) || null : null;
  }
  return null;
}

function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function descriptor({
  catalogKey, protocol, id, title, description = null, publisher = null,
  licence, updatedAt = null, issuedAt = null, bbox = null, temporal = null,
  landingUrl = null, keywords = []
}) {
  return Object.freeze({
    catalog_key: catalogKey,
    protocol,
    id: String(id),
    title,
    description,
    publisher,
    licence,
    updated_at: updatedAt,
    issued_at: issuedAt,
    bbox,
    temporal,
    landing_url: landingUrl,
    keywords: Object.freeze(keywords.filter((k) => typeof k === 'string').slice(0, 24))
  });
}

function normalizeEuHub(raw, cat) {
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.id,
    title: text(raw?.title),
    description: text(raw?.description, { max: 1200 }),
    publisher: text(raw?.publisher?.name ?? raw?.publisher),
    // The hub keeps licence on distributions, not the dataset. Absent here
    // means unknown, and unknown is restricted.
    licence: classifyLicenceFrom([
      text(raw?.license),
      ...(Array.isArray(raw?.distributions)
        ? raw.distributions.flatMap((d) => [text(d?.license), text(d?.rights)])
        : []),
      text(raw?.rights)
    ]),
    updatedAt: isoOrNull(raw?.modified),
    issuedAt: isoOrNull(raw?.issued),
    landingUrl: typeof raw?.id === 'string' ? `https://data.europa.eu/data/datasets/${raw.id}` : null,
    keywords: Array.isArray(raw?.keywords) ? raw.keywords.map((k) => text(k)).filter(Boolean) : []
  });
}

function normalizeSocrata(raw, cat) {
  const res = raw?.resource ?? {};
  const meta = raw?.metadata ?? {};
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: res.id,
    title: text(res.name),
    description: text(res.description, { max: 1200 }),
    publisher: text(meta.domain),
    licence: classifyLicenceFrom([
      text(meta.license), text(meta.rights), text(raw?.resource?.attribution)
    ]),
    updatedAt: isoOrNull(res.updatedAt ?? res.data_updated_at),
    issuedAt: isoOrNull(res.createdAt),
    landingUrl: text(raw?.permalink) ?? text(raw?.link),
    keywords: Array.isArray(raw?.classification?.domain_tags) ? raw.classification.domain_tags : []
  });
}

function normalizeStac(raw, cat) {
  const licenseLink = Array.isArray(raw?.links)
    ? raw.links.find((l) => l?.rel === 'license')
    : null;
  const interval = raw?.extent?.temporal?.interval?.[0];
  const bbox = raw?.extent?.spatial?.bbox?.[0];
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.id,
    title: text(raw?.title) ?? text(raw?.id),
    description: text(raw?.description, { max: 1200 }),
    publisher: text(raw?.providers?.[0]?.name),
    licence: classifyLicenceFrom([
      text(raw?.license),
      text(licenseLink?.title),
      text(licenseLink?.href)
    ]),
    bbox: Array.isArray(bbox) && bbox.length >= 4 ? bbox.slice(0, 4).map(Number) : null,
    temporal: Array.isArray(interval)
      ? [isoOrNull(interval[0]), isoOrNull(interval[1])]
      : null,
    landingUrl: raw?.links?.find((l) => l?.rel === 'self')?.href ?? null,
    keywords: Array.isArray(raw?.keywords) ? raw.keywords : []
  });
}

function normalizeCkan(raw, cat) {
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.id ?? raw?.name,
    title: text(raw?.title),
    description: text(raw?.notes, { max: 1200 }),
    publisher: text(raw?.organization?.title),
    licence: classifyLicenceFrom([
      text(raw?.license_title), text(raw?.license_id), text(raw?.license_url)
    ]),
    updatedAt: isoOrNull(raw?.metadata_modified),
    issuedAt: isoOrNull(raw?.metadata_created),
    landingUrl: typeof raw?.name === 'string' ? `https://catalog.data.gov/dataset/${raw.name}` : null,
    keywords: Array.isArray(raw?.tags) ? raw.tags.map((t) => text(t?.name)).filter(Boolean) : []
  });
}

const NORMALIZERS = Object.freeze({
  [CATALOG_PROTOCOLS.EU_HUB]: normalizeEuHub,
  [CATALOG_PROTOCOLS.SOCRATA]: normalizeSocrata,
  [CATALOG_PROTOCOLS.STAC]: normalizeStac,
  [CATALOG_PROTOCOLS.CKAN]: normalizeCkan
});

export function normalizeDataset(cat, raw) {
  const fn = NORMALIZERS[cat?.protocol];
  if (!fn) throw new Error(`No normalizer for catalog protocol ${cat?.protocol}`);
  return fn(raw, cat);
}

/* ── discovery ──────────────────────────────────────────────────────────── */

/** Where each protocol keeps its page of records and its total count. */
export function pageRequest(cat, { offset = 0, limit = null } = {}) {
  const size = Math.min(limit ?? cat.pageSize, 1000);
  switch (cat.protocol) {
    case CATALOG_PROTOCOLS.EU_HUB:
      return { url: `${cat.endpoint}?limit=${size}&page=${Math.floor(offset / size)}` };
    case CATALOG_PROTOCOLS.SOCRATA:
      return { url: `${cat.endpoint}?limit=${size}&offset=${offset}` };
    case CATALOG_PROTOCOLS.STAC:
      // Collections are the addressable unit; items are fetched per collection.
      return { url: `${cat.endpoint}/collections` };
    case CATALOG_PROTOCOLS.CKAN:
      return { url: `${cat.endpoint}/package_search?rows=${size}&start=${offset}` };
    default:
      throw new Error(`No page request for catalog protocol ${cat.protocol}`);
  }
}

export function extractPage(cat, body) {
  switch (cat.protocol) {
    case CATALOG_PROTOCOLS.EU_HUB:
      return { records: body?.result?.results ?? [], total: body?.result?.count ?? null };
    case CATALOG_PROTOCOLS.SOCRATA:
      return { records: body?.results ?? [], total: body?.resultSetSize ?? null };
    case CATALOG_PROTOCOLS.STAC:
      return { records: body?.collections ?? [], total: (body?.collections ?? []).length };
    case CATALOG_PROTOCOLS.CKAN:
      return { records: body?.result?.results ?? [], total: body?.result?.count ?? null };
    default:
      throw new Error(`No page extractor for catalog protocol ${cat.protocol}`);
  }
}

/**
 * Crawl one page and return normalized descriptors.
 * `fetchImpl` is injectable so this is testable without a network.
 */
export async function discoverPage(cat, { offset = 0, limit = null, fetchImpl = fetch } = {}) {
  const { url } = pageRequest(cat, { offset, limit });
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'mccluster-seek-first-catalog/1.0 (+https://mccluster.org)' },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`${cat.key} catalog page failed: HTTP ${response.status}`);
  const body = await response.json();
  const { records, total } = extractPage(cat, body);
  const datasets = records.map((raw) => normalizeDataset(cat, raw));
  return Object.freeze({
    catalog_key: cat.key,
    offset,
    total,
    returned: datasets.length,
    datasets: Object.freeze(datasets)
  });
}

/** Datasets a given lane is allowed to retain. Restricted never qualifies. */
export function retainableFor(datasets, { commercial = false } = {}) {
  return datasets.filter((d) =>
    d.licence.persistence === PERSISTENCE.PERSISTENT &&
    (!commercial || d.licence.commercialUse)
  );
}
