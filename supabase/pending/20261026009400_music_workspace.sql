-- Pending deployment. Private collaboration; never publishes creator_tracks.
create table public.music_projects(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),title text not null check(length(trim(title)) between 1 and 120),ready_version integer,created_at timestamptz not null default now());
create table public.music_project_members(project_id uuid references public.music_projects(id),user_id uuid references auth.users(id),role text not null check(role in ('editor','listener')),status text not null default 'invited' check(status in ('invited','accepted','declined','removed')),primary key(project_id,user_id));
create table public.music_project_assets(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.music_projects(id),uploader_id uuid not null references auth.users(id),filename text not null,credits text not null check(length(trim(credits)) between 1 and 1000),mime text not null check(mime in ('audio/wav','audio/mpeg','audio/flac','audio/ogg','audio/mp4','audio/webm')),bytes integer not null check(bytes between 1 and 26214400),sha256 text,ready boolean not null default false,created_at timestamptz not null default now());
create table public.music_project_versions(project_id uuid references public.music_projects(id),number integer not null,author_id uuid not null references auth.users(id),note text not null,arrangement jsonb not null,created_at timestamptz not null default now(),primary key(project_id,number));
create table public.music_project_comments(id uuid primary key default gen_random_uuid(),project_id uuid not null references public.music_projects(id),author_id uuid not null references auth.users(id),body text not null check(length(trim(body)) between 1 and 2000),created_at timestamptz not null default now());

create or replace function public.music_workspace_role(p_project uuid) returns text language sql stable security definer set search_path=public,pg_temp as $$
 select case when p.owner_id=auth.uid() then 'owner' else m.role end from public.music_projects p left join public.music_project_members m on m.project_id=p.id and m.user_id=auth.uid() and m.status='accepted'
 where p.id=p_project and exists(select 1 from public.music_creator_profiles c join public.m_auth_user_links l on l.m_uid=c.m_uid where l.auth_user_id=auth.uid() and c.status='active')
$$;
revoke all on function public.music_workspace_role(uuid) from public,anon;
grant execute on function public.music_workspace_role(uuid) to authenticated;
alter table public.music_projects enable row level security;
alter table public.music_project_members enable row level security;
alter table public.music_project_assets enable row level security;
alter table public.music_project_versions enable row level security;
alter table public.music_project_comments enable row level security;
revoke all on public.music_projects,public.music_project_members,public.music_project_assets,public.music_project_versions,public.music_project_comments from public,anon,authenticated;
grant select on public.music_projects,public.music_project_members,public.music_project_assets,public.music_project_versions,public.music_project_comments to authenticated;
create policy music_project_read on public.music_projects for select to authenticated using(public.music_workspace_role(id) is not null);
create policy music_project_member_read on public.music_project_members for select to authenticated using(public.music_workspace_role(project_id) is not null or user_id=auth.uid());
create policy music_project_asset_read on public.music_project_assets for select to authenticated using(public.music_workspace_role(project_id) is not null);
create policy music_project_version_read on public.music_project_versions for select to authenticated using(public.music_workspace_role(project_id) is not null);
create policy music_project_comment_read on public.music_project_comments for select to authenticated using(public.music_workspace_role(project_id) is not null);

create or replace function public.music_workspace_action(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();project uuid;role_name text;target uuid;asset public.music_project_assets;current_version integer;item jsonb;result jsonb;
begin
 if actor is null then raise exception 'sign_in_required'; end if;
 if not exists(select 1 from public.music_creator_profiles c join public.m_auth_user_links l on l.m_uid=c.m_uid where l.auth_user_id=actor and c.status='active') then raise exception 'active_creator_required'; end if;
 if p_action='list' then
  return jsonb_build_object('projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'role',public.music_workspace_role(p.id),'ready_version',p.ready_version)) from public.music_projects p where public.music_workspace_role(p.id) is not null),'[]'), 'invitations',coalesce((select jsonb_agg(jsonb_build_object('project_id',m.project_id,'title',p.title,'role',m.role)) from public.music_project_members m join public.music_projects p on p.id=m.project_id where m.user_id=actor and m.status='invited'),'[]'));
 end if;
 if p_action='create' then
  perform pg_advisory_xact_lock(hashtextextended(actor::text,94));
  if (select count(*) from public.music_projects where owner_id=actor)>=20 then raise exception 'project_limit_reuse_existing'; end if;
  insert into public.music_projects(owner_id,title) values(actor,trim(p_data->>'title')) returning id into project;
  return jsonb_build_object('id',project);
 end if;
 project:=(p_data->>'project_id')::uuid;
 if p_action='respond' then
  if (p_data->>'accept')::boolean is null then raise exception 'response_required'; end if;
  update public.music_project_members set status=case when (p_data->>'accept')::boolean then 'accepted' else 'declined' end where project_id=project and user_id=actor and status='invited';
  if not found then raise exception 'invitation_unavailable'; end if;
  return jsonb_build_object('ok',true);
 end if;
 role_name:=public.music_workspace_role(project);
 if role_name is null then raise exception 'project_access_denied'; end if;
 if p_action='get' then
  return jsonb_build_object('project',(select to_jsonb(p) from public.music_projects p where id=project),'role',role_name,
   'members',coalesce((select jsonb_agg(to_jsonb(m)) from public.music_project_members m where project_id=project),'[]'),
   'assets',coalesce((select jsonb_agg(to_jsonb(a) order by created_at) from public.music_project_assets a where project_id=project),'[]'),
   'versions',coalesce((select jsonb_agg(to_jsonb(v) order by number desc) from public.music_project_versions v where project_id=project),'[]'),
   'comments',coalesce((select jsonb_agg(to_jsonb(c) order by created_at) from public.music_project_comments c where project_id=project),'[]'));
 end if;
 if p_action='asset_read' then
  select * into asset from public.music_project_assets where id=(p_data->>'asset_id')::uuid and project_id=project and ready;
  if not found then raise exception 'file_unavailable'; end if;
  return to_jsonb(asset);
 end if;
 if p_action='comment' then
  insert into public.music_project_comments(project_id,author_id,body) values(project,actor,trim(p_data->>'body'));
  return jsonb_build_object('ok',true);
 end if;
 if p_action in ('invite','remove','ready') then
  if role_name<>'owner' then raise exception 'owner_required'; end if;
  if p_action='ready' then
   if not exists(select 1 from public.music_project_versions where project_id=project and number=(p_data->>'version')::integer) then raise exception 'version_unavailable'; end if;
   update public.music_projects set ready_version=(p_data->>'version')::integer where id=project;
  elsif p_action='remove' then
   update public.music_project_members set status='removed' where project_id=project and user_id=(p_data->>'user_id')::uuid;
  else
   select l.auth_user_id into target from public.music_creator_profiles c join public.m_auth_user_links l on l.m_uid=c.m_uid and l.is_primary where c.handle=lower(trim(p_data->>'handle')) and c.status='active';
   if target is null or target=actor then raise exception 'existing_collaborator_required'; end if;
   insert into public.music_project_members(project_id,user_id,role) values(project,target,p_data->>'role') on conflict(project_id,user_id) do update set role=excluded.role,status='invited';
  end if;
  return jsonb_build_object('ok',true);
 end if;
 if role_name not in ('owner','editor') then raise exception 'editor_required'; end if;
 if p_action='reserve_asset' then
  -- Count pending reservations as well as completed originals under one lock.
  perform 1 from public.music_projects where id=project for update;
  if coalesce(public.music_workspace_role(project),'') not in ('owner','editor') then raise exception 'editor_required'; end if;
  if (select count(*) from public.music_project_assets where project_id=project)>=100 then raise exception 'asset_limit_use_existing_originals'; end if;
  if (select coalesce(sum(bytes),0) from public.music_project_assets where project_id=project)+coalesce((p_data->>'bytes')::bigint,0)>1073741824 then raise exception 'project_storage_limit'; end if;
  if length(p_data->>'filename') not between 1 and 200 then raise exception 'filename_required'; end if;
  insert into public.music_project_assets(project_id,uploader_id,filename,credits,mime,bytes) values(project,actor,p_data->>'filename',trim(p_data->>'credits'),p_data->>'mime',(p_data->>'bytes')::integer) returning * into asset;
  return to_jsonb(asset);
 end if;
 if p_action='asset_upload' then
  select * into asset from public.music_project_assets where id=(p_data->>'asset_id')::uuid and project_id=project and uploader_id=actor and not ready;
  if not found then raise exception 'original_is_immutable'; end if;
  return to_jsonb(asset);
 end if;
 if p_action='finish_asset' then
  -- Storage writes are insert-only. The checksum is supplied by the Worker
  -- after reading the uploaded original, but cannot authorize public release.
  if p_data->>'sha256' is null or p_data->>'sha256' !~ '^[0-9a-f]{64}$' then raise exception 'checksum_required'; end if;
  update public.music_project_assets set ready=true,sha256=p_data->>'sha256' where id=(p_data->>'asset_id')::uuid and project_id=project and uploader_id=actor and not ready
   and exists(select 1 from storage.objects where bucket_id='music-workspace-originals' and name=project::text||'/'||(p_data->>'asset_id'));
  if not found then raise exception 'uploaded_original_required'; end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='version' then
  perform 1 from public.music_projects where id=project for update;
  select coalesce(max(number),0) into current_version from public.music_project_versions where project_id=project;
  if (p_data->>'base_version')::integer is distinct from current_version then raise exception 'version_conflict_refresh'; end if;
  if jsonb_typeof(p_data->'arrangement') is distinct from 'array' or jsonb_array_length(p_data->'arrangement') not between 1 and 100 or length(trim(p_data->>'note')) not between 1 and 1000 then raise exception 'invalid_version'; end if;
  for item in select value from jsonb_array_elements(p_data->'arrangement') loop
   if not exists(select 1 from public.music_project_assets where id=(item->>'asset_id')::uuid and project_id=project and ready) then raise exception 'arrangement_file_unavailable'; end if;
  end loop;
  insert into public.music_project_versions(project_id,number,author_id,note,arrangement) values(project,current_version+1,actor,p_data->>'note',p_data->'arrangement');
  return jsonb_build_object('number',current_version+1);
 end if;
 raise exception 'unsupported_action';
end $$;
revoke all on function public.music_workspace_action(text,jsonb) from public,anon;
grant execute on function public.music_workspace_action(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('music-workspace-originals','music-workspace-originals',false,26214400,array['audio/wav','audio/mpeg','audio/flac','audio/ogg','audio/mp4','audio/webm']);
create policy music_workspace_upload on storage.objects for insert to authenticated with check(bucket_id='music-workspace-originals' and exists(select 1 from public.music_project_assets a where name=a.project_id::text||'/'||a.id::text and a.uploader_id=auth.uid() and not a.ready and public.music_workspace_role(a.project_id) in ('owner','editor')));
create policy music_workspace_download on storage.objects for select to authenticated using(bucket_id='music-workspace-originals' and exists(select 1 from public.music_project_assets a where name=a.project_id::text||'/'||a.id::text and public.music_workspace_role(a.project_id) is not null));
-- No update/delete policies: originals cannot be overwritten by collaborators.
