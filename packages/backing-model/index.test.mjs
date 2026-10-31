import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBacking } from './index.mjs';
const project = {id:'demo',transactionType:'rewards_backing',fundingRule:'all_or_nothing',currency:'USD',targetCents:10000,opensAt:'2026-10-01T00:00:00Z',deadline:'2026-11-01T00:00:00Z',collectionDeadline:'2026-11-08T00:00:00Z',reward:{kind:'digital_good',financialReturn:false}};
const event=(type,id,fields={})=>({type,id,projectId:'demo',currency:'USD',at:'2026-10-15T00:00:00Z',...fields});
const pledge=event('pledge','p1',{pledgeId:'backer1',amountCents:12000});
const collection=event('collection','c1',{at:project.deadline,pledgeId:'backer1',amountCents:12000,evidenceRef:'fixture_collection_1'});
const end='2026-11-10T00:00:00Z';
test('only rewards backing accepts explicit nonfinancial reward kinds',()=>{
  for(const transactionType of ['equity','membership','paid_mission'])assert.throws(()=>evaluateBacking({...project,transactionType},[],end));
  for(const kind of ['equity','profit_share','loan','cash','token'])assert.throws(()=>evaluateBacking({...project,reward:{kind,financialReturn:false}},[],end));
  assert.throws(()=>evaluateBacking({...project,reward:{kind:'digital_good',financialReturn:true}},[],end));
  assert.throws(()=>evaluateBacking({...project,profitShare:0.1},[],end));
  assert.throws(()=>evaluateBacking({...project,fundingRule:'keep_it_all'},[],end));
});
test('target reached pledges do not mean collected funds or a campaign budget',()=>{
  assert.equal(evaluateBacking(project,[],'2026-09-30T00:00:00Z').outcome,'not_open');
  const open=evaluateBacking(project,[pledge],'2026-10-20T00:00:00Z');
  assert.equal(open.outcome,'pledging');assert.equal(open.pledgedCents,12000);assert.equal(open.collectedCents,0);
  const pending=evaluateBacking(project,[pledge],project.deadline);assert.equal(pending.outcome,'collection_pending');
  const funded=evaluateBacking(project,[pledge,collection],end);
  assert.equal(funded.outcome,'collection_target_met');assert.deepEqual(funded.campaignBudget,{authorized:false,cents:0});assert.equal(funded.live,false);
});
test('missed goal and collection deadline fail closed; cancellation freezes pledging',()=>{
  const small={...pledge,amountCents:9000};
  assert.equal(evaluateBacking(project,[small],end).outcome,'target_not_met');
  assert.throws(()=>evaluateBacking(project,[small,{...collection,amountCents:9000}],end));
  assert.throws(()=>evaluateBacking(project,[{...pledge,at:project.deadline}],end));
  assert.throws(()=>evaluateBacking(project,[pledge,{...collection,at:'2026-10-31T00:00:00Z'}],end));
  assert.throws(()=>evaluateBacking(project,[pledge,{...collection,at:project.collectionDeadline}],end));
  const cancel=event('cancel_project','cancel',{at:'2026-10-14T00:00:00Z'});
  assert.throws(()=>evaluateBacking(project,[cancel,pledge],end));
});
test('undercollection requires refund; refunds never become spending authority',()=>{
  const partial={...collection,amountCents:8000};
  const failed=evaluateBacking(project,[pledge,partial],end);assert.equal(failed.outcome,'refund_required');
  const refund=event('refund','r1',{at:end,collectionId:'c1',amountCents:8000,evidenceRef:'fixture_refund_1'});
  const refunded=evaluateBacking(project,[pledge,partial,refund],end);assert.equal(refunded.outcome,'refunded');assert.equal(refunded.netCollectedCents,0);
  assert.deepEqual(evaluateBacking(project,[pledge,partial,refund,refund],end),refunded);
  assert.throws(()=>evaluateBacking(project,[pledge,partial,{...refund,evidenceRef:partial.evidenceRef}],end));
  assert.throws(()=>evaluateBacking(project,[pledge,partial,{...refund,amountCents:9000}],end));
  const cancelled=evaluateBacking(project,[pledge,collection,event('cancel_project','cancel',{at:end})],end);assert.equal(cancelled.outcome,'refund_required');
});
test('event replay, scope, currency, amount and timestamp guards',()=>{
  assert.deepEqual(evaluateBacking(project,[pledge,collection,collection],end),evaluateBacking(project,[pledge,collection],end));
  assert.throws(()=>evaluateBacking(project,[pledge,collection,{...collection,amountCents:1}],end));
  for(const extra of [{projectId:'other'},{currency:'EUR'},{amountCents:-1},{amountCents:0.5},{amountCents:Number.MAX_SAFE_INTEGER+1},{at:'2030-01-01T00:00:00Z'}])assert.throws(()=>evaluateBacking(project,[{...pledge,...extra}],end));
  assert.throws(()=>evaluateBacking(project,[pledge,{...collection,amountCents:13000}],end));
  assert.throws(()=>evaluateBacking(project,[pledge,collection,{...collection,id:'c2'}],end));
  assert.throws(()=>evaluateBacking(project,[pledge,event('allocate_budget','a')],end));
  assert.throws(()=>evaluateBacking(project,[{...pledge,amountCents:Number.MAX_SAFE_INTEGER}, {...pledge,id:'p2',pledgeId:'second'}],end));
  assert.equal(evaluateBacking(project,[pledge,event('cancel_pledge','x',{pledgeId:'backer1'})],end).pledgedCents,0);
});
