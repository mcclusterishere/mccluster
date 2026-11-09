-- Environmental Justice League: admin-only private intake for the E=Up workspace.
-- Pending, unapplied, reviewed LOCAL schema (owner direction 2026-11-09: the first
-- deeper E=Up release is admin-only at every data/API/storage boundary).
--
-- Same service-only invoker/RLS pattern as migrations/20261109181623_city_arcade_v1.sql: every table
-- is private (RLS on, anon/authenticated revoked, service_role grants only) and
-- the one entry point public.eup_league_command() rechecks house ownership on
-- every call. Nothing here touches the public projections (action_missions,
-- network_groups, action_policy_bills) or the HELD world_environment SQL.
-- Campaigns, missions, applications, assignments, proofs, reviews and consents
-- are revisioned; every mutating command carries an expected revision and an
-- owner-scoped idempotency key whose payload digest must match on replay.
-- Points, payment, agency commission, public publication and live broadcast
-- are deliberately absent: separate decisions, separate SQL.
begin;

create table public.eup_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (length(title) between 1 and 180),
  state text not null default 'draft' check (state in ('draft','released','paused','withdrawn')),
  audience text not null default 'admin_preview' check (audience in ('admin_preview')),
  revision integer not null default 1 check (revision > 0),
  document jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.eup_campaign_revisions (
  campaign_id uuid not null references public.eup_campaigns(id),
  revision integer not null,
  state text not null,
  document jsonb not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (campaign_id, revision)
);
create table public.eup_missions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.eup_campaigns(id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (length(title) between 1 and 180),
  template text not null check (template in ('write-a-song','explain-a-source','map-a-community-resource','understand-a-policy','community-action-session')),
  state text not null default 'draft' check (state in ('draft','released','paused','withdrawn')),
  revision integer not null default 1 check (revision > 0),
  capacity integer check (capacity is null or capacity between 1 and 100000),
  proof_modes text[] not null default '{}'::text[],
  document jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, slug)
);
create table public.eup_mission_revisions (
  mission_id uuid not null references public.eup_missions(id),
  revision integer not null,
  state text not null,
  capacity integer,
  proof_modes text[] not null,
  document jsonb not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (mission_id, revision)
);
create table public.eup_applications (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.eup_missions(id),
  mission_revision integer not null,
  applicant uuid not null references auth.users(id),
  status text not null default 'submitted' check (status in ('submitted','approved','declined','withdrawn')),
  revision integer not null default 1 check (revision > 0),
  document jsonb not null default '{}'::jsonb,
  accommodation jsonb,
  decided_by uuid references auth.users(id),
  decision_reason text check (decision_reason is null or length(decision_reason) <= 2000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, applicant)
);
create table public.eup_assignments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.eup_applications(id),
  mission_id uuid not null references public.eup_missions(id),
  mission_revision integer not null,
  participant uuid not null references auth.users(id),
  status text not null default 'offered' check (status in ('offered','accepted','paused','completed','withdrawn')),
  accepted_revision integer,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index eup_assignments_mission_status on public.eup_assignments(mission_id, status);
create table public.eup_proofs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.eup_assignments(id),
  participant uuid not null references auth.users(id),
  revision integer not null default 1 check (revision > 0),
  state text not null default 'submitted' check (state in ('submitted','accepted','needs_changes','rejected')),
  reviewed_revision integer,
  publication_state text not null default 'private' check (publication_state in ('private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.eup_proof_revisions (
  proof_id uuid not null references public.eup_proofs(id),
  revision integer not null,
  document jsonb not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (proof_id, revision)
);
create table public.eup_proof_reviews (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.eup_proofs(id),
  proof_revision integer not null,
  reviewer uuid not null references auth.users(id),
  decision text not null check (decision in ('accepted','needs_changes','rejected')),
  reason text check (reason is null or length(reason) <= 2000),
  created_at timestamptz not null default now()
);
create table public.eup_consents (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.eup_proofs(id),
  proof_revision integer not null,
  actor uuid not null references auth.users(id),
  purpose text not null check (purpose in ('record','private_review','publish_proof')),
  audience text not null check (audience in ('reviewers','members','public')),
  notice_revision text not null check (length(notice_revision) between 1 and 128),
  granted boolean not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.eup_command_receipts (
  actor uuid not null references auth.users(id),
  tenant uuid not null,
  operation text not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  payload_digest text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor, operation, idempotency_key)
);

alter table public.eup_campaigns enable row level security;
alter table public.eup_campaign_revisions enable row level security;
alter table public.eup_missions enable row level security;
alter table public.eup_mission_revisions enable row level security;
alter table public.eup_applications enable row level security;
alter table public.eup_assignments enable row level security;
alter table public.eup_proofs enable row level security;
alter table public.eup_proof_revisions enable row level security;
alter table public.eup_proof_reviews enable row level security;
alter table public.eup_consents enable row level security;
alter table public.eup_command_receipts enable row level security;
revoke all on public.eup_campaigns, public.eup_campaign_revisions, public.eup_missions, public.eup_mission_revisions,
  public.eup_applications, public.eup_assignments, public.eup_proofs, public.eup_proof_revisions, public.eup_proof_reviews,
  public.eup_consents, public.eup_command_receipts from public, anon, authenticated;
revoke all on public.eup_campaigns, public.eup_campaign_revisions, public.eup_missions, public.eup_mission_revisions,
  public.eup_applications, public.eup_assignments, public.eup_proofs, public.eup_proof_revisions, public.eup_proof_reviews,
  public.eup_consents, public.eup_command_receipts from service_role;
grant select, insert, update on public.eup_campaigns, public.eup_missions, public.eup_applications, public.eup_assignments, public.eup_proofs, public.eup_consents to service_role;
grant select, insert on public.eup_campaign_revisions, public.eup_mission_revisions, public.eup_proof_revisions, public.eup_proof_reviews, public.eup_command_receipts to service_role;

-- Bounded, deterministic document validation (shape only; truth is reviewed by humans).
create function public.eup_league_text_ok(v jsonb, maxlen integer) returns boolean
language sql immutable security invoker set search_path='' as $$
  select jsonb_typeof(v) = 'string' and length(v #>> '{}') between 1 and maxlen and (v #>> '{}') !~ '[\u0000-\u001f\u007f]'
$$;

create function public.eup_league_command(p_action text, p_actor uuid, p_id text, p_document jsonb default null, p_revision integer default null, p_key text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  house uuid; receipt public.eup_command_receipts%rowtype; digest text; res jsonb;
  c public.eup_campaigns%rowtype; m public.eup_missions%rowtype; a public.eup_applications%rowtype;
  s public.eup_assignments%rowtype; p public.eup_proofs%rowtype; r public.eup_proof_reviews%rowtype; k public.eup_consents%rowtype;
  taken integer; who uuid; mode text; next_state text; modes text[];
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if p_actor is null or house is null then raise exception 'House owner required' using errcode = '42501'; end if;

  -- Reads: bounded, private, owner-only.
  if p_action = 'campaigns.list' then
    return coalesce((select jsonb_agg(row_to_json(q) order by q.created_at) from (
      select cc.id, cc.slug, cc.title, cc.state, cc.audience, cc.revision, cc.document, cc.created_at, cc.updated_at,
        coalesce((select jsonb_agg(jsonb_build_object('id', mm.id, 'slug', mm.slug, 'title', mm.title, 'template', mm.template, 'state', mm.state,
          'revision', mm.revision, 'capacity', mm.capacity, 'proof_modes', to_jsonb(mm.proof_modes)) order by mm.created_at)
          from public.eup_missions mm where mm.campaign_id = cc.id), '[]'::jsonb) as missions
      from public.eup_campaigns cc order by cc.created_at limit 200) q), '[]'::jsonb);
  elsif p_action = 'missions.list' then
    return coalesce((select jsonb_agg(row_to_json(q) order by q.created_at) from (
      select mm.id, mm.campaign_id, mm.slug, mm.title, mm.template, mm.state, mm.revision, mm.capacity, mm.proof_modes, mm.document, mm.created_at, mm.updated_at,
        (select count(*) from public.eup_assignments sa where sa.mission_id = mm.id and sa.status in ('offered','accepted','completed'))::integer as assigned
      from public.eup_missions mm where (nullif(p_id, '') is null or mm.campaign_id = nullif(p_id, '')::uuid) order by mm.created_at limit 500) q), '[]'::jsonb);
  elsif p_action = 'applications.list' then
    return coalesce((select jsonb_agg(row_to_json(q) order by q.created_at) from (
      select aa.id, aa.mission_id, aa.mission_revision, aa.applicant, aa.status, aa.revision, aa.document, (aa.accommodation is not null) as accommodation_requested,
        aa.decided_by, aa.decision_reason, aa.decided_at, aa.created_at, aa.updated_at
      from public.eup_applications aa where (nullif(p_id, '') is null or aa.mission_id = nullif(p_id, '')::uuid)
        and (p_document ->> 'status' is null or aa.status = p_document ->> 'status') order by aa.created_at limit 500) q), '[]'::jsonb);
  elsif p_action = 'assignments.list' then
    return coalesce((select jsonb_agg(row_to_json(q) order by q.created_at) from (
      select ss.* from public.eup_assignments ss where (nullif(p_id, '') is null or ss.mission_id = nullif(p_id, '')::uuid) order by ss.created_at limit 500) q), '[]'::jsonb);
  elsif p_action = 'proofs.list' then
    return coalesce((select jsonb_agg(row_to_json(q) order by q.created_at) from (
      select pp.id, pp.assignment_id, pp.participant, pp.revision, pp.state, pp.reviewed_revision, pp.publication_state, pp.created_at, pp.updated_at,
        (select pr.document from public.eup_proof_revisions pr where pr.proof_id = pp.id and pr.revision = pp.revision) as document,
        coalesce((select jsonb_agg(row_to_json(rv) order by rv.created_at) from (select id, proof_revision, reviewer, decision, reason, created_at from public.eup_proof_reviews where proof_id = pp.id) rv), '[]'::jsonb) as reviews
      from public.eup_proofs pp where (nullif(p_id, '') is null or pp.assignment_id = nullif(p_id, '')::uuid) order by pp.created_at limit 500) q), '[]'::jsonb);
  elsif p_action = 'consents.list' then
    return coalesce((select jsonb_agg(row_to_json(q) order by q.created_at) from (
      select kk.* from public.eup_consents kk where (nullif(p_id, '') is null or kk.proof_id = nullif(p_id, '')::uuid) order by kk.created_at limit 500) q), '[]'::jsonb);
  elsif p_action = 'overview' then
    return jsonb_build_object(
      'campaigns', jsonb_build_object('drafts', (select count(*) from public.eup_campaigns where state = 'draft'), 'released', (select count(*) from public.eup_campaigns where state = 'released'),
        'paused', (select count(*) from public.eup_campaigns where state = 'paused'), 'withdrawn', (select count(*) from public.eup_campaigns where state = 'withdrawn')),
      'missions', jsonb_build_object('drafts', (select count(*) from public.eup_missions where state = 'draft'), 'released', (select count(*) from public.eup_missions where state = 'released')),
      'queues', jsonb_build_object('applications', (select count(*) from public.eup_applications where status = 'submitted'),
        'proofs', (select count(*) from public.eup_proofs where state = 'submitted'),
        'reviews', (select count(*) from public.eup_proofs where state = 'needs_changes')),
      'latest_change', (select max(x) from (select max(updated_at) as x from public.eup_campaigns union all select max(updated_at) from public.eup_missions
        union all select max(updated_at) from public.eup_applications union all select max(updated_at) from public.eup_proofs) t));
  end if;

  -- Mutations: owner-scoped idempotency with payload digest; replay returns the stored result.
  if p_key is null or p_key !~ '^[A-Za-z0-9._:-]{8,128}$' then raise exception 'Idempotency key required' using errcode = '22023'; end if;
  digest := encode(sha256(convert_to(coalesce(p_id, '') || '|' || coalesce(p_revision::text, '') || '|' || coalesce(p_document::text, 'null'), 'utf8')), 'hex');
  select * into receipt from public.eup_command_receipts where actor = p_actor and operation = p_action and idempotency_key = p_key;
  if found then
    if receipt.payload_digest <> digest then raise exception 'Idempotency key reused with a different payload' using errcode = 'EU003'; end if;
    return receipt.result;
  end if;

  if p_action = 'campaigns.create' then
    if not public.eup_league_text_ok(p_document -> 'title', 180) or not public.eup_league_text_ok(p_document -> 'slug', 80) or (p_document ->> 'slug') !~ '^[a-z0-9][a-z0-9-]{1,79}$'
      or not public.eup_league_text_ok(p_document -> 'purpose', 2000) or coalesce(p_document ->> 'audience', 'admin_preview') <> 'admin_preview'
      or length(p_document::text) > 32768 then raise exception 'Invalid campaign' using errcode = '22023'; end if;
    if p_document ? 'points_policy' or p_document ? 'payment_policy' or p_document ? 'agency_commission_policy' then raise exception 'Points, payment and commission are separate decisions' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtext('eup:campaign:' || (p_document ->> 'slug')));
    if exists (select 1 from public.eup_campaigns where slug = p_document ->> 'slug') then raise exception 'Campaign slug exists' using errcode = '23505'; end if;
    insert into public.eup_campaigns(slug, title, audience, document, created_by) values (p_document ->> 'slug', p_document ->> 'title', 'admin_preview', p_document, p_actor) returning * into c;
    insert into public.eup_campaign_revisions values (c.id, c.revision, c.state, c.document, p_actor, now());
    res := to_jsonb(c);
  elsif p_action = 'campaigns.transition' then
    select * into c from public.eup_campaigns where id = p_id::uuid for update;
    if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
    if p_revision is null or p_revision <> c.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
    next_state := p_document ->> 'to';
    if not ((c.state = 'draft' and next_state in ('released','withdrawn')) or (c.state = 'released' and next_state in ('paused','withdrawn')) or (c.state = 'paused' and next_state in ('released','withdrawn'))) then
      raise exception 'Transition not allowed' using errcode = '22023'; end if;
    update public.eup_campaigns set state = next_state, revision = revision + 1, updated_at = now() where id = c.id returning * into c;
    insert into public.eup_campaign_revisions values (c.id, c.revision, c.state, c.document, p_actor, now());
    res := to_jsonb(c);
  elsif p_action = 'missions.create' then
    select * into c from public.eup_campaigns where id = p_id::uuid for update;
    if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
    if c.state = 'withdrawn' then raise exception 'Campaign withdrawn' using errcode = '22023'; end if;
    if not public.eup_league_text_ok(p_document -> 'title', 180) or not public.eup_league_text_ok(p_document -> 'slug', 80) or (p_document ->> 'slug') !~ '^[a-z0-9][a-z0-9-]{1,79}$'
      or coalesce(p_document ->> 'template', '') not in ('write-a-song','explain-a-source','map-a-community-resource','understand-a-policy','community-action-session')
      or jsonb_typeof(p_document -> 'proof_modes') is distinct from 'array' or jsonb_array_length(p_document -> 'proof_modes') not between 1 and 5
      or exists (select 1 from jsonb_array_elements_text(p_document -> 'proof_modes') x where x not in ('audio','video','lyrics','text','link'))
      or (p_document ? 'capacity' and (jsonb_typeof(p_document -> 'capacity') <> 'number' or (p_document ->> 'capacity') !~ '^[0-9]+$' or (p_document ->> 'capacity')::integer not between 1 and 100000))
      or not public.eup_league_text_ok(p_document -> 'requirements', 4000) or length(p_document::text) > 32768 then raise exception 'Invalid mission' using errcode = '22023'; end if;
    if p_document ? 'points' or p_document ? 'reward' or p_document ? 'payout' then raise exception 'Points and payment are separate decisions' using errcode = '22023'; end if;
    select array_agg(x) into modes from jsonb_array_elements_text(p_document -> 'proof_modes') x;
    if exists (select 1 from public.eup_missions where campaign_id = c.id and slug = p_document ->> 'slug') then raise exception 'Mission slug exists' using errcode = '23505'; end if;
    insert into public.eup_missions(campaign_id, slug, title, template, capacity, proof_modes, document, created_by)
      values (c.id, p_document ->> 'slug', p_document ->> 'title', p_document ->> 'template', (p_document ->> 'capacity')::integer, modes, p_document, p_actor) returning * into m;
    insert into public.eup_mission_revisions values (m.id, m.revision, m.state, m.capacity, m.proof_modes, m.document, p_actor, now());
    res := to_jsonb(m);
  elsif p_action = 'missions.update' then
    select * into m from public.eup_missions where id = p_id::uuid for update;
    if not found then raise exception 'Mission not found' using errcode = 'P0002'; end if;
    if p_revision is null or p_revision <> m.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
    if m.state = 'withdrawn' then raise exception 'Mission withdrawn' using errcode = '22023'; end if;
    if not public.eup_league_text_ok(p_document -> 'title', 180) or jsonb_typeof(p_document -> 'proof_modes') is distinct from 'array' or jsonb_array_length(p_document -> 'proof_modes') not between 1 and 5
      or exists (select 1 from jsonb_array_elements_text(p_document -> 'proof_modes') x where x not in ('audio','video','lyrics','text','link'))
      or (p_document ? 'capacity' and (jsonb_typeof(p_document -> 'capacity') <> 'number' or (p_document ->> 'capacity') !~ '^[0-9]+$' or (p_document ->> 'capacity')::integer not between 1 and 100000))
      or not public.eup_league_text_ok(p_document -> 'requirements', 4000) or length(p_document::text) > 32768 then raise exception 'Invalid mission' using errcode = '22023'; end if;
    if p_document ? 'points' or p_document ? 'reward' or p_document ? 'payout' then raise exception 'Points and payment are separate decisions' using errcode = '22023'; end if;
    select array_agg(x) into modes from jsonb_array_elements_text(p_document -> 'proof_modes') x;
    select count(*)::integer into taken from public.eup_assignments where mission_id = m.id and status in ('offered','accepted','completed');
    if p_document ? 'capacity' and (p_document ->> 'capacity')::integer < taken then raise exception 'Capacity below current assignments' using errcode = 'EU001'; end if;
    update public.eup_missions set title = p_document ->> 'title', capacity = (p_document ->> 'capacity')::integer, proof_modes = modes,
      document = (m.document - 'title' - 'capacity' - 'proof_modes' - 'requirements') || p_document, revision = revision + 1, updated_at = now() where id = m.id returning * into m;
    insert into public.eup_mission_revisions values (m.id, m.revision, m.state, m.capacity, m.proof_modes, m.document, p_actor, now());
    res := to_jsonb(m);
  elsif p_action = 'missions.transition' then
    select * into m from public.eup_missions where id = p_id::uuid for update;
    if not found then raise exception 'Mission not found' using errcode = 'P0002'; end if;
    if p_revision is null or p_revision <> m.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
    next_state := p_document ->> 'to';
    if not ((m.state = 'draft' and next_state in ('released','withdrawn')) or (m.state = 'released' and next_state in ('paused','withdrawn')) or (m.state = 'paused' and next_state in ('released','withdrawn'))) then
      raise exception 'Transition not allowed' using errcode = '22023'; end if;
    if next_state = 'released' then
      select * into c from public.eup_campaigns where id = m.campaign_id;
      if c.state <> 'released' then raise exception 'Release the campaign first' using errcode = '22023'; end if;
    end if;
    update public.eup_missions set state = next_state, revision = revision + 1, updated_at = now() where id = m.id returning * into m;
    insert into public.eup_mission_revisions values (m.id, m.revision, m.state, m.capacity, m.proof_modes, m.document, p_actor, now());
    if next_state = 'paused' then update public.eup_assignments set status = 'paused', revision = revision + 1, updated_at = now() where mission_id = m.id and status in ('offered','accepted'); end if;
    if next_state = 'released' then update public.eup_assignments set status = 'accepted', revision = revision + 1, updated_at = now() where mission_id = m.id and status = 'paused' and accepted_revision is not null;
      update public.eup_assignments set status = 'offered', revision = revision + 1, updated_at = now() where mission_id = m.id and status = 'paused' and accepted_revision is null; end if;
    if next_state = 'withdrawn' then update public.eup_assignments set status = 'withdrawn', revision = revision + 1, updated_at = now() where mission_id = m.id and status in ('offered','accepted','paused');
      update public.eup_applications set status = 'declined', decision_reason = coalesce(decision_reason, 'mission withdrawn'), decided_by = p_actor, decided_at = now(), revision = revision + 1, updated_at = now() where mission_id = m.id and status = 'submitted'; end if;
    res := to_jsonb(m);
  elsif p_action = 'applications.create' then
    -- Admin preview: the owner records an application for an existing account (default: themselves).
    who := coalesce((p_document ->> 'applicant')::uuid, p_actor);
    if not exists (select 1 from auth.users where id = who) then raise exception 'Unknown applicant' using errcode = '22023'; end if;
    select * into m from public.eup_missions where id = p_id::uuid for update;
    if not found then raise exception 'Mission not found' using errcode = 'P0002'; end if;
    if m.state <> 'released' then raise exception 'Mission not released' using errcode = '22023'; end if;
    if p_revision is null or p_revision <> m.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
    if length(coalesce(p_document::text, '')) > 16384 then raise exception 'Invalid application' using errcode = '22023'; end if;
    if exists (select 1 from public.eup_applications where mission_id = m.id and applicant = who) then raise exception 'Already applied' using errcode = '23505'; end if;
    insert into public.eup_applications(mission_id, mission_revision, applicant, document, accommodation)
      values (m.id, m.revision, who, coalesce(p_document - 'applicant' - 'accommodation', '{}'::jsonb), p_document -> 'accommodation') returning * into a;
    res := to_jsonb(a) - 'accommodation';
  elsif p_action = 'applications.decide' then
    select * into a from public.eup_applications where id = p_id::uuid for update;
    if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
    if p_revision is null or p_revision <> a.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
    if a.status <> 'submitted' then raise exception 'Application already decided' using errcode = '40001'; end if;
    if coalesce(p_document ->> 'decision', '') not in ('approved','declined') or (p_document ? 'reason' and not public.eup_league_text_ok(p_document -> 'reason', 2000)) then raise exception 'Invalid decision' using errcode = '22023'; end if;
    select * into m from public.eup_missions where id = a.mission_id for update;
    if p_document ->> 'decision' = 'approved' then
      if m.state <> 'released' then raise exception 'Mission not released' using errcode = '22023'; end if;
      if m.revision <> a.mission_revision then raise exception 'Mission revision changed since the application; re-apply' using errcode = '40001'; end if;
      -- Atomic capacity reservation: the mission row is locked, the count is taken under that lock.
      select count(*)::integer into taken from public.eup_assignments where mission_id = m.id and status in ('offered','accepted','completed');
      if m.capacity is not null and taken >= m.capacity then raise exception 'Mission capacity reached' using errcode = 'EU001'; end if;
      insert into public.eup_assignments(application_id, mission_id, mission_revision, participant) values (a.id, m.id, m.revision, a.applicant) returning * into s;
    end if;
    update public.eup_applications set status = p_document ->> 'decision', decided_by = p_actor, decision_reason = p_document ->> 'reason', decided_at = now(), revision = revision + 1, updated_at = now() where id = a.id returning * into a;
    res := (to_jsonb(a) - 'accommodation') || jsonb_build_object('assignment', to_jsonb(s));
  elsif p_action = 'assignments.accept' then
    select * into s from public.eup_assignments where id = p_id::uuid for update;
    if not found then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
    if s.participant <> p_actor then raise exception 'Only the participant accepts' using errcode = '42501'; end if;
    if p_revision is null or p_revision <> s.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
    if s.status <> 'offered' then raise exception 'Assignment is not offered' using errcode = '22023'; end if;
    select * into m from public.eup_missions where id = s.mission_id;
    if m.state <> 'released' or m.revision <> s.mission_revision then raise exception 'Mission changed; a new offer is required' using errcode = '40001'; end if;
    update public.eup_assignments set status = 'accepted', accepted_revision = m.revision, revision = revision + 1, updated_at = now() where id = s.id returning * into s;
    res := to_jsonb(s);
  elsif p_action = 'proofs.submit' then
    select * into s from public.eup_assignments where id = p_id::uuid for update;
    if not found then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
    if s.participant <> p_actor then raise exception 'Only the participant submits proof' using errcode = '42501'; end if;
    if s.status <> 'accepted' then raise exception 'Assignment is not accepted' using errcode = '22023'; end if;
    select * into m from public.eup_missions where id = s.mission_id;
    mode := p_document ->> 'mode';
    if mode is null or not (mode = any (m.proof_modes)) or length(coalesce(p_document::text, '')) > 32768
      or (mode in ('text','lyrics') and not public.eup_league_text_ok(p_document -> 'body', 20000))
      or (mode = 'link' and (not public.eup_league_text_ok(p_document -> 'url', 2048) or (p_document ->> 'url') !~ '^https://'))
      or (mode in ('audio','video') and not public.eup_league_text_ok(p_document -> 'object_ref', 512))
      or (m.template = 'write-a-song' and (not public.eup_league_text_ok(p_document -> 'credits', 2000) or coalesce(p_document ->> 'rights_declaration', '') not in ('original','licensed')))
      or p_document ? 'location' or p_document ? 'gps' then raise exception 'Invalid proof' using errcode = '22023'; end if;
    select * into p from public.eup_proofs where assignment_id = s.id for update;
    if found then
      if p.state = 'accepted' then raise exception 'Proof already accepted' using errcode = '40001'; end if;
      if p_revision is null or p_revision <> p.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
      update public.eup_proofs set revision = revision + 1, state = 'submitted', updated_at = now() where id = p.id returning * into p;
    else
      insert into public.eup_proofs(assignment_id, participant) values (s.id, p_actor) returning * into p;
    end if;
    insert into public.eup_proof_revisions values (p.id, p.revision, p_document, p_actor, now());
    res := to_jsonb(p) || jsonb_build_object('document', p_document);
  elsif p_action = 'proofs.review' then
    select * into p from public.eup_proofs where id = p_id::uuid for update;
    if not found then raise exception 'Proof not found' using errcode = 'P0002'; end if;
    if p.participant = p_actor then raise exception 'A participant cannot review their own proof' using errcode = 'EU002'; end if;
    if p_revision is null or p_revision <> p.revision then raise exception 'Proof revision changed; reload before reviewing' using errcode = '40001'; end if;
    if p.state <> 'submitted' then raise exception 'Proof is not awaiting review' using errcode = '40001'; end if;
    if coalesce(p_document ->> 'decision', '') not in ('accepted','needs_changes','rejected') or (p_document ? 'reason' and not public.eup_league_text_ok(p_document -> 'reason', 2000)) then raise exception 'Invalid review' using errcode = '22023'; end if;
    insert into public.eup_proof_reviews(proof_id, proof_revision, reviewer, decision, reason) values (p.id, p.revision, p_actor, p_document ->> 'decision', p_document ->> 'reason') returning * into r;
    update public.eup_proofs set state = p_document ->> 'decision', reviewed_revision = p.revision, updated_at = now() where id = p.id returning * into p;
    if p.state = 'accepted' then update public.eup_assignments set status = 'completed', revision = revision + 1, updated_at = now() where id = p.assignment_id; end if;
    res := to_jsonb(p) || jsonb_build_object('review', to_jsonb(r));
  elsif p_action = 'consents.set' then
    select * into p from public.eup_proofs where id = p_id::uuid for update;
    if not found then raise exception 'Proof not found' using errcode = 'P0002'; end if;
    if p.participant <> p_actor then raise exception 'Only the participant decides consent' using errcode = '42501'; end if;
    if p_revision is null or p_revision <> p.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
    if coalesce(p_document ->> 'purpose', '') not in ('record','private_review','publish_proof') or coalesce(p_document ->> 'audience', '') not in ('reviewers','members','public')
      or not public.eup_league_text_ok(p_document -> 'notice_revision', 128) or jsonb_typeof(p_document -> 'granted') <> 'boolean' then raise exception 'Invalid consent' using errcode = '22023'; end if;
    -- Revoking: close every open grant for this exact purpose/audience/revision. Granting: one open row.
    update public.eup_consents set revoked_at = now() where proof_id = p.id and proof_revision = p.revision and purpose = p_document ->> 'purpose' and audience = p_document ->> 'audience' and revoked_at is null;
    if (p_document ->> 'granted')::boolean then
      insert into public.eup_consents(proof_id, proof_revision, actor, purpose, audience, notice_revision, granted, expires_at)
        values (p.id, p.revision, p_actor, p_document ->> 'purpose', p_document ->> 'audience', p_document ->> 'notice_revision', true, (p_document ->> 'expires_at')::timestamptz) returning * into k;
      res := to_jsonb(k);
    else
      res := jsonb_build_object('proof_id', p.id, 'proof_revision', p.revision, 'purpose', p_document ->> 'purpose', 'audience', p_document ->> 'audience', 'granted', false);
    end if;
    -- publication_state stays 'private': publication is a separate reviewed step, not implemented here.
  else
    raise exception 'Invalid action' using errcode = '22023';
  end if;

  insert into public.eup_command_receipts(actor, tenant, operation, idempotency_key, payload_digest, result) values (p_actor, house, p_action, p_key, digest, res);
  return res;
end $$;
revoke all on function public.eup_league_text_ok(jsonb, integer), public.eup_league_command(text, uuid, text, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.eup_league_text_ok(jsonb, integer), public.eup_league_command(text, uuid, text, jsonb, integer, text) to service_role;
commit;
