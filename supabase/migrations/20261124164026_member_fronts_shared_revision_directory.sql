-- Additive shared-account page publishing. No local identity, location or AI state.
-- Public media is intentional; published pages and directory rows expose no draft.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists member_fronts_private;
revoke all on schema member_fronts_private from public;
grant usage on schema member_fronts_private to anon, authenticated, service_role;

create table public.member_fronts (
 m_uid uuid primary key references public.m_people(id) on delete cascade,
 auth_user_id uuid not null unique references auth.users(id) on delete cascade,
 handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
 draft jsonb not null default '{"schema":"mccluster-front/v1"}',
 published jsonb,
 published_at timestamptz,
 published_revision integer,
 updated_at timestamptz not null default now(),
 removed_at timestamptz,
 removed_reason text,
 revision integer not null default 1 check (revision > 0),
 globe_opt_in boolean not null default false,
 globe_consented_at timestamptz,
 check (jsonb_typeof(draft)='object' and octet_length(draft::text)<=49152),
 check (published is null or (jsonb_typeof(published)='object' and octet_length(published::text)<=49152))
);
alter table public.member_fronts enable row level security;
alter table public.member_fronts force row level security;
revoke all on public.member_fronts from public,anon,authenticated;
grant select,insert,update,delete on public.member_fronts to service_role;

create function member_fronts_private.media_prefix(p_uid uuid) returns text
language sql immutable set search_path='' as $$
 select 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/front-media/'||p_uid::text||'/'
$$;
create function member_fronts_private.short_text(v jsonb,n integer) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='string' and length(v#>>'{}') between 1 and n and (v#>>'{}') !~ '[[:cntrl:]]',false)
$$;
create function member_fronts_private.href(v jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='string' and length(v#>>'{}') between 1 and 300 and
 ((v#>>'{}') ~* '^https://[^[:space:]"''<>]+$' or
 (v#>>'{}') ~* '^(?![a-z][a-z0-9+.-]*:)(?!//)[a-z0-9_./?#=&%-]+$'),false)
$$;
create function member_fronts_private.media_url(v jsonb,p_uid uuid) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='string' and length(v#>>'{}')<=400
 and left(v#>>'{}',length(member_fronts_private.media_prefix(p_uid)))=member_fronts_private.media_prefix(p_uid)
 and substring(v#>>'{}' from length(member_fronts_private.media_prefix(p_uid))+1) ~ '^[A-Za-z0-9._/:-]+$'
 and position('..' in (v#>>'{}'))=0,false)
$$;
create function member_fronts_private.number_between(v jsonb,lo numeric,hi numeric) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'number' then return false; end if;
 return (v#>>'{}')::numeric between lo and hi;
end $$;

-- Direct RPC callers pass the same allowlisted shape as packages/front-config.
-- Reject invalid fields rather than silently retaining arbitrary JSON.
create function member_fronts_private.config_valid(p jsonb,p_uid uuid) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;a text;b jsonb;x jsonb;lim integer;
begin
 if p_uid is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>49152 then return false; end if;
 for k,v in select * from jsonb_each(p) loop
  if k='schema' then if v <> '"mccluster-front/v1"'::jsonb then return false; end if;
  elsif k='start' then if v not in ('"cabin"'::jsonb,'"plane"'::jsonb) then return false; end if;
  elsif k='song' then if v not in ('"antisocial"'::jsonb,'"whodidtheshoot"'::jsonb,'"vaunt"'::jsonb,'"runway"'::jsonb,'"here"'::jsonb,'"environmental-injustice"'::jsonb) then return false; end if;
  elsif k='visible' then if jsonb_typeof(v)<>'boolean' then return false; end if;
  elsif k='links' then
   if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>4 then return false; end if;
   for x in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(x)<>'object' or x - array['label','href'] <> '{}'::jsonb or not member_fronts_private.short_text(x->'label',40) or not member_fronts_private.href(x->'href') then return false; end if;
   end loop;
  elsif k in ('brand','scenes','scroll','vr','night','words','media') then
   if jsonb_typeof(v)<>'object' then return false; end if;
   for a,b in select * from jsonb_each(v) loop
    if k='brand' then
     if a='name' then if not member_fronts_private.short_text(b,80) then return false; end if;
     elsif a='accent' then if jsonb_typeof(b)<>'string' or (b#>>'{}') !~* '^#[a-f0-9]{6}$' then return false; end if;
     elsif a='logo' then if not member_fronts_private.media_url(b,p_uid) then return false; end if;
     else return false; end if;
    elsif k='scenes' then if a not in ('doors','vaunt','night','world') or jsonb_typeof(b)<>'boolean' then return false; end if;
    elsif k='scroll' then
     if a='duration' then if not member_fronts_private.number_between(b,.3,1.8) then return false; end if;
     elsif a='touchLerp' then if not member_fronts_private.number_between(b,.05,.4) then return false; end if;
     else return false; end if;
    elsif k='night' then if a<>'arrive' or not member_fronts_private.number_between(b,.5,.86) then return false; end if;
    elsif k='vr' then
     if a in ('enabled','hold') then if jsonb_typeof(b)<>'boolean' then return false; end if;
     elsif a='yaw' then if not member_fronts_private.number_between(b,-180,180) then return false; end if;
     elsif a='pitch' then if not member_fronts_private.number_between(b,-85,85) then return false; end if;
     elsif a='band' then
      if jsonb_typeof(b)<>'array' or jsonb_array_length(b)<>2 then return false; end if;
      if not member_fronts_private.number_between(b->0,.15,.85) or not member_fronts_private.number_between(b->1,.15,.85) then return false; end if;
      if (b->>1)::numeric-(b->>0)::numeric<.04 then return false; end if;
     elsif a='spots' then
      if jsonb_typeof(b)<>'array' or jsonb_array_length(b)>5 then return false; end if;
      for x in select * from jsonb_array_elements(b) loop
       if jsonb_typeof(x)<>'object' or x-array['yaw','pitch','label','href','urgent']<>'{}'::jsonb
       or not member_fronts_private.short_text(x->'label',60) or not member_fronts_private.href(x->'href')
       or (x ? 'yaw' and not member_fronts_private.number_between(x->'yaw',-180,180))
       or (x ? 'pitch' and not member_fronts_private.number_between(x->'pitch',-85,85))
       or (x ? 'urgent' and jsonb_typeof(x->'urgent')<>'boolean') then return false; end if;
      end loop;
     else return false; end if;
    elsif k='words' then
     if a in ('door1','door2') then
      if jsonb_typeof(b)<>'object' or b-array['label','href']<>'{}'::jsonb or not member_fronts_private.short_text(b->'label',40) or not member_fronts_private.href(b->'href') then return false; end if;
     else
      lim:=case a when 'eyebrow' then 60 when 'title1' then 14 when 'title2' then 14 when 'sub' then 60 when 'gateKicker' then 40 when 'gateTitle' then 40 when 'gateLede' then 180 when 'cabinTag' then 60 when 'nightKicker' then 60 when 'nightTitle1' then 12 when 'nightTitle2' then 12 else null end;
      if lim is null or not member_fronts_private.short_text(b,lim) then return false; end if;
     end if;
    elsif k='media' then
     if jsonb_typeof(b)<>'object' then return false; end if;
     if a in ('hero','scene1','scene2','night') then
      if b-array['base','count','ext','sm']<>'{}'::jsonb or not member_fronts_private.media_url(b->'base',p_uid)
       or right(b->>'base',1)<>'/' or not member_fronts_private.number_between(b->'count',8,240)
       or (b->>'count')::numeric<>trunc((b->>'count')::numeric) or b->>'ext' not in ('webp','jpg')
       or not (b ? 'ext') or (b ? 'sm' and jsonb_typeof(b->'sm')<>'boolean') then return false; end if;
     elsif a='cabin' then
      if b-array['src','kind','poster']<>'{}'::jsonb or not member_fronts_private.media_url(b->'src',p_uid)
       or b->>'kind' not in ('video','image') or not(b ? 'kind')
       or (b ? 'poster' and not member_fronts_private.media_url(b->'poster',p_uid)) then return false; end if;
     elsif a in ('sound','still') then
      if b-array['src']<>'{}'::jsonb or not member_fronts_private.media_url(b->'src',p_uid) then return false; end if;
     else return false; end if;
    end if;
   end loop;
  else return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function member_fronts_private.media_refs(p jsonb) returns setof text
language sql immutable set search_path='' as $$
 select p#>>'{brand,logo}' where p#>>'{brand,logo}' is not null
 union all select value->>'base' from jsonb_each(coalesce(p->'media','{}'::jsonb)) where value ? 'base'
 union all select value->>'src' from jsonb_each(coalesce(p->'media','{}'::jsonb)) where value ? 'src'
 union all select value->>'poster' from jsonb_each(coalesce(p->'media','{}'::jsonb)) where value ? 'poster'
$$;
create function member_fronts_private.lock_media(p_uid uuid) returns void
language sql volatile set search_path='' as $$
 select pg_advisory_xact_lock(hashtextextended('member-front:'||p_uid::text,0))
$$;
create function member_fronts_private.lock_page(p_m_uid uuid) returns void
language sql volatile set search_path='' as $$
 select pg_advisory_xact_lock(hashtextextended('member-front-page:'||p_m_uid::text,0))
$$;
create function member_fronts_private.identity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();m uuid;p public.platform_profiles%rowtype;
begin
 if u is null or not exists(select 1 from auth.users where id=u) then return jsonb_build_object('ok',false,'code','auth_required','error','Sign in to continue.'); end if;
 select m_uid into m from public.m_auth_user_links where auth_user_id=u and is_primary=true limit 1;
 select * into p from public.platform_profiles where user_id=u;
 if m is null or p.mccluster_id is null or lower(p.mccluster_id) !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then return jsonb_build_object('ok',false,'code','handle_required','error','Finish your account and choose a handle first.'); end if;
 return jsonb_build_object('ok',true,'auth_user_id',u,'m_uid',m,'handle',lower(p.mccluster_id),'name',coalesce(p.display_name,''),'avatar',coalesce(p.avatar_url,''));
end $$;
create function member_fronts_private.self_result(i jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select (i-'m_uid')||jsonb_build_object('draft',f.draft,'published',f.published,'published_at',f.published_at,'updated_at',f.updated_at,
 'revision',coalesce(f.revision,0),'globe_opt_in',coalesce(f.globe_opt_in,false),'removed',f.removed_at is not null,
 'media_prefix',member_fronts_private.media_prefix((i->>'auth_user_id')::uuid),'max_bytes',49152,'url','front.html?u='||(i->>'handle'))
 from (select 1) x left join public.member_fronts f on f.m_uid=(i->>'m_uid')::uuid and f.auth_user_id=(i->>'auth_user_id')::uuid
$$;
create function member_fronts_private.get_self() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i jsonb:=member_fronts_private.identity();
begin if not(i->>'ok')::boolean then return i; end if; return member_fronts_private.self_result(i); end $$;

create function member_fronts_private.save(p_config jsonb,p_expected_revision integer,p_publish boolean,p_globe_opt_in boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i jsonb:=member_fronts_private.identity();u uuid;m uuid;f public.member_fronts%rowtype;rev integer;ref text;object_path text;
begin
 if not(i->>'ok')::boolean then return i; end if;
 u:=(i->>'auth_user_id')::uuid;m:=(i->>'m_uid')::uuid;
 if p_expected_revision is null or p_expected_revision<0 or p_publish is null or p_globe_opt_in is null or not member_fronts_private.config_valid(p_config,u) then return jsonb_build_object('ok',false,'code','invalid_config','error','Use valid page settings and an expected revision.'); end if;
 perform member_fronts_private.lock_media(u);
 perform member_fronts_private.lock_page(m);
 select * into f from public.member_fronts where m_uid=m for update;rev:=coalesce(f.revision,0);
 if f.auth_user_id is not null and f.auth_user_id<>u then return jsonb_build_object('ok',false,'code','forbidden','error','This linked identity has a different page owner.'); end if;
 if p_expected_revision<>rev then return jsonb_build_object('ok',false,'code','revision_conflict','error','This page changed. Reload before saving.','current_revision',rev); end if;
 if rev=2147483647 then return jsonb_build_object('ok',false,'code','revision_limit','error','This page needs operator attention.'); end if;
 if p_publish and f.removed_at is not null then return jsonb_build_object('ok',false,'code','removed','error','This page was taken down and cannot be published.'); end if;
 for ref in select * from member_fronts_private.media_refs(p_config) loop
  object_path:=substring(ref from length('https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/front-media/')+1);
  if not exists(select 1 from storage.objects o where o.bucket_id='front-media' and (o.name=object_path or (right(object_path,1)='/' and left(o.name,length(object_path))=object_path))) then
   return jsonb_build_object('ok',false,'code','media_missing','error','An uploaded page asset is missing. Upload it again before saving.');
  end if;
 end loop;
 insert into public.member_fronts(m_uid,auth_user_id,handle,draft,published,published_at,published_revision,revision,globe_opt_in,globe_consented_at)
 values(m,u,i->>'handle',p_config,case when p_publish then p_config end,case when p_publish then now() end,case when p_publish then rev+1 end,rev+1,p_globe_opt_in,case when p_globe_opt_in then now() end)
 on conflict(m_uid) do update set handle=excluded.handle,draft=excluded.draft,
 published=case when p_publish then excluded.published else member_fronts.published end,
 published_at=case when p_publish then excluded.published_at else member_fronts.published_at end,
 published_revision=case when p_publish then excluded.published_revision else member_fronts.published_revision end,
 revision=excluded.revision,updated_at=now(),globe_opt_in=excluded.globe_opt_in,
 globe_consented_at=case when excluded.globe_opt_in then coalesce(member_fronts.globe_consented_at,now()) end;
 return member_fronts_private.self_result(i);
end $$;
create function member_fronts_private.unpublish(p_expected_revision integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i jsonb:=member_fronts_private.identity();f public.member_fronts%rowtype;rev integer;
begin
 if not(i->>'ok')::boolean then return i; end if;
 if p_expected_revision is null or p_expected_revision<0 then return jsonb_build_object('ok',false,'code','invalid_config','error','An expected revision is required.'); end if;
 perform member_fronts_private.lock_media((i->>'auth_user_id')::uuid);
 perform member_fronts_private.lock_page((i->>'m_uid')::uuid);
 select * into f from public.member_fronts where m_uid=(i->>'m_uid')::uuid for update;rev:=coalesce(f.revision,0);
 if f.auth_user_id is not null and f.auth_user_id<>(i->>'auth_user_id')::uuid then return jsonb_build_object('ok',false,'code','forbidden','error','This linked identity has a different page owner.'); end if;
 if p_expected_revision<>rev then return jsonb_build_object('ok',false,'code','revision_conflict','error','This page changed. Reload before saving.','current_revision',rev); end if;
 if rev=2147483647 then return jsonb_build_object('ok',false,'code','revision_limit','error','This page needs operator attention.'); end if;
 update public.member_fronts set published=null,published_at=null,published_revision=null,revision=rev+1,updated_at=now() where m_uid=(i->>'m_uid')::uuid;
 return member_fronts_private.self_result(i);
end $$;

create function member_fronts_private.public_page(p_handle text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f public.member_fronts%rowtype;p public.network_profiles%rowtype;
begin
 select * into f from public.member_fronts where handle=p_handle and published is not null and removed_at is null and coalesce(published->>'visible','true')<>'false';
 if f.m_uid is null then return jsonb_build_object('ok',false,'code','not_found','error','No front page here yet.'); end if;
 select * into p from public.network_profiles where m_uid=f.m_uid;
 if p.m_uid is null or p.visibility is distinct from 'public' or not member_fronts_private.config_valid(f.published,f.auth_user_id) then return jsonb_build_object('ok',false,'code','not_found','error','No front page here yet.'); end if;
 return jsonb_build_object('ok',true,'handle',f.handle,'name',coalesce(p.display_name,f.handle),'avatar',coalesce(p.avatar_url,''),'headline',coalesce(p.headline,''),'config',f.published,'published_at',f.published_at);
end $$;
create function member_fronts_private.directory(p_limit integer,p_after text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;more boolean;last_handle text;
begin
 if p_limit is null or p_limit not between 1 and 100 or (p_after is not null and p_after !~ '^[a-z0-9][a-z0-9._-]{2,39}$') then return jsonb_build_object('ok',false,'code','invalid_config','error','Invalid directory cursor or limit.'); end if;
 with eligible as (
  select f.* from public.member_fronts f join public.network_profiles n on n.m_uid=f.m_uid
  where f.published is not null and f.removed_at is null and f.globe_opt_in
   and n.visibility='public' and coalesce(f.published->>'visible','true')<>'false'
   and member_fronts_private.config_valid(f.published,f.auth_user_id)
   and (p_after is null or f.handle>p_after) order by f.handle limit p_limit+1
 ), page as (select * from eligible order by handle limit p_limit)
 select coalesce(jsonb_agg(jsonb_build_object('id','front:'||handle,'handle',handle,'name',coalesce(published#>>'{brand,name}',handle),
 'headline',coalesce(published#>>'{words,sub}',''),'url','front.html?u='||handle,
 'published_at',published_at,'revision',published_revision) order by handle),'[]'::jsonb),
 (select count(*)>p_limit from eligible),max(handle) into result,more,last_handle from page;
 return jsonb_build_object('ok',true,'nodes',result,'next_after',case when more then last_handle else null end,'position_kind','network','position_is_geographic',false);
end $$;

-- Anonymous callers receive only curated publication results. Identity never comes
-- from caller-supplied IDs, JWT metadata, a browser location or an analytics event.
create function public.member_front_get_self() returns jsonb language sql security invoker set search_path='' as $$select member_fronts_private.get_self()$$;
create function public.member_front_save(p_config jsonb,p_expected_revision integer,p_publish boolean,p_globe_opt_in boolean) returns jsonb language sql security invoker set search_path='' as $$select member_fronts_private.save(p_config,p_expected_revision,p_publish,p_globe_opt_in)$$;
create function public.member_front_unpublish(p_expected_revision integer) returns jsonb language sql security invoker set search_path='' as $$select member_fronts_private.unpublish(p_expected_revision)$$;
create function public.member_front_public(p_handle text) returns jsonb language sql security invoker set search_path='' as $$select member_fronts_private.public_page(p_handle)$$;
create function public.member_front_directory(p_limit integer default 100,p_after text default null) returns jsonb language sql security invoker set search_path='' as $$select member_fronts_private.directory(p_limit,p_after)$$;

-- The takedown uses the same account lock as saving. A concurrent draft save
-- cannot resurrect a removed page; removal also advances its edit revision.
create function member_fronts_private.takedown(p_handle text,p_reason text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare u uuid:=auth.uid();f public.member_fronts%rowtype;
begin
 if u is null or not exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id where o.slug='mccluster' and m.profile_id=u and m.role='owner') then
  return jsonb_build_object('ok',false,'code','forbidden','error','House owner access required.');
 end if;
 select * into f from public.member_fronts where handle=p_handle;
 if f.m_uid is null then return jsonb_build_object('ok',false,'code','not_found','error','No front page here yet.'); end if;
 perform member_fronts_private.lock_media(f.auth_user_id);
 perform member_fronts_private.lock_page(f.m_uid);
 update public.member_fronts set removed_at=now(),removed_reason=nullif(left(coalesce(p_reason,''),300),''),published=null,published_at=null,published_revision=null,revision=least(revision::bigint+1,2147483647)::integer,updated_at=now() where m_uid=f.m_uid;
 return jsonb_build_object('ok',true,'handle',p_handle,'removed',true);
end $$;
create function public.member_front_takedown(p_handle text,p_reason text default '') returns jsonb language sql security invoker set search_path='' as $$select member_fronts_private.takedown(p_handle,p_reason)$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('front-media','front-media',true,314572800,array['image/webp','image/jpeg','image/png','video/mp4','video/webm','audio/mpeg','audio/mp4','audio/aac','audio/wav']);
create function member_fronts_private.storage_write_allowed(p_name text,p_metadata jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare u uuid:=auth.uid();n bigint;s bigint;incoming bigint;
begin
 if u is null or left(p_name,length(u::text)+1)<>u::text||'/' or p_name ~ '\.\.|//' then return false; end if;
 perform member_fronts_private.lock_media(u);
 incoming:=case when p_metadata->>'size' ~ '^[0-9]{1,10}$' then (p_metadata->>'size')::bigint else 314572800 end;
 select count(*),coalesce(sum(case when metadata->>'size' ~ '^[0-9]{1,10}$' then (metadata->>'size')::bigint else 314572800 end),0) into n,s from storage.objects where bucket_id='front-media' and left(name,length(u::text)+1)=u::text||'/';
 return n<2500 and incoming<=314572800 and s+incoming<=1073741824;
end $$;
create function member_fronts_private.storage_delete_allowed(p_name text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare u uuid:=auth.uid();url text;ref text;
begin
 if u is null or left(p_name,length(u::text)+1)<>u::text||'/' then return false; end if;
 perform member_fronts_private.lock_media(u);
 url:='https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/front-media/'||p_name;
 for ref in select r from public.member_fronts f cross join lateral member_fronts_private.media_refs(f.draft) r where f.auth_user_id=u
 union all select r from public.member_fronts f cross join lateral member_fronts_private.media_refs(f.published) r where f.auth_user_id=u and f.published is not null loop
  if ref=url or (right(ref,1)='/' and left(url,length(ref))=ref) then return false; end if;
 end loop;
 return true;
end $$;
create policy "front media owner listing" on storage.objects for select to authenticated
 using(bucket_id='front-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "front media owner immutable upload" on storage.objects for insert to authenticated
 with check(bucket_id='front-media' and member_fronts_private.storage_write_allowed(name,metadata));
create policy "front media owner unreferenced deletion" on storage.objects for delete to authenticated
 using(bucket_id='front-media' and member_fronts_private.storage_delete_allowed(name));
-- No UPDATE policy: use a new object name so a published snapshot is not overwritten.
-- Existing installations may have other permissive storage policies. These
-- restrictive boundaries apply only to this bucket and leave every other bucket
-- unchanged, so those policies cannot grant cross-account or overwrite access.
create policy "front media listing boundary" on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'front-media' or (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "front media insertion boundary" on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'front-media' or member_fronts_private.storage_write_allowed(name,metadata));
create policy "front media immutable boundary" on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'front-media') with check(bucket_id<>'front-media');
create policy "front media deletion boundary" on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'front-media' or member_fronts_private.storage_delete_allowed(name));

revoke all on all functions in schema member_fronts_private from public,anon,authenticated;
grant execute on function member_fronts_private.get_self(),member_fronts_private.save(jsonb,integer,boolean,boolean),member_fronts_private.unpublish(integer) to authenticated,service_role;
grant execute on function member_fronts_private.takedown(text,text) to authenticated,service_role;
grant execute on function member_fronts_private.public_page(text),member_fronts_private.directory(integer,text) to anon,authenticated,service_role;
grant execute on function member_fronts_private.storage_write_allowed(text,jsonb),member_fronts_private.storage_delete_allowed(text) to authenticated;
revoke all on function public.member_front_get_self(),public.member_front_save(jsonb,integer,boolean,boolean),public.member_front_unpublish(integer) from public,anon,authenticated;
grant execute on function public.member_front_get_self(),public.member_front_save(jsonb,integer,boolean,boolean),public.member_front_unpublish(integer) to authenticated,service_role;
revoke all on function public.member_front_takedown(text,text) from public,anon;
grant execute on function public.member_front_takedown(text,text) to authenticated,service_role;
revoke all on function public.member_front_public(text),public.member_front_directory(integer,text) from public;
grant execute on function public.member_front_public(text),public.member_front_directory(integer,text) to anon,authenticated,service_role;
comment on table public.member_fronts is 'Shared-account front pages; atomic revisions, private drafts, explicit public network-node consent. Network positions are fictional layout, never location.';
notify pgrst,'reload schema';
commit;
