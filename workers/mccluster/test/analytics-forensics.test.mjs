/* Control Analytics > Forensics routes: sessions you can open and visitors
   you can follow. What matters: every route is house-owner only (the rows
   carry IPs, places and signed-in emails), parameters are whitelisted and
   clamped before they reach the database, ids are validated, a session's
   page gets the visitor's other sessions (every device a signed-in person
   used), and device blobs are summarized, never passed through raw. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAnalyticsRequest } from '../src/analytics/router.js';

const OWNER = { id: '423e4567-e89b-42d3-a456-426614174333', email: 'matthew@mccluster.org' };
const STRANGER = { id: '523e4567-e89b-42d3-a456-426614174444', email: 'someone@example.com' };
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const UID = '723e4567-e89b-42d3-a456-426614174777';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

/* A PostgREST stand-in: owner membership, a session's events, a signed-in
   person's devices, their profile, and the two forensic RPCs (recorded so
   the test can read exactly what the Worker asked for). */
function backend({ role = 'owner', events = [], devices = [], profile = null, rpc = {} } = {}) {
  const calls = [];
  const handler = async (url, init = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace('/rest/v1/', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, query: u.searchParams, body });
    if (path === 'orgs') return reply([{ id: ORG, slug: 'mccluster' }]);
    if (path === 'org_members') return reply(role ? [{ org_id: ORG, profile_id: u.searchParams.get('profile_id').slice(3), role }] : []);
    if (path === 'events' && u.searchParams.get('session_id')) return reply(events.filter(e => {
      const uid=u.searchParams.get('uid'),device=u.searchParams.get('device_id');
      return (!uid || (uid==='is.null' ? !e.uid : e.uid===uid.slice(3))) && (!device || (device==='not.is.null' ? !!e.device_id : e.device_id===device.slice(3)));
    }));
    if (path === 'events' && u.searchParams.get('uid')) return reply(devices.map((device_id) => ({ device_id })));
    if (path === 'platform_profiles') return reply(profile ? [profile] : []);
    if (path === 'rpc/analytics_session_evidence_v6') {
      const out=typeof rpc.sessions==='function'?rpc.sessions(body):(rpc.sessions||{total:0,counts:{},sessions:[]});
      return reply({measurement_version:'session-event-identity/v6',identity_basis:'event_bound_account_or_unattributed_device',total:out.sessions?.length||0,devices:devices.length?[...new Set(devices)]:['dev-abcdef'],...out});
    }
    if (path === 'rpc/analytics_visitor_list_v6') return reply(rpc.visitors || { total: 0, counts: {}, visitors: [] });
    return reply({ message: `unexpected ${path}` }, 500);
  };
  return { calls, handler };
}

function get(path, user = OWNER) {
  const request = new Request(`https://api.mccluster.org${path}`, { method: 'GET' });
  return handleAnalyticsRequest(request, env, user);
}

const SESSION = {
  session_id: 'sess-123456', device_id: 'dev-abcdef', uid: UID, started_at: '2026-10-05T12:00:00Z', ended_at: '2026-10-05T12:04:00Z',
  duration_s: 240, events: 3, pages: ['album.html'], device: { platform: 'iPhone', mobile: true, w: 390, h: 844, secret: 'x' }
};

test('every forensic route refuses anyone who is not the house owner', async () => {
  for (const path of ['/v1/analytics/sessions', '/v1/analytics/visitors', '/v1/analytics/sessions/sess-123456', `/v1/analytics/visitors/u:${UID}`]) {
    const { handler, calls } = backend({ role: 'member' });
    await withFetch(handler, async () => {
      await assert.rejects(() => get(path, STRANGER), (err) => err.status === 403, `${path} must be owner-only`);
    });
    assert.ok(!calls.some((c) => c.path.startsWith('rpc/') || c.path === 'events' || c.path === 'platform_profiles'),
      `${path} must not read telemetry before the owner check`);
  }
  const { handler } = backend();
  await withFetch(handler, async () => {
    await assert.rejects(() => get('/v1/analytics/sessions', null), (err) => err.status === 401);
  });
});

test('the session list whitelists and clamps what reaches the database', async () => {
  const { handler, calls } = backend({ rpc: { sessions: { total: 1, counts: { all: 1 }, unsessioned_events: 7, sessions: [SESSION] } } });
  const res = await withFetch(handler, () => get('/v1/analytics/sessions?since=2026-10-01T00:00:00Z&until=2026-10-06T00:00:00Z&limit=999&offset=-5&filter=drop%20table&sort=evil&q=%20%20new%20haven%20%20'));
  assert.equal(res.status, 200);
  const out = await res.json();
  const body = calls.find((c) => c.path === 'rpc/analytics_session_evidence_v6').body;
  assert.deepEqual(body, {
    p_since: '2026-10-01T00:00:00.000Z', p_until: '2026-10-06T00:00:00.000Z',
    p_limit: 100, p_offset: 0, p_filter: 'all', p_sort: 'recent', p_q: 'new haven'
  });
  assert.equal(out.total, 1);
  assert.equal(out.unsessioned_events, 7);
  assert.equal(out.sessions[0].device.platform, 'iPhone');
  assert.equal(out.sessions[0].device.screen, '390×844');
  assert.equal(out.sessions[0].device.secret, undefined, 'device blobs are summarized, never passed through');
});

test('a reversed range is a 400, not a database call', async () => {
  const { handler, calls } = backend();
  await withFetch(handler, async () => {
    await assert.rejects(() => get('/v1/analytics/sessions?since=2026-10-06T00:00:00Z&until=2026-10-01T00:00:00Z'), (err) => err.status === 400);
  });
  assert.ok(!calls.some((c) => c.path.startsWith('rpc/')));
});

test('opening an account-only session requests event-bound history across its observed devices', async () => {
  const events = [
    { at: '2026-10-05T12:00:00Z', name: 'page_view', path: 'album.html', props: {}, uid: UID, device_id: 'dev-abcdef', device: { platform: 'iPhone', w: 390, h: 844 } },
    { at: '2026-10-05T12:04:00Z', name: 'account_created', path: 'account.html', props: { source: 'instagram' }, uid: UID, device_id: 'dev-abcdef' }
  ];
  const { handler, calls } = backend({
    events, devices: ['dev-laptop1', 'dev-abcdef', 'dev-laptop1'],
    profile: { display_name: 'Jane Doe', primary_email: 'jane@example.com', mccluster_id: 'janed', phone: '+15555550123' },
    rpc: { sessions: (b) => b.p_sessions ? { total: 1, sessions: [SESSION] } : { total: 2, sessions: [SESSION, { ...SESSION, session_id: 'sess-older1' }] } }
  });
  const res = await withFetch(handler, () => get('/v1/analytics/sessions/sess-123456?include_history=1'));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.session.session_id, 'sess-123456');
  assert.equal(out.events.length, 2);
  assert.equal(out.events[0].device.screen, '390×844');
  assert.equal(out.visitor.key, `u:${UID}`);
  assert.deepEqual(out.visitor.devices, ['dev-laptop1', 'dev-abcdef'], 'every device the signed-in person used, once each');
  assert.equal(out.visitor.sessions.length, 2);
  assert.equal(out.visitor.profile.email, 'jane@example.com');
  assert.equal(out.visitor.profile.phone, undefined, 'only what the page shows leaves the database');
  const summary = calls.find((c) => c.path === 'rpc/analytics_session_evidence_v6' && c.body.p_sessions);
  assert.deepEqual(summary.body.p_sessions, ['sess-123456']);
  assert.equal(summary.body.p_visitor_key,null);
  assert.equal(summary.body.p_filter, 'any', 'a bot session can still be opened');
  const history = calls.find((c) => c.path === 'rpc/analytics_session_evidence_v6' && c.body.p_visitor_key);
  assert.equal(history.body.p_visitor_key, 'u:'+UID);
  assert.equal(history.body.p_devices,undefined,'account membership is never expanded to all device rows');
  const ev = calls.find((c) => c.path === 'events' && c.query.get('session_id'));
  assert.equal(ev.query.get('session_id'), 'eq.sess-123456');
  assert.equal(ev.query.get('site_id'), 'is.null', 'first-party telemetry only');
});

test('session and visitor ids are validated before any query', async () => {
  const { handler, calls } = backend();
  await withFetch(handler, async () => {
    for (const path of ['/v1/analytics/sessions/x', '/v1/analytics/sessions/a%27%20or%201%3D1', '/v1/analytics/visitors/u:not-a-uuid', '/v1/analytics/visitors/zz:abc123', '/v1/analytics/sessions/%E0%A4%A']) {
      const res = await get(path);
      assert.equal(res.status, 400, path);
    }
  });
  assert.ok(!calls.some((c) => c.path === 'events' || c.path.startsWith('rpc/')));
});

test('a session with no events is a 404', async () => {
  const { handler } = backend({ events: [] });
  const res = await withFetch(handler, () => get('/v1/analytics/sessions/sess-missing'));
  assert.equal(res.status, 404);
});

test('a device visitor reads only that device; an unknown one is a 404', async () => {
  const seen = backend({ rpc: { sessions: { total: 1, sessions: [SESSION] } } });
  const res = await withFetch(seen.handler, () => get('/v1/analytics/visitors/d:dev-abcdef'));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.visitor.devices, ['dev-abcdef']);
  assert.equal(out.visitor.uid, null);
  assert.equal(out.visitor.sessions[0].device.platform, 'iPhone');
  const call = seen.calls.find((c) => c.path === 'rpc/analytics_session_evidence_v6');
  assert.equal(call.body.p_visitor_key,'d:dev-abcdef');
  assert.equal(call.body.p_devices,undefined);
  assert.equal(call.body.p_limit, 100);
  const missing = backend();
  const res404 = await withFetch(missing.handler, () => get('/v1/analytics/visitors/d:dev-nothing'));
  assert.equal(res404.status, 404);
});

test('the visitor list whitelists its own filters and sorts', async () => {
  const { handler, calls } = backend({ rpc: { visitors: { total: 1, counts: { all: 1 }, visitors: [{ visitor_key: `u:${UID}`, device: { platform: 'Mac', w: 1440, h: 900 } }] } } });
  const res = await withFetch(handler, () => get('/v1/analytics/visitors?filter=returning&sort=sessions&limit=0'));
  const out = await res.json();
  const body = calls.find((c) => c.path === 'rpc/analytics_visitor_list_v6').body;
  assert.equal(body.p_filter, 'returning');
  assert.equal(body.p_sort, 'sessions');
  assert.equal(body.p_limit, 1);
  assert.equal(body.p_q, null);
  assert.equal(out.visitors[0].device.screen, '1440×900');
  const bad = backend();
  await withFetch(bad.handler, () => get('/v1/analytics/visitors?filter=converted&sort=events'));
  const b2 = bad.calls.find((c) => c.path === 'rpc/analytics_visitor_list_v6').body;
  assert.equal(b2.p_filter, 'all', 'session-only filters do not leak into the visitor list');
  assert.equal(b2.p_sort, 'recent');
});

test('opening a session does not depend on the 180-day device history read', async () => {
  const events=[{at:SESSION.started_at,name:'page_view',device_id:SESSION.device_id,uid:UID}];
  const b=backend({events,rpc:{sessions:body=>{assert.ok(body.p_sessions,'no history aggregation in the critical read');return {sessions:[SESSION]};}}});
  const res=await withFetch(b.handler,()=>get('/v1/analytics/sessions/sess-123456'));
  const out=await res.json();assert.equal(res.status,200);assert.equal(out.events.length,1);
  assert.equal(out.visitor.history_status,'not_loaded');assert.equal(out.visitor.sessions,null);assert.equal(out.visitor.total,null);
  assert.ok(!b.calls.some(c=>c.path==='events'&&c.query.get('uid')),'no device discovery in critical read');
});

test('history timeout stays a genuine error; it is never an empty successful history', async () => {
  const b=backend({events:[{at:SESSION.started_at,name:'page_view',device_id:SESSION.device_id}],rpc:{sessions:{sessions:[SESSION]}}});
  const handler=(url,init)=>String(url).includes('rpc/analytics_session_evidence_v6')&&JSON.parse(init.body).p_visitor_key
    ?reply({code:'57014',message:'canceling statement due to statement timeout'},500):b.handler(url,init);
  await withFetch(handler,async()=>{
    assert.equal((await get('/v1/analytics/sessions/sess-123456')).status,200);
    await assert.rejects(()=>get('/v1/analytics/sessions/sess-123456?include_history=1'),e=>e.status===502&&e.db_code==='57014');
  });
});

test('a genuine core events read failure is not converted to missing session or empty data', async () => {
  const b=backend();
  await withFetch((url,init)=>String(url).includes('/events?')?reply({code:'57014'},500):b.handler(url,init),async()=>{
    await assert.rejects(()=>get('/v1/analytics/sessions/sess-123456'),e=>e.status===502&&e.db_code==='57014');
  });
});

test('mixed session evidence never assigns a first/latest account or expands device history',async()=>{
 const other='823e4567-e89b-42d3-a456-426614174888';
 const events=[null,UID,other].map((uid,i)=>({id:'e'+i,at:`2026-10-05T12:00:0${i}Z`,name:'page_view',uid,device_id:'dev-abcdef'}));
 const b=backend({events,profile:{display_name:'Must not be assigned'},rpc:{sessions:{total:1,sessions:[SESSION]}}});
 const out=await (await withFetch(b.handler,()=>get('/v1/analytics/sessions/sess-123456?include_history=1'))).json();
 assert.equal(out.session.uid,null);assert.equal(out.session.display_name,null);assert.equal(out.session.identity_status,'mixed');
 assert.equal(out.visitor.key,null);assert.equal(out.visitor.profile,null);assert.equal(out.visitor.history_status,'choose_identity');
 assert.deepEqual(out.visitor.identity_buckets.map(x=>x.key),['d:dev-abcdef','u:'+UID,'u:'+other]);
 assert.equal(b.calls.filter(c=>c.path.startsWith('rpc/')).length,1,'mixed identity needs an explicit scope');
 assert.ok(!b.calls.some(c=>c.path==='platform_profiles'));
});

test('account and device session drilldowns use the same row identity as their history scope',async()=>{
 const events=[null,UID,'823e4567-e89b-42d3-a456-426614174888'].map((uid,i)=>({id:'e'+i,at:`2026-10-05T12:00:0${i}Z`,name:'page_view',uid,device_id:'dev-abcdef'}));
 for(const key of ['u:'+UID,'d:dev-abcdef']){
  const b=backend({events,rpc:{sessions:{total:1,sessions:[SESSION]}}});
  const out=await (await withFetch(b.handler,()=>get('/v1/analytics/sessions/sess-123456?visitor_key='+encodeURIComponent(key)+'&include_history=1'))).json();
  assert.equal(out.events.length,1);assert.equal(out.scope.visitor_key,key);
  assert.equal(out.events[0].uid,key.startsWith('u:')?UID:null);
  const rpc=b.calls.filter(c=>c.path.startsWith('rpc/'));
  assert.equal(rpc.length,2);assert.ok(rpc.every(c=>c.body.p_visitor_key===key&&!c.body.p_devices));
  const query=b.calls.find(c=>c.path==='events').query;
  assert.equal(query.get('uid'),key.startsWith('u:')?'eq.'+UID:'is.null');
  assert.equal(query.get('site_id'),'is.null');assert.equal(query.get('order'),'at.asc,id.asc');
 }
});

test('unknown/deleted account and scope have honest missing states; existing account may have no history',async()=>{
 const absent=backend();
 assert.equal((await withFetch(absent.handler,()=>get('/v1/analytics/visitors/u:'+UID))).status,404);
 assert.equal((await withFetch(absent.handler,()=>get('/v1/analytics/sessions/sess-123456?visitor_key=u:'+UID))).status,404);
 const known=backend({profile:{display_name:'Known account'}});
 const out=await (await withFetch(known.handler,()=>get('/v1/analytics/visitors/u:'+UID))).json();
 assert.equal(out.visitor.total,0);assert.deepEqual(out.visitor.sessions,[]);assert.equal(out.visitor.profile.display_name,'Known account');
});

test('missing identity SQL is actionable and never falls back to device-expanded legacy data',async()=>{
 const b=backend(),seen=[];
 const handler=(url,init)=>{seen.push(String(url));return String(url).includes('/rpc/')?reply({code:'PGRST202'},404):b.handler(url,init);};
 for(const path of ['/v1/analytics/visitors','/v1/analytics/visitors/u:'+UID,'/v1/analytics/sessions']){
  await withFetch(handler,()=>assert.rejects(()=>get(path),e=>e.status===503&&e.code==='analytics_identity_schema_required'));
 }
 assert.ok(seen.filter(x=>x.includes('/rpc/')).every(x=>/analytics_(visitor_list_v6|session_evidence_v6)/.test(x)));
});

test('a capped timeline cannot infer a sole account from its partial evidence',async()=>{
 const events=Array.from({length:2001},(_,i)=>({id:'e'+i,at:SESSION.started_at,name:'page_view',uid:UID,device_id:'dev-abcdef'}));
 const b=backend({events,rpc:{sessions:{total:1,sessions:[SESSION]}}});
 const out=await (await withFetch(b.handler,()=>get('/v1/analytics/sessions/sess-123456'))).json();
 assert.equal(out.events.length,2000);assert.equal(out.truncated,true);assert.equal(out.session.identity_status,'partial_identity');
 assert.equal(out.visitor.key,null);assert.equal(out.visitor.history_status,'choose_identity');
});

test('malformed visitor responses remain read failures rather than fake empty profiles',async()=>{
 const {handler}=backend({rpc:{visitors:{total:3,visitors:null}}});
 await withFetch(handler,()=>assert.rejects(()=>get('/v1/analytics/visitors'),err=>err.status===502));
});
