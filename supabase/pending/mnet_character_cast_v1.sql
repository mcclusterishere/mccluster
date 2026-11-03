-- MNET character cast v1: story characters post publicly on MNET as themselves.
--
-- Owner, 2026-11-03: "Every story character gets a profile on MNET and posts
-- PUBLICLY, run by the OVH box." Profiles are a "character" profile type with
-- a small Character badge; minors get no profile.
--
-- PENDING. Not applied. Needs the owner's explicit OK (README "To promote one").
-- Additive only: one receipt table and two service-role functions. Nothing
-- existing is altered, replaced or dropped.
--
-- Reuses the existing platform-actor path (20261021011443_royce_platform_actor):
--   * a character is an ops_platform_actors row (actor_key 'chr.<character id>')
--     with its own m_people person and public network_profiles row, exactly like
--     Royce; persona.actor_kind = 'character' is the profile type the Worker
--     reads to show the badge (no new column, no new profile table);
--   * no auth.users row, email, password or login session is created;
--   * actors are provisioned DISABLED; enabling is a separate owner step.
-- Writes come only from McCluster Core (service role), job type character_post
-- (core/src/executors/character-post.mjs), into the existing network_posts
-- (top-level posts; the existing fan-out trigger feeds network_feed_items) and
-- network_post_comments (replies to another character's post).
--
-- Character content is defined in core/data/characters/cast.v1.json.
-- Rollback: mnet_character_cast_v1.rollback.sql.
begin;

create table if not exists public.ops_character_publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  actor_key text not null references public.ops_platform_actors(actor_key),
  character_id text not null check (character_id ~ '^[a-z0-9][a-z0-9-]{2,35}$'),
  job_id uuid not null references public.ops_agent_jobs(id),
  kind text not null check (kind in ('doing','news','reply')),
  post_id uuid references public.network_posts(id) on delete set null,
  comment_id uuid references public.network_post_comments(id) on delete set null,
  article_id uuid references public.media_news_articles(id) on delete set null,
  reply_to_post_id uuid references public.network_posts(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 12 and 600),
  model text not null check (char_length(model) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (job_id, actor_key),
  unique (actor_key, article_id),
  unique (actor_key, reply_to_post_id)
);
create index if not exists ops_character_publications_recent on public.ops_character_publications (created_at desc);
create index if not exists ops_character_publications_character on public.ops_character_publications (character_id, created_at desc);
alter table public.ops_character_publications enable row level security;
revoke all on public.ops_character_publications from public, anon, authenticated;
grant select, insert on public.ops_character_publications to service_role;

-- Create or refresh one character's MNET person, profile and (disabled) actor.
create or replace function public.ops_character_provision(
  p_org_id uuid, p_character_id text, p_display_name text, p_headline text, p_bio text, p_daily_limit integer, p_persona jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_key text := 'chr.' || p_character_id;
  v_persona jsonb;
  actor public.ops_platform_actors;
  person uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'server role required' using errcode = '42501'; end if;
  if not exists (select 1 from public.orgs where id = p_org_id and slug = 'mccluster' and enabled) then raise exception 'character outside Core authority' using errcode = '42501'; end if;
  if p_character_id is null or p_character_id !~ '^[a-z0-9][a-z0-9-]{2,35}$' then raise exception 'invalid character id'; end if;
  if char_length(btrim(coalesce(p_display_name,''))) not between 1 and 80
     or char_length(coalesce(p_headline,'')) > 160 or char_length(coalesce(p_bio,'')) > 600
     or p_daily_limit is null or p_daily_limit not between 1 and 3
     or p_persona is null or jsonb_typeof(p_persona) <> 'object' then
    raise exception 'invalid character profile';
  end if;
  v_persona := p_persona || jsonb_build_object('actor_kind','character','character_id',p_character_id);
  perform pg_advisory_xact_lock(hashtextextended('character-provision:' || v_key, 0));

  select * into actor from public.ops_platform_actors where actor_key = v_key;
  if found then
    if actor.persona->>'actor_kind' is distinct from 'character' or actor.persona->>'character_id' is distinct from p_character_id then
      raise exception 'actor key % belongs to another actor', v_key;
    end if;
    update public.network_profiles set display_name = p_display_name, headline = p_headline, bio = p_bio where m_uid = actor.m_uid;
    update public.ops_platform_actors set persona = v_persona, daily_limit = p_daily_limit where actor_key = v_key;
    return jsonb_build_object('provisioned', false, 'updated', true, 'actor_key', v_key, 'm_uid', actor.m_uid, 'enabled', actor.enabled);
  end if;

  if exists (select 1 from public.platform_profiles where lower(mccluster_id) = v_key)
     or exists (select 1 from public.music_creator_profiles where lower(handle) = v_key)
     or exists (select 1 from public.ops_platform_actors where lower(handle) = v_key) then
    raise exception 'handle % already occupied; inspect before provisioning', v_key;
  end if;
  insert into public.m_people default values returning id into person;
  insert into public.network_profiles (m_uid, display_name, headline, bio, visibility, categories, allow_messages_from)
  values (person, p_display_name, p_headline, p_bio, 'public', array['character'], 'none');
  insert into public.ops_platform_actors (actor_key, org_id, m_uid, handle, enabled, daily_limit, persona, authority)
  values (v_key, p_org_id, person, v_key, false, p_daily_limit, v_persona,
    'Owner 2026-11-03: a fictional story character posting publicly on MNET in its own voice, run by McCluster Core (character_post). Scope: its own posts, reactions to retained headlines, and replies on other characters'' public posts. No DMs, no spending, no member targeting, no platform administration.');
  return jsonb_build_object('provisioned', true, 'updated', false, 'actor_key', v_key, 'm_uid', person, 'enabled', false);
end $$;
revoke all on function public.ops_character_provision(uuid,text,text,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.ops_character_provision(uuid,text,text,text,text,integer,jsonb) to service_role;

-- Publish one validated post or reply as the character. Idempotent per (job, actor).
create or replace function public.ops_character_publish_post(
  p_org_id uuid, p_job_id uuid, p_actor_key text, p_kind text, p_body text, p_article_id uuid, p_reply_to_post_id uuid, p_model text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor public.ops_platform_actors;
  prior public.ops_character_publications;
  target public.network_posts;
  v_character text;
  v_post uuid;
  v_comment uuid;
  v_pub uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'server role required' using errcode = '42501'; end if;
  if not exists (select 1 from public.orgs where id = p_org_id and slug = 'mccluster' and enabled) then raise exception 'character outside Core authority' using errcode = '42501'; end if;
  select * into actor from public.ops_platform_actors where actor_key = p_actor_key and org_id = p_org_id;
  if not found or actor.persona->>'actor_kind' is distinct from 'character' then raise exception 'not a story character' using errcode = '42501'; end if;
  v_character := actor.persona->>'character_id';
  perform pg_advisory_xact_lock(hashtextextended('character-publish:' || p_actor_key, 0));

  select * into prior from public.ops_character_publications where job_id = p_job_id and actor_key = p_actor_key;
  if found then
    return jsonb_build_object('published', true, 'replayed', true, 'publication_id', prior.id, 'post_id', prior.post_id, 'comment_id', prior.comment_id);
  end if;
  if not actor.enabled or not exists (select 1 from public.m_people where id = actor.m_uid and status = 'active') then
    return jsonb_build_object('published', false, 'reason', 'actor_paused');
  end if;
  if not exists (select 1 from public.ops_agent_jobs where id = p_job_id and org_id = p_org_id and job_type = 'character_post'
                 and target_id = 'mnet-cast' and status = 'running' and input->'characters' ? v_character) then
    raise exception 'active character job required' using errcode = '42501';
  end if;
  if p_kind not in ('doing','news','reply') or p_body is null or char_length(btrim(p_body)) not between 12 and 600
     or p_model is null or char_length(p_model) not between 1 and 120 then
    raise exception 'invalid character post';
  end if;
  if (select count(*) from public.ops_character_publications where actor_key = p_actor_key and created_at > now() - interval '24 hours') >= actor.daily_limit then
    return jsonb_build_object('published', false, 'reason', 'daily_limit');
  end if;

  if p_kind = 'news' then
    if p_article_id is null or p_reply_to_post_id is not null
       or not exists (select 1 from public.media_news_articles where id = p_article_id and published_at >= now() - interval '48 hours') then
      raise exception 'recent retained article required';
    end if;
    if exists (select 1 from public.ops_character_publications where actor_key = p_actor_key and article_id = p_article_id) then
      return jsonb_build_object('published', false, 'reason', 'already_reacted');
    end if;
  elsif p_kind = 'reply' then
    if p_reply_to_post_id is null or p_article_id is not null then raise exception 'reply target required'; end if;
    select * into target from public.network_posts where id = p_reply_to_post_id;
    -- Replies only on another story character's live public post: never on a member's post.
    if not found or target.visibility <> 'public' or target.group_id is not null or target.deleted_at is not null or target.removed_at is not null
       or target.author_m_uid = actor.m_uid
       or not exists (select 1 from public.ops_platform_actors a where a.m_uid = target.author_m_uid and a.persona->>'actor_kind' = 'character') then
      return jsonb_build_object('published', false, 'reason', 'reply_target_unavailable');
    end if;
    if exists (select 1 from public.ops_character_publications where actor_key = p_actor_key and reply_to_post_id = p_reply_to_post_id) then
      return jsonb_build_object('published', false, 'reason', 'already_replied');
    end if;
  elsif p_article_id is not null or p_reply_to_post_id is not null then
    raise exception 'a doing post carries no article or reply target';
  end if;

  if p_kind = 'reply' then
    insert into public.network_post_comments (post_id, author_m_uid, body) values (p_reply_to_post_id, actor.m_uid, btrim(p_body)) returning id into v_comment;
  else
    insert into public.network_posts (author_m_uid, body, post_type, visibility, source_org_id, metadata)
    values (actor.m_uid, btrim(p_body), 'update', 'public', p_org_id,
      jsonb_strip_nulls(jsonb_build_object('actor_kind','character','character_id',v_character,'kind',p_kind,'news_article_id',p_article_id)))
    returning id into v_post;
  end if;
  insert into public.ops_character_publications (org_id, actor_key, character_id, job_id, kind, post_id, comment_id, article_id, reply_to_post_id, body, model)
  values (p_org_id, p_actor_key, v_character, p_job_id, p_kind, v_post, v_comment, p_article_id, p_reply_to_post_id, btrim(p_body), p_model)
  returning id into v_pub;
  return jsonb_build_object('published', true, 'replayed', false, 'publication_id', v_pub, 'post_id', v_post, 'comment_id', v_comment);
end $$;
revoke all on function public.ops_character_publish_post(uuid,uuid,text,text,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.ops_character_publish_post(uuid,uuid,text,text,text,uuid,uuid,text) to service_role;

commit;
