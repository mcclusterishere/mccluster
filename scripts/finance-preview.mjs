// Local-only preview/test harness. Real PostgreSQL draft schema, fictional owner/data.
// Requires the already installed Docker image postgres:17.6; never pulls or deploys.
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {handleIntelRequest} from '../workers/mccluster/src/intel/router.js';
import {createAlpacaClient} from '../workers/mccluster/src/finance/alpaca.js';
import {IntelError} from '../workers/mccluster/src/intel/store.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const container=`finance-preview-${process.pid}`;
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=statement=>docker(['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres'],statement);
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
docker(['run','--pull=never','--rm','-d','--network','none','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6']);
function cleanup(){try{docker(['rm','-f',container]);}catch{}}
process.on('exit',cleanup);process.on('SIGINT',()=>process.exit());process.on('SIGTERM',()=>process.exit());
for(let i=0;i<60;i++){try{sql('select 1;');break;}catch{if(i===59)throw Error('Local PostgreSQL did not start');await new Promise(r=>setTimeout(r,250));}}
sql(`create role anon; create role authenticated; create role service_role bypassrls;
create table public.orgs(id uuid primary key,slug text,enabled boolean);
create table public.org_members(org_id uuid,profile_id uuid,role text);
grant usage on schema public to service_role;
grant select on public.orgs,public.org_members to service_role;
insert into public.orgs values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','mccluster',true);
insert into public.org_members values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${owner}','owner'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${other}','member');`);
sql(await readFile(root+'docs/control-plane/sql/finance-paper-draft.sql','utf8'));
sql(await readFile(root+'docs/control-plane/sql/finance-market-draft.sql','utf8'));
const financeRpc=async(_env,fn,args)=>{
 const expression=fn==='finance_account_read'?`public.finance_account_read(${quote(args.p_owner)}::uuid)`:
 fn==='finance_account_append'?`public.finance_account_append(${quote(args.p_owner)}::uuid,${Number(args.p_expected)},${quote(JSON.stringify(args.p_event))}::jsonb)`:
 fn==='finance_quote_budget'?`public.finance_quote_budget(${quote(args.p_account)})`:
 fn==='finance_paper_read'?`public.finance_paper_read(${quote(args.p_owner)}::uuid)`:
 fn==='finance_paper_append'?`public.finance_paper_append(${quote(args.p_owner)}::uuid,${Number(args.p_expected)},${quote(JSON.stringify(args.p_commands))}::jsonb)`:null;
 if(!expression)throw Error('Unknown RPC');
 try{const result=sql(`set role service_role; select ${expression};`).trim();return result==='t'?true:result==='f'?false:JSON.parse(result);}
 catch(error){const detail=String(error.stderr);throw new IntelError('Local store rejected',detail.includes('Portfolio changed')?409:403,detail.includes('Portfolio changed')?'conflict':'forbidden');}
};
// Exercise database permissions, prefix protection and revision conflicts before serving.
for(const statement of [`set role anon;select public.finance_paper_read('${owner}');`,
 `set role authenticated;select * from public.finance_paper_portfolios;`,
 `set role anon;select public.finance_account_read('${owner}');`,
 `set role authenticated;select * from public.finance_market_accounts;`,
 `set role authenticated;select public.finance_quote_budget(repeat('a',64));`,
 `set role service_role;select public.finance_account_read('${other}');`,
 `set role service_role;select public.finance_paper_read('${other}');`]){
 let denied=false;try{sql(statement);}catch{denied=true;}if(!denied)throw Error('Database permission test failed');
}
// Explicit test-only provider stubs: never uses configured credentials/network.
const financeMarket=createAlpacaClient({reserve:financeRpc,fetchImpl:async url=>{
 const path=new URL(url).pathname,t=Date.now();
 return Response.json(path==='/v2/assets'?[{id:'fixture-AAPL',symbol:'AAPL',name:'Apple (test fixture)',exchange:'NASDAQ',class:'us_equity',status:'active',tradable:true}]:
 path==='/v2/clock'?{timestamp:new Date(t).toISOString(),is_open:true}:
 path.endsWith('/latest')?{quotes:{AAPL:{t:new Date(t-1000).toISOString(),bp:100,ap:100.02}}}:
 {bars:{AAPL:Array.from({length:20},(_,i)=>({t:new Date(t-(21-i)*86400000).toISOString(),c:95+i/3}))}});
}});
// Global quota rollover and hard stop are enforced in actual SQL.
const quotaKey='b'.repeat(64);
if(sql(`set role service_role; select count(*) from generate_series(1,180) where public.finance_quote_budget('${quotaKey}');`).trim()!=='180')throw Error('Quota too early');
if(await financeRpc({},'finance_quote_budget',{p_account:quotaKey}))throw Error('Quota did not stop');
sql(`update public.finance_provider_budget set bucket=now()-interval '2 minutes' where account='${quotaKey}';`);
if(!await financeRpc({},'finance_quote_budget',{p_account:quotaKey}))throw Error('Quota did not reset');
const env={APCA_API_KEY_ID:'local-stub',APCA_API_SECRET_KEY:'not-a-secret',FINANCE_ALPACA_ENABLED:'true',SUPABASE_URL:'https://local-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-fixture',FINANCE_DEV_ENABLED:'true',FINANCE_PERSISTENCE_ENABLED:'true'};
const options={financeRpc,financeMarket,requireHouseOwner:async request=>{if(request.headers.get('authorization')!=='Bearer local-owner-fixture')throw new IntelError('Forbidden',403,'forbidden');return{id:owner};}};
const files=new Set(['finance-dev.html','js/finance-dev.js','css/finance-dev.css']);
const server=createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/v1/')){
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>17000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   const response=await handleIntelRequest(request,env,options);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
 }
 if(url.pathname==='/'){
   res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Finance local preview</title><h1>Local owner product preview</h1><p>Isolated PostgreSQL. Synthetic prices. No production connection.</p><a href="finance-dev.html">Finance · owner development</a><script>localStorage.setItem("mccdb_session",JSON.stringify({access_token:"local-owner-fixture"}));</script>');return;
 }
 const path=url.pathname.slice(1);if(!files.has(path)){res.writeHead(404);res.end('Local preview serves Finance only. The actual globe entry is in js/halo/halo.js.');return;}
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(root+path));
 }catch(error){res.writeHead(500);res.end('Local preview error');console.error(error.message);}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,container,mode:'local-postgres-synthetic',database_permission_tests:'passed'})));
