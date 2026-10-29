import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../../supabase/functions/collect/index.ts', import.meta.url), 'utf8');
const compiled = stripTypeScriptTypes(source, { mode: 'strip' });

async function collect({ headers = {}, body, tenantMode = 'required' }) {
  let handler;
  const calls = [];
  const ctx = {
    Deno: { env: { get: name => name === 'SUPABASE_URL' ? 'https://local.test.supabase.co' : 'not-a-real-secret' },
      serve: fn => { handler = fn; } },
    Response, Request, Headers, TextEncoder, URL, console, crypto: webcrypto, setTimeout,
    fetch: async (url, init = {}) => {
      const href = String(url);
      calls.push({ href, method: init.method || 'GET', body: init.body });
      if (href.includes('/rest/v1/analytics_sites?')) return Response.json([{id:'11111111-1111-4111-8111-111111111111',consent_mode:tenantMode}]);
      if (href.includes('/rest/v1/analytics_site_domains?')) return Response.json([{id:'22222222-2222-4222-8222-222222222222'}]);
      if (href.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '123e4567-e89b-42d3-a456-426614174000' }), {status:200});
      if (href.includes('/rest/v1/events?on_conflict=id')) {
        const rows = JSON.parse(init.body);
        return new Response(JSON.stringify(rows.map(({id})=>({id}))), {status:201, headers:{'content-type':'application/json'}});
      }
      throw new Error('Unexpected egress: ' + href);
    }
  };
  vm.runInNewContext(compiled, ctx, {filename:'collect.ts',timeout:2500});
  assert.equal(typeof handler, 'function');
  const request = new Request('https://api.mccluster.org/functions/v1/collect', {
    method:'POST',
    headers: { 'content-type':'application/json', authorization:'Bearer synthetic-valid-token',
      'user-agent':'synthetic-private-agent', 'cf-connecting-ip':'203.0.113.66', ...headers },
    body: JSON.stringify(body ?? {
      device_id:'persistent-device', session_id:'persistent-session',
      events:[{name:'page_view',path:'/profile/private?email=person@example.test',
        referrer:'https://example.test/?auth=token',
        props:{email:'person@example.test',lat:41.2,token:'dontstore',track:'music'}}]
    })
  });
  const response = await handler(request);
  return {response, calls, rows: calls.find(x=>x.href.includes('/rest/v1/events?on_conflict=id'))?.body
    ? JSON.parse(calls.find(x=>x.href.includes('/rest/v1/events?on_conflict=id')).body) : []};
}

for (const header of [{ 'sec-gpc': '1' }, { dnt:'1' }]) {
  test('privacy signal '+JSON.stringify(header)+' retains only anonymous aggregate event attributes', async () => {
    const {response,rows,calls} = await collect({headers:header});
    assert.equal(response.status,200);
    assert.equal(rows.length,1);
    assert.equal(rows[0].name,'page_view');
    for (const key of ['uid','ip','device_id','session_id','user_agent','referrer','latitude','longitude','city','postal']) {
      assert.equal(rows[0][key],null,key);
    }
    assert.equal(rows[0].path,'/');
    assert.deepEqual(JSON.parse(JSON.stringify(rows[0].props)),{});
    assert.equal(calls.filter(x=>x.href.endsWith('/auth/v1/user')).length,0,'no identity lookup under opt-out');
  });
}
test('granted collection preserves verified identity while minimizing payloads', async () => {
  const {response,rows,calls} = await collect({});
  assert.equal(response.status,200);
  assert.equal(rows.length,1);
  assert.equal(rows[0].uid,'123e4567-e89b-42d3-a456-426614174000');
  assert.equal(rows[0].device_id,'persistent-device');
  assert.equal(rows[0].session_id,'persistent-session');
  assert.match(rows[0].path,/profile\/private/);
  assert.equal(rows[0].props.email,undefined);
  assert.doesNotMatch(rows[0].path,/token=|email=/);
  assert.equal(calls.filter(x=>x.href.endsWith('/auth/v1/user')).length,1);
});

test('each recorded event has a valid UUID, while opt-out still discards all identifiers and metadata', async () => {
  const quiet = await collect({headers:{'sec-gpc':'1'},body:{device_id:'should-be-discarded',session_id:'session',events:[{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',name:'page_view',path:'/secret',props:{email:'private@example.test'}}]}});
  assert.equal(quiet.rows[0].id,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  assert.equal(quiet.rows[0].device_id,null);
  assert.equal(quiet.rows[0].session_id,null);
  assert.equal(quiet.rows[0].path,'/');
  assert.deepEqual(JSON.parse(JSON.stringify(quiet.rows[0].props)),{});
  const invalid = await collect({body:{events:[{id:'not-a-uuid',name:'page_view',path:'/'}]}});
  assert.match(invalid.rows[0].id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
});

test('first-party origin retains hostname without changing shared analytics scope', async () => {
  const { rows } = await collect({ headers: { origin: 'https://matthew.mccluster.org' } });
  assert.equal(rows[0].source_host, 'matthew.mccluster.org');
  assert.equal(rows[0].site_id, null);
});
test('unknown origins cannot claim a first-party host through the body', async () => {
  const { rows } = await collect({ headers: { origin: 'https://unowned.example' }, body: { source_host: 'mccluster.org', events: [{name:'page_view'}] } });
  assert.equal(rows[0].source_host, null);
});
test('referrer host fallback and GPC preserve only coarse first-party attribution', async () => {
  const { rows } = await collect({ headers: { referer: 'https://humanuprise.com/private?token=secret', 'sec-gpc': '1' } });
  assert.equal(rows[0].source_host, 'humanuprise.com');
  assert.equal(rows[0].referrer, null);
  assert.equal(rows[0].uid, null);
  assert.equal(rows[0].path, '/');
});

test('ingress minimizes real diagnostics, URLs, copied prose and playback payloads for direct callers',async()=>{
 const id='123e4567-e89b-42d3-a456-426614174000';
 const {rows}=await collect({headers:{origin:'https://matthew.mccluster.org'},body:{device_id:'fixture',session_id:'visit',device:{platform:'fixture',email:'PRIVATE@example.test',token:'SECRET'},events:[
  {id,name:'js_error',path:'/account?token=SECRET#private',referrer:'https://user:SECRET@example.test/from?token=SECRET',props:{msg:"ReferenceError: Can't find variable: _AutofillCallbackHandler",src:'iabjs://instagram/autofill.js?token=SECRET',origin:'injected',iab:'instagram',private:'PRIVATE'}},
  {name:'js_rejection',props:{msg:'TypeError: failed {"access_token":"SECRET"} contact PRIVATE@example.test',origin:'site',stack:'render@https://matthew.mccluster.org/js/app.js?secret=SECRET',extra:'PRIVATE'}},
  {name:'click',props:{el:'button.checkout',href:'/account?token=SECRET',text:'PRIVATE',value:'PRIVATE',x:10}},
  {name:'copy',props:{chars:7,text:'PRIVATE'}},
  {name:'music_play',props:{track:'Fixture title',creator_track_id:'known-recording',album_slug:'fixture',access_state:'full',source:'creator_discovery',playback_attempt_id:id,playback_sequence:2,validated_played_seconds:1.25,measurement_status:'browser_progress_not_attention',uid:'claimed-account',freeform:'PRIVATE'}},
  {name:'custom_action',path:'data:text/plain,PRIVATE',referrer:null,props:{nested:{email:'PRIVATE@example.test',ok:1},url:'https://user:SECRET@example.test/path?secret=SECRET',values:Array(25).fill(1)}}
 ]}});
 assert.equal(rows.length,6);assert.equal(rows[0].id,id);assert.equal(rows[0].path,'/account');
 assert.equal(rows[0].props.msg,"ReferenceError: Can't find variable: _AutofillCallbackHandler");
 assert.equal(rows[0].props.src,'iabjs://instagram/autofill.js');assert.equal(rows[0].props.origin,'injected');
 assert.equal(rows[1].props.origin,'site');assert.match(rows[1].props.msg,/TypeError: failed/);
 assert.equal(rows[2].props.href,'https://matthew.mccluster.org/account');assert.equal(rows[2].props.x,10);
 assert.deepEqual(JSON.parse(JSON.stringify(rows[3].props)),{chars:7});
 assert.equal(rows[4].props.playback_attempt_id,id);assert.equal(rows[4].props.creator_track_id,'known-recording');
 assert.equal(rows[4].props.source,'creator_discovery');assert.equal(rows[4].props.uid,undefined);
 assert.equal(rows[5].props.values.length,20);assert.equal(rows[5].path,'');assert.equal(rows[5].referrer,null);
 assert.doesNotMatch(JSON.stringify(rows),/SECRET|PRIVATE|claimed-account/);
});

test('the same minimization covers verified tenant ingress without changing consent or cookieless behavior',async()=>{
 const events=[{name:'js_error',path:'/route?token=SECRET',props:{msg:'Real application failure',origin:'site',secret:'SECRET'}}];
 const base={site_key:'mca_'+'a'.repeat(32),device_id:'fixture',session_id:'visit',events};
 const headers={origin:'https://tenant.example.test'};
 const denied=await collect({headers,body:{...base,consent_state:'denied'}});
 assert.equal(denied.rows.length,0);assert.equal(denied.calls.filter(c=>c.href.endsWith('/auth/v1/user')).length,0);
 const granted=await collect({headers,body:{...base,consent_state:'granted'}});
 assert.equal(granted.rows[0].props.msg,'Real application failure');assert.equal(granted.rows[0].source_host,'tenant.example.test');
 assert.equal(granted.rows[0].site_id,'11111111-1111-4111-8111-111111111111');
 assert.doesNotMatch(JSON.stringify(granted.rows),/SECRET/);
 const quiet=await collect({headers,tenantMode:'cookieless',body:{...base,consent_state:'cookieless'}});
 assert.equal(quiet.rows[0].path,'/');assert.equal(quiet.rows[0].device_id,null);assert.equal(quiet.rows[0].uid,null);
 assert.deepEqual(JSON.parse(JSON.stringify(quiet.rows[0].props)),{});
});

test('Unicode and nested custom properties stay below database size limits with explicit truncation',async()=>{
 const props=Object.fromEntries(Array.from({length:40},(_,i)=>['field'+i,'界'.repeat(400)]));
 const {rows}=await collect({body:{device:props,events:[{name:'custom_action',props}]}});
 assert.ok(new TextEncoder().encode(JSON.stringify(rows[0].props)).length<=8192);
 assert.ok(new TextEncoder().encode(JSON.stringify(rows[0].device)).length<=2048);
 assert.equal(rows[0].props.payload_truncated,true);assert.equal(rows[0].device.payload_truncated,true);
});

test('custom event names cannot invoke inherited allowlist properties',async()=>{
 const {rows}=await collect({body:{events:['constructor','__proto__','toString'].map(name=>({name,props:{count:1,email:'private@example.test'}}))}});
 assert.equal(rows.length,3);
 for(const row of rows){assert.equal(row.props.count,1);assert.equal(row.props.email,undefined);}
});
