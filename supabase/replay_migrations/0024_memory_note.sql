-- MEMORY, WRITTEN ATOMICALLY
--
-- 0023 gave memory_facts a partial unique index on (contact_id, key)
-- WHERE superseded_by IS NULL — one live value per key per person, which
-- is right. What it did not give was a safe way to replace that value.
--
-- The obvious two steps both fail:
--
--   insert new, then point the old at it   the insert collides with the
--                                          live row that is still live
--   point the old at the new, then insert  there is no new id to point at
--
-- So a fact needs a way to stop being live before its replacement exists.
-- That is ended_at: the row is closed first, the replacement is written
-- second, and the pointer between them is set third. A crash anywhere in
-- that sequence leaves a closed fact with no replacement — visible,
-- harmless, and recoverable — instead of two live values or none.
--
-- All three steps live inside one function so that concurrent messages
-- from the same person cannot interleave. The row is locked FOR UPDATE
-- before anything is decided.

-- ============================================================

alter table public.memory_facts
  add column if not exists ended_at timestamptz;

-- anything already superseded is, by definition, ended
update public.memory_facts
   set ended_at = now()
 where superseded_by is not null and ended_at is null;

drop index if exists memory_facts_live;
create unique index if not exists memory_facts_live
  on public.memory_facts (contact_id, key) where ended_at is null;

create index if not exists memory_facts_contact_live
  on public.memory_facts (contact_id, last_seen desc) where ended_at is null;

comment on column public.memory_facts.ended_at is
  'When this value stopped being the live one. NULL means it is current. Set BEFORE its replacement is inserted — see memory_note().';

-- ============================================================
-- The only supported way to write a fact.
--
-- Returns the id of the row that is live for that key afterwards, which
-- is the new row on a change and the existing row on a repeat.
-- ============================================================

create or replace function public.memory_note(
  p_contact    uuid,
  p_key        text,
  p_value      text,
  p_confidence real default 0.6,
  p_source     uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_id    uuid;
  v_old_value text;
  v_old_conf  real;
  v_new       uuid;
  v_key       text := lower(btrim(p_key));
  v_value     text := btrim(p_value);
  v_conf      real := greatest(0::real, least(1::real, coalesce(p_confidence, 0.6)));
begin
  if v_key = '' or v_value = '' then
    return null;
  end if;

  -- lock the live row for this key, if there is one, so two messages
  -- arriving together cannot both decide they are the replacement
  select id, value, confidence
    into v_old_id, v_old_value, v_old_conf
    from public.memory_facts
   where contact_id = p_contact and key = v_key and ended_at is null
   for update;

  if v_old_id is not null then
    -- said again: the fact is not new, it is more certain
    if lower(regexp_replace(btrim(v_old_value), '[.!?]+$', '')) =
       lower(regexp_replace(v_value,            '[.!?]+$', '')) then
      update public.memory_facts
         set last_seen = now(),
             confidence = greatest(confidence, v_conf)
       where id = v_old_id;
      return v_old_id;
    end if;

    -- a weaker claim does not get to erase a stronger one. One offhand
    -- "maybe" should not overwrite something they stated plainly.
    if v_conf < v_old_conf then
      return v_old_id;
    end if;

    -- close it BEFORE the replacement exists; this is the whole point
    update public.memory_facts set ended_at = now() where id = v_old_id;
  end if;

  insert into public.memory_facts
    (contact_id, kind, key, value, confidence, source_message_id)
  values
    (p_contact, 'fact', v_key, v_value, v_conf, p_source)
  returning id into v_new;

  if v_old_id is not null then
    update public.memory_facts set superseded_by = v_new where id = v_old_id;
  end if;

  return v_new;
end $$;

revoke all on function public.memory_note(uuid, text, text, real, uuid) from public, anon, authenticated;

comment on function public.memory_note(uuid, text, text, real, uuid) is
  'Record one fact about one person. Supersedes rather than overwrites. Service role only.';

-- ============================================================
-- What the day has cost, in one row rather than one row per call.
--
-- security_invoker so the view does not become a hole around the RLS on
-- ai_calls: without it a view runs as its owner and PostgREST would
-- happily serve the whole ledger to anybody.
-- ============================================================

create or replace view public.ai_spend_24h
  with (security_invoker = true) as
  select coalesce(sum(cost_micros), 0)::bigint as cost_micros,
         count(*)::int                          as calls,
         count(*) filter (where not ok)::int    as failures
    from public.ai_calls
   where at > now() - interval '24 hours';

revoke all on public.ai_spend_24h from anon, authenticated;
