import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRegionScope, parseCountry, placeScopeEnabled, visitorCountry} from '../src/world-region-feed.js';

const MEMBER_A='11111111-1111-4111-8111-111111111111';
const MEMBER_B='22222222-2222-4222-8222-222222222222';
const POST_A='33333333-3333-4333-8333-333333333333';
const POST_B='44444444-4444-4444-8444-444444444444';
const SOURCE='55555555-5555-4555-8555-555555555555';
const NEWS='66666666-6666-4666-8666-666666666666';
const TIME='2026-10-19T21:15:00.000Z';
const ENV={WORLD_PLACE_SCOPE_ENABLED:'true',SUPABASE_URL:'https://sb.example',SUPABASE_SERVICE_ROLE_KEY:'test-service'};
const req=(path,cf,headers)=>{const request=new Request('https://api.mccluster.org'+path,{headers});if(cf)Object.defineProperty(request,'cf',{value:cf});return request;};
const json=(a,status=200)=>new Response(JSON.stringify(a),{status,headers:{'content-type':'application/json'}});
function store(calls,{unpublished=false,emptyNews=false,profile=true,removed=false,lives=null}={}){
  return async(url,init)=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://sb.example');
    assert.equal(init.headers.authorization,'Bearer test-service');
    calls.push(u);
    const table=u.pathname.split('/').pop();
    if(table==='network_posts')return json([
      {id:POST_A,author_m_uid:MEMBER_A,body:'Community action in Connecticut',country_code:'US',
       post_type:'post',visibility:'public',group_id:null,reply_to_id:null,created_at:TIME,like_count:7,
       metadata:{secret_internal:'do not expose',track:{title:'New Song'}},media:[{private_path:'never'}]},
      ...(removed?[{id:POST_B,author_m_uid:MEMBER_A,body:'taken down by the desk',country_code:'US',
        post_type:'post',visibility:'public',group_id:null,reply_to_id:null,created_at:TIME,
        removed_at:TIME,metadata:{},media:[]}]:[]),
      ...(unpublished?[{id:POST_B,author_m_uid:MEMBER_B,body:'private account leaked',
        country_code:'US',post_type:'post',visibility:'public',group_id:null,reply_to_id:null,
        created_at:TIME,metadata:{secret_internal:'no'},media:[]}]:[])
    ]);
    if(table==='network_profiles')return json(profile?[{m_uid:MEMBER_A,display_name:'Public person',visibility:'public',avatar_url:'',verification_state:'unverified'}]:[]);
    if(table==='media_news_articles')return json(emptyNews?[]:[{
      id:NEWS,source_id:SOURCE,title:'News mentioning New Haven',
      canonical_url:'https://newspaper.example/story',
      published_at:TIME,headline_location_label:'New Haven, Connecticut, United States',
      headline_latitude:41.3,headline_longitude:-72.9,location_country_fips:'US'
    }]);
    if(table==='media_news_sources')return json([{id:SOURCE,domain:'newspaper.example'}]);
    if(table==='network_live_sessions'&&lives)return json(lives);
    throw Error('Unexpected DB table '+table);
  };
}

test('country validation is ISO not arbitrary letters or GDELT FIPS',()=>{
  assert.equal(parseCountry('US'),'US');
  assert.equal(parseCountry('GB'),'GB');
  assert.equal(parseCountry('uk'),null);
  assert.equal(parseCountry('ZZ'),null);
  assert.equal(parseCountry('United States'),null);
});
test('visitor IP country is obtained only from Cloudflare request.cf, not forged headers',()=>{
  assert.equal(visitorCountry(req(REGION_STATUS,{country:'US'},{'CF-IPCountry':'GB'})),'US');
  assert.equal(visitorCountry(req(REGION_STATUS,undefined,{'CF-IPCountry':'US'})),null);
  assert.equal(visitorCountry(req(REGION_STATUS,{country:'T1'})),null);
});
test('disabled feature fails closed with zero Supabase reads',async()=>{
  const off={...ENV,WORLD_PLACE_SCOPE_ENABLED:'false'};
  let called=false;
  const status=await handleRegionScope(req(REGION_STATUS,{country:'US'}),off,{fetchImpl:()=>{called=true;}});
  assert.equal(status.status,200);
  assert.deepEqual((await status.json()).country,null);
  const feed=await handleRegionScope(req(REGION_FEED+'?country=US'),off,{fetchImpl:()=>{called=true;}});
  assert.equal(feed.status,503);assert.equal(called,false);
  assert.equal(placeScopeEnabled(ENV),true);assert.equal(placeScopeEnabled(off),false);
});
const REGION_STATUS='/v1/world/place-scope',REGION_FEED='/v1/world/region-feed';
test('invalid country, cursor and cap are rejected before the database read',async()=>{
  let count=0;const opts={fetchImpl:async()=>{count++;return json([]);}};
  for(const q of ['country=XX','country=uk','country=US&limit=1000','country=US&post_before=bad','country=US&news=0&posts=0']){
    const res=await handleRegionScope(req(REGION_FEED+'?'+q),ENV,opts);
    assert.equal(res.status,400,q);
  }
  assert.equal(count,0);
});
test('public country projection returns only visible profile, one explicit-tag post, classified news',async()=>{
  const calls=[];
  const res=await handleRegionScope(req(REGION_FEED+'?country=US'),ENV,{fetchImpl:store(calls,{unpublished:true})});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.ok,true);assert.equal(data.country,'US');
  assert.equal(data.posts.length,1);
  assert.equal(data.posts[0].post.body,'Community action in Connecticut');
  assert.equal(data.posts[0].post.country_code,'US');
  assert.equal(data.posts[0].post.media_locked,1);
  assert.equal(data.posts[0].actor.display_name,'Public person');
  assert.doesNotMatch(JSON.stringify(data),/secret_internal|private_path|private account leaked|author_m_uid|source_id/);
  assert.equal(data.news.length,1);
  assert.equal(data.news[0].location_basis,'article_mentions_place');
  assert.equal(data.news[0].domain,'newspaper.example');
  assert.ok(calls.some(u=>u.pathname.endsWith('/network_posts')&&u.searchParams.get('visibility')==='eq.public'));
  assert.ok(calls.some(u=>u.pathname.endsWith('/media_news_articles')&&u.searchParams.get('location_country_fips')==='eq.US'));
});
test('independent pagination never fetches an exhausted stream again',async()=>{
  const calls=[];
  const res=await handleRegionScope(req(REGION_FEED+'?country=US&posts=0&news_before='+encodeURIComponent(TIME+'~'+NEWS)),ENV,{fetchImpl:store(calls,{unpublished:true})});
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).posts,[]);
  assert.equal(calls.some(u=>u.pathname.endsWith('/network_posts')),false);
});
test('no public-profile match is treated as an empty region, not a fallback',async()=>{
  const calls=[];
  const res=await handleRegionScope(req(REGION_FEED+'?country=US'),ENV,{fetchImpl:store(calls,{profile:false,emptyNews:true})});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.deepEqual(data.posts,[]);
  assert.deepEqual(data.news,[]);
});
test('database unavailability returns explicit 503 and no global records',async()=>{
  const res=await handleRegionScope(req(REGION_FEED+'?country=US'),ENV,{fetchImpl:async()=>json({error:'missing migration'},404)});
  assert.equal(res.status,503);
  assert.equal((await res.json()).detail.available,false);
});

test('a post the desk removed never reaches a country feed, and like counts are the real ones',async()=>{
  const calls=[];
  const res=await handleRegionScope(req(REGION_FEED+'?country=US'),ENV,{fetchImpl:store(calls,{removed:true})});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.posts.length,1);
  assert.doesNotMatch(JSON.stringify(data),/taken down by the desk/);
  assert.equal(data.posts[0].post.like_count,7);
  const read=calls.find(u=>u.pathname.endsWith('/network_posts'));
  assert.equal(read.searchParams.get('removed_at'),'is.null');
  assert.match(read.searchParams.get('select'),/like_count/);
});

test('a country\'s feed leads with the lives its hosts placed there, without stream URLs or host ids',async()=>{
  const LIVE='77777777-7777-4777-8777-777777777777';
  const lives=[{id:LIVE,title:'Cleanup on air',room_kind:'mission',category_key:'field',started_at:TIME,host_m_uid:MEMBER_A,
    country_code:'US',status:'live',whep_url:'https://customer.example/SECRET/webRTC/play'},
    {id:'88888888-8888-4888-8888-888888888888',title:'Somewhere else',room_kind:'home',started_at:TIME,host_m_uid:MEMBER_B,country_code:'FR',status:'live'}];
  const calls=[],at={now:()=>Date.parse(TIME)};
  const body=await (await handleRegionScope(req(REGION_FEED+'?country=US'),ENV,{fetchImpl:store(calls,{lives}),...at})).json();
  assert.deepEqual(body.lives,[{id:LIVE,title:'Cleanup on air',room_kind:'mission',category_key:'field',started_at:TIME,
    country_code:'US',host:{display_name:'Public person',avatar_url:''}}]);
  assert.doesNotMatch(JSON.stringify(body.lives),/SECRET|whep|11111111-1111/);
  const q=calls.find(u=>u.pathname.endsWith('/network_live_sessions'));
  assert.equal(q.searchParams.get('country_code'),'eq.US');
  assert.equal(q.searchParams.get('status'),'eq.live');
  assert.equal(q.searchParams.get('last_seen_at'),'gt.2026-10-19T21:13:00.000Z','only broadcasts still beating');
  assert.doesNotMatch(q.searchParams.get('select'),/whep|cf_input/);
  calls.length=0;
  const more=await (await handleRegionScope(req(REGION_FEED+'?country=US&post_before='+encodeURIComponent(TIME+'~'+POST_A)),ENV,{fetchImpl:store(calls,{lives}),...at})).json();
  assert.deepEqual(more.lives,[],'later pages do not repeat the lives');
  assert.ok(!calls.some(u=>u.pathname.endsWith('/network_live_sessions')));
});

test('live places are counts per country of broadcasts on air, nothing else, and only with the flag on',async()=>{
  const off=await handleRegionScope(req('/v1/world/live-places'),{...ENV,WORLD_PLACE_SCOPE_ENABLED:'false'},{fetchImpl:()=>{throw Error('no read');}});
  assert.equal(off.status,503);
  const calls=[];
  const r=await handleRegionScope(req('/v1/world/live-places'),ENV,{now:()=>Date.parse(TIME),fetchImpl:async(url)=>{
    const u=new URL(url);calls.push(u);
    assert.equal(u.pathname,'/rest/v1/network_live_sessions');
    return json([{country_code:'US'},{country_code:'US'},{country_code:'FR'},{country_code:'ZZ'},{country_code:null}]);
  }});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,places:[{code:'FR',count:1},{code:'US',count:2}]});
  assert.equal(calls[0].searchParams.get('select'),'country_code');
  assert.equal(calls[0].searchParams.get('status'),'eq.live');
  assert.equal(calls[0].searchParams.get('last_seen_at'),'gt.2026-10-19T21:13:00.000Z');
});
