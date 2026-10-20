-- Character Studio v1 (PENDING). Apply only after the House Agents v1 migration.
-- All generated characters are private org-scoped drafts; no account activation,
-- Auth user creation, public posts, media job, agent job, or provider charge.
create table if not exists public.house_character_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.house_system_accounts(id) on delete cascade,
  revision integer not null check (revision >= 1),
  compilation_version text not null check (compilation_version = 'character-studio.v1'),
  blueprint jsonb not null check (jsonb_typeof(blueprint) = 'object'),
  authored_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (account_id, revision)
);
create index if not exists house_character_revisions_org_account_idx
  on public.house_character_revisions (org_id, account_id, revision desc);
alter table public.house_character_revisions enable row level security;
revoke all on public.house_character_revisions from public, anon, authenticated;
grant all on public.house_character_revisions to service_role;

-- One transactional owner-gated creation. The Worker authenticates the bearer
-- token and compiles the brief; SQL independently refuses forged privilege
-- fields and an org other than the private pilot.
create or replace function public.house_character_create_draft_v1(
  p_org_id uuid, p_author_id uuid, p_blueprint jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_account uuid;
  v_revision uuid;
begin
  if not exists (
    select 1 from public.orgs o
    join public.org_members m on m.org_id = o.id
    where o.id = p_org_id and o.slug = 'mccluster'
      and m.profile_id = p_author_id and m.role = 'owner'
  ) then
    raise exception 'House Studio owner membership required' using errcode = '42501';
  end if;
  if p_blueprint is null or jsonb_typeof(p_blueprint) <> 'object'
     or length(p_blueprint::text) > 16000
     or p_blueprint ->> 'schema_version' <> 'character-studio.v1'
     or p_blueprint -> 'approvals' ->> 'status' <> 'draft'
     or p_blueprint -> 'approvals' ->> 'published' <> 'false'
     or p_blueprint -> 'approvals' ->> 'rights_verified' <> 'false'
     or p_blueprint -> 'approvals' ->> 'canon_approved' <> 'false'
     or p_blueprint -> 'approvals' ->> 'region_approved' <> 'false'
     or p_blueprint -> 'agent_contract' ->> 'execution_enabled' <> 'false'
     or p_blueprint -> 'agent_contract' ->> 'external_publish_enabled' <> 'false'
     or p_blueprint -> 'agent_contract' ->> 'auto_reply_enabled' <> 'false'
     or p_blueprint -> 'agent_contract' ->> 'max_autospend_cents' <> '0'
     or p_blueprint ->> 'narrative_board' <> 'other'
     or p_blueprint ->> 'identity_kind' not in ('fictional_character','studio_system_persona')
     or jsonb_typeof(p_blueprint -> 'canon_refs') <> 'array'
     or jsonb_array_length(p_blueprint -> 'canon_refs') <> 0
  then
    raise exception 'Invalid private character blueprint' using errcode = '22023';
  end if;
  insert into public.house_system_accounts (
    org_id, character_id, handle, display_name, identity_kind,
    narrative_board, distribution_country, distribution_basis,
    region_key, region_provenance, editorial_mission, personality,
    agent_contract, canon_refs, disclosure,
    account_status, rights_verified, canon_approved, region_approved,
    external_publish_enabled, auto_reply_enabled,
    daily_draft_target, monthly_autospend_limit_cents, published_at
  ) values (
    p_org_id,
    p_blueprint ->> 'character_id',
    p_blueprint ->> 'handle',
    p_blueprint ->> 'display_name',
    p_blueprint ->> 'identity_kind',
    'other',
    p_blueprint ->> 'story_country',
    'owner_selected_story_distribution_only_not_residence',
    null, null,
    p_blueprint ->> 'editorial_mission',
    p_blueprint -> 'personality',
    p_blueprint -> 'agent_contract',
    '[]'::jsonb,
    p_blueprint ->> 'disclosure',
    'draft', false, false, false, false, false, 0, 0, null
  ) returning id into v_account;
  insert into public.house_character_revisions (
    org_id, account_id, revision, compilation_version, blueprint, authored_by
  ) values (
    p_org_id, v_account, 1, 'character-studio.v1', p_blueprint, p_author_id
  ) returning id into v_revision;
  return jsonb_build_object(
    'account_id', v_account,
    'character_id', p_blueprint ->> 'character_id',
    'display_name', p_blueprint ->> 'display_name',
    'revision_id', v_revision,
    'revision', 1,
    'status', 'draft',
    'published', false,
    'agent_running', false
  );
end;
$$;
revoke all on function public.house_character_create_draft_v1(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.house_character_create_draft_v1(uuid, uuid, jsonb) to service_role;
