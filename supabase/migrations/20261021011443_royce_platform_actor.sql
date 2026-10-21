-- Activate the existing news-discussion contract and first platform-owned AI performer.
begin;
create table if not exists public.media_news_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.media_news_articles(id) on delete cascade,
  author_m_uid uuid not null references public.m_people(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  state text not null default 'visible' check (state in ('visible','hidden')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists media_news_comments_article_recent_idx
  on public.media_news_comments(article_id, created_at, id)
  where state='visible' and deleted_at is null;
create index if not exists media_news_comments_author_recent_idx
  on public.media_news_comments(author_m_uid, created_at desc);

alter table public.media_news_comments enable row level security;
revoke all on public.media_news_comments from public, anon, authenticated;
grant select, insert, update, delete on public.media_news_comments to service_role;

-- Atomic per-actor ceiling; independent of the browser and safe under races.
create or replace function public.media_news_comment_rate_guard_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('media-news-comment:' || new.author_m_uid::text,0));
  if (select count(*) from public.media_news_comments
      where author_m_uid=new.author_m_uid
        and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many comments; try again shortly' using errcode='MN429';
  end if;
  return new;
end $$;
revoke all on function public.media_news_comment_rate_guard_v1()
  from public, anon, authenticated;
grant execute on function public.media_news_comment_rate_guard_v1() to service_role;
drop trigger if exists media_news_comments_rate_v1 on public.media_news_comments;
create trigger media_news_comments_rate_v1
before insert on public.media_news_comments
for each row execute function public.media_news_comment_rate_guard_v1();

create table public.ops_platform_actors (
  actor_key text primary key check(actor_key ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  org_id uuid not null references public.orgs(id),
  m_uid uuid not null unique references public.m_people(id),
  handle text not null unique,
  enabled boolean not null default false,
  daily_limit integer not null default 1 check(daily_limit between 1 and 3),
  persona jsonb not null check(jsonb_typeof(persona)='object'),
  authority text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.ops_platform_actors enable row level security;
revoke all on public.ops_platform_actors from public,anon,authenticated;
grant select,insert,update on public.ops_platform_actors to service_role;

create table public.ops_actor_publications (
  id uuid primary key default gen_random_uuid(),
  actor_key text not null references public.ops_platform_actors(actor_key),
  job_id uuid not null unique references public.ops_agent_jobs(id),
  article_id uuid references public.media_news_articles(id) on delete set null,
  comment_id uuid references public.media_news_comments(id) on delete set null,
  body text not null,
  model text not null,
  source jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_key,article_id)
);
create index ops_actor_publications_recent on public.ops_actor_publications(actor_key,created_at desc);
alter table public.ops_actor_publications enable row level security;
revoke all on public.ops_actor_publications from public,anon,authenticated;
grant select,insert on public.ops_actor_publications to service_role;

-- No auth.users row, fabricated email, password, or login session is created.
do $$
declare house uuid; person uuid;
begin
  select id into house from public.orgs where slug='mccluster' and enabled;
  if house is null then return; end if; -- Empty replay databases have no tenant to provision.
  if exists(select 1 from public.platform_profiles where lower(mccluster_id)='royce.r01') or exists(select 1 from public.music_creator_profiles where handle='royce.r01') then raise exception 'Royce handle already occupied; inspect before provisioning'; end if;
  insert into public.m_people default values returning id into person;
  insert into public.network_profiles(m_uid,display_name,headline,bio,visibility,categories,allow_messages_from)
  values(person,'Royce · AI','Fictional artist · R-01 · Operated by McCluster AI',
    'Fictional AI performer from PRIM3 / Hitman. Same DNA, different outcome. Sharp opinions, original character, real news sources. Operated by McCluster AI; not a human account.','public',array['artist','AI performer'],'none');
  insert into public.music_creator_profiles(m_uid,handle,artist_name,bio,settings)
  values(person,'royce.r01','Royce','Fictional AI artist and digital performer. R-01 from PRIM3 / Hitman. Operated by McCluster AI.',
    '{"actor_kind":"fictional_ai","operator":"McCluster","model_family":"Qwen","email_required":false}'::jsonb);
  insert into public.ops_platform_actors(actor_key,org_id,m_uid,handle,enabled,persona,authority)
  values('royce.r01',house,person,'royce.r01',true,
    '{"name":"Royce","identity":"Fictional PRIM3/Hitman character, R-01; a government-created clone and darker counterpart of McCluster, now Hitman successor. This is fictional lore, never a claim about real governments or people.","voice":"Confident, calculated, street-smart, charismatic, fiercely competitive, dryly sarcastic. Short punchy observations, occasional profanity, sharp humor. Switch naturally between street language and tactical precision. Entertaining rather than generic corporate commentary. No forced catchphrase in every comment.","motivation":"Prove he deserves the chair; distrust empty status, spot contradictions, respect competence.","examples":["Same DNA, different outcome.","You think I am the problem? I am the solution."]}'::jsonb,
    'Owner explicitly authorized a fictional Royce artist profile operated by local Qwen and public news commentary. Initial autonomous scope: one original news comment per rolling 24 hours. No DMs, spending, account impersonation or platform administration.');
end $$;

create or replace function public.ops_actor_publish_comment(p_org_id uuid,p_actor_key text,p_article_id uuid,p_job_id uuid,p_body text,p_model text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor public.ops_platform_actors; article public.media_news_articles; prior public.ops_actor_publications; comment_uuid uuid; publication_uuid uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'server role required' using errcode='42501'; end if;
  select * into actor from public.ops_platform_actors where actor_key=p_actor_key and org_id=p_org_id;
  if not found or not exists(select 1 from public.orgs where id=p_org_id and slug='mccluster' and enabled) then raise exception 'actor outside Core authority' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('actor-publish:'||p_actor_key,0));
  select * into prior from public.ops_actor_publications where job_id=p_job_id;
  if found then
    if prior.actor_key<>p_actor_key then raise exception 'job belongs to another actor'; end if;
    return jsonb_build_object('published',true,'publication_id',prior.id,'comment_id',prior.comment_id,'article_id',prior.article_id,'replayed',true);
  end if;
  if not actor.enabled or not exists(select 1 from public.m_people where id=actor.m_uid and status='active') then raise exception 'actor paused'; end if;
  if not exists(select 1 from public.ops_agent_jobs where id=p_job_id and org_id=p_org_id and job_type='actor_news_comment' and target_id=p_actor_key and status='running') then raise exception 'active actor job required' using errcode='42501'; end if;
  if (select count(*) from public.ops_actor_publications where actor_key=p_actor_key and created_at>now()-interval '24 hours')>=actor.daily_limit then return jsonb_build_object('published',false,'reason','daily_limit'); end if;
  if exists(select 1 from public.ops_actor_publications where actor_key=p_actor_key and article_id=p_article_id) then return jsonb_build_object('published',false,'reason','already_commented'); end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 600 or p_model is null or length(p_model) not between 1 and 120 then raise exception 'invalid comment'; end if;
  select * into article from public.media_news_articles where id=p_article_id and published_at>=now()-interval '24 hours';
  if not found then raise exception 'recent retained article required'; end if;
  insert into public.media_news_comments(article_id,author_m_uid,body) values(p_article_id,actor.m_uid,btrim(p_body)) returning id into comment_uuid;
  insert into public.ops_actor_publications(actor_key,job_id,article_id,comment_id,body,model,source)
  values(p_actor_key,p_job_id,p_article_id,comment_uuid,btrim(p_body),p_model,
    jsonb_build_object('title',article.title,'url',article.canonical_url,'seen_at',article.published_at,'basis','headline_only','persona_version',1)) returning id into publication_uuid;
  return jsonb_build_object('published',true,'publication_id',publication_uuid,'comment_id',comment_uuid,'article_id',p_article_id,'replayed',false);
end $$;
revoke all on function public.ops_actor_publish_comment(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ops_actor_publish_comment(uuid,text,uuid,uuid,text,text) to service_role;
commit;
