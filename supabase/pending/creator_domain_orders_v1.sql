-- Domain sales substrate. Apply only after explicit schema review/authorization.
begin;
create table public.creator_domain_contacts (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id) on delete restrict,
 provider_contact_id text not null, terms_version text not null, consent_at timestamptz not null, verified_at timestamptz not null, created_at timestamptz not null default now(), unique(auth_user_id,provider_contact_id)
);
create table public.creator_domain_quotes (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id) on delete restrict,
 hostname text not null, action text not null check(action in ('register','renew')), years integer not null check(years between 1 and 10),
 total_cents integer not null check(total_cents>0), registrar_cents integer not null check(registrar_cents>0 and registrar_cents<=total_cents),
 currency text not null check(currency='USD'), expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.creator_domain_orders (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid not null references auth.users(id) on delete restrict,
 quote_id uuid not null unique references public.creator_domain_quotes(id), contact_id uuid not null references public.creator_domain_contacts(id),
 terms_version text not null, consent_at timestamptz not null default now(),
 status text not null default 'awaiting_payment' check(status in ('awaiting_payment','funded','executing','fulfilled','blocked','reconciliation_required','refund_required')),
 checkout_session_id text unique, funded_event_id text unique, paid_cents integer, funded_at timestamptz,
 registrar_amount text, registrar_code text, reason text, expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index creator_domain_orders_owner on public.creator_domain_orders(auth_user_id,created_at desc);
create index creator_domain_contacts_owner on public.creator_domain_contacts(auth_user_id);
create index creator_domain_quotes_owner on public.creator_domain_quotes(auth_user_id,created_at desc);
alter table public.creator_domain_contacts enable row level security;
alter table public.creator_domain_contacts force row level security;
alter table public.creator_domain_quotes enable row level security;
alter table public.creator_domain_quotes force row level security;
alter table public.creator_domain_orders enable row level security;
alter table public.creator_domain_orders force row level security;
revoke all on public.creator_domain_contacts,public.creator_domain_quotes,public.creator_domain_orders from public,anon,authenticated;
grant select,insert on public.creator_domain_contacts,public.creator_domain_quotes to service_role;
grant select,insert,update on public.creator_domain_orders to service_role;
-- No role used by the application can modify a quoted amount or a verified contact.
create function public.guard_creator_domain_order() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.auth_user_id,new.quote_id,new.contact_id,new.terms_version,new.consent_at) is distinct from (old.auth_user_id,old.quote_id,old.contact_id,old.terms_version,old.consent_at) then raise exception 'Domain order identity and consent are immutable'; end if;
 if not exists(select 1 from public.creator_domain_quotes q join public.creator_domain_contacts c on c.id=new.contact_id where q.id=new.quote_id and q.auth_user_id=new.auth_user_id and c.auth_user_id=new.auth_user_id) then raise exception 'Quote and contact must belong to order owner'; end if;
 return new;
end; $$;
create trigger creator_domain_order_guard before insert or update on public.creator_domain_orders for each row execute function public.guard_creator_domain_order();
revoke all on function public.guard_creator_domain_order() from public,anon,authenticated;
create function public.fund_creator_domain_order(order_id uuid,owner_id uuid,event_id text,session_id text,amount_cents integer,event_currency text,paid_at timestamptz)
returns text language plpgsql security invoker set search_path='' as $$
declare o public.creator_domain_orders; q public.creator_domain_quotes;
begin
 select * into o from public.creator_domain_orders where id=order_id and auth_user_id=owner_id for update;
 if not found then return 'not_found'; end if;
 if o.funded_event_id is not null then return case when o.checkout_session_id=session_id then o.status else 'conflict' end; end if;
 if o.status<>'awaiting_payment' or (o.checkout_session_id is not null and o.checkout_session_id<>session_id) then return 'conflict'; end if;
 select * into q from public.creator_domain_quotes where id=o.quote_id;
 if q.total_cents<>amount_cents or q.currency<>event_currency or paid_at>q.expires_at then
  update public.creator_domain_orders set status='refund_required',reason='Payment does not match a current quote',funded_event_id=event_id,checkout_session_id=session_id,paid_cents=amount_cents,funded_at=paid_at,updated_at=now() where id=o.id;
  return 'refund_required';
 end if;
 update public.creator_domain_orders set status='funded',funded_event_id=event_id,checkout_session_id=session_id,paid_cents=amount_cents,funded_at=paid_at,updated_at=now() where id=o.id;
 return 'funded';
end; $$;
create function public.claim_creator_domain_order(order_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.creator_domain_orders; q public.creator_domain_quotes; c public.creator_domain_contacts;
begin
 update public.creator_domain_orders set status='executing',updated_at=now() where id=order_id and status='funded' returning * into o;
 if not found then return null; end if;
 select * into q from public.creator_domain_quotes where id=o.quote_id;
 select * into c from public.creator_domain_contacts where id=o.contact_id;
 return jsonb_build_object('id',o.id,'auth_user_id',o.auth_user_id,'hostname',q.hostname,'action',q.action,'years',q.years,'currency',q.currency,'total_cents',q.total_cents,'registrar_cents',q.registrar_cents,'paid_cents',o.paid_cents,'funded_event_id',o.funded_event_id,'consent_at',o.consent_at,'registrant_contact_id',c.provider_contact_id,'quote_expires_at',extract(epoch from q.expires_at)*1000);
end; $$;
revoke all on function public.fund_creator_domain_order(uuid,uuid,text,text,integer,text,timestamptz),public.claim_creator_domain_order(uuid) from public,anon,authenticated;
grant execute on function public.fund_creator_domain_order(uuid,uuid,text,text,integer,text,timestamptz),public.claim_creator_domain_order(uuid) to service_role;
commit;
