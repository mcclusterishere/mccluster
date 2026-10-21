-- Executed against a freshly migrated, isolated Supabase database only.
-- Exercise both the full-capacity rejection and the successful rejoin after a slot opens.
-- All fixtures are rolled back.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id,email) values
 ('fab10000-0000-4000-8000-000000000001','action-capacity-a@example.invalid'),
 ('fab10000-0000-4000-8000-000000000002','action-capacity-b@example.invalid');

do $verify_ids$
begin
  if (select count(*) from public.m_auth_user_links
      where auth_user_id in ('fab10000-0000-4000-8000-000000000001'::uuid,
                             'fab10000-0000-4000-8000-000000000002'::uuid)
        and is_primary) <> 2 then
    raise exception 'test auth identities did not create canonical M links';
  end if;
end
$verify_ids$;

insert into public.action_missions(id,title,status,capacity)
values('fab20000-0000-4000-8000-000000000001','Rejoin capacity CI fixture','open',1);
insert into public.action_mission_assignments
  (mission_id,user_id,m_uid,status)
select 'fab20000-0000-4000-8000-000000000001'::uuid,
       l.auth_user_id,l.m_uid,
       case when l.auth_user_id='fab10000-0000-4000-8000-000000000001'::uuid
         then 'withdrawn' else 'in_progress' end
from public.m_auth_user_links l
where l.auth_user_id in ('fab10000-0000-4000-8000-000000000001'::uuid,
                         'fab10000-0000-4000-8000-000000000002'::uuid);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fab10000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub',
  'fab10000-0000-4000-8000-000000000001',true);
do $capacity_full$
declare v_error text; v_rejected boolean := false;
begin
  begin
    perform public.join_action_mission('fab20000-0000-4000-8000-000000000001'::uuid);
  exception when others then
    get stacked diagnostics v_error=message_text;
    if v_error <> 'this mission is full' then
      raise exception 'rejoin failed for wrong reason: %',v_error;
    end if;
    v_rejected:=true;
  end;
  if not v_rejected then
    raise exception 'withdrawn member reclaimed a slot while mission was full';
  end if;
end
$capacity_full$;
reset role;

do $unchanged$
begin
  if (select status from public.action_mission_assignments
      where mission_id='fab20000-0000-4000-8000-000000000001'::uuid
        and user_id='fab10000-0000-4000-8000-000000000001'::uuid)
     <> 'withdrawn' then
    raise exception 'rejected rejoin changed assignment state';
  end if;
end
$unchanged$;
update public.action_mission_assignments set status='withdrawn'
where mission_id='fab20000-0000-4000-8000-000000000001'::uuid
 and user_id='fab10000-0000-4000-8000-000000000002'::uuid;

set local role authenticated;
do $capacity_available$
declare v_result jsonb;
begin
  v_result:=public.join_action_mission('fab20000-0000-4000-8000-000000000001'::uuid);
  if v_result->>'status'<>'in_progress' then
    raise exception 'rejoin did not reactivate assignment: %',v_result;
  end if;
  if (select count(*) from public.action_mission_assignments
      where mission_id='fab20000-0000-4000-8000-000000000001'::uuid
        and status <> 'withdrawn')<>1 then
    raise exception 'rejoin breached mission capacity';
  end if;
end
$capacity_available$;
reset role;
rollback;
