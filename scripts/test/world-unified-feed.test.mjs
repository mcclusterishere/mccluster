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

test('news comment availability is disabled until BOTH the flag and the database table are ready',{concurrency:false},async()=>{
  const original=globalThis.fetch, calls=[];
  try{
    const url='https://api.mccluster.org/v1/world/news/comments-capability';
    globalThis.fetch=async resource=>{
      calls.push(new URL(String(resource)).pathname);
      return response([],200);
    };
    let res=await handlePlatformApi(new Request(url),{...env,WORLD_NEWS_COMMENTS_ENABLED:'false'});
    assert.deepEqual(await res.json(),{available:false});
    assert.equal(calls.length,0,'flag OFF must not probe a pending schema');
    res=await handlePlatformApi(new Request(url),env);
    assert.deepEqual(await res.json(),{available:true});
    assert.equal(calls.length,1,'ready schema requires one controlled existence check');
    globalThis.fetch=async resource=>{
      calls.push(new URL(String(resource)).pathname);
      return response({code:'42P01',message:'relation missing'},404);
    };
    res=await handlePlatformApi(new Request(url),env);
    assert.deepEqual(await res.json(),{available:false});
    assert.match(res.headers.get('cache-control'),/no-store/);
  }finally{globalThis.fetch=original;}
});

test('batch comment visibility checks apply both directions of blocking in only two lookups',{concurrency:false},async()=>{
  const original=globalThis.fetch,calls=[];
  const blockedByMe='44444444-4444-4444-8444-444444444444';
  const blockedMe='55555555-5555-4555-8555-555555555555';
  const publicAuthor='66666666-6666-4666-8666-666666666666';
  const comments=[
    {id:'77777777-7777-4777-8777-777777777777',author_m_uid:MUID,body:'My own comment',created_at:'2026-10-18T12:00:00Z',article_id:ID},
    {id:'88888888-8888-4888-8888-888888888888',author_m_uid:blockedByMe,body:'Hidden one',created_at:'2026-10-18T12:01:00Z',article_id:ID},
    {id:'99999999-9999-4999-8999-999999999999',author_m_uid:blockedMe,body:'Hidden two',created_at:'2026-10-18T12:02:00Z',article_id:ID},
    {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',author_m_uid:publicAuthor,body:'Visible friend',created_at:'2026-10-18T12:03:00Z',article_id:ID}
  ];
  try{
    globalThis.fetch=async (resource,options={})=>{
      const url=new URL(String(resource)),p=url.pathname;calls.push({path:p,search:url.search});
      if(p==='/auth/v1/user')return response({id:AUTH});
      if(p==='/rest/v1/m_auth_user_links'){
        if(url.searchParams.has('auth_user_id'))return response([{m_uid:MUID}]);
        return response([]);
      }
      if(p==='/rest/v1/media_news_articles')return response([{id:ID,canonical_url:'https://publisher.example/story'}]);
      if(p==='/rest/v1/media_news_comments')return response(comments);
      if(p==='/rest/v1/network_blocks'){
        if(url.searchParams.get('blocker_m_uid')==='eq.'+MUID)
          return response([{blocked_m_uid:blockedByMe}]);
        if(url.searchParams.get('blocked_m_uid')==='eq.'+MUID)
          return response([{blocker_m_uid:blockedMe}]);
        throw Error('unexpected block query');
      }
      if(p==='/rest/v1/network_profiles')return response([]);
      if(p==='/rest/v1/platform_profiles')return response([]);
      throw Error('unexpected query '+p);
    };
    const reqAuth=new Request(COMMENT_URL,{method:'GET',headers:{authorization:'Bearer test-user-token'}});
    const res=await handlePlatformApi(reqAuth,env);
    assert.equal(res.status,200);
    const data=await res.json();
    assert.deepEqual(data.comments.map(x=>x.body),['My own comment','Visible friend']);
    const blockCalls=calls.filter(x=>x.path==='/rest/v1/network_blocks');
    assert.equal(blockCalls.length,2,'100 replies must not trigger 200 serial queries');
    assert.ok(blockCalls.every(x=>x.search.includes('in.(')),'lookup is limited to displayed authors');
  }finally{globalThis.fetch=original;}
});
