import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAME_LORE_INPUT_SCHEMA, parseGameLore, queryGameLore, readGameLore } from '../src/game-lore.mjs';
import { createToolRegistry } from '../src/tools/registry.mjs';
import { createCapabilityRegistry } from '../src/capabilities/registry.mjs';
import { CONTROL_TOOLS } from '../src/tools/control.mjs';

function fixture() {
  return {
    schema: 'mccluster.fictional-city/v1', id: 'mccluster-fictional-city', revision: '2026-11-03', title: 'City test',
    district: { name: 'Harbor block' }, constraints: { currency: 'local game credits' },
    brands: [{ id: 'tea', name: 'Tea' }],
    businesses: [{ id: 'tea-shop', brandId: 'tea', name: 'Tea shop', staffIds: ['tea-worker'], itemIds: ['tea-cup'] }],
    npcs: [{ id: 'tea-worker', name: 'Mina', businessId: 'tea-shop', backstory: 'Writes the daily board.',
      dialogue: { greeting: 'Read the board.', topics: [{ id: 'tea', label: 'The tea', lines: [{ speaker: 'Mina', text: 'The tea is real. The promise has terms.' }] }], farewell: 'Take your time.' } }],
    items: [{ id: 'tea-cup', businessId: 'tea-shop', name: 'Cup of tea', price: 5, kind: 'prop' }],
    garage: { id: 'whip-equipped-garage', name: 'Whip Equipped', staffIds: ['garage-worker'], itemIds: [] },
    garageCrew: [{ id: 'garage-worker', name: 'Crew', businessId: 'whip-equipped-garage', age: null, origin: null }],
    portals: [{ id: 'harbor-door', name: 'Harbor', route: 'world.html' }]
  };
}

function snapshot(data = fixture()) {
  return parseGameLore(Buffer.from(JSON.stringify(data)));
}

test('manifest reports exact source bytes and includes garage staff without dumping entity records', () => {
  const raw = Buffer.from(JSON.stringify(fixture(), null, 2));
  const result = queryGameLore(parseGameLore(raw));
  assert.equal(result.manifest.revision, '2026-11-03');
  assert.equal(result.manifest.sha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(result.manifest.source, 'core/data/fictional-city/district.v1.json');
  assert.equal(result.read_only, true);
  assert.deepEqual(result.counts, { brands: 1, businesses: 2, npcs: 2, items: 1, portals: 1, commercial_businesses: 1, new_npcs: 1, garage_crew: 1,
    neighborhoods: 0, families: 0, parcels: 0, expansion_businesses: 0, expansion_npcs: 0, expansion_items: 0 });
  assert.equal(result.records, undefined);
});

test('business and NPC selectors return authored records, complete dialogue and local-credit prices', () => {
  const source = snapshot();
  assert.equal(queryGameLore(source, { section: 'businesses', id: 'whip-equipped-garage' }).records[0].name, 'Whip Equipped');
  const npc = queryGameLore(source, { section: 'npcs', business_id: 'tea-shop' });
  assert.equal(npc.pagination.total, 1);
  assert.deepEqual(npc.records[0].dialogue, fixture().npcs[0].dialogue);
  assert.equal(queryGameLore(source, { section: 'items', business_id: 'tea-shop' }).records[0].price, 5);
  assert.equal(queryGameLore(source, { section: 'npcs', business_id: 'whip-equipped-garage' }).records[0].origin, null);
  assert.deepEqual(queryGameLore(source, { section: 'items', business_id: 'whip-equipped-garage' }).records, []);
  npc.records[0].dialogue.greeting = 'Mutated response';
  assert.equal(queryGameLore(source, { section: 'npcs', id: 'tea-worker' }).records[0].dialogue.greeting, 'Read the board.');
});

test('pagination is deterministic and a small page cannot silently skip a resident', () => {
  const source = snapshot();
  const first = queryGameLore(source, { section: 'npcs', limit: 1 });
  const second = queryGameLore(source, { section: 'npcs', limit: 1, offset: first.pagination.next_offset });
  assert.deepEqual(first.pagination, { offset: 0, count: 1, total: 2, next_offset: 1 });
  assert.deepEqual(second.pagination, { offset: 1, count: 1, total: 2, next_offset: null });
  assert.deepEqual([...first.records, ...second.records].map((row) => row.id), ['tea-worker', 'garage-worker']);
  assert.deepEqual(queryGameLore(source, { section: 'npcs', offset: 20 }).records, []);
});

test('response budget paginates whole records without cutting off dialogue', () => {
  const data = fixture();
  data.npcs = Array.from({ length: 20 }, (_, i) => ({ ...data.npcs[0], id: `resident-${i}`, backstory: 'a'.repeat(10_000) }));
  data.businesses[0].staffIds = data.npcs.map((row) => row.id);
  const source = snapshot(data);
  const result = queryGameLore(source, { section: 'npcs', business_id: 'tea-shop', limit: 24 });
  assert.ok(result.records.length > 0 && result.records.length < 20);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024);
  assert.equal(result.pagination.next_offset, result.records.length);
  assert.equal(result.records[0].backstory.length, 10_000);
  assert.deepEqual(result.records[0].dialogue, data.npcs[0].dialogue);
  const next = queryGameLore(source, { section: 'npcs', business_id: 'tea-shop', offset: result.pagination.next_offset });
  assert.equal(next.records[0].id, data.npcs[result.records.length].id);
});

test('unknown universes, businesses and entity IDs never return invented lore', () => {
  const source = snapshot();
  for (const args of [
    { universe_id: 'another-world' },
    { section: 'npcs', id: 'missing' },
    { section: 'npcs', business_id: 'missing' },
    { section: 'items', business_id: 'whip-equipped-garage', id: 'tea-cup' }
  ]) assert.throws(() => queryGameLore(source, args), (error) => error.status === 404 && error.code === 'GAME_LORE_NOT_FOUND');
});

test('invalid pagination, paths, private-context arguments and ambiguous queries fail closed', async () => {
  const invalid = [null, [], 'all', { section: null }, { section: 'private-memory' },
    { path: '../../etc/passwd' }, { url: 'https://example.org' }, { org_id: 'owner' }, { messages: [] },
    { section: 'npcs', id: '../private' }, { section: 'npcs', id: '' }, { section: 'npcs', id: 3 },
    { section: 'npcs', limit: 25 }, { section: 'npcs', limit: 0 }, { section: 'npcs', limit: null },
    { section: 'npcs', limit: '8' }, { section: 'npcs', offset: -1 }, { section: 'npcs', offset: 1.5 },
    { section: 'npcs', offset: 1001 }, { section: 'npcs', offset: null },
    { section: 'manifest', id: 'tea-shop' }, { section: 'manifest', limit: 8 },
    { section: 'brands', business_id: 'tea-shop' }, { section: 'npcs', id: 'tea-worker', offset: 0 }];
  for (const args of invalid) {
    await assert.rejects(() => readGameLore(args), (error) => error.status === 400 && error.code === 'GAME_LORE_QUERY_INVALID', JSON.stringify(args));
  }
});

test('malformed or oversized releases fail closed instead of becoming partial canon', () => {
  assert.throws(() => parseGameLore('{broken'), { code: 'GAME_LORE_UNAVAILABLE' });
  assert.throws(() => parseGameLore('x'.repeat(1024 * 1024 + 1)), { code: 'GAME_LORE_UNAVAILABLE' });
  // A canon above the former 512 KiB cap still parses; only the 64 KiB response cap bounds a read.
  const large = fixture(); large.constraints.padding = 'p'.repeat(600 * 1024);
  assert.equal(parseGameLore(Buffer.from(JSON.stringify(large))).counts.npcs, 2);
  for (const mutate of [
    (data) => { data.schema = 'other'; },
    (data) => { data.npcs.push(data.npcs[0]); },
    (data) => { data.businesses[0].staffIds.push('missing'); },
    (data) => { data.items[0].businessId = 'missing'; },
    (data) => { data.items[0].price = -5; },
    (data) => { data.items[0].price = 1.5; },
    (data) => { data.businesses[0].brandId = 'missing'; }
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => snapshot(data), { code: 'GAME_LORE_UNAVAILABLE' });
  }
  const data = fixture();
  data.npcs[0].backstory = 'a'.repeat(70_000);
  assert.throws(() => queryGameLore(snapshot(data), { section: 'npcs', id: 'tea-worker' }), { code: 'GAME_LORE_UNAVAILABLE' });
});

test('owned capability resolves to the installed manifest without network, memory retrieval or jobs', async () => {
  const catalog = JSON.parse(await readFile(new URL('../capabilities/catalog.json', import.meta.url), 'utf8'));
  const capability = catalog.capabilities.find((row) => row.id === 'game.lore.read');
  assert.equal(capability.risk, 'read');
  assert.equal(capability.approval, 'none');
  assert.deepEqual(capability.inputSchema, GAME_LORE_INPUT_SCHEMA);
  assert.deepEqual(CONTROL_TOOLS.find((tool) => tool.name === 'core.game.lore.read').inputSchema, GAME_LORE_INPUT_SCHEMA);
  const toolRegistry = createToolRegistry({ mcpServers: [], httpTools: [], computeDiscovery: null });
  const capabilities = createCapabilityRegistry({ toolRegistry });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Lore reads must not call a backend or provider'); };
  try {
    const result = await capabilities.call('game.lore.read', {});
    assert.equal(result.provider, 'mccluster-core');
    assert.equal(result.binding, 'core.game-lore-read');
    assert.equal(result.economics.billing, 'free');
    const lore = result.result.result;
    assert.equal(lore.manifest.id, 'mccluster-fictional-city');
    assert.equal(lore.counts.commercial_businesses, 8);
    assert.equal(lore.counts.new_npcs, 24);
    assert.equal(lore.counts.garage_crew, 3);
    assert.equal(lore.counts.families, 10);
    assert.equal(lore.counts.neighborhoods, 5);
    assert.ok(lore.counts.expansion_npcs >= 40 && lore.counts.expansion_businesses >= 17);
    const raw = await readFile(new URL('../data/fictional-city/district.v1.json', import.meta.url));
    assert.equal(lore.manifest.sha256, createHash('sha256').update(raw).digest('hex'));
  } finally { globalThis.fetch = original; }
});

test('reader works in an installed Core tree with no repository-root data directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mccluster-city-release-'));
  try {
    await mkdir(join(directory, 'src'), { recursive: true });
    await mkdir(join(directory, 'data/fictional-city'), { recursive: true });
    await copyFile(new URL('../src/game-lore.mjs', import.meta.url), join(directory, 'src/game-lore.mjs'));
    await copyFile(new URL('../data/fictional-city/district.v1.json', import.meta.url), join(directory, 'data/fictional-city/district.v1.json'));
    const installed = await import(pathToFileURL(join(directory, 'src/game-lore.mjs')).href);
    const result = await installed.readGameLore({ section: 'businesses', id: 'whip-equipped-garage' });
    assert.equal(result.records[0].id, 'whip-equipped-garage');
    assert.equal(result.manifest.sha256, (await readGameLore()).manifest.sha256);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function expansionFixture() {
  const data = fixture();
  data.schemaRevision = 2;
  data.neighborhoods = [{ id: 'civic-center', name: 'Precinct Square' }, { id: 'northside-residential', name: 'Northside' }];
  data.parcels = [
    { parcelId: 'civic-center/police-station', neighborhoodId: 'civic-center', businessId: 'precinct' },
    { parcelId: 'northside-residential/house-01', neighborhoodId: 'northside-residential', familyId: 'smith-family' }
  ];
  data.expansionBusinesses = [{ id: 'precinct', name: 'Precinct', parcelId: 'civic-center/police-station', staffIds: ['cop'], itemIds: [],
    interactions: [{ type: 'bribe', id: 'bribe-ticket', label: 'Tear up a ticket', price: 20, npcIds: ['cop'] }] }];
  const talk = { greeting: 'Hi.', topics: [{ id: 't', label: 'T', lines: [{ speaker: 'You', text: 'Hi.' }] }], farewell: 'Bye.' };
  data.expansionNpcs = [
    { id: 'cop', name: 'Cop', age: 40, businessId: 'precinct', placement: 'route', homeParcelId: 'civic-center/police-station', routeAnchors: ['civic-center/police-station', 'tea-shop', 'hq-bridge'], dialogue: talk },
    { id: 'kid', name: 'Kid', age: 14, minor: true, familyId: 'smith-family', placement: 'interior', homeParcelId: 'northside-residential/house-01', dialogue: talk }
  ];
  data.families = [{ id: 'smith-family', name: 'The Smiths', parcelId: 'northside-residential/house-01', representativeNpcId: 'kid', members: [{ name: 'Kid', age: 14, minor: true, npcId: 'kid' }] }];
  data.expansionItems = [];
  return data;
}

test('schema revision 2 serves parcel-bound expansion lore through the same bounded sections', () => {
  const source = snapshot(expansionFixture());
  assert.equal(queryGameLore(source).counts.expansion_npcs, 2);
  assert.equal(queryGameLore(source).counts.parcels, 2);
  assert.equal(queryGameLore(source, { section: 'npcs', business_id: 'precinct' }).records[0].id, 'cop');
  assert.equal(queryGameLore(source, { section: 'families', id: 'smith-family' }).records[0].representativeNpcId, 'kid');
  assert.equal(queryGameLore(source, { section: 'parcels' }).records.length, 2);
  assert.equal(queryGameLore(source, { section: 'neighborhoods' }).pagination.total, 2);
});

test('expansion lore fails closed on unbound parcels, unknown route anchors, unlabelled minors and bribes involving minors', () => {
  for (const mutate of [
    (data) => { data.expansionNpcs[0].homeParcelId = 'civic-center/missing'; },
    (data) => { data.expansionNpcs[0].routeAnchors.push('nowhere'); },
    (data) => { delete data.expansionNpcs[1].minor; },
    (data) => { data.expansionBusinesses[0].interactions[0].npcIds = ['kid']; },
    (data) => { data.expansionBusinesses[0].interactions[0].price = 0; },
    (data) => { data.parcels[0].parcelId = '../etc/passwd'; },
    (data) => { data.parcels.push({ ...data.parcels[0] }); },
    (data) => { data.families[0].representativeNpcId = 'missing'; },
    (data) => { data.schemaRevision = 3; }
  ]) {
    const data = expansionFixture(); mutate(data);
    assert.throws(() => snapshot(data), { code: 'GAME_LORE_UNAVAILABLE' });
  }
});
