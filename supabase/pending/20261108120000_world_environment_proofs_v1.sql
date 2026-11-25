-- REVIEW ONLY. Apply only after explicit release approval and world_environment_v1.
-- No new proof, feed or points tables. Canonical review/submit triggers remain.
begin;

-- Consent is bound to exact proof content. Existing generic share intents stay
-- NULL and never acquire permission to publish environmental evidence.
-- Published snapshot is a receipt, retained when future sharing is turned off.
alter table public.action_share_intents
 add column environment_proof_consent jsonb,
 add column environment_proof_published jsonb;
create or replace function public.world_environment_proof_snapshot(p_assignment uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('proof_id',p.id,'proof_type',p.proof_type,'proof_url',p.proof_url,'statement',p.statement)
 from public.action_proofs p join public.action_mission_assignments a on a.id=p.assignment_id
 join public.action_environment_missions e on e.mission_id=a.mission_id
 where p.assignment_id=p_assignment and p.user_id=a.user_id
 and p.proof_type in ('text','link') and char_length(btrim(p.statement)) between 20 and 4000
 and ((p.proof_type='text' and p.proof_url is null) or
 (p.proof_type='link' and p.proof_url ~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' and char_length(p.proof_url)<=2000));
$$;
create or replace function public.world_environment_proof_post_body(p_snapshot jsonb)
returns text language sql immutable set search_path='' as $$
 select p_snapshot->>'statement' || case when p_snapshot->>'proof_url' is not null then E'\n\n'||(p_snapshot->>'proof_url') else '' end;
$$;
create or replace function public.world_environment_proof_is_published(p_assignment uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
 select 1 from public.action_share_intents i
 join public.action_feed_shares s on s.assignment_id=i.assignment_id
 join public.action_mission_assignments a on a.id=i.assignment_id and a.status='verified' and a.user_id=i.user_id
 join public.action_proofs p on p.assignment_id=a.id and p.status='verified'
 join public.network_posts n on n.id=s.post_id and n.author_m_uid=s.m_uid
 where i.assignment_id=p_assignment and i.environment_proof_published=public.world_environment_proof_snapshot(p_assignment)
 and n.body=public.world_environment_proof_post_body(i.environment_proof_published)
 and n.visibility='public' and n.deleted_at is null and n.removed_at is null);
$$;
create or replace function public.world_environment_proof_publish(p_assignment uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb; v_rows integer;
begin
 -- Canonical assignment lock is acquired first by submit/review/share callers.
 -- Never create a second post or impersonate an author. Only enrich the
 -- existing canonical card, and never restore deleted/moderated/private posts.
 v_snapshot:=public.world_environment_proof_snapshot(p_assignment);
 if v_snapshot is null then return false; end if;
 update public.network_posts n set body=public.world_environment_proof_post_body(v_snapshot)
 from public.action_feed_shares s,public.action_share_intents i,
      public.action_mission_assignments a,public.action_proofs p
 where s.assignment_id=p_assignment and n.id=s.post_id and n.author_m_uid=s.m_uid
 and a.id=s.assignment_id and a.status='verified' and i.assignment_id=a.id and i.user_id=a.user_id
 and p.assignment_id=a.id and p.status='verified' and i.share
 and i.environment_proof_consent=v_snapshot
 and n.visibility='public' and n.deleted_at is null and n.removed_at is null;
 get diagnostics v_rows=row_count;
 if v_rows=1 then
   update public.action_share_intents set environment_proof_published=v_snapshot where assignment_id=p_assignment;
 end if;
 return public.world_environment_proof_is_published(p_assignment);
exception when others then
 -- Canonical verification/awards must survive a publication outage. The
 -- exception block rolls back any partial body/receipt change, not review.
 raise warning 'environment proof publication skipped for %',p_assignment;
 return false;
end $$;
create or replace function public.world_environment_proof_publish_on_verify()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='verified' and old.status is distinct from 'verified' then
   perform public.world_environment_proof_publish(new.id);
 end if;
 return new;
end $$;
-- PostgreSQL runs same-event triggers alphabetically. This follows the existing
-- action_share_on_verify_trg, which first creates the canonical share card.
create trigger world_environment_proof_publish_on_verify_trg
 after update of status on public.action_mission_assignments for each row
 execute function public.world_environment_proof_publish_on_verify();
revoke all on function public.world_environment_proof_snapshot(uuid),public.world_environment_proof_post_body(jsonb),public.world_environment_proof_is_published(uuid),public.world_environment_proof_publish(uuid),public.world_environment_proof_publish_on_verify() from public,anon,authenticated,service_role;
-- Optimistic review token, not authorization. Hash the entire canonical row so
-- replacement, status/review changes and same-content retries invalidate it.
-- UTC keeps timestamp serialization stable across caller session settings.
create or replace function public.world_environment_proof_revision(p_proof public.action_proofs)
returns text language sql immutable set search_path='' set timezone='UTC' as $$
 select md5(to_jsonb(p_proof)::text);
$$;
revoke all on function public.world_environment_proof_revision(public.action_proofs) from public,anon,authenticated,service_role;
create or replace function public.world_environment_proof_read(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_a public.action_mission_assignments%rowtype; v_proof jsonb;
begin
 if auth.uid() is null then raise exception 'sign_in_required'; end if;
 select a.* into v_a from public.action_mission_assignments a join public.action_environment_missions e on e.mission_id=a.mission_id where a.id=p_assignment and a.user_id=auth.uid();
 if not found then raise exception 'assignment_not_found'; end if;
 select jsonb_build_object('proof_id',p.id,'proof_revision',public.world_environment_proof_revision(p),'proof_type',p.proof_type,'proof_url',p.proof_url,'statement',p.statement,'status',p.status,'review_note',p.review_note,'reviewed_at',p.reviewed_at) into v_proof from public.action_proofs p where p.assignment_id=v_a.id;
 return jsonb_build_object('assignment_id',v_a.id,'status',v_a.status,'mission_status',(select status from public.action_missions where id=v_a.mission_id),'can_submit',v_a.status in ('joined','in_progress','submitted','rejected') and exists(select 1 from public.action_missions where id=v_a.mission_id and status in ('open','paused')),'can_share',v_a.status='verified' and v_proof->>'status'='verified' and public.world_environment_proof_snapshot(v_a.id) is not null and char_length(public.world_environment_proof_post_body(public.world_environment_proof_snapshot(v_a.id)))<=2000,'proof',v_proof,'share',coalesce((select share from public.action_share_intents where assignment_id=v_a.id),false),'post_id',(select post_id from public.action_feed_shares where assignment_id=v_a.id),'proof_published',public.world_environment_proof_is_published(v_a.id));
end $$;
create or replace function public.world_environment_proof_submit(p_assignment uuid,p_proof_type text,p_statement text,p_proof_url text,p_share boolean,p_consent boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if auth.uid() is null then raise exception 'sign_in_required'; end if;
 if p_consent is distinct from true then raise exception 'proof_consent_required'; end if;
 if p_share is null then raise exception 'share_boolean_required'; end if;
 if p_proof_type is null or p_proof_type not in ('text','link') or p_statement is null or char_length(btrim(p_statement)) not between 20 and 4000
 or (p_proof_type='text' and nullif(btrim(p_proof_url),'') is not null)
 or (p_proof_type='link' and (p_proof_url is null or p_proof_url !~ '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$' or char_length(p_proof_url)>2000)) then raise exception 'invalid_proof'; end if;
 perform 1 from public.action_mission_assignments a join public.action_environment_missions e on e.mission_id=a.mission_id where a.id=p_assignment and a.user_id=auth.uid() and e.approved_by is not null for update of a;
 if not found then raise exception 'assignment_not_found'; end if;
 -- Share choice and proof are one transaction under the canonical assignment
 -- lock. A failed proof restores the previous choice; a retry replaces it.
 v_result:=public.submit_action_proof(p_assignment,p_proof_type,p_proof_url,btrim(p_statement),'{}'::jsonb);
 if p_share and char_length(public.world_environment_proof_post_body(public.world_environment_proof_snapshot(p_assignment)))>2000 then raise exception 'proof_too_long_for_sharing'; end if;
 perform public.set_action_share_intent(p_assignment,p_share);
 update public.action_share_intents set environment_proof_consent=case when p_share then public.world_environment_proof_snapshot(p_assignment) else null end where assignment_id=p_assignment;
 return v_result||jsonb_build_object('share',p_share);
end $$;
create or replace function public.world_environment_proof_share(p_assignment uuid,p_share boolean,p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'sign_in_required'; end if;
 if p_share is null then raise exception 'share_boolean_required'; end if;
 if p_share and p_consent is distinct from true then raise exception 'proof_consent_required'; end if;
 perform 1 from public.action_mission_assignments a join public.action_environment_missions e on e.mission_id=a.mission_id where a.id=p_assignment and a.user_id=auth.uid() for update of a;
 if not found then raise exception 'assignment_not_found'; end if;
 if p_share and public.world_environment_proof_snapshot(p_assignment) is null then raise exception 'invalid_proof'; end if;
 if p_share and char_length(public.world_environment_proof_post_body(public.world_environment_proof_snapshot(p_assignment)))>2000 then raise exception 'proof_too_long_for_sharing'; end if;
 insert into public.action_share_intents(assignment_id,user_id,share,environment_proof_consent) values(p_assignment,auth.uid(),p_share,case when p_share then public.world_environment_proof_snapshot(p_assignment) else null end)
 on conflict(assignment_id) do update set share=excluded.share,environment_proof_consent=excluded.environment_proof_consent,updated_at=now();
 perform public.set_action_share_intent(p_assignment,p_share);
 if p_share then perform public.world_environment_proof_publish(p_assignment); end if;
 -- Turning off future sharing never removes an already published post.
 return jsonb_build_object('assignment_id',p_assignment,'share',p_share,'post_id',(select post_id from public.action_feed_shares where assignment_id=p_assignment),'proof_published',public.world_environment_proof_is_published(p_assignment));
end $$;
create or replace function public.world_environment_proofs()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb; v_total integer; v_pending integer;
begin
 if auth.uid() is null then raise exception 'sign_in_required'; end if;
 if not exists(select 1 from public.org_members om join public.orgs o on o.id=om.org_id where o.slug='mccluster' and om.profile_id=auth.uid() and om.role='owner') then raise exception 'owner_only'; end if;
 select count(*),count(*) filter(where p.status='pending') into v_total,v_pending from public.action_proofs p join public.action_mission_assignments a on a.id=p.assignment_id join public.action_environment_missions e on e.mission_id=a.mission_id;
 select coalesce(jsonb_agg(r order by (r.status='pending') desc,case when r.status='pending' then r.created_at end asc,r.created_at desc,r.proof_id),'[]'::jsonb) into v_rows from (select p.id as proof_id,public.world_environment_proof_revision(p) as proof_revision,p.assignment_id,a.mission_id,m.title,p.proof_type,p.proof_url,p.statement,p.status,p.review_note,p.created_at from public.action_proofs p join public.action_mission_assignments a on a.id=p.assignment_id join public.action_environment_missions e on e.mission_id=a.mission_id join public.action_missions m on m.id=a.mission_id order by (p.status='pending') desc,case when p.status='pending' then p.created_at end asc,p.created_at desc,p.id limit 200) r;
 return jsonb_build_object('proofs',v_rows,'limited',v_total>200,'pending_remaining',greatest(v_pending-200,0),'total_remaining',greatest(v_total-200,0));
end $$;
-- Remove any previously rehearsed unversioned wrapper; never leave a bypass.
drop function if exists public.world_environment_proof_review(uuid,text,text);
create or replace function public.world_environment_proof_review(p_proof uuid,p_decision text,p_expected_revision text,p_review_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_proof public.action_proofs%rowtype;
begin
 if auth.uid() is null then raise exception 'sign_in_required'; end if;
 if not exists(select 1 from public.org_members om join public.orgs o on o.id=om.org_id where o.slug='mccluster' and om.profile_id=auth.uid() and om.role='owner') then raise exception 'owner_only'; end if;
 if p_decision is null or p_decision not in ('verified','rejected') then raise exception 'invalid_decision'; end if;
 if char_length(p_review_note)>2000 then raise exception 'invalid_proof'; end if;
 if p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{32}$' then raise exception 'invalid_proof'; end if;
 -- Same lock order as canonical submit/review: assignment, then proof. This
 -- serializes a simultaneous member replacement before checking what was seen.
 perform 1 from public.action_mission_assignments a join public.action_proofs p on p.assignment_id=a.id join public.action_environment_missions e on e.mission_id=a.mission_id where p.id=p_proof for update of a;
 if not found then raise exception 'proof_not_found'; end if;
 select * into v_proof from public.action_proofs where id=p_proof for update;
 if not found then raise exception 'proof_not_found'; end if;
 if public.world_environment_proof_revision(v_proof)<>p_expected_revision then raise exception 'proof_changed'; end if;
 return public.review_action_proof(p_proof,p_decision,p_review_note);
end $$;
revoke all on function public.world_environment_proof_read(uuid),public.world_environment_proof_submit(uuid,text,text,text,boolean,boolean),public.world_environment_proof_share(uuid,boolean,boolean),public.world_environment_proofs(),public.world_environment_proof_review(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.world_environment_proof_read(uuid),public.world_environment_proof_submit(uuid,text,text,text,boolean,boolean),public.world_environment_proof_share(uuid,boolean,boolean),public.world_environment_proofs(),public.world_environment_proof_review(uuid,text,text,text) to authenticated;
commit;
