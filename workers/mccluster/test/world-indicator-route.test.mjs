import test from 'node:test';
import assert from 'node:assert/strict';
import {handleIntelRequest} from '../src/intel/router.js';
import {IntelError} from '../src/intel/store.js';
import {createIndicatorClient} from '../src/intel/world-indicators.js';
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const req=(q='',method='GET')=>new Request('https://api.mccluster.org/v1/intel/world-indicators'+q,{method,headers:{authorization:'Bearer private-owner'}});
test('authorization precedes provider and catalog reads',async()=>{
 let calls=0;
 const r=await handleIntelRequest(req(),env,{requireHouseOwner:async()=>{throw new IntelError('Forbidden',403)},indicatorClient:async()=>{calls++}});
 assert.equal(r.status,403);assert.equal(calls,0);
});
test('owner route returns bounded sourced observations without forwarding credentials',async()=>{
 let calls=0;
 const client=createIndicatorClient({fetchImpl:async(url,init)=>{calls++;assert.equal(new URL(url).hostname,'api.worldbank.org');assert.deepEqual(init.headers,{accept:'application/json'});return new Response(JSON.stringify([{pages:1},[{indicator:{id:'SP.POP.TOTL'},country:{id:'US',value:'United States'},countryiso3code:'USA',date:'2025',value:0}]]));}});
 const options={requireHouseOwner:async()=>({id:'owner'}),indicatorClient:client};
 for(let i=0;i<2;i++){const r=await handleIntelRequest(req('?economy=US&indicators=SP.POP.TOTL'),env,options);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal((await r.json()).observations[0].value,0);}
 assert.equal(calls,1);
 for(const q of ['?economy=US&url=x','?economy=US&economy=GB','?economy=US-CT','?indicators=madeup'])assert.equal((await handleIntelRequest(req(q),env,options)).status,400);
 assert.equal((await handleIntelRequest(req('','POST'),env,options)).status,405);assert.equal(calls,1);
});
