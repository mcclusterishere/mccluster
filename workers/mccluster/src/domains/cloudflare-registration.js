// Registration-only Cloudflare API adapter. No contact-ID fabrication, renewal,
// account provisioning, automatic renewal or blind retry of financial requests.
// Official schema: /registrar/domain-check, /registrations, /registration-status.
import {validateRegistrationSchema} from './registration-schema.js';
import {hostname} from '../creator-domains.js';
const invalid = message => Object.assign(new Error(message), {noCharge:true});
const cents = value => {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) throw invalid('Registrar price is not an exact USD amount');
  const n=Number(value.replace('.',''));
  if (!Number.isSafeInteger(n) || n<=0) throw invalid('Registrar price is out of range');
  return n;
};
const term = years => {if(!Number.isInteger(years)||years<1||years>10)throw invalid('Invalid registration term');};
const text = value => typeof value==='string' && value.length>0 && value.length<=200 && !/[\x00-\x1f]/.test(value);
export function registrationContact(input) {
  const p=input?.postal_info,a=p?.address;
  if(!text(input?.email)||!/^\S+@\S+\.\S+$/.test(input.email)||!/^\+\d{1,3}\.\d{4,14}$/.test(input?.phone||'')||!text(p?.name)||!['street','city','state','postal_code'].every(k=>text(a?.[k]))||! /^[A-Z]{2}$/.test(a?.country_code||''))throw invalid('Complete the inline registrant contact');
  // Explicit allowlist avoids passing arbitrary objects or account defaults.
  return {email:input.email,phone:input.phone,postal_info:{name:p.name,...(text(p.organization)?{organization:p.organization}:{}),address:{street:a.street,city:a.city,state:a.state,postal_code:a.postal_code,country_code:a.country_code}}};
}
export function cloudflareRegistrationAdapter({accountId,apiToken,mode='sandbox',fetchImpl,allowNetwork=false,validateExtension}={}) {
  if(!/^[a-zA-Z0-9_-]+$/.test(accountId||'')||!apiToken)throw invalid('Registrar account configuration is incomplete');
  if(!['sandbox','live'].includes(mode))throw invalid('Invalid registrar mode');
  if(!fetchImpl&&!allowNetwork)throw invalid('Registrar transport is disabled');
  const transport=fetchImpl||fetch,base=`https://api.cloudflare.com/client/v4/accounts/${accountId}/${mode==='sandbox'?'registrar-sandbox':'registrar'}`;
  const prepared=new WeakMap();
  async function call(path,{method='GET',body}={}) {
    let response,payload;
    try {response=await transport(base+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${apiToken}`,'content-type':'application/json',...(path==='/registrations'?{Prefer:'respond-async'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      // workerd supports manual, not error. Never follow even same-origin redirects:
      // registrar credentials and inline registrant PII belong only on this URL.
      if(response.status>=300&&response.status<400)throw new Error('Registrar redirect refused');
      payload=await response.json();}
    catch {throw new Error('Registrar response is uncertain; use status reconciliation, not resubmission');}
    if(!response.ok||payload?.success!==true||!payload.result)throw new Error('Registrar response could not be confirmed');
    return payload.result;
  }
  function workflow(result,domain) {
    if(result?.context?.domain_name!==domain||!['pending','in_progress','blocked','action_required','succeeded','failed'].includes(result.state)||result.completed!==['succeeded','failed'].includes(result.state))throw new Error('Registrar workflow identity or state is unconfirmed');
    // Do not follow returned URLs or disclose context PII/error text to customers.
    return {state:result.state,domain,created_at:result.created_at,completed:result.completed,action_required:result.state==='action_required',retry_after_seconds:result.state==='blocked'?3600:30};
  }
  return {
    capabilities:Object.freeze({register:true,renew:false,contact_model:'inline',registrant_readback:false,charge_readback:false,mode}),
    async quote(domain,action='register',years=1) {
      if(action!=='register')throw invalid('Cloudflare manual renewal is unsupported');
      domain=hostname(domain);term(years);
      const result=await call('/domain-check',{method:'POST',body:{domains:[domain]}});
      const rows=result.domains?.filter(r=>r.name===domain);
      if(rows?.length!==1)throw invalid('Registrar did not return an exact domain result');
      const row=rows[0];
      if(row.registrable!==true||row.tier!=='standard'||row.pricing?.currency!=='USD')throw invalid('Standard USD registration is unavailable');
      const amount=cents(row.pricing.registration_cost)+(years-1)*cents(row.pricing.renewal_cost);
      if(!Number.isSafeInteger(amount)||amount>1000000)throw invalid('Registrar total is out of range');
      return {hostname:domain,action,years,available:true,premium:false,currency:'USD',registrar_cents:amount};
    },
    async prepare({hostname:domain,years,registrant}) {
      domain=hostname(domain);term(years);
      const contact=registrationContact(registrant);
      const extension=domain.slice(domain.indexOf('.')+1);
      const discovered=await call('/extensions/'+encodeURIComponent(extension));
      // Full provider JSON Schema must be validated, including registry-specific
      // acknowledgements. An unavailable validator is a configuration gate.
      const body={domain_name:domain,years,contacts:{registrant:contact},auto_renew:false,privacy_mode:'redaction'};
      if(discovered.metadata?.name!==extension||!discovered.registration_schema||typeof validateExtension!=='function'||await validateExtension(discovered.registration_schema,body)!==true)throw invalid('Extension registration requirements are not supported');
      prepared.set(body,JSON.stringify(body));
      return body;
    },
    async submit(body) {
      // Defense in depth: caller cannot replace prepared inline contact with defaults.
      if(!prepared.has(body)||prepared.get(body)!==JSON.stringify(body))throw invalid('Registration request was not prepared or changed');
      prepared.delete(body);
      hostname(body?.domain_name);term(body?.years);registrationContact(body?.contacts?.registrant);
      if(body.auto_renew!==false||body.privacy_mode!=='redaction')throw invalid('Registration settings are unsupported');
      const result=await call('/registrations',{method:'POST',body});
      return workflow(result,body.domain_name);
    },
    async status(domain) {domain=hostname(domain);return workflow(await call(`/registrations/${encodeURIComponent(domain)}/registration-status`),domain);},
    async ownership(domain) {
      domain=hostname(domain);const row=await call('/registrations/'+encodeURIComponent(domain));
      const owned=row.domain_name===domain&&row.status==='active'&&row.auto_renew===false&&Number.isFinite(Date.parse(row.created_at))&&Number.isFinite(Date.parse(row.expires_at))&&Date.parse(row.expires_at)>Date.now();
      return {owned,hostname:domain,expires_at:owned?row.expires_at:null,created_at:owned?row.created_at:null,registrant_verified:false,charge_verified:false};
    }
  };
}

// Worker order and verified funding routes use this factory lazily.
// Both the factory and customer checkout stay disabled by default. Explicit sandbox mode cannot hit live URLs.
export function configuredCloudflareRegistration(env,{fetchImpl,validateExtension=validateRegistrationSchema}={}) {
  if(env.CREATOR_CF_REGISTRATION_ENABLED!=='true')return null;
  if(env.CREATOR_CF_REGISTRATION_MODE!=='sandbox')throw invalid('Only the reviewed sandbox registration mode is available');
  return cloudflareRegistrationAdapter({accountId:env.CREATOR_CF_REGISTRAR_ACCOUNT_ID,apiToken:env.CREATOR_CF_REGISTRAR_TOKEN,mode:'sandbox',fetchImpl,allowNetwork:true,validateExtension});
}
