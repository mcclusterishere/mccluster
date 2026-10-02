-- SPAM LIMITS ON THE ACTION NETWORK.
--
-- Found by attacking the live network as an ordinary member (2026-10-02):
-- 25 posts in a few seconds were all accepted, and a post written straight to
-- the table (members may write their own rows) had no length limit at all.
-- The limits live here, on the table, so they hold for the Worker, the
-- scheduled publisher and direct writes alike.
--
--   length   5,000 characters for any post or reply (the longest real post
--            so far is 100)
--   posts    6 a minute and 60 an hour per member
--   replies  20 a minute and 300 an hour (live chat is replies)
--
-- Errors carry their own SQLSTATE so the Worker can answer 413 or 429 with a
-- plain sentence instead of a generic failure.
create or replace function public.network_posts_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minute integer;
  v_hour integer;
  v_reply boolean := new.reply_to_id is not null;
  v_per_minute integer;
  v_per_hour integer;
  v_message text;
begin
  if char_length(coalesce(new.body, '')) > 5000 then
    raise exception 'Posts are limited to 5,000 characters.' using errcode = 'MN413';
  end if;
  if tg_op = 'UPDATE' then
    return new;
  end if;
  -- one count at a time per member, so a burst of parallel posts cannot
  -- all read the same count and all pass
  perform pg_advisory_xact_lock(hashtextextended('network_posts_rate:' || new.author_m_uid::text, 0));
  select count(*) filter (where created_at > now() - interval '1 minute'),
         count(*)
    into v_minute, v_hour
    from public.network_posts
   where author_m_uid = new.author_m_uid
     and created_at > now() - interval '1 hour'
     and (reply_to_id is not null) = v_reply;
  if v_reply then
    v_per_minute := 20; v_per_hour := 300; v_message := 'You are replying too fast. Give it a minute.';
  else
    v_per_minute := 6; v_per_hour := 60; v_message := 'You are posting too fast. Give it a minute.';
  end if;
  if v_minute >= v_per_minute or v_hour >= v_per_hour then
    raise exception '%', v_message using errcode = 'MN429';
  end if;
  return new;
end;
$$;
revoke all on function public.network_posts_limits() from public, anon, authenticated;

create or replace trigger network_posts_limits_trg
  before insert or update of body on public.network_posts
  for each row execute function public.network_posts_limits();
