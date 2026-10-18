import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePlatformApi} from '../../workers/mccluster/src/platform-api.js';

const ID='11111111-1111-4111-8111-111111111111';
const MUID='22222222-2222-4222-8222-222222222222';
const AUTH='33333333-3333-4333-8333-333333333333';
const COMMENT_URL='https://api.mccluster.org/v1/world/news/'+ID+'/comments';
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',WORLD_NEWS_COMMENTS_ENABLED:'true'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const req=(method='GET',body)=>new Request(COMMENT_URL,{method,...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json',authorization:'Bearer test-user-token'}}:method==='POST'?{headers:{authorization:'Bearer test-user-token'}}:{})});

test('news discussions fail closed until approved database migration and flag activation',async()=>{
  let fetched=false;const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>{fetched=true;throw Error('unexpected call')};
    const r=await handlePlatformApi(req(),{...env,WORLD_NEWS_COMMENTS_ENABLED:'false'});
    assert.equal(r.status,503);
    assert.equal(fetched,false);
  }finally{globalThis.fetch=original;}
});

test('news discussions authorize writes, preserve publisher boundary, and allow safe guest reads', {concurrency:false},async()=>{
  const original=globalThis.fetch, calls=[],writes=[];
  let missingArticle=false;
  try {
    globalThis.fetch=async(resource,options={})=>{
      const u=new URL(String(resource)),path=u.pathname,method=options.method||'GET';
      calls.push({path,method});
      if(path==='/auth/v1/user')return response({id:AUTH});
      if(path==='/rest/v1/m_auth_user_links')return response([{m_uid:MUID}]);
      if(path==='/rest/v1/media_news_articles')return response(missingArticle?[]:[{id:ID,canonical_url:'https://publisher.example/story',imported_at:'2026-10-18T00:00:00Z'}]);
      if(path==='/rest/v1/m_people')return response([{id:MUID,status:'active'}]);
      if(path==='/rest/v1/media_news_comments'){
        if(method==='POST'){
          const input=JSON.parse(options.body);writes.push(input);
          return response([{id:'44444444-4444-4444-8444-444444444444',...input}],201);
        }
        return response([]);
      }
      throw Error('unexpected Supabase call: '+path);
    };
    // Public GET gives first-party comments only; no publisher article is downloaded.
    let r=await handlePlatformApi(req(),env);
    assert.equal(r.status,200);
    assert.deepEqual((await r.json()).comments,[]);
    assert.equal(r.headers.get('cache-control'),'private, no-store');
    assert.ok(calls.every(x=>x.path!=='/story'));
    // A guest may not create content and cannot claim another member identity.
    r=await handlePlatformApi(new Request(COMMENT_URL,{method:'POST',headers:{'content-type':'application/json'},body:'{"body":"Guest"}'}),env);
    assert.equal(r.status,401);
    assert.equal(writes.length,0);
    r=await handlePlatformApi(req('POST',{body:'a'.repeat(1001)}),env);
    assert.equal(r.status,400);
    assert.equal(writes.length,0);
    r=await handlePlatformApi(req('POST',{body:'Our local take on the story'}),env);
    assert.equal(r.status,201);
    assert.equal(writes.length,1);
    assert.deepEqual(writes[0],{article_id:ID,author_m_uid:MUID,body:'Our local take on the story'});
    // A removed/pruned article cannot accept new discussion from any member.
    missingArticle=true;
    r=await handlePlatformApi(req('POST',{body:'This is now gone'}),env);
    assert.equal(r.status,404);
    assert.equal(writes.length,1);
  }finally{globalThis.fetch=original;}
});
