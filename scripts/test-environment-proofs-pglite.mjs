// Socket-free PostgreSQL rehearsal, using canonical submit/review/share SQL.
// Not a claim of native concurrent locking coverage or production application.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH||'/tmp/owner-postgres-tools/node_modules/@electric-sql/pglite/dist/index.js'));
const db=new PGlite();
const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000003';
const identity=async id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
const reviewRevision=async id=>(await db.query('select world_environment_proofs() as r')).rows[0].r.proofs.find(p=>p.proof_id===id).proof_revision;
const reviewProof=async(id,decision,note=null,revision=null)=>db.query('select world_environment_proof_review($1,$2,$3,$4) as r',[id,decision,revision??await reviewRevision(id),note]);
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function public.current_m_uid() returns uuid language sql as $$select auth.uid()$$;create function public.eu_is_admin() returns boolean language sql as $$select auth.uid()='${owner}'::uuid$$;create table public.m_people(id uuid primary key);create table public.action_campaigns(id text primary key);create table public.orgs(id uuid primary key,slug text);create table public.org_members(org_id uuid,profile_id uuid,role text);create table public.m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);create table public.platform_apps(id uuid,app_key text,enabled boolean);create table public.network_posts(id uuid primary key default gen_random_uuid(),author_m_uid uuid,body text,post_type text,visibility text,metadata jsonb,source_app_id uuid,deleted_at timestamptz,removed_at timestamptz);create table public.network_notifications(recipient_m_uid uuid,actor_m_uid uuid,type text,object_type text,object_id text,body text,metadata jsonb);create table public.network_media_assets(id uuid,media_type text,owner_m_uid uuid,status text);grant usage on schema public,auth to authenticated,anon;`);
 await db.exec(await read('supabase/migrations/20261002061056_action_network_gamification_v1.sql'));
 await db.exec(await read('supabase/migrations/20261002135458_action_network_feed_shares_v1.sql'));
 await db.exec("alter table network_posts add column media jsonb; alter table network_posts add constraint fixture_canonical_post_cap check(char_length(body)<=2000);");
 const camera=await read('supabase/migrations/20261003023055_action_mission_camera_loop_v1.sql');
 await db.exec(camera.slice(camera.indexOf('create or replace function public.action_share_assignment_internal')));
 await db.exec(await read('supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql'));
 // Minimal environmental provenance fixture; canonical team/join authorization
 // is independently exercised by test-environment-pglite.mjs.
 await db.exec(`create table public.action_environment_missions(mission_id uuid primary key references action_missions(id),approved_by uuid);insert into auth.users values('${owner}'),('${member}'),('${other}');insert into m_people select id from auth.users;insert into m_auth_user_links select id,id,true from auth.users;insert into orgs values('${owner}','mccluster');insert into org_members values('${owner}','${owner}','owner');`);
 await db.exec(await read('supabase/pending/20261108120000_world_environment_proofs_v1.sql'));
 const mission=(await db.query("insert into action_missions(title,status,skills) values('Remote environmental support','open',array['research']) returning id")).rows[0].id;
 await db.query('insert into action_environment_missions values($1,$2)',[mission,owner]);
 await identity(member);
 const assignment=(await db.query('select join_action_mission($1) as r',[mission])).rows[0].r.assignment_id;
 const submit=async(share=false,text='I checked public support hours and documented accessible options.')=>(await db.query("select world_environment_proof_submit($1,'text',$2,null,$3,true) as r",[assignment,text,share])).rows[0].r;
 await db.exec('set role authenticated');
 assert.equal((await db.query('select world_environment_proof_read($1) as r',[assignment])).rows[0].r.proof,null);
 const first=await submit(true);assert.equal(first.status,'submitted');
 await assert.rejects(submit(false,'tiny'),/invalid_proof/);
 assert.equal((await db.query('select world_environment_proof_read($1) as r',[assignment])).rows[0].r.share,true);
 await submit(false);
 await identity(other);
 for(const query of ['select world_environment_proof_read($1)','select world_environment_proof_share($1,true,true)'])await assert.rejects(db.query(query,[assignment]),/assignment_not_found/);
 await assert.rejects(submit(),/assignment_not_found/);
 await assert.rejects(db.query('select world_environment_proofs()'),/owner_only/);
 await assert.rejects(db.query("select world_environment_proof_review($1,'verified',$2,null)",[first.proof_id,'0'.repeat(32)]),/owner_only/);
 await identity(owner);
 assert.equal((await db.query('select world_environment_proofs() as r')).rows[0].r.proofs.length,1);
 await reviewProof(first.proof_id,'rejected','Please give dated sources.');
 await identity(member);
 const retry=await submit(false);assert.equal(retry.retry,true);assert.equal(retry.proof_id,first.proof_id);
 await identity(owner);
 const verified=(await reviewProof(first.proof_id,'verified')).rows[0].r;assert.equal(verified.awarded,true);
 assert.equal((await reviewProof(first.proof_id,'verified')).rows[0].r.awarded,false);
 await identity(member);
 await assert.rejects(submit(true),/not taking proof/);
 let saved=(await db.query('select world_environment_proof_read($1) as r',[assignment])).rows[0].r;assert.equal(saved.post_id,null);assert.equal(saved.share,false);assert.equal(saved.can_submit,false);assert.equal(saved.can_share,true);
 await assert.rejects(db.query('select world_environment_proof_share($1,true,false)',[assignment]),/proof_consent_required/);
 const shared=(await db.query('select world_environment_proof_share($1,true,true) as r',[assignment])).rows[0].r;assert.ok(shared.post_id);
 assert.equal((await db.query('select world_environment_proof_share($1,true,true) as r',[assignment])).rows[0].r.post_id,shared.post_id);
 assert.equal((await db.query('select world_environment_proof_share($1,false,false) as r',[assignment])).rows[0].r.post_id,shared.post_id);
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from action_points_ledger')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from action_proof_review_history')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from network_notifications')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from network_posts')).rows[0].n,1);

 // Exercise the real live-required trigger without enabling capture or uploads.
 await db.exec(`create table action_live_controls(id boolean,enforce_live_required boolean);insert into action_live_controls values(true,true);create table action_mission_live_policies(mission_id uuid,live_mode text);create table action_live_sessions(id uuid,assignment_id uuid,status text);`);
 const live=await read('supabase/pending/live_missions_v1.sql');
 await db.exec(live.slice(live.indexOf('create or replace function public.action_live_required_proof_guard()'),live.indexOf('-- the private bucket')));
 const mission2=(await db.query("insert into action_missions(title,status) values('Live gated fixture','open') returning id")).rows[0].id;
 await db.query('insert into action_environment_missions values($1,$2)',[mission2,owner]);
 const assignment2=(await db.query('select join_action_mission($1) as r',[mission2])).rows[0].r.assignment_id;
 await assert.rejects(db.query("select world_environment_proof_submit($1,'text','A substantial statement cannot bypass live gates.',null,true,true)",[assignment2]),/completed live/);
 assert.equal((await db.query('select count(*)::int n from action_share_intents where assignment_id=$1',[assignment2])).rows[0].n,0);
 await db.exec('update action_live_controls set enforce_live_required=false');
 const proof2=(await db.query("select world_environment_proof_submit($1,'text','I checked the public environmental support resources.',null,true,true) as r",[assignment2])).rows[0].r.proof_id;
 await identity(owner);await reviewProof(proof2,'verified');
 assert.equal((await db.query('select count(*)::int n from action_feed_shares where assignment_id=$1',[assignment2])).rows[0].n,1);


 // Exact consent publication, recovery, and legacy/nonenvironment boundaries.
 const evidence='I verified the dated public shelter resource and its accessible entrance.';
 const url='https://example.invalid/public-evidence';
 async function createProof({environment=true,share=true,legacy=false,statement=evidence,link=url}={}) {
   await db.exec('reset role');await identity(member);
   const m=(await db.query("insert into action_missions(title,status) values('Publication fixture','open') returning id")).rows[0].id;
   if(environment)await db.query('insert into action_environment_missions values($1,$2)',[m,owner]);
   const a=(await db.query('select join_action_mission($1) as r',[m])).rows[0].r.assignment_id;
   let p;
   if(legacy){p=(await db.query("select submit_action_proof($1,'link',$2,$3,'{}') as r",[a,link,statement])).rows[0].r;await db.query('select set_action_share_intent($1,$2)',[a,share]);}
   else p=(await db.query("select world_environment_proof_submit($1,'link',$2,$3,$4,true) as r",[a,statement,link,share])).rows[0].r;
   return {a,p:p.proof_id,m};
 }
 async function verify(f){await identity(owner);await db.query("select review_action_proof($1,'verified','PRIVATE REVIEW NOTE')",[f.p]);}
 async function state(f){await identity(member);return (await db.query('select world_environment_proof_read($1) as r',[f.a])).rows[0].r;}
 async function body(f){return (await db.query('select n.body from network_posts n join action_feed_shares s on s.post_id=n.id where s.assignment_id=$1',[f.a])).rows[0]?.body;}
 const opted=await createProof();await verify(opted);
 assert.equal((await state(opted)).proof_published,true);assert.equal(await body(opted),evidence+'\n\n'+url);
 assert.doesNotMatch(await body(opted),/PRIVATE REVIEW NOTE|metadata/);
 await db.query('select world_environment_proof_share($1,false,false)',[opted.a]);assert.equal((await state(opted)).proof_published,true);
 // A real edit, moderation or deletion invalidates the receipt, never just post_id.
 await db.query("update network_posts set body='Author edited the public post' where id=(select post_id from action_feed_shares where assignment_id=$1)",[opted.a]);assert.equal((await state(opted)).proof_published,false);
 const off=await createProof({share:false,link:url+'/off'});await verify(off);assert.equal((await state(off)).proof_published,false);assert.equal(await body(off),undefined);
 const legacy=await createProof({legacy:true,link:url+'/legacy'});await verify(legacy);assert.equal((await state(legacy)).proof_published,false);assert.match(await body(legacy),/^I did something about it:/);assert.doesNotMatch(await body(legacy),/shelter/);
 const nonenv=await createProof({environment:false,legacy:true,link:url+'/nonenvironment'});await verify(nonenv);assert.match(await body(nonenv),/^I did something about it:/);assert.doesNotMatch(await body(nonenv),/shelter/);
 // Generic corrected proof cannot inherit consent for a different snapshot.
 const replaced=await createProof({link:url+'/before'});await identity(owner);await db.query("select review_action_proof($1,'rejected','Needs corrected sources')",[replaced.p]);await identity(member);
 await db.query("select submit_action_proof($1,'link',$2,'Different evidence replacing the rejected private original.','{}')",[replaced.a,url+'/after']);await verify(replaced);
 assert.equal((await state(replaced)).proof_published,false);assert.match(await body(replaced),/^I did something about it:/);
 const publishedRetry=(await db.query('select world_environment_proof_share($1,true,true) as r',[replaced.a])).rows[0].r;assert.equal(publishedRetry.proof_published,true);assert.equal(await body(replaced),'Different evidence replacing the rejected private original.\n\n'+url+'/after');
 // Enrichment failure leaves verification and card intact; explicit retry fixes.
 const broken=await createProof({link:url+'/failure'});
 await db.exec(`create function fixture_fail_publication() returns trigger language plpgsql as $$begin if new.body like 'I verified%' then raise exception 'fixture outage';end if;return new;end$$;create trigger fixture_fail_publication before update of body on network_posts for each row execute function fixture_fail_publication();`);
 await verify(broken);assert.equal((await state(broken)).status,'verified');assert.equal((await state(broken)).proof_published,false);assert.match(await body(broken),/^I did something about it:/);
 await db.exec('drop trigger fixture_fail_publication on network_posts');
 assert.equal((await db.query('select world_environment_proof_share($1,true,true) as r',[broken.a])).rows[0].r.proof_published,true);
 // Canonical card creation failure is also recoverable, with no false post.
 const noCard=await createProof({link:url+'/card-failure'});
 await db.exec(`create function fixture_fail_card() returns trigger language plpgsql as $$begin raise exception 'fixture card outage';end$$;create trigger fixture_fail_card before insert on network_posts for each row execute function fixture_fail_card();`);
 await verify(noCard);assert.equal((await state(noCard)).status,'verified');assert.equal((await state(noCard)).post_id,null);assert.equal((await state(noCard)).proof_published,false);
 await db.exec('drop trigger fixture_fail_card on network_posts');assert.equal((await db.query('select world_environment_proof_share($1,true,true) as r',[noCard.a])).rows[0].r.proof_published,true);
 // No truncation to force a proof under the canonical 2,000 character post cap.
 await assert.rejects(createProof({statement:'x'.repeat(2000),link:url+'/long'}),/proof_too_long_for_sharing/);
 await identity(owner);


 // Review revision binds the owner decision to the exact evidence displayed.
 const changed=await createProof({link:url+'/revision'});await identity(owner);
 const displayed=await reviewRevision(changed.p);assert.match(displayed,/^[0-9a-f]{32}$/);
 await identity(member);assert.equal((await state(changed)).proof.proof_revision,displayed);
 await db.query("select world_environment_proof_submit($1,'text','Replacement evidence the owner has not yet seen.',null,true,true)",[changed.a]);
 await identity(owner);
 const countsBeforeStale=(await db.query('select (select count(*) from action_points_ledger)::int points,(select count(*) from network_posts)::int posts')).rows[0];
 await assert.rejects(reviewProof(changed.p,'verified',null,displayed),/proof_changed/);
 assert.deepEqual((await db.query('select (select count(*) from action_points_ledger)::int points,(select count(*) from network_posts)::int posts')).rows[0],countsBeforeStale);
 const replacementRevision=await reviewRevision(changed.p);assert.notEqual(replacementRevision,displayed);
 await reviewProof(changed.p,'rejected','Please reconfirm the source.',replacementRevision);
 await identity(member);
 // Same text, same proof ID, rejected retry: status/review timestamps/created_at
 // still make this a new review event, even though its content did not change.
 await db.query("select world_environment_proof_submit($1,'text','Replacement evidence the owner has not yet seen.',null,true,true)",[changed.a]);
 await identity(owner);const retriedRevision=await reviewRevision(changed.p);assert.notEqual(retriedRevision,replacementRevision);
 await assert.rejects(reviewProof(changed.p,'verified',null,replacementRevision),/proof_changed/);
 assert.equal((await reviewProof(changed.p,'verified',null,retriedRevision)).rows[0].r.awarded,true);
 // Missing revision never downgrades to the unversioned canonical wrapper.
 await assert.rejects(reviewProof(changed.p,'verified',null,''),/invalid_proof/);
 assert.equal((await db.query("select to_regprocedure('public.world_environment_proof_review(uuid,text,text)') as f")).rows[0].f,null);
 // Existing self-review prohibition remains, with a current legitimate token.
 await identity(owner);
 const selfMission=(await db.query("insert into action_missions(title,status) values('Owner evidence fixture','open') returning id")).rows[0].id;
 await db.query('insert into action_environment_missions values($1,$2)',[selfMission,owner]);
 const selfAssignment=(await db.query('select join_action_mission($1) as r',[selfMission])).rows[0].r.assignment_id;
 const selfProof=(await db.query("select world_environment_proof_submit($1,'text','The owner submitted this evidence and cannot self-review.',null,false,true) as r",[selfAssignment])).rows[0].r.proof_id;
 await assert.rejects(reviewProof(selfProof,'verified'),/cannot review your own proof/);

 // Older pending work must not be starved by newer completed review records.
 await db.exec(`insert into auth.users select gen_random_uuid() from generate_series(1,202);insert into action_mission_assignments(mission_id,user_id,m_uid,status) select '${mission}',id,id,'submitted' from auth.users where id not in ('${owner}','${member}','${other}');insert into action_proofs(assignment_id,user_id,proof_type,statement,status,created_at) select a.id,a.user_id,'text','Queue ordering fixture','rejected',now() from action_mission_assignments a where not exists(select 1 from action_proofs p where p.assignment_id=a.id);`);
 const oldest=(await db.query("update action_proofs set status='pending',created_at=now()-interval '30 days' where id=(select id from action_proofs where statement='Queue ordering fixture' limit 1) returning id")).rows[0].id;
 let queue=(await db.query('select world_environment_proofs() as r')).rows[0].r;
 assert.equal(queue.proofs.length,200);assert.equal(queue.proofs[0].proof_id,oldest);assert.equal(queue.limited,true);assert.equal(queue.pending_remaining,0);assert.equal(queue.total_remaining,(await db.query('select count(*)::int n from action_proofs p join action_mission_assignments a on a.id=p.assignment_id join action_environment_missions e on e.mission_id=a.mission_id')).rows[0].n-200);
 await db.exec("update action_proofs set status='pending' where statement='Queue ordering fixture'");
 queue=(await db.query('select world_environment_proofs() as r')).rows[0].r;assert.equal(queue.pending_remaining,(await db.query("select count(*)::int n from action_proofs where status='pending'")).rows[0].n-200);assert.equal(queue.proofs[0].proof_id,oldest);
 await identity('');await db.exec('set role anon');await assert.rejects(db.query('select world_environment_proof_read($1)',[assignment]),/permission denied/);

 // Helpers expose private proof/publication authority only through wrappers.
 // The forward file explicitly removes service-role execution too; no bearer
 // substitution or extra service privilege is required.
 for(const role of ['authenticated','anon','service_role']){
   await db.exec('reset role; set role '+role);
   await assert.rejects(db.query('select world_environment_proof_revision(null::public.action_proofs)'),/permission denied/);
   for(const sql of ['select world_environment_proof_snapshot($1)','select world_environment_proof_is_published($1)','select world_environment_proof_publish($1)'])await assert.rejects(db.query(sql,[opted.a]),/permission denied/);
 }
 await db.exec('reset role');
 const countsBefore=(await db.query('select (select count(*) from action_proofs)::int proofs,(select count(*) from network_posts)::int posts,(select count(*) from action_points_ledger)::int points,(select count(*) from action_share_intents where environment_proof_published is not null)::int receipts')).rows[0];
 const consentBefore=(await db.query('select environment_proof_consent,environment_proof_published from action_share_intents where assignment_id=$1',[broken.a])).rows[0];
 await db.exec(await read('supabase/pending/20261108120000_world_environment_proofs_v1.rollback.sql'));
 const countsAfter=(await db.query('select (select count(*) from action_proofs)::int proofs,(select count(*) from network_posts)::int posts,(select count(*) from action_points_ledger)::int points,(select count(*) from action_share_intents where environment_proof_published is not null)::int receipts')).rows[0];
 assert.deepEqual(countsAfter,countsBefore);
 assert.deepEqual((await db.query('select environment_proof_consent,environment_proof_published from action_share_intents where assignment_id=$1',[broken.a])).rows[0],consentBefore);
 assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='world_environment_proof_publish_on_verify_trg'")).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='action_share_on_verify_trg'")).rows[0].n,1);
 for(const role of ['authenticated','anon','service_role']){
   await db.exec('set role '+role);
   for(const [sql,args] of [['select world_environment_proof_read($1)',[assignment]],['select world_environment_proof_submit($1,\'text\',\'A valid but now suspended submission.\',null,false,true)',[assignment]],['select world_environment_proof_share($1,true,true)',[assignment]],['select world_environment_proofs()',[]],['select world_environment_proof_review($1,\'verified\',$2,null)',[first.proof_id,'0'.repeat(32)]]])await assert.rejects(db.query(sql,args),/permission denied/);
   await db.exec('reset role');
 }
 // The original canonical functions remain available; no post was unpublished.
 await identity(member);await db.exec('set role authenticated');
 assert.equal((await db.query('select share_verified_action($1) as r',[broken.a])).rows[0].r.post_id,(await stateCanonicalPostId(broken.a)));
 async function stateCanonicalPostId(a){return (await db.query('select my_action_shares() as r')).rows[0].r.find(r=>r.assignment_id===a).post_id;}

 console.log('PASS canonical SQL: own-only proof, atomic share choice, retry history, owner review, exactly-once points, consent, idempotent feed share, exact opted-in proof publication, legacy privacy, replacement binding, outage recovery, nonenvironmental isolation, queue priority, stale-review/same-content-retry rejection, helper role denials, receipt-preserving suspension, anonymous denial. Native concurrency and deployed schema remain untested.');
} finally {await db.close();}
