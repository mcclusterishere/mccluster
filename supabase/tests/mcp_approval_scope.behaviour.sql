\set ON_ERROR_STOP on
insert into public.mcp_approvals(id,org_id,tool,arguments,state,expires_at) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','public.read','{}','pending',now()+interval '1 hour'),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','sensitive.tool','{"secret":"private"}','pending',now()+interval '1 hour'),
 ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','another.read','{}','pending',now()-interval '1 hour');
set role authenticated;
do $$
begin
  begin
    update public.mcp_approvals set tool='sensitive.tool',arguments='{"changed":true}' where id='11111111-1111-4111-8111-111111111111';
    raise exception 'Authenticated client unexpectedly updated approval';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mcp_decide_scoped('11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'44444444-4444-4444-8444-444444444444');
    raise exception 'Authenticated client unexpectedly executed privileged decision';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role service_role;
do $$
declare r public.mcp_approvals;
begin
  r := public.mcp_decide_scoped('22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false,'44444444-4444-4444-8444-444444444444');
  if r.id is not null then raise exception 'Cross-org approval was mutated'; end if;
  if (select state from public.mcp_approvals where id='22222222-2222-4222-8222-222222222222')<>'pending' then raise exception 'Foreign approval state changed'; end if;
  r := public.mcp_decide_scoped('11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'44444444-4444-4444-8444-444444444444');
  if r.id is null or r.state<>'approved' or r.org_id<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then raise exception 'Same-org approval failed'; end if;
  r := public.mcp_decide_scoped('11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'44444444-4444-4444-8444-444444444444');
  if r.id is not null then raise exception 'Repeated approval incorrectly executed'; end if;
  r := public.mcp_decide_scoped('33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'44444444-4444-4444-8444-444444444444');
  if r.id is not null then raise exception 'Expired approval incorrectly executed'; end if;
end $$;
reset role;
select 'MCP approval scope and role isolation tests passed' as result;
