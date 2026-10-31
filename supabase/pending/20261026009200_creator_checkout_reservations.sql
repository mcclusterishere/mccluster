-- Pending review and authorized deployment. Never grants paid access.
create table if not exists public.creator_checkout_reservations (
 owner_user_id uuid primary key references auth.users(id),
 request_id text not null,
 price_id text not null,
 checkout_session_id text,
 expires_at timestamptz not null
);
alter table public.creator_checkout_reservations enable row level security;
revoke all on public.creator_checkout_reservations from public,anon,authenticated;
grant all on public.creator_checkout_reservations to service_role;
create or replace function public.reserve_creator_checkout(p_owner uuid,p_request text,p_price text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare reservation public.creator_checkout_reservations;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_owner is null or p_request is null or p_request !~ '^[a-zA-Z0-9-]{16,80}$' or p_price is null or p_price !~ '^price_[A-Za-z0-9]+$' then raise exception 'invalid checkout request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 if exists(select 1 from public.creator_billing_subscriptions where owner_user_id=p_owner and status in ('active','trialing','past_due','unpaid','incomplete','paused')) then
  return jsonb_build_object('blocked',true,'reason','existing_subscription');
 end if;
 select * into reservation from public.creator_checkout_reservations where owner_user_id=p_owner for update;
 if found then
  if reservation.request_id <> p_request or reservation.price_id <> p_price then
   return jsonb_build_object('blocked',true,'reason','checkout_pending','expires_at',reservation.expires_at);
  end if;
  if reservation.expires_at <= now() then return jsonb_build_object('blocked',true,'reason','checkout_reconciliation_required'); end if;
  return jsonb_build_object('blocked',false,'request_id',reservation.request_id,'expires_at',reservation.expires_at);
 end if;
 -- Never free an expired reservation on time alone: payment may have completed
 -- before expiry while the signed webhook remains delayed. Reconciliation must
 -- verify provider status before any later release implementation can allow a
 -- second Checkout. This intentionally fails closed after expiry.
 insert into public.creator_checkout_reservations(owner_user_id,request_id,price_id,expires_at) values(p_owner,p_request,p_price,now()+interval '35 minutes')
 on conflict(owner_user_id) do update set request_id=excluded.request_id,price_id=excluded.price_id,expires_at=excluded.expires_at
 returning * into reservation;
 return jsonb_build_object('blocked',false,'request_id',reservation.request_id,'expires_at',reservation.expires_at);
end $$;
revoke all on function public.reserve_creator_checkout(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_creator_checkout(uuid,text,text) to service_role;

-- Persist the provider ID without allowing a competing attempt to replace it.
create or replace function public.bind_creator_checkout(p_owner uuid,p_request text,p_session text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_session is null or p_session !~ '^cs_[A-Za-z0-9_]+$' then raise exception 'invalid session'; end if;
 update public.creator_checkout_reservations set checkout_session_id=p_session
 where owner_user_id=p_owner and request_id=p_request and (checkout_session_id is null or checkout_session_id=p_session);
 return found;
end $$;
revoke all on function public.bind_creator_checkout(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bind_creator_checkout(uuid,text,text) to service_role;
-- Worker must verify this exact Stripe session is expired before calling.
create or replace function public.release_expired_creator_checkout(p_owner uuid,p_session text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 delete from public.creator_checkout_reservations where owner_user_id=p_owner and checkout_session_id=p_session and expires_at<=now();
 return found;
end $$;
revoke all on function public.release_expired_creator_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.release_expired_creator_checkout(uuid,text) to service_role;
