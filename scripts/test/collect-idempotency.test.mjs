import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = await readFile(new URL('../../supabase/functions/collect/index.ts',import.meta.url),'utf8');
const uuid = '123e4567-e89b-42d3-a456-426614174000';
const event = { id:uuid, name:'page_view', path:'/test', props:{label:'a synthetic visit'} };

async function collector({tenant=false, errors=[], initialCommitOnFailure=false, quiet=false}={}) {
  const persisted = new Map(), requests=[];
  let handler, authRequests=0;
  const ctx={
    Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://local.test':'a-placeholder'},serve:fn=>{handler=fn;}},
    Request,Response,Headers,URL,TextEncoder,console,crypto:webcrypto,setTimeout,
    fetch:async (url,init={})=>{
      const u=String(url),method=init.method||'GET';
      if(u.includes('/auth/v1/user')){
        authRequests++;
        return new Response(JSON.stringify({id:'33333333-3333-4333-8333-333333333333'}),{status:200});
      }
      if(u.includes('/rest/v1/analytics_sites?'))
        return new Response(JSON.stringify([{id:'11111111-1111-4111-8111-111111111111',consent_mode:'cookieless'}]),{status:200});
      if(u.includes('/rest/v1/analytics_site_domains?'))
        return new Response(JSON.stringify([{id:'22222222-2222-4222-8222-222222222222'}]),{status:200});
      if(u.includes('/rest/v1/events?')){
        const payload=JSON.parse(init.body),attempt=requests.length;
        requests.push({url:u,method,headers:init.headers,rows:payload});
        const error=errors[attempt];
        if(error){
          if(initialCommitOnFailure)for(const row of payload)persisted.set(row.id,row);
          return new Response(JSON.stringify({code:error,message:'canceling statement due to statement timeout'}),{status:503});
        }
        const inserted=[];
        for(const row of payload)if(!persisted.has(row.id)){
          persisted.set(row.id,row);inserted.push({id:row.id});
        }
        return new Response(JSON.stringify(inserted),{status:201,headers:{'content-type':'application/json'}});
      }
      throw Error('unexpected URL '+u);
    }
  };
  vm.runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),ctx,{timeout:3000});
  assert.equal(typeof handler,'function');
  const send=async(e=event)=>{
    const body=tenant?
      {site_key:'mca_'+'a'.repeat(32),consent_state:'cookieless',device_id:'must-be-dropped',session_id:'must-be-dropped',events:[e]}:
      {device_id:'synthetic-browser',session_id:'synthetic-visit',events:[e]};
    const req=new Request('https://api.mccluster.org/functions/v1/collect',{method:'POST',
      headers:{'content-type':'application/json','user-agent':'test-browser','origin':'https://tenant.example.test',
        ...(tenant?{'authorization':'Bearer synthetic-valid-token'}:{}),...(quiet?{'dnt':'1'}:{})},
      body:JSON.stringify(body)});
    const r=await handler(req);
    return {status:r.status,body:await r.json()};
  };
  return {send,persisted,requests,authRequests:()=>authRequests};
}

test('repeated event IDs are ignored rather than double-counted in PostgREST',async()=>{
  const c=await collector();
  const first=await c.send(),again=await c.send();
  assert.deepEqual(JSON.parse(JSON.stringify(first.body)),{ok:true,received:1,written:1});
  assert.deepEqual(JSON.parse(JSON.stringify(again.body)),{ok:true,received:1,written:0});
  assert.equal(c.persisted.size,1);
  assert.equal(c.requests.length,2);
  assert.ok(c.requests.every(x=>x.url.includes('on_conflict=id&select=id')));
  assert.ok(c.requests.every(x=>x.headers.Prefer==='resolution=ignore-duplicates,return=representation'));
  assert.equal(c.requests[0].rows[0].id,uuid);
});

test('a transaction cancellation is retried once with the exact same event ID',async()=>{
  const c=await collector({errors:['57014']});
  const res=await c.send();
  assert.equal(res.status,200);
  assert.equal(res.body.written,1);
  assert.equal(c.requests.length,2);
  assert.equal(c.requests[0].rows[0].id,c.requests[1].rows[0].id);
  assert.equal(c.persisted.size,1);
});

test('an ambiguous commit followed by a 503 cannot double-count an event',async()=>{
  const c=await collector({errors:['57014'],initialCommitOnFailure:true});
  const res=await c.send();
  assert.equal(res.status,200);
  assert.equal(res.body.received,1);
  assert.equal(res.body.written,0,'the second attempt inserted no duplicates');
  assert.equal(c.persisted.size,1);
  assert.equal(c.requests.length,2);
});

test('persistent database failures are reported and never acknowledged as successful',async()=>{
  const c=await collector({errors:['57014','57014']});
  const res=await c.send();
  assert.equal(res.status,502);
  assert.equal(res.body.ok,false);
  assert.equal(c.requests.length,2);
  assert.equal(c.persisted.size,0);
});

test('cookie-free tenant tracking drops both device and session IDs at the writer',async()=>{
  const c=await collector({tenant:true});
  const res=await c.send();
  assert.equal(res.status,200);
  const saved=[...c.persisted.values()][0];
  assert.equal(saved.device_id,null);
  assert.equal(saved.session_id,null);
  assert.equal(saved.uid,null);
  assert.equal(saved.ip,null);
  assert.equal(saved.user_agent,null);
  assert.equal(saved.path,'/');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.props)),{});
  assert.equal(c.authRequests(),0,'do not even look up a signed-in visitor under cookieless collection');
  assert.equal(saved.name,'page_view');
  assert.equal(saved.id,uuid);
});

test('DNT still suppresses visitor metadata when using a replay-safe event ID',async()=>{
  const c=await collector({quiet:true});
  const res=await c.send({id:uuid,name:'page_view',path:'/secret',props:{email:'nobody@invalid.test'}});
  assert.equal(res.status,200);
  const saved=[...c.persisted.values()][0];
  assert.equal(saved.id,uuid);
  assert.equal(saved.device_id,null);
  assert.equal(saved.session_id,null);
  assert.equal(saved.path,'/');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.props)),{});
});

test('all first-party and SDK events mint UUIDs; house recovery stores only minimal consent-gated envelopes',async()=>{
  const [house,sdk]=await Promise.all([
    readFile(new URL('../../js/analytics.js',import.meta.url),'utf8'),
    readFile(new URL('../../js/mc-analytics.js',import.meta.url),'utf8')
  ]);
  assert.match(house,/var event = \{\s*id:\s*uuid\(\)/);
  assert.match(house,/eventOutbox\.put\(event\)/);
  assert.match(house,/queue\.push\(event\)/);
  assert.match(house,/if \(!permitted\(\)\) \{purge\(\); return false;\}/);
  assert.match(house,/attempt\(COLLECT_FALLBACK\)/);
  assert.match(house,/if \(r \|\| keepalive \|\| privacySignal\(\) \|\| !mccPrivacyAcknowledged\(\)\) return r/);
  assert.match(sdk,/queue\.push\(\{\s*id:\s*uuid\(\)/);
  assert.match(sdk,/if \(consentState\(\) !== "granted"\) return null/);
  assert.match(sdk,/if \(tries \|\| teardown \|\| !canSend\(\)/);
});


test('fallback event IDs remain UUIDv4 without Web Crypto',async()=>{
  const files=[
    {path:'../../js/analytics.js',end:'/* ---- the device ----'},
    {path:'../../js/mc-analytics.js',end:'function storageGet('}
  ];
  for(const f of files){
    const js=await readFile(new URL(f.path,import.meta.url),'utf8');
    const i=js.indexOf('function uuid() {'),end=js.indexOf(f.end,i);
    assert.ok(i>=0&&end>i,'found UUID function in '+f.path);
    const method=js.slice(i,end);
    const id=vm.runInNewContext(method+'\n uuid()',{
      window:{crypto:null},crypto:undefined,Math,Date,Uint8Array,Array,Error
    });
    assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,f.path);
  }
});

test('pending retries are canceled when consent is withdrawn or privacy signals appear',async()=>{
  const [house,sdk]=await Promise.all([
    readFile(new URL('../../js/analytics.js',import.meta.url),'utf8'),
    readFile(new URL('../../js/mc-analytics.js',import.meta.url),'utf8')
  ]);
  assert.match(house,/if \(!mccPrivacyAcknowledged\(\) \|\| privacySignal\(\)\) return null;/);
  assert.match(sdk,/function attempt\(tries\) \{[\s\S]*?if \(!canSend\(\)\) return Promise\.resolve\(null\);/);
  assert.match(sdk,/storageSet\(localStorage, CONSENT_KEY, "denied"\)/);
});
