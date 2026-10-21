-- HOMELESSNESS ACTION + BOUNTIES V1
-- Production migration: 20261003235507.
--
-- Homelessness becomes a concrete Action Network campaign with direct-service
-- missions, a higher-trust housing-navigation lane, privacy rules, a field
-- cohort, and funded bounty slots. The money rail stays closed until the
-- campaign/support rail is explicitly enabled; zero dollars are invented.

create table public.action_mission_policies (
  mission_id uuid primary key references public.action_missions(id) on delete cascade,
  category text not null check (category in ('food','supplies','outreach','transport','housing_navigation','media','other')),
  risk_tier smallint not null default 1 check (risk_tier between 1 and 3),
  requires_program_cohort boolean not null default false,
  recipient_privacy_required boolean not null default true,
  public_proof_guidance text not null default '' check (char_length(public_proof_guidance) <= 1200),
  updated_at timestamptz not null default now()
);
alter table public.action_mission_policies enable row level security;
revoke all on public.action_mission_policies from public,anon,authenticated;
grant select on public.action_mission_policies to anon,authenticated;
grant all on public.action_mission_policies to service_role;
create policy "public reads policies for public missions" on public.action_mission_policies
  for select to anon,authenticated
  using (exists (
    select 1 from public.action_missions m
    where m.id=mission_id and m.status in ('open','paused','closed')
  ));

create table public.action_bounties (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.action_campaigns(id) on delete cascade,
  mission_id uuid not null references public.action_missions(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 1600),
  reward_cents integer not null check (reward_cents between 100 and 50000),
  max_awards integer not null check (max_awards between 1 and 10000),
  eligibility text not null default 'campaign_cohort'
    check (eligibility in ('campaign_cohort','any_member','staff_assigned')),
  claim_ttl_minutes integer not null default 1440 check (claim_ttl_minutes between 30 and 10080),
  status text not null default 'draft' check (status in ('draft','open','paused','closed')),
  payout_note text not null default '' check (char_length(payout_note) <= 800),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (campaign_id <> '')
);
create index action_bounties_campaign_idx on public.action_bounties(campaign_id,status);
create index action_bounties_mission_idx on public.action_bounties(mission_id,status);
alter table public.action_bounties enable row level security;
revoke all on public.action_bounties from public,anon,authenticated;
grant select on public.action_bounties to anon,authenticated;
grant all on public.action_bounties to service_role;
create policy "public reads published bounties" on public.action_bounties
  for select to anon,authenticated using(status in ('open','paused','closed'));

create table public.action_bounty_funding_ledger (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.action_bounties(id) on delete cascade,
  delta_cents bigint not null check (delta_cents <> 0),
  kind text not null check (kind in ('program_allocation','contribution','adjustment','refund')),
  provider text not null default 'internal' check (provider in ('internal','square','stripe','manual')),
  provider_ref text,
  state text not null default 'verified' check (state in ('pending','verified','void')),
  note text not null default '' check (char_length(note) <= 800),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create unique index action_bounty_funding_provider_ref_uq
  on public.action_bounty_funding_ledger(provider,provider_ref)
  where provider_ref is not null and state <> 'void';
create index action_bounty_funding_bounty_idx
  on public.action_bounty_funding_ledger(bounty_id,state,created_at);
alter table public.action_bounty_funding_ledger enable row level security;
revoke all on public.action_bounty_funding_ledger from public,anon,authenticated;
grant all on public.action_bounty_funding_ledger to service_role;
grant select on public.action_bounty_funding_ledger to authenticated;
create policy "desk reads bounty funding ledger" on public.action_bounty_funding_ledger
  for select to authenticated using((select public.eu_is_admin()));

create table public.action_bounty_claims (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.action_bounties(id) on delete cascade,
  assignment_id uuid not null unique references public.action_mission_assignments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  reward_cents integer not null check (reward_cents between 100 and 50000),
  status text not null default 'reserved'
    check (status in ('reserved','submitted','approved','rejected','cancelled','expired','paid')),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  reviewer_m_uid uuid references public.m_people(id) on delete set null,
  review_note text,
  payout_provider text,
  payout_ref text,
  unique(bounty_id,user_id)
);
create index action_bounty_claims_bounty_status_idx on public.action_bounty_claims(bounty_id,status,expires_at);
create index action_bounty_claims_muid_idx on public.action_bounty_claims(m_uid,claimed_at desc);
alter table public.action_bounty_claims enable row level security;
revoke all on public.action_bounty_claims from public,anon,authenticated;
grant all on public.action_bounty_claims to service_role;
grant select on public.action_bounty_claims to authenticated;
create policy "members read own bounty claims" on public.action_bounty_claims
  for select to authenticated
  using (user_id=(select auth.uid()) or (select public.eu_is_admin()));

create or replace function public.action_bounty_public(p_campaign text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select
      x.*,
      m.title as mission_title,
      m.description as mission_description,
      p.category,
      p.risk_tier,
      p.requires_program_cohort,
      p.recipient_privacy_required,
      p.public_proof_guidance,
      c.money_enabled as support_open,
      c.allocation_note as support_note,
      greatest(0,coalesce((
        select sum(f.delta_cents)
        from public.action_bounty_funding_ledger f
        where f.bounty_id=x.id and f.state='verified'
      ),0))::bigint as funded_cents,
      coalesce((
        select sum(cl.reward_cents)
        from public.action_bounty_claims cl
        where cl.bounty_id=x.id
          and (
            cl.status in ('submitted','approved','paid')
            or (cl.status='reserved' and cl.expires_at>now())
          )
      ),0)::bigint as committed_cents,
      coalesce((
        select count(*)
        from public.action_bounty_claims cl
        where cl.bounty_id=x.id
          and (
            cl.status in ('submitted','approved','paid')
            or (cl.status='reserved' and cl.expires_at>now())
          )
      ),0)::integer as committed_awards
    from public.action_bounties x
    join public.action_missions m on m.id=x.mission_id
    left join public.action_mission_policies p on p.mission_id=m.id
    join public.action_campaigns c on c.id=x.campaign_id
    where x.campaign_id=p_campaign
      and x.status in ('open','paused','closed')
      and m.status in ('open','paused','closed')
  )
  select jsonb_build_object(
    'campaign_id',p_campaign,
    'support_open',coalesce((select support_open from b limit 1),false),
    'support_note',(select support_note from b limit 1),
    'bounties',coalesce(jsonb_agg(jsonb_build_object(
      'id',id,
      'mission_id',mission_id,
      'mission_title',mission_title,
      'mission_description',mission_description,
      'title',title,
      'description',description,
      'reward_cents',reward_cents,
      'max_awards',max_awards,
      'eligibility',eligibility,
      'claim_ttl_minutes',claim_ttl_minutes,
      'status',status,
      'category',category,
      'risk_tier',risk_tier,
      'requires_program_cohort',requires_program_cohort,
      'recipient_privacy_required',recipient_privacy_required,
      'public_proof_guidance',public_proof_guidance,
      'funded_cents',funded_cents,
      'committed_cents',committed_cents,
      'funded_slots',least(max_awards,floor(funded_cents::numeric/reward_cents)::int),
      'committed_awards',committed_awards,
      'available_slots',greatest(0,least(
        max_awards-committed_awards,
        floor(greatest(0,funded_cents-committed_cents)::numeric/reward_cents)::int
      ))
    ) order by created_at,id),'[]'::jsonb)
  )
  from b;
$$;
revoke all on function public.action_bounty_public(text) from public;
grant execute on function public.action_bounty_public(text) to anon,authenticated;

create or replace function public.claim_action_bounty(p_bounty_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_muid uuid := public.current_m_uid();
  v_bounty public.action_bounties%rowtype;
  v_mission public.action_missions%rowtype;
  v_join jsonb;
  v_assignment uuid;
  v_existing public.action_bounty_claims%rowtype;
  v_funded bigint;
  v_committed bigint;
  v_committed_awards integer;
  v_claim public.action_bounty_claims%rowtype;
  v_eligible boolean := false;
begin
  if v_user is null or v_muid is null then raise exception 'sign in to take a bounty'; end if;

  select * into v_bounty from public.action_bounties where id=p_bounty_id for update;
  if not found or v_bounty.status<>'open' then raise exception 'this bounty is not open'; end if;

  select * into v_mission from public.action_missions where id=v_bounty.mission_id for update;
  if not found or v_mission.status<>'open' then raise exception 'this mission is not open'; end if;

  if v_bounty.eligibility='any_member' then
    v_eligible:=true;
  elsif v_bounty.eligibility='campaign_cohort' then
    select exists(
      select 1
      from public.action_cohort_members cm
      join public.action_cohorts co on co.id=cm.cohort_id
      where cm.m_uid=v_muid and co.campaign_id=v_bounty.campaign_id and co.status='active'
    ) into v_eligible;
  elsif v_bounty.eligibility='staff_assigned' then
    v_eligible:=(select public.eu_is_admin());
  end if;
  if not v_eligible then
    raise exception 'this bounty is for approved program participants';
  end if;

  update public.action_bounty_claims
     set status='expired'
   where bounty_id=v_bounty.id and status='reserved' and expires_at<=now();

  select * into v_existing
  from public.action_bounty_claims
  where bounty_id=v_bounty.id and user_id=v_user
  for update;
  if found and v_existing.status not in ('cancelled','expired','rejected') then
    return jsonb_build_object(
      'claim_id',v_existing.id,'assignment_id',v_existing.assignment_id,
      'status',v_existing.status,'reward_cents',v_existing.reward_cents,
      'expires_at',v_existing.expires_at,'idempotent',true
    );
  end if;

  select greatest(0,coalesce(sum(delta_cents),0))::bigint into v_funded
  from public.action_bounty_funding_ledger
  where bounty_id=v_bounty.id and state='verified';

  select
    coalesce(sum(reward_cents),0)::bigint,
    count(*)::int
  into v_committed,v_committed_awards
  from public.action_bounty_claims
  where bounty_id=v_bounty.id
    and (
      status in ('submitted','approved','paid')
      or (status='reserved' and expires_at>now())
    );

  if v_committed_awards>=v_bounty.max_awards then raise exception 'all bounty slots are taken'; end if;
  if v_funded-v_committed<v_bounty.reward_cents then raise exception 'this bounty is waiting for funding'; end if;

  v_join:=public.join_action_mission(v_bounty.mission_id);
  v_assignment:=(v_join->>'assignment_id')::uuid;

  if found then
    update public.action_bounty_claims
       set assignment_id=v_assignment,m_uid=v_muid,reward_cents=v_bounty.reward_cents,
           status='reserved',claimed_at=now(),
           expires_at=now()+make_interval(mins=>v_bounty.claim_ttl_minutes),
           submitted_at=null,approved_at=null,paid_at=null,reviewer_m_uid=null,
           review_note=null,payout_provider=null,payout_ref=null
     where id=v_existing.id
     returning * into v_claim;
  else
    insert into public.action_bounty_claims(
      bounty_id,assignment_id,user_id,m_uid,reward_cents,status,expires_at
    ) values(
      v_bounty.id,v_assignment,v_user,v_muid,v_bounty.reward_cents,'reserved',
      now()+make_interval(mins=>v_bounty.claim_ttl_minutes)
    ) returning * into v_claim;
  end if;

  return jsonb_build_object(
    'claim_id',v_claim.id,'assignment_id',v_claim.assignment_id,
    'mission_id',v_bounty.mission_id,'status',v_claim.status,
    'reward_cents',v_claim.reward_cents,'expires_at',v_claim.expires_at
  );
end;
$$;
revoke all on function public.claim_action_bounty(uuid) from public,anon;
grant execute on function public.claim_action_bounty(uuid) to authenticated;

create or replace function public.action_bounty_sync_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status=old.status then return new; end if;

  if new.status='submitted' then
    update public.action_bounty_claims
       set status='submitted',submitted_at=coalesce(submitted_at,now())
     where assignment_id=new.id and status='reserved' and expires_at>now();
  elsif new.status='verified' then
    update public.action_bounty_claims
       set status='approved',approved_at=coalesce(approved_at,now())
     where assignment_id=new.id and status in ('reserved','submitted');
  elsif new.status='rejected' then
    update public.action_bounty_claims
       set status='rejected',review_note=coalesce(review_note,'Mission proof was rejected.')
     where assignment_id=new.id and status in ('reserved','submitted');
  elsif new.status='withdrawn' then
    update public.action_bounty_claims
       set status='cancelled',review_note=coalesce(review_note,'Mission was withdrawn.')
     where assignment_id=new.id and status in ('reserved','submitted');
  end if;
  return new;
end;
$$;
revoke all on function public.action_bounty_sync_claim() from public,anon,authenticated;
drop trigger if exists action_bounty_sync_claim_trg on public.action_mission_assignments;
create trigger action_bounty_sync_claim_trg
after update of status on public.action_mission_assignments
for each row execute function public.action_bounty_sync_claim();

create or replace function public.mark_action_bounty_paid(
  p_claim_id uuid,
  p_provider text,
  p_payout_ref text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.action_bounty_claims%rowtype;
begin
  if (select auth.uid()) is null or not (select public.eu_is_admin()) then
    raise exception 'not authorized';
  end if;
  if nullif(btrim(coalesce(p_provider,'')),'') is null
     or nullif(btrim(coalesce(p_payout_ref,'')),'') is null then
    raise exception 'provider and payout reference are required';
  end if;

  select * into v_claim from public.action_bounty_claims where id=p_claim_id for update;
  if not found then raise exception 'claim not found'; end if;
  if v_claim.status='paid' then
    return jsonb_build_object('claim_id',v_claim.id,'status','paid','idempotent',true);
  end if;
  if v_claim.status<>'approved' then raise exception 'only an approved bounty can be marked paid'; end if;

  update public.action_bounty_claims
     set status='paid',paid_at=now(),reviewer_m_uid=public.current_m_uid(),
         payout_provider=left(btrim(p_provider),40),
         payout_ref=left(btrim(p_payout_ref),200),
         review_note=coalesce(nullif(btrim(coalesce(p_note,'')),''),review_note)
   where id=v_claim.id;
  return jsonb_build_object('claim_id',v_claim.id,'status','paid','reward_cents',v_claim.reward_cents);
end;
$$;
revoke all on function public.mark_action_bounty_paid(uuid,text,text,text) from public,anon;
grant execute on function public.mark_action_bounty_paid(uuid,text,text,text) to authenticated;

insert into public.action_campaigns(
  id,slug,status,program,title,kicker,headline,body,facts,sources,phases,current_phase,
  people_goal,money_goal_cents,money_enabled,allocation_note,chapter,sort
) values(
  'homelessness-action-001','homelessness','live','uprise-action-network',
  'Homelessness Action',
  'Campaign 004 · Direct service · Housing navigation',
  'Don’t just react. Help somebody.',
  'Choose the part you can actually do: provide food or supplies, help someone reach a real service, join the trained housing-navigation lane, document the work without exploiting anybody, or fund a verified action when the support rail is open.',
  '[]'::jsonb,
  '[]'::jsonb,
  '[
    {"key":"mobilize","title":"Mobilize","detail":"Build the field team and publish the open actions."},
    {"key":"serve","title":"Serve","detail":"Complete direct food, supply and outreach actions with proof."},
    {"key":"navigate","title":"Navigate","detail":"Help people reach verified services without publishing private information."},
    {"key":"house","title":"Housing","detail":"Run housing-navigation work only through trained or partner-backed pathways."},
    {"key":"prove","title":"Prove","detail":"Publish verified outcomes and every approved expenditure without turning recipients into content."}
  ]'::jsonb,
  'mobilize',1000,null,false,
  'Funding is not being collected for this campaign while the McCluster Corp support rail is closed. The bounty ledger is built now so verified funds can later be allocated to exact actions and every payout can be reconciled.',
  '{
    "title":"Homelessness Action",
    "line":"Pick the part you can actually do.",
    "proof_law":"Proof shows the action, not somebody’s vulnerability.",
    "intake_choices":[
      {"key":"feed","label":"Feed somebody","kind":"mission","mission_id":"51000000-0000-4000-8000-000000000001","note":"Meals and water."},
      {"key":"supplies","label":"Bring supplies","kind":"mission","mission_id":"51000000-0000-4000-8000-000000000002","note":"Care kits, socks, hygiene and water."},
      {"key":"navigate","label":"Help with services","kind":"mission","mission_id":"51000000-0000-4000-8000-000000000003","note":"Verify a resource and help make contact."},
      {"key":"housing","label":"Housing help","kind":"mission","mission_id":"51000000-0000-4000-8000-000000000004","note":"Trained or partner-backed lane."},
      {"key":"document","label":"Document the work","kind":"mission","mission_id":"51000000-0000-4000-8000-000000000005","note":"Action-first footage; recipient identity is never required."},
      {"key":"fund","label":"Fund an action","kind":"fund","note":"Sponsor a verified bounty when the support rail is open."},
      {"key":"bounty","label":"Take a bounty","kind":"bounty","note":"Approved field-team participants can claim funded work."},
      {"key":"live","label":"See what’s live","kind":"live","note":"Enter active Field rooms."}
    ]
  }'::jsonb,
  4
) on conflict(id) do update set
  slug=excluded.slug,status=excluded.status,title=excluded.title,kicker=excluded.kicker,
  headline=excluded.headline,body=excluded.body,phases=excluded.phases,current_phase=excluded.current_phase,
  people_goal=excluded.people_goal,money_enabled=excluded.money_enabled,
  allocation_note=excluded.allocation_note,chapter=excluded.chapter,sort=excluded.sort,updated_at=now();

insert into public.action_missions(
  id,campaign_id,title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,status
) values
('51000000-0000-4000-8000-000000000001','homelessness-action-001','Feed two people',
 'Provide two ready-to-eat meals and water to people who are unhoused. Ask what they want before buying when practical. Proof can show your preparation, receipt and the completed action; a recipient never has to be photographed.',
 'mutual_aid',1,100,true,'review',array['mutual_aid','field'],'open'),
('51000000-0000-4000-8000-000000000002','homelessness-action-001','Build and hand out two care kits',
 'Prepare and distribute two practical care kits such as socks, water and hygiene supplies. Proof should focus on the kits and your action, not identifying the people receiving them.',
 'mutual_aid',1,100,true,'review',array['mutual_aid','field'],'open'),
('51000000-0000-4000-8000-000000000003','homelessness-action-001','Help someone reach a real service',
 'Verify a shelter, meal, outreach, benefits or other relevant resource and help one person make contact. Do not publish names, health information, documents or exact sleeping locations.',
 'community',2,150,true,'review',array['mutual_aid','research','field'],'open'),
('51000000-0000-4000-8000-000000000004','homelessness-action-001','Housing navigation follow-through',
 'Help move one housing-navigation case forward through an approved program or partner pathway. This is not an open walk-up task and does not promise a housing placement.',
 'community',3,225,true,'review',array['mutual_aid','organizing'],'paused'),
('51000000-0000-4000-8000-000000000005','homelessness-action-001','Document one completed homelessness action',
 'Create a short vertical clip that shows a real completed action: the volunteer, supplies, preparation, public setting or outcome. Never require a recipient’s face or story. Identifiable recipient footage requires explicit consent; do not identify minors.',
 'creative',1,90,true,'review',array['media','field','mutual_aid'],'open')
on conflict(id) do update set
 campaign_id=excluded.campaign_id,title=excluded.title,description=excluded.description,
 domain=excluded.domain,difficulty=excluded.difficulty,base_points=excluded.base_points,
 proof_required=excluded.proof_required,verification_mode=excluded.verification_mode,
 skills=excluded.skills,status=excluded.status,updated_at=now();

insert into public.action_mission_policies(
  mission_id,category,risk_tier,requires_program_cohort,recipient_privacy_required,public_proof_guidance
) values
('51000000-0000-4000-8000-000000000001','food',1,false,true,
 'Show the meals, receipt, preparation and your own completed action. Do not require a recipient to appear on camera.'),
('51000000-0000-4000-8000-000000000002','supplies',1,false,true,
 'Show the kits, supplies and your own completed action. Recipient identity is not proof.'),
('51000000-0000-4000-8000-000000000003','outreach',2,false,true,
 'Show the verified resource and your follow-through without names, medical details, documents or exact sleeping locations.'),
('51000000-0000-4000-8000-000000000004','housing_navigation',3,true,true,
 'Use only the approved program or partner workflow. Do not post case details, documents, health information or addresses.'),
('51000000-0000-4000-8000-000000000005','media',2,true,true,
 'Film the action, not someone’s vulnerability. Faces or stories of identifiable recipients require explicit consent and are never required for proof.')
on conflict(mission_id) do update set
 category=excluded.category,risk_tier=excluded.risk_tier,
 requires_program_cohort=excluded.requires_program_cohort,
 recipient_privacy_required=excluded.recipient_privacy_required,
 public_proof_guidance=excluded.public_proof_guidance,updated_at=now();

insert into public.action_cohorts(id,campaign_id,name,description,goal_points,status)
values(
 '52000000-0000-4000-8000-000000000001',
 'homelessness-action-001',
 'Homelessness Action · field team',
 'Approved participants who can claim funded homelessness-action bounties and enter higher-trust field workflows. This is a program seat, not a public status badge.',
 5000,'active'
) on conflict(id) do update set
 campaign_id=excluded.campaign_id,name=excluded.name,description=excluded.description,
 goal_points=excluded.goal_points,status=excluded.status;

insert into public.action_bounties(
  id,campaign_id,mission_id,title,description,reward_cents,max_awards,eligibility,claim_ttl_minutes,status,payout_note
) values
('53000000-0000-4000-8000-000000000001','homelessness-action-001','51000000-0000-4000-8000-000000000001',
 'Feed-two field stipend',
 'A $10 participant stipend for an approved field-team member who completes and verifies the Feed two people mission. The stipend is compensation for the task; it does not buy a recipient’s image or story and does not promise reimbursement of meal costs.',
 1000,100,'campaign_cohort',1440,'open','Paid only after the mission proof is verified and an actual payout is recorded.'),
('53000000-0000-4000-8000-000000000002','homelessness-action-001','51000000-0000-4000-8000-000000000005',
 'Document-the-work stipend',
 'A $10 creator stipend for an approved field-team participant who documents a real completed action without exploiting the recipient. Recipient identity is never required.',
 1000,100,'campaign_cohort',1440,'open','Paid only after review. Consent is required for identifiable recipient footage.'),
('53000000-0000-4000-8000-000000000003','homelessness-action-001','51000000-0000-4000-8000-000000000003',
 'Resource-navigation follow-through',
 'A $20 stipend for an approved field-team participant who verifies a real resource and helps one person make contact, while keeping private information out of proof.',
 2000,50,'campaign_cohort',2880,'open','Paid after verification; this is not payment for personal data or a successful housing outcome.')
on conflict(id) do update set
 campaign_id=excluded.campaign_id,mission_id=excluded.mission_id,title=excluded.title,
 description=excluded.description,reward_cents=excluded.reward_cents,max_awards=excluded.max_awards,
 eligibility=excluded.eligibility,claim_ttl_minutes=excluded.claim_ttl_minutes,
 status=excluded.status,payout_note=excluded.payout_note,updated_at=now();

insert into public.network_live_rooms(
  slug,owner_m_uid,title,description,room_kind,category_key,action_mission_id,cohort_id,
  seat_limit,support_enabled,support_purpose,status
) values(
 'homelessness-action',null,'Homelessness Action Room',
 'Persistent field room for approved homelessness-action participants: plan direct service, go live during appropriate work, debrief outcomes and route viewers into specific missions.',
 'home','field',null,'52000000-0000-4000-8000-000000000001',
 4,false,'Fund verified homelessness actions and approved participant bounties.','active'
) on conflict(slug) do update set
 title=excluded.title,description=excluded.description,room_kind=excluded.room_kind,
 category_key=excluded.category_key,cohort_id=excluded.cohort_id,seat_limit=excluded.seat_limit,
 support_enabled=excluded.support_enabled,support_purpose=excluded.support_purpose,status=excluded.status,updated_at=now();
