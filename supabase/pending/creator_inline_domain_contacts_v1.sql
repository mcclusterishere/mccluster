-- PENDING, after creator_cf_registration_attempts_v1. No encryption key provisioned.
begin;
alter table public.creator_domain_contacts alter column provider_contact_id drop not null;
alter table public.creator_domain_contacts alter column verified_at drop not null;
alter table public.creator_domain_contacts add column contact_kind text not null default 'provider' check(contact_kind in ('provider','inline'));
alter table public.creator_domain_contacts add column sealed_contact text;
alter table public.creator_domain_contacts add column contact_key_id text;
alter table public.creator_domain_contacts add column contact_sha256 text;
alter table public.creator_domain_contacts add column expires_at timestamptz;
alter table public.creator_domain_contacts add column deleted_at timestamptz;
alter table public.creator_domain_contacts add constraint creator_domain_contact_kind_check check(
 (contact_kind='provider' and provider_contact_id is not null and verified_at is not null and sealed_contact is null) or
 (contact_kind='inline' and provider_contact_id is null and verified_at is null and expires_at is not null and
 contact_sha256 is not null and contact_sha256 ~ '^[0-9a-f]{64}$' and contact_key_id is not null and
 ((deleted_at is null and sealed_contact is not null) or (deleted_at is not null and sealed_contact is null)))
);
alter table public.creator_domain_quotes add column registrar text not null default 'legacy' check(registrar in ('legacy','cloudflare_sandbox'));
grant update on public.creator_domain_contacts to service_role;
create function public.guard_inline_domain_contact() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.contact_kind<>'inline' or new.deleted_at is null or new.sealed_contact is not null or
 (new.id,new.auth_user_id,new.contact_kind,new.contact_key_id,new.contact_sha256,new.terms_version,new.consent_at,new.expires_at,new.provider_contact_id,new.verified_at,new.created_at)
 is distinct from (old.id,old.auth_user_id,old.contact_kind,old.contact_key_id,old.contact_sha256,old.terms_version,old.consent_at,old.expires_at,old.provider_contact_id,old.verified_at,old.created_at)
 then raise exception 'Contact immutable except ciphertext erasure'; end if;
 return new;
end; $$;
create trigger inline_domain_contact_guard before update on public.creator_domain_contacts for each row execute function public.guard_inline_domain_contact();
create or replace function public.guard_creator_domain_order() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.auth_user_id,new.quote_id,new.contact_id,new.terms_version,new.consent_at) is distinct from (old.auth_user_id,old.quote_id,old.contact_id,old.terms_version,old.consent_at) then raise exception 'Domain order identity and consent are immutable'; end if;
 if not exists(select 1 from public.creator_domain_quotes q join public.creator_domain_contacts c on c.id=new.contact_id where q.id=new.quote_id and q.auth_user_id=new.auth_user_id and c.auth_user_id=new.auth_user_id and ((q.registrar='legacy' and c.contact_kind='provider') or (q.registrar='cloudflare_sandbox' and c.contact_kind='inline'))) then raise exception 'Quote and contact must belong to order owner and registrar'; end if;
 if tg_op='INSERT' and not exists(select 1 from public.creator_domain_contacts c where c.id=new.contact_id and c.terms_version=new.terms_version and c.deleted_at is null and (c.expires_at is null or c.expires_at>now())) then raise exception 'Current consent contact required'; end if;
 return new;
end; $$;
create or replace function public.claim_cf_registration_attempt(p_order uuid,p_owner uuid,p_contact_ref text,p_contact_sha text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o jsonb; c public.creator_domain_contacts; begin
 select c0.* into c from public.creator_domain_orders o0 join public.creator_domain_contacts c0 on c0.id=o0.contact_id join public.creator_domain_quotes q on q.id=o0.quote_id
 where o0.id=p_order and o0.auth_user_id=p_owner and o0.status='funded' and q.registrar='cloudflare_sandbox'
 and c0.contact_kind='inline' and c0.auth_user_id=p_owner and c0.deleted_at is null and c0.expires_at>now() and c0.terms_version=o0.terms_version for update of c0;
 if not found then return null; end if;
 if p_contact_ref is distinct from c.id::text or p_contact_sha is distinct from c.contact_sha256 then raise exception 'Contact does not match funded order'; end if;
 o=public.claim_creator_domain_order(p_order);if o is null then return null; end if;
 if o->>'action'<>'register' then raise exception 'Registration only'; end if;
 insert into public.creator_cf_registration_attempts(order_id,auth_user_id,hostname,contact_ref,contact_sha256) values(p_order,p_owner,o->>'hostname',c.id::text,c.contact_sha256);
 return o || jsonb_build_object('contact_ref',c.id::text,'contact_sha256',c.contact_sha256);
end; $$;
create function public.erase_expired_domain_contacts() returns bigint language plpgsql security invoker set search_path='' as $$
declare n bigint; begin
 update public.creator_domain_contacts set sealed_contact=null,deleted_at=now() where contact_kind='inline' and deleted_at is null and expires_at<=now();
 get diagnostics n=row_count;return n;
end; $$;
revoke all on function public.guard_inline_domain_contact(),public.erase_expired_domain_contacts() from public,anon,authenticated;
grant execute on function public.erase_expired_domain_contacts() to service_role;
commit;
