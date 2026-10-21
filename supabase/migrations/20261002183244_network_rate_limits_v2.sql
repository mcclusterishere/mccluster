-- ACTION NETWORK LIMITS, V2: AT LEAST AS STRICT AS X.
--
-- v1 capped posts per minute and hour but not per day, and left direct
-- messages, follows, likes and reports unlimited. X's published limits for
-- free accounts (help.x.com, "About X limits", 2026): 50 posts and 200
-- replies a day, 500 direct messages a day, 400 follows a day. These match
-- or beat them, and a brand-new account (its first 24 hours) gets a much
-- smaller allowance, because new accounts are where spam comes from.
--
-- Every limited action is written to network_rate_events and counted from
-- there, never from the action's own table: a follow is one row per pair
-- (follow, unfollow and follow again all hit the same row) and a deleted
-- post leaves no trace, so counting those tables could be gamed. Members
-- cannot read or write the ledger. The owner desk (the account the admin rule
-- names) is exempt from the pace limits, not from length or duplicates,
-- because Matthew's welcome messages go out to every new member.
--
-- Refusals: MN429 too fast or over a cap, MN413 too long, MN409 a duplicate.

create table if not exists public.network_rate_events (
  id bigint generated always as identity primary key,
  m_uid uuid not null,
  action text not null,
  at timestamptz not null default now()
);
create index if not exists network_rate_events_lookup_idx on public.network_rate_events (m_uid, action, at desc);
create index if not exists network_rate_events_at_idx on public.network_rate_events (at);
alter table public.network_rate_events enable row level security;
revoke all on table public.network_rate_events from public, anon, authenticated;
grant all on table public.network_rate_events to service_role;

-- The owner desk is the account whose sign-in is the admin email, the same
-- rule public.eu_role() uses, looked up from the member rather than a JWT
-- because the Worker writes with the service role.
create or replace function public.network_rate_exempt(p_m_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.m_auth_user_links l
    join auth.users u on u.id = l.auth_user_id
    where l.m_uid = p_m_uid and u.email = 'matthew@mccluster.org' and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.network_rate_exempt(uuid) from public, anon, authenticated;

create or replace function public.network_rate_take(p_m_uid uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new boolean;
  v_min integer; v_hour integer; v_day integer;
  v_cap_min integer; v_cap_hour integer; v_cap_day integer;
  v_noun text;
  n_min integer; n_hour integer; n_day integer;
begin
  if p_m_uid is null or public.network_rate_exempt(p_m_uid) then return; end if;
  v_new := coalesce((select created_at > now() - interval '24 hours' from public.m_people where id = p_m_uid), false);
  select case when v_new then l.new_min else l.per_min end,
         case when v_new then l.new_hour else l.per_hour end,
         case when v_new then l.new_day else l.per_day end,
         l.noun
    into v_cap_min, v_cap_hour, v_cap_day, v_noun
    from (values
      ('post',          6,  25,   50,  2,   5,  10, 'posts'),
      ('reply',        20, 100,  200,  5,  20,  50, 'replies'),
      ('message',      20, 100,  500,  5,  20,  50, 'messages'),
      ('conversation',  5,  20,   50,  1,   3,  10, 'new conversations'),
      ('follow',       20, 100,  400,  5,  20,  50, 'follows'),
      ('reaction',     60, 500, 1000, 20, 100, 200, 'likes'),
      ('report',        5,  10,   50,  2,   5,  10, 'reports')
    ) as l(action, per_min, per_hour, per_day, new_min, new_hour, new_day, noun)
   where l.action = p_action;
  if v_noun is null then raise exception 'unknown rate action %', p_action; end if;
  -- one count at a time per member and action, so parallel requests cannot
  -- all read the same count and all pass
  perform pg_advisory_xact_lock(hashtextextended('network_rate:' || p_m_uid::text || ':' || p_action, 0));
  select count(*) filter (where at > now() - interval '1 minute'),
         count(*) filter (where at > now() - interval '1 hour'),
         count(*)
    into n_min, n_hour, n_day
    from public.network_rate_events
   where m_uid = p_m_uid and action = p_action and at > now() - interval '24 hours';
  if n_day >= v_cap_day then
    raise exception 'That is the limit for today: % % a day%.', v_cap_day, v_noun,
      case when v_new then ' while your account is new' else '' end using errcode = 'MN429';
  elsif n_hour >= v_cap_hour then
    raise exception 'That is the limit for this hour: % % an hour. Try again later.', v_cap_hour, v_noun using errcode = 'MN429';
  elsif n_min >= v_cap_min then
    raise exception 'Slow down. Give it a minute.' using errcode = 'MN429';
  end if;
  insert into public.network_rate_events (m_uid, action) values (p_m_uid, p_action);
end;
$$;
revoke all on function public.network_rate_take(uuid, text) from public, anon, authenticated;

-- POSTS AND REPLIES: length, duplicates, pace.
create or replace function public.network_posts_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reply boolean := new.reply_to_id is not null;
  v_cap integer := case when new.reply_to_id is not null then 1000 else 2000 end;
  v_norm text := lower(regexp_replace(btrim(coalesce(new.body, '')), '\s+', ' ', 'g'));
begin
  if char_length(coalesce(new.body, '')) > v_cap then
    raise exception '% are limited to % characters.', case when v_reply then 'Replies' else 'Posts' end,
      to_char(v_cap, 'FM9,999') using errcode = 'MN413';
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  if v_norm <> '' and exists (
    select 1 from public.network_posts p
     where p.author_m_uid = new.author_m_uid and p.deleted_at is null
       and p.reply_to_id is not distinct from new.reply_to_id
       and p.created_at > now() - case when v_reply then interval '1 hour' else interval '24 hours' end
       and lower(regexp_replace(btrim(coalesce(p.body, '')), '\s+', ' ', 'g')) = v_norm) then
    raise exception 'You already posted that.' using errcode = 'MN409';
  end if;
  perform public.network_rate_take(new.author_m_uid, case when v_reply then 'reply' else 'post' end);
  return new;
end;
$$;
revoke all on function public.network_posts_limits() from public, anon, authenticated;
create or replace trigger network_posts_limits_trg
  before insert or update of body on public.network_posts
  for each row execute function public.network_posts_limits();

-- DIRECT MESSAGES: length, copy-paste blasts, pace.
create or replace function public.network_messages_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text := lower(regexp_replace(btrim(coalesce(new.body, '')), '\s+', ' ', 'g'));
begin
  if char_length(coalesce(new.body, '')) > 2000 then
    raise exception 'Messages are limited to 2,000 characters.' using errcode = 'MN413';
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  -- the same words pasted into more than five conversations in an hour is a blast
  if v_norm <> '' and not public.network_rate_exempt(new.sender_m_uid) and (
    select count(distinct m.conversation_id) from public.network_messages m
     where m.sender_m_uid = new.sender_m_uid and m.conversation_id <> new.conversation_id
       and m.created_at > now() - interval '1 hour'
       and lower(regexp_replace(btrim(coalesce(m.body, '')), '\s+', ' ', 'g')) = v_norm) >= 5 then
    raise exception 'That message has already gone to too many people.' using errcode = 'MN409';
  end if;
  perform public.network_rate_take(new.sender_m_uid, 'message');
  return new;
end;
$$;
revoke all on function public.network_messages_limits() from public, anon, authenticated;
create or replace trigger network_messages_limits_trg
  before insert or update of body on public.network_messages
  for each row execute function public.network_messages_limits();

-- NEW CONVERSATIONS, LIKES, REPORTS: pace.
create or replace function public.network_conversations_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.network_rate_take(new.created_by_m_uid, 'conversation');
  return new;
end;
$$;
revoke all on function public.network_conversations_limits() from public, anon, authenticated;
create or replace trigger network_conversations_limits_trg
  before insert on public.network_conversations
  for each row execute function public.network_conversations_limits();

create or replace function public.network_reactions_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.network_rate_take(new.actor_m_uid, 'reaction');
  return new;
end;
$$;
revoke all on function public.network_reactions_limits() from public, anon, authenticated;
create or replace trigger network_reactions_limits_trg
  before insert on public.network_reactions
  for each row execute function public.network_reactions_limits();

create or replace function public.network_reports_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.network_rate_take(new.reporter_m_uid, 'report');
  return new;
end;
$$;
revoke all on function public.network_reports_limits() from public, anon, authenticated;
create or replace trigger network_reports_limits_trg
  before insert on public.network_reports
  for each row execute function public.network_reports_limits();

-- FOLLOWS: every follow counts. Unfollow deletes the row, so follow,
-- unfollow, follow again is a fresh insert each time, and the ledger (not
-- this table) remembers all of them. The Worker follows with an upsert, which
-- fires this trigger for the insert and again for the update; the update
-- branch skips an event already taken in the same transaction, so one follow
-- is counted once.
create or replace function public.network_follows_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'following' then return new; end if;
  if tg_op = 'INSERT' then
    perform public.network_rate_take(new.follower_m_uid, 'follow');
  elsif old.status is distinct from 'following' and not exists (
    select 1 from public.network_rate_events e
     where e.m_uid = new.follower_m_uid and e.action = 'follow' and e.at = now()) then
    perform public.network_rate_take(new.follower_m_uid, 'follow');
  end if;
  return new;
end;
$$;
revoke all on function public.network_follows_limits() from public, anon, authenticated;
create or replace trigger network_follows_limits_trg
  before insert or update of status on public.network_follows
  for each row execute function public.network_follows_limits();
