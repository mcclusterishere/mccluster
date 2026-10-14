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

-- ---------------------------------------------------------------------------
-- B. PUBLISH TOGETHER, IN THE PLATFORM.
-- Level 3 used to ask the member to paste the id of a post one of them had
-- made somewhere. Now the platform publishes the project: one public post
-- credited to both, written by the server and vouched in a table members
-- cannot write (the reason action_feed_shares exists: post metadata is
-- member-writable, so a card is drawn only for a post the server vouches
-- for). Publishing is the initiator's level-3 submission, through the
-- draft's own rule; the partner confirms the same work as theirs with one
-- tap (submit_antisocial_level with the same post), and one desk
-- verification settles both (D below).
-- ---------------------------------------------------------------------------
create table if not exists public.action_collaboration_posts (
  post_id uuid primary key references public.network_posts(id) on delete cascade,
  mission_id uuid not null references public.action_missions(id) on delete cascade,
  initiator_m_uid uuid not null references public.m_people(id) on delete cascade,
  partner_m_uid uuid not null references public.m_people(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (kind in ('song','video','photo','writing','other')),
  link text check (link is null or (link ~* '^https://' and char_length(link) <= 2000)),
  media_asset_id uuid references public.network_media_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  check (initiator_m_uid <> partner_m_uid)
);
create index if not exists action_collaboration_posts_partner_idx on public.action_collaboration_posts(partner_m_uid, created_at desc);
alter table public.action_collaboration_posts enable row level security;
revoke all on public.action_collaboration_posts from public, anon, authenticated;
grant all on public.action_collaboration_posts to service_role;

create or replace function public.antisocial_handle_of(p_m_uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.mccluster_id from public.platform_profiles p
  join public.m_auth_user_links l on l.auth_user_id = p.user_id
  where l.m_uid = p_m_uid order by l.is_primary desc limit 1;
$$;
revoke all on function public.antisocial_handle_of(uuid) from public, anon, authenticated;
grant execute on function public.antisocial_handle_of(uuid) to service_role;

create or replace function public.publish_antisocial_collaboration(
  p_assignment_id uuid, p_partner_m_uid uuid, p_title text, p_kind text,
  p_link text default null, p_media_asset_id uuid default null, p_statement text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_me uuid := public.current_m_uid();
  v_mission uuid := 'a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid;
  v_a public.action_mission_assignments%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_statement text := btrim(coalesce(p_statement, ''));
  v_asset public.network_media_assets%rowtype;
  v_me_name text; v_partner_name text;
  v_app uuid; v_post uuid; v_media jsonb := '[]'::jsonb;
begin
  if v_user is null or v_me is null then raise exception 'sign in first'; end if;
  if p_partner_m_uid is null or p_partner_m_uid = v_me then raise exception 'choose another Action Network member'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 120 then raise exception 'give the project a title (up to 120 characters)'; end if;
  if p_kind not in ('song','video','photo','writing','other') then raise exception 'say what kind of work it is'; end if;
  if v_link is not null and (v_link !~* '^https://' or char_length(v_link) > 2000) then raise exception 'the link must be https'; end if;
  if char_length(v_statement) > 1500 then raise exception 'keep the note under 1,500 characters'; end if;

  select * into v_a from public.action_mission_assignments
   where id = p_assignment_id and user_id = v_user and mission_id = v_mission for update;
  if not found or v_a.status not in ('joined','in_progress','rejected') then raise exception 'start the Anti-Social mission first'; end if;
  if not exists (select 1 from public.action_antisocial_levels l where l.assignment_id = v_a.id and l.level = 1 and l.status = 'verified')
     or not exists (select 1 from public.action_antisocial_levels l where l.assignment_id = v_a.id and l.level = 2 and l.status = 'verified') then
    raise exception 'finish levels 1 and 2 first';
  end if;
  if exists (select 1 from public.action_antisocial_levels l where l.assignment_id = v_a.id and l.level = 3 and l.status = 'verified') then
    raise exception 'level already verified';
  end if;
  if not exists (
    select 1 from public.network_connections c
    where c.status = 'accepted'
      and ((c.requester_m_uid = v_me and c.addressee_m_uid = p_partner_m_uid) or (c.requester_m_uid = p_partner_m_uid and c.addressee_m_uid = v_me))
  ) then raise exception 'connect with your collaborator on Action Network first'; end if;

  if p_media_asset_id is not null then
    select * into v_asset from public.network_media_assets a
     where a.id = p_media_asset_id and a.owner_m_uid = v_me
       and a.media_type in ('video','image','audio') and a.status in ('ready','staged');
    if not found then raise exception 'that upload is not yours or is not ready'; end if;
    v_media := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'asset_id', v_asset.id, 'type', v_asset.media_type, 'mime_type', v_asset.mime_type,
      'width', v_asset.width, 'height', v_asset.height, 'duration_ms', v_asset.duration_ms, 'alt_text', coalesce(v_asset.alt_text, ''))));
  end if;
  if v_link is null and p_media_asset_id is null then raise exception 'add the work: a link to it or an upload'; end if;

  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_me_name from public.network_profiles where m_uid = v_me;
  select coalesce(nullif(btrim(display_name), ''), 'A member') into v_partner_name from public.network_profiles where m_uid = p_partner_m_uid;
  select id into v_app from public.platform_apps where app_key = 'mccluster-web' and enabled = true limit 1;

  insert into public.network_posts(author_m_uid, body, post_type, visibility, media, metadata, source_app_id)
  values (v_me,
          v_title || ' — made together by ' || coalesce(v_me_name, 'A member') || ' and ' || coalesce(v_partner_name, 'A member') || '.'
            || case when v_statement <> '' then E'\n\n' || v_statement else '' end,
          'post', 'public', v_media,
          jsonb_build_object('collaboration', jsonb_strip_nulls(jsonb_build_object(
            'mission_id', v_mission, 'title', v_title, 'kind', p_kind, 'link', v_link,
            'credits', jsonb_build_array(
              jsonb_strip_nulls(jsonb_build_object('m_uid', v_me, 'name', v_me_name, 'handle', public.antisocial_handle_of(v_me))),
              jsonb_strip_nulls(jsonb_build_object('m_uid', p_partner_m_uid, 'name', v_partner_name, 'handle', public.antisocial_handle_of(p_partner_m_uid))))))),
          v_app)
  returning id into v_post;
  if p_media_asset_id is not null then
    update public.network_media_assets set post_id = v_post, status = 'attached', updated_at = now()
     where id = p_media_asset_id and owner_m_uid = v_me;
  end if;
  insert into public.action_collaboration_posts(post_id, mission_id, initiator_m_uid, partner_m_uid, title, kind, link, media_asset_id)
  values (v_post, v_mission, v_me, p_partner_m_uid, v_title, p_kind, v_link, p_media_asset_id);

  /* the initiator's level 3, through the draft's own submission rule (a
     song upload is audio, which that rule does not take as a clip: the post
     itself is the proof then) */
  perform public.submit_antisocial_level(v_a.id, 3::smallint, v_statement, v_link, v_post, p_partner_m_uid,
    case when v_asset.media_type in ('video','image') then p_media_asset_id else null end);

  /* the partner is told; confirming the same work is their level 3 */
  insert into public.network_notifications(recipient_m_uid, actor_m_uid, type, object_type, object_id, body, metadata)
  values (p_partner_m_uid, v_me, 'collaboration_published', 'network_post', v_post::text,
          coalesce(v_me_name, 'A member') || ' published “' || v_title || '” with you — confirm it as your Level 3',
          jsonb_strip_nulls(jsonb_build_object('post_id', v_post, 'mission_id', v_mission, 'title', v_title,
            'handle', public.antisocial_handle_of(v_me), 'actor_m_uid', v_me)));
  return jsonb_build_object('post_id', v_post, 'level', 3, 'status', 'pending', 'assignment_id', v_a.id);
end;
$$;
revoke all on function public.publish_antisocial_collaboration(uuid, uuid, text, text, text, uuid, text) from public, anon;
grant execute on function public.publish_antisocial_collaboration(uuid, uuid, text, text, text, uuid, text) to authenticated, service_role;

/* projects published with me, and where my own level 3 stands on each */
create or replace function public.antisocial_collaborations_for_me()
returns table(post_id uuid, title text, kind text, link text, initiator_m_uid uuid, initiator_name text, initiator_handle text, created_at timestamptz, mine_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.post_id, cp.title, cp.kind, cp.link, cp.initiator_m_uid,
         coalesce(nullif(btrim(np.display_name), ''), 'Action Network member'),
         public.antisocial_handle_of(cp.initiator_m_uid),
         cp.created_at,
         (select l.status from public.action_antisocial_levels l
            join public.action_mission_assignments a on a.id = l.assignment_id
           where a.m_uid = public.current_m_uid() and l.level = 3 and l.post_id = cp.post_id limit 1)
  from public.action_collaboration_posts cp
  join public.network_posts p on p.id = cp.post_id and p.deleted_at is null and p.removed_at is null
  left join public.network_profiles np on np.m_uid = cp.initiator_m_uid
  where public.current_m_uid() is not null and cp.partner_m_uid = public.current_m_uid()
  order by cp.created_at desc;
$$;
revoke all on function public.antisocial_collaborations_for_me() from public, anon;
grant execute on function public.antisocial_collaborations_for_me() to authenticated, service_role;

/* the card under a joint post: drawn only for posts the server vouches for */
create or replace function public.action_collaboration_cards(p_post_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'post_id', cp.post_id, 'mission_id', cp.mission_id, 'title', cp.title, 'kind', cp.kind, 'link', cp.link,
    'credits', jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object('m_uid', cp.initiator_m_uid,
        'name', case when ip.visibility = 'public' then coalesce(nullif(btrim(ip.display_name), ''), 'Action Network member') else 'Action Network member' end,
        'handle', case when ip.visibility = 'public' then public.antisocial_handle_of(cp.initiator_m_uid) end)),
      jsonb_strip_nulls(jsonb_build_object('m_uid', cp.partner_m_uid,
        'name', case when pp.visibility = 'public' then coalesce(nullif(btrim(pp.display_name), ''), 'Action Network member') else 'Action Network member' end,
        'handle', case when pp.visibility = 'public' then public.antisocial_handle_of(cp.partner_m_uid) end))),
    'verified', (
      select count(*) = 2 from public.action_antisocial_levels l
      join public.action_mission_assignments a on a.id = l.assignment_id
      where l.level = 3 and l.post_id = cp.post_id and l.status = 'verified'
        and a.m_uid in (cp.initiator_m_uid, cp.partner_m_uid)),
    'mission_open', m.status = 'open'
  )), '[]'::jsonb)
  from public.action_collaboration_posts cp
  join public.network_posts p on p.id = cp.post_id and p.visibility = 'public' and p.deleted_at is null and p.removed_at is null
  join public.action_missions m on m.id = cp.mission_id
  left join public.network_profiles ip on ip.m_uid = cp.initiator_m_uid
  left join public.network_profiles pp on pp.m_uid = cp.partner_m_uid
  where cp.post_id = any(p_post_ids[1:100]);
$$;
revoke all on function public.action_collaboration_cards(uuid[]) from public;
grant execute on function public.action_collaboration_cards(uuid[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D. ONE VERIFICATION SETTLES BOTH, AND LEVEL 3 IS THE FLAGSHIP.
-- The draft's review of level 3 verified one member and left the partner's
-- reciprocal submission for a second review. Now verifying either settles
-- the pair: both level-3 rows, both assignments, the mission points for
-- each (150, once), and a collaboration award for each (100, the ledger
-- kind that was waiting for this). Everything else the draft checked stays.
-- ---------------------------------------------------------------------------
create or replace function public.antisocial_settle_level3(p_assignment_id uuid, p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.action_mission_assignments%rowtype;
begin
  update public.action_antisocial_levels
     set status = 'verified', reviewed_at = coalesce(reviewed_at, now()), updated_at = now()
   where assignment_id = p_assignment_id and level = 3 and post_id = p_post_id and status = 'pending';
  select * into v_a from public.action_mission_assignments where id = p_assignment_id for update;
  if not found then return; end if;
  if v_a.m_uid is null then raise exception 'assignment has no Action identity'; end if;
  insert into public.action_points_ledger(m_uid, assignment_id, kind, points, reason, factors)
  values (v_a.m_uid, v_a.id, 'mission', 150, 'Anti-Social: three verified levels', jsonb_build_object('levels', 3, 'collaboration_post_id', p_post_id))
  on conflict (assignment_id, kind) where assignment_id is not null and kind = 'mission' do nothing;
  if not exists (select 1 from public.action_points_ledger l where l.assignment_id = v_a.id and l.kind = 'collaboration') then
    insert into public.action_points_ledger(m_uid, assignment_id, kind, points, reason, factors)
    values (v_a.m_uid, v_a.id, 'collaboration', 100, 'Anti-Social: made something together', jsonb_build_object('post_id', p_post_id));
  end if;
  update public.action_mission_assignments set status = 'verified', verified_at = coalesce(verified_at, now()) where id = v_a.id;
end;
$$;
revoke all on function public.antisocial_settle_level3(uuid, uuid) from public, anon, authenticated;
grant execute on function public.antisocial_settle_level3(uuid, uuid) to service_role;

create or replace function public.review_antisocial_level(
  p_assignment_id uuid, p_level smallint, p_decision text, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.action_antisocial_levels%rowtype;
  v_a public.action_mission_assignments%rowtype;
  v_other uuid;
begin
  if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
  if p_decision not in ('verified','rejected') then raise exception 'invalid decision'; end if;
  select * into v_a from public.action_mission_assignments where id = p_assignment_id for update;
  if not found or v_a.mission_id <> 'a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid then raise exception 'not an Anti-Social assignment'; end if;
  select * into v_l from public.action_antisocial_levels where assignment_id = p_assignment_id and level = p_level for update;
  if not found then raise exception 'level submission missing'; end if;
  if v_l.status = 'verified' then return jsonb_build_object('status', 'verified', 'idempotent', true); end if;
  if v_l.user_id = (select auth.uid()) then raise exception 'cannot review own work'; end if;
  if p_level > 1 and not exists (
    select 1 from public.action_antisocial_levels where assignment_id = p_assignment_id and level = p_level - 1 and status = 'verified'
  ) then raise exception 'previous level not verified'; end if;
  if p_level = 3 and p_decision = 'verified' then
    /* both members must have submitted the same post with reciprocal credit */
    select other.assignment_id into v_other
      from public.action_antisocial_levels other
      join public.action_mission_assignments oa on oa.id = other.assignment_id
     where other.level = 3 and other.post_id = v_l.post_id
       and oa.m_uid = v_l.collaborator_m_uid
       and other.collaborator_m_uid = v_a.m_uid
       and other.status in ('pending','verified')
       and oa.id <> v_a.id
     limit 1;
    if v_other is null then raise exception 'collaborator must join, finish levels 1-2, and submit this same work'; end if;
  end if;
  update public.action_antisocial_levels
     set status = p_decision, review_note = left(coalesce(p_note, ''), 500), reviewed_at = now(), updated_at = now()
   where assignment_id = p_assignment_id and level = p_level;
  if p_level = 3 and p_decision = 'verified' then
    perform public.antisocial_settle_level3(v_a.id, v_l.post_id);
    perform public.antisocial_settle_level3(v_other, v_l.post_id);
  end if;
  return jsonb_build_object('level', p_level, 'status', p_decision, 'assignment_id', p_assignment_id,
    'partner_assignment_id', case when p_level = 3 and p_decision = 'verified' then v_other end);
end;
$$;
revoke all on function public.review_antisocial_level(uuid, smallint, text, text) from public, anon;
grant execute on function public.review_antisocial_level(uuid, smallint, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C. PROGRESS ON THE RECORD. The Action Record carries each mission's levels,
-- so a row can read 2 / 3 outside the dialog. Everything the record returned
-- before is returned unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.action_record()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid, public.current_m_uid() as m_uid)
  select case when (select uid from me) is null then null else jsonb_build_object(
    'verified_actions', (select count(*) from public.action_mission_assignments a, me where a.user_id = me.uid and a.status = 'verified'),
    'points', (select coalesce(sum(l.points), 0) from public.action_points_ledger l, me where l.m_uid = me.m_uid),
    'in_progress', (select count(*) from public.action_mission_assignments a, me where a.user_id = me.uid and a.status in ('joined','in_progress','submitted')),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', a.id, 'mission_id', m.id, 'title', m.title, 'domain', m.domain,
        'skills', m.skills, 'status', a.status, 'joined_at', a.joined_at, 'submitted_at', a.submitted_at,
        'verified_at', a.verified_at, 'points', (select l.points from public.action_points_ledger l where l.assignment_id = a.id and l.kind = 'mission'),
        'review_note', case when a.status in ('verified','rejected') then (select p.review_note from public.action_proofs p where p.assignment_id = a.id) end,
        'levels', coalesce((select jsonb_agg(jsonb_build_object('level', lv.level, 'status', lv.status, 'review_note', lv.review_note) order by lv.level)
                            from public.action_antisocial_levels lv where lv.assignment_id = a.id), '[]'::jsonb),
        'level_count', case when m.id = 'a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid then 3 end
      ) order by coalesce(a.verified_at, a.submitted_at, a.joined_at) desc)
      from public.action_mission_assignments a join public.action_missions m on m.id = a.mission_id, me
      where a.user_id = me.uid and a.status <> 'withdrawn'), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('skill', s.skill, 'xp', s.xp, 'verified_actions', s.verified_actions) order by s.xp desc)
      from public.action_skill_progress s, me where s.m_uid = me.m_uid), '[]'::jsonb),
    'cohorts', coalesce((
      select jsonb_agg(jsonb_build_object('cohort_id', c.id, 'name', c.name, 'status', c.status, 'goal_points', c.goal_points,
        'points', (select coalesce(sum(l.points), 0) from public.action_points_ledger l join public.action_cohort_members cm2 on cm2.m_uid = l.m_uid where cm2.cohort_id = c.id),
        'members', (select count(*) from public.action_cohort_members cm3 where cm3.cohort_id = c.id)))
      from public.action_cohort_members cm join public.action_cohorts c on c.id = cm.cohort_id, me
      where cm.m_uid = me.m_uid), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- F. OPEN. The draft was seeded as draft "until member UI, reviewer UI and
-- Worker are live and verified". With A–D in place and proven, applying this
-- file opens the mission.
-- ---------------------------------------------------------------------------
update public.action_missions set status = 'open', updated_at = now()
 where id = 'a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid and status = 'draft';
