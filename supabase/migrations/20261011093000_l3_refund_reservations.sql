-- Level 3 refund reservation ledger.
create table if not exists public.l3_refund_operations (
 id uuid primary key,
 order_id uuid not null references public.l3_orders(id),
 org_id uuid not null references public.orgs(id),
 actor_id uuid not null,
 amount_cents bigint not null check (amount_cents > 0),
 charge_id text not null,
 status text not null default 'reserved' check (status in ('reserved','reconciled','needs_reconciliation')),
 stripe_refund_id text unique,
 created_at timestamptz not null default now()
);
create unique index if not exists l3_refund_active_order_idx on public.l3_refund_operations(order_id) where status in ('reserved','needs_reconciliation');
alter table public.l3_refund_operations enable row level security;
revoke all on public.l3_refund_operations from public, anon, authenticated;
grant select, insert, update on public.l3_refund_operations to service_role;
