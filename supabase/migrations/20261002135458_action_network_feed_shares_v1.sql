-- A verified action can become a post on the Action feed, but only when the
-- member chose that. The post is written by the server, and the link from post
-- to verified action lives in a table members cannot write. That is what makes
-- the "verified" card trustworthy: post metadata is member-writable, so the
-- card is only drawn for posts action_feed_shares vouches for.
--
-- Rehearsed in production inside a rolled-back transaction before applying:
-- opt-in shares on verify, opt-out does not, forged metadata gets no card, and
-- another member cannot set, share, or write either table.
create table if not exists public.action_feed_shares (
  assignment_id uuid primary key references public.action_mission_assignments(id) on delete cascade,
  post_id uuid not null unique references public.network_posts(id) on delete cascade,
  m_uid uuid not null,
  created_at timestamptz not null default now()
);
alter table public.action_feed_shares enable row level security;
revoke all on table public.action_feed_shares from public, anon, authenticated;
grant all on table public.action_feed_shares to service_role;

-- Writes the post. Not callable by anyone directly; only the trigger and
-- share_verified_action below reach it.
create or replace function public.action_share_assignment_internal(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.action_mission_assignments%rowtype;
  v_title text;
  v_m_uid uuid;
  v_app uuid;
  v_post uuid;
begin
  select post_id into v_post from public.action_feed_shares where assignment_id = p_assignment_id;
  if v_post is not null then return v_post; end if;
  select * into v_a from public.action_mission_assignments where id = p_assignment_id;
  if not found or v_a.status <> 'verified' then raise exception 'only a verified action can be shared'; end if;
  select title into v_title from public.action_missions where id = v_a.mission_id;
  v_m_uid := coalesce(v_a.m_uid, (select m_uid from public.m_auth_user_links where auth_user_id = v_a.user_id order by is_primary desc limit 1));
  if v_m_uid is null then raise exception 'your Action identity is not ready yet'; end if;
  select id into v_app from public.platform_apps where app_key = 'mccluster-web' and enabled = true limit 1;
  insert into public.network_posts(author_m_uid, body, post_type, visibility, metadata, source_app_id)
  values (v_m_uid, 'I did something about it: ' || coalesce(v_title, 'a mission') || '.', 'share', 'public',
          jsonb_build_object('action', jsonb_build_object('assignment_id', v_a.id, 'mission_id', v_a.mission_id)), v_app)
  returning id into v_post;
  insert into public.action_feed_shares(assignment_id, post_id, m_uid) values (v_a.id, v_post, v_m_uid);
  return v_post;
end;
$$;
revoke all on function public.action_share_assignment_internal(uuid) from public, anon, authenticated;

-- The member shares one of their own verified actions after the fact.
create or replace function public.share_verified_action(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
  v_post uuid;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select user_id, status into v_owner, v_status from public.action_mission_assignments where id = p_assignment_id;
  if v_owner is null or v_owner <> auth.uid() then raise exception 'not your action'; end if;
  if v_status <> 'verified' then raise exception 'only a verified action can be shared'; end if;
  v_post := public.action_share_assignment_internal(p_assignment_id);
  return jsonb_build_object('post_id', v_post, 'assignment_id', p_assignment_id);
end;
$$;
revoke all on function public.share_verified_action(uuid) from public, anon;
grant execute on function public.share_verified_action(uuid) to authenticated;

-- Which of my verified actions are already on the feed.
create or replace function public.my_action_shares()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', s.assignment_id, 'post_id', s.post_id)), '[]'::jsonb)
  from public.action_feed_shares s
  join public.action_mission_assignments a on a.id = s.assignment_id
  where a.user_id = auth.uid();
$$;
revoke all on function public.my_action_shares() from public, anon;
grant execute on function public.my_action_shares() to authenticated;

-- The member's choice, made when they submit proof: "put this on the feed
-- once it's verified". Proof metadata is not kept by submit_action_proof, so
-- the choice has its own row. Only the member can set it, for their own
-- assignment, and only before it is verified (after that, share directly).
create table if not exists public.action_share_intents (
  assignment_id uuid primary key references public.action_mission_assignments(id) on delete cascade,
  user_id uuid not null,
  share boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.action_share_intents enable row level security;
revoke all on table public.action_share_intents from public, anon, authenticated;
grant all on table public.action_share_intents to service_role;

create or replace function public.set_action_share_intent(p_assignment_id uuid, p_share boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select user_id, status into v_owner, v_status from public.action_mission_assignments where id = p_assignment_id;
  if v_owner is null or v_owner <> auth.uid() then raise exception 'not your action'; end if;
  if v_status = 'verified' then
    if p_share then return public.share_verified_action(p_assignment_id); end if;
    return jsonb_build_object('assignment_id', p_assignment_id, 'share', false);
  end if;
  insert into public.action_share_intents(assignment_id, user_id, share, updated_at)
  values (p_assignment_id, v_owner, coalesce(p_share, false), now())
  on conflict (assignment_id) do update set share = excluded.share, updated_at = now();
  return jsonb_build_object('assignment_id', p_assignment_id, 'share', coalesce(p_share, false));
end;
$$;
revoke all on function public.set_action_share_intent(uuid, boolean) from public, anon;
grant execute on function public.set_action_share_intent(uuid, boolean) to authenticated;

-- When the desk verifies an action the member asked to share, post it.
-- A failure to post never undoes the verification.
create or replace function public.action_share_on_verify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'verified' and old.status is distinct from 'verified'
     and exists (select 1 from public.action_share_intents i
                 where i.assignment_id = new.id and i.user_id = new.user_id and i.share) then
    begin
      perform public.action_share_assignment_internal(new.id);
    exception when others then
      raise warning 'action feed share skipped for %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function public.action_share_on_verify() from public, anon, authenticated;
create or replace trigger action_share_on_verify_trg
  after update of status on public.action_mission_assignments
  for each row execute function public.action_share_on_verify();

-- The feed asks which of its posts are vouched-for verified actions. Only a
-- post whose author is the person who did the action gets a card.
create or replace function public.action_feed_cards(p_post_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'post_id', s.post_id, 'assignment_id', s.assignment_id, 'mission_id', m.id,
    'title', m.title, 'domain', m.domain, 'verified_at', a.verified_at,
    'mission_open', m.status = 'open')), '[]'::jsonb)
  from public.action_feed_shares s
  join public.network_posts p on p.id = s.post_id and p.author_m_uid = s.m_uid
  join public.action_mission_assignments a on a.id = s.assignment_id and a.status = 'verified'
  join public.action_missions m on m.id = a.mission_id
  where s.post_id = any(p_post_ids[1:100])
    and p.deleted_at is null and p.removed_at is null;
$$;
revoke all on function public.action_feed_cards(uuid[]) from public;
grant execute on function public.action_feed_cards(uuid[]) to anon, authenticated;
