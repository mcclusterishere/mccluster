-- STAGED: free creator service offers, independent of paid website subscriptions.
create table if not exists public.creator_service_offers (
 id uuid primary key default gen_random_uuid(),
 m_uid uuid not null references public.m_people(id) on delete cascade,
 title text not null check(char_length(trim(title)) between 3 and 120),
 description text not null default '' check(char_length(description)<=1200),
 price_cents integer not null check(price_cents>=0 and price_cents<=100000000),
 action_url text not null check(char_length(action_url)<=2000 and action_url ~* '^https://[^[:space:]]+$'),
 status text not null default 'draft' check(status in ('draft','published')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists creator_service_offers_owner_idx on public.creator_service_offers(m_uid,status);
alter table public.creator_service_offers enable row level security;
alter table public.creator_service_offers force row level security;
revoke all on public.creator_service_offers from anon,authenticated;
grant select on public.creator_service_offers to anon,authenticated;
grant insert,update,delete on public.creator_service_offers to authenticated;
drop policy if exists creator_service_read on public.creator_service_offers;
create policy creator_service_read on public.creator_service_offers for select to anon,authenticated
using (
 (status='published' and exists(select 1 from public.network_profiles p where p.m_uid=creator_service_offers.m_uid and p.visibility='public'))
 or (auth.uid() is not null and m_uid=public.current_m_uid())
);
drop policy if exists creator_service_insert on public.creator_service_offers;
create policy creator_service_insert on public.creator_service_offers for insert to authenticated
with check(auth.uid() is not null and m_uid=public.current_m_uid());
drop policy if exists creator_service_update on public.creator_service_offers;
create policy creator_service_update on public.creator_service_offers for update to authenticated
using(auth.uid() is not null and m_uid=public.current_m_uid())
with check(auth.uid() is not null and m_uid=public.current_m_uid());
drop policy if exists creator_service_delete on public.creator_service_offers;
create policy creator_service_delete on public.creator_service_offers for delete to authenticated
using(auth.uid() is not null and m_uid=public.current_m_uid());
-- Prevent uncontrolled offer spam while still allowing multiple services.
create or replace function public.creator_service_offer_limit()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (select count(*) from public.creator_service_offers where m_uid=new.m_uid)>=10
 then raise exception 'Maximum of 10 service offers'; end if;
 return new;
end $$;
drop trigger if exists creator_service_offer_limit_trigger on public.creator_service_offers;
create trigger creator_service_offer_limit_trigger before insert on public.creator_service_offers
for each row execute function public.creator_service_offer_limit();
