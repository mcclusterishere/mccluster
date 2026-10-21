create table if not exists public.media_gdelt_state (
 topic text primary key check(topic in ('world','policy','climate','health','technology')),
 next_attempt_at timestamptz not null default now(),
 last_success_at timestamptz,
 last_error text,
 failures integer not null default 0,
 updated_at timestamptz not null default now()
);
insert into public.media_gdelt_state(topic) values ('world'),('policy'),('climate'),('health'),('technology') on conflict do nothing;
alter table public.media_gdelt_state enable row level security;
revoke all on public.media_gdelt_state from anon,authenticated;
grant all on public.media_gdelt_state to service_role;
create or replace function public.media_gdelt_claim(p_topic text) returns boolean
language plpgsql security definer set search_path=public as $$
declare claimed text;
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required';end if;
 update public.media_gdelt_state set next_attempt_at=now()+interval '3 minutes',updated_at=now()
 where topic=p_topic and next_attempt_at<=now() returning topic into claimed;
 return claimed is not null;
end $$;
create or replace function public.media_gdelt_finish(p_topic text,p_success boolean,p_error text default null,p_retry_seconds integer default null) returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.role()<>'service_role' then raise exception 'service_role_required';end if;
 update public.media_gdelt_state set
 failures=case when p_success then 0 else least(failures+1,12) end,
 last_success_at=case when p_success then now() else last_success_at end,
 last_error=case when p_success then null else left(p_error,300) end,
 next_attempt_at=now()+make_interval(secs=>case when p_success then 900 else greatest(300,least(21600,coalesce(p_retry_seconds,(300*power(2,least(failures,6)))::integer))) end),
 updated_at=now()
 where topic=p_topic;
end $$;
revoke all on function public.media_gdelt_claim(text),public.media_gdelt_finish(text,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.media_gdelt_claim(text),public.media_gdelt_finish(text,boolean,text,integer) to service_role;
create or replace function public.media_public_cached_news(p_topic text,p_limit integer default 40)
returns table(title text,url text,domain text,language text,published_at timestamptz)
language sql stable security definer set search_path=public as $$
 select a.title,a.canonical_url,s.domain,a.language_code,a.published_at
 from public.media_news_articles a join public.media_news_sources s on s.id=a.source_id
 where p_topic=any(a.topic_keys)
 order by a.published_at desc nulls last,a.imported_at desc limit least(greatest(coalesce(p_limit,40),1),100)
$$;
revoke all on function public.media_public_cached_news(text,integer) from public;
grant execute on function public.media_public_cached_news(text,integer) to anon,authenticated,service_role;