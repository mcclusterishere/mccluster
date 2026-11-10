import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { TOKEN_RE, ATTEMPT_KEY_RE, DIRECT_DEFAULTS, REFUSAL_HTTP, audioFormatOf, corsHeaders } from '../../supabase/functions/_shared/music-direct.ts';
const source=await fs.readFile('supabase/functions/music-direct-access/index.ts','utf8');
const handlerSource=stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')),{mode:'strip'});
const token='00000000-0000-4000-8000-000000000001';
let passes=0;
async function scenario({signFail=false,settle={ok:true,downloads_left:4},reserve={ok:true,attempt_id:'a',bucket:'b',path:'direct-sales/here/test.wav',title:'Test',download_name:'test.wav'},body={}}) {
 let handler; const calls=[];
 const admin={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='music_direct_reserve_download'?reserve:args.p_outcome==='released'?{ok:true,state:'released'}:settle,error:null};},storage:{from:()=>({createSignedUrl:async()=>{calls.push(['sign']);return signFail?{data:null,error:{message:'synthetic failure'}}:{data:{signedUrl:'https://synthetic.invalid/audio'},error:null};}})}};
 vm.runInNewContext(handlerSource,{Deno:{serve:f=>{handler=f}},admin,Response,console:{error(){}},HttpError:class extends Error{},corsHeaders,TOKEN_RE,ATTEMPT_KEY_RE,DIRECT_DEFAULTS,REFUSAL_HTTP,audioFormatOf});
 const r=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'download',token,...body})}));
 return {status:r.status,data:await r.json(),calls};
}
let r=await scenario({});assert.equal(r.status,200);assert.equal(r.data.downloads_left,4);assert.deepEqual(r.calls.map(c=>c[0]),['music_direct_reserve_download','sign','music_direct_settle_download']);passes++;
r=await scenario({signFail:true});assert.equal(r.status,503);assert.equal(r.data.reason,'sign_retry');assert.equal(r.calls.at(-1)[1].p_outcome,'released');assert.equal(r.data.url,undefined);passes++;
for(const [reason,status] of [['revoked',403],['expired',410],['not_paid',409],['attempt_spent',409]]){r=await scenario({settle:{ok:false,reason}});assert.equal(r.status,status);assert.equal(r.data.reason,reason);assert.equal(r.data.url,undefined);passes++;}
r=await scenario({reserve:{ok:false,reason:'asset_unresolved'}});assert.equal(r.status,409);assert.equal(r.calls.length,1);passes++;
r=await scenario({body:{attempt_key:'invalid key'}});assert.equal(r.status,400);assert.equal(r.calls.length,0);passes++;
r=await scenario({body:{attempt_key:'retry-key-1'},reserve:{ok:true,attempt_id:'a',bucket:'b',path:'direct-sales/here/test.wav',title:'Test',download_name:'test.wav',replay:true}});assert.equal(r.status,200);assert.equal(r.data.replay,true);assert.equal(r.calls[0][1].p_attempt_key,'retry-key-1');passes++;
console.log(`PASS: ${passes} extracted exact Edge-handler download scenarios`);
