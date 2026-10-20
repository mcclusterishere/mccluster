-- PENDING; not applied. Requires 20261017030617_intel_mission_canon_v1.
-- No new stores. Recoverable proposals remain in ai_context.decisions;
-- reviewed basis and its receipt commit atomically in the existing tables.
-- Rollback: withdraw mutation traffic first; use the reviewed rollback script
-- in docs/control-plane/admin-evidence-20261020/intel-rollback.sql. Keep history.

create unique index if not exists decisions_actor_idempotency_v2
  on ai_context.decisions (org_id, proposed_by, (metadata->>'idempotency_key'))
  where metadata ? 'idempotency_key';
create unique index if not exists decisions_id_org_integrity_v2 on ai_context.decisions(id,org_id);
alter table public.intel_decision_basis add constraint intel_basis_decision_org_v2
  foreign key(decision_id,org_id) references ai_context.decisions(id,org_id);
alter table public.intel_mission_decisions add constraint intel_mission_decision_org_v2
  foreign key(decision_id,org_id) references ai_context.decisions(id,org_id);
alter table public.intel_outcomes add constraint intel_outcome_decision_org_v2
  foreign key(decision_id,org_id) references ai_context.decisions(id,org_id);

-- Bounded source/review snapshot used for approval AND execution. SHA256 is
-- change detection, not a claim that evidence is scientifically true.
create or replace function public.intel_basis_snapshot(p_org uuid, p_decision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_basis jsonb; v_claims jsonb; v_evidence jsonb; v_briefings jsonb;
  v_ok boolean; v_snapshot jsonb;
begin
  if not exists (select 1 from ai_context.decisions where id=p_decision and org_id=p_org) then return null; end if;
  -- Locks prevent review changes between this check and the caller's commit.
  perform 1 from public.intel_briefings b where b.org_id=p_org and b.id in
    (select briefing_id from public.intel_decision_basis where org_id=p_org and decision_id=p_decision) for share;
  perform 1 from public.intel_claims c where c.org_id=p_org and c.id in
    (select claim_id from public.intel_decision_basis where org_id=p_org and decision_id=p_decision) for share;
  perform 1 from public.intel_evidence e where e.org_id=p_org and (e.id in
    (select evidence_id from public.intel_decision_basis where org_id=p_org and decision_id=p_decision)
    or e.id in (select ce.evidence_id from public.intel_claim_evidence ce join public.intel_decision_basis db
      on db.claim_id=ce.claim_id and db.org_id=ce.org_id where db.org_id=p_org and db.decision_id=p_decision)) for share;

  select coalesce(jsonb_agg(jsonb_build_object('briefing',briefing_id,'claim',claim_id,'evidence',evidence_id)
    order by coalesce(briefing_id,claim_id,evidence_id)), '[]'::jsonb) into v_basis
    from public.intel_decision_basis where org_id=p_org and decision_id=p_decision;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'status',b.status,'content',
    encode(sha256(convert_to(b.title || E'\n' || b.body,'UTF8')),'hex'),
    'citations',(select jsonb_agg(to_jsonb(bc) order by bc.ordinal) from public.intel_briefing_citations bc where bc.briefing_id=b.id)) order by b.id),'[]'::jsonb)
    into v_briefings from public.intel_briefings b where b.org_id=p_org and b.id in
    (select briefing_id from public.intel_decision_basis where org_id=p_org and decision_id=p_decision);
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'statement',c.statement,
    'reviewed_by',c.reviewed_by,'reviewed_at',c.reviewed_at,'links',
    (select jsonb_agg(to_jsonb(ce) order by ce.evidence_id,ce.stance) from public.intel_claim_evidence ce where ce.claim_id=c.id)) order by c.id),'[]'::jsonb)
    into v_claims from public.intel_claims c where c.org_id=p_org and c.id in
    (select claim_id from public.intel_decision_basis where org_id=p_org and decision_id=p_decision);
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'hash',e.content_sha256,'review_status',e.review_status,
    'title',e.title,'summary',e.summary,'measures',e.measures,'location',jsonb_build_array(e.lat,e.lon,e.geo_source),
    'reviewed_by',e.reviewed_by,'reviewed_at',e.reviewed_at,'source_status',r.status,
    'source_record_id',e.source_record_id,'outcome_id',e.outcome_id) order by e.id),'[]'::jsonb)
    into v_evidence from public.intel_evidence e left join public.ops_ingest_records r on r.id=e.source_record_id
    where e.org_id=p_org and (e.id in
      (select evidence_id from public.intel_decision_basis where org_id=p_org and decision_id=p_decision)
      or e.id in (select ce.evidence_id from public.intel_claim_evidence ce join public.intel_decision_basis db
        on db.claim_id=ce.claim_id and db.org_id=ce.org_id where db.org_id=p_org and db.decision_id=p_decision));

  v_ok := jsonb_array_length(v_briefings)>0
    and not exists(select 1 from jsonb_array_elements(v_briefings) b where b->>'status'<>'final' or coalesce(jsonb_array_length(nullif(b->'citations','null'::jsonb)),0)=0)
    and not exists(select 1 from jsonb_array_elements(v_claims) c where c->>'status'<>'supported' or c->>'reviewed_by' is null)
    and not exists(select 1 from jsonb_array_elements(v_evidence) e where e->>'review_status'<>'accepted'
      or e->>'reviewed_by' is null or coalesce(e->>'source_status','accepted')<>'accepted')
    and jsonb_array_length(v_evidence)>0
    and not exists(select 1 from public.intel_claims c join public.intel_decision_basis b on b.claim_id=c.id
      where b.org_id=p_org and b.decision_id=p_decision and not exists(
        select 1 from public.intel_claim_evidence ce join public.intel_evidence e on e.id=ce.evidence_id
        where ce.claim_id=c.id and ce.stance='supports' and e.review_status='accepted'))
    and not exists (
      select 1 from public.intel_briefing_citations bc join public.intel_decision_basis b on b.briefing_id=bc.briefing_id
      where b.org_id=p_org and b.decision_id=p_decision and
        ((bc.claim_id is not null and not exists (select 1 from public.intel_decision_basis x where x.decision_id=p_decision and x.org_id=p_org and x.claim_id=bc.claim_id))
        or (bc.evidence_id is not null and not exists(select 1 from public.intel_decision_basis x where x.decision_id=p_decision and x.org_id=p_org and x.evidence_id=bc.evidence_id)))
    );
  v_snapshot := jsonb_build_object('basis',v_basis,'briefings',v_briefings,'claims',v_claims,'evidence',v_evidence);
  return jsonb_build_object('valid',v_ok,'fingerprint',encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex'),
    'basis_items',jsonb_array_length(v_basis),'reason',case when v_ok then null else 'reviewed_basis_required' end);
end $$;

create or replace function public.intel_decision_readiness(p_org uuid,p_decision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d ai_context.decisions%rowtype; s jsonb; receipt boolean;
begin
  select * into d from ai_context.decisions where org_id=p_org and id=p_decision;
  if not found then return null; end if;
  s := public.intel_basis_snapshot(p_org,p_decision);
  receipt := d.metadata->'intel_receipt'->>'state'='recorded' and exists(
    select 1 from public.control_audit a where a.org_id=p_org and a.event='intel.decision.proposed'
      and a.resource_type='ai_context.decision' and a.resource_id=p_decision::text
      and a.id::text=d.metadata->'intel_receipt'->>'audit_id');
  return jsonb_build_object('decision_id',d.id,'status',d.status,'basis',s,
    'audit',coalesce(d.metadata->'intel_receipt',jsonb_build_object('state','unverified')) ||
      jsonb_build_object('recorded',coalesce(receipt,false),'state',case when receipt then 'recorded'
        when d.metadata->'intel_receipt'->>'state'='recorded' then 'missing'
        else coalesce(d.metadata->'intel_receipt'->>'state','unverified') end),
    'actionable',d.status='approved' and coalesce(receipt,false) and (s->>'valid')::boolean
      and d.metadata->>'intel_approved_basis'=s->>'fingerprint'
      and exists(select 1 from public.org_members where org_id=p_org and profile_id=d.approved_by and role in ('owner','admin')),
    'reason',case when not coalesce(receipt,false) then 'audit_receipt_missing'
      when not (s->>'valid')::boolean then 'reviewed_basis_required'
      when d.status<>'approved' then 'human_approval_required'
      when not exists(select 1 from public.org_members where org_id=p_org and profile_id=d.approved_by and role in ('owner','admin')) then 'approver_authority_revoked'
      when d.metadata->>'intel_approved_basis' is distinct from s->>'fingerprint' then 'approved_basis_changed' else null end,
    'needs_review',not (s->>'valid')::boolean or
      (d.status='approved' and d.metadata->>'intel_approved_basis' is distinct from s->>'fingerprint'));
end $$;

-- Gate both direct SQL and context-decision. A user-editable status or stale
-- approval never suffices. Non-Intel decisions preserve their existing contract.
create or replace function public.intel_decision_approval_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s jsonb; is_intel boolean;
begin
  is_intel := new.metadata ? 'intel_briefing_id' or exists(select 1 from public.intel_decision_basis where decision_id=new.id);
  if new.status='approved' and is_intel then
    if tg_op='INSERT' then raise exception 'Intel decision must be proposed before approval' using errcode='42501'; end if;
    if old.status='approved' then
      if (new.title,new.decision,new.rationale_summary,new.risk_class,new.approved_by,new.approved_at)
        is distinct from (old.title,old.decision,old.rationale_summary,old.risk_class,old.approved_by,old.approved_at)
        or new.metadata->>'intel_approved_basis' is distinct from old.metadata->>'intel_approved_basis' then
        raise exception 'approved Intel decision is immutable; propose a replacement' using errcode='42501';
      end if;
      return new;
    end if;
    if new.approved_by is null or new.approved_at is null or not exists
      (select 1 from public.org_members where org_id=new.org_id and profile_id=new.approved_by and role in ('owner','admin')) then
      raise exception 'current human owner/admin approval required' using errcode='42501';
    end if;
    s:=public.intel_basis_snapshot(new.org_id,new.id);
    if not coalesce((s->>'valid')::boolean,false) or new.metadata->'intel_receipt'->>'state' is distinct from 'recorded'
      or not exists(select 1 from public.control_audit a where a.org_id=new.org_id and a.event='intel.decision.proposed'
        and a.resource_type='ai_context.decision' and a.resource_id=new.id::text
        and a.id::text=new.metadata->'intel_receipt'->>'audit_id') then
      raise exception 'reviewed basis and recorded receipt required before approval' using errcode='42501';
    end if;
    new.metadata:=new.metadata || jsonb_build_object('intel_approved_basis',s->>'fingerprint');
  end if;
  return new;
end $$;
create trigger intel_decision_approval_v2 before insert or update on ai_context.decisions
  for each row execute function public.intel_decision_approval_guard();

create or replace function public.intel_mission_basis_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  r:=public.intel_decision_readiness(new.org_id,new.decision_id);
  if not coalesce((r->>'actionable')::boolean,false) or not exists
    (select 1 from public.org_members where org_id=new.org_id and profile_id=new.linked_by and role in ('owner','admin')) then
    raise exception 'current reviewed decision, receipt and authorized actor required' using errcode='42501';
  end if;
  return new;
end $$;
create trigger intel_mission_basis_v2 before insert or update on public.intel_mission_decisions
  for each row execute function public.intel_mission_basis_guard();

-- Every new source revision queues the old evidence and affected claims for
-- review, rather than silently retaining an accepted superseded fact. Only a
-- strictly newer provider revision invalidates; replaying old bytes cannot.
create or replace function public.intel_revision_time(p_value text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then return null; end if;
  return p_value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;

create or replace function public.intel_source_revision_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.ops_ingest_records%rowtype; old_ids uuid[]; revision_at timestamptz;
begin
  if new.source_record_id is null then return new; end if;
  select * into r from public.ops_ingest_records where id=new.source_record_id and org_id=new.org_id;
  revision_at:=public.intel_revision_time(r.source_ref->>'updated_at');
  if revision_at is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.org_id::text || ':' || r.connector_id::text || ':' || r.external_id,0));
  if exists(select 1 from public.ops_ingest_records newer where newer.org_id=r.org_id and newer.connector_id=r.connector_id
    and newer.external_id=r.external_id and public.intel_revision_time(newer.source_ref->>'updated_at')>revision_at) then
    update public.ops_ingest_records set status='superseded' where id=r.id;
    return new;
  end if;
  select array_agg(e.id) into old_ids from public.intel_evidence e join public.ops_ingest_records prior on prior.id=e.source_record_id
    where e.org_id=new.org_id and prior.connector_id=r.connector_id and prior.external_id=r.external_id
      and e.id<>new.id and prior.content_hash<>r.content_hash
      and public.intel_revision_time(prior.source_ref->>'updated_at') < revision_at;
  update public.ops_ingest_records set status='superseded' where id in
    (select source_record_id from public.intel_evidence where id=any(old_ids));
  update public.intel_evidence set review_status='unreviewed', visibility='private', updated_at=now() where id=any(old_ids);
  update public.intel_claims set status='under_review', visibility='private', updated_at=now() where org_id=new.org_id and id in
    (select claim_id from public.intel_claim_evidence where org_id=new.org_id and evidence_id=any(old_ids));
  return new;
end $$;
create trigger intel_source_revision_v2 after insert on public.intel_evidence
  for each row execute function public.intel_source_revision_guard();

create or replace function public.intel_content_review_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='intel_evidence' then
    if (new.content_sha256,new.title,new.summary,new.measures,new.lat,new.lon,new.geo_source,new.source_url,new.license)
      is distinct from (old.content_sha256,old.title,old.summary,old.measures,old.lat,old.lon,old.geo_source,old.source_url,old.license) then
      new.review_status:='unreviewed'; new.visibility:='private'; new.reviewed_by:=null; new.reviewed_at:=null;
    end if;
  elsif new.statement is distinct from old.statement then
    new.status:='under_review'; new.visibility:='private'; new.reviewed_by:=null; new.reviewed_at:=null;
  end if;
  return new;
end $$;
create trigger intel_evidence_content_review_v2 before update on public.intel_evidence
  for each row execute function public.intel_content_review_guard();
create trigger intel_claim_content_review_v2 before update on public.intel_claims
  for each row execute function public.intel_content_review_guard();

-- Reuse the existing review queues. Corrections/retractions visibly withdraw
-- finality from affected briefings; restoring a claim does not re-finalize an
-- old briefing or resurrect an approval. The owner creates a corrected brief.
create or replace function public.intel_review_correction_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='intel_evidence' then
    if new.review_status='accepted' and
      (new.content_sha256,new.title,new.summary,new.measures,new.lat,new.lon)
      is not distinct from (old.content_sha256,old.title,old.summary,old.measures,old.lat,old.lon) then return new; end if;
    update public.intel_claims set status='under_review',visibility='private',updated_at=now()
      where org_id=new.org_id and status='supported' and id in
        (select claim_id from public.intel_claim_evidence where org_id=new.org_id and evidence_id=new.id);
    update public.intel_briefings set status='draft' where org_id=new.org_id and status='final' and id in
      (select briefing_id from public.intel_briefing_citations where org_id=new.org_id and evidence_id=new.id);
  else
    if new.status='supported' and new.statement is not distinct from old.statement then return new; end if;
    update public.intel_briefings set status='draft' where org_id=new.org_id and status='final' and id in
      (select briefing_id from public.intel_briefing_citations where org_id=new.org_id and claim_id=new.id);
  end if;
  return new;
end $$;
create trigger intel_evidence_correction_v2 after update of review_status,content_sha256,title,summary,measures,lat,lon,geo_source,source_url,license on public.intel_evidence
  for each row execute function public.intel_review_correction_guard();
create trigger intel_claim_correction_v2 after update of status,statement on public.intel_claims
  for each row execute function public.intel_review_correction_guard();

-- Serialize citation/link edits against snapshot locks. Existing reviewed
-- claims and decision-linked final briefings return to their review queues.
create or replace function public.intel_link_review_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='intel_claim_evidence' then
    perform 1 from public.intel_claims where id in (new.claim_id,old.claim_id) order by id for update;
    update public.intel_claims set status='under_review',visibility='private',reviewed_by=null,reviewed_at=null
      where id in (new.claim_id,old.claim_id) and reviewed_by is not null;
  else
    perform 1 from public.intel_briefings where id in (new.briefing_id,old.briefing_id) order by id for update;
    update public.intel_briefings b set status='draft' where id in (new.briefing_id,old.briefing_id)
      and status='final' and (tg_op<>'INSERT' or exists(select 1 from public.intel_decision_basis where briefing_id=b.id));
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger intel_claim_link_review_v2 before insert or update or delete on public.intel_claim_evidence
  for each row execute function public.intel_link_review_guard();
create trigger intel_briefing_link_review_v2 before insert or update or delete on public.intel_briefing_citations
  for each row execute function public.intel_link_review_guard();

-- Draft creation is not publication. Opening a linked mission and starting
-- member work revalidate the same basis, receipt and current approver role.
-- Existing proof submission/review stays available to preserve outcome history.
create or replace function public.intel_action_readiness_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m uuid; link record;
begin
  if tg_table_name='action_missions' then
    if new.status<>'open' then return new; end if;
    m:=new.id;
  else
    if new.status not in ('joined','in_progress') then return new; end if;
    m:=new.mission_id;
  end if;
  for link in select org_id,decision_id from public.intel_mission_decisions where mission_id=m loop
    if not coalesce((public.intel_decision_readiness(link.org_id,link.decision_id)->>'actionable')::boolean,false) then
      raise exception 'Intel mission requires a current reviewed decision and authorized approver' using errcode='42501';
    end if;
  end loop;
  return new;
end $$;
create trigger intel_action_open_v2 before update of status on public.action_missions
  for each row execute function public.intel_action_readiness_guard();
create trigger intel_action_start_v2 before insert or update of mission_id,status on public.action_mission_assignments
  for each row execute function public.intel_action_readiness_guard();

create or replace function public.intel_record_decision_basis(
  p_org uuid, p_actor uuid, p_decision uuid, p_briefing uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer; d ai_context.decisions%rowtype; a public.control_audit%rowtype;
begin
  select * into d from ai_context.decisions where id=p_decision and org_id=p_org for update;
  if not found then
    raise exception 'decision not found in this org' using errcode = 'P0002';
  end if;
  if not exists(select 1 from public.org_members where org_id=p_org and profile_id=p_actor and role in ('owner','admin')) then
    raise exception 'owner/admin required' using errcode='42501';
  end if;
  if d.metadata->>'intel_briefing_id' is not null and d.metadata->>'intel_briefing_id'<>p_briefing::text then
    raise exception 'proposal briefing cannot change' using errcode='42501';
  end if;
  if d.status<>'proposed' and d.metadata->'intel_receipt'->>'state' is distinct from 'recorded' then
    raise exception 'only a proposed decision can repair its basis' using errcode='42501';
  end if;
  if not exists (select 1 from public.intel_briefings b where b.id = p_briefing and b.org_id = p_org and b.status = 'final') then
    raise exception 'briefing is not final in this org';
  end if;
  insert into public.intel_decision_basis (org_id, decision_id, briefing_id, recorded_by)
  values (p_org, p_decision, p_briefing, p_actor)
  on conflict do nothing;
  insert into public.intel_decision_basis (org_id, decision_id, claim_id, recorded_by)
  select distinct p_org, p_decision, bc.claim_id, p_actor
  from public.intel_briefing_citations bc where bc.briefing_id = p_briefing and bc.claim_id is not null
  on conflict do nothing;
  insert into public.intel_decision_basis (org_id, decision_id, evidence_id, recorded_by)
  select distinct p_org, p_decision, bc.evidence_id, p_actor
  from public.intel_briefing_citations bc where bc.briefing_id = p_briefing and bc.evidence_id is not null
  on conflict do nothing;
  select count(*) into v_rows from public.intel_decision_basis where decision_id = p_decision;
  select * into a from public.control_audit where org_id=p_org and event='intel.decision.proposed'
    and resource_type='ai_context.decision' and resource_id=p_decision::text order by at,id limit 1;
  if not found then
    insert into public.control_audit(org_id,actor_user_id,actor_kind,event,capability,resource_type,resource_id,detail)
      values(p_org,case when d.proposed_by ~ '^[0-9a-f-]{36}$' then d.proposed_by::uuid else p_actor end,
        'user','intel.decision.proposed','intel','ai_context.decision',p_decision::text,
        jsonb_build_object('briefing_id',p_briefing,'basis_items',v_rows,'reconciled_by',p_actor)) returning * into a;
  end if;
  update ai_context.decisions set metadata=metadata || jsonb_build_object('intel_receipt',
    jsonb_build_object('state','recorded','audit_id',a.id,'at',a.at)),updated_at=now() where id=p_decision;
  return jsonb_build_object('decision_id',p_decision,'basis_items',v_rows,
    'audit',jsonb_build_object('recorded',true,'id',a.id,'at',a.at));
end
$$;

-- Create a mission from an APPROVED decision. The approval check and the
-- insert happen in one transaction; the mission is created as 'draft' so
-- publishing it to members stays a separate, deliberate admin act.
create or replace function public.intel_create_mission_from_decision(
  p_org uuid, p_actor uuid, p_decision uuid, p_idempotency_key text, p_mission jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text; v_ready jsonb; v_existing public.intel_mission_decisions%rowtype; v_mission uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_idempotency_key,0));
  select * into v_existing from public.intel_mission_decisions where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.decision_id <> p_decision then raise exception 'idempotency key reused for a different decision'; end if;
    return jsonb_build_object('mission_id', v_existing.mission_id, 'decision_id', p_decision, 'created', false);
  end if;

  select d.status into v_status from ai_context.decisions d where d.id = p_decision and d.org_id = p_org for share;
  if v_status is null then raise exception 'decision not found in this org' using errcode = 'P0002'; end if;
  if v_status <> 'approved' then raise exception 'decision is %, not approved', v_status using errcode = '42501'; end if;

  v_ready:=public.intel_decision_readiness(p_org,p_decision);
  if not coalesce((v_ready->>'actionable')::boolean,false) then
    raise exception 'reviewed basis changed or receipt missing; new approval required' using errcode='42501';
  end if;

  insert into public.action_missions (title, description, domain, status, proof_required, verification_mode)
  values (
    left(p_mission->>'title', 160), coalesce(p_mission->>'description', ''),
    coalesce(p_mission->>'domain', 'community'), 'draft', true, 'review'
  )
  returning id into v_mission;

  insert into public.intel_mission_decisions (mission_id, org_id, decision_id, objectives, scope, region_label, target_measures, idempotency_key, linked_by)
  values (
    v_mission, p_org, p_decision,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_mission->'objectives', '[]'::jsonb))), '{}'),
    p_mission->>'scope', p_mission->>'region_label', coalesce(p_mission->'target_measures', '{}'::jsonb),
    p_idempotency_key, p_actor
  );
  return jsonb_build_object('mission_id', v_mission, 'decision_id', p_decision, 'created', true, 'mission_status', 'draft');
end
$$;


revoke all on function public.intel_basis_snapshot(uuid,uuid), public.intel_decision_readiness(uuid,uuid),
  public.intel_decision_approval_guard(),public.intel_source_revision_guard(),public.intel_mission_basis_guard(),
  public.intel_review_correction_guard(),public.intel_content_review_guard(),public.intel_revision_time(text),
  public.intel_link_review_guard(),public.intel_action_readiness_guard() from public,anon,authenticated;
grant execute on function public.intel_basis_snapshot(uuid,uuid),public.intel_decision_readiness(uuid,uuid) to service_role;

-- Preserve coverage-cap and freshness metadata for truthful source health.
create or replace function public.intel_health(p_org uuid, p_connector_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select * from public.ops_ingest_connectors where org_id = p_org and connector_key = p_connector_key
  ), latest as (
    select r.* from public.ops_ingest_runs r join c on c.id = r.connector_id order by r.started_at desc limit 1
  ), last_ok as (
    select r.* from public.ops_ingest_runs r join c on c.id = r.connector_id
    where r.status in ('succeeded', 'partial') order by r.started_at desc limit 1
  )
  select jsonb_build_object(
    'connector', (select jsonb_build_object('id', id, 'key', connector_key, 'enabled', enabled, 'cursor', cursor,
                   'last_sync_at', last_sync_at, 'last_ok_at', last_ok_at, 'last_error', last_error, 'last_error_at', last_error_at) from c),
    'stored', jsonb_build_object(
      'source_records', (select count(*) from public.ops_ingest_records r join c on c.id = r.connector_id),
      'evidence_total', (select count(*) from public.intel_evidence where org_id = p_org),
      'evidence_by_review', coalesce((select jsonb_object_agg(review_status, n) from (
          select review_status, count(*) n from public.intel_evidence where org_id = p_org group by 1) s), '{}'::jsonb),
      'claims', (select count(*) from public.intel_claims where org_id = p_org),
      'briefings', (select count(*) from public.intel_briefings where org_id = p_org),
      'decisions_with_basis', (select count(distinct decision_id) from public.intel_decision_basis where org_id = p_org),
      'missions_from_decisions', (select count(*) from public.intel_mission_decisions where org_id = p_org),
      'outcomes', (select count(*) from public.intel_outcomes where org_id = p_org)
    ),
    'latest_run', (select jsonb_build_object('id', id, 'status', status, 'started_at', started_at, 'finished_at', finished_at,
                   'records_seen', records_seen, 'records_written', records_written, 'records_rejected', records_rejected,
                   'error', error, 'metadata', metadata) from latest),
    'last_successful_run', (select jsonb_build_object('id', id, 'status', status, 'started_at', started_at,
                   'records_written', records_written, 'finished_at', finished_at, 'metadata', metadata) from last_ok),
    'failures', jsonb_build_object(
      'last_7d', (select count(*) from public.ops_ingest_runs r join c on c.id = r.connector_id
                  where r.status = 'failed' and r.started_at > now() - interval '7 days'),
      'runs_last_7d', (select count(*) from public.ops_ingest_runs r join c on c.id = r.connector_id
                  where r.started_at > now() - interval '7 days')
    )
  )
$$;
