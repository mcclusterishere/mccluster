import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handlePrim3Levels } from '../src/prim3/levels.js';
import { levelModel, validateLevelDocument, MAX_LEVEL_BYTES } from '../src/prim3/level-validation.js';
import { LEVEL_ASSETS } from '../src/prim3/level-assets.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const ENV = { SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', ALLOWED_ORIGIN: 'https://matthew.mccluster.org' };
const make = () => ({ ...levelModel.createBlank(), id: 'level-test', title: 'Test operation' });
const req = (suffix = '', method = 'GET', body, extras = {}) => new Request('https://api.mccluster.org/v1/prim3/levels' + suffix, {
  method, headers: { origin: 'https://matthew.mccluster.org', authorization: 'Bearer live-owner', 'content-type': 'application/json', ...extras },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
});
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const row = (document = make(), revision = 1) => ({ id: document.id, title: document.title, draft: document, revision, archived: false, published_version: null, created_by: OWNER, updated_by: OWNER });
const options = fetchImpl => ({ requireHouseOwner: async () => ({ id: OWNER }), fetchImpl });
const noFetch = async () => { throw new Error('Unexpected storage call'); };

test('dispatcher registers the private level handler ahead of general PRIM3 learning routes', async () => {
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const levelRoute = source.indexOf('if (path === PRIM3_LEVELS_PREFIX');
  assert.ok(levelRoute > 0 && levelRoute < source.indexOf("if (path === '/v1/prim3'"));
  assert.match(source.slice(levelRoute, levelRoute + 240), /handlePrim3Levels\(request, env, \{ requireHouseOwner \}\)/);
  assert.match(source, /export \{ HereTenantAgent \}/);
});

test('guests and ordinary members cannot read, save, publish, or archive; authentication runs before storage', async () => {
  let storage = 0;
  for (const status of [401, 403]) for (const [path, method] of [['', 'GET'], ['', 'POST'], ['/level-test', 'PATCH'], ['/level-test', 'DELETE'], ['/level-test/publish', 'POST'], ['/level-test/versions/1', 'GET'], ['/assets', 'GET']]) {
    const result = await handlePrim3Levels(req(path, method, method === 'GET' ? undefined : {}), ENV, {
      requireHouseOwner: async () => { throw Object.assign(new Error('denied'), { status }); },
      fetchImpl: async () => { storage++; return response([]); }
    });
    assert.equal(result.status, status);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(storage, 0);
});

test('missing authorization dependency and failed owner lookup fail closed without internal details', async () => {
  assert.equal((await handlePrim3Levels(req(), ENV, { fetchImpl: noFetch })).status, 503);
  const result = await handlePrim3Levels(req(), ENV, { requireHouseOwner: async () => { throw Object.assign(new Error('private SQL detail'), { status: 503, detail: { key: 'do-not-expose' } }); }, fetchImpl: noFetch });
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /private SQL|do-not-expose/);
});

test('catalog exposes only the pinned 24-asset metadata set, with no caller-defined URL', async () => {
  const result = await handlePrim3Levels(req('/assets'), ENV, options(noFetch));
  const body = await result.json();
  assert.equal(body.assets.length, 24);
  assert.deepEqual(body.assets.map(x => x.id).sort(), Object.keys(LEVEL_ASSETS).sort());
  assert.equal(body.assets.find(x => x.id === 'warehouse-16').footprint.width, 16);
  assert.ok(body.assets.every(x => !('url' in x)));
});

test('draft creation validates the level then binds the actor to authenticated identity', async () => {
  let sent;
  const doc = make(); doc.spawns = [];
  const result = await handlePrim3Levels(req('', 'POST', { level: doc }), ENV, options(async (url, init) => {
    assert.match(url, /\/rpc\/prim3_level_mutate$/);
    sent = JSON.parse(init.body); return response(row(doc));
  }));
  assert.equal(result.status, 201);
  assert.equal(sent.p_actor, OWNER);
  assert.equal(sent.p_action, 'create');
  assert.equal((await result.json()).level.document.spawns.length, 0);
  assert.equal((await handlePrim3Levels(req('', 'POST', { level: doc, actor: OWNER }), ENV, options(noFetch))).status, 400);
});

test('unknown asset IDs, external asset URLs, transforms and extra code fields are rejected before writing', async () => {
  for (const change of [
    d => { d.objects = [{ id: 'x', assetId: 'external', x: 0, y: 0 }]; },
    d => { d.objects = [{ id: 'x', assetId: 'crate-2', x: 0, y: 0, url: 'https://evil.invalid/a.glb' }]; },
    d => { d.objects = [{ id: 'x', assetId: 'crate-2', x: 0, y: 0, rotation: 45 }]; },
    d => { d.objects = [{ id: 'x', assetId: 'crate-2', x: 63, y: 63 }]; },
    d => { d.objects = [{ id: 'x', assetId: 'crate-2', x: 0, y: 0, scale: 99 }]; },
    d => { d.objects = [{ id: 'x', assetId: 'crate-2', x: 0, y: 0, rotation: null }]; },
    d => { d.script = 'alert(1)'; },
    d => { d.metadata = { theme: 'white-industrial', secretUrl: 'https://evil.invalid' }; },
    d => { d.spawns[0].team = 'admin'; },
    d => { d.spawns[0].layer = null; },
    d => { d.connections = [{ id: 'bad-type', type: null, from: { x: 1, y: 1, layer: 0 }, to: { x: 2, y: 2, layer: 0 } }]; },
    d => { d.bounds.maxX = 10000; },
    d => { d.id = 'assets'; }
  ]) {
    const doc = make(); change(doc);
    const result = await handlePrim3Levels(req('', 'POST', { level: doc }), ENV, options(noFetch));
    assert.equal(result.status, 422, JSON.stringify(doc));
  }
});

test('full transformed footprints and non-centered 128–256-cell bounds follow the editor compiler', () => {
  const doc = make(); doc.bounds = { minX: -96, maxX: 63, minY: -128, maxY: 127 };
  doc.spawns.push({ id: 'H33', role: 'guard', team: 'enemy', x: 10, y: 10, layer: 0 });
  assert.equal(validateLevelDocument(doc).ok, true);
  doc.objects = [{ id: 'building', assetId: 'warehouse-16', x: 50, y: 0, rotation: 90, elevation: 0, scale: 1 }];
  assert.equal(validateLevelDocument(doc).ok, true);
  doc.objects[0].rotation = 0;
  assert.equal(validateLevelDocument(doc).ok, false);
});

test('oversized streamed bodies, malformed JSON and content-type mistakes cannot reach storage', async () => {
  assert.equal((await handlePrim3Levels(req('', 'POST', 'x'.repeat(MAX_LEVEL_BYTES + 1)), ENV, options(noFetch))).status, 413);
  assert.equal((await handlePrim3Levels(req('', 'POST', '{broken'), ENV, options(noFetch))).status, 400);
  assert.equal((await handlePrim3Levels(req('', 'POST', '{}', { 'content-type': 'text/plain' }), ENV, options(noFetch))).status, 415);
  assert.equal((await handlePrim3Levels(req('', 'POST', '{}', { 'content-length': String(MAX_LEVEL_BYTES + 100) }), ENV, options(noFetch))).status, 413);
});

test('save needs an expected revision and matching immutable document ID', async () => {
  const doc = make();
  assert.equal((await handlePrim3Levels(req('/level-test', 'PATCH', { level: doc }), ENV, options(noFetch))).status, 428);
  doc.id = 'different';
  assert.equal((await handlePrim3Levels(req('/level-test', 'PATCH', { level: doc, expectedRevision: 1 }), ENV, options(noFetch))).status, 400);
});

test('revision conflicts become a clear 409 rather than overwriting or retrying', async () => {
  let calls = 0;
  const result = await handlePrim3Levels(req('/level-test', 'PATCH', { level: make(), expectedRevision: 1 }), ENV, options(async () => {
    calls++; return response({ code: '40001', message: 'Revision conflict' }, 400);
  }));
  assert.equal(result.status, 409); assert.equal(calls, 1);
  assert.equal((await result.json()).code, 'revision_conflict');
});

test('list returns metadata only and applies bounded pagination', async () => {
  let query;
  const result = await handlePrim3Levels(req('?limit=1&offset=2'), ENV, options(async url => {
    query = url; return response([{ ...row(), draft: undefined }, { ...row(), id: 'second', draft: undefined }]);
  }));
  const data = await result.json();
  assert.equal(data.nextOffset, 3); assert.equal(data.levels.length, 1);
  assert.ok(!('document' in data.levels[0]));
  assert.match(query, /limit=2&offset=2/); assert.doesNotMatch(query, /select=.*draft/);
  assert.equal((await handlePrim3Levels(req('?limit=10000'), ENV, options(noFetch))).status, 400);
});

test('publishing requires E/R/T and actual routes to the relay and extraction', async () => {
  const incomplete = make(); incomplete.spawns = incomplete.spawns.filter(s => s.id !== 'T');
  const blocked = make();
  for (let x = -64; x < 64; x += 8) blocked.objects.push({ id: `wall-${x < 0 ? 'n' : 'p'}${Math.abs(x)}`, assetId: 'wall-8', x, y: -20, rotation: 0, elevation: 0, scale: 1 });
  for (const doc of [incomplete, blocked]) {
    let calls = 0;
    const result = await handlePrim3Levels(req('/level-test/publish', 'POST', { expectedRevision: 1 }), ENV, options(async url => {
      calls++; assert.doesNotMatch(url, /rpc\//); return response([row(doc)]);
    }));
    assert.equal(result.status, 422); assert.equal(calls, 1);
  }
});

test('unsupported rooftop spawns and teleport traversal costs fail the canonical playability check', () => {
  const doc = make(); doc.spawns[0].layer = 1;
  assert.equal(validateLevelDocument(doc, { playable: true }).ok, false);
  const jump = make(); jump.connections = [{ id: 'jump', from: { x: -20, y: -40, layer: 0 }, to: { x: 20, y: 20, layer: 0 }, cost: 1 }];
  const verdict = validateLevelDocument(jump, { playable: true });
  assert.equal(verdict.ok, false); assert.match(verdict.errors.join(' '), /travel distance/);
});

test('a route that requires an unaffordable traversal cannot be published as playable', () => {
  const doc = make();
  for (let x = -64; x < 64; x += 8) doc.objects.push({ id: `wall-${x < 0 ? 'n' : 'p'}${Math.abs(x)}`, assetId: 'wall-8', x, y: -20, rotation: 0, elevation: 0, scale: 1 });
  doc.connections.push({ id: 'over-budget', from: { x: -24, y: -21, layer: 0 }, to: { x: -24, y: -19, layer: 0 }, cost: 128 });
  assert.equal(validateLevelDocument(doc).ok, true, 'An unfinished draft may retain a traversal for later correction.');
  assert.equal(validateLevelDocument(doc, { playable: true }).ok, false, 'Technical cannot spend 128 movement points in a turn.');
});

test('a save racing publication cannot silently publish the newer draft', async () => {
  let calls = 0;
  const result = await handlePrim3Levels(req('/level-test/publish', 'POST', { expectedRevision: 1 }), ENV, options(async url => {
    calls++; return url.includes('/rpc/') ? response({ code: '40001' }, 400) : response([row()]);
  }));
  assert.equal(result.status, 409); assert.equal(calls, 2);
});

test('a playable publication pins a version; DELETE archives without a hard-delete database call', async () => {
  let publication;
  const published = await handlePrim3Levels(req('/level-test/publish', 'POST', { expectedRevision: 1 }), ENV, options(async (url, init) => {
    if (!url.includes('/rpc/')) return response([row()]);
    publication = JSON.parse(init.body); return response({ ...row(), published_version: 1 });
  }));
  assert.equal(published.status, 200); assert.equal(publication.p_expected_revision, 1);
  assert.equal((await published.json()).level.publishedVersion, 1);
  let action;
  const archived = await handlePrim3Levels(req('/level-test', 'DELETE', { expectedRevision: 1 }), ENV, options(async (url, init) => {
    assert.equal(init.method, 'POST'); action = JSON.parse(init.body).p_action; return response({ ...row(make(), 2), archived: true });
  }));
  assert.equal(action, 'archive'); assert.equal((await archived.json()).level.status, 'archived');
});

test('an absent migration reports storage unavailable rather than a fictitious empty catalog', async () => {
  const result = await handlePrim3Levels(req(), ENV, options(async () => response({ code: '42P01', message: 'private SQL' }, 404)));
  assert.equal(result.status, 503);
  const data = await result.json(); assert.equal(data.code, 'schema_not_installed'); assert.doesNotMatch(JSON.stringify(data), /private SQL/);
});

test('storage is asked without redirect: error (workerd throws on it); a redirect answer is storage unavailable', async () => {
  const source = await readFile(new URL('../src/prim3/levels.js', import.meta.url), 'utf8');
  assert.match(source, /redirect: 'manual'/);
  let init;
  const result = await handlePrim3Levels(req(), ENV, options(async (url, i) => { init = i; return new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/' } }); }));
  assert.equal(init.redirect, 'manual');
  assert.equal(result.status, 503);
  assert.equal((await result.json()).code, 'storage_unavailable');
});

test('publication is decided by the game itself: the Forge document exported to the level shape and run through the vendored resolver', async () => {
  const source = await readFile(new URL('../src/prim3/level-validation.js', import.meta.url), 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/\.\.\/\.\.\/js\/prim3-tactics\/levels\/forge\.mjs'/);
  const open = make();
  assert.equal(validateLevelDocument(open, { playable: true }).ok, true);
  const walled = make(); // a wall across the whole map between the squad and the relay
  for (let x = -64; x < 64; x += 8) walled.objects.push({ id: `wall-${x + 64}`, assetId: 'wall-8', x, y: -20, rotation: 0, elevation: 0, scale: 1 });
  const verdict = validateLevelDocument(walled, { playable: true });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors.join(' '), /Technical has no walkable route to the relay/);
});
