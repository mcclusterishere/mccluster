import test from 'node:test';
import assert from 'node:assert/strict';
import DATA from '../../../data/markets/company-leadership.json' with {type:'json'};
import {leadershipView,validateLeadershipReference} from '../src/finance/leadership.js';
import {handleIntelRequest} from '../src/intel/router.js';
import {IntelError} from '../src/intel/store.js';
const now=Date.parse('2026-11-11T12:00:00Z'),owner='11111111-1111-4111-8111-111111111111';
const env={FINANCE_DEV_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const req=path=>new Request('https://fixture.invalid/v1/intel/finance/'+path);
test('real reference contains five identified issuers, 130 public people and 135 dated roles without asserting ownership',()=>{
 const catalog=leadershipView({now});assert.equal(catalog.companies.length,5);assert.equal(catalog.ownership,'not_asserted');assert.equal(catalog.automatic_collection,false);
 assert.equal(catalog.companies.reduce((n,c)=>n+c.people_count,0),130);assert.equal(catalog.companies.reduce((n,c)=>n+c.role_count,0),135);
 for(const item of catalog.companies){const d=leadershipView({symbol:item.symbol,mic:item.mic,now});assert.equal(d.company.issuer_id,item.issuer_id);assert.ok(d.sources.length);for(const p of d.company.people)for(const r of p.roles){assert.equal(r.freshness.is_live,false);assert.equal(r.freshness.state,'recently_observed');for(const id of r.source_ids)assert.ok(d.sources.some(s=>s.id===id));}}
});
test('unknown listings and wrong MIC do not inherit names, roles or geocodes',()=>{
 for(const [symbol,mic] of [['UNKNOWN','XNYS'],['AMD','XNYS']]){const d=leadershipView({symbol,mic,now});assert.equal(d.status,'not_covered');assert.equal(d.company,null);}
 for(const args of [{symbol:'amd'},{symbol:'https://x'},{mic:'XNYS'},{symbol:'AMD',mic:'invalid'}])assert.throws(()=>leadershipView({...args,now}));
});
test('retrieval age does not become a live/current-role assertion; future changes stay separate',()=>{
 const stale=leadershipView({symbol:'CVX',now:now+31*86400000});assert.ok(stale.company.people.flatMap(x=>x.roles).every(x=>x.freshness.state==='review_due'));
 const future=leadershipView({symbol:'AMD',now:now-86400000});assert.equal(future.company.people[0].roles[0].freshness.state,'future_observation');
 const cvx=leadershipView({symbol:'CVX',now});assert.ok(cvx.company.scheduled_changes.every(c=>c.effective_at==='2027-01-01'));assert.ok(cvx.sources.some(s=>s.id==='cvx_2027_finance'));
 assert.ok(DATA.sources.some(s=>s.retrieval_method==='search_index_of_official_page'&&s.note));
});
test('strict import rejects private person locations, unknown source IDs, unsafe links, invalid dates and duplicate identities',()=>{
 for(const mutate of [d=>d.companies[0].ticker=['AMD'],d=>d.companies[0].mic=['XNAS'],d=>d.companies[0].cik=['0000002488'],d=>d.sources[0].url=[d.sources[0].url],d=>d.companies[0].people[0].latitude=1,d=>d.companies[0].listing_note={private_email:'private@example.com'},d=>d.companies[0].people[0].roles[0].date_note={home_lat:10},d=>d.sources[0].note={private_email:'private@example.com'},d=>d.companies[0].people[0].roles[0].source_ids=['amd_geocode'],d=>d.companies[0].headquarters.geolocation.type='headquarters_city_centroid',d=>d.companies[0].identity_source_ids=['t_sec_metadata'],d=>d.companies[0].people[0].email='private@example.com',d=>d.sources[0].url='javascript:alert(1)',d=>d.sources[0].url='https://amd.com.evil.invalid/test',d=>d.companies[0].people[0].roles[0].source_ids=['missing'],d=>d.retrieved_at='2026-02-30',d=>d.companies.push(structuredClone(d.companies[0]))]){const d=structuredClone(DATA);mutate(d);assert.throws(()=>validateLeadershipReference(d));}
});
test('canonical owner route works without provider keys or finance persistence and returns private/no-store',async()=>{
 const options={requireHouseOwner:async()=>({id:owner})};const r=await handleIntelRequest(req('leadership?symbol=AMD&mic=XNAS'),env,options);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal((await r.json()).company.ticker,'AMD');
 for(const path of ['leadership','leadership?symbol=AMD','leadership-quote?symbol=AMD&mic=XNAS']){assert.equal((await handleIntelRequest(req(path),env,{requireHouseOwner:async()=>{throw new IntelError('denied',403,'forbidden');}})).status,403);assert.equal((await handleIntelRequest(req(path),{...env,FINANCE_DEV_ENABLED:'false'},options)).status,404);}
 for(const query of ['symbol=AMD&symbol=T','url=https://example.com','mic=XNAS','symbol='])assert.equal((await handleIntelRequest(req('leadership?'+query),env,options)).status,400);
});
test('financial hover uses existing quote source, binds listing identity, and never writes orders',async()=>{
 let calls=0;const options={requireHouseOwner:async()=>({id:owner}),financeMarket:{quote:async(_env,symbol)=>{calls++;return {instrument:{symbol,mic:'XNAS'},bid:1,ask:2,as_of:'2026-11-11T12:00:00Z',feed:'iex',status:'stale',session:'closed'};}}};
 const r=await handleIntelRequest(req('leadership-quote?symbol=AMD&mic=XNAS'),env,options);assert.equal(r.status,200);const d=await r.json();assert.equal(d.quote.status,'stale');assert.equal(d.issuer_id,'sec:0000002488');assert.equal(calls,1);
 assert.equal((await handleIntelRequest(req('leadership-quote?symbol=AMD&mic=XNYS'),env,options)).status,404);assert.equal(calls,1);
 assert.equal((await handleIntelRequest(req('leadership-quote?symbol=CVX&mic=XNYS'),env,options)).status,409);
 assert.equal((await handleIntelRequest(req('leadership-quote?symbol=AMD'),env,options)).status,400);
 const closed=await handleIntelRequest(req('leadership-quote?symbol=AMD&mic=XNAS'),env,{requireHouseOwner:async()=>({id:owner})});assert.equal(closed.status,503);assert.match((await closed.json()).code,/needs_key|provider_disabled/);
});
