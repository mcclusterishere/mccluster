-- Private draft planning in the canonical data plane. No fare or booking status.
create table public.travel_journeys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_journeys_size check (octet_length(plan::text) <= 8192)
);
create index travel_journeys_owner_updated on public.travel_journeys(owner_id, updated_at desc);
alter table public.travel_journeys enable row level security;
revoke all on public.travel_journeys from public, anon, authenticated;
grant select, delete on public.travel_journeys to authenticated;
grant insert (plan), update (plan) on public.travel_journeys to authenticated;
create policy journeys_select on public.travel_journeys for select to authenticated using (owner_id = (select auth.uid()));
create policy journeys_insert on public.travel_journeys for insert to authenticated with check (owner_id = (select auth.uid()));
create policy journeys_update on public.travel_journeys for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy journeys_delete on public.travel_journeys for delete to authenticated using (owner_id = (select auth.uid()));

create function public.travel_journey_validate() returns trigger language plpgsql set search_path = '' as $$
declare p jsonb := new.plan; k text; v jsonb; c jsonb; d date; r date;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->'version' is distinct from '1'::jsonb then raise exception 'Invalid journey version' using errcode='23514'; end if;
  if p - array['version','from','to','departure','returning','travelers','mode','departureHub','arrivalHub','stay','lowestCost','freeOptions'] <> '{}'::jsonb then raise exception 'Unknown journey fields' using errcode='23514'; end if;
  if jsonb_typeof(p->'travelers') is distinct from 'number' or (p->>'travelers') !~ '^(1[0-6]|[1-9])$' then raise exception 'Invalid travelers' using errcode='23514'; end if;
  if not coalesce(p->>'mode' in ('flight','train','drive','transit','walk','cycle'),false) then raise exception 'Invalid travel mode' using errcode='23514'; end if;
  foreach k in array array['from','to'] loop
    v := p->k;
    if jsonb_typeof(v) is distinct from 'object' or v - array['label','coordinates'] <> '{}'::jsonb
       or jsonb_typeof(v->'label') is distinct from 'string' or length(trim(v->>'label')) not between 1 and 240 or (v->>'label') ~ '[[:cntrl:]]' then raise exception 'Invalid journey place' using errcode='23514'; end if;
    c := v->'coordinates';
    if c is not null and c <> 'null'::jsonb then
      if jsonb_typeof(c) <> 'array' then raise exception 'Invalid coordinates' using errcode='23514'; end if;
      if jsonb_array_length(c) <> 2 or jsonb_typeof(c->0) is distinct from 'number' or jsonb_typeof(c->1) is distinct from 'number' then raise exception 'Invalid coordinates' using errcode='23514'; end if;
      if abs((c->>0)::numeric)>180 or abs((c->>1)::numeric)>90 then raise exception 'Invalid coordinates' using errcode='23514'; end if;
    end if;
  end loop;
  foreach k in array array['departure','returning','departureHub','arrivalHub','stay'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)>240 or (p->>k) ~ '[[:cntrl:]]' then raise exception 'Invalid journey text' using errcode='23514'; end if;
  end loop;
  foreach k in array array['lowestCost','freeOptions'] loop
    if jsonb_typeof(p->k) is distinct from 'boolean' then raise exception 'Invalid preference' using errcode='23514'; end if;
  end loop;
  if p->>'departure' <> '' then
    if p->>'departure' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid departure' using errcode='23514'; end if;
    d := (p->>'departure')::date;
  end if;
  if p->>'returning' <> '' then
    if p->>'returning' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid return' using errcode='23514'; end if;
    r := (p->>'returning')::date;
    if d is null or r < d then raise exception 'Return precedes departure' using errcode='23514'; end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
revoke all on function public.travel_journey_validate() from public, anon, authenticated;
create trigger travel_journey_validate before insert or update on public.travel_journeys for each row execute function public.travel_journey_validate();
comment on table public.travel_journeys is 'Private member-authored trip drafts. Never reservations, quotes or dispatch records.';
