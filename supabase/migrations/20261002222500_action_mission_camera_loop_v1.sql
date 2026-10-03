-- ACTION MISSION CAMERA LOOP V1
-- Camera-first mission proof, proof-media feed sharing, and the first
-- dedicated End Racism meme mission. Staged here until production rehearsal
-- and apply assign the canonical migration version.
--
-- This changes no reward semantics: proof is still reviewed before points or
-- a verified feed card exist. Poster images are presentation metadata only.

insert into public.action_missions
  (id,campaign_id,title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,status)
values
  ('6ec6b7a5-5290-4ba1-9f05-8f3a82e1cc04','end-racism-002',
   'Freestyle Containment Protocol',
   'Stage the intervention with willing friends. Level 1: talk him down before the first bar. Level 2: contain the verse before Verse Two. Level 3: counter-freestyle about why nobody needed another white-boy freestyle at the function. Do not secretly record or humiliate anyone. Level 4 is not authorized.',
   'creative',1,100,true,'review',array['creative','community'],'open')
on conflict (id) do update
set campaign_id=excluded.campaign_id,title=excluded.title,description=excluded.description,
    domain=excluded.domain,difficulty=excluded.difficulty,base_points=excluded.base_points,
    proof_required=excluded.proof_required,verification_mode=excluded.verification_mode,
    skills=excluded.skills,status=excluded.status;

create or replace function public.submit_action_proof(
 p_assignment_id uuid,
 p_proof_type text,
 p_proof_url text default null,
 p_statement text default '',
 p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_assignment public.action_mission_assignments%rowtype;
 v_mission public.action_missions%rowtype;
 v_existing public.action_proofs%rowtype;
 v_url text := nullif(btrim(coalesce(p_proof_url, '')), '');
 v_statement text := btrim(coalesce(p_statement, ''));
 v_meta jsonb := '{}'::jsonb;
 v_media_type text;
 v_poster_type text;
 v_proof_id uuid;
begin
 if v_user is null then raise exception 'sign in to submit proof'; end if;
 if p_proof_type not in ('video','photo','link','text','artifact') then raise exception 'unknown proof type'; end if;
 if v_url is not null and (v_url !~* '^https://' or char_length(v_url) > 2000) then raise exception 'proof links must be https'; end if;
 if char_length(v_statement) > 4000 then raise exception 'keep the statement under 4,000 characters'; end if;
 if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or pg_column_size(p_metadata) > 4096 then raise exception 'invalid proof details'; end if;

 if p_metadata ? 'asset_id' then
   if (p_metadata->>'asset_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid upload'; end if;
   select a.media_type into v_media_type
   from public.network_media_assets a
   where a.id=(p_metadata->>'asset_id')::uuid
     and a.owner_m_uid=public.current_m_uid()
     and a.status in ('ready','staged');
   if v_media_type is null then raise exception 'that upload is not yours or is not ready'; end if;
   v_meta:=jsonb_build_object('asset_id',p_metadata->>'asset_id','media_type',v_media_type);
 end if;

 if p_metadata ? 'poster_asset_id' then
   if not (v_meta ? 'asset_id') or v_media_type <> 'video' then raise exception 'a poster belongs to a video proof'; end if;
   if (p_metadata->>'poster_asset_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid poster'; end if;
   if p_metadata->>'poster_asset_id'=p_metadata->>'asset_id' then raise exception 'poster must be a separate image'; end if;
   select a.media_type into v_poster_type
   from public.network_media_assets a
   where a.id=(p_metadata->>'poster_asset_id')::uuid
     and a.owner_m_uid=public.current_m_uid()
     and a.status in ('ready','staged');
   if v_poster_type <> 'image' then raise exception 'poster must be your ready image'; end if;
   v_meta:=v_meta||jsonb_build_object('poster_asset_id',p_metadata->>'poster_asset_id');
 end if;

 if v_url is null and v_meta='{}'::jsonb and char_length(v_statement)<20 then
   raise exception 'add an upload or a link, or describe what you did in at least 20 characters';
 end if;

 select * into v_assignment from public.action_mission_assignments where id=p_assignment_id for update;
 if not found or v_assignment.user_id<>v_user then raise exception 'assignment not found'; end if;
 if v_assignment.status not in ('joined','in_progress','submitted') then raise exception 'this mission is not taking proof'; end if;
 select * into v_mission from public.action_missions where id=v_assignment.mission_id;
 if v_mission.status not in ('open','paused') then raise exception 'this mission is closed'; end if;

 if v_url is not null and exists (
   select 1 from public.action_proofs p
   where lower(p.proof_url)=lower(v_url) and p.status<>'rejected' and p.assignment_id<>v_assignment.id
 ) then raise exception 'that proof has already been used for another mission'; end if;

 if v_meta ? 'asset_id' and exists (
   select 1 from public.action_proofs p
   where p.metadata->>'asset_id'=v_meta->>'asset_id' and p.status<>'rejected' and p.assignment_id<>v_assignment.id
 ) then raise exception 'that upload has already been used for another mission'; end if;

 select * into v_existing from public.action_proofs where assignment_id=v_assignment.id for update;
 if found then
   if not (v_existing.status='pending' or (v_existing.status='rejected' and v_existing.reviewed_at is null)) then
     raise exception 'this proof has already been reviewed';
   end if;
   update public.action_proofs
   set proof_type=p_proof_type,proof_url=v_url,statement=v_statement,metadata=v_meta,
       status='pending',review_note=null,created_at=now()
   where id=v_existing.id;
   v_proof_id:=v_existing.id;
 else
   insert into public.action_proofs(assignment_id,user_id,proof_type,proof_url,statement,metadata,status)
   values(v_assignment.id,v_user,p_proof_type,v_url,v_statement,v_meta,'pending')
   returning id into v_proof_id;
 end if;

 update public.action_mission_assignments set status='submitted',submitted_at=now() where id=v_assignment.id;
 return jsonb_build_object('proof_id',v_proof_id,'assignment_id',v_assignment.id,'status','submitted');
end;
$$;
revoke all on function public.submit_action_proof(uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.submit_action_proof(uuid,text,text,text,jsonb) to authenticated,service_role;

create or replace function public.action_share_assignment_internal(p_assignment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.action_mission_assignments%rowtype;
  v_title text;
  v_m_uid uuid;
  v_app uuid;
  v_post uuid;
  v_proof public.action_proofs%rowtype;
  v_asset public.network_media_assets%rowtype;
  v_poster public.network_media_assets%rowtype;
  v_media jsonb := '[]'::jsonb;
  v_meta jsonb;
begin
  select post_id into v_post from public.action_feed_shares where assignment_id=p_assignment_id;
  if v_post is not null then return v_post; end if;

  select * into v_a from public.action_mission_assignments where id=p_assignment_id;
  if not found or v_a.status<>'verified' then raise exception 'only a verified action can be shared'; end if;
  select title into v_title from public.action_missions where id=v_a.mission_id;
  v_m_uid:=coalesce(v_a.m_uid,(select m_uid from public.m_auth_user_links where auth_user_id=v_a.user_id order by is_primary desc limit 1));
  if v_m_uid is null then raise exception 'your Action identity is not ready yet'; end if;

  select * into v_proof from public.action_proofs where assignment_id=v_a.id and status='verified' limit 1;
  if found and v_proof.metadata ? 'asset_id' then
    select * into v_asset from public.network_media_assets
      where id=(v_proof.metadata->>'asset_id')::uuid and owner_m_uid=v_m_uid limit 1;
    if found then
      if v_proof.metadata ? 'poster_asset_id' then
        select * into v_poster from public.network_media_assets
          where id=(v_proof.metadata->>'poster_asset_id')::uuid and owner_m_uid=v_m_uid and media_type='image' limit 1;
      end if;
      v_media:=jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'asset_id',v_asset.id,'type',v_asset.media_type,'mime_type',v_asset.mime_type,
        'width',v_asset.width,'height',v_asset.height,'duration_ms',v_asset.duration_ms,
        'alt_text',coalesce(v_asset.alt_text,''),
        'poster_asset_id',case when v_poster.id is not null then v_poster.id else null end
      )));
    end if;
  end if;

  select id into v_app from public.platform_apps where app_key='mccluster-web' and enabled=true limit 1;
  v_meta:=jsonb_build_object('action',jsonb_build_object('assignment_id',v_a.id,'mission_id',v_a.mission_id));
  insert into public.network_posts(author_m_uid,body,post_type,visibility,media,metadata,source_app_id)
  values(v_m_uid,'I did something about it: '||coalesce(v_title,'a mission')||'.','share','public',v_media,v_meta,v_app)
  returning id into v_post;

  if v_asset.id is not null then
    update public.network_media_assets set post_id=v_post,status='attached',updated_at=now()
      where id=v_asset.id and owner_m_uid=v_m_uid and post_id is null;
  end if;
  if v_poster.id is not null then
    update public.network_media_assets set post_id=v_post,status='attached',updated_at=now()
      where id=v_poster.id and owner_m_uid=v_m_uid and post_id is null;
  end if;

  insert into public.action_feed_shares(assignment_id,post_id,m_uid)
  values(v_a.id,v_post,v_m_uid);
  return v_post;
end;
$$;
revoke all on function public.action_share_assignment_internal(uuid) from public,anon,authenticated;

