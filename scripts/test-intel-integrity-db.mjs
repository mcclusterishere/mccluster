// Real SQL behavioral replay in isolated PostgreSQL/WASM. Install a pinned
// @electric-sql/pglite outside the repo, then set PGLITE_ROOT to that package.
// Native CI mode also exercises real PostgreSQL lock waits and concurrent writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { persistProposal } from '../supabase/functions/context-decision/proposals.mjs';

import { nativeTestDb, migrationPath, waitForBlocked } from './native-admin-test-db.mjs';
let db;
if (process.env.NATIVE_TEST_DATABASE_URL) db = await nativeTestDb('intel');
else {
  const root = process.env.PGLITE_ROOT;
  if (!root) throw new Error('Set PGLITE_ROOT to an installed @electric-sql/pglite package');
  const { PGlite } = await import(pathToFileURL(resolve(root, 'dist/index.js')));
  const { pgcrypto } = await import(pathToFileURL(resolve(root, 'dist/contrib/pgcrypto.js')));
  db = new PGlite({ extensions: { pgcrypto } });
}
const apply = async file => {
  const sql = (await readFile(file, 'utf8')).replace(/^\\.*$/gm, '');
  await db.exec(sql);
  console.log(`passed ${file}`);
};
function sqlTag(conn) {
  const tag = async (strings, ...values) => {
    const args = values.map((v,i) => v?.__json ? JSON.stringify(v.value)
      : Array.isArray(v) && strings[i+1].startsWith('::uuid[]') ? `{${v.join(',')}}` : v);
    const query = strings.reduce((s,x,i) => s+x+(i<args.length ? `$${i+1}` : ''), '');
    return (await conn.query(query,args)).rows;
  };
  tag.json = value => ({ __json: true, value });
  tag.begin = callback => conn.transaction(tx => callback(sqlTag(tx)));
  return tag;
}
const sql = sqlTag(db);
const ORG='00000000-0000-4000-8000-0000000000a1';
const OTHER='00000000-0000-4000-8000-0000000000a2';
const OWNER='00000000-0000-4000-8000-00000000000b';
const MEMBER='00000000-0000-4000-8000-00000000000c';
const one = async (q,args=[]) => (await db.query(q,args)).rows[0];
try {
  await apply('supabase/tests/supabase_api_roles.stub.sql');
  await apply('supabase/tests/intel_canon_deps.stub.sql');
  await apply('supabase/replay_migrations/20261005063813_canonical_ai_context_decisions_v1.sql');
  await apply('supabase/migrations/20261002061056_action_network_gamification_v1.sql');
  await db.exec(`alter table public.action_missions add column kind text not null default 'civic';
    create table public.control_audit (id bigint generated always as identity primary key,
      org_id uuid references public.orgs(id),actor_user_id uuid references auth.users(id),
      actor_kind text not null default 'system',event text not null,capability text,
      resource_type text,resource_id text,command_id uuid,detail jsonb not null default '{}',at timestamptz not null default now());`);
  await apply('supabase/migrations/20261017030617_intel_mission_canon_v1.sql');
  await apply(await migrationPath('intel_decision_integrity_v2'));
  await apply('supabase/tests/intel_mission_canon.behaviour.sql');
  const oldBriefing=(await one("select v from t_ids where k='briefing'")).v;
  const claim=(await one("select v from t_ids where k='claim'")).v;
  const evidence=(await one("select v from t_ids where k='e1'")).v;
  // Accepted outcome feedback is new evidence, so the prior final briefing
  // requires re-review. Review the added link and create a fresh fixture brief.
  assert.equal((await one('select status from public.intel_briefings where id=$1',[oldBriefing])).status,'draft');
  await db.query("select public.intel_review($1,$2,'claim',$3,'supported','Reviewed outcome feedback')",[ORG,OWNER,claim]);
  const briefing=(await one(`select public.intel_create_briefing($1,$2,'Reviewed follow-up','Fixture with reviewed outcome feedback',
    (select jsonb_agg(jsonb_build_object('claim_id',claim_id,'evidence_id',evidence_id,'locator',locator) order by ordinal)
      from public.intel_briefing_citations where briefing_id=$3)) as r`,[ORG,OWNER,oldBriefing])).r.briefing_id;

  const input={ title:'Review preparedness response', decision:'Prepare one follow-up mission', rationale_summary:'Reviewed USGS evidence',
    risk_class:'low',status:'proposed',idempotency_key:'partial-write-case',metadata:{source:'mccluster-intel',intel_briefing_id:briefing} };
  if (db.native) {
    const peer=db.fork(), peer2=db.fork();
    try {
      const raceInput={...input,idempotency_key:'native-concurrent-proposal'};
      let release; const hold=new Promise(resolve=>{release=resolve;});
      let held; const ready=new Promise(resolve=>{held=resolve;});
      const blocker=db.transaction(async tx=>{
        await tx.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([ORG,OWNER,raceInput.idempotency_key])]);
        held(); await hold;
      });
      await ready;
      const pending=Promise.all([peer,peer2].map(conn=>persistProposal(sqlTag(conn),ORG,OWNER,raceInput)));
      const observer=db.fork();
      try { await waitForBlocked(observer,2); } finally { release(); await observer.close(); }
      await blocker;
      const [firstRace,secondRace]=await pending;
      assert.equal(secondRace.decision.id,firstRace.decision.id);
      assert.equal(Number(firstRace.created)+Number(secondRace.created),1);
      // Both sessions race to persist the basis and audit for the same proposal.
      await Promise.all([db,peer].map(conn=>conn.query('select public.intel_record_decision_basis($1,$2,$3,$4)',[ORG,OWNER,firstRace.decision.id,briefing])));
      assert.equal((await one("select count(*)::int as n from public.control_audit where resource_id=$1 and event='intel.decision.proposed'",[firstRace.decision.id])).n,1);
      assert.equal((await one("select count(*)::int as n from ai_context.decisions where metadata->>'idempotency_key'=$1",[raceInput.idempotency_key])).n,1);
      console.log('native Intel: real advisory-lock wait, same proposal ID and one audit receipt across sessions passed');
    } finally { await peer.close(); await peer2.close(); }
  }
  const first=await persistProposal(sql,ORG,OWNER,input);
  assert.equal(first.created,true);
  const id=first.decision.id;
  const basis=()=>db.query('select public.intel_record_decision_basis($1,$2,$3,$4) as result',[ORG,OWNER,id,briefing]);
  const readiness=async()=> (await one('select public.intel_decision_readiness($1,$2) as r',[ORG,id])).r;
  const approve=()=>db.query("update ai_context.decisions set status='approved',approved_by=$1,approved_at=now() where id=$2",[OWNER,id]);
  await db.exec(`create function public.test_ledger_down() returns trigger language plpgsql as $$ begin raise exception 'ledger unavailable'; end $$;
    create trigger test_ledger_down before insert on public.control_audit for each row execute function public.test_ledger_down();`);
  await assert.rejects(basis,/ledger unavailable/);
  assert.equal((await readiness()).actionable,false);
  assert.equal((await readiness()).audit.state,'pending');
  await assert.rejects(approve,/reviewed basis and recorded receipt/);
  assert.equal((await one('select count(*)::int as n from public.intel_decision_basis where decision_id=$1',[id])).n,0);
  await db.exec('drop trigger test_ledger_down on public.control_audit; drop function public.test_ledger_down();');
  const retry=await persistProposal(sql,ORG,OWNER,input);
  assert.equal(retry.created,false); assert.equal(retry.decision.id,id);
  await basis(); await basis();
  assert.equal((await one("select count(*)::int as n from public.control_audit where resource_id=$1 and event='intel.decision.proposed'",[id])).n,1);
  await assert.rejects(()=>persistProposal(sql,ORG,OWNER,{...input,title:'Changed under same key'}),/different proposal/);
  await assert.rejects(()=>persistProposal(sql,ORG,OWNER,{...input,idempotency_key:null}),/idempotency key/);
  const other=await persistProposal(sql,OTHER,OWNER,input);
  assert.notEqual(other.decision.id,id,'org isolates retry key');
  await assert.rejects(()=>db.query('select public.intel_record_decision_basis($1,$2,$3,$4)',[OTHER,OWNER,other.decision.id,briefing]),/owner\/admin required/);
  await assert.rejects(()=>db.query('select public.intel_record_decision_basis($1,$2,$3,$4)',[ORG,MEMBER,id,briefing]),/owner\/admin required/);
  await assert.rejects(()=>db.query('insert into public.intel_decision_basis(org_id,decision_id,briefing_id,recorded_by) values($1,$2,$3,$4)',[ORG,other.decision.id,briefing,OWNER]),/foreign key/);
  // A JSON null aggregate is not a citation. A formerly final brief with all
  // citations removed must fail even if an operator restores its status alone.
  await db.exec('create temp table saved_citations as table public.intel_briefing_citations');
  await db.query('delete from public.intel_briefing_citations where briefing_id=$1',[briefing]);
  await db.query("update public.intel_briefings set status='final' where id=$1",[briefing]);
  assert.equal((await readiness()).basis.valid,false,'empty citations cannot be approved');
  await assert.rejects(approve,/reviewed basis and recorded receipt/);
  await db.query('insert into public.intel_briefing_citations select * from saved_citations where briefing_id=$1',[briefing]);
  await db.query("update public.intel_briefings set status='final' where id=$1",[briefing]);
  await db.query("update ai_context.decisions set metadata=jsonb_set(metadata,'{intel_receipt,audit_id}','-1') where id=$1",[id]);
  assert.equal((await readiness()).audit.state,'missing');
  assert.equal((await readiness()).audit.recorded,false);
  await assert.rejects(approve,/reviewed basis and recorded receipt/);
  await basis();
  await approve(); assert.equal((await readiness()).actionable,true);
  await db.query("update public.org_members set role='member' where org_id=$1 and profile_id=$2",[ORG,OWNER]);
  assert.equal((await readiness()).actionable,false,'revoked approver has no execution authority');
  await db.query("update public.org_members set role='owner' where org_id=$1 and profile_id=$2",[ORG,OWNER]);
  await assert.rejects(()=>db.query("update ai_context.decisions set decision='silently changed' where id=$1",[id]),/immutable/);
  const missionArgs=[ORG,OWNER,id,'reviewed-mission','{"title":"Preparedness follow-up"}'];
  const mission=(await one('select public.intel_create_mission_from_decision($1,$2,$3,$4,$5) as r',missionArgs)).r;
  assert.equal(mission.created,true);
  assert.equal((await one('select public.intel_create_mission_from_decision($1,$2,$3,$4,$5) as r',missionArgs)).r.created,false);
  await db.query("update public.org_members set role='member' where org_id=$1 and profile_id=$2",[ORG,OWNER]);
  await assert.rejects(()=>db.query("update public.action_missions set status='open' where id=$1",[mission.mission_id]),/authorized approver/);
  await assert.rejects(()=>db.query("insert into public.action_mission_assignments(mission_id,user_id,status) values($1,$2,'joined')",[mission.mission_id,MEMBER]),/authorized approver/);
  await db.query("update public.org_members set role='owner' where org_id=$1 and profile_id=$2",[ORG,OWNER]);
  await db.query("update public.action_missions set status='open' where id=$1",[mission.mission_id]);
  await db.query("select public.intel_review($1,$2,'claim',$3,'retracted','Source review changed')",[ORG,OWNER,claim]);
  assert.equal((await readiness()).needs_review,true);
  await assert.rejects(()=>db.query("insert into public.action_mission_assignments(mission_id,user_id,status) values($1,$2,'joined')",[mission.mission_id,MEMBER]),/authorized approver/);
  assert.equal((await one('select status from public.intel_briefings where id=$1',[briefing])).status,'draft','retracted claim visibly queues briefing review');
  await assert.rejects(()=>db.query('select public.intel_create_mission_from_decision($1,$2,$3,$4,$5)',[ORG,OWNER,id,'after-retraction','{"title":"Must fail"}']),/reviewed basis changed/);
  await db.query("select public.intel_review($1,$2,'claim',$3,'supported','Re-review')",[ORG,OWNER,claim]);
  assert.equal((await readiness()).actionable,false,'re-review never revives old approval');
  await db.query("update public.intel_briefings set status='final' where id=$1",[briefing]);
  await db.query("update public.intel_evidence set source_url='https://example.test/corrected' where id=$1",[evidence]);
  assert.equal((await one('select review_status from public.intel_evidence where id=$1',[evidence])).review_status,'unreviewed');
  assert.equal((await one('select status from public.intel_briefings where id=$1',[briefing])).status,'draft');
  await db.query("select public.intel_review($1,$2,'evidence',$3,'accepted','Review correction')",[ORG,OWNER,evidence]);
  await db.query("select public.intel_review($1,$2,'claim',$3,'supported','Review corrected source')",[ORG,OWNER,claim]);
  // Upstream revision enters through the real collector commit and queues the
  // prior accepted evidence plus affected claim for review.
  await db.query("update public.ops_ingest_records set source_ref=jsonb_build_object('updated_at','2026-10-15T01:30:00Z') where id=(select source_record_id from public.intel_evidence where id=$1)",[evidence]);
  await db.exec("update public.ops_ingest_runs set started_at=now()-interval '2 hours',finished_at=now()-interval '1 hour'");
  const run=(await one('select public.intel_collector_begin($1,$2,$3,900) as r',[ORG,'usgs.earthquakes','{}'])).r;
  assert.equal((await one("select public.intel_revision_time('2026-10-15T00:30:00-03:00') > public.intel_revision_time('2026-10-15T01:30:00Z') as later")).later,true);
  assert.equal((await one("select public.intel_revision_time('invalid') as t")).t,null);
  const changed=[{external_id:'us7000aaaa',record_kind:'earthquake',idempotency_key:'usgs:us7000aaaa:revision2',content_hash:'d'.repeat(64),title:'Corrected seismic report',observed_at:'2026-10-15T01:00:00Z',source_ref:{updated_at:'2026-10-15T00:30:00-03:00'}}];
  await db.query('select public.intel_collector_commit($1,$2,$3,$4)',[ORG,run.run_id,JSON.stringify(changed),'{}']);
  assert.equal((await one('select review_status from public.intel_evidence where id=$1',[evidence])).review_status,'unreviewed');
  assert.equal((await one('select status from public.intel_claims where id=$1',[claim])).status,'under_review');
  assert.equal((await readiness()).actionable,false);
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(()=>readiness(),/permission denied/);
    await db.exec('reset role');
  }
  const counts=()=>one('select (select count(*) from ai_context.decisions) as decisions,(select count(*) from public.intel_evidence) as evidence,(select count(*) from public.control_audit) as audit');
  const retained=await counts();
  await apply('docs/control-plane/admin-evidence-20261020/intel-rollback.sql');
  assert.deepEqual(await counts(),retained,'rollback retains durable evidence and receipts');
  assert.equal((await one("select to_regprocedure('public.intel_decision_readiness(uuid,uuid)') is null as removed")).removed,true);
  console.log('Intel integrity: full canonical loop plus partial write/receipt repair, replay, key conflict, org/role isolation, approval freeze, correction/retraction, stale approval, empty citations, action guards and non-destructive rollback passed.');
} finally { await db.close(); }
