-- PENDING ONLY, after creator_domains_v1 + creator_domain_targets_v1.
-- Deploy the matching adapter before enabling domains. No provider records seeded.
begin;
alter table public.creator_domains add column provider_zone_id text;
alter table public.creator_domains add column provider_state text not null default 'none'
 check(provider_state in ('none','started','bound','reconciliation_required'));
alter table public.creator_domains add column operation_id uuid;
-- A legacy provider ID has no verified zone provenance. Do not infer it from env.
update public.creator_domains set provider_state='reconciliation_required',status='error',
 last_error='Existing provider binding requires reviewed zone reconciliation' where provider_id is not null;
alter table public.creator_domains add constraint creator_domain_bound_provider
 check(provider_state<>'bound' or (provider_id is not null and provider_zone_id is not null));
create unique index creator_domain_provider_identity on public.creator_domains(provider_zone_id,provider_id) where provider_id is not null and provider_zone_id is not null;
-- Detached/uncertain claims retain the hostname until known remote cleanup succeeds.
drop index public.creator_domains_verified_host;
create unique index creator_domains_verified_host on public.creator_domains(hostname) where ownership_verified_at is not null;
create function public.guard_creator_domain_provider_v1() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (old.provider_id is not null and new.provider_id is distinct from old.provider_id)
 or (old.provider_zone_id is not null and new.provider_zone_id is distinct from old.provider_zone_id) then
  raise exception 'Provider identity is immutable; reviewed reconciliation required';
 end if;
 return new;
end $$;
revoke all on function public.guard_creator_domain_provider_v1() from public,anon,authenticated;
create trigger creator_domain_provider_identity before update on public.creator_domains
 for each row execute function public.guard_creator_domain_provider_v1();
create function public.claim_creator_domain_v2(domain_id uuid,owner_id uuid,operation_id uuid,mark_verified boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.creator_domains;
begin
 select * into r from public.creator_domains where id=domain_id and auth_user_id=owner_id for update;
 if not found or r.lease_until>now() then return null;end if;
 if operation_id is null then raise exception 'operation required' using errcode='22023';end if;
 if mark_verified is distinct from false and r.status='detached' then raise exception 'disconnect pending' using errcode='40001';end if;
 update public.creator_domains d set operation_id=claim_creator_domain_v2.operation_id,lease_until=now()+interval '2 minutes',
 ownership_verified_at=case when mark_verified then coalesce(d.ownership_verified_at,now()) else d.ownership_verified_at end,
 provider_state=case when d.provider_state='started' then 'reconciliation_required' else d.provider_state end,
 status=case when not mark_verified then 'detached' else d.status end
 where id=domain_id returning * into r;
 return to_jsonb(r);
end $$;
create function public.update_creator_domain_v2(domain_id uuid,owner_id uuid,operation_id uuid,changes jsonb default '{}',finish boolean default false,forget boolean default false,expected_provider_state text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.creator_domains;
begin
 select * into r from public.creator_domains d where d.id=domain_id and d.auth_user_id=owner_id
 and d.operation_id=update_creator_domain_v2.operation_id and d.lease_until>now() for update;
 if not found then raise exception 'domain operation changed; reconcile current state' using errcode='40001';end if;
 if expected_provider_state is not null and r.provider_state<>expected_provider_state then raise exception 'provider state changed; read durable binding' using errcode='40001';end if;
 if forget then
  if r.status<>'detached' or r.provider_state in ('started','reconciliation_required') then raise exception 'provider reconciliation required' using errcode='40001';end if;
  delete from public.creator_domains where id=domain_id;return null;
 end if;
 if jsonb_typeof(changes)<>'object' or exists(select 1 from jsonb_object_keys(changes) k where k not in ('status','provider_id','provider_zone_id','provider_state','ssl_status','provider_records','last_checked_at','last_error')) then raise exception 'invalid domain update' using errcode='22023';end if;
 update public.creator_domains d set
 status=coalesce(changes->>'status',d.status),provider_id=coalesce(changes->>'provider_id',d.provider_id),
 provider_zone_id=coalesce(changes->>'provider_zone_id',d.provider_zone_id),provider_state=coalesce(changes->>'provider_state',d.provider_state),
 ssl_status=coalesce(changes->>'ssl_status',d.ssl_status),provider_records=coalesce(changes->'provider_records',d.provider_records),
 last_checked_at=coalesce((changes->>'last_checked_at')::timestamptz,d.last_checked_at),
 last_error=case when changes?'last_error' then changes->>'last_error' else d.last_error end,
 lease_until=case when finish then null else now()+interval '2 minutes' end,
 operation_id=case when finish then null else d.operation_id end
 where id=domain_id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.claim_creator_domain_v2(uuid,uuid,uuid,boolean),public.update_creator_domain_v2(uuid,uuid,uuid,jsonb,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_creator_domain_v2(uuid,uuid,uuid,boolean),public.update_creator_domain_v2(uuid,uuid,uuid,jsonb,boolean,boolean,text) to service_role;
commit;
