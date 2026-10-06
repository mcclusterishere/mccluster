-- Equity Uprise clipping campaigns: generalize the proven music clipping engine
-- into a content-distribution marketplace without changing its money ledger.
--
-- Music remains a first-class source. Action Network content can now be the
-- source as well. Attribution requirements are machine-readable; Instagram
-- collab acceptance is deliberately review-required until the platform read
-- path can prove collaborator state.

alter table public.action_clip_campaigns
  add column if not exists source_kind text not null default 'music',
  add column if not exists source_content_id uuid references public.social_content_items(id) on delete restrict,
  add column if not exists destination_url text,
  add column if not exists attribution_handles text[] not null default '{}',
  add column if not exists collaborator_handles text[] not null default '{}',
  add column if not exists collaboration_mode text not null default 'none',
  add column if not exists operator_brand text not null default 'Equity Uprise';

alter table public.action_clip_campaigns drop constraint if exists action_clip_campaigns_source_kind_check;
alter table public.action_clip_campaigns add constraint action_clip_campaigns_source_kind_check
  check (source_kind in ('music','action','network_post','campaign_media'));
alter table public.action_clip_campaigns drop constraint if exists action_clip_campaigns_collaboration_mode_check;
alter table public.action_clip_campaigns add constraint action_clip_campaigns_collaboration_mode_check
  check (collaboration_mode in ('none','request','required_review'));
alter table public.action_clip_campaigns drop constraint if exists action_clip_campaigns_destination_url_check;
alter table public.action_clip_campaigns add constraint action_clip_campaigns_destination_url_check
  check (destination_url is null or (destination_url ~* '^https://' and char_length(destination_url) <= 2000));
alter table public.action_clip_campaigns drop constraint if exists action_clip_campaigns_attribution_handles_check;
alter table public.action_clip_campaigns add constraint action_clip_campaigns_attribution_handles_check
  check (cardinality(attribution_handles) <= 12);
alter table public.action_clip_campaigns drop constraint if exists action_clip_campaigns_collaborator_handles_check;
alter table public.action_clip_campaigns add constraint action_clip_campaigns_collaborator_handles_check
  check (cardinality(collaborator_handles) <= 6);

-- v1's anonymous source check required a song. Replace only the check whose
-- expression is exactly about music_object_id/creator_track_id.
do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.action_clip_campaigns'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%music_object_id%creator_track_id%'
  loop
    execute format('alter table public.action_clip_campaigns drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.action_clip_campaigns drop constraint if exists action_clip_campaigns_source_required_check;
alter table public.action_clip_campaigns add constraint action_clip_campaigns_source_required_check
  check (
    (source_kind = 'music' and (music_object_id is not null or creator_track_id is not null))
    or
    (source_kind <> 'music' and source_content_id is not null and destination_url is not null)
  );

-- Existing campaigns are music campaigns. Preserve their destination.
update public.action_clip_campaigns c
   set source_kind = 'music',
       destination_url = coalesce(destination_url, private.clip_song_url(c.music_object_id, c.creator_track_id)),
       operator_brand = 'Equity Uprise'
 where source_kind = 'music';

-- Add the Equity Uprise distribution brief to any campaign. Before launch the
-- owner can change it freely. After launch attribution/collab requirements are
-- frozen because clippers relied on them; only operator branding/destination
-- may be clarified without changing economics.
create or replace function public.clip_campaign_set_distribution(p_mission uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.action_clip_campaigns%rowtype := private.clip_require_owner(p_mission);
  v_attr text[];
  v_collab text[];
  v_mode text;
  v_dest text;
  v_brand text;
begin
  select * into v from public.action_clip_campaigns where mission_id = p_mission for update;
  v_attr := case when p ? 'attribution_handles'
    then array(select left(lower(btrim(x)), 64) from jsonb_array_elements_text(coalesce(p->'attribution_handles','[]'::jsonb)) x where btrim(x) <> '')
    else v.attribution_handles end;
  v_collab := case when p ? 'collaborator_handles'
    then array(select left(lower(btrim(x)), 64) from jsonb_array_elements_text(coalesce(p->'collaborator_handles','[]'::jsonb)) x where btrim(x) <> '')
    else v.collaborator_handles end;
  v_mode := coalesce(nullif(p->>'collaboration_mode',''), v.collaboration_mode);
  v_dest := case when p ? 'destination_url' then nullif(btrim(p->>'destination_url'),'') else v.destination_url end;
  v_brand := case when p ? 'operator_brand' then left(btrim(coalesce(p->>'operator_brand','')),80) else v.operator_brand end;
  if v.status <> 'draft' and (
       v_attr is distinct from v.attribution_handles
       or v_collab is distinct from v.collaborator_handles
       or v_mode is distinct from v.collaboration_mode
     ) then
    raise exception 'after launch attribution and collaboration requirements are frozen';
  end if;
  update public.action_clip_campaigns
     set attribution_handles=v_attr, collaborator_handles=v_collab,
         collaboration_mode=v_mode, destination_url=v_dest,
         operator_brand=coalesce(nullif(v_brand,''),'Equity Uprise'), updated_at=now()
   where mission_id=p_mission;
  perform private.clip_audit(v.org_id,'clip.campaign.distribution_updated','clip_campaign',p_mission::text,p);
  return jsonb_build_object('mission_id',p_mission,'updated',true);
end;
$$;
revoke all on function public.clip_campaign_set_distribution(uuid,jsonb) from public, anon;
grant execute on function public.clip_campaign_set_distribution(uuid,jsonb) to authenticated, service_role;

-- Create a clipping campaign from an existing Action Network content item.
-- The source must belong to the campaign org. The existing settlement, claims,
-- submissions, metrics, holds, funding and payout tables remain canonical.
create or replace function public.clip_campaign_create_from_action(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_muid uuid := public.current_m_uid();
  v_org uuid := nullif(p->>'org_id','')::uuid;
  v_source uuid := nullif(p->>'source_content_id','')::uuid;
  v_title text := btrim(coalesce(p->>'title',''));
  v_dest text := nullif(btrim(coalesce(p->>'destination_url','')),'');
  v_starts timestamptz := coalesce(nullif(p->>'starts_at','')::timestamptz,now());
  v_ends timestamptz := nullif(p->>'ends_at','')::timestamptz;
  v_mission uuid;
  v_asset jsonb;
  v_owner uuid;
  v_type text;
  v_sort int := 0;
  v_source_kind text := coalesce(nullif(p->>'source_kind',''),'action');
begin
  if v_user is null or v_muid is null then raise exception 'sign in with your M account to create a campaign'; end if;
  if v_org is null or not private.is_org_owner(v_org) then raise exception 'not authorized for this organization'; end if;
  if v_source_kind not in ('action','network_post','campaign_media') then raise exception 'invalid Action Network source kind'; end if;
  if char_length(v_title) not between 1 and 160 then raise exception 'a campaign needs a title of 1 to 160 characters'; end if;
  if v_dest is null or v_dest !~* '^https://' then raise exception 'an Action Network clipping campaign needs an https destination'; end if;
  if v_ends is not null and v_ends <= v_starts then raise exception 'the campaign must end after it starts'; end if;
  if not exists(select 1 from public.social_content_items s where s.id=v_source and s.org_id=v_org) then
    raise exception 'source content must belong to this organization';
  end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p->'platforms','[]'::jsonb)) x where not private.clip_platform_enabled(lower(x))) then
    raise exception 'only Instagram clips can be verified today; YouTube and TikTok are not connected yet';
  end if;

  insert into public.action_missions(title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,status,starts_at,ends_at,kind)
  values(v_title,left(coalesce(p->>'description',''),4000),'action',1,10,false,'automatic',array['media'],'draft',v_starts,v_ends,'clip')
  returning id into v_mission;

  insert into public.action_clip_campaigns(
    mission_id,org_id,creator_m_uid,content_id,source_kind,source_content_id,destination_url,
    platforms,rules,required_tags,attribution_handles,collaborator_handles,collaboration_mode,operator_brand,
    budget_cents,base_cpm_cents,min_views,per_clip_cap_cents,per_clipper_cap_cents,max_payable_views_per_clip,
    max_clips_per_clipper,earning_window_days,keep_live_days,hold_days,bonus_account_cents,bonus_listen_cents,
    approval_mode,created_by)
  values(
    v_mission,v_org,v_muid,v_source,v_source_kind,v_source,v_dest,
    coalesce(array(select lower(x) from jsonb_array_elements_text(coalesce(p->'platforms','[]'::jsonb)) x),'{}'),
    left(coalesce(p->>'rules',''),4000),
    coalesce(array(select left(lower(btrim(x)),64) from jsonb_array_elements_text(coalesce(p->'required_tags','[]'::jsonb)) x where btrim(x)<>''),'{}'),
    coalesce(array(select left(lower(btrim(x)),64) from jsonb_array_elements_text(coalesce(p->'attribution_handles','[]'::jsonb)) x where btrim(x)<>''),'{}'),
    coalesce(array(select left(lower(btrim(x)),64) from jsonb_array_elements_text(coalesce(p->'collaborator_handles','[]'::jsonb)) x where btrim(x)<>''),'{}'),
    coalesce(nullif(p->>'collaboration_mode',''),'none'),
    coalesce(nullif(left(btrim(coalesce(p->>'operator_brand','')),80),''),'Equity Uprise'),
    (p->>'budget_cents')::bigint,(p->>'base_cpm_cents')::integer,coalesce((p->>'min_views')::integer,1000),
    nullif(p->>'per_clip_cap_cents','')::integer,nullif(p->>'per_clipper_cap_cents','')::integer,
    nullif(p->>'max_payable_views_per_clip','')::bigint,coalesce((p->>'max_clips_per_clipper')::integer,10),
    coalesce((p->>'earning_window_days')::integer,30),coalesce((p->>'keep_live_days')::integer,14),
    coalesce((p->>'hold_days')::integer,7),coalesce((p->>'bonus_account_cents')::integer,0),
    0,coalesce(nullif(p->>'approval_mode',''),'creator'),v_user);

  for v_asset in select * from jsonb_array_elements(coalesce(p->'assets','[]'::jsonb)) loop
    v_type := coalesce(v_asset->>'kind','');
    if v_type <> 'moment' then
      select a.owner_m_uid into v_owner from public.network_media_assets a
       where a.id=nullif(v_asset->>'asset_id','')::uuid and a.status='ready';
      if v_owner is distinct from v_muid then raise exception 'source assets must be your own ready uploads'; end if;
    end if;
    insert into public.action_clip_assets(mission_id,kind,label,network_media_asset_id,start_ms,end_ms,sort)
    values(v_mission,v_type,left(btrim(coalesce(v_asset->>'label','')),120),
      case when v_type='moment' then null else nullif(v_asset->>'asset_id','')::uuid end,
      nullif(v_asset->>'start_ms','')::integer,nullif(v_asset->>'end_ms','')::integer,v_sort);
    v_sort:=v_sort+1;
  end loop;

  perform private.clip_audit(v_org,'clip.campaign.created_from_action','clip_campaign',v_mission::text,
    jsonb_build_object('source_content_id',v_source,'source_kind',v_source_kind,'operator_brand','Equity Uprise'));
  return jsonb_build_object('mission_id',v_mission,'content_id',v_source,'status','draft');
end;
$$;
revoke all on function public.clip_campaign_create_from_action(jsonb) from public, anon;
grant execute on function public.clip_campaign_create_from_action(jsonb) to authenticated, service_role;

-- Public discovery now exposes the distribution brief and supports non-music
-- sources. p_song remains for backward-compatible music deep links.
create or replace function public.clip_campaigns_open(p_song text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'launched_at' desc),'[]'::jsonb)
  from (
    select jsonb_strip_nulls(jsonb_build_object(
      'mission_id',c.mission_id,'title',m.title,'description',m.description,'status',c.status,
      'source_kind',c.source_kind,'destination_url',c.destination_url,'operator_brand',c.operator_brand,
      'attribution_handles',to_jsonb(c.attribution_handles),'collaborator_handles',to_jsonb(c.collaborator_handles),
      'collaboration_mode',c.collaboration_mode,
      'platforms',to_jsonb(c.platforms),'rules',c.rules,'required_tags',to_jsonb(c.required_tags),
      'base_cpm_cents',c.base_cpm_cents,'min_views',c.min_views,'per_clip_cap_cents',c.per_clip_cap_cents,
      'per_clipper_cap_cents',c.per_clipper_cap_cents,'max_payable_views_per_clip',c.max_payable_views_per_clip,
      'max_clips_per_clipper',c.max_clips_per_clipper,'earning_window_days',c.earning_window_days,
      'keep_live_days',c.keep_live_days,'hold_days',c.hold_days,'bonus_account_cents',c.bonus_account_cents,
      'bonus_listen_cents',c.bonus_listen_cents,'approval_mode',c.approval_mode,
      'starts_at',m.starts_at,'ends_at',m.ends_at,'launched_at',c.launched_at,
      'song',case when o.id is not null then jsonb_build_object('id',o.id,'key',o.catalog_key,'title',o.track_title,'artist',o.artist_name,'url',o.canonical_url,'artwork',o.artwork_path) end,
      'track',case when t.id is not null then jsonb_build_object('id',t.id,'title',t.title,'artist',t.artist,'url',private.clip_song_url(null,t.id)) end,
      'creator',(select jsonb_build_object('handle',cp.handle,'artist_name',cp.artist_name) from public.music_creator_profiles cp where cp.m_uid=c.creator_m_uid),
      'budget_left_cents',(select available_cents from private.clip_money(c.mission_id)),
      'clippers',(select count(*) from public.action_clip_claims k where k.mission_id=c.mission_id and k.status='active'),
      'moments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'start_ms',a.start_ms,'end_ms',a.end_ms) order by a.sort),'[]'::jsonb)
        from public.action_clip_assets a where a.mission_id=c.mission_id and a.kind='moment')
    )) x
    from public.action_clip_campaigns c
    join public.action_missions m on m.id=c.mission_id
    left join public.music_catalog_objects o on o.id=c.music_object_id
    left join public.creator_tracks t on t.id=c.creator_track_id
    where c.status='live' and m.status='open'
      and (m.starts_at is null or m.starts_at<=now()) and (m.ends_at is null or m.ends_at>now())
      and (p_song is null or (c.source_kind='music' and (o.catalog_key=p_song or o.id::text=p_song)))
  ) s
$$;

comment on function public.clip_campaign_create_from_action(jsonb) is
  'Creates an Equity Uprise clipping campaign from approved Action Network content while reusing the canonical clipping settlement ledger.';
