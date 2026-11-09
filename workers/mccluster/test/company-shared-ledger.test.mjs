import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '../src/company-operations/domain.js';
import {replayCompany,createCompanyOperations} from '../src/company-operations/service.js';
import {reduceSharedLedger,contributionSummary,contributionHandoff} from '../src/company-operations/shared-ledger.js';
import {ledgerFixture,arrangement,evidence,policy,contribution,money,work,asset,reconciliation,distribution,ORG,OWNER,REVIEWER,COMPANY,SHA} from './company-operations/ledger-fixtures.mjs';
const change=(x,fn)=>{const y=structuredClone(x);fn(y);return y;};
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('synthetic ledger records cash, work and assets separately, without trust/custody/ownership',async()=>{
 const f=ledgerFixture();await f.prepare();const summary=await f.service.summary({},COMPANY),person=summary.participants[0];
 assert.deepEqual(person.reportedMoney,{incomingMinor:'10000',outgoingMinor:'0'});assert.equal(person.workMinutes,120);assert.equal(person.assets[0].quantity,'1');assert.equal(person.valuations.length,0);
 assert.equal(summary.bankBalance,null);assert.equal(summary.ownershipGranted,false);assert.equal(summary.trustOrBankAccountCreated,false);assert.equal(summary.executionEnabled,false);
 const packet=await f.service.contributionHandoff({},COMPANY,'proposal');assert.equal(packet.executionEnabled,false);const {packetSha256,...body}=packet;assert.equal(await digest(body),packetSha256);
 await rejects(()=>f.service.executePayment(),'human_handoff_required');
});
test('pledges are not received cash; submitted and rejected records are not accepted contributions',async()=>{
 const f=ledgerFixture();await f.setup();await f.command(money);let p=(await f.service.summary({},COMPANY)).participants[0];assert.equal(p.reportedMoney.incomingMinor,'0');assert.equal(p.submittedCount,1);
 await f.command({id:'reject',type:'ledger_review_contribution',data:{contributionId:'cash',decision:'reject',note:'Unsupported fictional receipt'}},{actorId:REVIEWER});
 const pledge=contribution('pledge-entry','money',{...money.data.value,receiptState:'pledged'});await f.command(pledge);await f.approve('pledge-entry');p=(await f.service.summary({},COMPANY)).participants[0];assert.equal(p.reportedMoney.incomingMinor,'0');assert.equal(p.pledgedMoney.incomingMinor,'10000');
});
test('recorded contributor, recorder and independent reviewer remain distinct identities',async()=>{
 const f=ledgerFixture();await f.setup();await f.command(work);await rejects(()=>f.command({id:'self-review',type:'ledger_review_contribution',data:{contributionId:'work-entry',decision:'approve',note:'Self review'}}),'ledger_independent_review_required');await f.approve('work-entry');
 const entry=(await f.service.read({},COMPANY)).ledger.contributions[0];assert.equal(entry.partyRef,'person-a');assert.equal(entry.recordedBy,OWNER);assert.equal(entry.review.actorId,REVIEWER);
});
test('AI cannot govern policies or approve contributions',async()=>{
 const f=ledgerFixture();await f.setup();await f.command(work);await rejects(()=>f.command({id:'ai-review',type:'ledger_review_contribution',data:{contributionId:'work-entry',decision:'approve',note:'AI assertion'}},{actorId:REVIEWER,human:false}),'ledger_human_required');
 await rejects(()=>f.command(change(policy,p=>{p.id='second';p.data.id='policy-v2';p.data.supersedes='policy-v1';}),{human:false}),'ledger_human_required');
});
test('evidence is tenant-bound immutable storage and its type matches the contribution',async()=>{
 const f=ledgerFixture({verifyArtifact:async()=>({orgId:'wrong',artifactRef:'artifact-rules',sha256:SHA,immutable:true})});await f.command(arrangement);await rejects(()=>f.command(evidence('rules','rule_agreement')),'artifact_scope_or_hash_mismatch');
 const g=ledgerFixture();await g.setup();await rejects(()=>g.command(change(work,p=>p.data.evidenceId='receipt')),'ledger_evidence_kind');
});
test('currency, whole-minute and asset units validation prevents mixed or coerced values',async()=>{
 const f=ledgerFixture();await f.setup();
 for(const c of [change(money,p=>p.data.value.currency='EUR'),change(money,p=>p.data.value.amountMinor=100),change(work,p=>p.data.value.minutes=1.5),change(asset,p=>p.data.value.quantity='-1')])await assert.rejects(()=>f.command(c));
});
test('approved corrections preserve history and replace totals only after review',async()=>{
 const f=ledgerFixture();await f.setup();await f.command(money);await f.approve('cash');
 const correction=change(money,p=>{p.id='correct';p.data.id='cash-corrected';p.data.supersedes='cash';p.data.correctionReason='Corrected fictional units';p.data.value.amountMinor='9000';});await f.command(correction);
 assert.equal((await f.service.summary({},COMPANY)).participants[0].reportedMoney.incomingMinor,'10000');await f.approve('cash-corrected');
 assert.equal((await f.service.summary({},COMPANY)).participants[0].reportedMoney.incomingMinor,'9000');assert.equal((await f.service.read({},COMPANY)).ledger.contributions.length,2);
 await rejects(()=>f.command(change(correction,p=>{p.id='fork';p.data.id='fork';})),'ledger_correction_branch_conflict');
});
test('disputes suspend accepted record totals and block stale distribution handoff',async()=>{
 const f=ledgerFixture();await f.prepare();await f.command({id:'dispute',type:'ledger_dispute_contribution',data:{contributionId:'cash',reason:'Unresolved synthetic receipt',evidenceId:'correction'}});
 assert.equal((await f.service.summary({},COMPANY)).participants[0].reportedMoney.incomingMinor,'0');await rejects(()=>f.service.contributionHandoff({},COMPANY,'proposal'),'ledger_reconciliation_stale');
});
test('valuations are separate reviewed estimates, not money, hours or ownership',async()=>{
 const f=ledgerFixture();await f.setup();await f.command(work);await f.approve('work-entry');
 await f.command({id:'valuation',type:'ledger_propose_valuation',data:{id:'valuation-v1',contributionId:'work-entry',supersedes:null,amountMinor:'8000',currency:'USD',asOf:'2026-11-09',evidenceId:'valuation',basis:'Fictional separately agreed estimate'}});
 await f.command({id:'review-valuation',type:'ledger_review_valuation',data:{valuationId:'valuation-v1',decision:'approve'}},{actorId:REVIEWER});const p=(await f.service.summary({},COMPANY)).participants[0];assert.equal(p.workMinutes,120);assert.equal(p.reportedMoney.incomingMinor,'0');assert.equal(p.valuations[0].amountMinor,'8000');
});
test('new reviewed policy makes stale proposed contributions and old distribution rules ineligible',async()=>{
 const f=ledgerFixture();await f.prepare();await f.command(change(policy,p=>{p.id='second-policy';p.data.id='policy-v2';p.data.supersedes='policy-v1';}));await f.command({id:'review-policy-v2',type:'ledger_review_policy',data:{policyId:'policy-v2',decision:'approve'}},{actorId:REVIEWER});
 await rejects(()=>f.command(change(work,p=>{p.id='other-work';p.data.id='other-work';})),'ledger_policy_superseded');await rejects(()=>f.service.contributionHandoff({},COMPANY,'proposal'),'ledger_policy_superseded');
 assert.equal((await f.service.summary({},COMPANY)).participants[0].workMinutes,120);
});
test('reconciliation requires the complete accepted received-money period, no hidden omissions',async()=>{
 const f=ledgerFixture();await f.setup();await f.command(money);await f.approve('cash');await rejects(()=>f.command(change(reconciliation,p=>p.data.entryIds=[])),'ledger_reconciliation_entries_changed');
 await f.command(change(reconciliation,p=>p.data.reportedIncomingMinor='9999'));await f.command({id:'review-reconciliation',type:'ledger_review_reconciliation',data:{reconciliationId:'reconciliation',decision:'approve',note:'Difference not resolved'}},{actorId:REVIEWER});
 const r=(await f.service.read({},COMPANY)).ledger.reconciliations[0];assert.equal(r.status,'reviewed_with_exceptions');assert.equal(r.differences.incomingMinor,'-1');await rejects(()=>f.command(distribution),'ledger_reconciliation_not_matched');
});
test('late accepted entries invalidate reconciliation review and distribution handoff',async()=>{
 const f=ledgerFixture();await f.prepare();const other=change(money,p=>{p.id='late';p.data.id='late';});await f.command(other);await f.approve('late');await rejects(()=>f.service.contributionHandoff({},COMPANY,'proposal'),'ledger_reconciliation_stale');
});
test('manual distribution allocations must exactly conserve money and identify known participants',async()=>{
 const f=ledgerFixture();await f.prepare();await rejects(()=>f.command(change(distribution,p=>{p.id='other';p.data.id='other';p.data.allocations[0].amountMinor='999';})),'ledger_allocation_total_mismatch');
 await rejects(()=>f.command(change(distribution,p=>{p.id='other';p.data.id='other';p.data.allocations[0].partyRef='unknown';})),'ledger_record_not_found');
});
test('existing event store and exact replay preserve the full contribution history after restart',async()=>{
 const f=ledgerFixture();await f.prepare();const events=await f.store.read({orgId:ORG},COMPANY);const replay=await replayCompany(ORG,COMPANY,events,reduceSharedLedger);assert.deepEqual(replay.state,await f.service.read({},COMPANY));
 await rejects(()=>replayCompany(ORG,COMPANY,events),'history_schema_or_record_invalid');
 const response=await f.command(arrangement);assert.equal(response.replay,true);assert.equal(response.appliedRevision,1);
});
test('ordinary members cannot reach owner-only architecture until a separately scoped ingress exists',async()=>{
 const f=ledgerFixture();await f.setup();await rejects(()=>f.service.summary({role:'member'},COMPANY),'owner_required');
});
test('disputing a correction never resurrects old money, old handoff or cousin branches',async()=>{
 const f=ledgerFixture();await f.prepare();
 const correction=(id,supersedes,amount)=>change(money,p=>{p.id='correct-'+id;p.data.id=id;p.data.supersedes=supersedes;p.data.correctionReason='Correct synthetic lineage';p.data.value.amountMinor=amount;});
 await f.command(correction('b','cash','9000'));await f.approve('b');
 await f.command({id:'dispute-b',type:'ledger_dispute_contribution',data:{contributionId:'b',reason:'Question corrected receipt',evidenceId:'correction'}});
 assert.equal((await f.service.summary({},COMPANY)).participants[0].reportedMoney.incomingMinor,'0');await rejects(()=>f.service.contributionHandoff({},COMPANY,'proposal'),'ledger_reconciliation_stale');
 await rejects(()=>f.command(correction('c','cash','8000')),'ledger_correction_branch_conflict');
 await f.command(correction('d','b','7000'));await f.approve('d');assert.equal((await f.service.summary({},COMPANY)).participants[0].reportedMoney.incomingMinor,'7000');
 await rejects(()=>f.command(correction('cousin','b','6000')),'ledger_correction_branch_conflict');
 await rejects(()=>f.service.contributionHandoff({},COMPANY,'proposal'),'ledger_reconciliation_stale');
});
test('a pending sibling correction cannot be approved after another correction is disputed',async()=>{
 const f=ledgerFixture();await f.setup();await f.command(money);await f.approve('cash');
 for(const id of ['b','c'])await f.command(change(money,p=>{p.id=id;p.data.id=id;p.data.supersedes='cash';p.data.correctionReason='Pending correction';p.data.value.amountMinor='5000';}));
 await f.approve('b');await f.command({id:'dispute',type:'ledger_dispute_contribution',data:{contributionId:'b',reason:'Hold this lineage',evidenceId:'correction'}});await rejects(()=>f.approve('c'),'ledger_correction_branch_conflict');
 await f.command({id:'reject-c',type:'ledger_review_contribution',data:{contributionId:'c',decision:'reject',note:'Close stale competing correction'}},{actorId:REVIEWER});
});
test('stale contributions, valuations, reconciliations and distributions can still be rejected',async()=>{
 const f=ledgerFixture();await f.setup();await f.command(money);await f.approve('cash');await f.command(work);await f.approve('work-entry');
 await f.command(change(work,p=>{p.id='pending-work';p.data.id='pending-work';}));
 await f.command({id:'valuation',type:'ledger_propose_valuation',data:{id:'valuation',contributionId:'work-entry',supersedes:null,amountMinor:'8000',currency:'USD',asOf:'2026-11-09',evidenceId:'valuation',basis:'Fictional estimate'}});
 await f.command(reconciliation);await f.command(change(reconciliation,p=>{p.id='pending-recon';p.data.id='pending-recon';}));
 await f.command({id:'review-recon',type:'ledger_review_reconciliation',data:{reconciliationId:'reconciliation',decision:'approve',note:'Matched records'}},{actorId:REVIEWER});await f.command(distribution);
 await f.command({id:'dispute-cash',type:'ledger_dispute_contribution',data:{contributionId:'cash',reason:'Receipt disputed',evidenceId:'correction'}});
 await f.command({id:'dispute-work',type:'ledger_dispute_contribution',data:{contributionId:'work-entry',reason:'Work disputed',evidenceId:'correction'}});
 await f.command(change(policy,p=>{p.id='new-policy';p.data.id='policy-v2';p.data.supersedes='policy-v1';}));await f.command({id:'review-v2',type:'ledger_review_policy',data:{policyId:'policy-v2',decision:'approve'}},{actorId:REVIEWER});
 for(const [type,key,id]of [['ledger_review_contribution','contributionId','pending-work'],['ledger_review_valuation','valuationId','valuation'],['ledger_review_reconciliation','reconciliationId','pending-recon'],['ledger_review_distribution','proposalId','proposal']]){
   const data={[key]:id,decision:'reject'};if(type!=='ledger_review_valuation')data.note='Close stale proposal without approving it';await f.command({id:'reject-'+id,type,data},{actorId:REVIEWER});
 }
 const l=(await f.service.read({},COMPANY)).ledger;for(const [rows,id]of [[l.contributions,'pending-work'],[l.valuations,'valuation'],[l.reconciliations,'pending-recon'],[l.proposals,'proposal']])assert.equal(rows.find(x=>x.id===id).status,'rejected');
});
test('base company histories upgrade to the extension without changing records or handoff state',async()=>{
 const {fixture}=await import('./company-operations/fixtures.mjs');const f=fixture();await f.prepare('handoff');const events=await f.store.read({orgId:ORG},COMPANY);
 assert.deepEqual((await replayCompany(ORG,COMPANY,events,reduceSharedLedger)).state,await f.service.read({},COMPANY));
});
