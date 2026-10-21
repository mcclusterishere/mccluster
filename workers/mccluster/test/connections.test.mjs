import test from 'node:test';
import assert from 'node:assert/strict';
import {handleIntelRequest} from '../src/intel/router.js';
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const req=(query='',method='GET')=>new Request('https://api.mccluster.org/v1/intel/connections'+query,{method});
test('connections refuses unauthorized readers before looking up data',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
 try{await assert.rejects(handleIntelRequest(req(),env,{requireHouseOwner:async()=>{throw Object.assign(Error('Forbidden'),{status:403});}}),{status:403});assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('connections uses trusted house organization, strict bounds and private caching',async()=>{
 const original=globalThis.fetch;const calls=[];globalThis.fetch=async(url,init)=>{
  if(String(url).includes('/orgs?'))return Response.json([{id:'house'}]);
  calls.push(JSON.parse(init.body));return Response.json({schema:'connected-operations/v1',nodes:[],edges:[]});
 };
 try{
  const options={requireHouseOwner:async()=>({id:'owner'})};
  const r=await handleIntelRequest(req('?root=actor:royce.r01&depth=3&limit=50'),env,options);
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(calls,[{p_org:'house',p_root:'actor:royce.r01',p_kind:'actor',p_depth:3,p_limit:50}]);
  for(const q of ['?org=other','?depth=4','?limit=1000','?root=a&root=b','?root=actor:%3Cscript%3E'])assert.equal((await handleIntelRequest(req(q),env,options)).status,400);
  assert.equal((await handleIntelRequest(req('','POST'),env,options)).status,405);assert.equal(calls.length,1);
 }finally{globalThis.fetch=original;}
});
