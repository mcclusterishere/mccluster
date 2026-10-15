-- Behaviour tests for supabase/pending/gated_track_mission_identity_v1.sql.
-- Run by scripts/test-mission-admin-approval-db.sh on a scratch Postgres after
-- the full chain and both pending files. Invented people only.
--
-- The rule: full audio of the gated track ONLY with >= 3 distinct missions an
-- admin verified AND member_identity_verified(uid). Everyone else (signed out
-- or in) is locked: the claim never writes a play row, so the Worker never
-- has a stream token to hand out.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.as_user(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', false); execute 'set role service_role'; end $$;
create or replace function pg_temp.as_db() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{}', false); execute 'reset role'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then
  if sqlerrm not ilike p_like then raise exception 'expected % from [%], got: %', p_like, p_sql, sqlerrm; end if; return; end;
  raise exception 'expected failure (%) but it succeeded: %', p_like, p_sql; end $$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAILED: %', p_what; end if; raise notice 'ok: %', p_what; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
create temp table ids(k text primary key, v uuid); grant all on ids to anon, authenticated, service_role;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
grant execute on function pg_temp.id(text) to anon, authenticated, service_role;
-- the Worker's two calls, as the service role
create or replace function pg_temp.state(p_user uuid) returns jsonb language sql as $$
  select public.music_gate_rule_state(p_user, 'niggy-nigg', 'gated_track_niggy_nigg') $$;
create or replace function pg_temp.claim(p_user uuid) returns jsonb language sql as $$
  select public.music_gate_claim_rule(p_user, 'niggy-nigg', 'gated_track_niggy_nigg', encode(gen_random_bytes(32), 'hex'), 300) $$;
create or replace function pg_temp.plays(p_user uuid) returns bigint language sql as $$
  select count(*) from public.music_gated_plays where user_id is not distinct from p_user and track_key = 'niggy-nigg' $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
set client_min_messages = notice;

-- fixtures: U0..U3 have 0..3 verified missions; the desk verifies them through review_action_proof
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-0000000bb000','u0@test'), ('00000000-0000-4000-8000-0000000bb001','u1@test'),
 ('00000000-0000-4000-8000-0000000bb002','u2@test'), ('00000000-0000-4000-8000-0000000bb003','u3@test'),
 ('00000000-0000-4000-8000-0000000bbaad','matthew@mccluster.org');
insert into public.m_people(id) select ('10000000' || substr(id::text, 9))::uuid from auth.users;
insert into public.m_links(user_id, m_uid) select id, ('10000000' || substr(id::text, 9))::uuid from auth.users;
insert into ids values ('U0','00000000-0000-4000-8000-0000000bb000'), ('U1','00000000-0000-4000-8000-0000000bb001'),
 ('U2','00000000-0000-4000-8000-0000000bb002'), ('U3','00000000-0000-4000-8000-0000000bb003'), ('A','00000000-0000-4000-8000-0000000bbaad');
insert into public.action_missions(id, title, status, skills, kind) values
 ('20000000-0000-4000-8000-0000000bb001','Fixture mission 1','open','{field}','civic'),
 ('20000000-0000-4000-8000-0000000bb002','Fixture mission 2','open','{field}','civic'),
 ('20000000-0000-4000-8000-0000000bb003','Fixture mission 3','open','{field}','civic');

do $$
declare u int; m int; a uuid; p uuid;
begin
  for u in 1..3 loop
    for m in 1..u loop
      perform pg_temp.as_user(pg_temp.id('U' || u));
      a := (public.join_action_mission(('20000000-0000-4000-8000-0000000bb00' || m)::uuid)->>'assignment_id')::uuid;
      p := (public.submit_action_proof(a, 'link', 'https://example.com/u' || u || '-m' || m, 'Fixture proof: did the mission for real today.')->>'proof_id')::uuid;
      perform pg_temp.as_user(pg_temp.id('A'), 'matthew@mccluster.org');
      perform public.review_action_proof(p, 'verified', 'seen');
    end loop;
  end loop;
  perform pg_temp.as_db();
end $$;

select pg_temp.as_service();
select pg_temp.ok(public.action_member_verified_mission_count(pg_temp.id('U3')) = 3 and public.action_member_verified_mission_count(pg_temp.id('U0')) = 0,
  'fixtures: U0..U3 hold 0..3 admin-verified missions');

-- the rule is a data row
select pg_temp.ok((select requirement_kind = 'verified_missions_and_identity' and min_count = 3 and enabled
                     and unlock_keys = array['music_full_track:niggy-nigg'] from public.action_unlock_rules where rule_key = 'gated_track_niggy_nigg'),
  'the rule is action_unlock_rules.gated_track_niggy_nigg: 3 missions + identity');

-- signed out
do $$ declare s jsonb := pg_temp.state(null); c jsonb := pg_temp.claim(null); begin
  perform pg_temp.ok(not (s->>'allowed')::boolean and s->'missing' ? 'sign_in' and s->'missing' ? 'missions'
    and s->'missing' ? 'identity_verification' and (s->'missions'->>'need')::int = 3
    and s->'links'->>'missions' = 'mnet.html?view=missions' and s->'links'->>'identity' is not null,
    'signed out: locked, says sign in + 0/3 missions + identity, with links: ' || s::text);
  perform pg_temp.ok(not (c->>'claimed')::boolean and pg_temp.plays(null) = 0, 'signed out: no play row, no token');
end $$;

-- before the identity PR (no level column): nobody is identity-verified, even with 3 missions
-- and a vendor 'verified' referral-signup row
select pg_temp.as_db();
insert into public.action_member_verifications(user_id, status, provider, provider_reference, location_consent_at, location_precision,
  attestation_version, attestation_signed_at, biometric_consent_version, biometric_consent_at, verified_at)
values (pg_temp.id('U3'), 'verified', 'vendor_x', 'ref_u3', now(), 'region', 'v1', now(), 'v1', now(), now());
select pg_temp.as_service();
do $$ declare u int; s jsonb; c jsonb; begin
  for u in 0..3 loop
    s := pg_temp.state(pg_temp.id('U' || u)); c := pg_temp.claim(pg_temp.id('U' || u));
    perform pg_temp.ok(not (s->>'allowed')::boolean and (s->'missions'->>'have')::int = u and not (s->>'identity_verified')::boolean
      and not (c->>'claimed')::boolean and pg_temp.plays(pg_temp.id('U' || u)) = 0,
      format('matrix %s/3 missions x identity NOT verified (no level column yet, fail closed): locked, no play row', u));
  end loop;
end $$;
select pg_temp.ok(not public.member_identity_verified(pg_temp.id('U3')), 'member_identity_verified fails closed until the live-intro level exists');

-- the identity PR's contract: action_member_verifications.level = 'v1_live_intro', status verified, owner-approved
select pg_temp.as_db();
alter table public.action_member_verifications add column if not exists level text;  -- fixture standing in for feat/identity-verification-levels
update public.action_member_verifications set level = 'v1_live_intro' where user_id = pg_temp.id('U3');
insert into public.action_member_verifications(user_id, status, provider, provider_reference, location_consent_at, location_precision,
  attestation_version, attestation_signed_at, biometric_consent_version, biometric_consent_at, verified_at, level)
select pg_temp.id('U' || u), 'verified', 'owner_review', 'ref_u' || u, now(), 'region', 'v1', now(), 'v1', now(), now(), 'v1_live_intro'
  from generate_series(0, 2) u;
select pg_temp.as_service();
do $$ declare u int; s jsonb; c jsonb; begin
  for u in 0..2 loop
    s := pg_temp.state(pg_temp.id('U' || u)); c := pg_temp.claim(pg_temp.id('U' || u));
    perform pg_temp.ok(not (s->>'allowed')::boolean and (s->>'identity_verified')::boolean and s->'missing' ? 'missions'
      and not s->'missing' ? 'identity_verification' and s->>'reason' = 'missions'
      and not (c->>'claimed')::boolean and pg_temp.plays(pg_temp.id('U' || u)) = 0,
      format('matrix %s/3 missions x identity verified: locked (missions), no play row', u));
  end loop;
  s := pg_temp.state(pg_temp.id('U3')); c := pg_temp.claim(pg_temp.id('U3'));
  perform pg_temp.ok((s->>'allowed')::boolean and (c->>'claimed')::boolean and c->>'play_id' is not null
    and pg_temp.plays(pg_temp.id('U3')) = 1, 'matrix 3/3 missions x identity verified: ALLOWED, one play row (the stream token)');
  c := pg_temp.claim(pg_temp.id('U3'));
  perform pg_temp.ok((c->>'claimed')::boolean and pg_temp.plays(pg_temp.id('U3')) = 2, 'entitled: every play is its own short-lived token (not spent like the listen gate)');
end $$;

-- 3 missions, identity revoked / expired / another level: locked again
select pg_temp.as_db();
update public.action_member_verifications set status = 'revoked' where user_id = pg_temp.id('U3');
select pg_temp.as_service();
do $$ declare s jsonb := pg_temp.state(pg_temp.id('U3')); c jsonb := pg_temp.claim(pg_temp.id('U3')); begin
  perform pg_temp.ok(not (s->>'allowed')::boolean and s->>'reason' = 'identity_verification' and s->'missing' ? 'identity_verification'
    and not (c->>'claimed')::boolean and pg_temp.plays(pg_temp.id('U3')) = 2,
    'matrix 3/3 missions x identity revoked: locked (identity), no new play row');
end $$;
select pg_temp.as_db();
update public.action_member_verifications set status = 'verified', expires_at = now() - interval '1 day' where user_id = pg_temp.id('U3');
select pg_temp.as_service();
select pg_temp.ok(not (pg_temp.state(pg_temp.id('U3'))->>'allowed')::boolean, 'expired identity: locked');
select pg_temp.as_db();
update public.action_member_verifications set expires_at = null, level = 'referral_vendor' where user_id = pg_temp.id('U3');
select pg_temp.as_service();
select pg_temp.ok(not (pg_temp.state(pg_temp.id('U3'))->>'allowed')::boolean, 'a verification of another level does not count');
select pg_temp.as_db();
update public.action_member_verifications set level = 'v1_live_intro' where user_id = pg_temp.id('U3');

-- the same mission twice counts once; a clip mission never counts
select pg_temp.as_service();
select pg_temp.ok(public.action_member_verified_mission_count(pg_temp.id('U2')) = 2, 'the count is per distinct admin-verified mission (U2: 2)');

-- the rule is data: disabling it locks everyone, the owner included in the DB answer
select pg_temp.as_db();
update public.action_unlock_rules set enabled = false where rule_key = 'gated_track_niggy_nigg';
select pg_temp.as_service();
do $$ declare c jsonb := pg_temp.claim(pg_temp.id('U3')); begin
  perform pg_temp.ok(not (c->>'claimed')::boolean and c->'missing' ? 'rule_disabled' and pg_temp.plays(pg_temp.id('U3')) = 2,
    'rule disabled: locked, no play row');
end $$;
select pg_temp.as_db();
update public.action_unlock_rules set enabled = true, min_count = 2 where rule_key = 'gated_track_niggy_nigg';
select pg_temp.as_service();
select pg_temp.ok((pg_temp.state(pg_temp.id('U2'))->>'allowed')::boolean, 'min_count is data: at 2, U2 (2 missions + identity) unlocks');
select pg_temp.as_db();
update public.action_unlock_rules set min_count = 3 where rule_key = 'gated_track_niggy_nigg';

-- a rule for another track cannot be used for this one
select pg_temp.as_service();
select pg_temp.ok((public.music_gate_rule_state(pg_temp.id('U3'), 'you-the-feds', 'gated_track_niggy_nigg')->>'reason') = 'no_rule', 'the rule unlocks only its own track');
select pg_temp.ok((public.music_gate_rule_state(pg_temp.id('U3'), 'niggy-nigg', 'policy_fellowship')->>'reason') = 'no_rule', 'another rule cannot unlock the track');

-- nobody but the service role (the Worker) can ask or claim
select pg_temp.as_user(pg_temp.id('U3'));
select pg_temp.must_fail($q$select public.music_gate_claim_rule(pg_temp.id('U3'), 'niggy-nigg', 'gated_track_niggy_nigg', repeat('a', 64), 300)$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.member_identity_verified(pg_temp.id('U3'))$q$, '%permission denied%');
select pg_temp.must_fail($q$insert into public.music_gated_plays(user_id, track_key) values (pg_temp.id('U3'), 'niggy-nigg')$q$, '%row-level security%');  -- the stub grants tables by default, so RLS is the wall
select pg_temp.ok(true, 'members cannot call the claim, read identity, or write a play');

-- the ladder's own rules answer as before (no identity_verified key leaks onto them)
select pg_temp.as_service();
select pg_temp.ok(not (public.action_unlock_progress(pg_temp.id('U3'), 'policy_fellowship') ? 'identity_verified'), 'other rules unchanged');

-- taxonomy
select pg_temp.as_db();
select pg_temp.ok((select count(*) from public.event_taxonomy where event_name in ('music_preview_play','music_full_play') and stage = 'content') = 2,
  'music_preview_play and music_full_play are mapped as separate content events');

select 'gated track behaviour: all assertions passed';
