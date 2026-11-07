-- PENDING. After project_tiles_v1. Explicit owned free-publication authority; no billing, media approval or processing allowance is granted.
begin;
create or replace function public.project_tile_publish_free_v1(p_user uuid,p_actor uuid,p_slug text,p_expected integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p public.managed_projects; d public.creator_site_drafts; v public.creator_site_revisions; begin
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
revoke all on function public.project_tile_publish_free_v1(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.project_tile_publish_free_v1(uuid,uuid,text,integer) to service_role;
commit;
