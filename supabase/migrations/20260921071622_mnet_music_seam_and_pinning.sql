-- MNET MEETS THE MUSIC, AND THE PIN STARTS WORKING.
--
-- TWO HALVES THAT SHARE AN ID COLUMN AND NOTHING ELSE. The music side has a
-- catalogue, a listening room, a recommender (v_track_signals: Wilson keep
-- rate, momentum, item-to-item CF). The social side has profiles, posts,
-- follows, a feed. They key on the same m_uid and that is the entire
-- connection: network_posts has no way to name a track, playing a record
-- produces no social signal, and a follow changes nothing about what you
-- hear. The people signing up here arrived because of a song. The room they
-- land in has no songs in it, which is why the whole thing reads as a
-- fragment rather than a product.
--
-- This is the seam. A post can carry a track, and the feed hands that track
-- to the client so it can be played where it is read.
--
-- NO NEW COLUMN. network_posts.metadata is jsonb and already travels with
-- every post; the track rides in metadata->'track'. A dedicated column would
-- mean a second shape to keep in step with the catalogue, which is a file
-- (data/albums.json), not a table — so the post stores what it was told and
-- the client resolves the rest.
--
-- WRITTEN AGAINST THE LIVE DEFINITIONS, not the ones in git. Both functions
-- below exist in production in a form this repository never recorded, and
-- re-creating them from the repo's copies would have silently reverted
-- blocks, mutes and org visibility. They were read out of pg_get_functiondef
-- first and extended in place.

-- ---------------------------------------------------------------
-- 1. THE FAN-OUT CARRIES THE TRACK
-- ---------------------------------------------------------------
create or replace function public.mnet_feed_item_from_post()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.network_feed_items(actor_m_uid,source_app_id,source_org_id,item_type,post_id,visibility,occurred_at,payload)
  values(
    new.author_m_uid,new.source_app_id,new.source_org_id,'post',new.id,new.visibility,new.created_at,
    -- the track travels with the item so the feed needs no second round trip
    jsonb_strip_nulls(jsonb_build_object(
      'post_type', new.post_type,
      'track',     new.metadata->'track'
    ))
  )
  on conflict (post_id) do update set
    source_app_id=excluded.source_app_id,
    source_org_id=excluded.source_org_id,
    visibility=excluded.visibility,
    occurred_at=excluded.occurred_at,
    payload=excluded.payload;
  return new;
end;
$function$;

-- Posts that already exist get their payload rebuilt, so a track attached
-- before this migration is not invisible forever.
update public.network_posts set updated_at = updated_at where true;

-- ---------------------------------------------------------------
-- 2. THE FEED HONOURS A PIN, AND HIDES WHAT WAS REMOVED
-- ---------------------------------------------------------------
-- 20260921050000 added pinned_at, an RPC to set it and a Worker route to
-- call it. It never taught the feed to read it, so pinning a post did
-- nothing anybody could see. Same for removed_at: the removal deletes the
-- feed item, but a row that survives by any other path should still not be
-- served.
create or replace function public.mnet_surface_feed(p_app_key text, p_limit integer default 50, p_before timestamptz default null)
returns table(id uuid, item_type text, actor_m_uid uuid, source_app_id uuid, source_org_id uuid,
              visibility text, occurred_at timestamptz, payload jsonb, post_id uuid, activity_id uuid)
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  with ctx as (
    select pa.id app_id, pa.product_family, c.default_feed_scope
    from public.platform_apps pa
    join public.mnet_surface_config c on c.app_id=pa.id
    where pa.app_key=p_app_key and pa.enabled=true and c.network_enabled=true limit 1
  ), me as (select public.current_m_uid() m_uid)
  select f.id,f.item_type,f.actor_m_uid,f.source_app_id,f.source_org_id,f.visibility,f.occurred_at,
         -- the pin is a property of the item as the reader sees it
         case when p.pinned_at is not null
              then coalesce(f.payload,'{}'::jsonb) || jsonb_build_object('pinned', true)
              else f.payload end,
         f.post_id,f.activity_id
  from public.network_feed_items f
  cross join ctx
  cross join me
  left join public.platform_apps source_app on source_app.id=f.source_app_id
  left join public.network_posts p on p.id = f.post_id
  where (p_before is null or f.occurred_at < p_before)
    and (p.id is null or (p.removed_at is null and p.deleted_at is null))
    and not public.mnet_is_blocked_pair(me.m_uid,f.actor_m_uid)
    and not exists(
      select 1 from public.network_mutes nm
      where nm.muter_m_uid=me.m_uid and nm.muted_m_uid=f.actor_m_uid
        and (nm.expires_at is null or nm.expires_at>now())
    )
    and (
      f.visibility='public'
      or f.actor_m_uid=me.m_uid
      or (f.visibility in ('network','followers') and exists(
        select 1 from public.network_follows nf
        where nf.follower_m_uid=me.m_uid and nf.followed_m_uid=f.actor_m_uid and nf.status='following'
      ))
      or (f.visibility='org' and f.source_org_id is not null and exists(
        select 1 from public.org_members om where om.org_id=f.source_org_id and om.profile_id=auth.uid()
      ))
    )
    and (
      ctx.default_feed_scope='global'
      or (ctx.default_feed_scope='app' and f.source_app_id=ctx.app_id)
      or (ctx.default_feed_scope='family' and source_app.product_family=ctx.product_family)
      or f.source_app_id is null
    )
  -- A PIN FLOATS; EVERYTHING ELSE IS RECENCY. Deliberately not a ranked
  -- feed: at this size ranking only hides posts, and with one dominant
  -- author there is nothing to amplify. Reverse-chronological is the
  -- correct answer until there is more here than a person can read.
  order by (p.pinned_at is not null) desc, coalesce(p.pinned_at, f.occurred_at) desc
  limit greatest(1,least(coalesce(p_limit,50),100));
$function$;

grant execute on function public.mnet_surface_feed(text,integer,timestamptz) to authenticated, service_role;
