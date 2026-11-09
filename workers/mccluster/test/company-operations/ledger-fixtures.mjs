import {fixture,ORG,OWNER,REVIEWER,COMPANY,AT,SHA} from './fixtures.mjs';
import {createSharedLedgerOperations} from '../../src/company-operations/shared-ledger.js';
export {ORG,OWNER,REVIEWER,COMPANY,AT,SHA};
export const arrangement={id:'arrangement',type:'ledger_register_arrangement',data:{name:'Synthetic Shared Records',jurisdiction:'US-CT',currency:'USD',currencyExponent:2,purpose:'Record fictional shared contributions and review only'}};
export const evidence=(id,kind)=>({id:'evidence-'+id,type:'ledger_record_evidence',data:{id,kind,artifactRef:'artifact-'+id,sha256:SHA,effectiveDate:'2026-11-09'}});
export const policy={id:'policy',type:'ledger_propose_policy',data:{id:'policy-v1',supersedes:null,evidenceId:'rules',moneyRule:'Record money separately; no ownership granted',workRule:'Record minutes and independent work review',assetRule:'Record quantities and separately reviewed valuation',distributionRule:'Manual reviewed proposal and human handoff only'}};
export const contribution=(id,kind,value,extra={})=>({id:'record-'+id,type:'ledger_record_contribution',data:{id,partyRef:'person-a',kind,occurredOn:'2026-11-09',description:'Synthetic '+kind+' record',evidenceId:kind==='money'?(value.receiptState==='pledged'?'pledge':'receipt'):kind==='work'?'work':kind==='asset'?'asset':'activity',policyId:'policy-v1',value,supersedes:null,correctionReason:null,...extra}});
export const money=contribution('cash','money',{amountMinor:'10000',currency:'USD',flow:'incoming',classification:'unclassified',receiptState:'reported_received'});
export const work=contribution('work-entry','work',{minutes:120,workType:'engineering'});
export const asset=contribution('asset-entry','asset',{quantity:'1',unit:'computer',unitScale:0,holdingBasis:'use_only'});
export const reconciliation={id:'reconcile',type:'ledger_record_reconciliation',data:{id:'reconciliation',periodStart:'2026-11-09',periodEnd:'2026-11-09',statementEvidence:'statement',entryIds:['cash'],reportedIncomingMinor:'10000',reportedOutgoingMinor:'0'}};
export const distribution={id:'distribute',type:'ledger_propose_distribution',data:{id:'proposal',policyId:'policy-v1',reconciliationId:'reconciliation',amountMinor:'1500',currency:'USD',allocations:[{partyRef:'person-a',amountMinor:'1000'},{partyRef:'person-b',amountMinor:'500'}],purpose:'Synthetic review proposal, not a transfer',evidenceId:'distribution'}};
export function ledgerFixture(options={}) {
  const f=fixture(),service=createSharedLedgerOperations({store:f.store,authorize:async s=>({orgId:s?.orgId||ORG,actorId:s?.actorId||OWNER,role:s?.role||'owner',enabled:true,human:s?.human!==false}),verifyArtifact:async(p,r)=>({orgId:p.orgId,artifactRef:r,sha256:SHA,immutable:true}),now:()=>AT,...options});
  const command=async(c,s={})=>service.command(s,COMPANY,{expectedRevision:(await service.read(s,COMPANY)).revision,command:structuredClone(c)});
  const approve=async(id)=>command({id:'approve-'+id,type:'ledger_review_contribution',data:{contributionId:id,decision:'approve',note:'Synthetic evidence review recorded'}},{actorId:REVIEWER});
  const setup=async()=>{
    await command(arrangement);
    for(const [id,kind]of [['rules','rule_agreement'],['receipt','money_receipt'],['pledge','pledge'],['work','work_log'],['asset','asset_record'],['activity','project_evidence'],['valuation','valuation'],['statement','reconciliation'],['correction','correction'],['distribution','distribution_review']])await command(evidence(id,kind));
    for(const id of ['person-a','person-b'])await command({id:'participant-'+id,type:'ledger_record_participant',data:{id,label:'Synthetic '+id}});
    await command(policy);await command({id:'review-policy',type:'ledger_review_policy',data:{policyId:'policy-v1',decision:'approve'}},{actorId:REVIEWER});
  };
  const prepare=async()=>{await setup();for(const c of [money,work,asset]){await command(c);await approve(c.data.id);}await command(reconciliation);await command({id:'review-reconciliation',type:'ledger_review_reconciliation',data:{reconciliationId:'reconciliation',decision:'approve',note:'Compared operator-supplied records, no bank verification'}},{actorId:REVIEWER});await command(distribution);await command({id:'review-distribution',type:'ledger_review_distribution',data:{proposalId:'proposal',decision:'approve',note:'Review proposal only'}},{actorId:REVIEWER});await command({id:'handoff',type:'ledger_prepare_handoff',data:{proposalId:'proposal'}});};
  return {...f,service,command,setup,approve,prepare};
}
