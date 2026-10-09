-- Staged: trusted role-gated cohort API functions. Requires the two staged
-- creator team and verification migrations. Do not expose service credentials.
create or replace function public.creator_selection_submit_preference(
 p_cohort uuid,p_candidate uuid,p_role text,p_score integer,p_reason text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_id uuid;
begin
 if v_actor is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from public.action_cohort_members m
   where m.cohort_id=p_cohort and m.user_id=v_actor)
 then raise exception 'Not a cohort participant'; end if;
 if p_candidate=v_actor then raise exception 'Self-rating is not allowed'; end if;
 if not exists(select 1 from public.action_cohort_members m
   where m.cohort_id=p_cohort and m.user_id=p_candidate)
 then raise exception 'Candidate is not in cohort'; end if;
 insert into public.creator_team_preferences(cohort_id,selector_user_id,candidate_user_id,target_role,preference_score,rationale)
 values(p_cohort,v_actor,p_candidate,p_role,p_score,p_reason)
 on conflict(cohort_id,selector_user_id,candidate_user_id,target_role)
 do update set preference_score=excluded.preference_score,rationale=excluded.rationale
 returning id into v_id;
 return v_id;
end $$;
-- No public grants until action_cohort_members identity mapping is verified.
revoke all on function public.creator_selection_submit_preference(uuid,uuid,text,integer,text) from public,anon,authenticated;
create or replace function public.creator_selection_submit_review(
 p_cohort uuid,p_creator uuid,p_media text,p_craft integer,p_fit integer,p_comment text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_id uuid;
begin
 if v_actor is null or not exists(select 1 from public.creator_super_verifications v
   where v.user_id=v_actor and v.status='active')
 then raise exception 'Verified Super Creator required'; end if;
 if not exists(select 1 from public.action_cohort_members m
   where m.cohort_id=p_cohort and m.user_id=p_creator)
 then raise exception 'Creator not in cohort'; end if;
 insert into public.creator_media_reviews(cohort_id,reviewer_user_id,creator_user_id,media_reference,craft_score,fit_score,comment)
 values(p_cohort,v_actor,p_creator,p_media,p_craft,p_fit,p_comment)
 returning id into v_id;
 return v_id;
end $$;
revoke all on function public.creator_selection_submit_review(uuid,uuid,text,integer,integer,text) from public,anon,authenticated;
-- IMPORTANT: no grants yet. Existing action_cohort_members identity column
-- must be reconciled to auth.users before these functions can be deployed.
