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
  CKAN: 'ckan',
  DATACITE: 'datacite',
  OPENAIRE: 'openaire',
  ZENODO: 'zenodo',
  DATAVERSE: 'dataverse',
  ARCGIS_HUB: 'arcgis-hub',
  OPENDATASOFT: 'opendatasoft',
  // OGC API - Records. An open standard rather than a vendor API, which is why
  // it is worth a driver: Connecticut's geodata portal speaks it, and so does a
  // growing set of national and state portals that will never speak Socrata.
  OGC_RECORDS: 'ogc-records'
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
  pageSize = 100,
  // Extra query parameters a catalog needs on every request -- a Socrata
  // domain filter, an org scope. Kept separate from `endpoint` so URL
  // building never has to guess whether a '?' is already present.
  query = null,
  // Where this catalog's data is about, when it is regional. Purely
  // descriptive; nothing filters on it yet.
  region = null
}) {
  return Object.freeze({
    key, name, protocol, endpoint, homepage,
    defaultSourceClass, lane, attribution, pageSize,
    query: query ? Object.freeze({ ...query }) : null,
    region
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
  // Every entry below speaks CKAN, so all of them cost zero new code.
  catalog({
    key: 'data_gov_uk',
    name: 'data.gov.uk',
    protocol: CATALOG_PROTOCOLS.CKAN,
    endpoint: 'https://data.gov.uk/api/3/action',
    homepage: 'https://data.gov.uk',
    attribution: 'UK Government, data.gov.uk'
  }),
  catalog({
    key: 'open_canada',
    name: 'Open Government Canada',
    protocol: CATALOG_PROTOCOLS.CKAN,
    endpoint: 'https://open.canada.ca/data/en/api/3/action',
    homepage: 'https://open.canada.ca',
    attribution: 'Government of Canada Open Government'
  }),
  catalog({
    key: 'un_hdx',
    name: 'UN OCHA Humanitarian Data Exchange',
    protocol: CATALOG_PROTOCOLS.CKAN,
    endpoint: 'https://data.humdata.org/api/3/action',
    homepage: 'https://data.humdata.org',
    attribution: 'UN OCHA Humanitarian Data Exchange'
  }),
  catalog({
    key: 'data_gov_bc',
    name: 'British Columbia Data Catalogue',
    protocol: CATALOG_PROTOCOLS.CKAN,
    endpoint: 'https://catalogue.data.gov.bc.ca/api/3/action',
    homepage: 'https://catalogue.data.gov.bc.ca',
    attribution: 'Province of British Columbia'
  }),

  // Research data. These are where the volume actually is.
  catalog({
    key: 'arcgis_hub',
    name: 'ArcGIS Hub (government GIS layers)',
    protocol: CATALOG_PROTOCOLS.ARCGIS_HUB,
    endpoint: 'https://opendata.arcgis.com/api/v3/datasets',
    homepage: 'https://hub.arcgis.com',
    attribution: 'Esri ArcGIS Hub open data',
    pageSize: 100
  }),
  /*
    CONNECTICUT.

    The state is the first market, and a bid is won on local depth rather than
    on global breadth -- a town does not care that we reach 212 million datasets
    if we cannot name its own parcels. These two catalogs are registered
    separately from the global federation so Connecticut coverage can be
    measured, and regressed, on its own.

    Connecticut also has no county government: 169 municipalities and 9 councils
    of governments, and the COGs are the bodies that collect parcel and CAMA
    data from every town annually under Conn. Gen. Stat. 7-100l. That statutory
    pipeline is why statewide parcel coverage exists at all.
  */
  catalog({
    key: 'ct_geodata',
    name: 'Connecticut Geodata Portal (CT GIS Office)',
    protocol: CATALOG_PROTOCOLS.OGC_RECORDS,
    endpoint: 'https://geodata.ct.gov/api/search/v1/collections/dataset/items',
    homepage: 'https://geodata.ct.gov',
    attribution: 'Connecticut GIS Office / CT Office of Policy and Management',
    region: 'US-CT',
    pageSize: 100
  }),
  catalog({
    key: 'ct_open_data',
    name: 'Connecticut Open Data (data.ct.gov)',
    protocol: CATALOG_PROTOCOLS.SOCRATA,
    endpoint: 'https://api.us.socrata.com/api/catalog/v1',
    query: { domains: 'data.ct.gov' },
    homepage: 'https://data.ct.gov',
    attribution: 'State of Connecticut open data',
    region: 'US-CT',
    pageSize: 100
  }),
  catalog({
    key: 'opendatasoft',
    name: 'OpenDataSoft federated catalog',
    protocol: CATALOG_PROTOCOLS.OPENDATASOFT,
    endpoint: 'https://data.opendatasoft.com/api/explore/v2.1/catalog/datasets',
    homepage: 'https://data.opendatasoft.com',
    attribution: 'OpenDataSoft federated portals',
    pageSize: 100
  }),
  catalog({
    key: 'datacite',
    name: 'DataCite (global dataset DOI registry)',
    protocol: CATALOG_PROTOCOLS.DATACITE,
    endpoint: 'https://api.datacite.org/dois',
    homepage: 'https://datacite.org',
    attribution: 'DataCite DOI registry',
    pageSize: 100
  }),
  catalog({
    key: 'openaire',
    name: 'OpenAIRE research graph',
    protocol: CATALOG_PROTOCOLS.OPENAIRE,
    endpoint: 'https://api.openaire.eu/search/datasets',
    homepage: 'https://explore.openaire.eu',
    attribution: 'OpenAIRE research graph',
    pageSize: 50
  }),
  catalog({
    key: 'zenodo',
    name: 'Zenodo (CERN)',
    protocol: CATALOG_PROTOCOLS.ZENODO,
    endpoint: 'https://zenodo.org/api/records',
    homepage: 'https://zenodo.org',
    attribution: 'Zenodo, operated by CERN',
    pageSize: 100
  }),
  catalog({
    key: 'harvard_dataverse',
    name: 'Harvard Dataverse',
    protocol: CATALOG_PROTOCOLS.DATAVERSE,
    endpoint: 'https://dataverse.harvard.edu/api/search',
    homepage: 'https://dataverse.harvard.edu',
    attribution: 'Harvard Dataverse',
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

function normalizeDataCite(raw, cat) {
  const a = raw?.attributes ?? {};
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.id ?? a.doi,
    title: text(a.titles?.[0]?.title),
    description: text(a.descriptions?.[0]?.description, { max: 1200 }),
    publisher: text(a.publisher?.name ?? a.publisher),
    licence: classifyLicenceFrom([
      text(a.rightsList?.[0]?.rights),
      text(a.rightsList?.[0]?.rightsIdentifier),
      text(a.rightsList?.[0]?.rightsUri)
    ]),
    updatedAt: isoOrNull(a.updated),
    issuedAt: isoOrNull(a.created ?? a.registered),
    landingUrl: text(a.url) ?? (a.doi ? `https://doi.org/${a.doi}` : null),
    keywords: Array.isArray(a.subjects) ? a.subjects.map((x) => text(x?.subject)).filter(Boolean) : []
  });
}

function normalizeOpenAire(raw, cat) {
  const meta = raw?.metadata?.['oaf:entity']?.['oaf:result'] ?? raw ?? {};
  const pick = (v) => (Array.isArray(v) ? v[0] : v);
  const val = (v) => text(pick(v)?.$ ?? pick(v));
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: val(meta.originalId) ?? val(meta.objIdentifier) ?? raw?.header?.['dri:objIdentifier']?.$,
    title: val(meta.title),
    description: val(meta.description),
    publisher: val(meta.publisher),
    licence: classifyLicenceFrom([val(meta.bestaccessright?.['@classname']), val(meta.license), val(meta.rights)]),
    issuedAt: isoOrNull(val(meta.dateofacceptance)),
    keywords: []
  });
}

function normalizeZenodo(raw, cat) {
  const meta = raw?.metadata ?? {};
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.id ?? raw?.doi,
    title: text(raw?.title ?? meta.title),
    description: text(meta.description, { max: 1200 }),
    publisher: text(meta.creators?.[0]?.affiliation) ?? 'Zenodo',
    licence: classifyLicenceFrom([
      text(meta.license?.id), text(meta.license), text(raw?.rights?.[0]?.title)
    ]),
    updatedAt: isoOrNull(raw?.updated),
    issuedAt: isoOrNull(meta.publication_date ?? raw?.created),
    landingUrl: text(raw?.links?.self_html) ?? (raw?.doi ? `https://doi.org/${raw.doi}` : null),
    keywords: Array.isArray(meta.keywords) ? meta.keywords : []
  });
}

function normalizeDataverse(raw, cat) {
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.global_id ?? raw?.entity_id,
    title: text(raw?.name),
    description: text(raw?.description, { max: 1200 }),
    publisher: text(raw?.publisher),
    licence: classifyLicenceFrom([text(raw?.license), text(raw?.storageIdentifier && null)]),
    updatedAt: isoOrNull(raw?.updatedAt),
    issuedAt: isoOrNull(raw?.published_at ?? raw?.createdAt),
    landingUrl: text(raw?.url),
    keywords: Array.isArray(raw?.subjects) ? raw.subjects : []
  });
}

/*
  OGC API - Records. Each record is a GeoJSON Feature whose `properties` carry
  the metadata and whose `geometry` is the dataset's footprint -- which is why
  this protocol is worth having for a regional catalog: the extent arrives with
  the record instead of needing a second lookup.
*/
function normalizeOgcRecords(raw, cat) {
  const p = raw?.properties ?? {};
  // `extent` here is an ArcGIS-style envelope [[minx,miny],[maxx,maxy]]; the
  // Feature's own geometry is a polygon. Prefer the envelope, fall back to the
  // polygon's bounds.
  let bbox = null;
  const e = p.extent;
  if (Array.isArray(e) && e.length === 2 && Array.isArray(e[0]) && Array.isArray(e[1])) {
    bbox = [Number(e[0][0]), Number(e[0][1]), Number(e[1][0]), Number(e[1][1])];
  } else if (raw?.geometry?.type === 'Polygon' && Array.isArray(raw.geometry.coordinates?.[0])) {
    const ring = raw.geometry.coordinates[0].filter((pt) => Array.isArray(pt) && pt.length >= 2);
    if (ring.length) {
      const xs = ring.map((pt) => Number(pt[0]));
      const ys = ring.map((pt) => Number(pt[1]));
      bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
  }
  const keywords = [
    ...(Array.isArray(p.keywords) ? p.keywords : []),
    ...(Array.isArray(p.typeKeywords) ? p.typeKeywords : [])
  ].map((k) => String(k)).slice(0, 40);

  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.id ?? p.id,
    title: text(p.title ?? p.name),
    description: text(String(p.description ?? p.snippet ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), { max: 1200 }),
    publisher: text(p.owner ?? p.orgId ?? cat.name),
    // licenseInfo is an HTML fragment as often as it is an identifier, so it is
    // stripped before classification -- and classifyLicenceFrom still fails
    // closed on anything it cannot place.
    licence: classifyLicenceFrom([
      text(String(p.license ?? '').replace(/<[^>]*>/g, ' ')),
      text(String(p.licenseInfo ?? '').replace(/<[^>]*>/g, ' ')),
      text(p.rights)
    ]),
    updatedAt: isoOrNull(p.modified ?? p.updated),
    issuedAt: isoOrNull(p.created ?? p.published),
    bbox: bbox && bbox.every(Number.isFinite) ? bbox : null,
    landingUrl: (Array.isArray(raw?.links) ? raw.links.find((l) => l?.rel === 'self')?.href : null) ?? null,
    keywords
  });
}

function normalizeArcgis(raw, cat) {
  const a = raw?.attributes ?? {};
  // extent is an envelope: [[minx, miny], [maxx, maxy]]
  const c = a.extent?.coordinates;
  const bbox = Array.isArray(c) && c.length === 2 && Array.isArray(c[0]) && Array.isArray(c[1])
    ? [Number(c[0][0]), Number(c[0][1]), Number(c[1][0]), Number(c[1][1])]
    : null;
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.id,
    title: text(a.name),
    // Hub descriptions are HTML fragments; strip tags so this stays readable.
    description: text(String(a.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), { max: 1200 }),
    publisher: text(a.source) ?? text(a.owner),
    licence: classifyLicenceFrom([text(a.license), text(a.licenseInfo)]),
    // Hub timestamps are epoch milliseconds, not ISO strings.
    updatedAt: isoOrNull(typeof a.modified === 'number' ? a.modified : a.modified),
    issuedAt: isoOrNull(typeof a.created === 'number' ? a.created : a.created),
    bbox: bbox && bbox.every(Number.isFinite) ? bbox : null,
    landingUrl: raw?.links?.self ?? null,
    keywords: Array.isArray(a.tags) ? a.tags : []
  });
}

function normalizeOpenDataSoft(raw, cat) {
  const m = raw?.metas?.default ?? {};
  const bbox = Array.isArray(m.bbox) && m.bbox.length >= 4 ? m.bbox.slice(0, 4).map(Number) : null;
  return descriptor({
    catalogKey: cat.key,
    protocol: cat.protocol,
    id: raw?.dataset_id ?? raw?.dataset_uid,
    title: text(m.title),
    description: text(String(m.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), { max: 1200 }),
    publisher: text(m.publisher),
    licence: classifyLicenceFrom([text(m.license), text(m.license_url), text(m.attributions)]),
    updatedAt: isoOrNull(m.modified),
    issuedAt: isoOrNull(m.data_processed),
    bbox: bbox && bbox.every(Number.isFinite) ? bbox : null,
    landingUrl: raw?.dataset_id ? `https://data.opendatasoft.com/explore/dataset/${raw.dataset_id}/` : null,
    keywords: Array.isArray(m.keyword) ? m.keyword : []
  });
}

const NORMALIZERS = Object.freeze({
  [CATALOG_PROTOCOLS.EU_HUB]: normalizeEuHub,
  [CATALOG_PROTOCOLS.SOCRATA]: normalizeSocrata,
  [CATALOG_PROTOCOLS.STAC]: normalizeStac,
  [CATALOG_PROTOCOLS.CKAN]: normalizeCkan,
  [CATALOG_PROTOCOLS.DATACITE]: normalizeDataCite,
  [CATALOG_PROTOCOLS.OPENAIRE]: normalizeOpenAire,
  [CATALOG_PROTOCOLS.ZENODO]: normalizeZenodo,
  [CATALOG_PROTOCOLS.DATAVERSE]: normalizeDataverse,
  [CATALOG_PROTOCOLS.ARCGIS_HUB]: normalizeArcgis,
  [CATALOG_PROTOCOLS.OPENDATASOFT]: normalizeOpenDataSoft,
  [CATALOG_PROTOCOLS.OGC_RECORDS]: normalizeOgcRecords
});

export function normalizeDataset(cat, raw) {
  const fn = NORMALIZERS[cat?.protocol];
  if (!fn) throw new Error(`No normalizer for catalog protocol ${cat?.protocol}`);
  return fn(raw, cat);
}

/* ── discovery ──────────────────────────────────────────────────────────── */

/*
  Merge a catalog's standing query parameters into a URL that may already carry
  its own. Building these by string concatenation is how a second '?' gets into
  a URL and a whole catalog silently returns the unfiltered firehose.
*/
function withCatalogQuery(cat, url) {
  if (!cat.query) return url;
  const parsed = new URL(url);
  for (const [k, v] of Object.entries(cat.query)) {
    if (v === undefined || v === null) continue;
    parsed.searchParams.set(k, String(v));
  }
  return parsed.toString();
}

/** Where each protocol keeps its page of records and its total count. */
export function pageRequest(cat, { offset = 0, limit = null } = {}) {
  const size = Math.min(limit ?? cat.pageSize, 1000);
  switch (cat.protocol) {
    case CATALOG_PROTOCOLS.EU_HUB:
      return { url: withCatalogQuery(cat, `${cat.endpoint}?limit=${size}&page=${Math.floor(offset / size)}`) };
    case CATALOG_PROTOCOLS.SOCRATA:
      return { url: withCatalogQuery(cat, `${cat.endpoint}?limit=${size}&offset=${offset}`) };
    case CATALOG_PROTOCOLS.STAC:
      // Collections are the addressable unit; items are fetched per collection.
      return { url: `${cat.endpoint}/collections` };
    case CATALOG_PROTOCOLS.CKAN:
      return { url: withCatalogQuery(cat, `${cat.endpoint}/package_search?rows=${size}&start=${offset}`) };
    case CATALOG_PROTOCOLS.DATACITE:
      return { url: withCatalogQuery(cat, `${cat.endpoint}?resource-type-id=dataset&page%5Bsize%5D=${size}&page%5Bnumber%5D=${Math.floor(offset / size) + 1}`) };
    case CATALOG_PROTOCOLS.OPENAIRE:
      return { url: withCatalogQuery(cat, `${cat.endpoint}?size=${size}&page=${Math.floor(offset / size)}&format=json`) };
    case CATALOG_PROTOCOLS.ZENODO:
      return { url: withCatalogQuery(cat, `${cat.endpoint}?size=${size}&page=${Math.floor(offset / size) + 1}`) };
    case CATALOG_PROTOCOLS.DATAVERSE:
      return { url: withCatalogQuery(cat, `${cat.endpoint}?q=*&type=dataset&per_page=${size}&start=${offset}`) };
    case CATALOG_PROTOCOLS.ARCGIS_HUB:
      return { url: withCatalogQuery(cat, `${cat.endpoint}?page%5Bsize%5D=${size}&page%5Bnumber%5D=${Math.floor(offset / size) + 1}`) };
    case CATALOG_PROTOCOLS.OPENDATASOFT:
      return { url: withCatalogQuery(cat, `${cat.endpoint}?limit=${Math.min(size, 100)}&offset=${offset}`) };
    case CATALOG_PROTOCOLS.OGC_RECORDS:
      // startindex is ONE-based in this standard, and a server will 400 on
      // startindex=0 rather than treat it as the first page. Verified against
      // Connecticut's portal, which advertises `startindex=6` as the `next`
      // link for the second page of five.
      return { url: withCatalogQuery(cat, `${cat.endpoint}?limit=${size}&startindex=${offset + 1}`) };
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
    case CATALOG_PROTOCOLS.DATACITE:
      return { records: body?.data ?? [], total: body?.meta?.total ?? null };
    case CATALOG_PROTOCOLS.OPENAIRE: {
      const results = body?.response?.results?.result ?? [];
      return {
        records: Array.isArray(results) ? results : [results],
        total: Number(body?.response?.header?.total?.$ ?? body?.response?.header?.total) || null
      };
    }
    case CATALOG_PROTOCOLS.ZENODO:
      return { records: body?.hits?.hits ?? [], total: body?.hits?.total ?? null };
    case CATALOG_PROTOCOLS.DATAVERSE:
      return { records: body?.data?.items ?? [], total: body?.data?.total_count ?? null };
    case CATALOG_PROTOCOLS.ARCGIS_HUB:
      return { records: body?.data ?? [], total: body?.meta?.stats?.totalCount ?? null };
    case CATALOG_PROTOCOLS.OPENDATASOFT:
      return { records: body?.results ?? [], total: body?.total_count ?? null };
    case CATALOG_PROTOCOLS.OGC_RECORDS:
      // A GeoJSON FeatureCollection; numberMatched is the full result count,
      // numberReturned only this page.
      return { records: body?.features ?? [], total: body?.numberMatched ?? null };
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
