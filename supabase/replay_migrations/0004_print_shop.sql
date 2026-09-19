-- THE PRINT SHOP — orders on the record. Written by the payment
-- machinery (service role) once Stripe checkout is armed; until
-- then orders travel the leads rail. Owner reads and works them.

create table if not exists public.print_orders (
  id             uuid primary key default gen_random_uuid(),
  at             timestamptz not null default now(),
  photo_id       text not null,
  format         text not null,
  price_usd      numeric not null,
  buyer_name     text not null,
  buyer_email    text not null,
  ship_to        jsonb,
  status         text not null default 'unpaid'
    check (status in ('unpaid','paid','submitted','shipped','delivered','fulfilled','canceled')),
  stripe_session text,
  lab_order_id   text,
  tracking       text
);

alter table public.print_orders enable row level security;

drop policy if exists po_desk on public.print_orders;
create policy po_desk on public.print_orders
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

drop policy if exists po_work on public.print_orders;
create policy po_work on public.print_orders
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

grant select, update on public.print_orders to authenticated;

create index if not exists po_at on public.print_orders (at desc);

-- the vault for sellable files: RAW + full-res live PRIVATE; buyers
-- get expiring signed links after payment, never public URLs
insert into storage.buckets (id, name, public)
values ('masters', 'masters', false)
on conflict (id) do nothing;
