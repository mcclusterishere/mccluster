-- MISSION CATALOG SOURCES v1 (migration name mission_catalog_sources_v1): Project Drawdown as the credited source of the
-- mission catalog 'drawdown' (action_mission_details.catalog), and the house owner's commands over its source page in the World.
-- PENDING. Not applied to production. Owner approval required.
-- Apply only on Matthew's approval of this exact text, after release step 9 (the mission publish) and step 11 (its record),
-- with the Supabase MCP apply_migration (it runs as postgres) under the name mission_catalog_sources_v1, byte for byte.
-- Order and procedure: supabase/pending/PROMOTION-ORDER.md, section "Mission catalog sources". Rollback (owner approval, as
-- postgres): 20261119140000_mission_catalog_sources_v1.rollback.sql. Proof before apply: scripts/test/mission-catalog-sources.integration.mjs
-- (PGlite) and scripts/test/mission-catalog-sources.native.integration.mjs (disposable PostgreSQL 16 and 17).
-- Inserting the organization row publishes its name, type, description and website (network_organizations is readable by
-- anyone): approving this file approves those words. The source page stays a draft until the house owner shows it.
-- A source is not a sponsor, partner, funder, author or operator of this platform, and not an endorser: the words check refuses
-- those words in the page's data (the list is js/mission-source-words.js). Decisions D1 to D14 are defaults adopted pending
-- Matthew's confirmation (docs/control-plane/WORLD-MISSION-SOURCES.md). One transaction, safe to run twice.
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if to_regclass('public.network_organizations') is null or to_regclass('public.action_missions') is null
     or to_regclass('public.action_mission_details') is null or to_regclass('public.orgs') is null
     or to_regclass('public.org_members') is null or to_regclass('public.control_audit') is null then
    raise exception 'mission_catalog_sources_v1 needs network_organizations, action_missions, action_mission_details, orgs, org_members and control_audit; nothing changed' using errcode = '55000';
  end if;
  if not exists (select 1 from public.action_missions m join public.action_mission_details d on d.mission_id = m.id
                  where d.catalog = 'drawdown' and m.status = 'open') then
    raise exception 'no Drawdown mission is open: apply the publish (release step 9) first; nothing changed' using errcode = '55000';
  end if;
  if exists (select 1 from public.network_organizations o where lower(o.slug) = 'project-drawdown'
              and (o.created_by is not null or o.verification_state <> 'unverified' or o.name <> 'Project Drawdown'
                   or o.organization_type <> 'nonprofit' or o.website_url is distinct from 'https://drawdown.org/'
                   or o.description <> 'Credited source of the mission catalog drawdown in McCluster Corp''s World. This record is kept by McCluster Corp; Project Drawdown does not run it. Project Drawdown is a 501(c)(3) nonprofit (drawdown.org/about, read 2026-11-19).')) then
    raise exception 'an organization project-drawdown exists and is not the row this file writes; nothing changed' using errcode = '55000';
  end if;
end $guard$;

insert into public.network_organizations (slug, name, organization_type, description, website_url, verification_state, created_by)
select 'project-drawdown', 'Project Drawdown', 'nonprofit',
       'Credited source of the mission catalog drawdown in McCluster Corp''s World. This record is kept by McCluster Corp; Project Drawdown does not run it. Project Drawdown is a 501(c)(3) nonprofit (drawdown.org/about, read 2026-11-19).',
       'https://drawdown.org/', 'unverified', null
 where not exists (select 1 from public.network_organizations where lower(slug) = 'project-drawdown');

create table if not exists public.mission_catalog_sources (
  catalog text not null,
  organization_id uuid not null,
  state text not null default 'draft',
  revision integer not null default 1,
  role_line text not null,
  facts jsonb not null default '[]'::jsonb,
  facts_read_on date,
  shown_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mission_catalog_sources_pkey primary key (catalog),
  constraint mission_catalog_sources_organization_fkey foreign key (organization_id)
    references public.network_organizations (id) on delete restrict,
  constraint mission_catalog_sources_catalog_check check (catalog ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint mission_catalog_sources_state_check check (state in ('draft', 'shown', 'hidden')),
  constraint mission_catalog_sources_revision_check check (revision >= 1),
  constraint mission_catalog_sources_role_line_check check (char_length(role_line) between 1 and 160 and role_line !~ '[[:cntrl:]]'),
  constraint mission_catalog_sources_facts_check check (case
    when jsonb_typeof(facts) <> 'array' then false
    when jsonb_array_length(facts) > 6 then false
    when jsonb_path_exists(facts, '$[*] ? (@.type() != "object")') then false
    when jsonb_path_exists(facts, '$[*].keyvalue() ? (@.key != "label" && @.key != "value" && @.key != "source")') then false
    when jsonb_path_exists(facts, '$[*] ? (!(exists(@.label)) || !(exists(@.value)) || !(exists(@.source)))') then false
    when jsonb_path_exists(facts, '$[*] ? (@.label.type() != "string" || @.value.type() != "string" || @.source.type() != "string")') then false
    when jsonb_path_exists(facts, '$[*] ? (!(@.label like_regex "^[^[:cntrl:]]{1,40}$") || !(@.value like_regex "^[^[:cntrl:]]{1,160}$") || !(@.source like_regex "^https://[^[:space:][:cntrl:]]{4,250}$"))') then false
    else true end),
  constraint mission_catalog_sources_read_on_check check (facts = '[]'::jsonb or facts_read_on is not null),
  constraint mission_catalog_sources_words_check check ((role_line || ' ' || facts::text) !~* '(\msponsor|\mpartner|\mbenefactor|\mendors|\mofficial|\mverified|\mcertified|\maccredit|\mrecommend|\mworthwhile|\maffiliat|\mcollaborat|\maccount|\mfollow|\mmessage|\mclaim|\mpaid\M|\mfund\M|\mfunds\M|\mfunded\M|\mfunder\M|\mfunders\M|\mfunding\M|\mkeep[[:space:]]+watching|\min[[:space:]]+association|\mon[[:space:]]+behalf|\msupported[[:space:]]+by|\mpowered[[:space:]]+by|\mpresented[[:space:]]+by|\mapproved[[:space:]]+by|\mauthorized[[:space:]]+by|\mauthorised[[:space:]]+by|\mcreated[[:space:]]+by|\mposted[[:space:]]+by|\mby[[:space:]]+project[[:space:]]+drawdown|\mequity[[:space:]]+uprise|\mhuman[[:space:]]+uprise|\mmissions[[:space:]]+from[[:space:]]+this[[:space:]]+source)')
);
create index if not exists mission_catalog_sources_organization_idx on public.mission_catalog_sources (organization_id);

alter table public.mission_catalog_sources enable row level security;
-- Production's default privileges hand every new public table to anon and authenticated with insert, update and delete, and to
-- service_role with all: take everything back, then grant the one read. No role writes this table directly; the two
-- functions below are its only way in and out for the owner.
revoke all on table public.mission_catalog_sources from public, anon, authenticated, service_role;
grant select on table public.mission_catalog_sources to anon, authenticated;
drop policy if exists "public reads shown catalog sources" on public.mission_catalog_sources;
create policy "public reads shown catalog sources" on public.mission_catalog_sources
  as permissive for select to anon, authenticated using (state = 'shown');

-- The house owner's read: every source with its state (drafts included), its organization, its open missions and the last 20
-- audit records. Whitelisted JSON; never created_by.
create or replace function public.mission_catalog_source_owner_state(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare house uuid;
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where p_actor is not null and o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if house is null then raise exception 'house_owner_required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
        'catalog', s.catalog, 'state', s.state, 'revision', s.revision, 'role_line', s.role_line, 'facts', s.facts,
        'facts_read_on', s.facts_read_on, 'shown_at', s.shown_at, 'created_at', s.created_at, 'updated_at', s.updated_at,
        'organization', jsonb_build_object('slug', o.slug, 'name', o.name, 'website_url', o.website_url,
                                           'organization_type', o.organization_type, 'verification_state', o.verification_state),
        'open_missions', (select count(*) from public.action_missions m join public.action_mission_details d on d.mission_id = m.id
                           where d.catalog = s.catalog and m.status = 'open')) order by s.catalog)
      from public.mission_catalog_sources s join public.network_organizations o on o.id = s.organization_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'audit_id', a.id, 'at', a.at, 'event', a.event, 'catalog', a.resource_id, 'key', a.command_id,
        'reason', a.detail ->> 'reason', 'revision', a.detail -> 'receipt' -> 'revision',
        'permission_confirmed_on', a.detail ->> 'permission_confirmed_on') order by a.id desc)
      from (select * from public.control_audit c where c.org_id = house and c.event like 'mission_source.%'
             order by c.id desc limit 20) a), '[]'::jsonb));
end $$;

-- The house owner's show, hide and edit: one transaction re-checks the house owner, the command, the key, the reason and the
-- revision that was read, replays a used key, applies the change and writes one control_audit row. A refusal writes nothing.
create or replace function public.mission_catalog_source_command(
  p_actor uuid, p_catalog text, p_command text, p_expected_revision integer,
  p_key uuid, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  house uuid; cur public.mission_catalog_sources%rowtype; nxt public.mission_catalog_sources%rowtype;
  prior public.control_audit%rowtype; v_audit bigint; receipt jsonb; confirmed date;
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where p_actor is not null and o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if house is null then raise exception 'house_owner_required' using errcode = '42501'; end if;
  if p_command is null or p_command not in ('show', 'hide', 'edit') then raise exception 'unknown_command' using errcode = '22023'; end if;
  if p_key is null then raise exception 'key_required' using errcode = '22023'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'revision_required' using errcode = '22023'; end if;
  if p_reason is null or char_length(p_reason) not between 1 and 500 or p_reason ~ '[[:cntrl:]]' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload_object' using errcode = '22023'; end if;
  if p_command = 'show' then
    if (p_payload - 'permission_confirmed' - 'permission_confirmed_on') <> '{}'::jsonb
       or p_payload -> 'permission_confirmed' is distinct from 'true'::jsonb
       or jsonb_typeof(p_payload -> 'permission_confirmed_on') is distinct from 'string'
       or (p_payload ->> 'permission_confirmed_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'permission_confirmation_required' using errcode = '22023';
    end if;
    confirmed := (p_payload ->> 'permission_confirmed_on')::date;
    if confirmed < date '2026-11-17' or confirmed > current_date then
      raise exception 'permission_confirmation_date' using errcode = '22023';
    end if;
  elsif p_command = 'hide' then
    if p_payload <> '{}'::jsonb then raise exception 'payload_not_allowed' using errcode = '22023'; end if;
  else
    if (p_payload - 'role_line' - 'facts' - 'facts_read_on') <> '{}'::jsonb or p_payload = '{}'::jsonb
       or (p_payload ? 'role_line' and jsonb_typeof(p_payload -> 'role_line') <> 'string')
       or (p_payload ? 'facts' and not (p_payload ? 'facts_read_on'))
       or (p_payload ? 'facts_read_on' and (jsonb_typeof(p_payload -> 'facts_read_on') <> 'string'
           or (p_payload ->> 'facts_read_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then
      raise exception 'edit_payload' using errcode = '22023';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('mission_catalog_source_command'), hashtext(p_key::text));
  select * into prior from public.control_audit a
   where a.command_id = p_key and a.event like 'mission_source.%' order by a.id limit 1;
  if found then
    if prior.event <> 'mission_source.' || p_command or prior.resource_id is distinct from p_catalog then
      raise exception 'key_reused' using errcode = 'MCS03';
    end if;
    return (prior.detail -> 'receipt') || jsonb_build_object('audit_id', prior.id, 'replayed', true);
  end if;
  select * into cur from public.mission_catalog_sources s where s.catalog = p_catalog for update;
  if not found then raise exception 'not_found' using errcode = 'MCS01'; end if;
  if p_expected_revision <> cur.revision then raise exception 'moved' using errcode = 'MCS02'; end if;
  if p_command = 'show' then
    update public.mission_catalog_sources set state = 'shown', shown_at = coalesce(shown_at, now()),
           revision = revision + 1, updated_at = now()
     where catalog = p_catalog returning * into nxt;
  elsif p_command = 'hide' then
    update public.mission_catalog_sources set state = 'hidden', revision = revision + 1, updated_at = now()
     where catalog = p_catalog returning * into nxt;
  else
    update public.mission_catalog_sources set
           role_line = coalesce(p_payload ->> 'role_line', role_line),
           facts = coalesce(p_payload -> 'facts', facts),
           facts_read_on = coalesce((p_payload ->> 'facts_read_on')::date, facts_read_on),
           revision = revision + 1, updated_at = now()
     where catalog = p_catalog returning * into nxt;
  end if;
  receipt := jsonb_build_object('ok', true, 'catalog', nxt.catalog, 'command', p_command, 'state', nxt.state,
                                'revision', nxt.revision, 'key', p_key);
  insert into public.control_audit (org_id, actor_user_id, actor_kind, event, capability, resource_type, resource_id, command_id, detail)
  values (house, p_actor, 'user', 'mission_source.' || p_command, 'mission_sources.manage', 'mission_catalog_source', p_catalog, p_key,
          jsonb_build_object('reason', p_reason,
            'before', jsonb_build_object('state', cur.state, 'revision', cur.revision, 'role_line', cur.role_line, 'facts', cur.facts, 'facts_read_on', cur.facts_read_on),
            'after', jsonb_build_object('state', nxt.state, 'revision', nxt.revision, 'role_line', nxt.role_line, 'facts', nxt.facts, 'facts_read_on', nxt.facts_read_on),
            'permission_confirmed_on', case when p_command = 'show' then to_char(confirmed, 'YYYY-MM-DD') end,
            'receipt', receipt))
  returning id into v_audit;
  return receipt || jsonb_build_object('audit_id', v_audit, 'replayed', false);
end $$;

revoke all on function public.mission_catalog_source_owner_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mission_catalog_source_owner_state(uuid) to service_role;
revoke all on function public.mission_catalog_source_command(uuid, text, text, integer, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mission_catalog_source_command(uuid, text, text, integer, uuid, text, jsonb) to service_role;

insert into public.mission_catalog_sources (catalog, organization_id, state, revision, role_line, facts, facts_read_on)
select 'drawdown', o.id, 'draft', 1,
       'Missions written by McCluster Corp from Project Drawdown’s climate solutions.',
       '[{"label": "Organization", "value": "501(c)(3) nonprofit", "source": "https://drawdown.org/about"},
         {"label": "Mailing address", "value": "St. Paul, Minnesota", "source": "https://drawdown.org/contact"},
         {"label": "What it publishes", "value": "Assessments of climate solutions, in the Drawdown Explorer", "source": "https://drawdown.org/explorer"}]'::jsonb,
       date '2026-11-19'
  from public.network_organizations o
 where lower(o.slug) = 'project-drawdown' and o.created_by is null and o.verification_state = 'unverified'
on conflict (catalog) do nothing;

comment on table public.mission_catalog_sources is
  'Which organization a mission catalog (action_mission_details.catalog) credits as its source, and the words of its source page in the World. A source is not a sponsor, partner, funder, author or operator of this platform, and not an endorser. Keyed by catalog: no foreign key onto any mission. Readable by anyone only while state = shown. Written only by mission_catalog_source_command (the house owner, through the owner-only Worker route /v1/mission-sources), each change recorded in control_audit.';
comment on function public.mission_catalog_source_command(uuid, text, text, integer, uuid, text, jsonb) is
  'The house owner''s show, hide and edit of a mission source: re-checks the house owner, refuses a moved revision (MCS02), replays a used key (MCS03 for another command), and writes one control_audit row in the same transaction. Show needs the owner''s confirmation that the written permission covers the page. Executable by service_role only.';
comment on function public.mission_catalog_source_owner_state(uuid) is
  'The house owner''s read of every mission source (drafts included), its organization, its open missions and the last 20 audit records. Executable by service_role only.';
commit;
