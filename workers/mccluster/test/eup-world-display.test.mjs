import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { handleWorldDisplay } from '../src/eup/world-display.js';
import { handleEup } from '../src/eup/router.js';

const liveOwner = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' };
const read = () => new Request('https://api.mccluster.org/v1/world/display');
const owner = (body) => new Request('https://api.mccluster.org/v1/eup/world-display', body === undefined ? {} :
  { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
const path = '/rest/v1/rpc/eup_world_display_';
const role = status => async () => { throw Object.assign(new Error('No access'), { status }); };

test('only verified owner can write; public reads only a boolean; fresh reads see both saves', async () => {
  let saved = false, calls = [];
  const fetchImpl = async (url, opts) => {
    const name = new URL(url).pathname, args = JSON.parse(opts.body); calls.push([name, args]);
    if (name === path + 'set') { assert.equal(args.p_actor, liveOwner); saved = args.p_public_news_heat_map; }
    return Response.json(saved);
  };
  const publicRead = () => handleWorldDisplay(read(), env, { fetchImpl });
  const cmd = (body, requireHouseOwner = async () => ({ id:liveOwner })) =>
    handleEup(owner(body), env, { requireHouseOwner, fetchImpl });
  assert.deepEqual(await (await publicRead()).json(), { ok:true, publicNewsHeatMap:false });
  for (const status of [401,403]) assert.equal((await cmd({ publicNewsHeatMap:true }, role(status))).status, status);
  assert.equal((await cmd({ publicNewsHeatMap:true, p_actor:liveOwner })).status, 422);
  assert.equal((await handleWorldDisplay(new Request(read(), { method:'POST' }), env, { fetchImpl })).status, 405);
  assert.equal(calls.length, 1);
  for (const value of [true,false]) {
    const r = await cmd({ publicNewsHeatMap:value });
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await r.json(), { ok:true, publicNewsHeatMap:value });
    assert.equal((await (await cmd()).json()).publicNewsHeatMap, value);
    const fresh = await publicRead();
    assert.equal(fresh.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await fresh.json(), { ok:true, publicNewsHeatMap:value });
  }
});

test('storage failure, malformed responses and missing schema hide shading but do not claim owner state', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => Response.json({ code:'PGRST202' }, { status:404 }),
    async () => Response.json('true')
  ]) {
    assert.deepEqual(await (await handleWorldDisplay(read(), env, { fetchImpl })).json(), { ok:true, publicNewsHeatMap:false });
    const r = await handleEup(owner(), env, { fetchImpl, requireHouseOwner:async () => ({ id:liveOwner }) });
    assert.equal(r.status, 503);
  }
});

const script = readFileSync(new URL('../../../js/world-news-globe.js', import.meta.url), 'utf8');
test('signed-out render starts with no tint; only literal persisted true enables it; pins and quiet scopes survive', async () => {
  for (const value of [false, 'true', true]) {
    const packets = [], events = {};
    let scope = 'global', mode = 'posts', door = false, resolveFetch;
    const pending = new Promise(r => { resolveFetch = r; });
    const e = () => ({ append() {}, addEventListener() {}, setAttribute() {} });
    const window = { addEventListener:(k, f) => { events[k]=f; }, MCC_WORLD_MODE:{get:() => mode},
      MCC_FEED_SCOPE:{get:() => scope},
      MCC_WORLD_NEWS_ITEMS:() => [{ id:'news', title:'Story', domain:'example.com', url:'https://example.com/', lat:1, lon:1 }] };
    const frame = { contentWindow:{ postMessage: packet => packets.push(packet) } };
    const document = { getElementById:(id) => id === 'mnWorldFrame' ? frame : null, createElement:e,
      body:{ appendChild() {} }, documentElement:{ classList:{ contains:() => door } } };
    vm.runInNewContext(script, { window, document, fetch:()=>pending, location:{origin:'https://mccluster.org'}, AbortSignal });
    assert.equal(packets.at(-1).tint, false);
    assert.equal(packets.at(-1).items[0].id, 'news');
    resolveFetch(Response.json({ ok:true, publicNewsHeatMap:value }));
    await new Promise(r => setImmediate(r));
    assert.equal(packets.at(-1).tint, value === true);
    assert.equal(packets.at(-1).on, true);
    assert.equal(packets.at(-1).items[0].id, 'news');
    mode = 'travel'; events['mcc:world-mode'](); assert.equal(packets.at(-1).suppressCounts, false);
    mode = 'posts'; scope = 'equity'; events['mcc:feed-scope']();
    assert.equal(packets.at(-1).tint, false);
    assert.equal(packets.at(-1).on, false);
    assert.equal(packets.at(-1).suppressCounts, true);
    scope = 'global'; door = true; events['mcc:door']();
    assert.equal(packets.at(-1).tint, false);
  }
});
