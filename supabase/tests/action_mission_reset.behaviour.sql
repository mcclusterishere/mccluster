-- User-facing behavior of the finite mission catalog reset, after applying twice.
-- Run in the same isolated test gate as action_archive.behaviour.sql, a separate DB.
create or replace function pg_temp.ok(p_condition boolean,p_label text)
returns void language plpgsql as $$
begin if not coalesce(p_condition,false) then raise exception 'FAILED: %',p_label; end if; end $$;
create or replace function pg_temp.must_fail(p_sql text,p_state text,p_message text default null)
returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlstate<>p_state or (p_message is not null and sqlerrm not ilike p_message) then
      raise exception 'Expected SQLSTATE % / %, got % / %',p_state,p_message,sqlstate,sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected failure but statement succeeded: %',p_sql;
end $$;
grant execute on all functions in schema pg_temp to anon,authenticated,service_role;

do $$ begin
  perform pg_temp.ok((select array_agg(title order by title) from public.action_missions where status='open')
    =array['Give someone a free ride','Write a policy memo','Write the Change'],'three open starter missions');
  perform pg_temp.ok((select count(*) from public.action_missions)=10,'reset does not add duplicate catalog rows');
  perform pg_temp.ok((select count(*) from public.action_mission_assignments)=1,'reset retains existing assignment');
  perform pg_temp.ok((select status='in_progress' from public.action_mission_assignments
    where id='33333333-3333-4333-8333-333333333333'),'existing assignment keeps its state');
  perform pg_temp.ok((select status='paused' from public.action_missions
    where id='9144bd42-f94a-494e-a17a-a45f9e155f86'),'assigned legacy mission is paused');
  perform pg_temp.ok((select title='Unrelated held mission' and description='Keep this fixture intact.'
    and status='paused' and base_points=317 and updated_at='2020-01-01T00:00:00Z' from public.action_missions
    where id='90000000-0000-4000-8000-000000000001'),'unrelated held mission is unchanged');
  perform pg_temp.ok((select count(*) from public.action_partner_mission_drafts where draft_id like 'arsenal-%')=9,
    'nine arsenal ideas without duplicates');
  perform pg_temp.ok(not exists(select 1 from public.action_partner_mission_drafts
    where claim_enabled or published_at is not null or compensation_cents is not null or authorized_partner_id is not null),
    'development drafts grant no claims, publication, compensation or partner authority');
  perform pg_temp.ok((select status='draft' from public.action_missions
    where id='49d654e1-dfc8-42aa-a26e-22912ebf8dc6'),'CfAL idea is held pending intake agreement');
end $$;

set role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"member@example.invalid","role":"authenticated"}',false);
select pg_temp.ok((select count(*) from public.action_partner_mission_drafts)=0,'member cannot read private arsenal');
select pg_temp.must_fail($q$update public.action_partner_mission_drafts set status='open'$q$,'42501');
select pg_temp.must_fail($q$select public.join_action_mission('9144bd42-f94a-494e-a17a-a45f9e155f86')$q$,
  'P0001','this mission is not open');
do $$ declare v_proof jsonb; v_first jsonb; v_second jsonb; begin
  v_proof:=public.submit_action_proof('33333333-3333-4333-8333-333333333333','text',null,
    'I completed the four sourced research points and am ready for review.');
  perform pg_temp.ok(v_proof->>'status'='submitted','existing assignment can submit proof after mission is paused');
  v_first:=public.join_action_mission('302dcb4e-ca21-4289-b633-9c397985fb9d');
  v_second:=public.join_action_mission('302dcb4e-ca21-4289-b633-9c397985fb9d');
  perform pg_temp.ok(v_first->>'assignment_id'=v_second->>'assignment_id'
    and v_first->>'status'='in_progress','repeated acceptance returns the same active assignment');
  perform pg_temp.ok((select count(*) from public.action_points_ledger)=0,'acceptance awards no points');
end $$;
reset role;
select pg_temp.ok((select count(*) from public.action_points_ledger)=0,'no points were awarded to any identity');
select pg_temp.ok((select count(*) from public.action_mission_assignments)=2,'acceptance adds exactly one assignment');
set role anon;
select set_config('request.jwt.claims','{"role":"anon"}',false);
select pg_temp.must_fail('select * from public.action_partner_mission_drafts','42501');
select pg_temp.must_fail($q$select public.join_action_mission('302dcb4e-ca21-4289-b633-9c397985fb9d')$q$,'42501');
select pg_temp.ok((select count(*) from public.action_missions
  where id='49d654e1-dfc8-42aa-a26e-22912ebf8dc6')=0,'anonymous discovery cannot see the drafted CfAL mission');
reset role;

