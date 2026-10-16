import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleFundingIntelligence, possibleMissionFamilies } from '../src/funding-intelligence.js';

const ENV = { ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const req = (suffix, method='GET') => new Request('https://api.mccluster.org/v1/control/funding'+suffix, {
  method, headers:{origin:'https://matthew.mccluster.org',authorization:'Bearer owner'}
});
const json = (body, status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const read = async (path) => path.startsWith('action_funding_opportunities') ?
  [{opportunity_id:'cthealth-trusted-messengers-2026',funder_name:'Connecticut Health Foundation',availability:'closed'}]:
  [{draft_id:'cthealth-phone-outreach',status:'draft',visibility:'admin_only',claim_enabled:false,compensation_cents:null},
   {draft_id:'bad-funded',status:'draft',visibility:'admin_only',claim_enabled:true,compensation_cents:500}];

test('the Worker dispatcher requires canonical house-owner authentication before funding handlers', async () => {
  const src = await readFile(new URL('../src/index.js',import.meta.url),'utf8');
  const entry = src.indexOf("if (path === FUNDING_PREFIX");
  assert.ok(entry>0, 'funding route registered');
  const before=src.slice(entry,entry+420);
  assert.match(before,/await requireHouseOwner\(request, env\)/);
  assert.match(before,/handleFundingIntelligence/);
});
test('catalog returns only safe private draft rows with no compensation',async()=>{
  const r=await handleFundingIntelligence(req('/catalog'),ENV,{read});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('cache-control'),'private, no-store');
  const data=await r.json();
  assert.equal(data.opportunities.length,1);
  assert.deepEqual(data.drafts.map(d=>d.draft_id),['cthealth-phone-outreach']);
  assert.equal(data.payout_enabled,false);
});
test('catalog missing migration fails visibly rather than creating fictitious records',async()=>{
  const r=await handleFundingIntelligence(req('/catalog'),ENV,{read:async()=>{throw Object.assign(new Error('relation missing'),{status:404})}});
  const data=await r.json();assert.equal(data.schema_state,'not_installed');assert.equal(data.ok,false);
  assert.deepEqual(data.drafts,[]);
});
test('invalid, overly long and malicious terms are rejected without provider calls',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('unexpected')};
  for(const keyword of ['','<script>','x'.repeat(91),'hello;DROP']) {
    const r=await handleFundingIntelligence(req('/search?keyword='+encodeURIComponent(keyword)),ENV,{fetchImpl});
    assert.equal(r.status,400,keyword);
  }
  assert.equal(calls,0);
});
test('live Grants.gov search uses fixed host and returns sourced, unclaimable suggestions',async()=>{
  let captured={};const fetchImpl=async(url,init)=>{
    captured={url,init};return json({errorcode:0,data:{hitCount:1,oppHits:[{
      id:12345,number:'HRSA-26-TEST',title:'Community Health Workforce Navigation',
      agencyName:'HHS',oppStatus:'posted',openDate:'10/15/2026',closeDate:'12/31/2026'
    }]}});
  };
  const r=await handleFundingIntelligence(req('/search?keyword='+encodeURIComponent('health workforce')),ENV,{fetchImpl});
  const data=await r.json();
  assert.equal(captured.url,'https://api.grants.gov/v1/api/search2');
  assert.equal(captured.init.redirect,'manual');
  assert.equal(JSON.parse(captured.init.body).oppStatuses,'posted|forecasted');
  assert.equal(data.items[0].funding_authorized,false);
  assert.deepEqual(data.items[0].suggested_mission_families,['health_resource_outreach','workforce_support']);
  assert.match(data.items[0].source_url,/grants\.gov/);
});
test('USAspending past awards are not conflated with open opportunity funding',async()=>{
  let body;const fetchImpl=async(url,init)=>{
    assert.equal(url,'https://api.usaspending.gov/api/v2/search/spending_by_award/');
    body=JSON.parse(init.body);
    return json({results:[{'Award ID':'X','Recipient Name':'Community Org','Award Amount':150000,
      Description:'Community green space restoration','Awarding Agency':'EPA'}]});
  };
  const r=await handleFundingIntelligence(req('/awards?keyword=green'),ENV,{fetchImpl});
  const data=await r.json();assert.equal(data.kind,'past_awards');
  assert.deepEqual(body.filters.award_type_codes,['02','03','04','05']);
  assert.deepEqual(body.filters.keywords,['green']);
  assert.equal(data.items[0].obligated_amount,150000);
  assert.equal(data.items[0].funding_authorized,false);
  assert.match(data.caveat,/Historical/);
});
test('provider failure reports unavailable instead of claiming zero opportunities',async()=>{
  const r=await handleFundingIntelligence(req('/search?keyword=health'),ENV,{fetchImpl:async()=>json({no:'bad'},503)});
  const data=await r.json();assert.equal(data.ok,false);assert.match(data.message,/unavailable/);
  assert.deepEqual(data.items,[]);
});
test('mutating funding API and unrelated paths fail closed',async()=>{
  const r=await handleFundingIntelligence(req('/catalog','POST'),ENV,{read});
  assert.equal(r.status,405);
  assert.equal(await handleFundingIntelligence(req('/not-here'),ENV,{read}),null);
});
