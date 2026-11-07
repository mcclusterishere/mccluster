-- PENDING: review/apply only after customer_social_selfservice.sql and the
-- existing creator_action_distribution migrations. No new scheduler.
begin;
create table private.world_social_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  operation_key uuid not null,
  request jsonb not null check (octet_length(request::text)<=65536),
  org_id uuid not null references public.orgs(id),
  account_id uuid not null references public.social_accounts(id),
  post_id uuid not null references public.network_posts(id),
  content_id uuid not null references public.social_content_items(id),
  job_id uuid not null references public.social_publish_jobs(id),
  media_asset_id uuid not null references public.network_media_assets(id),
  object_path text not null,
  created_at timestamptz not null default now(),
  unique(user_id,operation_key), unique(job_id), unique(post_id)
);
alter table private.world_social_deliveries enable row level security;
revoke all on private.world_social_deliveries from public,anon,authenticated;
create index world_social_delivery_user_recent on private.world_social_deliveries(user_id,created_at desc);

-- A read model only: delivery status is the canonical queue's current state.
create function private.world_social_delivery_view(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',d.id,'user',d.user_id,'key',d.operation_key,
 'org',d.org_id,'account',d.account_id,'handle',a.handle,'worldId',d.post_id,
 'worldState',case when p.deleted_at is not null or p.removed_at is not null then 'withdrawn'
                  when p.visibility <> 'public' then 'private' else 'published' end,
 'contentId',d.content_id,'jobId',d.job_id,'state',j.state,'created_at',d.created_at,
 'action_campaign_id',c.action_campaign_id,'action_mission_id',c.action_mission_id,
 'external_media_id',j.external_media_id)
 from private.world_social_deliveries d join public.network_posts p on p.id=d.post_id
 join public.social_publish_jobs j on j.id=d.job_id
 join public.social_accounts a on a.id=d.account_id
 join public.social_content_items c on c.id=d.content_id where d.id=p_id;
$$;
revoke all on function private.world_social_delivery_view(uuid) from public,anon,authenticated;

-- Called by the authenticated Worker only. p_post has passed the same World
-- validation/moderation path as an ordinary post. SQL repeats tenant/media checks
-- under locks; insert triggers continue enforcing canonical rate limits.
create function public.world_social_delivery(p_action text,p_user uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 d private.world_social_deliveries%rowtype; j public.social_publish_jobs%rowtype;
 v_post public.network_posts%rowtype; asset public.network_media_assets%rowtype;
 v_org uuid; v_account uuid; v_key uuid; v_muid uuid; v_content uuid; v_postid uuid;
 v_mission uuid; v_campaign text; v_social_campaign uuid; v_caption text; v_url text;
 v_media jsonb; v_draft jsonb; v_poster uuid; v_handle text;
begin
 if p_user is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_action='list' then
  return jsonb_build_object('deliveries',coalesce((select jsonb_agg(private.world_social_delivery_view(x.id) order by x.created_at desc)
   from (select id,created_at from private.world_social_deliveries where user_id=p_user order by created_at desc limit 50) x),'[]'::jsonb));
 end if;
 if p_action in ('lookup','create') then
  v_key:=(p_data->>'key')::uuid;
  if v_key is null then raise exception 'Operation key required' using errcode='MN409'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||v_key::text,0));
  select * into d from private.world_social_deliveries where user_id=p_user and operation_key=v_key;
  if found then
   if d.request is distinct from p_data->'request' then raise exception 'This operation already published different content. Refresh deliveries.' using errcode='MN409'; end if;
   return jsonb_build_object('post',jsonb_build_object('id',d.post_id),'delivery',private.world_social_delivery_view(d.id),'duplicate',true);
  end if;
  if p_action='lookup' then return null; end if;
  v_org:=(p_data->'request'->'delivery'->>'org_id')::uuid;
  v_account:=(p_data->'request'->'delivery'->>'account_id')::uuid;
  if not exists(select 1 from public.org_members where org_id=v_org and profile_id=p_user and role='owner') then
   raise exception 'Organization owner required' using errcode='42501'; end if;
  -- Serialize with OAuth install/disconnect; retain selected identity even if
  -- disconnected. Submission must later prove it is a CUSTOMER connection.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text,6742));
  select handle into v_handle from public.social_accounts where id=v_account and org_id=v_org and platform='instagram';
  if not found then raise exception 'Instagram account unavailable' using errcode='MN409'; end if;
  select m_uid into v_muid from public.m_auth_user_links where auth_user_id=p_user and is_primary=true limit 1;
  if v_muid is null then raise exception 'Identity unavailable' using errcode='MN409'; end if;
  v_draft:=p_data->'post';
  if v_draft->>'visibility' is distinct from 'public' or v_draft->>'group_id' is not null
    or v_draft->>'reply_to_id' is not null or jsonb_array_length(v_draft->'media_asset_ids')<>1 then
   raise exception 'Cross-posting requires one public World video' using errcode='MN409'; end if;
  select * into asset from public.network_media_assets where id=(v_draft->'media_asset_ids'->>0)::uuid for update;
  if not found or asset.owner_m_uid<>v_muid or asset.status not in ('ready','staged') or asset.post_id is not null
   or asset.media_type<>'video' or asset.mime_type not in ('video/mp4','video/quicktime') or asset.bucket_id<>'mnet-media'
   or coalesce(asset.byte_size,0)<=0 or asset.byte_size>524288000 then
   raise exception 'Video is unavailable' using errcode='MN409'; end if;
  -- Metadata rows are owner-editable. Repeat the mnet-media edge function's
  -- canonical uploader-prefix rule before granting a signed read capability.
  if asset.object_path !~* ('^'||p_user::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,180}$')
   or not exists(select 1 from storage.objects where bucket_id='mnet-media' and name=asset.object_path
     and (metadata->>'size')::bigint between 1 and 524288000 and metadata->>'mimetype' in ('video/mp4','video/quicktime')) then
   raise exception 'Upload is incomplete or its storage binding is invalid' using errcode='MN409'; end if;
  v_poster:=(v_draft->'poster_by_media'->>asset.id::text)::uuid;
  if v_poster is not null then
   perform 1 from public.network_media_assets where id=v_poster and owner_m_uid=v_muid
    and media_type='image' and status in ('ready','staged') and post_id is null for update;
   if not found then raise exception 'Poster unavailable' using errcode='MN409'; end if;
  end if;
  v_mission:=nullif(p_data->'request'->'delivery'->>'action_mission_id','')::uuid;
  v_campaign:=nullif(p_data->'request'->'delivery'->>'action_campaign_id','');
  if v_mission is not null then
   select m.campaign_id into v_campaign from public.action_missions m join public.action_campaigns c on c.id=m.campaign_id
     where m.id=v_mission and m.status='open' and c.status='live';
   if not found then raise exception 'Choose an open mission in a live campaign' using errcode='MN409'; end if;
   if nullif(p_data->'request'->'delivery'->>'action_campaign_id','') is not null
     and p_data->'request'->'delivery'->>'action_campaign_id'<>v_campaign then
    raise exception 'Mission and campaign mismatch' using errcode='MN409'; end if;
  elsif v_campaign is not null then raise exception 'Choose a mission for Action attribution' using errcode='MN409'; end if;
  v_social_campaign:=nullif(p_data->'request'->'delivery'->>'campaign_id','')::uuid;
  if v_social_campaign is not null and not exists(select 1 from public.social_campaigns where id=v_social_campaign and org_id=v_org) then
   raise exception 'Campaign does not belong to this site' using errcode='42501'; end if;
  v_content:=gen_random_uuid(); v_postid:=gen_random_uuid();
  v_caption:=coalesce(v_draft->>'body','');
  if v_mission is not null then
   -- Action campaign ids are not needed in the URL: attribution resolves through content_id.
   v_url:='https://matthew.mccluster.org/mnet.html?view=missions&mission='||v_mission::text||'&content='||v_content::text||'&src=instagram';
   v_caption:=v_caption||E'\n\nTake action: '||v_url;
  end if;
  if char_length(v_caption)>2200 then raise exception 'Instagram caption including Action link exceeds 2200 characters' using errcode='MN413'; end if;
  insert into public.social_content_items(id,org_id,created_by,publisher_m_uid,publisher_key,master_caption,action_campaign_id,action_mission_id,status,metadata)
   values(v_content,v_org,p_user,v_muid,'member-'||p_user::text,coalesce(v_draft->>'body',''),v_campaign,v_mission,'ready',jsonb_build_object('source','world-composer'));
  v_media:=jsonb_build_array(jsonb_build_object('asset_id',asset.id,'type',asset.media_type,'mime_type',asset.mime_type,
   'width',asset.width,'height',asset.height,'duration_ms',asset.duration_ms,'alt_text',asset.alt_text,'poster_asset_id',v_poster));
  insert into public.network_posts(id,author_m_uid,body,post_type,visibility,media,metadata,reply_to_id,group_id,source_app_id,content_id)
   values(v_postid,v_muid,v_draft->>'body',v_draft->>'post_type','public',v_media,coalesce(v_draft->'metadata','{}'),null,null,
   (v_draft->>'source_app_id')::uuid,v_content) returning * into v_post;
  if v_draft->>'country_code' is not null then
   update public.network_posts set country_code=v_draft->>'country_code' where id=v_postid;
  end if;
  update public.network_media_assets set post_id=v_postid,status='attached',updated_at=now() where id=asset.id or id=v_poster;
  insert into public.social_publish_jobs(org_id,account_id,campaign_id,content_id,publish_mode,state,dedupe_key,payload)
   values(v_org,v_account,v_social_campaign,v_content,'reel','draft','world-social:'||p_user::text||':'||v_key::text,
   jsonb_build_object('source','customer-social','world_delivery',true,'publish_to_action_network',false,'caption',v_caption,'master_caption',v_draft->>'body',
   'action_url',v_url,'action_campaign_id',v_campaign,'action_mission_id',v_mission)) returning * into j;
  insert into private.world_social_deliveries(user_id,operation_key,request,org_id,account_id,post_id,content_id,job_id,media_asset_id,object_path)
   values(p_user,v_key,p_data->'request',v_org,v_account,v_postid,v_content,j.id,asset.id,asset.object_path) returning * into d;
  return jsonb_build_object('post',to_jsonb(v_post),'delivery',private.world_social_delivery_view(d.id));
 end if;
 select * into d from private.world_social_deliveries where id=(p_data->>'id')::uuid and user_id=p_user;
 if not found then raise exception 'Delivery not found' using errcode='42501'; end if;
 if p_action='get' then return private.world_social_delivery_view(d.id); end if;
 if p_action='submit' then
  perform pg_advisory_xact_lock(hashtextextended(d.org_id::text,6742));
  if not exists(select 1 from public.org_members where org_id=d.org_id and profile_id=p_user and role='owner') then
   raise exception 'Organization owner required' using errcode='42501'; end if;
  if not exists(select 1 from private.customer_social_connections c where c.org_id=d.org_id and c.account_id=d.account_id
   and (c.expires_at is null or c.expires_at>now())) then raise exception 'Reconnect the original Instagram account' using errcode='MN409'; end if;
  if not private.customer_social_paid(d.org_id) then raise exception 'Active site plan required' using errcode='42501'; end if;
  select * into j from public.social_publish_jobs where id=d.job_id for update;
  -- Replays return the one existing job. Failed jobs use the canonical retry route.
  if j.state='draft' then
   update public.social_publish_jobs set state='queued',scheduled_at=now(),updated_at=now() where id=j.id returning * into j;
   update public.social_content_items set status='publishing',updated_at=now() where id=d.content_id;
  end if;
  return to_jsonb(j);
 end if;
 raise exception 'Unknown delivery action';
end;
$$;
revoke all on function public.world_social_delivery(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.world_social_delivery(text,uuid,jsonb) to service_role;

-- Queue authority: only registered first-party media belonging to this exact
-- job/content/tenant can be signed. Rechecked before container creation AND publish.
create function public.world_social_video(p_job uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.world_social_deliveries%rowtype; v_path text;
begin
 select * into d from private.world_social_deliveries where job_id=p_job;
 if not found then raise exception 'Registered World delivery required' using errcode='42501'; end if;
 select a.object_path into v_path from public.network_media_assets a
 join public.network_posts p on p.id=d.post_id
 join public.social_publish_jobs j on j.id=d.job_id
 join public.m_auth_user_links l on l.auth_user_id=d.user_id and l.is_primary and l.m_uid=p.author_m_uid
 join private.customer_social_connections c on c.org_id=d.org_id and c.account_id=d.account_id
 where a.id=d.media_asset_id and a.owner_m_uid=p.author_m_uid and a.post_id=p.id and a.status='attached'
 and a.bucket_id='mnet-media' and a.object_path=d.object_path
 and split_part(d.object_path,'/',1)=d.user_id::text
 and exists(select 1 from storage.objects where bucket_id='mnet-media' and name=d.object_path
   and (metadata->>'size')::bigint between 1 and 524288000 and metadata->>'mimetype' in ('video/mp4','video/quicktime'))
 and p.visibility='public' and p.deleted_at is null and p.removed_at is null
 and p.media @> jsonb_build_array(jsonb_build_object('asset_id',a.id))
 and p.content_id=d.content_id and j.content_id=d.content_id and j.account_id=d.account_id and j.org_id=d.org_id
 and exists(select 1 from public.org_members where org_id=d.org_id and profile_id=d.user_id and role='owner')
 and (c.expires_at is null or c.expires_at>now()) and private.customer_social_paid(d.org_id);
 if v_path is null then raise exception 'World post or original customer connection unavailable' using errcode='42501'; end if;
 return jsonb_build_object('bucket','mnet-media','object_path',v_path);
end;
$$;
revoke all on function public.world_social_video(uuid) from public,anon,authenticated;
grant execute on function public.world_social_video(uuid) to service_role;
-- An org member cannot repoint a durable job via the legacy Data API.
create function private.world_social_job_identity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.world_social_deliveries where job_id=old.id)
   and (new.org_id is distinct from old.org_id or new.account_id is distinct from old.account_id
     or new.content_id is distinct from old.content_id or new.payload is distinct from old.payload
     or new.campaign_id is distinct from old.campaign_id or new.dedupe_key is distinct from old.dedupe_key) then
  raise exception 'World delivery identity is immutable' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function private.world_social_job_identity_guard() from public,anon,authenticated;
create trigger world_social_job_identity_guard before update on public.social_publish_jobs
 for each row execute function private.world_social_job_identity_guard();
commit;
