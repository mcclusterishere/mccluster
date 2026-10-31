// Versioned AES-256-GCM follows Core meeting target encryption, with Web Crypto
// and per-record AAD binding owner, id, consent and digest. Separate configured
// keyring; never reuse VAPID or service-role credentials and never provision keys.
import {registrationContact} from './cloudflare-registration.js';
import {contactDigest} from './cloudflare-registration-flow.js';
import {domainStore} from '../creator-domains.js';
const enc=new TextEncoder(),uuid=v=>/^[0-9a-f-]{36}$/i.test(v||'');
const fail=()=>Object.assign(new Error('Registrant contact is unavailable. Save the contact again.'),{status:409});
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function keys(env){const ring=JSON.parse(env.CREATOR_DOMAIN_CONTACT_KEYS||'{}'),id=env.CREATOR_DOMAIN_CONTACT_KEY_ID;if(!id||! /^[A-Za-z0-9_-]{1,64}$/.test(id)||unb64(ring[id]||'').length!==32)throw fail();return {ring,id};}
export function contactVaultConfigured(env){try{keys(env);return true;}catch{return false;}}
const aad=row=>enc.encode(JSON.stringify(['mccluster:registrant:v1',row.auth_user_id,row.id,row.terms_version,row.contact_sha256]));
async function key(env,id,usage){const {ring}=keys(env),bytes=unb64(ring[id]||'');if(bytes.length!==32)throw fail();return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,[usage]);}
export async function sealRegistrant(details,identity,env){
 if(!uuid(identity.id)||!uuid(identity.auth_user_id)||!identity.terms_version)throw fail();
 const normalized=registrationContact(details),digest=await contactDigest(normalized),row={...identity,contact_sha256:digest};
 const {id}=keys(env),iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(row)},await key(env,id,'encrypt'),enc.encode(JSON.stringify(normalized)));
 return {contact_sha256:digest,contact_key_id:id,sealed_contact:'v1.'+b64(iv)+'.'+b64(new Uint8Array(cipher))};
}
export async function openRegistrant(row,owner,env){
 try{
  if(row.auth_user_id!==owner||row.contact_kind!=='inline'||row.deleted_at||Date.parse(row.expires_at)<=Date.now()||!Number.isFinite(Date.parse(row.expires_at)))throw fail();
  const [version,iv,cipher,...extra]=String(row.sealed_contact||'').split('.');if(version!=='v1'||extra.length||unb64(iv).length!==12)throw fail();
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:aad(row)},await key(env,row.contact_key_id,'decrypt'),unb64(cipher));
  const contact=registrationContact(JSON.parse(new TextDecoder().decode(plaintext)));
  if(await contactDigest(contact)!==row.contact_sha256)throw fail();return contact;
 }catch{throw fail();}
}
export function registrantLoader(env,fetchImpl=fetch){return async({owner,reference})=>{
 if(!uuid(owner)||!uuid(reference))throw fail();
 const rows=await domainStore(env,`creator_domain_contacts?id=eq.${reference}&auth_user_id=eq.${owner}&limit=1`,{},fetchImpl);
 if(!rows?.[0])throw fail();return openRegistrant(rows[0],owner,env);
};}
