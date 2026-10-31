/* Non-live rewards-backing specification. No I/O, provider authorization, money
   movement, spending authority, customer state, or persistence is created here. */
export const REWARD_KINDS = Object.freeze(['physical_good', 'digital_good', 'experience', 'acknowledgment']);
const fail = message => { throw new TypeError(message); };
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : fail('Invalid identifier');
const cents = value => Number.isSafeInteger(value) && value > 0 ? value : fail('Amounts must be positive safe integer cents');
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : fail('Explicit timestamp required');
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('Unsupported fields');
}
function add(a, b) { const result = a + b; if (!Number.isSafeInteger(result)) fail('Amount overflow'); return result; }
function projectConfig(project) {
  exact(project, ['id','transactionType','fundingRule','currency','targetCents','opensAt','deadline','collectionDeadline','reward']);
  id(project.id);
  if (project.transactionType !== 'rewards_backing' || project.fundingRule !== 'all_or_nothing') fail('Only rewards-based all-or-nothing backing is modeled');
  if (!/^[A-Z]{3}$/.test(project.currency || '')) fail('Currency required');
  cents(project.targetCents);
  const opens = time(project.opensAt), deadline = time(project.deadline), collectionDeadline = time(project.collectionDeadline);
  if (!(opens < deadline && deadline < collectionDeadline)) fail('Invalid funding and collection deadlines');
  exact(project.reward, ['kind','financialReturn']);
  if (!REWARD_KINDS.includes(project.reward.kind) || project.reward.financialReturn !== false) fail('Financial returns and unsupported rewards are excluded');
  return {opens, deadline, collectionDeadline};
}

/** Replay caller-supplied fixture evidence. The caller is NOT authenticated here.
 * `collection` means confirmed collection evidence supplied by a future adapter;
 * this function cannot verify it. A funded result never authorizes spending. */
export function evaluateBacking(project, events, now) {
  const clock = time(now), {opens, deadline, collectionDeadline} = projectConfig(project);
  if (!Array.isArray(events)) fail('Events must be an array');
  const seen = new Map(), pledges = new Map(), collections = new Map(), evidence = new Set();
  let last = -Infinity, cancelled = false, pledged = 0, collected = 0, refunded = 0;
  for (const event of events) {
    exact(event, ['id','projectId','type','at','currency','amountCents','pledgeId','collectionId','evidenceRef']);
    const fields = {pledge:['pledgeId','amountCents'],cancel_pledge:['pledgeId'],cancel_project:[],collection:['pledgeId','amountCents','evidenceRef'],refund:['collectionId','amountCents','evidenceRef']}[event.type];
    if (!fields) fail('Unsupported backing event');
    exact(event,['id','projectId','type','at','currency',...fields]);
    id(event.id);
    if (event.projectId !== project.id || event.currency !== project.currency) fail('Project and currency must match');
    // Duplicate delivery is harmless; conflicting reuse is rejected.
    const fingerprint = JSON.stringify(Object.keys(event).sort().map(key => [key,event[key]]));
    if (seen.has(event.id)) { if (seen.get(event.id) !== fingerprint) fail('Conflicting event id'); continue; }
    const at = time(event.at);
    if (at > clock || at < last) fail('Events must be chronological and not in the future');
    last = at; seen.set(event.id, fingerprint);
    if (event.type === 'pledge') {
      if (cancelled || at < opens || at >= deadline) fail('Pledging is closed');
      id(event.pledgeId); if (pledges.has(event.pledgeId)) fail('Pledge already exists');
      pledges.set(event.pledgeId, {cents:cents(event.amountCents),collected:0,active:true});
      pledged = add(pledged,event.amountCents);
    } else if (event.type === 'cancel_pledge') {
      if (at >= deadline) fail('Pledges are frozen at deadline');
      const pledge = pledges.get(event.pledgeId); if (!pledge?.active) fail('Active pledge required');
      pledge.active = false; pledged -= pledge.cents;
    } else if (event.type === 'cancel_project') {
      cancelled = true;
    } else if (event.type === 'collection') {
      if (cancelled || at < deadline || at >= collectionDeadline || pledged < project.targetCents) fail('Collection is not eligible');
      const pledge = pledges.get(event.pledgeId);
      const amount = cents(event.amountCents);
      id(event.evidenceRef);
      if (!pledge?.active || add(pledge.collected,amount) > pledge.cents) fail('Collection exceeds active pledge');
      if (evidence.has(event.evidenceRef)) fail('Collection evidence already used');
      evidence.add(event.evidenceRef);
      pledge.collected += amount; collected = add(collected,amount);
      collections.set(event.id,{cents:amount,refunded:0,evidenceRef:event.evidenceRef});
    } else if (event.type === 'refund') {
      const collection = collections.get(event.collectionId), amount = cents(event.amountCents);
      id(event.evidenceRef);
      if (!collection || add(collection.refunded,amount) > collection.cents) fail('Refund exceeds confirmed collection');
      // Evidence references are unique across refunds and collection events.
      if (evidence.has(event.evidenceRef)) fail('Refund evidence already used');
      evidence.add(event.evidenceRef);
      collection.refunded += amount; refunded = add(refunded,amount);
    } else fail('Unsupported backing event');
  }
  const net = collected - refunded;
  let outcome;
  if (cancelled) outcome = net ? 'refund_required' : 'cancelled';
  else if (clock < opens) outcome = 'not_open';
  else if (clock < deadline) outcome = 'pledging';
  else if (pledged < project.targetCents) outcome = 'target_not_met';
  else if (net >= project.targetCents) outcome = 'collection_target_met';
  else if (clock < collectionDeadline) outcome = 'collection_pending';
  else outcome = net ? 'refund_required' : collected ? 'refunded' : 'collection_target_not_met';
  return Object.freeze({model:'rewards_backing/all_or_nothing/v1',live:false,outcome,currency:project.currency,
    targetCents:project.targetCents,pledgedCents:pledged,collectedCents:collected,refundedCents:refunded,
    netCollectedCents:net,campaignBudget:Object.freeze({authorized:false,cents:0}),
    requiresProcessorAndTermsApproval:true});
}
