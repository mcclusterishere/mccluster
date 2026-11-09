/* Private contribution records for the shared company platform. No bank balance,
 * trust formation, ownership grant, custodial account or blockchain execution. */
import {SCHEMA, requireValue, canonical, digest, reduceCompany} from './domain.js';
import {createCompanyOperations} from './service.js';
import {isOrganizationCommand, applyOrganizationCommand, weeklyOrganizationReport, organizationWorkProposal} from './organization.js';
const id = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(x);
const text = (x, max = 1000) => typeof x === 'string' && x.length > 0 && x.length <= max && x.trim() === x && !/[\x00-\x1f]/.test(x);
const amount = (x, zero = false) => typeof x === 'string' && /^(0|[1-9][0-9]{0,35})$/.test(x) && (zero || x !== '0');
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
function shape(o, fields) {
  requireValue(o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === fields.split(' ').filter(Boolean).sort().join(','), 'ledger_invalid_fields');
}
const collection = () => ({schema:'shared-contribution-ledger/v1', legalEffect:'records_only', trustOrBankAccountCreated:false, participants:[], evidence:[], policies:[], contributions:[], valuations:[], reconciliations:[], proposals:[]});
function unique(rows,key) {requireValue(id(key) && !rows.some(r=>r.id===key),'ledger_id_exists',409);}
function get(rows,key) {const row=rows.find(r=>r.id===key);requireValue(row,'ledger_record_not_found',404);return row;}
function proof(l,key,kinds) {const d=get(l.evidence,key);requireValue(!kinds || kinds.includes(d.kind),'ledger_evidence_kind');return d;}
function human(ctx) {requireValue(ctx.human === true,'ledger_human_required',403);}
function independent(ctx,row) {human(ctx);requireValue(ctx.actorId !== row.recordedBy,'ledger_independent_review_required',403);}
function reviewedPolicy(l,key,current=false) {
  const p=get(l.policies,key);requireValue(p.status==='reviewed','ledger_policy_not_reviewed',409);
  if(current)requireValue(!l.policies.some(x=>x.status==='reviewed'&&x.supersedes===key),'ledger_policy_superseded',409);return p;
}
// Approval creates a permanent supersession edge. Disputing the latest record
// holds that lineage; it must NEVER revive an older contribution or handoff.
const previouslyAccepted = entry => ['accepted_record','disputed'].includes(entry.status);
export function effectiveContributions(l) {
  return l.contributions.filter(x=>x.status==='accepted_record'&&!l.contributions.some(y=>previouslyAccepted(y)&&y.supersedes===x.id));
}
function received(l,start,end) {return effectiveContributions(l).filter(x=>x.kind==='money'&&x.value.receiptState==='reported_received'&&x.occurredOn>=start&&x.occurredOn<=end).sort((a,b)=>a.id<b.id?-1:1);}
function reconciliationBasis(l,r) {return received(l,r.periodStart,r.periodEnd).map(x=>x.id);}
function freshReconciliation(l,r) {
  requireValue(canonical(reconciliationBasis(l,r))===canonical(r.entryIds),'ledger_reconciliation_stale',409);
}
function totals(rows) {
  const incoming=rows.filter(x=>x.value.flow==='incoming').reduce((n,x)=>n+BigInt(x.value.amountMinor),0n);
  const outgoing=rows.filter(x=>x.value.flow==='outgoing').reduce((n,x)=>n+BigInt(x.value.amountMinor),0n);
  return {incomingMinor:incoming.toString(),outgoingMinor:outgoing.toString()};
}
function proposalReady(l,p) {
  reviewedPolicy(l,p.policyId,true);const r=get(l.reconciliations,p.reconciliationId);freshReconciliation(l,r);
  requireValue(r.status==='reviewed_matched','ledger_reconciliation_not_matched',409);
}
function validateValue(kind,value,currency) {
  if(kind==='money') {
    shape(value,'amountMinor currency flow classification receiptState');
    requireValue(amount(value.amountMinor)&&value.currency===currency&&['incoming','outgoing'].includes(value.flow)&&['pledged','reported_received'].includes(value.receiptState),'ledger_invalid_money');
    requireValue(['gift','loan','expense','reimbursement','capital_contribution','unclassified'].includes(value.classification),'ledger_invalid_classification');
  } else if(kind==='work') {
    shape(value,'minutes workType');requireValue(Number.isSafeInteger(value.minutes)&&value.minutes>0&&value.minutes<=1000000&&text(value.workType,120),'ledger_invalid_work');
  } else if(kind==='asset') {
    shape(value,'quantity unit unitScale holdingBasis');requireValue(amount(value.quantity)&&text(value.unit,80)&&Number.isInteger(value.unitScale)&&value.unitScale>=0&&value.unitScale<=12&&['use_only','reported_transfer','unknown'].includes(value.holdingBasis),'ledger_invalid_asset');
  } else {shape(value,'');requireValue(kind==='activity','ledger_invalid_kind');}
}
export function reduceSharedLedger(current, command, context) {
  if(!command?.type?.startsWith('ledger_')&&!isOrganizationCommand(command?.type))return reduceCompany(current,command,context);
  requireValue(current?.schema===SCHEMA&&current.orgId===context.orgId&&current.companyId===context.companyId&&id(context.actorId),'scope_mismatch',403);
  requireValue(typeof context.at==='string'&&Number.isFinite(Date.parse(context.at))&&new Date(context.at).toISOString()===context.at,'invalid_server_time');
  shape(command,'id type data');requireValue(id(command.id)&&!current.records.some(x=>x.commandId===command.id),'duplicate_command',409);
  let state=structuredClone(current);const data=structuredClone(command.data),ctx=context;
  if(command.type==='ledger_register_arrangement') {
    shape(data,'name jurisdiction currency currencyExponent purpose');requireValue(text(data.purpose,2000),'ledger_invalid_purpose');
    state=reduceCompany(current,{id:command.id,type:'register_company',data:{name:data.name,form:'unknown',jurisdiction:data.jurisdiction,currency:data.currency,currencyExponent:data.currencyExponent}},context);
    state.ledger={...collection(),purpose:data.purpose};state.records.at(-1).type=command.type;return state;
  }
  requireValue(state.profile,'company_not_registered');
  if(command.type==='ledger_enable') {
    shape(data,'purpose');requireValue(!state.ledger&&text(data.purpose,2000),'ledger_already_enabled',409);human(ctx);state.ledger={...collection(),purpose:data.purpose};
  } else if(isOrganizationCommand(command.type)) {
    applyOrganizationCommand(state,command,context);
  } else {
    const l=state.ledger;requireValue(l?.schema==='shared-contribution-ledger/v1','ledger_not_configured',409);
    switch(command.type) {
      case 'ledger_record_participant': {
        shape(data,'id label');unique(l.participants,data.id);requireValue(text(data.label,160),'ledger_invalid_participant');
        l.participants.push({...data,recordedBy:ctx.actorId,recordedAt:ctx.at,accessGranted:false});break;
      }
      case 'ledger_record_evidence': {
        shape(data,'id kind artifactRef sha256 effectiveDate');unique(l.evidence,data.id);
        requireValue(id(data.artifactRef)&&typeof data.sha256==='string'&&/^[a-f0-9]{64}$/.test(data.sha256)&&date(data.effectiveDate)&&data.effectiveDate<=ctx.at.slice(0,10),'ledger_invalid_evidence');
        requireValue(['pledge','money_receipt','work_log','asset_record','valuation','rule_agreement','reconciliation','correction','legal_document','distribution_review','project_evidence'].includes(data.kind),'ledger_invalid_evidence_kind');
        l.evidence.push({...data,recordedBy:ctx.actorId,recordedAt:ctx.at});break;
      }
      case 'ledger_propose_policy': {
        shape(data,'id supersedes evidenceId moneyRule workRule assetRule distributionRule');unique(l.policies,data.id);human(ctx);proof(l,data.evidenceId,['rule_agreement']);
        for(const k of ['moneyRule','workRule','assetRule','distributionRule'])requireValue(text(data[k],2000),'ledger_invalid_policy');
        if(data.supersedes!==null)reviewedPolicy(l,data.supersedes,true);
        requireValue(data.supersedes!==null||!l.policies.some(x=>x.status==='reviewed'),'ledger_policy_predecessor_required',409);
        l.policies.push({...data,status:'proposed',recordedBy:ctx.actorId,recordedAt:ctx.at,automaticOwnership:false,automaticDistribution:false});break;
      }
      case 'ledger_review_policy': {
        shape(data,'policyId decision');const p=get(l.policies,data.policyId);independent(ctx,p);requireValue(p.status==='proposed'&&['approve','reject'].includes(data.decision),'ledger_invalid_review',409);
        if(data.decision==='approve') {
          if(p.supersedes!==null)reviewedPolicy(l,p.supersedes,true);
          requireValue(p.supersedes!==null||!l.policies.some(x=>x.status==='reviewed'),'ledger_policy_predecessor_required',409);
        }
        p.status=data.decision==='approve'?'reviewed':'rejected';p.review={actorId:ctx.actorId,at:ctx.at,decision:data.decision};break;
      }
      case 'ledger_record_contribution': {
        shape(data,'id partyRef kind occurredOn description evidenceId policyId value supersedes correctionReason');unique(l.contributions,data.id);get(l.participants,data.partyRef);reviewedPolicy(l,data.policyId,true);
        requireValue(date(data.occurredOn)&&data.occurredOn<=ctx.at.slice(0,10)&&text(data.description,2000),'ledger_invalid_contribution');
        validateValue(data.kind,data.value,state.profile.currency);
        const expectedKinds={money:data.value.receiptState==='pledged'?['pledge']:['money_receipt'],work:['work_log'],asset:['asset_record'],activity:['project_evidence','work_log']};
        proof(l,data.evidenceId,expectedKinds[data.kind]);
        if(data.supersedes!==null) {
          const old=get(l.contributions,data.supersedes);
          requireValue(['accepted_record','disputed'].includes(old.status)&&old.partyRef===data.partyRef&&old.kind===data.kind&&text(data.correctionReason,1000),'ledger_invalid_correction');
          requireValue(!l.contributions.some(x=>previouslyAccepted(x)&&x.supersedes===old.id),'ledger_correction_branch_conflict',409);
        }else requireValue(data.correctionReason===null,'ledger_unexpected_correction_reason');
        l.contributions.push({...data,status:'submitted',recordedBy:ctx.actorId,recordedAt:ctx.at,review:null});break;
      }
      case 'ledger_review_contribution': {
        shape(data,'contributionId decision note');const e=get(l.contributions,data.contributionId);independent(ctx,e);
        requireValue(e.status==='submitted'&&['approve','reject'].includes(data.decision)&&text(data.note,1000),'ledger_invalid_review',409);
        if(data.decision==='approve') {
          reviewedPolicy(l,e.policyId,true);
          if(e.supersedes!==null)requireValue(!l.contributions.some(x=>previouslyAccepted(x)&&x.supersedes===e.supersedes),'ledger_correction_branch_conflict',409);
        }
        e.status=data.decision==='approve'?'accepted_record':'rejected';e.review={actorId:ctx.actorId,at:ctx.at,decision:data.decision,note:data.note};break;
      }
      case 'ledger_dispute_contribution': {
        shape(data,'contributionId reason evidenceId');human(ctx);const e=get(l.contributions,data.contributionId);
        requireValue(e.status==='accepted_record'&&text(data.reason,1000),'ledger_invalid_dispute',409);proof(l,data.evidenceId,['correction']);
        e.status='disputed';e.dispute={...data,actorId:ctx.actorId,at:ctx.at};break;
      }
      case 'ledger_propose_valuation': {
        shape(data,'id contributionId supersedes amountMinor currency asOf evidenceId basis');unique(l.valuations,data.id);const e=get(l.contributions,data.contributionId);
        requireValue(effectiveContributions(l).some(x=>x.id===e.id)&&['work','asset'].includes(e.kind),'ledger_valuation_source_unavailable',409);
        requireValue(amount(data.amountMinor,true)&&data.currency===state.profile.currency&&date(data.asOf)&&data.asOf<=ctx.at.slice(0,10)&&text(data.basis,2000),'ledger_invalid_valuation');proof(l,data.evidenceId,['valuation']);
        const existing=l.valuations.filter(x=>x.contributionId===e.id&&x.status==='reviewed'&&!l.valuations.some(y=>y.status==='reviewed'&&y.supersedes===x.id));
        requireValue(existing.length===0?data.supersedes===null:existing.length===1&&data.supersedes===existing[0].id,'ledger_valuation_predecessor_required',409);
        l.valuations.push({...data,status:'proposed',recordedBy:ctx.actorId,recordedAt:ctx.at});break;
      }
      case 'ledger_review_valuation': {
        shape(data,'valuationId decision');const v=get(l.valuations,data.valuationId);independent(ctx,v);requireValue(v.status==='proposed'&&['approve','reject'].includes(data.decision),'ledger_invalid_review',409);
        if(data.decision==='approve') {
          requireValue(effectiveContributions(l).some(x=>x.id===v.contributionId),'ledger_valuation_source_unavailable',409);
          requireValue(!l.valuations.some(x=>x.status==='reviewed'&&x.contributionId===v.contributionId&&(v.supersedes===null||x.supersedes===v.supersedes)),'ledger_valuation_branch_conflict',409);
        }
        v.status=data.decision==='approve'?'reviewed':'rejected';v.review={actorId:ctx.actorId,at:ctx.at};break;
      }
      case 'ledger_record_reconciliation': {
        shape(data,'id periodStart periodEnd statementEvidence entryIds reportedIncomingMinor reportedOutgoingMinor');unique(l.reconciliations,data.id);
        requireValue(date(data.periodStart)&&date(data.periodEnd)&&data.periodStart<=data.periodEnd&&data.periodEnd<=ctx.at.slice(0,10)&&amount(data.reportedIncomingMinor,true)&&amount(data.reportedOutgoingMinor,true),'ledger_invalid_reconciliation');proof(l,data.statementEvidence,['reconciliation']);
        const rows=received(l,data.periodStart,data.periodEnd), ids=rows.map(x=>x.id);
        requireValue(Array.isArray(data.entryIds)&&canonical(data.entryIds)===canonical(ids),'ledger_reconciliation_entries_changed',409);
        const count=totals(rows);
        l.reconciliations.push({...data,recordedTotals:count,differences:{incomingMinor:(BigInt(data.reportedIncomingMinor)-BigInt(count.incomingMinor)).toString(),outgoingMinor:(BigInt(data.reportedOutgoingMinor)-BigInt(count.outgoingMinor)).toString()},status:'proposed',recordedBy:ctx.actorId,recordedAt:ctx.at});break;
      }
      case 'ledger_review_reconciliation': {
        shape(data,'reconciliationId decision note');const r=get(l.reconciliations,data.reconciliationId);independent(ctx,r);
        requireValue(r.status==='proposed'&&['approve','reject'].includes(data.decision)&&text(data.note,1000),'ledger_invalid_review',409);
        if(data.decision==='approve')freshReconciliation(l,r);
        r.status=data.decision==='reject'?'rejected':Object.values(r.differences).every(x=>x==='0')?'reviewed_matched':'reviewed_with_exceptions';r.review={actorId:ctx.actorId,at:ctx.at,note:data.note};break;
      }
      case 'ledger_propose_distribution': {
        shape(data,'id policyId reconciliationId amountMinor currency allocations purpose evidenceId');unique(l.proposals,data.id);proposalReady(l,data);proof(l,data.evidenceId,['distribution_review']);
        requireValue(amount(data.amountMinor)&&data.currency===state.profile.currency&&text(data.purpose,2000)&&Array.isArray(data.allocations)&&data.allocations.length>0&&data.allocations.length<=1000,'ledger_invalid_distribution');
        const seen=new Set();let sum=0n;
        for(const a of data.allocations){shape(a,'partyRef amountMinor');get(l.participants,a.partyRef);requireValue(!seen.has(a.partyRef)&&amount(a.amountMinor),'ledger_invalid_allocation');seen.add(a.partyRef);sum+=BigInt(a.amountMinor);}
        requireValue(sum===BigInt(data.amountMinor),'ledger_allocation_total_mismatch');
        l.proposals.push({...data,status:'proposed',recordedBy:ctx.actorId,recordedAt:ctx.at,executionEnabled:false,legalEffect:'none',handoff:null});break;
      }
      case 'ledger_review_distribution': {
        shape(data,'proposalId decision note');const p=get(l.proposals,data.proposalId);independent(ctx,p);
        requireValue(p.status==='proposed'&&['approve','reject'].includes(data.decision)&&text(data.note,1000),'ledger_invalid_review',409);
        if(data.decision==='approve')proposalReady(l,p);
        p.status=data.decision==='approve'?'reviewed_proposal':'rejected';p.review={actorId:ctx.actorId,at:ctx.at,note:data.note};break;
      }
      case 'ledger_prepare_handoff': {
        shape(data,'proposalId');const p=get(l.proposals,data.proposalId);proposalReady(l,p);
        requireValue(p.status==='reviewed_proposal'&&!p.handoff,'ledger_proposal_not_ready',409);
        p.handoff={id:command.id,recordedBy:ctx.actorId,recordedAt:ctx.at,status:'human_handoff_required'};break;
      }
      default: requireValue(false,'unsupported_command');
    }
    for(const key of ['participants','evidence','policies','contributions','valuations','reconciliations','proposals'])requireValue(l[key].length<=500,'ledger_capacity',409);
  }
  requireValue(state.records.length<2000,'workspace_capacity',409);state.revision++;
  state.records.push({commandId:command.id,type:command.type,actorId:ctx.actorId,at:ctx.at,revision:state.revision});return state;
}
export function contributionSummary(state) {
  const l=state.ledger;requireValue(l,'ledger_not_configured',409);const effective=effectiveContributions(l);
  const participants=l.participants.map(p=>{
    const rows=effective.filter(x=>x.partyRef===p.id),receivedMoney=rows.filter(x=>x.kind==='money'&&x.value.receiptState==='reported_received'),pledges=rows.filter(x=>x.kind==='money'&&x.value.receiptState==='pledged');
    return {partyRef:p.id,label:p.label,reportedMoney:totals(receivedMoney),pledgedMoney:totals(pledges),workMinutes:rows.filter(x=>x.kind==='work').reduce((n,x)=>n+x.value.minutes,0),
      assets:rows.filter(x=>x.kind==='asset').map(x=>({contributionId:x.id,...x.value})),activities:rows.filter(x=>x.kind==='activity').map(x=>({contributionId:x.id,description:x.description,occurredOn:x.occurredOn})),
      valuations:l.valuations.filter(x=>x.status==='reviewed'&&rows.some(e=>e.id===x.contributionId)&&!l.valuations.some(y=>y.status==='reviewed'&&y.supersedes===x.id)).map(x=>({contributionId:x.contributionId,amountMinor:x.amountMinor,currency:x.currency,asOf:x.asOf,basis:x.basis})),
      submittedCount:l.contributions.filter(x=>x.partyRef===p.id&&x.status==='submitted').length,disputedCount:l.contributions.filter(x=>x.partyRef===p.id&&x.status==='disputed').length};
  });
  return {schema:'shared-contribution-summary/v1',orgId:state.orgId,companyId:state.companyId,revision:state.revision,currency:state.profile.currency,currencyExponent:state.profile.currencyExponent,participants,
    bankBalance:null,ownershipGranted:false,trustOrBankAccountCreated:false,executionEnabled:false,warnings:['Accepted records are reviewed assertions, not verified bank balances','Hours, assets and valuations are not cash and are not summed into a grand total']};
}
export async function contributionHandoff(state,proposalId) {
  const p=get(state.ledger.proposals,proposalId);proposalReady(state.ledger,p);requireValue(p.status==='reviewed_proposal'&&p.handoff,'ledger_proposal_not_ready',409);
  const packet={schema:'shared-distribution-review-handoff/v1',orgId:state.orgId,companyId:state.companyId,proposal:structuredClone(p),currencyExponent:state.profile.currencyExponent,status:'human_handoff_required',executionEnabled:false,establishesLegalRights:false,
    warnings:['No payment, trust, bank account or entitlement created','Resolve custody, actual funds, recipient identity, legal basis, tax and per-action authorization separately']};
  return {...packet,packetSha256:await digest(packet)};
}
export function createSharedLedgerOperations(options) {
  const service=createCompanyOperations({...options,reducer:reduceSharedLedger,artifactCommandTypes:['record_document','ledger_record_evidence']});
  return {...service,summary:async(session,companyId)=>contributionSummary(await service.read(session,companyId)),
    contributionHandoff:async(session,companyId,proposalId)=>contributionHandoff(await service.read(session,companyId),proposalId),
    weeklyReport:async(session,companyId,period)=>weeklyOrganizationReport(await service.read(session,companyId),period),
    workProposal:async(session,companyId,taskLinkId)=>organizationWorkProposal(await service.read(session,companyId),taskLinkId)};
}
