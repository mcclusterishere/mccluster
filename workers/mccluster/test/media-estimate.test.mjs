import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateGeneration,createGeneration} from '../src/media/router.js';
import {__resetCapabilityCache} from '../src/lib/capabilities.js';
const org='123e4567-e89b-42d3-a456-426614174000',user={id:org},env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const model={id:org,provider:'fal',provider_model_id:'fixture-model',capability:'image-to-video',parameter_schema:{required:['image_url'],properties:{image_url:{type:'string'},duration:{type:'number'}}},cost_hint:{kind:'per_second',cents_per_second:2}};
const req=(body={})=>new Request('https://api.fixture.invalid/v1/media/estimate',{method:'POST',body:JSON.stringify({org_id:org,model_id:org,input:{image_url:'https://fixture.invalid/ref.png',duration:5},...body})});
test('estimate is read-only, ignores capture time, and stale inputs/price stop before reservation',async()=>{
 const before=fetch,calls=[];__resetCapabilityCache();
 globalThis.fetch=async(url,opts={})=>{calls.push({url:String(url),method:opts.method||'GET'});let value;
 if(String(url).includes('org_members?'))value=[{org_id:org,role:'owner'}];
 else if(String(url).includes('control_role_capabilities?'))value=[{role:'owner',capability:'media.generate',allowed:true}];
 else if(String(url).includes('media_models?'))value=[model];
 else throw new Error('Unexpected mutation or provider call');
 return new Response(JSON.stringify(value));};
 try{
 const a=await estimateGeneration(req(),env,user);await new Promise(r=>setTimeout(r,5));const b=await estimateGeneration(req(),env,user);
 assert.equal(a.estimate.estimated_cost_usd_micros,100000);assert.equal(a.quote_hash,b.quote_hash);
 await assert.rejects(createGeneration(req({expected_quote_hash:a.quote_hash,input:{image_url:'https://fixture.invalid/ref.png',duration:6}}),env,user),e=>e.status===409);
 model.cost_hint.cents_per_second=3;await assert.rejects(createGeneration(req({expected_quote_hash:a.quote_hash}),env,user),e=>e.status===409);
 assert.ok(calls.every(c=>c.method==='GET'));assert.ok(calls.every(c=>c.url.startsWith('https://fixture.invalid/')));
 }finally{globalThis.fetch=before;__resetCapabilityCache();}
});

test('documented authoring controls fill only absent schemas and keep defaults typed',async()=>{
 const {withAuthoringInputs}=await import('../src/media/authoring-inputs.js');
 const base={provider:'fal',provider_model_id:'fal-ai/kling-video/v3/standard/image-to-video',parameter_schema:{}};
 const filled=withAuthoringInputs(base);assert.deepEqual(filled.parameter_schema.required,['start_image_url']);assert.equal(filled.parameter_schema.properties.duration.default,'5');assert.equal(filled.parameter_schema.properties.generate_audio.default,true);assert.deepEqual(base.parameter_schema,{});
 const declared={...base,parameter_schema:{required:['custom']}};assert.equal(withAuthoringInputs(declared),declared);
 assert.equal(withAuthoringInputs({...base,provider:'uninstalled'}).parameter_schema.properties,undefined);
});
