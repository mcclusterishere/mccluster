import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {disabledAdvertisingDecision,handleCustomerSiteAdvertising,AD_PLACEMENTS} from '../src/customer-site-advertising.js';
const A='11111111-1111-4111-8111-111111111111';
test('every architecture placement is disabled/no-fill without network, economics or arbitrary music interruption',async()=>{
 const contract=JSON.parse(await readFile(new URL('../../../data/site-advertising-contract.json',import.meta.url),'utf8'));
 assert.equal(contract.enabled,false);assert.deepEqual(Object.keys(AD_PLACEMENTS).sort(),contract.inventory.map(x=>x.placement).sort());
 for(const placement of Object.keys(AD_PLACEMENTS)){
  const d=disabledAdvertisingDecision({owner:A,kind:placement==='project_inline'?'project':'front',key:placement==='project_inline'?'alpha':'me',placement});
  assert.equal(d.status,'disabled');assert.equal(d.fill,null);assert.equal(d.provider,null);assert.equal(d.external_requests,0);assert.equal(d.economics,null);assert.equal(d.arbitrary_track_interruption,false);assert.equal(d.continue_content,true);assert.equal(d.domain_purchase_required,false);
 }
 assert.throws(()=>disabledAdvertisingDecision({owner:A,kind:'front',key:'me',placement:'in_track_interrupt'}),/Unknown/);
 assert.throws(()=>disabledAdvertisingDecision({owner:'-'.repeat(36),kind:'front',key:'me',placement:'profile_footer'}),/Invalid owned/);
 assert.throws(()=>disabledAdvertisingDecision({owner:A,kind:'project',key:'alpha',placement:'profile_footer'}),/website type/);
});
test('server owns tenant context and rejects cross-tenant, arbitrary provider and activation input',async()=>{
 let reads=0;const db={actor:async r=>{if(!r.headers.has('authorization'))throw Object.assign(Error('Sign in'),{status:401});return {auth_uid:A,m_uid:A};},select:async(t,f)=>{reads++;assert.equal(f.owner_user_id,'eq.'+A);return f.slug==='eq.alpha'?[{slug:'alpha'}]:[];}};
 const call=async(q,auth=true,method='GET')=>handleCustomerSiteAdvertising(new Request('https://api.mccluster.org/v1/customer-site/advertising?'+q,{method,headers:auth?{authorization:'Bearer fixture'}:{}}),{ADS_ENABLED:'true'},{db});
 assert.equal((await call('placement=profile_footer',false)).status,401);
 assert.equal((await call('project=other&placement=project_inline')).status,404);
 assert.equal((await call('project=alpha&placement=project_inline&enabled=true')).status,400);
 assert.equal((await call('project=alpha&placement=project_inline&provider=google')).status,400);
 assert.equal((await call('placement=profile_footer',true,'POST')).status,405);
 const response=await call('project=alpha&placement=project_inline');assert.equal(response.status,200);assert.equal((await response.json()).decision.status,'disabled');assert.equal(reads,2);
});
