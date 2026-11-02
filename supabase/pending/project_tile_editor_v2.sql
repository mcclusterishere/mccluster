-- PENDING ONLY: after editor_versioned_contracts_v1 and project_tiles/free_v1.
-- No new Studio store. Both revision authorities remain mandatory.
begin;
-- Preserve legacy signatures and behavior while fixing lock order before row locks.
create or replace function public.project_tile_save_v1(p_user uuid,p_actor uuid,p_slug text,p_expected integer,p_document jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p public.managed_projects; saved jsonb; d uuid; begin
 perform pg_catalog.pg_advisory_xact_lock(182704,2);
 select * into p from public.managed_projects where slug=p_slug and owner_user_id=p_user and m_uid=p_actor and removed_at is null for update;
 if not found or not exists(select 1 from public.m_auth_user_links where auth_user_id=p_user and m_uid=p_actor and is_primary) then raise exception 'project unavailable' using errcode='42501';end if;
 d:=coalesce(p.studio_draft_id,gen_random_uuid());
 if (p.studio_draft_id is null and p_expected<>0) or (p.studio_draft_id is not null and p_expected=0) then raise exception 'draft changed' using errcode='40001';end if;
 saved:=public.studio_save_v2(p_actor,d,p_expected,p_document);
 update public.managed_projects set studio_draft_id=d,updated_at=now() where slug=p_slug;
 return saved;
end $$;
create or replace function public.project_tile_publish_v1(p_user uuid,p_actor uuid,p_slug text,p_expected integer,p_org uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p public.managed_projects; d public.creator_site_drafts; v public.creator_site_revisions; begin
 perform pg_catalog.pg_advisory_xact_lock(182704,2);
 select * into p from public.managed_projects where slug=p_slug and owner_user_id=p_user and m_uid=p_actor and removed_at is null for update;
 if not found or p.registry_key is not null or not exists(select 1 from public.m_auth_user_links where auth_user_id=p_user and m_uid=p_actor and is_primary) then raise exception 'project unavailable' using errcode='42501';end if;
 if not exists(select 1 from public.network_profiles where m_uid=p_actor and visibility='public') then raise exception 'profile is not public' using errcode='42501';end if;
 if not exists(select 1 from public.creator_billing_subscriptions where owner_user_id=p_user and org_id=p_org and status='active' and current_period_end>now()) or not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_user and role in ('owner','admin')) then raise exception 'paid workspace unavailable' using errcode='42501';end if;
 select * into d from public.creator_site_drafts where id=p.studio_draft_id and owner_m_uid=p_actor for update;
 if not found or d.revision<>p_expected then raise exception 'draft changed' using errcode='40001';end if;
 -- API validates exact revision references; public reads re-resolve approval/withdrawal and paid access.
 insert into public.creator_site_revisions(draft_id,owner_m_uid,draft_revision,document) values(d.id,p_actor,d.revision,d.document) on conflict(draft_id,draft_revision) do nothing;
 select * into v from public.creator_site_revisions where draft_id=d.id and draft_revision=d.revision;
 update public.managed_projects set presentation='tiles',studio_revision_id=v.id,studio_published_at=now(),studio_org_id=p_org,updated_at=now() where slug=p_slug;
 -- Existing cinematic draft and published JSON remain intact for an explicit switch back.
 insert into public.creator_site_events(owner_m_uid,event,reference_id,revision) values(p_actor,'project.tiles.published',d.id,d.revision);
 return jsonb_build_object('project',p_slug,'revision',d.revision,'revision_id',v.id);
end $$;
create or replace function public.project_tile_publish_free_v1(p_user uuid,p_actor uuid,p_slug text,p_expected integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p public.managed_projects; d public.creator_site_drafts; v public.creator_site_revisions; begin
 perform pg_catalog.pg_advisory_xact_lock(182704,2);
 select * into p from public.managed_projects where slug=p_slug and owner_user_id=p_user and m_uid=p_actor and removed_at is null for update;
 if not found or p.registry_key is not null or not exists(select 1 from public.m_auth_user_links where auth_user_id=p_user and m_uid=p_actor and is_primary) then raise exception 'project unavailable' using errcode='42501';end if;
 if not exists(select 1 from public.network_profiles where m_uid=p_actor and visibility='public') then raise exception 'profile is not public' using errcode='42501';end if;
 if not exists(select 1 from public.m_people where id=p_actor and status='active') then raise exception 'account not active' using errcode='42501';end if;
 select * into d from public.creator_site_drafts where id=p.studio_draft_id and owner_m_uid=p_actor for update;
 if not found or d.revision<>p_expected then raise exception 'draft changed' using errcode='40001';end if;
 -- API validates exact revision references; public reads re-resolve approval/withdrawal and current site ownership.
 insert into public.creator_site_revisions(draft_id,owner_m_uid,draft_revision,document) values(d.id,p_actor,d.revision,d.document) on conflict(draft_id,draft_revision) do nothing;
 select * into v from public.creator_site_revisions where draft_id=d.id and draft_revision=d.revision;
 update public.managed_projects set presentation='tiles',studio_revision_id=v.id,studio_published_at=now(),studio_org_id=null,updated_at=now() where slug=p_slug;
 -- Existing cinematic draft and published JSON remain intact for an explicit switch back.
 insert into public.creator_site_events(owner_m_uid,event,reference_id,revision) values(p_actor,'project.tiles.free_published',d.id,d.revision);
 return jsonb_build_object('project',p_slug,'revision',d.revision,'revision_id',v.id);
end $$;
create or replace function public.project_tile_editor_v2(p_user uuid,p_actor uuid,p_slug text,p_action text,p_editor_expected bigint default null,p_expected integer default null,p_document jsonb default null,p_org uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p public.managed_projects; h private.editor_heads; d public.creator_site_drafts; result jsonb; previous_context text;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'editor_forbidden' using errcode='42501';end if;
 if p_action is null or p_action not in ('read','save','publish_free','publish_paid','unpublish','withdraw','recover','switch_front') then raise exception 'editor_invalid_action' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(182704,2);
 perform 1 from public.m_auth_user_links l join public.m_people m on m.id=l.m_uid where l.auth_user_id=p_user and l.m_uid=p_actor and l.is_primary and m.status='active' for share of l,m;
 if not found then raise exception 'editor_forbidden' using errcode='42501';end if;
 select * into p from public.managed_projects where slug=p_slug and owner_user_id=p_user and m_uid=p_actor for update;
 if not found then raise exception 'editor_not_found' using errcode='P0002';end if;
 select * into h from private.editor_heads where kind='project' and key=p.id::text;
 if p.studio_draft_id is not null then select * into d from public.creator_site_drafts where id=p.studio_draft_id and owner_m_uid=p_actor for update;end if;
 if p_action='read' then return jsonb_build_object('editor_revision',coalesce(h.revision,0),'studio_revision',coalesce(d.revision,0),'owner_withdrawn',coalesce(h.owner_withdrawn,false));end if;
 if p_editor_expected is null or p_editor_expected<>coalesce(h.revision,0) or p_expected is null or p_expected<>coalesce(d.revision,0) then raise exception 'editor_revision_conflict' using errcode='PT409';end if;
 if p.removed_at is not null and p_action<>'recover' then raise exception 'editor_removed' using errcode='42501';end if;
 if p_action='recover' and (p.removed_at is null or not coalesce(h.owner_withdrawn,false)) then raise exception 'editor_not_owner_withdrawn' using errcode='42501';end if;
 if p_action in ('publish_free','publish_paid') then
  perform 1 from public.network_profiles where m_uid=p_actor and visibility='public' for share;
  if not found then raise exception 'editor_private_profile' using errcode='42501';end if;
 end if;
 previous_context:=current_setting('mccluster.editor_context',true);
 perform set_config('mccluster.editor_context',jsonb_build_object('kind','project','key',p.id::text,'expected',p_editor_expected,'actor',p_user,'operation','tiles_'||p_action)::text,true);
 case p_action
 when 'save' then result:=public.project_tile_save_v1(p_user,p_actor,p_slug,p_expected,p_document);
 when 'publish_free' then result:=public.project_tile_publish_free_v1(p_user,p_actor,p_slug,p_expected);
 when 'publish_paid' then result:=public.project_tile_publish_v1(p_user,p_actor,p_slug,p_expected,p_org);
 else
  update public.managed_projects set
    published=null,published_at=null,studio_revision_id=null,studio_published_at=null,
    presentation=case when p_action='switch_front' then 'front' else presentation end,
    removed_at=case when p_action='withdraw' then clock_timestamp() when p_action='recover' then null else removed_at end,
    updated_at=clock_timestamp() where id=p.id;
  if p_action in ('withdraw','recover') then update private.editor_heads set owner_withdrawn=(p_action='withdraw') where kind='project' and key=p.id::text;end if;
 end case;
 perform set_config('mccluster.editor_context',coalesce(previous_context,''),true);
 select * into h from private.editor_heads where kind='project' and key=p.id::text;
 select * into p from public.managed_projects where id=p.id;
 if p.studio_draft_id is not null then select * into d from public.creator_site_drafts where id=p.studio_draft_id;end if;
 return jsonb_build_object('result',result,'editor_revision',h.revision,'studio_revision',coalesce(d.revision,0),'owner_withdrawn',h.owner_withdrawn,'presentation',p.presentation,'removed',p.removed_at is not null);
end $$;
revoke all on function public.project_tile_editor_v2(uuid,uuid,text,text,bigint,integer,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.project_tile_editor_v2(uuid,uuid,text,text,bigint,integer,jsonb,uuid) to service_role;
commit;
