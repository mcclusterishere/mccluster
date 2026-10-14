-- Anti-Social — Get Social, completed: connect in the platform, publish together,
-- progress on the record, a collaboration award, and the mission opened.
--
-- Owner, 2026-10-14: "Three levels, one Anti-Social mission … Level 3: find
-- another Action Network member, connect through the platform, and create
-- something together … a jointly credited project linked to both profiles …
-- Connect → Collaborate → Publish. Both creators are credited. The finished
-- project counts toward the same mission."
--
-- Builds on 20261014185154_antisocial_get_social_three_levels_draft.sql, which
-- seeded the mission as draft with a level table and RPCs whose level 3
-- requires an accepted network_connections row — a table nothing could write
-- (docs/action-network/ANTI-SOCIAL-GET-SOCIAL-AUDIT.md). Pending until
-- production applies it (supabase/pending/README.md). Every statement is
-- idempotent.

-- ---------------------------------------------------------------------------
-- A. CONNECT THROUGH THE PLATFORM.
-- network_connections (requester, addressee, pending|accepted|declined, one
-- row per pair) existed with a read policy and no writer. These are the
-- writers: a member asks, the other answers, either withdraws. A request to
-- someone who blocked you, or whom you blocked, reads as "member not found".
-- Asking someone who already asked you is accepting. A declined pair can be
-- asked again, by either side. The other member is told through the bell.
-- ---------------------------------------------------------------------------
create or replace function public.connection_notify(p_recipient uuid, p_actor uuid, p_type text, p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_handle text;
begin
  select coalesce(nullif(btrim(np.display_name), ''), 'A member') into v_name
    from public.network_profiles np where np.m_uid = p_actor;
  select p.mccluster_id into v_handle
    from public.platform_profiles p
    join public.m_auth_user_links l on l.auth_user_id = p.user_id
   where l.m_uid = p_actor
   order by l.is_primary desc limit 1;
  insert into public.network_notifications(recipient_m_uid, actor_m_uid, type, object_type, object_id, body, metadata)
  values (p_recipient, p_actor, p_type, 'network_connection', p_connection_id::text,
          case p_type
            when 'connection_request' then coalesce(v_name, 'A member') || ' wants to connect'
            else coalesce(v_name, 'A member') || ' accepted your connection'
          end,
          jsonb_strip_nulls(jsonb_build_object('connection_id', p_connection_id, 'actor_m_uid', p_actor, 'handle', v_handle)));
end;
$$;
revoke all on function public.connection_notify(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.connection_notify(uuid, uuid, text, uuid) to service_role;

create or replace function public.request_connection(p_target_m_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_m_uid();
  v_row public.network_connections%rowtype;
  v_open integer;
begin
  if (select auth.uid()) is null or v_me is null then raise exception 'sign in first'; end if;
  if p_target_m_uid is null or p_target_m_uid = v_me then raise exception 'choose another member'; end if;
  if not exists (select 1 from public.network_profiles np where np.m_uid = p_target_m_uid)
     or public.mnet_is_blocked_pair(v_me, p_target_m_uid) then
    raise exception 'member not found';
  end if;

  select * into v_row from public.network_connections c
   where least(c.requester_m_uid, c.addressee_m_uid) = least(v_me, p_target_m_uid)
     and greatest(c.requester_m_uid, c.addressee_m_uid) = greatest(v_me, p_target_m_uid)
   for update;

  if found then
    if v_row.status = 'accepted' then
      return jsonb_build_object('id', v_row.id, 'status', 'accepted', 'direction', 'both');
    elsif v_row.status = 'pending' and v_row.requester_m_uid = v_me then
      return jsonb_build_object('id', v_row.id, 'status', 'pending', 'direction', 'sent');
    elsif v_row.status = 'pending' then
      /* they asked first: asking back is accepting */
      update public.network_connections set status = 'accepted', updated_at = now() where id = v_row.id;
      perform public.connection_notify(v_row.requester_m_uid, v_me, 'connection_accepted', v_row.id);
      return jsonb_build_object('id', v_row.id, 'status', 'accepted', 'direction', 'both');
    end if;
    /* declined earlier: either side may ask again */
    update public.network_connections
       set requester_m_uid = v_me, addressee_m_uid = p_target_m_uid, status = 'pending', updated_at = now()
     where id = v_row.id;
    perform public.connection_notify(p_target_m_uid, v_me, 'connection_request', v_row.id);
    return jsonb_build_object('id', v_row.id, 'status', 'pending', 'direction', 'sent');
  end if;

  /* a member keeps at most thirty unanswered requests out at once */
  select count(*) into v_open from public.network_connections c where c.requester_m_uid = v_me and c.status = 'pending';
  if v_open >= 30 then raise exception 'you have thirty requests waiting; let some be answered first'; end if;

  insert into public.network_connections(requester_m_uid, addressee_m_uid, status)
  values (v_me, p_target_m_uid, 'pending')
  returning * into v_row;
  perform public.connection_notify(p_target_m_uid, v_me, 'connection_request', v_row.id);
  return jsonb_build_object('id', v_row.id, 'status', 'pending', 'direction', 'sent');
end;
$$;
revoke all on function public.request_connection(uuid) from public, anon;
grant execute on function public.request_connection(uuid) to authenticated, service_role;

create or replace function public.answer_connection(p_connection_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_m_uid();
  v_row public.network_connections%rowtype;
begin
  if (select auth.uid()) is null or v_me is null then raise exception 'sign in first'; end if;
  select * into v_row from public.network_connections where id = p_connection_id for update;
  if not found or v_row.addressee_m_uid <> v_me then raise exception 'request not found'; end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'direction', case when v_row.status = 'accepted' then 'both' else 'received' end);
  end if;
  update public.network_connections
     set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end, updated_at = now()
   where id = v_row.id
   returning * into v_row;
  if v_row.status = 'accepted' then
    perform public.connection_notify(v_row.requester_m_uid, v_me, 'connection_accepted', v_row.id);
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'direction', case when v_row.status = 'accepted' then 'both' else 'received' end);
end;
$$;
revoke all on function public.answer_connection(uuid, boolean) from public, anon;
grant execute on function public.answer_connection(uuid, boolean) to authenticated, service_role;

create or replace function public.withdraw_connection(p_connection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_m_uid();
  v_row public.network_connections%rowtype;
begin
  if (select auth.uid()) is null or v_me is null then raise exception 'sign in first'; end if;
  select * into v_row from public.network_connections where id = p_connection_id for update;
  if not found or (v_row.requester_m_uid <> v_me and v_row.addressee_m_uid <> v_me) then raise exception 'request not found'; end if;
  /* a pending request is withdrawn by its sender; an accepted connection is ended by either side */
  if v_row.status = 'pending' and v_row.requester_m_uid <> v_me then raise exception 'answer it instead'; end if;
  delete from public.network_connections where id = v_row.id;
  delete from public.network_notifications n
   where n.object_type = 'network_connection' and n.object_id = v_row.id::text and n.read_at is null;
  return jsonb_build_object('id', v_row.id, 'status', 'none');
end;
$$;
revoke all on function public.withdraw_connection(uuid) from public, anon;
grant execute on function public.withdraw_connection(uuid) to authenticated, service_role;

/* the connection between me and one member, for a profile view */
create or replace function public.connection_with(p_target_m_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('id', c.id, 'status', c.status,
      'direction', case when c.status = 'accepted' then 'both' when c.requester_m_uid = public.current_m_uid() then 'sent' else 'received' end)
    from public.network_connections c
    where public.current_m_uid() is not null and p_target_m_uid is not null
      and least(c.requester_m_uid, c.addressee_m_uid) = least(public.current_m_uid(), p_target_m_uid)
      and greatest(c.requester_m_uid, c.addressee_m_uid) = greatest(public.current_m_uid(), p_target_m_uid)
      and c.status <> 'declined'
  ), jsonb_build_object('status', 'none'));
$$;
revoke all on function public.connection_with(uuid) from public, anon;
grant execute on function public.connection_with(uuid) to authenticated, service_role;

/* my accepted connections, with the names the partner picker needs */
create or replace function public.my_connections()
returns table(m_uid uuid, display_name text, mccluster_id text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select other.m_uid,
         coalesce(nullif(btrim(np.display_name), ''), 'Action Network member'),
         (select p.mccluster_id from public.platform_profiles p join public.m_auth_user_links l on l.auth_user_id = p.user_id
           where l.m_uid = other.m_uid order by l.is_primary desc limit 1),
         c.updated_at
  from public.network_connections c
  cross join lateral (select case when c.requester_m_uid = public.current_m_uid() then c.addressee_m_uid else c.requester_m_uid end as m_uid) other
  left join public.network_profiles np on np.m_uid = other.m_uid
  where public.current_m_uid() is not null
    and c.status = 'accepted'
    and public.current_m_uid() in (c.requester_m_uid, c.addressee_m_uid)
  order by c.updated_at desc;
$$;
revoke all on function public.my_connections() from public, anon;
grant execute on function public.my_connections() to authenticated, service_role;
