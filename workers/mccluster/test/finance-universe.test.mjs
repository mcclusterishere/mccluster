import test from 'node:test';
import assert from 'node:assert/strict';
import DATA from '../../../data/markets/sec-listing-directory.json' with {type:'json'};
import PILOT from '../../../data/markets/sector-research-pilot.json' with {type:'json'};
import {universeSummary,universeView,validateUniverseReference,validateSectorPilot} from '../src/finance/universe.js';
import {handleIntelRequest} from '../src/intel/router.js';
import {IntelError} from '../src/intel/store.js';
const now=Date.parse('2026-11-11T12:00:00Z'),owner='11111111-1111-4111-8111-111111111111';
const env={FINANCE_DEV_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'},options={requireHouseOwner:async()=>({id:owner})};
const req=(path,method='GET')=>new Request('https://fixture.invalid/v1/intel/finance/'+path,{method});
test('full SEC association reference is sourced and does not masquerade as eligible or owned common stocks',()=>{
 const s=universeSummary({now});assert.equal(s.listing_count,10414);assert.equal(s.issuer_count,8009);assert.equal(s.eligible_count,null);assert.equal(s.confirmed_held_count,null);assert.equal(s.is_live,false);assert.equal(s.by_exchange.OTC,2568);assert.equal(s.by_exchange.UNKNOWN,172);
 const d=universeView({q:'AMD',exchange:'Nasdaq',now});assert.equal(d.items[0].listing_id,'sec:0000002488|Nasdaq|AMD');assert.equal(d.items[0].ownership,'not_asserted');assert.equal(d.items[0].direct_purchase_eligibility,'unknown');assert.equal(d.items[0].mic,undefined);
 assert.equal(universeView({exchange:'UNKNOWN',now}).total,172);assert.equal(universeView({q:'does-not-exist',now}).total,0);
});
test('pagination and query contracts bound work and keep source identity separate from ticker',()=>{
 const a=universeView({limit:50,offset:0}),b=universeView({limit:50,offset:50});assert.equal(a.items.length,50);assert.equal(b.items.length,50);assert.equal(new Set([...a.items,...b.items].map(x=>x.listing_id)).size,100);
 for(const input of [{q:['AMD']},{q:'x'.repeat(81)},{q:'a\u0000'},{exchange:'XNAS'},{exchange:['NYSE']},{scope:['directory']},{scope:'eligible'},{offset:-1},{offset:0.1},{offset:'0'},{limit:51},{limit:NaN}])assert.throws(()=>universeView(input));
 assert.equal(universeSummary({now:now+8*86400000}).freshness,'review_due');assert.equal(universeSummary({now:now-86400000}).freshness,'future_observation');
});
test('pilot spans eleven independent research buckets and retains international security distinctions',()=>{
 const p=universeView({scope:'sector_pilot',limit:50,now});assert.equal(p.total,18);assert.equal(new Set(p.items.map(x=>x.sector)).size,11);assert.ok(p.items.every(x=>x.held_quantity===null&&x.user_purchase_eligibility==='unreviewed'));
 assert.equal(p.items.find(x=>x.ticker==='ASML').security_type,'ordinary_registered_share');assert.equal(p.items.find(x=>x.ticker==='TSM').underlying_ordinary_shares_per_receipt,5);assert.equal(p.items.find(x=>x.ticker==='TM').underlying_ordinary_shares_per_receipt,10);
 assert.equal(p.items.find(x=>x.ticker==='AMD').country_of_incorporation,null);assert.equal(p.items.find(x=>x.ticker==='AMD').security_type,null);assert.match(p.sector_scheme.disclosure,/not GICS/);
});
test('directory imports reject unsafe shape, false counts, invalid dates, duplicate listings and private fields',()=>{
 for(const mutate of [d=>d.retrieved_at='2026-02-30T12:00:00Z',d=>d.source.sha256=['a'.repeat(64)],d=>d.source.note={account:'secret'},d=>d.listings[0].cik=[d.listings[0].cik],d=>d.listings[0].ticker=['AAPL'],d=>d.listings[0].quantity=1,d=>d.listings[0].listing_id=d.listings[1].listing_id,d=>d.listings[0].exchange='XNYS',d=>d.counts.distinct_ciks++,d=>d.listings.push(d.listings[0])]){const d=structuredClone(DATA);mutate(d);assert.throws(()=>validateUniverseReference(d));}
});
test('pilot refuses ownership/plan assertions, nested metadata, mismatched evidence and unsubstantiated ratios',()=>{
 for(const mutate of [d=>d.listings[0].recent_annual_filing.filed_at=[d.listings[0].recent_annual_filing.filed_at],d=>d.listings[0].recent_annual_filing.period_ended=[d.listings[0].recent_annual_filing.period_ended],d=>d.listings[0].held_quantity=2,d=>d.listings[0].user_purchase_eligibility='eligible',d=>d.listings[0].identity_note={home:'private'},d=>d.listings[0].sec_sic_source='https://data.sec.gov.evil.invalid/submissions/CIK0000002488.json',d=>d.listings[0].sec_sic_source='https://data.sec.gov/submissions/CIK0000320193.json',d=>d.listings[0].sec_sic=['3674'],d=>d.listings[0].name='Another entity',d=>d.listings.find(x=>x.ticker==='TSM').underlying_ordinary_shares_per_receipt=-1,d=>d.coverage.listing_count++]){const d=structuredClone(PILOT);mutate(d);assert.throws(()=>validateSectorPilot(d));}
});
test('dashboard/universe/economy remain owner-only, gated and private/no-store, with no trade or account writes',async()=>{
 let indicators=0;const opts={...options,indicatorClient:async input=>{indicators++;assert.equal(input.economy,'US');return {observations:[{is_live:false,frequency:'annual',period:'2025'}]};}};
 for(const path of ['dashboard','universe','economy']){const r=await handleIntelRequest(req(path),env,opts);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');if(path==='dashboard'){const d=await r.json();assert.equal(d.controls.trade_execution,false);assert.equal(d.controls.actual_holdings_storage,'not_connected');assert.equal(d.universe.confirmed_held_count,null);assert.equal(d.baseline.status,'unknown');}
 assert.equal((await handleIntelRequest(req(path),env,{requireHouseOwner:async()=>{throw new IntelError('denied',403,'forbidden');}})).status,403);assert.equal((await handleIntelRequest(req(path),{...env,FINANCE_DEV_ENABLED:'false'},opts)).status,404);assert.equal((await handleIntelRequest(req(path,'POST'),env,opts)).status,405);}
 assert.equal(indicators,1);
 for(const path of ['universe?limit=0','universe?limit=51','universe?offset=','universe?offset=NaN','universe?q=AMD&q=T','universe?owner_id=someone','dashboard?owner_id=someone','economy?economy=GB'])assert.equal((await handleIntelRequest(req(path),env,opts)).status,400,path);
});
