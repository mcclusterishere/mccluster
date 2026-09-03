import { stripeRequest } from './stripe.js';

export async function createIdentitySession(env,input={}){
  return stripeRequest(env,'identity/verification_sessions',{
    type:'document',
    provided_details:{email:input.email||undefined},
    options:{document:{allowed_types:['driving_license'],require_matching_selfie:true,require_live_capture:true}},
    metadata:{we_user_id:input.userId||'',purpose:input.purpose||'renter'}
  });
}

export async function retrieveIdentitySession(env,id){
  return stripeRequest(env,`identity/verification_sessions/${encodeURIComponent(id)}`,{}, {method:'GET'});
}
