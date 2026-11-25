-- The member's own writes, the same statements twice (t.attacks, defined once
-- in network_media_assets_pointer_guard.seed.sql):
--   psql -v after=false : before the guard. Each must WORK. That is the finding.
--   psql -v after=true  : after the guard. Each must be REFUSED, first by the
--     table privilege, and, with the old grant and policies put back by hand
--     (the regression this guards against), by the trigger.
-- Every attempt is rolled back, so the rows are the same before and after.
\set ON_ERROR_STOP on
\if :after

do $$
declare r record; v_out text; v_before text := t.rows_digest();
begin
  for r in select * from t.attacks order by key loop
    v_out := t.attempt(r.as_user, r.statements);
    if v_out <> '42501 permission denied for table network_media_assets' then
      raise exception 'after the guard, % must be refused by privilege; got: %', r.key, v_out;
    end if;
  end loop;
  if t.rows_digest() <> v_before then raise exception 'a refused attempt changed a row'; end if;
  raise notice 'after the guard: all % member writes are refused by privilege (42501)', (select count(*) from t.attacks);
end $$;

-- The regression: somebody grants the table back to members and restores the
-- three owner policies. The trigger still refuses every one of them.
begin;
grant insert, update, delete on public.network_media_assets to authenticated;
create policy network_media_owner_insert on public.network_media_assets for insert to authenticated
  with check (owner_m_uid = public.current_m_uid());
create policy network_media_owner_update on public.network_media_assets for update to authenticated
  using (owner_m_uid = public.current_m_uid()) with check (owner_m_uid = public.current_m_uid());
create policy network_media_owner_delete on public.network_media_assets for delete to authenticated
  using (owner_m_uid = public.current_m_uid());
do $$
declare r record; v_out text; v_before text := t.rows_digest(); v_refused integer := 0;
begin
  for r in select * from t.attacks order by key loop
    v_out := t.attempt(r.as_user, r.statements);
    if r.min_rows = 0 then
      -- another member's row: RLS still hides it, so no row reaches the trigger
      if v_out <> 'ok 0' then raise exception '% must stay a no-op; got: %', r.key, v_out; end if;
    elsif v_out <> '42501 network_media_assets_server_write_only' then
      raise exception 'with the grant restored, % must be refused by the trigger; got: %', r.key, v_out;
    else
      v_refused := v_refused + 1;
    end if;
  end loop;
  if t.rows_digest() <> v_before then raise exception 'a refused attempt changed a row'; end if;
  raise notice 'with the grant and policies restored by hand: % member writes are still refused by the trigger', v_refused;
end $$;
rollback;

\else

do $$
declare r record; v_out text; v_before text := t.rows_digest(); v_rows integer;
begin
  for r in select * from t.attacks order by key loop
    v_out := t.attempt(r.as_user, r.statements);
    if v_out !~ '^ok [0-9]+$' then
      raise exception 'before the guard, % is expected to work; got: %', r.key, v_out;
    end if;
    v_rows := split_part(v_out, ' ', 2)::integer;
    if (r.min_rows = 0 and v_rows <> 0) or (r.min_rows > 0 and v_rows < r.min_rows) then
      raise exception 'before the guard, % is expected to change % row(s); it changed %', r.key, r.min_rows, v_rows;
    end if;
  end loop;
  if t.rows_digest() <> v_before then raise exception 'an attempt was not rolled back'; end if;
  raise notice 'before the guard: % member writes succeed (and % against another member''s row change nothing)',
    (select count(*) from t.attacks where min_rows > 0), (select count(*) from t.attacks where min_rows = 0);
end $$;

\endif
