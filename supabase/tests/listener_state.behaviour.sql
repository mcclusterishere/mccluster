-- Regression for the shipped Pocket cross-device listener position.
-- Scratch database only. No production accounts or rows are modified.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','a@example.test'),
 ('22222222-2222-4222-8222-222222222222','b@example.test');
set local role anon;
do $$ begin
  begin
    perform 1 from public.listener_state;
    raise exception 'anon must not read listener_state';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
insert into public.listener_state(profile_id,state)
 values('11111111-1111-4111-8111-111111111111','{"src":"track.mp3","t":12}'::jsonb);
do $$ declare v jsonb; begin
 select state into v from public.listener_state
 where profile_id='11111111-1111-4111-8111-111111111111';
 if v->>'src' <> 'track.mp3' then raise exception 'own state unavailable'; end if;
 if (select count(*) from public.listener_state) <> 1 then raise exception 'unexpected visible rows'; end if;
end $$;
-- This is exactly the client's resolution=merge-duplicates upsert behavior.
insert into public.listener_state(profile_id,state)
 values('11111111-1111-4111-8111-111111111111','{"src":"track.mp3","t":24}'::jsonb)
 on conflict(profile_id) do update set state=excluded.state;
do $$ begin
 if (select (state->>'t')::int from public.listener_state) <> 24
 then raise exception 'upsert failed'; end if;
end $$;
-- Authenticated users cannot create another member's row.
do $$ begin
 begin
   insert into public.listener_state(profile_id,state)
   values('22222222-2222-4222-8222-222222222222','{}'::jsonb);
   raise exception 'cross-user INSERT succeeded';
 exception when insufficient_privilege or check_violation then null;
 when others then if sqlerrm like '%row-level security%' then null; else raise; end if;
 end;
end $$;
-- Oversized payloads are rejected, even for an authorized member.
do $$ begin
 begin
   update public.listener_state set state=jsonb_build_object('oversized',repeat('x',5000));
   raise exception 'oversized payload accepted';
 exception when check_violation then null;
 end;
end $$;
reset role;
-- Another signed-in user cannot read or modify A's row.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$ declare n int; begin
 select count(*) into n from public.listener_state;
 if n <> 0 then raise exception 'cross-user SELECT leak'; end if;
 update public.listener_state set state='{"src":"tamper"}'::jsonb;
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'cross-user UPDATE leak'; end if;
end $$;
reset role;
-- Verify the same identity can read its position from another session.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$ begin
 if (select (state->>'t')::int from public.listener_state) <> 24
 then raise exception 'cross-session resume unavailable'; end if;
end $$;
reset role;
rollback;
