import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES, boundedJson, collectWdi, collectBls, collectSec, collectAlpaca,
  observeLayerOne, sourceReadiness, layerOneStatus
} from '../src/market/layer-one.mjs';

const NOW = new Date('2026-10-21T18:00:00.000Z');
const response = body => new Response(JSON.stringify(body), { status:200, headers:{'content-type':'application/json'} });
const wdiPayload = [[{pages:1,lastupdated:'2026-10-20'}][0], [
  {indicator:{id:'SP.POP.TOTL'},country:{id:'US',value:'United States'},
    countryiso3code:'USA',date:'2024',value:333000000},
  {indicator:{id:'NY.GDP.MKTP.KD.ZG'},country:{id:'US',value:'United States'},
    countryiso3code:'USA',date:'2024',value:2.3},
  {indicator:{id:'SP.POP.TOTL'},country:{id:'US'},countryiso3code:'USA',date:'2026',value:999}
]];
const fakeDb = ({onCall=()=>{}, connector={enabled:true,last_sync_at:null}}={}) => ({
  org:async()=> '00000000-0000-4000-8000-000000000001',
  ensure:async (...a)=>onCall('ensure',a),
  rows:async (url)=> { onCall('rows',[url]); return url.includes('ops_ingest_connectors')?[connector]:[]; },
  rpc:async (name,args)=>{onCall(name,args);return name==='market_layer1_policy_ready_service'?true:name.includes('begin_run')?
    {id:'00000000-0000-4000-8000-000000000002'}:{ok:true};}
});

test('source catalog is bounded and registered independently from existing news and quake authorities',()=>{
  assert.deepEqual(SOURCES.map(x=>x.key), ['market.wdi','market.bls','market.sec','market.alpaca.iex']);
  assert.ok(SOURCES.every(x=>x.terms.startsWith('https://') && x.retentionDays > 0));
});

test('market credentials and market data storage permissions fail closed',()=>{
  assert.equal(sourceReadiness('market.alpaca.iex',{}),'needs_market_data_license_review');
  assert.equal(sourceReadiness('market.alpaca.iex',{MCCLUSTER_MARKET_ALPACA_STORAGE_APPROVED:'true'}),'needs_alpaca_credentials');
  assert.equal(sourceReadiness('market.sec',{}),'needs_sec_ciks_and_user_agent');
  assert.equal(sourceReadiness('market.sec',{MCCLUSTER_MARKET_SEC_CIKS:'10', MCCLUSTER_MARKET_SEC_USER_AGENT:'NoEmailHere'}),'invalid_sec_user_agent');
  assert.equal(sourceReadiness('market.wdi',{}),'ready');
});

test('bounded fetch refuses other origins, redirects, errors and oversize provider bodies',async()=>{
  let calls=0;
  await assert.rejects(boundedJson('https://bad.example.com/json',{fetchImpl:async()=>{calls++;return response({});}}),/provider_url_not_allowed/);
  assert.equal(calls,0);
  await assert.rejects(boundedJson('https://api.worldbank.org/foo',{fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://bad.example.com/'}})}),/provider_redirect_rejected/);
  await assert.rejects(boundedJson('https://api.worldbank.org/foo',{fetchImpl:async()=>new Response('x'.repeat(300)) ,maxBytes:100}),/provider_body_too_large/);
  await assert.rejects(boundedJson('https://api.worldbank.org/foo',{fetchImpl:async()=>new Response('not-json')}),/provider_invalid_json/);
});

test('World Bank retains real periods, negative GDP growth, geography, and ignores incomplete current years',async()=>{
  const got=await collectWdi({env:{MCCLUSTER_MARKET_ECONOMIES:'US'}, now:NOW,fetchImpl:async()=>response(wdiPayload)});
  assert.equal(got.length,2);
  assert.equal(got[0].external_id,'US:SP.POP.TOTL:2024');
  assert.equal(got[1].payload.unit,'percent');
  assert.equal(got[0].payload.is_real_time,false);
  assert.equal(got[0].observed_at,'2024-12-31T12:00:00.000Z');
  assert.ok(!JSON.stringify(got).includes('2026-12-31'));
  const negatives=structuredClone(wdiPayload);negatives[1][1].value=-1.1;
  assert.equal((await collectWdi({env:{MCCLUSTER_MARKET_ECONOMIES:'US'},now:NOW,fetchImpl:async()=>response(negatives)}))[1].payload.value,-1.1);
  const wrong=structuredClone(wdiPayload);wrong[1][0].country.id='CN';
  await assert.rejects(collectWdi({env:{MCCLUSTER_MARKET_ECONOMIES:'US'},now:NOW,fetchImpl:async()=>response(wrong)}),/wdi_geography_mismatch/);
});

test('BLS identifies monthly observations, skips annual averages and future months',async()=>{
  const data={status:'REQUEST_SUCCEEDED',Results:{series:[{seriesID:'CUUR0000SA0',data:[
    {year:'2026',period:'M09',value:'327.5',footnotes:[{code:'P'}]},
    {year:'2026',period:'M13',value:'300'},
    {year:'2026',period:'M12',value:'330'},
    {year:'2025',period:'M12',value:'320.1'}]}]}};
  const got=await collectBls({now:NOW,fetchImpl:async()=>response(data)});
  assert.equal(got.length,2);
  assert.equal(got[0].payload.period,'2026-09');
  assert.equal(got[0].payload.provisional,true);
  assert.equal(got[0].payload.unit,'index');
});

test('SEC requires a declared operator, validates CIK, and reads filing metadata only',async()=>{
  const env={MCCLUSTER_MARKET_SEC_CIKS:'320193',MCCLUSTER_MARKET_SEC_USER_AGENT:'McCluster Corp admin@example.org'};
  const got=await collectSec({now:NOW,env,fetchImpl:async(url,opt)=>{
    assert.ok(opt.headers['user-agent'].includes('@')); assert.ok(url.includes('CIK0000320193.json'));
    return response({cik:320193,name:'Example Issuer',filings:{recent:{
      form:['8-K','4'],accessionNumber:['0000320193-26-000001','0000320193-26-000002'],filingDate:['2026-10-20','2026-10-20']
    }}});
  }});
  assert.equal(got.length,1);
  assert.equal(got[0].payload.form,'8-K');
  assert.equal(got[0].payload.observed_time_kind,'filing_date');
});

test('Alpaca is labelled IEX-only; source ref and stored payload omit credentials',async()=>{
  const env={MCCLUSTER_MARKET_ALPACA_STORAGE_APPROVED:'true',
    APCA_API_KEY_ID:'secret-id',APCA_API_SECRET_KEY:'secret-value',MCCLUSTER_MARKET_SYMBOLS:'SPY'};
  const got=await collectAlpaca({env,now:NOW,fetchImpl:async(url,opt)=>{
    assert.equal(opt.headers['APCA-API-SECRET-KEY'],'secret-value');
    assert.ok(url.includes('feed=iex'));
    return response({bars:{SPY:{t:'2026-10-21T17:59:00Z',o:550,h:552,l:549,c:551,v:10000}}});
  }});
  assert.equal(got.length,1);
  assert.equal(got[0].payload.coverage,'partial_US_market_not_consolidated');
  assert.ok(!JSON.stringify(got).includes('secret-value'));
  assert.ok(!JSON.stringify(got).includes('secret-id'));
});

test('disabled flag performs no database or network writes',async()=>{
  let calls=0;
  const result=await observeLayerOne({env:{},db:{org:async()=>{calls++;}},fetchImpl:async()=>{calls++;}});
  assert.equal(result.status,'disabled');
  assert.equal(calls,0);
});

test('missing DB policy migration blocks ingestion before writing any rows',async()=>{
  let calls=0;
  const result=await observeLayerOne({env:{MCCLUSTER_MARKET_LAYER1_ENABLED:'true'},
    db:{rpc:async()=>false,org:async()=>{calls++;}},fetchImpl:async()=>{calls++;}});
  assert.equal(result.status,'blocked');
  assert.equal(result.reason,'policy_migration_not_applied');
  assert.equal(calls,0);
});

test('successful ingestion uses the canonical begin/write/finish functions and fixed provenance',async()=>{
  const calls=[];
  const db=fakeDb({onCall:(name,payload)=>calls.push([name,payload])});
  const result=await observeLayerOne({db,source:'market.wdi',now:NOW,
    env:{MCCLUSTER_MARKET_LAYER1_ENABLED:'true',MCCLUSTER_MARKET_ECONOMIES:'US'},
    fetchImpl:async()=>response(wdiPayload)});
  assert.equal(result.sources[0].status,'succeeded');
  assert.equal(result.sources[0].records_seen,2);
  assert.equal(calls.filter(x=>x[0]==='ops_ingest_write_record_service').length,2);
  assert.equal(calls.find(x=>x[0]==='ops_ingest_begin_run_service')[1].p_connector_key,'market.wdi');
  assert.equal(calls.find(x=>x[0]==='ops_ingest_finish_run_service')[1].p_status,'succeeded');
  assert.equal(calls.filter(x=>x[0]==='ensure').length,1);
});

test('upstream outage records a failed run without advancing the source cursor',async()=>{
  const calls=[];
  const result=await observeLayerOne({db:fakeDb({onCall:(k,p)=>calls.push([k,p])}),source:'market.wdi',
    now:NOW,env:{MCCLUSTER_MARKET_LAYER1_ENABLED:'true',MCCLUSTER_MARKET_ECONOMIES:'US'},
    fetchImpl:async()=>new Response('',{status:503})});
  assert.equal(result.status,'partial');
  assert.equal(result.sources[0].reason,'provider_http_503');
  const finish=calls.find(x=>x[0]==='ops_ingest_finish_run_service')[1];
  assert.equal(finish.p_status,'failed'); assert.equal(finish.p_cursor_after,undefined);
});

test('owner-disabled source never creates a run and freshness defers duplicate requests',async()=>{
  const calls=[];
  const config={MCCLUSTER_MARKET_LAYER1_ENABLED:'true',MCCLUSTER_MARKET_ECONOMIES:'US'};
  const run=(connector)=>observeLayerOne({db:fakeDb({connector,onCall:(a)=>calls.push(a)}),
    now:NOW,env:config,source:'market.wdi',fetchImpl:async()=>{throw new Error('should not fetch');}});
  assert.equal((await run({enabled:false,last_sync_at:null})).sources[0].status,'disabled_by_owner');
  assert.equal((await run({enabled:true,last_sync_at:'2026-10-21T17:59:00Z'})).sources[0].status,'not_due');
  assert.ok(!calls.includes('ops_ingest_begin_run_service'));
});

test('read-only status includes existing pipelines, with explicit coverage and blocked provider states',async()=>{
  const status=await layerOneStatus({now:NOW,env:{},db:{
    org:async()=> '00000000-0000-4000-8000-000000000001',
    rows:async url=>url.includes('media_news_articles')?[{imported_at:'2026-10-21T17:45:00Z'}]:[
      {connector_key:'usgs.earthquakes',enabled:true,last_ok_at:'2026-10-21T17:59:00Z'}]
  }});
  assert.equal(status.enabled,false);
  assert.equal(status.sources.find(x=>x.source==='world.gdelt').status,'existing_pipeline');
  assert.equal(status.sources.find(x=>x.source==='market.alpaca.iex').status,'blocked');
  assert.equal(status.sources.find(x=>x.source==='market.wdi').status,'not_registered');
});
