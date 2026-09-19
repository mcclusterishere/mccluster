-- Human-readable stable publication IDs: EU-2026-DC-001, etc.
create table if not exists public.eu_publication_sequences (
  org_id uuid not null references public.orgs(id) on delete cascade,
  publication_year integer not null,
  series_key text not null,
  last_value integer not null default 0,
  primary key(org_id, publication_year, series_key)
);
alter table public.eu_publication_sequences enable row level security;
revoke all on public.eu_publication_sequences from anon, authenticated;

create or replace function private.eu_next_publication_id(p_org uuid, p_series text default 'GEN')
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare y integer:=extract(year from now())::integer; v integer; s text;
begin
  -- Uppercase BEFORE stripping. The original stripped [^A-Z0-9] from the raw
  -- input first, so a lowercase series like 'dc' lost every character and
  -- produced 'EU-2026--001'. Publication IDs are meant to be stable citations;
  -- they are not something to discover is malformed after the fact.
  s:=regexp_replace(upper(coalesce(nullif(trim(p_series),''),'GEN')),'[^A-Z0-9]+','','g');
  s:=left(nullif(s,''),6);
  if s is null or s='' then s:='GEN'; end if;
  insert into public.eu_publication_sequences(org_id,publication_year,series_key,last_value)
  values(p_org,y,s,1)
  on conflict(org_id,publication_year,series_key) do update set last_value=public.eu_publication_sequences.last_value+1
  returning last_value into v;
  return 'EU-'||y::text||'-'||s||'-'||lpad(v::text,3,'0');
end;
$$;
revoke all on function private.eu_next_publication_id(uuid,text) from public,anon,authenticated;

create or replace function public.eu_next_publication_id_service(p_org uuid,p_series text default 'GEN')
returns text language sql security definer set search_path=pg_catalog,public,private as $$
  select private.eu_next_publication_id(p_org,p_series);
$$;
revoke all on function public.eu_next_publication_id_service(uuid,text) from public,anon,authenticated;
grant execute on function public.eu_next_publication_id_service(uuid,text) to service_role;
