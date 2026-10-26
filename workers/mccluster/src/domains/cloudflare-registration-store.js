import {domainStore} from '../creator-domains.js';
// owner/contact binding comes from a server-owned consent intent, never a request
// body. No route wires this adapter until the encrypted contact path is reviewed.
export function cloudflareRegistrationStore(env,{owner,contactReference,contactSha256,fetchImpl=fetch}={}) {
  if(!/^[a-f0-9-]{36}$/.test(owner||''))throw Error('Registration owner required');
  const db=(path,init)=>domainStore(env,path,init,fetchImpl);
  const filter=id=>{if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('Invalid order');return `order_id=eq.${id}&auth_user_id=eq.${owner}`;};
  return {
    claim:orderId=>db('rpc/claim_cf_registration_attempt',{method:'POST',body:JSON.stringify({p_order:orderId,p_owner:owner,p_contact_ref:contactReference,p_contact_sha:contactSha256})}),
    async markSubmitted(id,data){const rows=await db(`creator_cf_registration_attempts?${filter(id)}&status=eq.prepared`,{method:'PATCH',body:JSON.stringify({...data,status:'submit_started'})});return rows.length===1;},
    async get(id){return (await db(`creator_cf_registration_attempts?${filter(id)}&limit=1`))[0]||null;},
    async finish(id,outcome){
      const current=await this.get(id);if(!current)return {status:'not_found'};
      if(['registered_pending_reconciliation','refund_required'].includes(current.status))return current;
      const rows=await db(`creator_cf_registration_attempts?${filter(id)}&status=eq.${current.status}`,{method:'PATCH',body:JSON.stringify({status:outcome.status,outcome})});
      return rows[0]||await this.get(id);
    }
  };
}
