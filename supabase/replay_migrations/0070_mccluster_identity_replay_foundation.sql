-- Reconstruct the canonical McCluster public-id helpers that already exist in production.
-- This migration is replay-only for source-controlled resets and does not change the live contract.

create or replace function public.normalize_mccluster_id(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select lower(regexp_replace(btrim(coalesce(p_value,'')), '[^a-zA-Z0-9._-]+', '', 'g'));
$$;

create or replace function public.generate_mccluster_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  words text[] := array['atlas','ember','nova','river','cedar','orbit','pixel','sonic','velvet','cobalt','summit','lunar','vivid','echo','onyx','prism','rover','tempo','zenith','cinder'];
  candidate text;
  tries int := 0;
begin
  loop
    tries := tries + 1;
    candidate := words[1 + floor(random() * array_length(words,1))::int] || lpad(floor(random()*10000)::int::text,4,'0');
    exit when not exists (select 1 from public.platform_profiles where lower(mccluster_id)=lower(candidate));
    if tries > 100 then raise exception 'mccluster_id_generation_failed'; end if;
  end loop;
  return candidate;
end;
$$;

create or replace function public.platform_assign_mccluster_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mccluster_id is null or btrim(new.mccluster_id) = '' then
    new.mccluster_id := public.generate_mccluster_id();
  else
    new.mccluster_id := lower(btrim(new.mccluster_id));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_platform_assign_mccluster_id on public.platform_profiles;
create trigger trg_platform_assign_mccluster_id
before insert on public.platform_profiles
for each row execute function public.platform_assign_mccluster_id();

create or replace function public.set_mccluster_id(p_mccluster_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_id text := public.normalize_mccluster_id(p_mccluster_id);
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if v_id !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then raise exception 'invalid_mccluster_id'; end if;
  if exists(select 1 from public.platform_profiles where lower(mccluster_id)=v_id and user_id<>v_uid) then
    raise exception 'mccluster_id_taken';
  end if;
  update public.platform_profiles set mccluster_id=v_id, updated_at=now() where user_id=v_uid;
  if not found then raise exception 'profile_not_found'; end if;
  return jsonb_build_object('ok',true,'mccluster_id',v_id);
end;
$$;

revoke all on function public.generate_mccluster_id() from public, anon, authenticated;
revoke all on function public.platform_assign_mccluster_id() from public, anon, authenticated;
revoke all on function public.set_mccluster_id(text) from public, anon;
grant execute on function public.set_mccluster_id(text) to authenticated, service_role;
grant execute on function public.generate_mccluster_id() to service_role;
grant execute on function public.platform_assign_mccluster_id() to service_role;
