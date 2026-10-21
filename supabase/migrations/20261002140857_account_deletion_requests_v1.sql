-- Account deletion, started in the app. Apple (guideline 5.1.1(v)) and Google
-- Play both require that a member can begin deleting their account from inside
-- the app, not only by email. A request is recorded here with a due date 30
-- days out (the window privacy.html promises, and room to change your mind);
-- the desk sees the queue and completes each deletion. The member can cancel
-- while it is pending. Members cannot read or write this table directly.
--
-- Rehearsed in production inside a rolled-back transaction before applying:
-- request, idempotent re-request, cancel, re-request; anon and other members
-- blocked; only the desk reads the queue.
create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  m_uid uuid,
  status text not null default 'pending' check (status in ('pending', 'cancelled', 'completed')),
  reason text check (reason is null or char_length(reason) <= 2000),
  requested_at timestamptz not null default now(),
  due_by timestamptz not null default now() + interval '30 days',
  cancelled_at timestamptz,
  completed_at timestamptz
);
alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant all on table public.account_deletion_requests to service_role;

create or replace function public.request_account_deletion(p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.account_deletion_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  insert into public.account_deletion_requests(user_id, m_uid, status, reason, requested_at, due_by)
  values (auth.uid(), public.current_m_uid(), 'pending', nullif(left(btrim(coalesce(p_reason, '')), 2000), ''), now(), now() + interval '30 days')
  on conflict (user_id) do update set
    status = 'pending',
    reason = coalesce(excluded.reason, public.account_deletion_requests.reason),
    requested_at = case when public.account_deletion_requests.status = 'pending' then public.account_deletion_requests.requested_at else now() end,
    due_by = case when public.account_deletion_requests.status = 'pending' then public.account_deletion_requests.due_by else now() + interval '30 days' end,
    cancelled_at = null
  where public.account_deletion_requests.status <> 'completed'
  returning * into v_row;
  return jsonb_build_object('status', v_row.status, 'requested_at', v_row.requested_at, 'due_by', v_row.due_by);
end; $$;
revoke all on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;

create or replace function public.cancel_account_deletion()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  update public.account_deletion_requests set status = 'cancelled', cancelled_at = now()
   where user_id = auth.uid() and status = 'pending';
  return jsonb_build_object('status', 'cancelled');
end; $$;
revoke all on function public.cancel_account_deletion() from public, anon;
grant execute on function public.cancel_account_deletion() to authenticated;

create or replace function public.my_account_deletion()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('status', status, 'requested_at', requested_at, 'due_by', due_by)
                   from public.account_deletion_requests where user_id = auth.uid()), '{}'::jsonb);
$$;
revoke all on function public.my_account_deletion() from public, anon;
grant execute on function public.my_account_deletion() to authenticated;

-- The desk's queue, soonest due first.
create or replace function public.desk_account_deletions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'email', u.email, 'status', r.status,
      'requested_at', r.requested_at, 'due_by', r.due_by, 'reason', r.reason) order by r.due_by)
    from public.account_deletion_requests r left join auth.users u on u.id = r.user_id
    where r.status = 'pending'), '[]'::jsonb);
end; $$;
revoke all on function public.desk_account_deletions() from public, anon;
grant execute on function public.desk_account_deletions() to authenticated;
