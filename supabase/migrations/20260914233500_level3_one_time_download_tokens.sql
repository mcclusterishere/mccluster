-- Replace reusable Stripe Checkout session bearer access with a two-step,
-- one-time, short-lived entitlement token. Stripe session IDs may bootstrap a
-- token once; only the token may consume a download.

alter table public.l3_entitlements
  add column if not exists token_expires_at timestamptz,
  add column if not exists token_used_at timestamptz,
  add column if not exists session_exchanged_at timestamptz;

create unique index if not exists l3_entitlements_token_uq on public.l3_entitlements(token);
create index if not exists l3_entitlements_token_active_idx
  on public.l3_entitlements(token, token_expires_at)
  where revoked_at is null and token_used_at is null;

create or replace function public.l3_issue_download_token(p_entitlement uuid)
returns table(token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_expires timestamptz := now() + interval '10 minutes';
begin
  return query
  update public.l3_entitlements e
     set token = v_token,
         token_expires_at = v_expires,
         token_used_at = null,
         session_exchanged_at = now()
   where e.id = p_entitlement
     and e.revoked_at is null
     and e.session_exchanged_at is null
  returning e.token, e.token_expires_at;
end;
$$;

create or replace function public.l3_consume_download_token(p_token uuid)
returns table(entitlement_id uuid, order_id uuid, product_id uuid, customer_email text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  update public.l3_entitlements e
     set token_used_at = now(),
         last_download_at = now(),
         download_count = e.download_count + 1
   where e.token = p_token
     and e.revoked_at is null
     and e.token_used_at is null
     and e.token_expires_at > now()
  returning e.id, e.order_id, e.product_id, e.customer_email;
end;
$$;

revoke all on function public.l3_issue_download_token(uuid) from public, anon, authenticated;
revoke all on function public.l3_consume_download_token(uuid) from public, anon, authenticated;
grant execute on function public.l3_issue_download_token(uuid) to service_role;
grant execute on function public.l3_consume_download_token(uuid) to service_role;

comment on function public.l3_issue_download_token(uuid) is
  'Service-role-only single-use exchange: a paid checkout entitlement may mint one short-lived download token once.';
comment on function public.l3_consume_download_token(uuid) is
  'Service-role-only atomic one-time token consumption; increments entitlement download accounting exactly once.';
