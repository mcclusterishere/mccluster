// Socket-free SQL validation using an already installed PGlite PostgreSQL runtime.
// This validates SQL and sequential behavior, NOT native concurrency.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
let s=`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function public.current_m_uid() returns uuid language sql as $$ select auth.uid() $$;create table public.m_people(id uuid primary key);create table public.action_campaigns(id text primary key);create table public.m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);create table public.orgs(id uuid primary key,slug text);create table public.org_members(org_id uuid,profile_id uuid,role text);grant usage on schema public,auth to anon,authenticated,service_role;`;
const a=await read('supabase/migrations/20261002061056_action_network_gamification_v1.sql');s+=a.slice(a.indexOf('create table public.action_missions'),a.indexOf('alter table public.action_missions enable'));
const g=await read('supabase/migrations/20260925040000_mnet_handles_groups_and_welcome.sql');s+=g.slice(g.indexOf('create table if not exists public.network_groups'),g.indexOf('-- A post can belong to a group.'));
s+=`create table public.action_globe_mission_regions(mission_id uuid);create function public.action_globe_can_join_mission(uuid,uuid) returns boolean language sql as $$ select false $$;grant select,insert,update,delete on all tables in schema public to service_role;`;
s+=await read('supabase/migrations/20261014184518_action_globe_join_authorization.sql');s+=await read('supabase/pending/20261107120000_world_environment_v1.sql');
s+=`insert into auth.users values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');insert into m_people select id from auth.users;insert into m_auth_user_links select id,id,true from auth.users;insert into orgs values('10000000-0000-4000-8000-000000000004','mccluster');insert into org_members values('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','owner');select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);set role authenticated;select world_environment_team(true);select world_environment_team(null);reset role;`;
s+=`do $$ declare m uuid; out jsonb; e jsonb:=jsonb_build_object('id','usgs:fixture','title','Test quake','source',jsonb_build_object('id','usgs','url','https://earthquake.usgs.gov/'),'stale',false,'observed_at',now(),'fetched_at',now());a jsonb:='{"id":"resource-check","title":"Check support","description":"Remote verification","proof":"Dated public sources","safety":"Do not enter hazard areas"}'::jsonb;begin out:=world_environment_propose('10000000-0000-4000-8000-000000000002',e,a);m:=(out->>'mission_id')::uuid;if out->>'status'<>'draft' then raise exception 'not draft';end if;if(world_environment_propose('10000000-0000-4000-8000-000000000002',e,a)->>'mission_id')::uuid<>m then raise exception 'not idempotent';end if;begin perform world_environment_join(m);raise exception 'join unexpectedly succeeded';exception when others then if sqlerrm<>'approved_environment_mission_required' then raise;end if;end;begin perform world_environment_review('10000000-0000-4000-8000-000000000002',m,'open');raise exception 'staff approved';exception when others then if sqlerrm<>'owner_only' then raise;end if;end;perform world_environment_review('10000000-0000-4000-8000-000000000001',m,'open');out:=world_environment_join(m);if out->>'assignment_id' is null then raise exception 'no assignment';end if;if world_environment_team(null)#>>'{assignments,0,assignment_id}'<>out->>'assignment_id' then raise exception 'missing own assignment';end if;begin update action_environment_missions set event_id='changed' where mission_id=m;raise exception 'source mutable';exception when others then if sqlerrm<>'immutable_environment_provenance' then raise;end if;end;perform world_environment_review('10000000-0000-4000-8000-000000000001',m,'paused');begin perform world_environment_join(m);raise exception 'paused join';exception when others then if sqlerrm<>'this mission is not open' then raise;end if;end;e:=e||jsonb_build_object('id','usgs:old','observed_at',now()-interval '2 days');m:=(world_environment_propose('10000000-0000-4000-8000-000000000002',e,a)->>'mission_id')::uuid;begin perform world_environment_review('10000000-0000-4000-8000-000000000001',m,'open');raise exception 'stale approval';exception when others then if sqlerrm<>'source_expired' then raise;end if;end;raise notice 'PASS native SQL canonical schema, team persistence, draft, duplicate, owner, join, reload, immutable source, paused join, stale approval';end $$;`;
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH));
const db = new PGlite();
try {
  await db.exec(s);
  assert.equal((await db.query('select count(*)::int as n from action_mission_assignments')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from action_environment_reviews')).rows[0].n, 2);
  const saved=(await db.query('select world_environment_team(null) as state')).rows[0].state.assignments[0];
  assert.equal(saved.title,'Check support: Test quake');
  assert.equal(saved.event_id,'usgs:fixture');
  assert.equal(saved.mission_status,'paused');
  assert.equal(saved.capture_available,false);
  assert.equal(saved.source.url,'https://earthquake.usgs.gov/');
  assert.ok(saved.observed_at);assert.match(saved.description,/Remote verification/);
  assert.doesNotMatch(JSON.stringify(saved),/user_id|m_uid|proposed_by/);
  await db.query("update action_missions set status='open' where id=$1",[saved.mission_id]);
  assert.equal((await db.query('select world_environment_team(null) as state')).rows[0].state.assignments[0].capture_available,true);
  await db.query("update action_missions set ends_at=now()-interval '1 minute' where id=$1",[saved.mission_id]);
  assert.equal((await db.query('select world_environment_team(null) as state')).rows[0].state.assignments[0].capture_available,false);
  await db.query("update action_missions set starts_at=now()+interval '1 hour',ends_at=now()+interval '1 day' where id=$1",[saved.mission_id]);
  assert.equal((await db.query('select world_environment_team(null) as state')).rows[0].state.assignments[0].capture_available,false);
  await db.query("update action_missions set starts_at=null,status='paused' where id=$1",[saved.mission_id]);


  await db.exec(`create table ops_recommendations(id uuid primary key,org_id uuid,recommendation_type text,status text,decided_at timestamptz,proposed_action jsonb);create table media_news_articles(id uuid primary key,title text,canonical_url text,ingestion_provider text,published_at timestamptz,imported_at timestamptz);select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);select world_environment_team(true);`);
  const news={schema:'environment-news-attribution/v1',article_id:'10000000-0000-4000-8000-000000000008',review_id:'10000000-0000-4000-8000-000000000009',title:'Reported access concerns',url:'https://news.example.invalid/report',seen_at:new Date().toISOString(),revision:'fixture'};
  await db.query('insert into media_news_articles values($1,$2,$3,$4,$5,$5)',[news.article_id,news.title,news.url,'gdelt_gkg_v2',news.seen_at]);
  await db.query('insert into ops_recommendations values($1,$2,$3,$4,$5,$6::jsonb)',[news.review_id,'10000000-0000-4000-8000-000000000004','environment_news_context','approved',news.seen_at,JSON.stringify({schema:'environment-news-context/v1',event_id:'usgs:news-fixture',article_id:news.article_id,article_revision:news.revision,reviewer_id:'10000000-0000-4000-8000-000000000001',article_snapshot:{title:news.title,canonical_url:news.url,ingestion_provider:'gdelt_gkg_v2',seen_at:news.seen_at,imported_at:news.seen_at}})]);
  const withNews=(await db.query('select world_environment_propose($1,$2::jsonb,$3::jsonb) as value',['10000000-0000-4000-8000-000000000001',JSON.stringify({id:'usgs:news-fixture',title:'Official report',source:{id:'usgs',url:'https://earthquake.usgs.gov/'},stale:false,observed_at:new Date().toISOString(),fetched_at:new Date().toISOString(),news_context:news}),JSON.stringify({id:'evidence-brief',title:'Review access',description:'Remote work',proof:'Dated sources',safety:'No hazard entry'})])).rows[0].value;
  const newsMission=(await db.query('select m.description,e.source_snapshot from action_missions m join action_environment_missions e on e.mission_id=m.id where m.id=$1',[withNews.mission_id])).rows[0];
  assert.match(newsMission.description,/Reviewed news context \(reported claim, not verified environmental fact\)/);assert.deepEqual(newsMission.source_snapshot.news_context,news);
  await db.query("update media_news_articles set title='Corrected report' where id=$1",[news.article_id]);
  await assert.rejects(db.query('select world_environment_propose($1,$2::jsonb,$3::jsonb)',['10000000-0000-4000-8000-000000000001',JSON.stringify({id:'usgs:news-fixture',title:'Official report',source:{id:'usgs',url:'https://earthquake.usgs.gov/'},stale:false,observed_at:new Date().toISOString(),news_context:news}),JSON.stringify({id:'evidence-brief'})]),/current_news_review_required/);
  await db.exec("select world_environment_team(false); select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false)");
  await db.exec("set role authenticated");
  await assert.rejects(db.query('select * from action_environment_missions'), /permission denied/);
  await assert.rejects(db.query("select world_environment_review('10000000-0000-4000-8000-000000000001', gen_random_uuid(), 'open')"), /permission denied/);
  await db.exec("reset role; update network_group_members set state='banned'");
  await assert.rejects(db.query('select world_environment_team(true)'), /membership_blocked/);
  await assert.rejects(db.query('select world_environment_team(false)'), /membership_blocked/);
  await db.exec("update network_group_members set state='joined'; update network_groups set visibility='invite'");
  await assert.rejects(db.query('select world_environment_team(true)'), /team_unavailable/);
  await db.exec("update network_groups set visibility='open'; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false)");
  const other = (await db.query('select world_environment_team(null) as value')).rows[0].value;
  assert.equal(other.joined, false);
  assert.deepEqual(other.assignments, []);
  // Direct calls to the existing generic join RPC must obey the same team gate.
  await db.exec("select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false); update action_missions set status='open' where status='paused'; delete from network_group_members where m_uid='10000000-0000-4000-8000-000000000002'; update action_mission_assignments set status='withdrawn'");
  const mission = (await db.query("select id from action_missions where status='open'")).rows[0].id;
  await assert.rejects(db.query('select join_action_mission($1)', [mission]), /join_team_first/);
  // Ordinary proof review can proceed after someone leaves; no seat is recreated.
  await db.exec("select world_environment_team(true)");
  await db.query('select join_action_mission($1)', [mission]);
  await db.exec("select world_environment_team(false); update action_mission_assignments set status='submitted'");
  const afterLeaving=(await db.query('select world_environment_team(null) as state')).rows[0].state;
  assert.equal(afterLeaving.joined,false);assert.equal(afterLeaving.assignments.length,1);
  assert.equal(afterLeaving.assignments[0].status,'submitted');assert.equal(afterLeaving.assignments[0].capture_available,false);
  await db.exec("select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false)");
  await assert.rejects(db.query('select join_action_mission($1)', [mission]), /join_team_first/);
  console.log('PASS PGlite: canonical schema, self membership, role denials, banned/invite guards, draft-only proposals, duplicate retry, owner review, join, own-assignment reload, immutable provenance, pause and stale-source approval denial.');
  console.log('Native concurrent capacity/locking tests remain separate in scripts/test-environment-postgres.mjs.');
} finally { await db.close(); }
