-- Staged, not applied: published creator site content is deliberately limited to plain text.
create table if not exists public.creator_published_sites (
 org_id uuid primary key references public.orgs(id) on delete cascade,
 slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
 title text not null check (char_length(title) between 1 and 120),
 tagline text not null default '' check (char_length(tagline)<=300),
 bio text not null default '' check (char_length(bio)<=4000),
 published_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.creator_published_sites enable row level security;
revoke all on public.creator_published_sites from public,anon,authenticated;
create or replace function public.creator_publish_site(p_org_id uuid,p_title text,p_tagline text,p_bio text)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_slug text;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if not exists(select 1 from public.creator_billing_subscriptions
  where org_id=p_org_id and status='active' and current_period_end>now()) then
  raise exception 'active paid subscription required';
 end if;
 if char_length(p_title) not between 1 and 120 or char_length(coalesce(p_tagline,''))>300 or char_length(coalesce(p_bio,''))>4000 then
  raise exception 'invalid site content';
 end if;
 v_slug:='site-'||replace(p_org_id::text,'-','');
 insert into public.creator_published_sites(org_id,slug,title,tagline,bio)
 values(p_org_id,v_slug,p_title,coalesce(p_tagline,''),coalesce(p_bio,''))
 on conflict(org_id) do update set title=excluded.title,tagline=excluded.tagline,
 bio=excluded.bio,updated_at=now()
 returning slug into v_slug;
 return v_slug;
end $$;
revoke all on function public.creator_publish_site(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.creator_publish_site(uuid,text,text,text) to service_role;
