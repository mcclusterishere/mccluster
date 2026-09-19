-- Secure server-only OAuth runtime for person-scoped integrations such as ORCID.
-- Raw tokens never enter public tables; only Vault UUID references do.

create table if not exists private.eu_oauth_states (
  state_hash text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  provider text not null,
  redirect_after text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz
);
create index if not exists eu_oauth_states_expiry_idx on private.eu_oauth_states(expires_at) where consumed_at is null;
revoke all on table private.eu_oauth_states from public, anon, authenticated;
grant select,insert,update,delete on private.eu_oauth_states to service_role;

create or replace function public.eu_oauth_state_create_service(
  p_state_hash text, p_org uuid, p_m_uid uuid, p_provider text,
  p_redirect_after text default '', p_ttl_seconds integer default 600
)
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if p_state_hash is null or length(p_state_hash) < 32 then raise exception 'invalid state hash'; end if;
  insert into private.eu_oauth_states(state_hash,org_id,m_uid,provider,redirect_after,expires_at)
  values(p_state_hash,p_org,p_m_uid,left(p_provider,80),left(coalesce(p_redirect_after,''),1000),now()+make_interval(secs=>greatest(60,least(coalesce(p_ttl_seconds,600),1800))));
end;
$$;
revoke all on function public.eu_oauth_state_create_service(text,uuid,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.eu_oauth_state_create_service(text,uuid,uuid,text,text,integer) to service_role;

create or replace function public.eu_oauth_state_consume_service(p_state_hash text, p_provider text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare r private.eu_oauth_states%rowtype;
begin
  select * into r from private.eu_oauth_states
   where state_hash=p_state_hash and provider=p_provider and consumed_at is null and expires_at>now()
   for update;
  if r.state_hash is null then return null; end if;
  update private.eu_oauth_states set consumed_at=now() where state_hash=r.state_hash;
  return jsonb_build_object('org_id',r.org_id,'m_uid',r.m_uid,'redirect_after',r.redirect_after);
end;
$$;
revoke all on function public.eu_oauth_state_consume_service(text,text) from public, anon, authenticated;
grant execute on function public.eu_oauth_state_consume_service(text,text) to service_role;

create or replace function public.eu_vault_store_service(p_secret text,p_name text default null,p_description text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, vault as $$
declare v_id uuid;
begin
  if p_secret is null or length(p_secret)=0 then raise exception 'secret required'; end if;
  select vault.create_secret(p_secret,nullif(left(p_name,200),''),left(coalesce(p_description,''),500)) into v_id;
  return v_id;
end;
$$;
revoke all on function public.eu_vault_store_service(text,text,text) from public, anon, authenticated;
grant execute on function public.eu_vault_store_service(text,text,text) to service_role;

create or replace function public.eu_oauth_state_gc_service()
returns integer language plpgsql security definer set search_path = pg_catalog, private as $$
declare n integer;
begin
  delete from private.eu_oauth_states where expires_at < now()-interval '1 hour' or consumed_at < now()-interval '1 day';
  get diagnostics n=row_count; return n;
end;
$$;
revoke all on function public.eu_oauth_state_gc_service() from public, anon, authenticated;
grant execute on function public.eu_oauth_state_gc_service() to service_role;
