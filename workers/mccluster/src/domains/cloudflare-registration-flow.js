// Internal execution bridge, never a browser endpoint. Store must reserve a
// funded order/hostname once, CAS submit_started before I/O, and forbid retries.
export async function contactDigest(contact) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(contact)));
  return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
const validFunding = o => o.action==='register'&&o.funded_event_id&&o.consent_at&&o.currency==='USD'&&Number.isSafeInteger(o.total_cents)&&o.total_cents>0&&o.paid_cents===o.total_cents&&Number.isFinite(o.quote_expires_at)&&o.quote_expires_at>Date.now();
export async function startCloudflareRegistration(orderId,{store,provider,loadRegistrant,verifyFunding=async()=>false,enabled=false}={}) {
  if(!enabled||provider?.capabilities?.register!==true)throw Error('Registration execution is disabled');
  const order=await store.claim(orderId);
  if(!order)return {status:'not_claimed'};
  let submitted=false;
  try {
    if(!validFunding(order)||!await verifyFunding(order))throw Error('Verified funding and consent are required');
    const contact=await loadRegistrant({owner:order.auth_user_id,reference:order.contact_ref});
    const body=await provider.prepare({hostname:order.hostname,years:order.years,registrant:contact});
    if(await contactDigest(body.contacts.registrant)!==order.contact_sha256)throw Error('Registrant differs from immutable consent');
    const quote=await provider.quote(order.hostname,'register',order.years);
    if(quote.registrar_cents!==order.registrar_cents||quote.currency!==order.currency||order.quote_expires_at<=Date.now())throw Error('Registrar price changed');
    // Persist digest only. A crash after this boundary can poll but never submit.
    if(!await store.markSubmitted(orderId,{request_sha256:await contactDigest(body),submitted_at:new Date().toISOString()}))return {status:'not_claimed'};
    submitted=true;
    const result=await provider.submit(body);
    return await store.finish(orderId,{status:result.state==='action_required'?'action_required':'processing',provider_state:result.state});
  } catch {
    return store.finish(orderId,{status:submitted?'reconciliation_required':'refund_required',reason:submitted?'Registrar outcome uncertain. Check status; do not submit again.':'Registration could not be safely submitted; payment requires review.'});
  }
}
export async function reconcileCloudflareRegistration(orderId,{store,provider,manual=false}={}) {
  const attempt=await store.get(orderId);
  if(!attempt||!['submit_started','processing','reconciliation_required','action_required'].includes(attempt.status))return {status:'not_pollable'};
  if(attempt.status==='action_required'&&!manual)return {status:'action_required'};
  try {
    const workflow=await provider.status(attempt.hostname);
    if(!Number.isFinite(Date.parse(workflow.created_at))||Date.parse(workflow.created_at)<Date.parse(attempt.submitted_at)-60000)throw Error('Workflow predates this attempt');
    if(workflow.state==='succeeded') {
      const proof=await provider.ownership(attempt.hostname);
      if(!proof.owned||Date.parse(proof.created_at)<Date.parse(attempt.submitted_at)-60000)throw Error('Owned registration does not match attempt');
      // API omits billed amount and registrant readback. Do not fabricate either.
      return store.finish(orderId,{status:'registered_pending_reconciliation',expires_at:proof.expires_at,provider_state:'succeeded',reason:'Account registration confirmed; submitted contact and actual charge need reconciliation.'});
    }
    const status=workflow.state==='failed'?'reconciliation_required':workflow.state==='action_required'?'action_required':'processing';
    return store.finish(orderId,{status,provider_state:workflow.state,retry_after_seconds:workflow.retry_after_seconds});
  } catch {return store.finish(orderId,{status:'reconciliation_required',reason:'Registrar status could not be confirmed; never resubmit this attempt.'});}
}
