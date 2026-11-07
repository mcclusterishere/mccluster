-- DESIGN DRAFT ONLY. Not executed, not a migration, not production-ready.
-- Run real-role PostgreSQL tests/advisors before moving to supabase/pending.
-- Existing creator_published_sites, identities, posts, media and billing stay
-- unchanged. A free account can own a draft before having a paid org workspace.
-- The future Worker must validate contract.mjs, bind p_owner_m_uid to verified
-- auth, enforce quotas, and authorize canonical references. No browser gets
-- service credentials. This schema alone grants no media or publication rights.

create table public.creator_site_template_versions (
  template_key text not null,
  version integer not null check (version > 0),
  status text not null default 'development' check (status in ('development','active','retired')),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  guidance jsonb not null check (jsonb_typeof(guidance) = 'object'),
  created_at timestamptz not null default now(),
  primary key (template_key, version)
);
alter table public.creator_site_template_versions enable row level security;
revoke all on public.creator_site_template_versions from public, anon, authenticated;
grant select on public.creator_site_template_versions to anon, authenticated;
grant select, insert on public.creator_site_template_versions to service_role;
grant update (status) on public.creator_site_template_versions to service_role;
create policy studio_template_read on public.creator_site_template_versions
  for select to anon, authenticated using (status = 'active');
-- Seed approved versions from data/website-studio/motion-portfolio-v1.json:
-- definition = default_document; guidance = guidance. Do not seed demo claims,
-- private source files or unreviewed prices. Version changes require new rows.

create table public.creator_site_drafts (
  id uuid primary key,
  owner_m_uid uuid not null references public.m_people(id) on delete cascade,
  template_key text not null,
  template_version integer not null,
  revision integer not null default 1 check (revision > 0),
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (template_key, template_version)
    references public.creator_site_template_versions(template_key, version),
  constraint studio_document_envelope check (
    jsonb_typeof(document) = 'object'
    and coalesce(document->>'schema_version' = 'website-studio/v1', false)
    and coalesce(document->>'template_key' = template_key, false)
    and coalesce(document->'template_version' = to_jsonb(template_version), false)
    and coalesce(document->>'mode' in ('standard', 'cinematic'), false)
    and coalesce(jsonb_typeof(document->'tiles') = 'array', false)
    and coalesce(jsonb_array_length(document->'tiles') = 3, false)
    and octet_length(document::text) <= 32768
  )
);
create index studio_drafts_owner on public.creator_site_drafts(owner_m_uid, updated_at desc);
alter table public.creator_site_drafts enable row level security;
revoke all on public.creator_site_drafts from public, anon, authenticated;
grant select on public.creator_site_drafts to authenticated;
grant select, insert, update, delete on public.creator_site_drafts to service_role;
create policy studio_draft_read on public.creator_site_drafts
  for select to authenticated using (owner_m_uid = (select public.current_m_uid()));

-- SECURITY INVOKER + service-only EXECUTE. No security-definer workaround.
-- Full document validation is deliberately not duplicated imperfectly in SQL:
-- the trusted Worker must run contract.mjs before calling this private writer.
-- Browser-authenticated users have no direct DML grant.
create function public.creator_save_site_draft_v1(
  p_draft_id uuid, p_owner_m_uid uuid, p_expected_revision integer, p_document jsonb
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public as $$
declare
  saved public.creator_site_drafts%rowtype;
begin
  if p_draft_id is null or p_owner_m_uid is null or p_expected_revision is null
      or p_expected_revision < 0 or p_document is null then
    raise exception 'invalid draft request' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    insert into public.creator_site_drafts
      (id, owner_m_uid, template_key, template_version, document)
    values (p_draft_id, p_owner_m_uid, p_document->>'template_key',
      (p_document->>'template_version')::integer, p_document)
    returning * into saved;
  else
    update public.creator_site_drafts set
      document = p_document, revision = revision + 1, updated_at = now()
    where id = p_draft_id and owner_m_uid = p_owner_m_uid
      and revision = p_expected_revision
    returning * into saved;
    if not found then
      -- Do not disclose whether another owner has this draft identifier.
      raise exception 'draft unavailable or revision changed' using errcode = '40001';
    end if;
  end if;
  return jsonb_build_object('draft_id', saved.id, 'revision', saved.revision,
    'updated_at', saved.updated_at, 'document', saved.document);
end;
$$;
revoke all on function public.creator_save_site_draft_v1(uuid,uuid,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.creator_save_site_draft_v1(uuid,uuid,integer,jsonb) to service_role;

-- Required pre-promotion behavioral cases (not claimed run here):
-- anon cannot read/write drafts or call writer; A cannot read B's draft;
-- authenticated cannot directly change owner/revision/template;
-- stale concurrent saves produce one success and one conflict;
-- duplicate create is reconciled by idempotent request handling in Worker;
-- absent/oversized/invalid envelope fails; claimed identity stays unchanged;
-- revoked media/post/offer blocks publish even if previously saved in a draft;
-- template/guidance version updates never silently mutate existing drafts;
-- asset job completion and public publication are separate committed events.
