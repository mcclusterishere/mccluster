-- Run after supabase_api_roles.stub.sql and travel_journeys_private migration.
begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set local role authenticated;
set local request.jwt.claims='{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
insert into public.travel_journeys(plan) values ('{"version":1,"from":{"label":"New Haven","coordinates":[-72.9,41.33]},"to":{"label":"Lisbon","coordinates":[-9.14,38.72]},"departure":"2026-11-04","returning":"","travelers":1,"mode":"flight","departureHub":"","arrivalHub":"","stay":"","lowestCost":false,"freeOptions":false}');
do $$ begin
 if (select count(*) from public.travel_journeys)<>1 then raise exception 'Owner cannot read own draft'; end if;
 begin update public.travel_journeys set owner_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; raise exception 'Owner reassignment allowed'; exception when insufficient_privilege then null; end;
 begin update public.travel_journeys set plan=plan||'{"confirmed":true}'; raise exception 'Booking claim allowed'; exception when check_violation then null; end;
 begin update public.travel_journeys set plan=jsonb_set(plan,'{travelers}','0'); raise exception 'Zero travelers allowed'; exception when check_violation then null; end;
 begin update public.travel_journeys set plan=jsonb_set(plan,'{from,coordinates}','[null,0]'); raise exception 'Null coordinates allowed'; exception when check_violation then null; end;
 begin update public.travel_journeys set plan=jsonb_set(plan,'{returning}','"2026-01-01"'); raise exception 'Invalid return allowed'; exception when check_violation then null; end;
 begin update public.travel_journeys set plan=plan-'mode'; raise exception 'Missing mode allowed'; exception when check_violation then null; end;
end $$;
update public.travel_journeys set plan=jsonb_set(plan,'{travelers}','2');
set local request.jwt.claims='{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';
do $$ declare n int; begin
 if (select count(*) from public.travel_journeys)<>0 then raise exception 'Other owner can read draft'; end if;
 update public.travel_journeys set plan=jsonb_set(plan,'{travelers}','4');get diagnostics n=row_count;if n<>0 then raise exception 'Other owner can update'; end if;
 delete from public.travel_journeys;get diagnostics n=row_count;if n<>0 then raise exception 'Other owner can delete'; end if;
end $$;
set local role anon;
do $$ begin
 begin perform * from public.travel_journeys;raise exception 'Anon can read';exception when insufficient_privilege then null;end;
 begin insert into public.travel_journeys(plan) values('{}');raise exception 'Anon can write';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
set local request.jwt.claims='{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
do $$ begin if (select plan->>'travelers' from public.travel_journeys)<>'2' then raise exception 'Saved update was lost';end if;end $$;
delete from public.travel_journeys;
do $$ begin if exists(select 1 from public.travel_journeys) then raise exception 'Owner cannot delete own draft';end if;end $$;
rollback;
