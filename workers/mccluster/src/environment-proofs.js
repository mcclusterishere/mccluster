/* Canonical bearer-only proof persistence. The host must enforce installation
 * policy and authenticate before invoking these adapters. SQL repeats scope
 * and ownership checks; no service-role identity is substituted. */
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export const ENVIRONMENT_PROOF_ERRORS=Object.freeze(['assignment_not_found','proof_not_found','owner_only','sign_in_required','proof_consent_required','share_boolean_required','invalid_proof','invalid_decision','proof_immutable','mission_not_taking_proof','proof_already_used','review_not_authorized','self_review_forbidden','proof_requires_live_capture','proof_too_long_for_sharing','proof_changed']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const id=value=>{if(typeof value!=='string'||!UUID.test(value))fail('invalid_proof');return value;};
export function createEnvironmentProofAdapter(request,env,{fetchImpl=fetch}={}) {
  async function rpc(name,args) {
    const authorization=request.headers.get('authorization');
    if(!/^Bearer\s+\S+$/i.test(authorization||''))fail('sign_in_required');
    const result=await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization,'content-type':'application/json'},body:JSON.stringify(args)});
    const data=await result.json().catch(()=>null);
    if(!result.ok){const mapped={
      'this mission is completed live: go live and finish on camera':'proof_requires_live_capture','this proof has already been reviewed':'proof_immutable','this mission is not taking proof':'mission_not_taking_proof','this mission is closed':'mission_not_taking_proof',
      'that proof has already been used for another mission':'proof_already_used','not authorized':'review_not_authorized','you cannot review your own proof':'self_review_forbidden'
    }[data?.message];fail(mapped|| (ENVIRONMENT_PROOF_ERRORS.includes(data?.message)?data.message:'persistence_unavailable'));}
    if(!data||typeof data!=='object'||Array.isArray(data))fail('persistence_unavailable');
    return data;
  }
  return Object.freeze({
    read:(_context,{assignmentId})=>rpc('world_environment_proof_read',{p_assignment:id(assignmentId)}),
    submit:(_context,input)=>{
      if(input.consent!==true)fail('proof_consent_required');
      if(typeof input.share!=='boolean')fail('share_boolean_required');
      const statement=typeof input.statement==='string'?input.statement.trim():'';
      if(!['text','link'].includes(input.proof_type)||statement.length<20||statement.length>4000)fail('invalid_proof');
      let url=null;
      if(input.proof_type==='link'){
        try {const parsed=new URL(input.proof_url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!parsed.hostname||input.proof_url.length>2000)fail('invalid_proof');url=parsed.href;}catch{fail('invalid_proof');}
      } else if(input.proof_url!=null&&input.proof_url!=='')fail('invalid_proof');
      if(input.share && statement.length+(url?2+url.length:0)>2000)fail('proof_too_long_for_sharing');
      return rpc('world_environment_proof_submit',{p_assignment:id(input.assignmentId),p_proof_type:input.proof_type,p_statement:statement,p_proof_url:url,p_share:input.share,p_consent:true});
    },
    share:(_context,{assignmentId,share,consent=false})=>{if(share===true&&consent!==true)fail('proof_consent_required');if(typeof share!=='boolean')fail('share_boolean_required');return rpc('world_environment_proof_share',{p_assignment:id(assignmentId),p_share:share,p_consent:consent===true});},
    list:()=>rpc('world_environment_proofs',{}),
    review:(_context,{proofId,decision,expected_revision,review_note=null})=>{if(!['verified','rejected'].includes(decision))fail('invalid_decision');if(typeof expected_revision!=='string'||!/^[0-9a-f]{32}$/.test(expected_revision))fail('invalid_proof');if(review_note!==null&&(typeof review_note!=='string'||review_note.length>2000))fail('invalid_proof');return rpc('world_environment_proof_review',{p_proof:id(proofId),p_decision:decision,p_expected_revision:expected_revision,p_review_note:review_note});}
  });
}
