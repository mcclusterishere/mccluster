import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,appendFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const base=process.argv[2],bin=process.env.PG_BIN;
assert.ok(base&&bin);assert.notEqual(process.getuid(),0);
const {Client}=createRequire(import.meta.url)(process.env.PG_MODULE);
const {handleCreatorCheckout}=await import(pathToFileURL(join(base,'workers/mccluster/src/creator-billing.js')));
const dir=mkdtempSync('/tmp/com3-base-repro-'),env={PATH:process.env.PATH,LANG:'C',LC_ALL:'C'};
const run=(tool,args)=>execFileSync(join(bin,tool),args,{env,stdio:'pipe'});
const port=await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
let db,running=false;
try{
 run('initdb',['-D',dir,'-U','postgres','--auth=trust','-E','UTF8','--locale=C','--no-instructions']);
 appendFileSync(join(dir,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${port}\nunix_socket_directories=''\nfsync=off\n`);
 run('pg_ctl',['-D',dir,'-l',join(dir,'server.log'),'-w','start']);running=true;
 db=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});await db.connect();
 await db.query("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table creator_billing_subscriptions(owner_user_id uuid,status text);grant select on creator_billing_subscriptions to service_role;insert into auth.users values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')");
 await db.query(readFileSync(join(base,'supabase/pending/20261026009200_creator_checkout_reservations.sql'),'utf8'));
 await db.query('set role service_role');
 const owner='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',config={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture',STRIPE_SECRET_KEY:'rk_test_fixture',CREATOR_STARTER_MONTHLY_PRICE_ID:'price_fixture'};let provider=0;
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input),reply=data=>Response.json(data);
  if(url.hostname==='api.stripe.com'){provider++;return Response.json({error:{type:'invalid_request_error',code:'parameter_invalid_integer'}},{status:400,headers:{'request-id':'req_fixture'}})}
  assert.equal(url.hostname,'fixture.invalid');
  if(url.pathname==='/auth/v1/user')return reply({id:owner});
  if(url.pathname.endsWith('/creator_billing_subscriptions'))return reply([]);
  if(url.pathname.endsWith('/creator_checkout_reservations'))return reply((await db.query('select request_id,checkout_session_id from creator_checkout_reservations where owner_user_id=$1',[owner])).rows);
  if(url.pathname.endsWith('/rpc/reserve_creator_checkout')){const b=JSON.parse(options.body);return reply((await db.query('select reserve_creator_checkout($1,$2,$3) result',[b.p_owner,b.p_request,b.p_price])).rows[0].result)}
  throw new Error('Unexpected fixture route '+url);
 };
 const call=async(path,request_id='fixture-request-0001')=>{const req=new Request('https://api.mccluster.org/v1/creator-billing/'+path,{method:'POST',headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:JSON.stringify({plan:'starter',period:'monthly',request_id})});return (await handleCreatorCheckout(req,config)).status;};
 const statuses=[await call('checkout'),await call('checkout','fixture-request-0002'),await call('resume')];
 await db.query("update creator_checkout_reservations set expires_at=now()-interval '1 hour'");statuses.push(await call('checkout'));
 assert.deepEqual(statuses,[503,409,409,409]);assert.equal(provider,1);
 console.log(JSON.stringify({base:'53dcd55243e6d847b4ced44817bb22d11bdcce18',postgres:(await db.query('show server_version')).rows[0].server_version,uid:process.getuid(),listen:'127.0.0.1',statuses,synthetic_provider_calls:provider,real_provider_calls:0,rows:(await db.query('select * from creator_checkout_reservations')).rows},null,2));
}finally{if(db)await db.end();if(running)run('pg_ctl',['-D',dir,'-m','immediate','-w','stop']);rmSync(dir,{recursive:true,force:true})}
