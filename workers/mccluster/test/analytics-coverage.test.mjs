import test from 'node:test';
import assert from 'node:assert/strict';
import {dataCoverage,DATASETS} from '../src/analytics/coverage.js';
import {businessSnapshot,answerBusinessQuestion} from '../src/analytics/router.js';
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'};
const reply=(body,status=200,count=0)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','content-range':'0-0/'+count}});

test('dataset health separates empty, missing, quiet, failed-window and populated results with bounded reads',async()=>{
 const calls=[];let active=0,peak=0;
 const result=await dataCoverage(env,'house',new URL('https://api.test/?since=2026-10-16&until=2026-10-17'),{now:new Date('2026-10-17'),fetchImpl:async raw=>{
   const u=new URL(raw),d=DATASETS.find(d=>u.pathname.endsWith('/'+d.table));calls.push(u);peak=Math.max(peak,++active);
   await new Promise(r=>setTimeout(r,1));active--;
   if(d.key==='spatial_entities')return reply({code:'PGRST205'},404);
   if(d.key==='claims'&&u.searchParams.getAll(d.time).length)return reply({code:'PGRST205'},404);
   if(d.key==='evidence')return reply([],200,0);
   if(d.key==='headlines'&&u.searchParams.getAll(d.time).length)return reply({},503);
   return reply([{[d.time]:d.key==='ingest_records'?'2026-10-02':'2026-10-16T23:00:00Z'}],200,12);
 }});
 const by=Object.fromEntries(result.datasets.map(d=>[d.key,d]));
 assert.equal(by.evidence.state,'empty');assert.equal(by.evidence.count,0);
 assert.equal(by.spatial_entities.state,'missing');assert.equal(by.spatial_entities.count,null);
 assert.equal(by.ingest_records.state,'quiet');assert.equal(by.headlines.count,12);
 assert.equal(by.headlines.window_count,null);assert.equal(by.headlines.window_status,'unavailable');
 assert.equal(by.claims.window_status,'missing');assert.equal(result.summary.unavailable,3);
 assert.equal(by.events.state,'populated');assert.ok(peak<=3);
 for(const d of DATASETS.filter(d=>d.orgScoped))assert.ok(calls.filter(u=>u.pathname.endsWith('/'+d.table)).every(u=>u.searchParams.get('org_id')==='eq.house'));
 assert.ok(calls.filter(u=>u.pathname.endsWith('/events_lean')).every(u=>u.searchParams.get('site_id')==='is.null'&&u.searchParams.get('is_bot')==='not.is.true'));
 assert.ok(calls.every(u=>u.searchParams.get('select')&&!/payload|props|email/.test(u.searchParams.get('select'))));
});
test('invalid range does not perform any database reads',async()=>{
 let calls=0;
 await assert.rejects(dataCoverage(env,'house',new URL('https://api.test/?since=bad&until=2026-10-17'),{fetchImpl:()=>calls++}),/valid since/);
 assert.equal(calls,0);
});
test('business snapshot retains unrelated measurements when one source fails and never converts missing music totals to zero',async()=>{
 const original=globalThis.fetch;let active=0,peak=0;
 globalThis.fetch=async raw=>{
   const u=new URL(raw),table=u.pathname.split('/').pop();peak=Math.max(peak,++active);
   await new Promise(r=>setTimeout(r,1));active--;
   if(u.pathname.includes('/auth/'))return reply({users:[]});
   if(table==='orgs')return reply([{id:'house'}]);
   if(table==='network_posts')return reply({},503);
   if(table==='events_lean'){
     assert.equal(u.searchParams.get('site_id'),'is.null');assert.equal(u.searchParams.get('is_bot'),'not.is.true');
     if(u.searchParams.get('name')==='eq.album_play')return reply({},503);
   }
   return reply([],200,7);
 };
 try{
   const result=await businessSnapshot(env,{since:'2026-10-16T00:00:00Z',until:'2026-10-17T00:00:00Z'});
   assert.equal(result.partial,true);assert.equal(result.mnet.posts.total,null);
   assert.equal(result.mnet.follows.total,7);assert.equal(result.music.inline_plays.total,7);
   assert.equal(result.music.plays.total,null);assert.equal(result.music.plays.in_window,null);
   assert.ok(result.read_errors.postsTotal);assert.ok(peak<=4);
 }finally{globalThis.fetch=original;}
});

test('business answers preserve failed revenue and count reads as unavailable, and measured zero as zero',()=>{
 for(const window of [null,{label:'24 hours'}]){
  const snapshot={window,music:{revenue:{gross_cents:null,gross_cents_in_window:null,platform_fee_cents:null,platform_fee_cents_in_window:null},plays:{total:null,in_window:null}},platform:{page_views:{total:null,in_window:null}},mnet:{posts:{total:null,created_in_window:null}}};
  for(const question of ['music revenue','platform music revenue','music plays','page views','Mnet posts']){
   const out=answerBusinessQuestion(question,snapshot);
   assert.equal(out.value,null);assert.equal(out.available,false);assert.match(out.answer,/unavailable/);assert.doesNotMatch(out.answer,/\$0\.00|null plays|null.*posts/);
  }
  snapshot.music.revenue.gross_cents=0;snapshot.music.revenue.gross_cents_in_window=0;
  const out=answerBusinessQuestion('music revenue',snapshot);assert.equal(out.value,0);assert.match(out.answer,/\$0\.00/);
 }
});
