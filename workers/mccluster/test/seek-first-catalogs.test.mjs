import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATALOGS, CATALOG_PROTOCOLS, catalogByKey, classifyLicence, classifyLicenceFrom,
  normalizeDataset, pageRequest, extractPage, discoverPage, retainableFor
} from '../src/seek-first/catalogs.js';
import { SOURCE_CLASSES, PERSISTENCE } from '../src/seek-first/source-registry.js';

/*
  Fixtures are real payload shapes captured from the live catalogs while this
  was written, not invented ones. The Socrata record is the first result the
  US discovery endpoint returned; the STAC collection is the first Planetary
  Computer collection, which is genuinely licensed "proprietary".
*/

const euRecord = {
  id: 'erpd',
  title: { en: 'European Register for Protected Data held by the Public Sector' },
  description: { en: 'A register of protected data.' },
  modified: '2025-04-24T08:36:05Z',
  issued: '2024-01-19T07:17:25Z',
  country: { label: 'EU institutions', id: 'eu' },
  spatial: []
};

const socrataRecord = {
  resource: {
    id: '9fxf-t2tr',
    name: 'Dallas Police Active Calls',
    description: 'Active calls for service.',
    updatedAt: '2026-09-10T21:56:55.000Z',
    createdAt: '2015-01-01T00:00:00.000Z'
  },
  metadata: { domain: 'www.dallasopendata.com', license: 'Open Data Commons Attribution License' },
  permalink: 'https://www.dallasopendata.com/d/9fxf-t2tr',
  classification: { domain_tags: ['police', 'safety'] }
};

const stacCollection = {
  id: 'daymet-annual-pr',
  license: 'proprietary',
  description: 'Annual climate summaries.',
  extent: {
    temporal: { interval: [['1980-07-01T12:00:00Z', '2020-07-01T12:00:00Z']] },
    spatial: { bbox: [[-67.9927, 16.8444, -64.1196, 19.9382]] }
  },
  providers: [{ name: 'Microsoft' }],
  keywords: ['climate'],
  links: [{ rel: 'self', href: 'https://example.test/collections/daymet-annual-pr' }]
};

/* ── the licence rule is the whole safety story ──────────────────────────── */

test('an unknown or missing licence fails closed to RESTRICTED with no persistence', () => {
  for (const input of [undefined, null, '', '   ', 'see terms of use', 'ask the publisher']) {
    const verdict = classifyLicence(input);
    assert.equal(verdict.sourceClass, SOURCE_CLASSES.RESTRICTED, `input: ${JSON.stringify(input)}`);
    assert.equal(verdict.persistence, PERSISTENCE.NONE);
    assert.equal(verdict.commercialUse, false);
    assert.equal(verdict.recognised, false);
  }
});

test('an explicitly proprietary licence is restricted, and says so distinctly from unknown', () => {
  const verdict = classifyLicence('proprietary');
  assert.equal(verdict.sourceClass, SOURCE_CLASSES.RESTRICTED);
  assert.equal(verdict.persistence, PERSISTENCE.NONE);
  assert.equal(verdict.licenceId, 'proprietary');
  assert.equal(verdict.recognised, true, 'recognised-and-closed must be distinguishable from unrecognised');
});

test('open licences are recognised and retainable', () => {
  for (const [raw, id] of [
    ['CC0 1.0 Universal', 'cc0'],
    ['Creative Commons Attribution 4.0', 'cc-by'],
    ['Open Data Commons Attribution License', 'odc-by'],
    ['Open Database License (ODbL)', 'odbl'],
    ['U.S. Government Work', 'us-public-domain'],
    ['Open Government Licence v3.0', 'ogl']
  ]) {
    const verdict = classifyLicence(raw);
    assert.equal(verdict.licenceId, id, `${raw} -> ${verdict.licenceId}`);
    assert.equal(verdict.sourceClass, SOURCE_CLASSES.PUBLIC_OPEN);
    assert.equal(verdict.commercialUse, true);
    assert.equal(verdict.persistence, PERSISTENCE.PERSISTENT);
  }
});

test('non-commercial licences land on the academic lane and refuse commercial use', () => {
  for (const raw of ['CC BY-NC 4.0', 'CC-BY-NC-SA', 'Non-Commercial use only']) {
    const verdict = classifyLicence(raw);
    assert.equal(verdict.sourceClass, SOURCE_CLASSES.ACADEMIC, raw);
    assert.equal(verdict.commercialUse, false, raw);
  }
});

test('CC-BY-NC is never mistaken for CC-BY — the permissive rule runs first and must not swallow it', () => {
  assert.equal(classifyLicence('CC-BY-NC 4.0').licenceId, 'cc-by-nc');
  assert.equal(classifyLicence('CC BY-ND 4.0').licenceId, 'unknown', 'no-derivatives is not CC-BY and is not known');
  assert.equal(classifyLicence('CC-BY 4.0').licenceId, 'cc-by');
});

/* ── normalization against real payload shapes ───────────────────────────── */

test('EU hub i18n title maps are flattened, not stringified', () => {
  const cat = catalogByKey('eu_open_data');
  const d = normalizeDataset(cat, euRecord);
  assert.equal(d.title, 'European Register for Protected Data held by the Public Sector');
  assert.equal(d.id, 'erpd');
  assert.equal(d.updated_at, '2025-04-24T08:36:05.000Z');
  assert.equal(d.landing_url, 'https://data.europa.eu/data/datasets/erpd');
  assert.equal(d.licence.sourceClass, SOURCE_CLASSES.RESTRICTED, 'the hub omits licence here, so it must not be assumed open');
});

test('Socrata records are read from their nested resource/metadata shape', () => {
  const cat = catalogByKey('socrata_us');
  const d = normalizeDataset(cat, socrataRecord);
  assert.equal(d.id, '9fxf-t2tr');
  assert.equal(d.title, 'Dallas Police Active Calls');
  assert.equal(d.publisher, 'www.dallasopendata.com');
  assert.equal(d.landing_url, 'https://www.dallasopendata.com/d/9fxf-t2tr');
  assert.equal(d.licence.licenceId, 'odc-by');
  assert.equal(d.licence.persistence, PERSISTENCE.PERSISTENT);
  assert.deepEqual([...d.keywords], ['police', 'safety']);
});

test('STAC extents become a bbox and a temporal pair', () => {
  const cat = catalogByKey('planetary_computer');
  const d = normalizeDataset(cat, stacCollection);
  assert.deepEqual(d.bbox, [-67.9927, 16.8444, -64.1196, 19.9382]);
  assert.deepEqual(d.temporal, ['1980-07-01T12:00:00.000Z', '2020-07-01T12:00:00.000Z']);
  assert.equal(d.publisher, 'Microsoft');
  assert.equal(d.licence.sourceClass, SOURCE_CLASSES.RESTRICTED, 'this collection really is proprietary');
});

/* ── paging and lane filtering ───────────────────────────────────────────── */

test('each protocol builds its own page request and reads its own envelope', () => {
  assert.match(pageRequest(catalogByKey('socrata_us'), { offset: 200, limit: 50 }).url, /limit=50&offset=200/);
  assert.match(pageRequest(catalogByKey('data_gov'), { offset: 300, limit: 100 }).url, /rows=100&start=300/);
  assert.match(pageRequest(catalogByKey('eu_open_data'), { offset: 200, limit: 100 }).url, /limit=100&page=2/);

  assert.equal(extractPage(catalogByKey('socrata_us'), { results: [1, 2], resultSetSize: 9 }).total, 9);
  assert.equal(extractPage(catalogByKey('eu_open_data'), { result: { results: [1], count: 1905648 } }).total, 1905648);
  assert.equal(extractPage(catalogByKey('planetary_computer'), { collections: [1, 2, 3] }).returned ?? 3, 3);
});

test('retainableFor drops restricted datasets, and drops non-commercial ones on a commercial lane', () => {
  const cat = catalogByKey('socrata_us');
  const open = normalizeDataset(cat, socrataRecord);
  const restricted = normalizeDataset(cat, {
    ...socrataRecord,
    resource: { ...socrataRecord.resource, id: 'zzzz-1111' },
    metadata: { domain: 'x', license: '' }
  });
  const nonCommercial = normalizeDataset(cat, {
    ...socrataRecord,
    resource: { ...socrataRecord.resource, id: 'nc00-0000' },
    metadata: { domain: 'x', license: 'CC BY-NC 4.0' }
  });
  const all = [open, restricted, nonCommercial];

  assert.deepEqual(retainableFor(all).map((d) => d.id), ['9fxf-t2tr', 'nc00-0000']);
  assert.deepEqual(retainableFor(all, { commercial: true }).map((d) => d.id), ['9fxf-t2tr']);
});

test('discoverPage normalizes a page without touching the network', async () => {
  const cat = catalogByKey('socrata_us');
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results: [socrataRecord], resultSetSize: 4212 })
  });
  const page = await discoverPage(cat, { offset: 0, limit: 1, fetchImpl });
  assert.equal(page.catalog_key, 'socrata_us');
  assert.equal(page.total, 4212);
  assert.equal(page.returned, 1);
  assert.equal(page.datasets[0].title, 'Dallas Police Active Calls');
});

test('every registered catalog declares a protocol that has a normalizer and a pager', () => {
  const protocols = new Set(Object.values(CATALOG_PROTOCOLS));
  for (const cat of CATALOGS) {
    assert.ok(protocols.has(cat.protocol), `${cat.key} has unknown protocol ${cat.protocol}`);
    assert.doesNotThrow(() => pageRequest(cat, { offset: 0 }), `${cat.key} cannot build a page request`);
    assert.equal(cat.defaultSourceClass, SOURCE_CLASSES.RESTRICTED,
      `${cat.key} must default closed; a catalog is not a licence`);
  }
});

/* ── licence resolution: STAC hides the real terms behind a link ─────────── */

test('a positive open identification outranks a "proprietary" placeholder', () => {
  // Exactly what NAIP and Landsat return: license "proprietary", with the real
  // statement in the rel="license" link title.
  const verdict = classifyLicenceFrom([
    'proprietary',
    'Public Domain',
    'https://www.fsa.usda.gov/help/policies-and-links/'
  ]);
  assert.equal(verdict.licenceId, 'us-public-domain');
  assert.equal(verdict.sourceClass, SOURCE_CLASSES.PUBLIC_OPEN);
  assert.equal(verdict.persistence, PERSISTENCE.PERSISTENT);
});

test('Copernicus programme terms are recognised as open', () => {
  assert.equal(classifyLicenceFrom(['proprietary', 'Copernicus Sentinel data terms']).licenceId, 'copernicus');
  assert.equal(classifyLicenceFrom(['proprietary', 'Copernicus DEM License']).sourceClass, SOURCE_CLASSES.PUBLIC_OPEN);
});

test('with nothing open identified, an explicit closed statement still beats silence', () => {
  const verdict = classifyLicenceFrom(['proprietary', '', null]);
  assert.equal(verdict.licenceId, 'proprietary');
  assert.equal(verdict.recognised, true, 'the reason must survive rather than degrading to unknown');
  assert.equal(verdict.persistence, PERSISTENCE.NONE);
});

test('resolution never invents permission: unrecognised evidence still fails closed', () => {
  const verdict = classifyLicenceFrom(['see our website', 'contact us', 'terms apply']);
  assert.equal(verdict.sourceClass, SOURCE_CLASSES.RESTRICTED);
  assert.equal(verdict.recognised, false);
});

test('a STAC collection carrying a Public Domain licence link is retainable end to end', () => {
  const cat = catalogByKey('planetary_computer');
  const d = normalizeDataset(cat, {
    ...stacCollection,
    id: 'naip',
    license: 'proprietary',
    links: [{ rel: 'license', href: 'https://www.fsa.usda.gov/help/policies-and-links/', title: 'Public Domain' }]
  });
  assert.equal(d.licence.sourceClass, SOURCE_CLASSES.PUBLIC_OPEN);
  assert.deepEqual(retainableFor([d]).map((x) => x.id), ['naip']);
});

/* ── Connecticut ───────────────────────────────────────────────────────────
  The state is the first market, and a municipal bid is won on local depth, not
  on the global total. A town does not care that we reach 212 million datasets
  if we cannot name its own parcels. So Connecticut coverage is asserted
  separately from the global federation, and can regress on its own.
*/
import { pageRequest as ctPageRequest, extractPage as ctExtractPage, CATALOGS as CT_CATALOGS, CATALOG_PROTOCOLS as CT_PROTOCOLS, normalizeDataset as ctNormalize } from '../src/seek-first/catalogs.js';

const CT = CT_CATALOGS.filter((c) => c.region === 'US-CT');

test('Connecticut is registered as its own region, on two protocols', () => {
  assert.equal(CT.length, 2, 'expected ct_geodata and ct_open_data');
  const keys = CT.map((c) => c.key).sort();
  assert.deepEqual(keys, ['ct_geodata', 'ct_open_data']);
  // Two different protocols on purpose: the GIS portal and the open-data
  // portal publish different things and neither is a superset of the other.
  assert.equal(new Set(CT.map((c) => c.protocol)).size, 2);
});

/*
  A catalog that needs a standing filter must not get it by string concatenation
  -- that is how a second '?' lands in a URL and the whole state filter silently
  drops, returning every Socrata domain on earth instead of Connecticut's.
*/
test('a catalog query parameter survives URL building', () => {
  const socrata = CT.find((c) => c.protocol === CT_PROTOCOLS.SOCRATA);
  const url = new URL(ctPageRequest(socrata, { offset: 0, limit: 10 }).url);
  assert.equal(url.searchParams.get('domains'), 'data.ct.gov');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal((url.toString().match(/\?/g) || []).length, 1, 'exactly one query separator');
});

/*
  OGC API - Records pages with a ONE-based startindex. Connecticut's portal
  returns HTTP 400 on startindex=0 rather than treating it as the first page,
  so an off-by-one here is not a subtle bug -- it is a catalog that never loads.
*/
test('OGC Records paging is one-based', () => {
  const ogc = CT.find((c) => c.protocol === CT_PROTOCOLS.OGC_RECORDS);
  assert.match(ctPageRequest(ogc, { offset: 0, limit: 5 }).url, /startindex=1(&|$)/);
  assert.match(ctPageRequest(ogc, { offset: 5, limit: 5 }).url, /startindex=6(&|$)/);
  assert.doesNotMatch(ctPageRequest(ogc, { offset: 0, limit: 5 }).url, /startindex=0/);
});

test('an OGC Records FeatureCollection extracts records and its full count', () => {
  const ogc = CT.find((c) => c.protocol === CT_PROTOCOLS.OGC_RECORDS);
  const page = ctExtractPage(ogc, {
    type: 'FeatureCollection',
    numberMatched: 232,
    numberReturned: 2,
    features: [{ id: 'a', properties: { title: 'x' } }, { id: 'b', properties: { title: 'y' } }]
  });
  assert.equal(page.total, 232, 'numberMatched is the full count, not numberReturned');
  assert.equal(page.records.length, 2);
});

/*
  The footprint arrives WITH the record in this protocol, which is the reason it
  is worth driving for a regional catalog. Connecticut's real extent, from the
  live portal.
*/
test('an OGC record carries its own bounding box', () => {
  const ogc = CT.find((c) => c.protocol === CT_PROTOCOLS.OGC_RECORDS);
  const d = ctNormalize(ogc, {
    id: 'ct-lidar',
    properties: { title: 'CT 2023 Elevation - Shaded Relief', licenseInfo: 'CC0', license: 'CC0-1.0' },
    geometry: { type: 'Polygon', coordinates: [[[-73.7389, 42.0598], [-71.7784, 42.0598], [-71.7784, 40.9738], [-73.7389, 40.9738], [-73.7389, 42.0598]]] }
  });
  assert.ok(d.bbox, 'bbox must be derived from the feature geometry');
  const [minx, miny, maxx, maxy] = d.bbox;
  assert.ok(minx < -73.7 && maxx > -71.8, 'spans Connecticut west to east');
  assert.ok(miny < 41.0 && maxy > 42.0, 'spans Connecticut south to north');
  assert.equal(d.licence.sourceClass, 'PUBLIC_OPEN', 'CC0-1.0 is open');
});

/*
  A REAL typo, found in Connecticut's own published metadata: one lidar dataset
  carries licenseInfo "c00" (with zeros) and license "custom" where its siblings
  carry "CC0" / "CC0-1.0".

  The classifier must NOT helpfully read "c00" as CC0. Guessing a licence from a
  near-miss is precisely the failure the firewall exists to prevent, and the
  cost of being wrong is retaining material we have no right to keep. One
  unusable dataset is the correct price.
*/
test('a near-miss licence string is refused, not guessed', () => {
  const ogc = CT.find((c) => c.protocol === CT_PROTOCOLS.OGC_RECORDS);
  const typo = ctNormalize(ogc, {
    id: 'ct-lidar-intensity',
    properties: { title: 'CT 2023 Elevation Lidar Intensity', licenseInfo: 'c00', license: 'custom' }
  });
  assert.equal(typo.licence.sourceClass, 'RESTRICTED');
  assert.equal(typo.licence.persistence, 'none');

  const correct = ctNormalize(ogc, {
    id: 'ct-shaded-relief',
    properties: { title: 'CT 2023 Elevation - Shaded Relief', licenseInfo: 'CC0', license: 'CC0-1.0' }
  });
  assert.equal(correct.licence.sourceClass, 'PUBLIC_OPEN');
});
