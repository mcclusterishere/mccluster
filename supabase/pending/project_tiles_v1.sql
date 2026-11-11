-- PENDING REVIEW ONLY. Depends on managed_projects_v1 and recovered website_studio_v2.
-- Reuses #493 versioned drafts/revisions and #623 project ownership; no new tenant/publication table.
begin;
alter table public.managed_projects add column if not exists presentation text not null default 'front' check(presentation in ('front','tiles'));
alter table public.managed_projects add column if not exists studio_draft_id uuid references public.creator_site_drafts(id);
alter table public.managed_projects add column if not exists studio_revision_id uuid references public.creator_site_revisions(id);
alter table public.managed_projects add column if not exists studio_published_at timestamptz;
alter table public.managed_projects add column if not exists studio_org_id uuid references public.orgs(id);
create unique index if not exists managed_projects_studio_draft_idx on public.managed_projects(studio_draft_id) where studio_draft_id is not null;
create or replace function public.project_tile_save_v1(p_user uuid,p_actor uuid,p_slug text,p_expected integer,p_document jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p public.managed_projects; saved jsonb; d uuid; begin
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
revoke all on function public.project_tile_save_v1(uuid,uuid,text,integer,jsonb), public.project_tile_publish_v1(uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.project_tile_save_v1(uuid,uuid,text,integer,jsonb), public.project_tile_publish_v1(uuid,uuid,text,integer,uuid) to service_role;
commit;
