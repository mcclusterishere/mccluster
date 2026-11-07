-- Pending review/application only. No production migration history entry.
begin;
create table public.creator_domains (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null references auth.users(id) on delete restrict,
 handle text not null check(handle ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
 hostname text not null check(hostname = lower(hostname)),
 verification_token text not null,
 status text not null default 'ownership_pending' check(status in ('ownership_pending','dns_pending','tls_pending','active','error','detached','plan_required')),
 provider_id text, ssl_status text,
 provider_records jsonb not null default '[]'::jsonb,
 ownership_verified_at timestamptz, last_checked_at timestamptz, last_error text, lease_until timestamptz,
 created_at timestamptz not null default now(), unique(auth_user_id,hostname)
);
create unique index creator_domains_verified_host on public.creator_domains(hostname) where ownership_verified_at is not null and status <> 'detached';
alter table public.creator_domains enable row level security;
alter table public.creator_domains force row level security;
revoke all on public.creator_domains from public, anon, authenticated;
grant select, insert, update, delete on public.creator_domains to service_role;
-- Privileged operations go exclusively through the Worker; browser cannot forge verification or ownership.
create function public.claim_creator_domain(domain_id uuid, owner_id uuid, mark_verified boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
 update public.creator_domains set lease_until = now() + interval '2 minutes', ownership_verified_at = case when mark_verified then coalesce(ownership_verified_at,now()) else ownership_verified_at end
 where id = domain_id and auth_user_id = owner_id and (status <> 'detached' or not mark_verified) and (lease_until is null or lease_until < now());
 return found;
end;
$$;
revoke all on function public.claim_creator_domain(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_creator_domain(uuid,uuid,boolean) to service_role;
commit;
