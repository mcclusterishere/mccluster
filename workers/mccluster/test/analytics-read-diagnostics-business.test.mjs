import test from 'node:test';
import assert from 'node:assert/strict';
import {businessSnapshot} from '../src/analytics/router.js';
import {EVENT_COUNT_FIELDS} from '../src/analytics/business-event-counts.js';

const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'opaque-service-key'};
const reply=(body,status=200,headers={})=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json','content-range':'0-0/0',...headers}
});

test('business exposes sanitized failure code, request correlation and timing without concealing valid metrics',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async raw=>{
    const u=new URL(raw),endpoint=u.pathname.split('/').pop();
    if(u.pathname.includes('/auth/'))return reply({users:[]});
    if(endpoint==='orgs')return reply([{id:'house'}]);
    if(endpoint==='network_posts')return reply({code:'57014',message:'DELETE THIS SECRET: Authorization Bearer xyz'},500,{'x-request-id':'postgrest-8a3b4c'});
    if(endpoint==='analytics_business_event_counts'){
      const data=Object.fromEntries(EVENT_COUNT_FIELDS.map(field=>[field,field.endsWith('_window')?3:7]));
      return reply([data]);
    }
    return reply([],200,{'cf-ray':'ray-live-77aa'});
  };
  try{
    const snapshot=await businessSnapshot(env,{since:'2026-10-20T00:00:00Z',until:'2026-10-21T00:00:00Z'});
    assert.equal(snapshot.partial,true);
    assert.equal(snapshot.mnet.posts.total,null);
    assert.equal(snapshot.platform.page_views.total,7);
    assert.equal(snapshot.platform.page_views.in_window,3);
    assert.equal(snapshot.read_errors.postsTotal,'Data read unavailable');
    assert.equal(snapshot.read_diagnostics.postsTotal.reason,'timeout');
    assert.equal(snapshot.read_diagnostics.postsTotal.error_code,'57014');
    assert.equal(snapshot.read_diagnostics.postsTotal.upstream_http_status,500);
    assert.equal(snapshot.read_diagnostics.postsTotal.request_id,'postgrest-8a3b4c');
    assert.ok(snapshot.read_diagnostics.postsTotal.elapsed_ms>=0);
    assert.equal(snapshot.read_diagnostics.eventCounts.status,'ready');
    assert.ok(snapshot.read_diagnostics.eventCounts.elapsed_ms>=0);
    assert.doesNotMatch(JSON.stringify(snapshot.read_diagnostics),/DELETE THIS SECRET|Authorization|xyz|opaque-service-key/);
  }finally{globalThis.fetch=original;}
});
