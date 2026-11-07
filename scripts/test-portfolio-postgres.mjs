// Only the acknowledged disposable Supabase reset, never a production connection.
// No auth/tenancy stubs: canonical migrations and managed auth must already exist.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export function canonicalPortfolioUrl(env) {
  assert.equal(env.PORTFOLIO_CANONICAL_ACK,'disposable-supabase-reset','explicit disposable reset acknowledgement required');
  const url=new URL(env.NATIVE_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'loopback only');
  assert.equal(url.port,'54322','isolated Supabase port only');
  assert.equal(url.pathname,'/postgres','canonical disposable reset database only');
  assert.equal(url.username,'postgres','disposable reset administrator required');
  assert.equal(url.search,'','connection overrides are forbidden');
  return url;
}

export async function run(env=process.env) {
  const url=canonicalPortfolioUrl(env);
  const {default:postgres}=await import(pathToFileURL(resolve(env.POSTGRES_MODULE_PATH)).href);
  const prefix=`portfolio-proof-${process.pid}-${randomUUID().slice(0,8)}`;
  const connect=label=>postgres(url.href,{max:1,onnotice:()=>{},connection:{application_name:`${prefix}-${label}`,statement_timeout:15000,lock_timeout:12000}});
  const admin=connect('admin'),a=connect('a'),b=connect('b');
  const owner=randomUUID(),member=randomUUID();
  const sql=await readFile(new URL('../supabase/pending/learning_portfolio_v1.sql',import.meta.url),'utf8');
  const signature='public.learning_portfolio_write(integer,uuid,text,jsonb,jsonb)';
  let installed=false,seeded=false;
  const call=async(conn,revision,action,draft={courses:[]},snapshot=null,actor=owner)=>(await conn.unsafe(
    'select public.learning_portfolio_write($1,$2,$3,$4::jsonb,$5::jsonb) as result',
    [revision,actor,action,JSON.stringify(draft),snapshot===null?null:JSON.stringify(snapshot)]))[0].result;
  const row=async()=>(await admin.unsafe('select * from public.learning_portfolio order by key'));
  const service=(conn,fn)=>conn.begin(async tx=>{await tx.unsafe('set local role service_role');return fn(tx);});
  const blocked=async count=>{
    const deadline=Date.now()+5000;
    do {
      const result=await admin.unsafe("select count(*)::integer as n from pg_stat_activity where datname=current_database() and application_name in ($1,$2) and wait_event_type='Lock'",[`${prefix}-a`,`${prefix}-b`]);
      if(result[0].n>=count)return;
      await new Promise(r=>setTimeout(r,20));
    }while(Date.now()<deadline);
    throw Error(`Expected ${count} actual PostgreSQL lock wait(s)`);
  };
  try {
    const state=(await admin.unsafe("select to_regclass('supabase_migrations.schema_migrations') is not null as migrations,to_regprocedure('auth.uid()') is not null as auth,to_regclass('public.learning_external_credentials') is not null as credentials,to_regclass('public.learning_portfolio') as portfolio,to_regprocedure($1) as rpc",[signature]))[0];
    assert.ok(state.migrations&&state.auth&&state.credentials,'full canonical reset and managed auth required; no stub fallback');
    assert.equal(state.portfolio,null,'refuse to modify an existing portfolio table');
    assert.equal(state.rpc,null,'refuse to replace an existing portfolio RPC');
    assert.ok((await admin.unsafe('select count(*)::integer as n from supabase_migrations.schema_migrations'))[0].n>0);
    assert.equal((await admin.unsafe("select count(*)::integer as n from public.orgs where slug='mccluster'"))[0].n,1);
    await admin.begin(async tx=>{
      await tx.unsafe("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,'{}','{}'),($3,$4,'{}','{}')",[owner,`${owner}@portfolio.fixture.invalid`,member,`${member}@portfolio.fixture.invalid`]);
      await tx.unsafe("insert into public.org_members(org_id,profile_id,role) select id,$1,'owner' from public.orgs where slug='mccluster'",[owner]);
      await tx.unsafe("insert into public.org_members(org_id,profile_id,role) select id,$1,'staff' from public.orgs where slug='mccluster'",[member]);
    });
    seeded=true;
    await admin.begin(tx=>tx.unsafe(sql));installed=true;
    await admin.begin(tx=>tx.unsafe(sql));
    const policy=(await admin.unsafe("select c.relrowsecurity as rls,p.prosecdef as definer from pg_class c,pg_proc p where c.oid='public.learning_portfolio'::regclass and p.oid=$1::regprocedure",[signature]))[0];
    assert.deepEqual(policy,{rls:true,definer:false});
    for(const role of ['anon','authenticated']) {
      await assert.rejects(admin.begin(async tx=>{await tx.unsafe(`set local role ${role}`);await tx.unsafe('select * from public.learning_portfolio');}),e=>e.code==='42501');
      await assert.rejects(admin.begin(async tx=>{await tx.unsafe(`set local role ${role}`);await call(tx,0,'save');}),e=>e.code==='42501');
    }
    await admin.begin(async tx=>{
      await tx.unsafe('set local role authenticated');
      await tx.unsafe("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[owner,JSON.stringify({sub:owner,role:'authenticated'})]);
      assert.equal((await tx.unsafe('select auth.uid() as id'))[0].id,owner);
    });
    await service(a,tx=>tx.unsafe('select external_program,issuer,title,verification_status,verified_by,verified_at,user_id from public.learning_external_credentials where user_id=$1',[owner]));
    await assert.rejects(service(a,tx=>call(tx,0,'save',{},null,member)),/owner required/);
    for(const [revision,action] of [[null,'save'],[-1,'save'],[0,null]])await assert.rejects(service(a,tx=>call(tx,revision,action)),e=>e.code==='22023');
    assert.deepEqual(await row(),[]);
    console.log('PASS canonical managed auth, service credential dependency, RLS/client denial, invalid inputs insert nothing');

    // First-ever save: the second session must really wait on the unique insert.
    let release,ready;
    const hold=new Promise(r=>release=r),started=new Promise(r=>ready=r);
    const first=service(a,async tx=>{const result=await call(tx,0,'save',{marker:'first'});ready();await hold;return result;});
    let second;
    try {await Promise.race([started,first.then(()=>{throw Error('first save ended before barrier');})]);second=service(b,tx=>call(tx,0,'save',{marker:'second'}));second.catch(()=>{});await blocked(1);}
    finally {release();await Promise.allSettled([first,second].filter(Boolean));}
    assert.equal((await first).revision,1);assert.equal(await second,null);
    assert.deepEqual((await row())[0].draft,{marker:'first'});
    console.log('PASS concurrent initial insert: observed lock wait, one successful revision, loser cannot overwrite');

    // Existing row: hold the row while two different mutations queue at the same revision.
    let unlock,locked;
    const held=new Promise(r=>unlock=r),isLocked=new Promise(r=>locked=r);
    const locker=admin.begin(async tx=>{await tx.unsafe("select * from public.learning_portfolio where key='matthew' for update");locked();await held;});
    let save,publish;
    try {
      await Promise.race([isLocked,locker.then(()=>{throw Error('lock ended before barrier');})]);
      save=service(a,tx=>call(tx,1,'save',{marker:'new-private'}));
      publish=service(b,tx=>call(tx,1,'publish',{}, {marker:'public-selection'}));
      save.catch(()=>{});publish.catch(()=>{});
      // Admin is holding the transaction, so inspect waits through a separate connection.
      const observer=connect('observer');
      try {
        const deadline=Date.now()+5000;let waits=0;
        while(Date.now()<deadline){waits=(await observer.unsafe("select count(*)::integer as n from pg_stat_activity where datname=current_database() and application_name in ($1,$2) and wait_event_type='Lock'",[`${prefix}-a`,`${prefix}-b`]))[0].n;if(waits===2)break;await new Promise(r=>setTimeout(r,20));}
        assert.equal(waits,2,'both mutations must reach an actual row lock wait');
      }finally{await observer.end();}
    }finally{unlock();await Promise.allSettled([locker,save,publish].filter(Boolean));}
    const saved=await save,published=await publish;
    assert.equal(Number(!!saved)+Number(!!published),1);
    const afterRace=(await row())[0];assert.equal(afterRace.revision,2);
    assert.deepEqual(afterRace.draft,saved?{marker:'new-private'}:{marker:'first'});
    assert.deepEqual(afterRace.published,published?{marker:'public-selection'}:null);
    console.log('PASS concurrent save/publication: two observed waits, one winner, draft/snapshot reflect only winner');

    const before=await row();
    for(const [revision,action] of [[null,'save'],[-1,'save'],[2,null]])await assert.rejects(service(a,tx=>call(tx,revision,action)),e=>e.code==='22023');
    assert.deepEqual(await row(),before);
    await assert.rejects(service(a,async tx=>{await call(tx,2,'save',{marker:'rolled-back'});throw Error('intentional rollback');}),/intentional rollback/);
    assert.deepEqual(await row(),before);
    assert.equal((await service(a,tx=>call(tx,2,'unpublish'))).revision,3);
    const preserved=await row();assert.equal(preserved[0].published,null);assert.deepEqual(preserved[0].draft,before[0].draft);
    await admin.begin(async tx=>{
      await tx.unsafe(`revoke all on function ${signature} from public,anon,authenticated,service_role`);
      await tx.unsafe('revoke all on public.learning_portfolio from public,anon,authenticated,service_role');
    });
    await assert.rejects(service(a,tx=>call(tx,3,'save')),e=>e.code==='42501');
    await assert.rejects(service(a,tx=>tx.unsafe('select * from public.learning_portfolio')),e=>e.code==='42501');
    assert.deepEqual(await row(),preserved);
    await admin.begin(tx=>tx.unsafe(sql));
    assert.equal((await service(a,tx=>call(tx,3,'save',{marker:'restored'}))).revision,4);
    console.log('PASS invalid/stale guards, transaction rollback, unpublish retention, permission rollback/reapply');
  }finally{
    await Promise.all([a.end(),b.end()]);
    try {
      if(installed)await admin.begin(async tx=>{await tx.unsafe(`drop function ${signature}`);await tx.unsafe('drop table public.learning_portfolio');});
      if(seeded)await admin.begin(async tx=>{await tx.unsafe('delete from public.org_members where profile_id in ($1,$2)',[owner,member]);await tx.unsafe('delete from auth.users where id in ($1,$2)',[owner,member]);});
    }finally{await admin.end();}
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
