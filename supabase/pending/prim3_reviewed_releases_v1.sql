-- PENDING: isolated tests only. Requires learning_evidence_v1 and media_news_articles.
-- No public/client policy: the existing house-owner Worker is the only interface.
begin;
create table public.prim3_reviewed_releases (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 article_id uuid references public.media_news_articles(id), dedupe_key text not null,
 recipe_id text not null, recipe_hash text not null check(recipe_hash ~ '^[a-f0-9]{64}$'),
 recipe_input jsonb not null check(jsonb_typeof(recipe_input)='object' and pg_column_size(recipe_input)<16000),
 checkpoint_ids jsonb not null check(jsonb_typeof(checkpoint_ids)='array' and jsonb_array_length(checkpoint_ids) between 1 and 8),
 source_snapshot jsonb, published_at timestamptz, reviewed_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz,
 unique(owner_id,dedupe_key),
 check(expires_at=coalesce(published_at,reviewed_at)+interval '24 hours'),
 check(published_at is null or published_at<=reviewed_at),
 check((article_id is null)=(published_at is null)),
 check((article_id is null)=(source_snapshot is null))
);
create index prim3_release_owner_recent on public.prim3_reviewed_releases(owner_id,reviewed_at desc);
create table public.prim3_release_sessions (
 session_id uuid primary key references public.learning_lab_sessions(id) on delete cascade,
 release_id uuid not null references public.prim3_reviewed_releases(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade, claimed_at timestamptz not null default now()
);
alter table public.prim3_reviewed_releases enable row level security;
alter table public.prim3_release_sessions enable row level security;
revoke all on public.prim3_reviewed_releases,public.prim3_release_sessions from public,anon,authenticated;
grant select,insert,update on public.prim3_reviewed_releases to service_role;
grant select,insert on public.prim3_release_sessions to service_role;
create function public.prim3_release_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='DELETE' then
  if current_setting('learning.allow_purge',true)='on' then return old; end if;
  raise exception 'Release history is immutable';
 end if;
 if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at') or old.revoked_at is not null or new.revoked_at is null then
  raise exception 'Only first revocation is allowed';
 end if;
 new.revoked_at:=clock_timestamp();return new;
end $$;
create trigger prim3_release_immutable before update or delete on public.prim3_reviewed_releases for each row execute function public.prim3_release_immutable();
create function public.prim3_release_publish(p_owner uuid,p_id uuid,p_article uuid,p_country text,p_input jsonb,p_recipe_id text,p_hash text,p_checkpoints jsonb,p_dedupe text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.prim3_reviewed_releases; a public.media_news_articles; t timestamptz:=clock_timestamp(); snapshot jsonb;
begin
 if p_owner is null or p_id is null or length(p_dedupe)>200 then raise exception 'Invalid release identity'; end if;
 perform pg_advisory_xact_lock(hashtextextended('prim3-release:'||p_owner::text||':'||p_dedupe,0));
 select * into r from public.prim3_reviewed_releases where owner_id=p_owner and dedupe_key=p_dedupe;
 if found then
  if r.recipe_hash<>p_hash then raise exception 'Conflicting release revision' using errcode='23505'; end if;
  return to_jsonb(r); -- exact retry never refreshes expiry or unrevokes
 end if;
 if p_input->'review'->>'fiction' is distinct from 'true' or p_input->'review'->>'geography' is distinct from 'true' then raise exception 'Owner review required'; end if;
 if p_article is not null then
  select * into a from public.media_news_articles where id=p_article;
  if not found or a.published_at is null or a.published_at>t or a.published_at+interval '24 hours'<=t then raise exception 'Source unavailable or expired'; end if;
  if a.location_country_fips is distinct from p_country then raise exception 'Source country changed'; end if;
  if p_input->'source'->>'eventId' is distinct from a.id::text or p_input->'source'->>'url' is distinct from a.canonical_url
   or (p_input->'source'->>'publishedAt')::timestamptz is distinct from a.published_at or p_input->'review'->>'source' is distinct from 'true' then raise exception 'Source revision changed or not reviewed'; end if;
  snapshot:=p_input->'source';
 elsif p_input->'source' is distinct from 'null'::jsonb then raise exception 'Offline release cannot claim a source'; end if;
 insert into public.prim3_reviewed_releases(id,owner_id,article_id,dedupe_key,recipe_id,recipe_hash,recipe_input,checkpoint_ids,source_snapshot,published_at,reviewed_at,expires_at)
 values(p_id,p_owner,p_article,p_dedupe,p_recipe_id,p_hash,p_input,p_checkpoints,snapshot,a.published_at,t,coalesce(a.published_at,t)+interval '24 hours') returning * into r;
 return to_jsonb(r);
end $$;
create function public.prim3_release_claim(p_owner uuid,p_release uuid,p_session uuid,p_seed bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.prim3_reviewed_releases; s public.learning_lab_sessions; b public.prim3_release_sessions;
begin
 -- Serializes retry identity even when the session does not exist yet.
 perform pg_advisory_xact_lock(hashtextextended('prim3-claim:'||p_session::text,0));
 select * into b from public.prim3_release_sessions where session_id=p_session;
 if found then
  if b.owner_id<>p_owner or b.release_id<>p_release then raise exception 'Conflicting session identity' using errcode='23505'; end if;
  select * into s from public.learning_lab_sessions where id=p_session and user_id=p_owner;
  return to_jsonb(s); -- old accepted start may be recovered after expiry
 end if;
 select * into r from public.prim3_reviewed_releases where id=p_release and owner_id=p_owner for update;
 if not found or r.revoked_at is not null or clock_timestamp()>=r.expires_at then raise exception 'Release unavailable or expired'; end if;
 if p_seed is null or p_seed<0 or p_seed>=2147483648 then raise exception 'Invalid seed'; end if;
 insert into public.learning_lab_sessions(id,user_id,pack_id,pack_version,scenario_id,mode,execution_target,difficulty,seed)
 values(p_session,p_owner,'prim3-coordinate-practice','1.0.0','PRIM3-RELAY-DISTANCE-V1','SIMULATION','SANDBOX','FOUNDATION',p_seed) returning * into s;
 insert into public.prim3_release_sessions(session_id,release_id,owner_id) values(p_session,p_release,p_owner);
 return to_jsonb(s);
end $$;
create function public.prim3_release_event_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.prim3_release_sessions; r public.prim3_reviewed_releases;
begin
 select * into b from public.prim3_release_sessions where session_id=new.session_id;
 if not found then return new; end if;
 select * into r from public.prim3_reviewed_releases where id=b.release_id for update;
 if b.owner_id<>new.user_id or r.owner_id<>new.user_id or r.revoked_at is not null or clock_timestamp()>=r.expires_at then
  raise exception 'Release unavailable or expired' using errcode='23514';
 end if;
 if new.payload->>'type'='release' and (new.payload->'reviewed_release'->>'id' is distinct from r.id::text or new.payload->'reviewed_release'->>'recipe_hash' is distinct from r.recipe_hash) then
  raise exception 'Release binding required' using errcode='23514';
 end if;
 return new;
end $$;
-- Lock order: existing chain trigger locks session first, then release guard. Revocation
-- only locks release; claim uses a new session. No release->existing-session lock cycle.
create trigger prim3_release_event_guard before insert on public.learning_evidence_events for each row execute function public.prim3_release_event_guard();
revoke all on function public.prim3_release_immutable(),public.prim3_release_event_guard() from public,anon,authenticated;
revoke all on function public.prim3_release_publish(uuid,uuid,uuid,text,jsonb,text,text,jsonb,text),public.prim3_release_claim(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.prim3_release_publish(uuid,uuid,uuid,text,jsonb,text,text,jsonb,text),public.prim3_release_claim(uuid,uuid,uuid,bigint) to service_role;
commit;
