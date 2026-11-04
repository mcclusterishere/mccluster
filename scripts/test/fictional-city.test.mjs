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

// Schema revision 2: expansion lore bound to the spatial layer only by parcel/anchor IDs.
const PARCELS = new Set([
  ...['police-station', 'hospital', 'church', 'school-of-hard-knocks', 'wiggers-anonymous', 'shop-01', 'shop-02', 'shop-03', 'shop-04'].map(p => 'civic-center/' + p),
  ...['thugged-out-apparel', 'shop-01', 'shop-02', 'shop-03', 'shop-04'].map(p => 'hq-waterfront/' + p),
  'northside-residential/public-school', ...Array.from({ length: 10 }, (_, i) => `northside-residential/house-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, i) => `workshop-waterfront/shop-0${i + 1}`)
]);
const expansionPeople = city.expansionNpcs, everyone = new Map([...people, ...expansionPeople].map(n => [n.id, n]));
const expansionBusiness = id => city.expansionBusinesses.find(b => b.id === id);

test('expansion keeps the v1 runtime contract and leaves every original record unchanged', () => {
  assert.equal(city.schema, 'mccluster.fictional-city/v1'); assert.equal(city.schemaRevision, 2);
  assert.equal(city.businesses.length, 8); assert.equal(city.npcs.length, 24); assert.equal(city.items.length, 24);
  // Digest of the shipped v1 sections (PR #716/#719). The expansion may add beside them, never edit them.
  const v1 = ['district', 'brands', 'businesses', 'npcs', 'items', 'garage', 'garageCrew', 'portals'].map(key => city[key]);
  assert.equal(createHash('sha256').update(JSON.stringify(v1)).digest('hex'), '760c27278ec63f12fd8ed33aefa91f03935f4d6d1f6d5d2d456278788c5b6a20');
  assert.equal(city.businesses.find(b => b.id === 'gauranfucking-tea').tagline, "We guarantee you'll like it, or else fuck you.");
  for (const rows of [[...allBuildings, ...city.expansionBusinesses, ...city.families, ...city.expansionNeighborhoods, ...(city.neighborhoods || [])], [...people, ...expansionPeople], [...city.items, ...city.expansionItems]]) {
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'IDs are unique within each kind');
  }
});

test('expansion records carry parcel IDs, never coordinates, and every parcel binds to one owner', () => {
  assert.deepEqual(city.expansionNeighborhoods.map(n => n.id), ['original-block', 'hq-waterfront', 'civic-center', 'northside-residential', 'workshop-waterfront']);
  const used = new Set();
  for (const p of city.parcels) {
    assert.ok(PARCELS.has(p.parcelId), p.parcelId); assert.ok(!used.has(p.parcelId)); used.add(p.parcelId);
    assert.ok(p.parcelId.startsWith(p.neighborhoodId + '/'));
    assert.ok(p.businessId ? expansionBusiness(p.businessId)?.parcelId === p.parcelId : city.families.find(f => f.id === p.familyId)?.parcelId === p.parcelId);
  }
  const anchors = new Set([...used, ...city.businesses.map(b => b.id), 'garage', 'hq-bridge', 'hq-doorway']);
  for (const r of [...city.expansionBusinesses, ...expansionPeople, ...city.families]) {
    for (const key of ['position', 'size', 'entrance', 'route']) assert.equal(r[key], undefined, `${r.id}.${key}`);
    assert.equal(r.authorship, 'new-2026-11-03', r.id);
  }
  for (const b of city.expansionBusinesses) assert.ok(used.has(b.parcelId), b.id);
  for (const n of expansionPeople) {
    assert.ok(used.has(n.homeParcelId), n.id); assert.ok(['interior', 'route'].includes(n.placement), n.id);
    if (n.placement === 'route') { assert.ok(n.routeAnchors.length >= 2, n.id); for (const a of n.routeAnchors) assert.ok(anchors.has(a), `${n.id} → ${a}`); }
  }
});

test('expansion residents have biographies, appearance and playable conversations; minors are explicit and protected', () => {
  assert.equal(expansionPeople.length, 50);
  for (const n of expansionPeople) {
    assert.ok(n.backstory.length > 200, n.id); assert.ok(n.personality && n.origin && n.role, n.id);
    assert.ok(n.businessId ? [...allBuildings, ...city.expansionBusinesses].some(b => b.id === n.businessId) : city.families.some(f => f.id === n.familyId), n.id);
    for (const c of Object.values(n.appearance)) assert.match(c, /^#[0-9a-f]{6}$/);
    assert.ok(n.dialogue.greeting && n.dialogue.farewell);
    assert.ok(n.dialogue.topics.length >= 2, n.id);
    for (const t of n.dialogue.topics) {
      assert.ok(t.lines.length >= 4 && t.id.startsWith(n.id + '-'));
      t.lines.forEach((l, i) => assert.equal(l.speaker, i % 2 ? n.name : 'You'));
    }
    assert.equal(n.age < 18, n.minor === true, n.id);
    if (n.minor) assert.ok(['school-of-hard-knocks', 'harding-high-school'].includes(n.businessId), n.id);
  }
  const text = JSON.stringify([city.expansionBusinesses, expansionPeople, city.families, city.expansionNeighborhoods, city.expansionItems]);
  assert.doesNotMatch(text, /\bnigg/i);
  assert.doesNotMatch(text, /\b(bloods|crips|latin kings|ms-13)\b/i, 'no real gang names');
});

test('Wiggers Anonymous has three reformed staff (one inside, two walking) and four suffering members with the four owner-named jobs', () => {
  const wa = expansionBusiness('wiggers-anonymous');
  const staff = wa.staffIds.map(id => everyone.get(id));
  assert.equal(staff.length, 3); assert.ok(staff.every(n => n.group.status === 'reformed-staff'));
  assert.deepEqual(staff.map(n => n.placement).sort(), ['interior', 'route', 'route']);
  const members = wa.memberIds.map(id => everyone.get(id));
  assert.equal(members.length, 4); assert.ok(members.every(n => n.group.status === 'member'));
  // Three members walk routes; the Thugged Out Apparel member works the shop floor.
  for (const n of members) assert.equal(n.placement, n.workplace.businessId === 'thugged-out-apparel' ? 'interior' : 'route', n.id);
  const jobs = members.map(n => n.workplace);
  assert.ok(jobs.some(w => w.kind === 'self-employed' && /drug dealer/i.test(w.description)));
  assert.ok(jobs.some(w => w.businessId === 'hitman-gear'));
  assert.ok(jobs.some(w => w.portalId === city.district.island.hq.portalId && city.portals.some(p => p.id === w.portalId)), 'the courier works at the HQ island');
  assert.ok(jobs.some(w => w.businessId === 'thugged-out-apparel'));
  assert.equal(wa.twelveSteps.length, 12); assert.match(wa.memberNote, /four/);
  const toa = expansionBusiness('thugged-out-apparel');
  assert.equal(toa.staffIds.length, 2); assert.deepEqual(toa.affiliatedStaffIds, members.filter(n => n.workplace.businessId === 'thugged-out-apparel').map(n => n.id));
});

test('church, schools and hospital are wired with attendees and students; payoffs sit with private middlemen', () => {
  const church = expansionBusiness('greater-prosperity-tabernacle');
  assert.ok(church.staffIds.includes('chad-ledger'));
  const owners = church.attendees.map(a => a.npcId).filter(id => city.npcs.some(n => n.id === id));
  assert.ok(owners.length >= 3, 'original-block residents attend'); assert.ok(church.attendees.every(a => everyone.has(a.npcId)));
  const sohk = expansionBusiness('school-of-hard-knocks');
  const extortionist = everyone.get('bryce-lundqvist');
  assert.ok(sohk.staffIds.includes(extortionist.id)); assert.equal(extortionist.group.status, 'refuses'); assert.ok(extortionist.age >= 18);
  assert.equal(sohk.studentIds.length, 3); assert.ok(sohk.studentIds.every(id => everyone.get(id).minor));
  assert.ok(expansionBusiness('harding-high-school').studentIds.every(id => everyone.get(id).minor));
  assert.ok(expansionBusiness('st-copays-general').staffIds.length >= 2);
  const desk = expansionBusiness('bail-mary-bonds');
  assert.ok(desk.interactions.length >= 3);
  for (const i of desk.interactions) {
    assert.equal(i.type, 'bribe'); assert.ok(Number.isSafeInteger(i.price) && i.price > 0 && i.price <= 250);
    assert.ok(i.npcIds.every(id => everyone.get(id).businessId === 'bail-mary-bonds' && everyone.get(id).acceptsBribes && !everyone.get(id).minor));
  }
  const civic = new Set(['wiggers-anonymous', 'thugged-out-apparel', 'greater-prosperity-tabernacle', 'school-of-hard-knocks', 'harding-high-school', 'st-copays-general', 'bridgeport-police-department']);
  assert.ok(city.expansionBusinesses.filter(b => !civic.has(b.id)).length >= 10, 'extra joke businesses');
});

// Owner decisions, 2026-11-03: real government places keep their real identity; fake private
// businesses and people are the overlay; payoffs never touch a real institution or person;
// corruption storylines reenact only sourced, proven public-record cases.
const arcs = city.publicRecordArcs || [];
const realCast = arcs.flatMap(a => a.cast);
const realNames = [...new Set(realCast.map(p => p.name))];
const BASES = ['conviction', 'plea', 'court-finding', 'official-record'];
const source = s => s && typeof s.title === 'string' && s.title.length > 3 && /^https:\/\/[^\s]+$/.test(s.url) && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s.date);
const realInstitutions = city.expansionBusinesses.filter(b => b.realInstitution);

test('real government places keep their real, sourced identity and no invented replacement remains', () => {
  const police = expansionBusiness('bridgeport-police-department'), school = expansionBusiness('harding-high-school');
  assert.equal(city.parcels.find(p => p.parcelId === 'civic-center/police-station').businessId, police.id);
  assert.equal(city.parcels.find(p => p.parcelId === 'northside-residential/public-school').businessId, school.id);
  assert.equal(police.name, 'Bridgeport Police Department'); assert.match(police.realInstitution.address, /^300 Congress Street, Bridgeport, CT 06604$/);
  assert.equal(school.name, 'Harding High School'); assert.match(school.realInstitution.address, /^379 Bond Street, Bridgeport, CT 06610$/);
  assert.ok(police.realInstitution.sources.some(s => s.url.startsWith('https://www.bridgeportct.gov/')), 'police verified on the City of Bridgeport site');
  assert.ok(school.realInstitution.sources.some(s => s.url.startsWith('https://harding.bridgeportedu.net/')), 'school verified on Bridgeport Public Schools');
  assert.doesNotMatch(school.realInstitution.address, /Lyon Terrace/);
  assert.deepEqual(realInstitutions.map(b => b.id).sort(), ['bridgeport-police-department', 'harding-high-school']);
  for (const b of realInstitutions) {
    assert.equal(b.provenance, 'real_institution'); assert.equal(b.name, b.realInstitution.officialName);
    assert.ok(b.realInstitution.sources.length >= 1 && b.realInstitution.sources.every(source), b.id);
    const fp = b.realInstitution.fieldProvenance;
    for (const field of ['officialName', 'operator', 'address']) assert.ok(fp[field].status === 'verified' && b.realInstitution.sources.some(s => s.url === fp[field].source), `${b.id}.${field}`);
    for (const field of ['footprint', 'coordinates', 'interior', 'staff']) assert.equal(fp[field].status, 'authored', `${b.id}.${field}`);
    assert.equal(b.realInstitution.payoffs, 'none'); assert.equal(b.interactions, undefined, b.id); assert.deepEqual(b.ads, []);
    assert.equal(city.parcels.find(p => p.parcelId === b.parcelId).realInstitution, true);
    for (const id of [...b.staffIds, ...(b.studentIds || [])]) {
      const n = everyone.get(id);
      assert.ok(!n.acceptsBribes && !n.realPerson, id); assert.ok(!realNames.includes(n.name), id);
      assert.doesNotMatch(n.role, /\b(principal|chief|(?<!debate )captain|officer|sergeant|lieutenant|detective|superintendent|mayor)\b/i, id);
    }
  }
  // Old IDs stay resolvable for saves, Core and stacked branches.
  assert.equal(city.idAliases['precinct-zero'], police.id); assert.equal(city.idAliases['municipal-high-9'], school.id);
  for (const [from, to] of Object.entries(city.idAliases)) if (from !== 'note') {
    assert.ok(!city.expansionBusinesses.some(b => b.id === from), from);
    assert.ok(city.expansionBusinesses.some(b => b.id === to) || city.expansionBusinesses.some(b => (b.interactions || []).some(i => i.id === to)), to);
  }
  // No invented police precinct, public school or government office survives anywhere in the expansion.
  const text = JSON.stringify([city.expansionNeighborhoods, city.expansionBusinesses, city.expansionNpcs, city.families, city.expansionItems]);
  assert.doesNotMatch(text, /Precinct Zero|Municipal High|No\. 9|Department of Mild Violence|Officer (Pruitt|Szabo|Dale|Brenda)|Captain Frank/);
  const GOVERNMENT = /\b(police|precinct|sheriff|public (high )?school|city hall|town hall|courthouse|court|motor vehicles|DMV|department of|municipal)\b/i;
  for (const b of city.expansionBusinesses) {
    if (GOVERNMENT.test(b.name) || GOVERNMENT.test(b.category)) assert.ok(b.realInstitution, `${b.id} reads as a government place but is not the real one`);
  }
  for (const p of city.parcels.filter(p => p.kind === 'civic')) {
    const b = expansionBusiness(p.businessId);
    assert.ok(b.realInstitution || ['greater-prosperity-tabernacle', 'school-of-hard-knocks'].includes(b.id), p.parcelId);
  }
  // The private hospital is satire, not a stand-in for a named real hospital.
  const hospital = expansionBusiness('st-copays-general');
  assert.doesNotMatch(JSON.stringify(hospital), /Bridgeport Hospital|St\.? Vincent|only hospital/i);
  assert.match(city.constraints.privateHospital, /does not stand in for Bridgeport Hospital or St\. Vincent’s Medical Center/);
});

test('payoff interactions belong only to fictional private middlemen and never reference a real institution or person', () => {
  const owners = city.expansionBusinesses.filter(b => b.interactions?.length);
  assert.deepEqual(owners.map(b => b.id), ['bail-mary-bonds']);
  const banned = new RegExp(['police', 'officer', '\\bcops?\\b', 'cruiser', 'precinct', 'inspector', 'judge', 'mayor', 'city hall', 'Bridgeport', 'Harding',
    ...realNames.flatMap(n => n.split(/[\s“”"]+/).filter(w => w.length > 3 && /^[A-Z]/.test(w)))].join('|'), 'i');
  for (const b of owners) {
    assert.ok(!b.realInstitution && b.provenance === 'new_fiction', b.id);
    for (const i of b.interactions) {
      assert.equal(i.payee, 'private-middleman', i.id);
      assert.doesNotMatch(`${i.label} ${i.outcome}`, banned, i.id);
      for (const id of i.npcIds) {
        const n = everyone.get(id);
        assert.equal(n.businessId, b.id); assert.ok(n.acceptsBribes && !n.minor && !n.realPerson && !realNames.includes(n.name), id);
        assert.doesNotMatch(n.role, /police|officer|captain, |precinct|government|inspector/i, id);
      }
    }
    assert.match(b.bribeRules, /never to a police department, government office or real person/);
  }
  for (const n of [...people, ...expansionPeople]) if (n.acceptsBribes) assert.equal(n.businessId, 'bail-mary-bonds', n.id);
});

test('the private-school gang is the Bond Street Willy Whackers, named for the real school’s street', () => {
  const school = expansionBusiness('harding-high-school');
  assert.match(school.realInstitution.address, /Bond Street/);
  assert.match(expansionBusiness('school-of-hard-knocks').backstory, /Bond Street Willy Whackers, after the street beside Harding High School/);
  assert.match(everyone.get('tucker-whitmore-sterling').role, /founder of the Bond Street Willy Whackers/);
  assert.equal(city.expansionItems.find(i => i.id === 'sohk-varsity-gang-jacket').name, 'Bond Street Willy Whackers Varsity Jacket');
  assert.doesNotMatch(bytes.toString('utf8'), /529 ?Boy|529 BOYZ/i);
  // One gang (owner, 2026-11-03, final): led by Bryce, the school's adult hired extortionist; the members are minors.
  const leader = everyone.get('bryce-lundqvist');
  assert.match(leader.role, /leader of the Bond Street Willy Whackers/); assert.ok(leader.age >= 18 && !leader.minor);
  assert.doesNotMatch(bytes.toString('utf8'), /Elm Street Willy Whackers/);
});

test('public-record storylines depict real people only through sourced, proven records', () => {
  assert.deepEqual(arcs.map(a => a.id), ['public-record-ganim-2003', 'public-record-chief-exam-2018', 'public-record-primary-2023']);
  const storyIds = new Set((city.storyArcs || []).flatMap(a => [a.id, ...a.beats.map(b => b.id)]));
  for (const arc of arcs) {
    assert.ok(!storyIds.has(arc.id), 'public-record arcs stay out of the placed story runtime');
    assert.equal(arc.series, 'Based on the public record'); assert.equal(arc.interaction.payoffs, 'none'); assert.equal(arc.interaction.rewards, null);
    assert.ok(arc.canon.established && arc.canon.notDepicted, arc.id);
    const cast = new Map(arc.cast.map(p => [p.id, p]));
    for (const p of arc.cast) { assert.equal(p.realPerson, true); assert.ok(BASES.includes(p.basis), p.id); assert.ok(p.depiction.length > 40, p.id); }
    assert.ok(arc.beats.length >= 3);
    for (const beat of arc.beats) {
      assert.ok(!storyIds.has(beat.id), beat.id);
      assert.ok(BASES.includes(beat.basis), beat.id); assert.equal(beat.sourceLine, 'Based on the public record');
      assert.ok(beat.realPeople.length >= 1 && beat.realPeople.every(id => cast.has(id)), beat.id);
      assert.ok(beat.sources.length >= 1 && beat.sources.every(source), beat.id);
      assert.ok(beat.paragraphs.length >= 2 && beat.paragraphs.every(p => typeof p === 'string' && p.length > 20), beat.id);
    }
    for (const p of arc.cast) assert.ok(arc.beats.some(b => b.realPeople.includes(p.id)), `${p.id} appears in a sourced scene`);
  }
  // Real people never become playable residents, middlemen or staff of the fictional overlay.
  for (const n of [...people, ...expansionPeople]) { assert.ok(!realNames.includes(n.name), n.id); assert.equal(n.realPerson, undefined, n.id); }
  // A person whose criminal case is unresolved is shown only through the court’s findings, with the status sourced.
  const pending = arcs.flatMap(a => a.beats).filter(b => b.recordStatus);
  assert.ok(pending.length >= 1);
  for (const b of pending) { assert.match(b.recordStatus, /pending|unproven/); assert.ok(b.recordStatusSources.every(source)); }
  assert.match(city.constraints.publicRecord, /conviction, guilty plea, court finding or official record/);
  const host = everyone.get(arcs[0].interaction.host);
  assert.ok(host && !host.minor && host.dialogue.topics.some(t => (t.publicRecordArcIds || []).length === arcs.length));
});

test('ten families live on ten houses with lore, members and ties to the town', () => {
  assert.equal(city.families.length, 10);
  assert.equal(new Set(city.families.map(f => f.parcelId)).size, 10);
  for (const f of city.families) {
    assert.match(f.parcelId, /^northside-residential\/house-\d\d$/); assert.ok(f.lore.length > 150 && f.ties.length >= 2, f.id);
    assert.ok(f.members.some(m => m.npcId === f.representativeNpcId));
    for (const m of f.members) { if (m.npcId) assert.equal(everyone.get(m.npcId).familyId, f.id, m.npcId); if (m.age < 18) assert.equal(m.minor, true, m.name); }
  }
});

test('expansion goods resolve to their counters with bounded prices and are never sold by a minor-only place', () => {
  const all = [...allBuildings, ...city.expansionBusinesses];
  for (const item of city.expansionItems) {
    const b = all.find(b => b.id === item.businessId);
    assert.ok(b?.itemIds.includes(item.id), item.id); assert.ok(Number.isSafeInteger(item.price) && item.price > 0 && item.price <= 250);
    assert.match(item.kind, /^virtual_/);
  }
});

test('expansion lore stays off the Bridgeport neighborhood: no shared IDs and no claim on its ground', () => {
  const places = (city.neighborhoods || []).flatMap(n => [n.id, ...(n.places || []).map(p => p.id)]);
  const mine = new Set([...city.expansionBusinesses, ...expansionPeople, ...city.families, ...city.expansionNeighborhoods, ...city.expansionItems].map(r => r.id));
  for (const id of places) assert.ok(!mine.has(id), id);
  for (const p of city.parcels) assert.ok(!places.includes(p.parcelId.split('/')[0]), p.parcelId);
  // Real institutions carry their real Bridgeport names (owner, 2026-11-03); the fictional overlay still claims no Bridgeport ground.
  const overlay = JSON.stringify([city.expansionNeighborhoods, city.expansionBusinesses.filter(b => !b.realInstitution), city.families])
    .replaceAll('Bridgeport Police Department', '');
  assert.doesNotMatch(overlay, /bridgeport|north of the (original )?block/i);
});

test('Hail Mary owner rename preserves the existing business, parcel and payment identities', () => {
  const business = city.expansionBusinesses.find(b => b.id === 'bail-mary-bonds');
  assert.equal(business.name, 'Hail Mary Bail Bonds');
  assert.equal(business.parcelId, 'hq-waterfront/shop-01');
  assert.equal(city.expansionBusinesses.filter(b => b.name === 'Hail Mary Bail Bonds').length, 1);
  assert.ok(!city.expansionBusinesses.some(b => b.id === 'hail-mary-bonds' || b.id === 'hail-mary-bail-bonds'));
  assert.ok(business.staffIds.every(id => city.expansionNpcs.some(n => n.id === id && n.businessId === business.id)));
  assert.ok(city.expansionItems.some(i => i.id === 'bmb-prayer-candle' && i.businessId === business.id));
  assert.ok(business.interactions.every(i => i.payee === 'private-middleman'));
  assert.doesNotMatch(JSON.stringify(city), /Bail Mary/);
});
