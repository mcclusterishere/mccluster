import test from 'node:test';import assert from 'node:assert/strict';
import {sealRegistrant,openRegistrant,contactVaultConfigured} from '../src/domains/registration-contact-vault.js';
import {validateRegistrationSchema} from '../src/domains/registration-schema.js';
import {handleVerifiedCloudflareDomainFunding,domainPurchaseCapabilities} from '../src/creator-domain-orders.js';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const env={CREATOR_DOMAIN_CONTACT_KEY_ID:'fixture',CREATOR_DOMAIN_CONTACT_KEYS:JSON.stringify({fixture:btoa('a'.repeat(32))})};
const contact={email:'fixture@example.net',phone:'+1.5555555555',postal_info:{name:'Only Fixture',address:{street:'123 Fixture',city:'Austin',state:'TX',postal_code:'78701',country_code:'US'}}};
test('AES-GCM contact bound to owner/id/terms/digest; rotation, tamper, expiry and erasure fail safely',async()=>{
 const identity={id:B,auth_user_id:A,terms_version:'fixture-v1'},sealed=await sealRegistrant(contact,identity,env);
 const row={...identity,...sealed,contact_kind:'inline',expires_at:new Date(Date.now()+60000).toISOString()};
 assert.deepEqual(await openRegistrant(row,A,env),contact);
 assert.notEqual((await sealRegistrant(contact,identity,env)).sealed_contact,sealed.sealed_contact);
 assert.ok(!JSON.stringify(sealed).includes(contact.email));assert.equal(contactVaultConfigured({}),false);
 for(const changed of [{auth_user_id:B},{id:A},{terms_version:'new'},{contact_sha256:'0'.repeat(64)},{deleted_at:'now'},{expires_at:'2000-01-01'},{sealed_contact:sealed.sealed_contact.slice(0,-4)+'AAAA'}])await assert.rejects(openRegistrant({...row,...changed},A,env));
 await assert.rejects(openRegistrant(row,B,env));await assert.rejects(openRegistrant(row,A,{...env,CREATOR_DOMAIN_CONTACT_KEYS:JSON.stringify({fixture:btoa('b'.repeat(32))})}));
 const rotated={CREATOR_DOMAIN_CONTACT_KEY_ID:'next',CREATOR_DOMAIN_CONTACT_KEYS:JSON.stringify({fixture:btoa('a'.repeat(32)),next:btoa('b'.repeat(32))})};assert.deepEqual(await openRegistrant(row,A,rotated),contact);
});
test('complete schema interpreter enforces refs, conditionals, required nested fields, patterns, enums and formats',()=>{
 const schema={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',required:['country','contact','years'],additionalProperties:false,$defs:{contact:{type:'object',required:['email','phone'],properties:{email:{type:'string',format:'email'},phone:{type:'string',pattern:'^\\+[0-9]+\\.[0-9]+$'}}}},properties:{country:{enum:['US','CA']},contact:{$ref:'#/$defs/contact'},years:{type:'integer',minimum:1,maximum:10},state:{type:'string'}},if:{properties:{country:{const:'US'}}},then:{required:['state']}};
 const body={country:'US',contact:{email:'fixture@example.net',phone:'+1.5555555555'},years:1,state:'TX'};
 assert.equal(validateRegistrationSchema(schema,body),true);
 for(const bad of [{...body,years:11},{...body,country:'XX'},{...body,contact:{email:'bad',phone:'123'}},{country:'US',contact:body.contact,years:1},{...body,extra:true}])assert.equal(validateRegistrationSchema(schema,bad),false);
 assert.equal(validateRegistrationSchema({$ref:'https://untrusted.invalid/schema'},body),false);
 assert.equal(validateRegistrationSchema({$schema:'unknown',type:'object'},body),false);
 assert.equal(validateRegistrationSchema({$ref:'#/missing'},body),false);
 assert.equal(validateRegistrationSchema({type:'object'},{large:'x'.repeat(16385)}),false);
 assert.equal(validateRegistrationSchema({type:'object',description:'x'.repeat(131073)},body),false);
});
test('sandbox funding requires explicit false livemode and checkout defaults disabled',async()=>{
 let calls=0;const options={fetchImpl:async()=>{calls++;throw Error('Unexpected I/O');},provider:{capabilities:{mode:'sandbox'}}};
 for(const livemode of [undefined,true,null,'false'])await assert.rejects(handleVerifiedCloudflareDomainFunding({livemode},{STRIPE_SECRET_KEY:'sk_test_fixture'},options),/sandbox/);
 assert.equal(calls,0);assert.equal(domainPurchaseCapabilities(env,{}).purchase,false);
});
