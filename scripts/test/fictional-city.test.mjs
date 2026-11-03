import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { initialState, sanitizeState, purchase, loadState, saveState, recordMeeting, recordVisit, STATE_KEY } from '../../js/fictional-city/state.mjs';
import { createCoreLoreLink, manifestDigest, unwrapLore } from '../../js/fictional-city/core-link.mjs';
import { buildCityExport } from '../../tools/publish-fictional-city.mjs';
import { createSpatialWorld, isWalkable, findWalkingPath, moveWithCollisions, interiorWorld } from '../../js/fictional-city/spatial.mjs';

const bytes = await readFile(new URL('../../core/data/fictional-city/district.v1.json', import.meta.url));
const city = JSON.parse(bytes);
const allBuildings = [...city.businesses, city.garage], people = [...city.npcs, ...city.garageCrew];
const world = createSpatialWorld(allBuildings, city.district.island.hq);
const memory = () => {
  const data = new Map();
  return { getItem: id => data.get(id) ?? null, setItem: (id, value) => data.set(id, value) };
};

test('authored district has exactly eight businesses, 24 adult new residents and three established garage characters', () => {
  assert.equal(city.businesses.length, 8); assert.equal(city.npcs.length, 24); assert.equal(city.garageCrew.length, 3);
  for (const b of city.businesses) {
    assert.equal(b.staffIds.length, 3); assert.equal(new Set(b.staffIds).size, 3);
    for (const id of b.staffIds) assert.equal(city.npcs.find(n => n.id === id)?.businessId, b.id);
  }
  assert.equal(new Set(people.map(n => n.id)).size, 27);
  for (const n of city.npcs) {
    assert.ok(n.age >= 18); assert.ok(n.origin); assert.ok(n.backstory.length > 100);
    assert.equal(n.dialogue.topics.length, 3);
    for (const topic of n.dialogue.topics) assert.ok(topic.lines.length >= 4);
  }
  assert.ok(!people.some(n => /alana|atlanta/i.test(n.name)));
});
test('every storefront and island entry is walkable and reachable without walking through water or a building', () => {
  const spawn = { x: city.district.spawn[0], z: city.district.spawn[1] };
  for (const b of allBuildings) {
    const p = { x: b.entrance[0], z: b.entrance[1] };
    assert.ok(isWalkable(p.x, p.z, world), b.id);
    const path = findWalkingPath(spawn, p, world);
    assert.ok(path.length > 0, b.id + ' has a path');
    assert.ok(path.every(n => isWalkable(n.x, n.z, world)));
    assert.equal(isWalkable(b.position[0], b.position[1], world), false);
  }
  assert.ok(findWalkingPath(spawn, { x: 0, z: 74 }, world).length);
  assert.equal(isWalkable(15, 55, world), false);
  assert.equal(isWalkable(0, 88, world), false);
});
test('outdoor NPC routes stay on walkable land and campaign workers actually have patrol routes', () => {
  for (const n of city.npcs.filter(n => n.placement !== 'interior')) {
    assert.ok(n.route.length >= 1, n.id);
    for (const [x, z] of n.route) assert.ok(isWalkable(x, z, world, .2), n.id + ' ' + x + ',' + z);
  }
  const mike = city.businesses.find(b => b.id === 'mike-hawk');
  for (const id of mike.staffIds) {
    const n = city.npcs.find(n => n.id === id); assert.equal(n.placement, 'patrol'); assert.ok(n.route.length >= 2);
  }
});
test('high-speed movement cannot tunnel through a store or leave the harbor edge', () => {
  const p = allBuildings[0].entrance;
  const hit = moveWithCollisions({ x: p[0], z: p[1] }, 0, -25, world);
  assert.ok(isWalkable(hit.x, hit.z, world)); assert.ok(hit.z > -16);
  const edge = moveWithCollisions({ x: 30, z: 44 }, 0, 30, world);
  assert.ok(edge.z < 45); assert.ok(isWalkable(edge.x, edge.z, world));
  for (const garage of [false, true]) {
    const room = interiorWorld(garage);
    assert.ok(isWalkable(0, 2, room));
    assert.ok(!isWalkable(room.width, 2, room));
  }
});
test('all 24 game items resolve to their counter and have bounded integral fictional prices', () => {
  assert.equal(city.items.length, 24); assert.equal(new Set(city.items.map(i => i.id)).size, 24);
  for (const item of city.items) {
    const b = allBuildings.find(b => b.id === item.businessId);
    assert.ok(b?.itemIds.includes(item.id)); assert.ok(Number.isSafeInteger(item.price) && item.price > 0 && item.price <= 250);
  }
});
test('every travel handoff points to an existing, published root page', async () => {
  for (const portal of city.portals) {
    const url = new URL(portal.route, 'https://matthew.mccluster.org/');
    assert.equal(url.origin, 'https://matthew.mccluster.org');
    assert.ok(!url.pathname.includes('_unfinished/'));
    await access(new URL('../..' + url.pathname, import.meta.url));
  }
});
test('purchases preserve immutable state, charge once per item and reject unaffordable or unknown purchases', () => {
  const start = initialState(city), item = city.items[0];
  const result = purchase(start, item.id, city, 123);
  assert.ok(result.ok); assert.equal(start.credits, 250); assert.deepEqual(start.inventory, {});
  assert.equal(result.state.credits, 250 - item.price); assert.equal(result.state.inventory[item.id], 1);
  assert.deepEqual(result.state.receipts[0], { itemId: item.id, price: item.price, at: 123 });
  for (const id of ['unknown', '__proto__']) assert.equal(purchase(start, id, city).ok, false);
  const broke = { ...start, credits: item.price - 1 };
  assert.equal(purchase(broke, item.id, city).ok, false); assert.equal(broke.credits, item.price - 1);
  assert.equal(purchase({ ...start, inventory: { [item.id]: 99 } }, item.id, city).ok, false);
});
test('corrupt or old saves cannot inject items, negative credits, invalid residents or nonfinite position', () => {
  const clean = sanitizeState({ version: 1, credits: -500, position: { x: Infinity, z: 0 }, inventory: { [city.items[0].id]: 2, forged: 900 }, met: ['bad', people[0].id, people[0].id], visited: ['bad'], receipts: [{ itemId: city.items[0].id, price: -1, at: 12 }] }, city);
  assert.equal(clean.credits, 250); assert.deepEqual(clean.inventory, { [city.items[0].id]: 2 });
  assert.deepEqual(clean.met, [people[0].id]); assert.deepEqual(clean.visited, []); assert.deepEqual(clean.receipts, []);
  assert.deepEqual(clean.position, initialState(city).position);
  assert.deepEqual(sanitizeState({ version: 400, credits: 900 }, city), initialState(city));
});
test('device save restores purchased inventory, visited places, met neighbors and interior position', () => {
  const store = memory(); let s = purchase(initialState(city), city.items[0].id, city).state;
  s = recordMeeting(s, people[0].id, city); s = recordVisit(s, city.garage.id, city);
  s.position = { x: 1, z: 2, interior: city.garage.id };
  assert.equal(saveState(store, s), true); assert.deepEqual(loadState(store, city), s);
  assert.ok(store.getItem(STATE_KEY));
  assert.equal(saveState({ setItem() { throw Error('full'); } }, s), false);
  assert.deepEqual(loadState({ getItem() { throw Error('blocked'); } }, city), initialState(city));
});
test('static export preserves exact Core bytes and the complete thirteen-chapter canon with Tears before Salvage', async () => {
  const output = await buildCityExport();
  assert.ok(output.bytes.equals(bytes)); assert.equal(output.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(output.story.chapters.length, 13);
  assert.deepEqual(output.story.chapters.slice(-2).map(c => c.id), ['tears-wont-fall', 'salvage-title']);
  assert.ok(output.story.chapters.every(c => c.before.length > 200 && c.video.length > 100 && c.after.length > 200));
  assert.ok(output.story.chapters.find(c => c.id === 'test-drive').before.includes('G20'));
  assert.ok(output.story.roadYears.includes('Econoline'));
  assert.equal(output.story.chapterContract.before_dialogue_multiplier, 2);
  assert.equal(output.story.chapterContract.after_dialogue_multiplier, 2);
});
const expected = { id: city.id, revision: city.revision, sha256: createHash('sha256').update(bytes).digest('hex') };
const envelope = value => ({ jsonrpc: '2.0', id: 'test', result: { content: [{ type: 'text', text: JSON.stringify({ capability: 'game.lore.read', result: { result: value } }) }] } });
const lore = { manifest: expected, read_only: true, records: [people[0]] };
test('Core read-through parses actual Response and MCP envelopes only when id, revision and exact bytes match', async () => {
  assert.equal(await manifestDigest(bytes.toString(), webcrypto.subtle), expected.sha256);
  const calls = [];
  const link = createCoreLoreLink({ expected, session: () => 'owner-session', api: async (path, options) => {
    calls.push([path, options]); return new Response(JSON.stringify(envelope(lore)), { status: 200 });
  } });
  assert.equal(await link.connect(), true); assert.equal(link.status(), 'connected');
  assert.equal((await link.resident(people[0].id)).id, people[0].id);
  assert.equal(calls[0][0], '/v1/core/mcp'); assert.equal(calls[0][1].body.params.name, 'game.lore.read');
  assert.throws(() => unwrapLore({ result: { isError: true } }));
});
test('Core timeouts, older releases and owner-session changes cannot replace local lore', async () => {
  const old = createCoreLoreLink({ expected, session: () => 'owner', api: async () => envelope({ ...lore, manifest: { ...expected, sha256: 'old' } }) });
  assert.equal(await old.connect(), false); assert.equal(old.status(), 'different-release'); assert.equal(await old.resident(people[0].id), null);
  const timeout = createCoreLoreLink({ expected, session: () => 'owner', timeoutMs: 5, api: () => new Promise(() => {}) });
  assert.equal(await timeout.connect(), false);
  let session = 'owner';
  const changing = createCoreLoreLink({ expected, session: () => session, api: async () => { session = 'somebody-else'; return envelope(lore); } });
  assert.equal(await changing.connect(), false); assert.equal(await changing.resident(people[0].id), null);
});
