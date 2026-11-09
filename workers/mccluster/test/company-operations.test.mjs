import test from 'node:test';
import assert from 'node:assert/strict';
import {allocate, canonical, reduceCompany, emptyCompany, accountingProposal} from '../src/company-operations/domain.js';
import {createCompanyOperations, replayCompany} from '../src/company-operations/service.js';
import {handleCompanyOperations, createSupabaseCompanyStore} from '../src/company-operations/adapter.js';
import {fixture, ORG, OTHER_ORG, OWNER, REVIEWER, COMPANY, AT, SHA, register, document, ownership, draft, review, declare} from './company-operations/fixtures.mjs';
const rejects=(fn,code)=>assert.rejects(fn,error=>error.code===code);
const changed=(v,fn)=>{const c=structuredClone(v);fn(c);return c;};
test('exact allocation conserves value beyond JS safe integers and has stable tie-breaking',()=>{
 const holdings=[{partyRef:'b',units:'1'},{partyRef:'a',units:'1'},{partyRef:'c',units:'1'}];
 assert.deepEqual(allocate('2',holdings).map(x=>x.amountMinor),['1','1','0']);
 assert.deepEqual(allocate('2',holdings),allocate('2',[...holdings].reverse()));
 const total='999999999999999999999999999999999999';
 assert.equal(allocate(total,holdings).reduce((a,r)=>a+BigInt(r.amountMinor),0n),BigInt(total));
});
test('allocation rejects duplicate parties, fractional money, numeric coercion, negative and zero',()=>{
 for(const n of ['-1','1.5','01','0',1,NaN])assert.throws(()=>allocate(n,[{partyRef:'a',units:'1'}]));
 assert.throws(()=>allocate('1',[{partyRef:'a',units:'1'},{partyRef:'a',units:'2'}]));
});
test('full synthetic workflow persists, restarts and prepares a disabled provider-neutral handoff',async()=>{
 const f=fixture(); await f.prepare('handoff');
 const packet=await f.service.handoff({},COMPANY,'declaration');
 assert.equal(packet.totalMinor,'100'); assert.deepEqual(packet.allocations.map(x=>x.amountMinor),['33','67']);
 assert.equal(packet.executionEnabled,false); assert.equal(packet.accountingProposal.posted,false); assert.match(packet.packetSha256,/^[a-f0-9]{64}$/);
 const replay=await replayCompany(ORG,COMPANY,await f.store.read({orgId:ORG},COMPANY));
 assert.deepEqual(replay.state,await f.service.read({},COMPANY));
 await rejects(()=>f.service.executePayment(),'human_handoff_required');
});
test('every operation reauthorizes; a revoked owner loses read, write and handoff',async()=>{
 const f=fixture();await f.prepare('handoff');f.revoke();
 for(const action of [()=>f.service.read({},COMPANY),()=>f.command(register),()=>f.service.handoff({},COMPANY,'declaration')])await rejects(action,'owner_required');
});
test('ordinary admin has no inferred ownership authority',async()=>{
 const f=fixture();await rejects(()=>f.service.read({role:'admin'},COMPANY),'owner_required');
});
test('two installations and companies keep identical command identifiers isolated',async()=>{
 const f=fixture();await f.command(register);await f.command(register,{orgId:OTHER_ORG});
 assert.equal((await f.service.read({},COMPANY)).revision,1);
 assert.equal((await f.service.read({orgId:OTHER_ORG},COMPANY)).revision,1);
 assert.equal((await f.service.read({},'00000000-0000-4000-8000-000000000022')).revision,0);
});
test('identical command retry is stable even when the expected revision is stale',async()=>{
 const f=fixture();await f.command(register);
 const result=await f.service.command({},COMPANY,{expectedRevision:0,command:register});
 assert.equal(result.replay,true);assert.equal(result.appliedRevision,1);assert.equal(result.state.revision,1);
});
test('changed payload and changed actor cannot reuse an idempotency key',async()=>{
 const f=fixture();await f.command(register);
 await rejects(()=>f.command(changed(register,x=>x.data.name='Different')),'idempotency_conflict');
 await rejects(()=>f.command(register,{actorId:REVIEWER}),'idempotency_conflict');
});
test('concurrent writes have a single revision winner',async()=>{
 const f=fixture();const results=await Promise.allSettled([register,changed(register,x=>x.id='other')].map(command=>f.service.command({},COMPANY,{expectedRevision:0,command})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await f.service.read({},COMPANY)).revision,1);
});
test('lost append response reconciles by the same key without duplication',async()=>{
 const f=fixture();let lose=true;const old=f.store.append;
 f.store.append=async(...args)=>{const result=await old(...args);if(lose){lose=false;throw new Error('lost response');}return result;};
 await assert.rejects(()=>f.command(register),/lost response/);
 assert.equal((await f.command(register)).replay,true);assert.equal((await f.service.read({},COMPANY)).revision,1);
});
test('history mutation is detected before rendering or appending',async()=>{
 const f=fixture();await f.command(register);f.events.get(ORG+':'+COMPANY)[0].command.data.name='tampered';
 await rejects(()=>f.service.read({},COMPANY),'history_integrity_failed');
});
test('replay rejects cross-company and cross-tenant history',async()=>{
 const f=fixture();await f.command(register);const events=await f.store.read({orgId:ORG},COMPANY);
 await rejects(()=>replayCompany(OTHER_ORG,COMPANY,events),'history_integrity_failed');
 await rejects(()=>replayCompany(ORG,'different',events),'history_integrity_failed');
});
test('artifact reference must belong to tenant and match immutable recorded bytes',async()=>{
 for(const delta of [{orgId:OTHER_ORG},{sha256:'b'.repeat(64)},{immutable:false},{artifactRef:'foreign'}]){
  const f=fixture({verifyArtifact:async(p,r)=>({orgId:p.orgId,artifactRef:r,sha256:SHA,immutable:true,...delta})});
  await f.command(register);await rejects(()=>f.command(document('doc','charter')),'artifact_scope_or_hash_mismatch');
 }
});
test('no artifact verifier fails closed rather than trusting client metadata',async()=>{
 const f=fixture({verifyArtifact:undefined});await f.command(register);await rejects(()=>f.command(document('doc','charter')),'artifact_verifier_unavailable');
});
test('nonprofit and unknown entities cannot draft shareholder payouts',async()=>{
 for(const form of ['nonprofit','unknown','llc']){
  const f=fixture();await f.command(changed(register,x=>x.data.form=form));
  await rejects(()=>f.command(draft),'entity_distribution_review_required');
 }
});
test('LLC member-distribution record uses the same reusable engine',async()=>{
 const f=fixture();await f.command(changed(register,x=>x.data.form='llc'));await f.command(document('register-doc','ownership_register'));await f.command(ownership);
 const result=await f.command(changed(draft,x=>x.data.kind='member_distribution'));assert.equal(result.state.declarations[0].status,'draft');
});
test('ownership totals, authorized limits, duplicate classes and unsupported rights are checked',async()=>{
 for(const mutate of [x=>x.data.classes[0].outstandingUnits='4',x=>x.data.classes[0].authorizedUnits='2',x=>x.data.classes.push(x.data.classes[0])]){
  const f=fixture();await f.command(register);await f.command(document('register-doc','ownership_register'));await assert.rejects(()=>f.command(changed(ownership,mutate)));
 }
 const f=fixture();await f.command(register);await f.command(document('register-doc','ownership_register'));await f.command(changed(ownership,x=>x.data.classes[0].allocationBasis='unsupported'));
 await rejects(()=>f.command(draft),'unsupported_distribution_rights');
});
test('record-date eligibility is a frozen exact-date snapshot, not current holdings',async()=>{
 const f=fixture();await f.prepare();await rejects(()=>f.command(changed(draft,x=>{x.id='other';x.data.id='other';x.data.recordDate='2026-11-08';})),'record_date_snapshot_required');
});
test('parallel snapshot assertions for the same date require an explicit correction',async()=>{
 const f=fixture();await f.prepare();await rejects(()=>f.command(changed(ownership,x=>{x.id='other';x.data.id='other';})),'correction_reference_required');
});
test('snapshot correction prevents stale review, declaration and handoff reuse',async()=>{
 for(const stage of ['in_review','reviewed','handoff']){
  const f=fixture();await f.prepare(stage);await f.command(changed(ownership,x=>{x.id='correction';x.data.id='snapshot-2';x.data.supersedes='snapshot';}));
  const action=stage==='in_review'?()=>f.command(review,{actorId:REVIEWER}):stage==='reviewed'?()=>f.command(declare):()=>f.service.handoff({},COMPANY,'declaration');
  await rejects(action,'snapshot_superseded');
 }
});
test('review requires separate human identity and current immutable terms revision',async()=>{
 const f=fixture();await f.prepare('in_review');await rejects(()=>f.command(review),'independent_human_review_required');
 await rejects(()=>f.command(review,{actorId:REVIEWER,human:false}),'independent_human_review_required');
 await rejects(()=>f.command(changed(review,x=>x.data.termsRevision=2),{actorId:REVIEWER}),'stale_review');
});
test('a declaration cannot bypass human review or resolution evidence',async()=>{
 const f=fixture();await f.prepare();await rejects(()=>f.command(declare),'review_required');
 await f.command({id:'submit',type:'submit_declaration_review',data:{declarationId:'declaration'}});await f.command(review,{actorId:REVIEWER});
 await rejects(()=>f.command(changed(declare,x=>x.data.resolutionDocument='legal')),'evidence_missing_or_wrong_kind');
 await rejects(()=>f.command(declare,{human:false}),'human_recording_required');
});
test('rejected and void declarations cannot become executable or lose original evidence',async()=>{
 const f=fixture();await f.prepare('handoff');const before=await f.service.read({},COMPANY);
 await f.command({id:'void',type:'void_declaration_record',data:{declarationId:'declaration',reason:'Synthetic correction',correctionDocument:'correction'}});
 const after=await f.service.read({},COMPANY);assert.deepEqual(after.declarations[0].declarationRecord,before.declarations[0].declarationRecord);
 await rejects(()=>f.service.handoff({},COMPANY,'declaration'),'handoff_unavailable');
 assert.throws(()=>accountingProposal(after,'declaration'));
});
test('unknown commands, spoofed fields and non-ISO dates are rejected',async()=>{
 const f=fixture();await rejects(()=>f.command({...register,actorId:REVIEWER}),'unknown_or_missing_fields');
 await rejects(()=>f.command(changed(register,x=>x.type='send_payment')),'company_not_registered');
 await f.command(register);await rejects(()=>f.command(changed(document('x','charter'),x=>x.data.effectiveDate='2026-02-30')),'invalid_document');
});
test('original caller objects cannot mutate persisted or returned records',async()=>{
 const f=fixture();const input=structuredClone(register),result=await f.command(input);input.data.name='tampered';result.state.profile.name='tampered';
 assert.equal((await f.service.read({},COMPANY)).profile.name,register.data.name);
});
test('canonical command digest is independent of object-key order',()=>assert.equal(canonical({z:1,a:{y:true,x:'x'}}),canonical({a:{x:'x',y:true},z:1})));
test('adapter is default-off and every response including failure is private/no-store',async()=>{
 const response=await handleCompanyOperations(new Request('https://local.invalid/'));
 assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('HTTP adapter drives the real service with identity outside request body',async()=>{
 const f=fixture();const response=await handleCompanyOperations(new Request('https://local.invalid/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:0,command:register})}),{enabled:true,service:f.service,companyId:COMPANY});
 assert.equal(response.status,200);assert.equal((await response.json()).value.state.profile.name,register.data.name);
 const denied=await handleCompanyOperations(new Request('https://local.invalid/?orgId=foreign'),{enabled:true,service:f.service,companyId:COMPANY});assert.equal(denied.status,400);
});
test('HTTP adapter rejects oversized streaming bodies, malformed JSON and unsupported methods',async()=>{
 const f=fixture(),options={enabled:true,service:f.service,companyId:COMPANY};
 for(const [body,status]of [['x'.repeat(103000),413],['{',400]]){
 const r=await handleCompanyOperations(new Request('https://local.invalid/',{method:'POST',headers:{'content-type':'application/json'},body}),options);assert.equal(r.status,status);}
 assert.equal((await handleCompanyOperations(new Request('https://local.invalid/',{method:'DELETE'}),options)).status,405);
});
test('database adapter preserves canonical RPC scope and translates missing-schema failure',async()=>{
 let called;const store=createSupabaseCompanyStore({},async(env,name,args)=>{called={name,args};return [];});
 await store.read({orgId:ORG,actorId:OWNER},COMPANY);assert.equal(called.name,'company_operations_read_v1');assert.equal(called.args.p_org,ORG);
 const absent=createSupabaseCompanyStore({},async()=>{throw {code:'intel_schema_not_ready'};});await rejects(()=>absent.read({orgId:ORG,actorId:OWNER},COMPANY),'company_schema_not_applied');
});
test('currency and document hashes reject JSON coercion',async()=>{
 for(const currency of [['USD'],{toString:'USD'},null]){const f=fixture();await rejects(()=>f.command(changed(register,x=>x.data.currency=currency)),'invalid_currency');}
 assert.throws(()=>reduceCompany({...emptyCompany(ORG,COMPANY),profile:register.data},changed(document('x','charter'),x=>x.data.sha256=[SHA]),{orgId:ORG,companyId:COMPANY,actorId:OWNER,at:AT,human:true}));
});
test('accounting proposal rejects corrected ownership and packet digest covers the full artifact',async()=>{
 const f=fixture();await f.prepare('handoff');const packet=await f.service.handoff({},COMPANY,'declaration');
 const {packetSha256,...body}=packet;const {digest}=await import('../src/company-operations/domain.js');assert.equal(await digest(body),packetSha256);
 await f.command(changed(ownership,x=>{x.id='correction';x.data.id='snapshot-2';x.data.supersedes='snapshot';}));
 const state=await f.service.read({},COMPANY);assert.throws(()=>accountingProposal(state,'declaration'),e=>e.code==='snapshot_superseded');
});
