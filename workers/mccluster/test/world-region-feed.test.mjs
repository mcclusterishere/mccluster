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
function store(calls,{unpublished=false,emptyNews=false,profile=true,removed=false}={}){
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
