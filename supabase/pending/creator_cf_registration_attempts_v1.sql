-- PENDING ONLY, after creator_domain_orders_v1. No contact PII is stored here.
begin;
create table public.creator_cf_registration_attempts (
 order_id uuid primary key references public.creator_domain_orders(id),
 auth_user_id uuid not null references auth.users(id), hostname text not null unique,
 contact_ref text not null, contact_sha256 text not null check(contact_sha256 ~ '^[0-9a-f]{64}$'),
 status text not null default 'prepared' check(status in ('prepared','submit_started','processing','action_required','refund_required','reconciliation_required','registered_pending_reconciliation')),
 request_sha256 text, submitted_at timestamptz, outcome jsonb,
 created_at timestamptz not null default now()
);
alter table public.creator_cf_registration_attempts enable row level security;
alter table public.creator_cf_registration_attempts force row level security;
revoke all on public.creator_cf_registration_attempts from public,anon,authenticated;
grant select,insert,update on public.creator_cf_registration_attempts to service_role;
create function public.claim_cf_registration_attempt(p_order uuid,p_owner uuid,p_contact_ref text,p_contact_sha text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o jsonb; begin
 if not exists(select 1 from public.creator_domain_orders where id=p_order and auth_user_id=p_owner and status='funded') then return null; end if;
 if p_contact_ref is null or length(p_contact_ref) not between 1 and 512 or p_contact_sha !~ '^[0-9a-f]{64}$' then raise exception 'Immutable contact reference required'; end if;
 o=public.claim_creator_domain_order(p_order);
 if o is null then return null; end if;
 if o->>'action'<>'register' then raise exception 'Registration only'; end if;
 insert into public.creator_cf_registration_attempts(order_id,auth_user_id,hostname,contact_ref,contact_sha256)
 values(p_order,p_owner,o->>'hostname',p_contact_ref,p_contact_sha);
 return o || jsonb_build_object('contact_ref',p_contact_ref,'contact_sha256',p_contact_sha);
end; $$;
create function public.guard_cf_registration_attempt() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.order_id,new.auth_user_id,new.hostname,new.contact_ref,new.contact_sha256,new.created_at)
 is distinct from (old.order_id,old.auth_user_id,old.hostname,old.contact_ref,old.contact_sha256,old.created_at) then raise exception 'Registration identity immutable'; end if;
 if old.submitted_at is not null and (new.submitted_at,new.request_sha256) is distinct from (old.submitted_at,old.request_sha256) then raise exception 'Submission immutable'; end if;
 if old.status in ('registered_pending_reconciliation','refund_required') then raise exception 'Registration outcome terminal'; end if;
 if (old.status='prepared' and new.status not in ('submit_started','refund_required')) or
 (old.status<>'prepared' and new.status in ('prepared','submit_started','refund_required')) then raise exception 'Registration state cannot be replayed'; end if;
 if new.status='submit_started' and (new.submitted_at is null or new.request_sha256 is null or new.request_sha256 !~ '^[0-9a-f]{64}$') then raise exception 'Submission proof required'; end if;
 return new;
end; $$;
create trigger cf_registration_attempt_guard before update on public.creator_cf_registration_attempts for each row execute function public.guard_cf_registration_attempt();
revoke all on function public.claim_cf_registration_attempt(uuid,uuid,text,text),public.guard_cf_registration_attempt() from public,anon,authenticated;
grant execute on function public.claim_cf_registration_attempt(uuid,uuid,text,text) to service_role;
commit;
