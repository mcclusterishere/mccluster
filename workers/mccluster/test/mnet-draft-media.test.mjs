import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {handlePlatformApi} from '../src/platform-api.js';
const original=globalThis.fetch;afterEach(()=>globalThis.fetch=original);
const user='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',asset='33333333-3333-4333-8333-333333333333';
const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
const req=ids=>new Request('https://api.test/v1/mnet/media/drafts?ids='+ids,{headers:{authorization:'Bearer fixture'}});
test('draft restoration returns only owned unattached ready media and no storage addresses',async()=>{
 let row={id:asset,owner_m_uid:owner,status:'ready',post_id:null,media_type:'image',mime_type:'image/png',object_path:'private/path'},calls=[];
 globalThis.fetch=async(input)=>{const u=new URL(input);calls.push(u);const data=u.pathname.endsWith('/auth/v1/user')?{id:user}:u.pathname.endsWith('/m_auth_user_links')?[{m_uid:owner}]:[row];return Response.json(data);};
 let result=await handlePlatformApi(req(asset),env);assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);assert.deepEqual(await result.json(),{assets:[{id:asset,media_type:'image',mime_type:'image/png'}]});
 const query=calls.find(u=>u.pathname.endsWith('network_media_assets'));assert.equal(query.searchParams.get('owner_m_uid'),'eq.'+owner);assert.equal(query.searchParams.get('post_id'),'is.null');
 const valid={...row};for(const change of [{owner_m_uid:user},{status:'attached',post_id:user},{status:'deleted'},{status:'staged'}]){row={...valid,...change};result=await handlePlatformApi(req(asset),env);assert.deepEqual(await result.json(),{assets:[]});}
});
test('malformed draft references are rejected before media storage reads',async()=>{
 globalThis.fetch=async input=>{assert.match(new URL(input).pathname,/auth\/v1\/user$/);return Response.json({id:user});};
 assert.equal((await handlePlatformApi(req('bad'),env)).status,400);
});
