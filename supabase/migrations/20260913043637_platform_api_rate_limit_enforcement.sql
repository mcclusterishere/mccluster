create table if not exists public.api_rate_limit_windows (
  scope_type text not null check (scope_type in ('consumer','api_key')),
  scope_id uuid not null,
  bucket_start timestamptz not null,
  request_count bigint not null default 0 check (request_count >= 0),
  last_route text,
  updated_at timestamptz not null default now(),
  primary key (scope_type, scope_id, bucket_start)
);

alter table public.api_rate_limit_windows enable row level security;
revoke all on table public.api_rate_limit_windows from public, anon, authenticated;
grant all on table public.api_rate_limit_windows to service_role;

create index if not exists api_rate_limit_windows_bucket_idx
  on public.api_rate_limit_windows(bucket_start);

create or replace function public.api_enforce_rate_limit(
  p_consumer_id uuid,
  p_api_key_id uuid,
  p_route text default null
)
returns table(
  allowed boolean,
  limit_per_minute integer,
  consumer_count bigint,
  key_count bigint,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer;
  v_bucket timestamptz := date_trunc('minute', now());
  v_consumer_count bigint;
  v_key_count bigint;
  v_key_consumer uuid;
begin
  select k.consumer_id
    into v_key_consumer
  from public.api_keys k
  where k.id = p_api_key_id
    and k.status = 'active'
    and (k.expires_at is null or k.expires_at > now());

  if v_key_consumer is null or v_key_consumer <> p_consumer_id then
    raise exception 'invalid API key principal';
  end if;

  select p.rate_limit_per_minute
    into v_limit
  from public.api_consumers c
  join public.api_plans p on p.plan_code = c.plan_code
  where c.id = p_consumer_id
    and c.status = 'active'
    and p.enabled = true;

  if v_limit is null or v_limit <= 0 then
    raise exception 'API plan has no valid rate limit';
  end if;

  insert into public.api_rate_limit_windows(scope_type, scope_id, bucket_start, request_count, last_route)
  values('consumer', p_consumer_id, v_bucket, 1, left(coalesce(p_route,''), 500))
  on conflict (scope_type, scope_id, bucket_start)
  do update set
    request_count = public.api_rate_limit_windows.request_count + 1,
    last_route = excluded.last_route,
    updated_at = now()
  returning request_count into v_consumer_count;

  insert into public.api_rate_limit_windows(scope_type, scope_id, bucket_start, request_count, last_route)
  values('api_key', p_api_key_id, v_bucket, 1, left(coalesce(p_route,''), 500))
  on conflict (scope_type, scope_id, bucket_start)
  do update set
    request_count = public.api_rate_limit_windows.request_count + 1,
    last_route = excluded.last_route,
    updated_at = now()
  returning request_count into v_key_count;

  allowed := (v_consumer_count <= v_limit and v_key_count <= v_limit);
  limit_per_minute := v_limit;
  consumer_count := v_consumer_count;
  key_count := v_key_count;
  remaining := greatest(0, v_limit - greatest(v_consumer_count, v_key_count))::integer;
  reset_at := v_bucket + interval '1 minute';
  return next;
end;
$$;

revoke all on function public.api_enforce_rate_limit(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.api_enforce_rate_limit(uuid,uuid,text) to service_role;
