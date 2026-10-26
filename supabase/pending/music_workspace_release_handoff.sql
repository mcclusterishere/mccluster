-- PENDING; no production application. Requires music_workspace + existing creator platform.
-- Private originals remain immutable; only a prepared, owner-authorized copy can
-- become a creator-owned DRAFT. No rights attestation, publication, or analysis job.
begin;
create table public.music_workspace_release_handoffs (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.music_projects(id),
 version integer not null, asset_id uuid not null references public.music_project_assets(id),
 owner_id uuid not null references auth.users(id), creator_m_uid uuid not null,
 track_id uuid not null unique default gen_random_uuid(), master_path text not null,
 title text not null, artist text not null, credits jsonb not null,
 source_sha256 text not null, mime text not null, bytes integer not null,
 transfer_authorized_at timestamptz not null default now(), completed_at timestamptz,
 unique(project_id,version,asset_id),
 foreign key(project_id,version) references public.music_project_versions(project_id,number)
);
alter table public.music_workspace_release_handoffs enable row level security;
revoke all on public.music_workspace_release_handoffs from public,anon,authenticated;
grant select on public.music_workspace_release_handoffs to authenticated;
create policy workspace_release_owner_read on public.music_workspace_release_handoffs for select to authenticated using(owner_id=auth.uid());

create function public.music_workspace_release_prepare(p_project uuid,p_version integer,p_asset uuid,p_authorized boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();p public.music_projects;a public.music_project_assets;h public.music_workspace_release_handoffs;creator record;extension text;
begin
 if actor is null or public.music_workspace_role(p_project) is distinct from 'owner' then raise exception 'owner_required'; end if;
 if p_authorized is distinct from true then raise exception 'transfer_authorization_required'; end if;
 select * into p from public.music_projects where id=p_project for update;
 if p.ready_version is distinct from p_version then raise exception 'ready_version_required'; end if;
 select * into a from public.music_project_assets where id=p_asset and project_id=p_project and ready
   and exists(select 1 from public.music_project_versions v,jsonb_array_elements(v.arrangement) item
    where v.project_id=p_project and v.number=p_version and item->>'asset_id'=p_asset::text);
 if not found or a.sha256 is null then raise exception 'ready_original_required'; end if;
 extension:=case a.mime when 'audio/wav' then 'wav' when 'audio/mpeg' then 'mp3' when 'audio/flac' then 'flac' when 'audio/mp4' then 'm4a' end;
 if extension is null then raise exception 'release_format_required'; end if;
 select c.m_uid,c.artist_name into creator from public.music_creator_profiles c join public.m_auth_user_links l on l.m_uid=c.m_uid
  where l.auth_user_id=actor and l.is_primary and c.status='active';
 if not found then raise exception 'active_creator_required'; end if;
 select * into h from public.music_workspace_release_handoffs where project_id=p_project and version=p_version and asset_id=p_asset;
 if not found then
  h.id:=gen_random_uuid();
  insert into public.music_workspace_release_handoffs(id,project_id,version,asset_id,owner_id,creator_m_uid,master_path,title,artist,credits,source_sha256,mime,bytes)
   values(h.id,p_project,p_version,p_asset,actor,creator.m_uid,actor::text||'/workspace/'||h.id::text||'.'||extension,p.title,creator.artist_name,
    (select jsonb_agg(jsonb_build_object('asset_id',s.id,'uploader_id',s.uploader_id,'filename',s.filename,'credits',s.credits,'sha256',s.sha256) order by s.id)
     from public.music_project_assets s where s.project_id=p_project and s.ready and exists(select 1 from public.music_project_versions v,jsonb_array_elements(v.arrangement) item where v.project_id=p_project and v.number=p_version and item->>'asset_id'=s.id::text)),a.sha256,a.mime,a.bytes) returning * into h;
 end if;
 return to_jsonb(h);
end $$;
revoke all on function public.music_workspace_release_prepare(uuid,integer,uuid,boolean) from public,anon;
grant execute on function public.music_workspace_release_prepare(uuid,integer,uuid,boolean) to authenticated;

create function public.music_workspace_release_finish(p_handoff uuid,p_owner uuid,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.music_workspace_release_handoffs;
begin
 select * into h from public.music_workspace_release_handoffs where id=p_handoff and owner_id=p_owner for update;
 if not found then raise exception 'handoff_unavailable'; end if;
 if h.completed_at is not null then return jsonb_build_object('track_id',h.track_id,'url','creator.html?workspace_draft='||h.track_id,'idempotent',true); end if;
 if p_sha256 is distinct from h.source_sha256 or not exists(select 1 from storage.objects where bucket_id='creator-masters' and name=h.master_path) then raise exception 'verified_copy_required'; end if;
 if not exists(select 1 from public.music_projects p where p.id=h.project_id and p.owner_id=h.owner_id and p.ready_version=h.version)
  or not exists(select 1 from public.music_creator_profiles where m_uid=h.creator_m_uid and status='active') then raise exception 'handoff_access_changed'; end if;
 insert into public.creator_tracks(id,uid,m_uid,title,artist,audio_url,public,status,access_mode,master_bucket,master_path,rights_status,rights_declaration,description)
 values(h.track_id,h.owner_id,h.creator_m_uid,h.title,h.artist,'',false,'draft','account','creator-masters',h.master_path,'incomplete',
  jsonb_build_object('workspace_handoff',jsonb_build_object('id',h.id,'project_id',h.project_id,'version',h.version,'original_asset_id',h.asset_id,'source_sha256',h.source_sha256,'credits',h.credits,'transfer_authorized_at',h.transfer_authorized_at)),
  left('Private workspace draft. Credits: '||(select string_agg(x->>'credits','; ') from jsonb_array_elements(h.credits) x),2000));
 update public.music_workspace_release_handoffs set completed_at=now() where id=h.id;
 return jsonb_build_object('track_id',h.track_id,'url','creator.html?workspace_draft='||h.track_id,'idempotent',false);
end $$;
revoke all on function public.music_workspace_release_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.music_workspace_release_finish(uuid,uuid,text) to service_role;
commit;
