/* Isolated native PostgreSQL proof; requires an already installed dependency
 * directory containing embedded-postgres and pg. Never uses DATABASE_URL or
 * hosted credentials, never downloads binaries, listens on loopback only. */
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCompanyOperations} from '../../src/company-operations/service.js';
import {createSharedLedgerOperations} from '../../src/company-operations/shared-ledger.js';
import {ledgerFixture} from './ledger-fixtures.mjs';
import {createSupabaseCompanyStore} from '../../src/company-operations/adapter.js';
import {digest} from '../../src/company-operations/domain.js';
import {fixture, ORG, OTHER_ORG, OWNER, REVIEWER, COMPANY, AT, SHA, register} from './fixtures.mjs';
const root=process.env.COMPANY_TEST_DEPENDENCIES;
assert.ok(root,'Set COMPANY_TEST_DEPENDENCIES to existing local node_modules (no automatic installs).');
const {default:EmbeddedPostgres}=await import(pathToFileURL(resolve(root,'embedded-postgres/dist/index.js')));
const dir=await mkdtemp(join(tmpdir(),'company-operations-native-'));
const port=57000+(process.pid%3000);
const cluster=new EmbeddedPostgres({databaseDir:dir,user:'postgres',password:'synthetic-local-only',port,persistent:false,postgresFlags:['-h','127.0.0.1','-k',''],onLog(){},onError(){}});
const sql=await readFile(new URL('../../../../supabase/pending/company_operations_v1.sql',import.meta.url),'utf8');
let admin, clients=[];let assertions=0;
function check(condition,message){assert.ok(condition,message);assertions++;}
async function fails(fn,code){await assert.rejects(fn,e=>e.code===code);assertions++;}
async function connect(db='postgres',role){const client=cluster.getPgClient(db,'127.0.0.1');await client.connect();clients.push(client);if(role)await client.query('set role '+role);return client;}
async function base(db){await db.query(`create table public.orgs(id uuid primary key, enabled boolean not null);
create table public.org_members(org_id uuid references public.orgs(id), profile_id uuid,role text,primary key(org_id,profile_id));
insert into public.orgs values('${ORG}',true),('${OTHER_ORG}',true);
insert into public.org_members values('${ORG}','${OWNER}','owner'),('${ORG}','${REVIEWER}','owner'),('${OTHER_ORG}','${OWNER}','owner');`);}
function storeFor(client){return createSupabaseCompanyStore({},async(_env,name,args)=>{
 const values=name==='company_operations_read_v1'?[args.p_org,args.p_actor,args.p_company]:[args.p_org,args.p_actor,args.p_company,args.p_expected,args.p_event];
 const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
 const result=await client.query(`select public.${name}(${placeholders}) as value`,values);
 return result.rows[0].value;
});}
try{
 await cluster.initialise();await cluster.start();admin=await connect();
 console.log((await admin.query('select version()')).rows[0].version);
 await admin.query('create role anon; create role authenticated; create role service_role;');await base(admin);
 // Interrupted first install leaves no half-created tables/functions.
 await fails(()=>admin.query(sql.replace('commit;', 'select 1/0; commit;')),'22012');await admin.query('rollback');
 check((await admin.query("select to_regclass('public.company_operation_events') as value")).rows[0].value===null,'interrupted install rolled back');
 await admin.query(sql);
 const svc=await connect('postgres','service_role'),anon=await connect('postgres','anon'),auth=await connect('postgres','authenticated');
 for(const c of [anon,auth]){
  await fails(()=>c.query('select public.company_operations_read_v1($1,$2,$3)',[ORG,OWNER,COMPANY]),'42501');
  await fails(()=>c.query('select * from public.company_operation_events'),'42501');
 }
 await fails(()=>svc.query('select * from public.company_operation_events'),'42501');
 await fails(()=>svc.query('select public.company_operations_read_v1($1,$2,$3)',[OTHER_ORG,REVIEWER,COMPANY]),'42501');
 const store=storeFor(svc), authorize=async s=>({orgId:s?.orgId||ORG,actorId:s?.actorId||OWNER,role:'owner',enabled:true,human:true});
 const service=createCompanyOperations({store,authorize,now:()=>AT,verifyArtifact:async(p,r)=>({orgId:p.orgId,artifactRef:r,sha256:SHA,immutable:true})});
 // Replay the same complete journey through the actual SQL store, then restart
 // the service object: persistence is database-owned, not an in-memory session.
 const source=fixture();await source.prepare('handoff');const sourceEvents=await source.store.read({orgId:ORG},COMPANY);
 for(const event of sourceEvents)await service.command({actorId:event.actorId},COMPANY,{expectedRevision:event.revision-1,command:event.command});
 const packet=await service.handoff({},COMPANY,'declaration');check(packet.totalMinor==='100'&&!packet.executionEnabled,'complete recorded workflow');
 const restarted=createCompanyOperations({store,authorize,now:()=>AT});
 check((await restarted.read({},COMPANY)).revision===sourceEvents.length,'restart persisted records');
 check((await restarted.read({orgId:OTHER_ORG},COMPANY)).revision===0,'tenant read isolated');
 // Direct RPC duplicate after uncertain response returns original receipt;
 // a changed command, cross-scope envelope, stale revision and chain all fail.
 const first=(await store.read({orgId:ORG,actorId:OWNER},COMPANY))[0];
 check((await store.append({orgId:ORG,actorId:OWNER},COMPANY,0,first)).hash===first.hash,'idempotent native append');
 await fails(()=>svc.query('select public.company_operations_append_v1($1,$2,$3,$4,$5)',[ORG,OWNER,COMPANY,0,{...first,command:{...first.command,data:{...first.command.data,name:'changed'}}}]),'23505');
 await fails(()=>svc.query('select public.company_operations_append_v1($1,$2,$3,$4,$5)',[OTHER_ORG,OWNER,COMPANY,0,first]),'23514');
 await fails(()=>admin.query("update public.company_operation_events set actor_id=$1",[REVIEWER]),'55000');
 await fails(()=>admin.query('delete from public.company_operation_events'),'55000');
 const company2='00000000-0000-4000-8000-000000000022';
 const events=await Promise.all(Array.from({length:8},async(_,i)=>{
  const body={...first,companyId:company2,command:{...first.command,id:'concurrent-'+i}};delete body.hash;return {...body,hash:await digest(body)};
 }));
 const raceClients=await Promise.all(events.map(()=>connect('postgres','service_role')));
 const race=await Promise.allSettled(events.map((e,i)=>raceClients[i].query('select public.company_operations_append_v1($1,$2,$3,$4,$5)',[ORG,OWNER,company2,0,e])));
 check(race.filter(x=>x.status==='fulfilled').length===1,'eight native sessions have exactly one winner');
 check(race.filter(x=>x.status==='rejected'&&x.reason.code==='23505').length===7,'seven concurrent revisions rejected');
 // Same logical operation concurrently: all return one durable event.
 const company3='00000000-0000-4000-8000-000000000023';
 const body={...first,companyId:company3};delete body.hash;const retry={...body,hash:await digest(body)};
 const retryResults=await Promise.all(raceClients.map(c=>c.query('select public.company_operations_append_v1($1,$2,$3,$4,$5)',[ORG,OWNER,company3,0,retry])));
 check(new Set(retryResults.map(r=>r.rows[0].company_operations_append_v1.hash)).size===1,'eight retries agree');
 check((await store.read({orgId:ORG,actorId:OWNER},company3)).length===1,'eight retries only one event');
 // Revocation that commits before the RPC rejects even a previously-authenticated
 // service principal. Company read cannot use a stale JS owner label.
 await admin.query("update public.org_members set role='member' where org_id=$1 and profile_id=$2",[ORG,OWNER]);
 await fails(()=>svc.query('select public.company_operations_read_v1($1,$2,$3)',[ORG,OWNER,COMPANY]),'42501');
 await admin.query("update public.org_members set role='owner' where org_id=$1 and profile_id=$2",[ORG,OWNER]);
 await admin.query('update public.orgs set enabled=false where id=$1',[ORG]);
 await fails(()=>svc.query('select public.company_operations_read_v1($1,$2,$3)',[ORG,OWNER,COMPANY]),'42501');
 await admin.query('update public.orgs set enabled=true where id=$1',[ORG]);
 // Module logical backup restored into a SECOND disposable database. Canonical
 // organizations/members are fixture prerequisites, not duplicated auth design.
 const backup=await store.read({orgId:ORG,actorId:OWNER},COMPANY);const backupDigest=await digest(backup);
 await cluster.createDatabase('company_restore');const restoreAdmin=await connect('company_restore');await base(restoreAdmin);await restoreAdmin.query(sql);
 const restoreClient=await connect('company_restore','service_role'),restoreStore=storeFor(restoreClient);
 for(const event of backup)await restoreStore.append({orgId:ORG,actorId:event.actorId},COMPANY,event.revision-1,event);
 const restored=await restoreStore.read({orgId:ORG,actorId:OWNER},COMPANY);
 check(await digest(restored)===backupDigest,'restored event history byte-equivalent in canonical form');
 const restoredService=createCompanyOperations({store:restoreStore,authorize,now:()=>AT});
 check((await restoredService.handoff({},COMPANY,'declaration')).packetSha256===packet.packetSha256,'restored handoff fingerprint');
 // Shared contributions and organization architecture reuse the SAME canonical
 // event table. No new money ledger, permission model or scheduler is installed.
 const ledgerCompany='00000000-0000-4000-8000-000000000024';
 const ledgerSource=ledgerFixture();await ledgerSource.prepare();
 const organizationCommands=[
  {id:'mandate',type:'org_record_mandate',data:{evidenceIds:['rules'],timeZone:'America/New_York'}},
  {id:'role',type:'org_define_role',data:{id:'engineering',expectedVersion:0,title:'Engineering seat',jobType:'engineering',responsibilities:'Draft and test synthetic artifacts',capabilityIds:['code.build']}},
  {id:'seat',type:'org_assign_seat',data:{id:'seat-a',roleId:'engineering',roleVersion:1,principalRef:'synthetic-agent',principalType:'ai_agent',replaces:null,reason:'Synthetic architecture assignment only'}},
  {id:'campaign',type:'org_set_campaign',data:{id:'campaign-a',expectedVersion:0,title:'Synthetic campaign',purpose:'Record the backend architecture',startDate:'2026-11-01',endDate:'2026-11-15'}},
  {id:'milestone',type:'org_set_milestone',data:{id:'milestone-a',expectedVersion:0,campaignId:'campaign-a',campaignVersion:1,roleId:'engineering',roleVersion:1,title:'Reviewable design',acceptanceCriteria:'Evidence references and explicit unverified execution',dueDate:'2026-11-15'}},
  {id:'task',type:'org_link_task',data:{id:'task-a',milestoneId:'milestone-a',milestoneVersion:1,assignmentId:'seat-a',objectiveId:'synthetic-objective',jobId:'synthetic-job'}},
  {id:'entry',type:'org_submit_daily_entry',data:{id:'entry-a',assignmentId:'seat-a',milestoneId:'milestone-a',milestoneVersion:1,taskLinkId:'task-a',workDate:'2026-11-09',timeZone:'America/New_York',summary:'Synthetic reported work; no executor was run',status:'submitted',evidenceIds:['work'],supersedes:null,correctionReason:null}},
  {id:'entry-review',type:'org_review_daily_entry',data:{id:'entry-review-a',entryId:'entry-a',decision:'approve_report',evidenceIds:['work'],reason:'Review the recorded report only'}},
  {id:'week',type:'org_record_weekly_report',data:{id:'weekly-a',weekStart:'2026-11-09',timeZone:'America/New_York',asOf:AT}}
 ];
 for(const command of organizationCommands)await ledgerSource.command(command);

 const ledgerService=createSharedLedgerOperations({store,authorize,now:()=>AT,verifyArtifact:async(p,r)=>({orgId:p.orgId,artifactRef:r,sha256:SHA,immutable:true})});
 const ledgerEvents=await ledgerSource.store.read({orgId:ORG},COMPANY);
 for(const event of ledgerEvents)await ledgerService.command({actorId:event.actorId},ledgerCompany,{expectedRevision:event.revision-1,command:event.command});
 const ledgerSummary=await ledgerService.summary({},ledgerCompany);
 check(ledgerSummary.participants[0].reportedMoney.incomingMinor==='10000'&&ledgerSummary.participants[0].workMinutes===120,'separate contribution quantities persisted');
 check(ledgerSummary.bankBalance===null&&!ledgerSummary.ownershipGranted,'no invented bank balance or legal rights');
 const ledgerPacket=await ledgerService.contributionHandoff({},ledgerCompany,'proposal');
 check(!ledgerPacket.executionEnabled,'shared distribution remains disabled');
 const report=await ledgerService.weeklyReport({},ledgerCompany,{weekStart:'2026-11-09',timeZone:'America/New_York',asOf:AT});
 check(report.totals.entries===1&&report.totals.approvedReports===1&&report.totals.verifiedCompletions===0,'weekly report persisted without invented execution');
 const ledgerBackup=await store.read({orgId:ORG,actorId:OWNER},ledgerCompany);
 for(const event of ledgerBackup)await restoreStore.append({orgId:ORG,actorId:event.actorId},ledgerCompany,event.revision-1,event);
 const restoredLedger=createSharedLedgerOperations({store:restoreStore,authorize,now:()=>AT});
 check((await restoredLedger.contributionHandoff({},ledgerCompany,'proposal')).packetSha256===ledgerPacket.packetSha256,'restored shared ledger handoff fingerprint');
 check(await digest(await restoredLedger.weeklyReport({},ledgerCompany,{weekStart:'2026-11-09',timeZone:'America/New_York',asOf:AT}))===await digest(report),'restored weekly report fingerprint');
 check((await restoredLedger.summary({orgId:OTHER_ORG},ledgerCompany).catch(e=>e.code))==='ledger_not_configured','shared ledger tenant scope fails closed');
 console.log(`${assertions} native database assertions passed. Eight-session concurrency, interrupted install, and logical restore verified. No production contact.`);
}finally{
 for(const c of clients)await c.end().catch(()=>{});
 await cluster.stop().catch(()=>{});
}
