-- GATED TRACK: THREE VERIFIED MISSIONS + A VERIFIED IDENTITY (PENDING: not applied).
--
-- Owner direction, 2026-10-15: on the album "CIA Mind Control", the gated
-- track (data/albums.json: bucket mcc-gated-audio, object niggy-nigg/*) plays
-- in full ONLY for a member with at least three verified missions (distinct
-- missions whose assignment an admin verified) AND a verified identity.
-- Everyone else, signed in or not, hears the public preview. The other two
-- tracks stay freely playable. Preview listens and full listens are counted
-- separately.
--
-- Replaces the listen gate for this track (one completed album listen
-- earned one play: 20261002163249_music_gate_any_album_track). Those
-- functions stay in place, unused, so the Worker can be rolled back alone.
--
-- The rule is a DATA ROW (action_unlock_rules 'gated_track_niggy_nigg');
-- the Worker reads it through music_gate_rule_state / music_gate_claim_rule
-- and only then issues a stream token for the private object. The browser
-- only paints the answer.
--
-- IDENTITY, BY CONTRACT with PR #443 (feat/identity-verification-levels,
-- supabase/pending/20261015230000_identity_verification_levels_v1.sql).
-- A verified identity is a row in action_member_verifications for one
-- PURPOSE, status = 'verified', not expired (revoked rows are not
-- 'verified'): 'referral_signup' = an owner-approved V1 live video
-- introduction; 'halo_full' = an owner-approved V2 plus Persona (#443 adds
-- that purpose). public.member_identity_verified(uid, purpose) is the one
-- place this is read. WHICH purpose the full track needs is DATA: the rule's
-- params.purpose, 'referral_signup' by default. OWNER DECISION: the owner
-- said "we need all the information on you" for the full song, which reads as
-- 'halo_full'; switching is one UPDATE of the rule row (after #443 is applied).
--
-- APPLY ORDER: after policy_fellowship_ladder_v1.sql and
-- mission_admin_approval_v1.sql. Preferred: #440 -> #443 -> this file. This
-- file also applies cleanly BEFORE #443 (it sets the same requirement-kind
-- list and purpose check #443 sets, so #443 re-adds them unchanged). The rule
-- row uses #443's requirement kind 'identity_verified' plus
-- params.min_verified_missions. The track gate (section 3) evaluates the rule
-- itself and never depends on action_unlock_progress; but if #443 is applied
-- AFTER this file, #443's action_unlock_progress replaces the one below and
-- action_unlock_status() then ignores min_verified_missions: re-run section 2
-- of this file afterwards (idempotent), or have #443 carry the same clause.
--
-- ROLLBACK: supabase/pending/gated_track_mission_identity_v1.rollback.sql.

-- ---------------------------------------------------------------------------
-- 1. IDENTITY: one helper; the purpose comes from the rule.
-- ---------------------------------------------------------------------------
drop function if exists public.member_identity_verified(uuid);
create or replace function public.member_identity_verified(p_user uuid, p_purpose text default 'referral_signup')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.action_member_verifications v
     where v.user_id = p_user and v.purpose = coalesce(p_purpose, 'referral_signup') and v.status = 'verified'
       and (v.expires_at is null or v.expires_at > now()))
$$;
revoke all on function public.member_identity_verified(uuid, text) from public, anon, authenticated;
grant execute on function public.member_identity_verified(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. THE RULE ROW, on #443's requirement kind, and the evaluator.
-- ---------------------------------------------------------------------------
-- Exactly the list and purpose check #443 sets (it drops and re-adds both by
-- these names), so the two files agree in either order.
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_requirement_kind_check;
alter table public.action_unlock_rules add constraint action_unlock_rules_requirement_kind_check check (requirement_kind in
 ('none','signed_in','creator_account','fellow','starter_kinds','verified_referrals','identity_verified'));
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_identity_purpose_check;
alter table public.action_unlock_rules add constraint action_unlock_rules_identity_purpose_check
 check (requirement_kind <> 'identity_verified' or params->>'purpose' in ('referral_signup','halo_full'));

insert into public.action_unlock_rules(rule_key, label, unlock_keys, requirement_kind, required_kinds, min_count, params,
                                       creator_exclusive, enabled, requires_counsel_signoff)
values ('gated_track_niggy_nigg', 'Full track: three verified missions and a verified identity',
        array['music_full_track:niggy-nigg'], 'identity_verified', null, null,
        '{"purpose": "referral_signup", "min_verified_missions": 3, "track_key": "niggy-nigg",
          "missions_href": "mnet.html?view=missions", "identity_href": "identity-verify.html"}'::jsonb,
        false, true, false)
on conflict (rule_key) do nothing;

-- action_unlock_progress exactly as #443 ships it (policy_fellowship_ladder_v1
-- + per-purpose verified_referrals + 'identity_verified'), plus the
-- params.min_verified_missions clause, so action_unlock_status() tells the
-- truth about this rule too.
create or replace function public.action_unlock_progress(p_user uuid, p_rule_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
 r public.action_unlock_rules%rowtype;
 v_have integer := 0;
 v_need integer := 1;
 v_met boolean := false;
 v_reason text := null;
begin
 select * into r from public.action_unlock_rules where rule_key = p_rule_key;
 if not found then return jsonb_build_object('met', false, 'reason', 'no_rule'); end if;
 if r.requirement_kind = 'none' then
   v_have := 1; v_met := true;
 elsif r.requirement_kind = 'signed_in' then
   v_have := case when p_user is null then 0 else 1 end; v_met := p_user is not null;
 elsif p_user is null then
   v_reason := 'sign_in';
 elsif r.requirement_kind = 'creator_account' then
   v_met := exists (select 1 from public.creator_billing_subscriptions s
     where s.owner_user_id = p_user and s.status = 'active' and s.current_period_end > now());
   v_have := case when v_met then 1 else 0 end;
 elsif r.requirement_kind = 'fellow' then
   v_met := exists (select 1 from public.action_fellowship_applications f where f.user_id = p_user and f.status = 'accepted');
   v_have := case when v_met then 1 else 0 end;
 elsif r.requirement_kind = 'starter_kinds' then
   v_need := coalesce(r.min_count, cardinality(r.required_kinds));
   select count(distinct k.kind) into v_have
   from public.action_mission_assignments a
   join public.action_ladder_mission_kinds k on k.mission_id = a.mission_id
   where a.user_id = p_user and a.status = 'verified' and k.kind = any(r.required_kinds);
   v_met := v_have >= v_need;
 elsif r.requirement_kind = 'verified_referrals' then
   v_need := r.min_count;
   select count(distinct p.user_id) into v_have
   from public.action_participants p
   join public.action_member_verifications v on v.user_id = p.user_id and v.purpose = 'referral_signup'
   where p.referred_by in (select mine.referral_code from public.action_participants mine where mine.user_id = p_user)
     and p.user_id <> p_user
     and v.status = 'verified' and (v.expires_at is null or v.expires_at > now());
   v_met := v_have >= v_need;
 elsif r.requirement_kind = 'identity_verified' then
   v_met := exists (select 1 from public.action_member_verifications v
     where v.user_id = p_user and v.purpose = r.params->>'purpose' and v.status = 'verified'
       and (v.expires_at is null or v.expires_at > now()));
   v_have := case when v_met then 1 else 0 end;
   -- (this file) a rule may also need N admin-verified missions: params.min_verified_missions
   if r.params ? 'min_verified_missions' then
     v_need := (r.params->>'min_verified_missions')::integer;
     v_have := public.action_member_verified_mission_count(p_user);
     if v_have < v_need then v_met := false; v_reason := 'missions'; end if;
   end if;
 end if;
 if v_met and coalesce((r.params->>'requires_fellow')::boolean, false) and not exists (
   select 1 from public.action_fellowship_applications f where f.user_id = p_user and f.status = 'accepted') then
   v_met := false; v_reason := coalesce(v_reason, 'requires_fellow');
 end if;
 if v_met and r.creator_exclusive and exists (select 1 from public.creator_billing_subscriptions s
   where s.owner_user_id = p_user and s.status = 'active' and s.current_period_end > now()) then
   v_met := false; v_reason := 'creator_exclusive';
 end if;
 if r.requires_counsel_signoff and r.counsel_signoff_at is null then v_met := false; v_reason := 'requires_counsel_signoff';
 elsif not r.enabled then v_met := false; v_reason := coalesce(v_reason, 'disabled');
 end if;
 return jsonb_strip_nulls(jsonb_build_object('met', v_met, 'have', v_have, 'need', v_need, 'reason', v_reason));
end;
$$;
revoke all on function public.action_unlock_progress(uuid, text) from public, anon, authenticated;
grant execute on function public.action_unlock_progress(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. THE GATE THE WORKER ASKS. Service role only; p_user null = signed out.
-- ---------------------------------------------------------------------------
create or replace function public.music_gate_rule_state(p_user uuid, p_track text, p_rule text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.action_unlock_rules%rowtype;
  v_missing jsonb := '[]'::jsonb;
  v_have integer; v_need integer; v_identity boolean; v_live boolean; v_allowed boolean;
begin
  select * into r from public.action_unlock_rules where rule_key = p_rule;
  -- the rule must exist, be about this track, and be an identity rule with a missions count.
  -- Evaluated here, not through the generic evaluator, so the gate is right whichever
  -- order this file and #443 were applied in.
  if not found or r.requirement_kind <> 'identity_verified' or not (r.params ? 'min_verified_missions')
     or not (('music_full_track:' || p_track) = any(r.unlock_keys)) then
    return jsonb_build_object('mode', 'rule', 'rule', p_rule, 'allowed', false, 'reason', 'no_rule');
  end if;
  v_need := greatest(coalesce((r.params->>'min_verified_missions')::integer, 3), 0);
  v_have := public.action_member_verified_mission_count(p_user);
  v_identity := public.member_identity_verified(p_user, r.params->>'purpose');
  v_live := r.enabled and not (r.requires_counsel_signoff and r.counsel_signoff_at is null);
  v_allowed := p_user is not null and v_live and v_have >= v_need and v_identity;
  if p_user is null then v_missing := v_missing || '["sign_in"]'::jsonb; end if;
  if v_have < v_need then v_missing := v_missing || '["missions"]'::jsonb; end if;
  if not v_identity then v_missing := v_missing || '["identity_verification"]'::jsonb; end if;
  if not v_live then v_missing := v_missing || '["rule_disabled"]'::jsonb; end if;
  return jsonb_build_object(
    'mode', 'rule', 'rule', p_rule, 'track', p_track,
    'allowed', v_allowed,
    'signed_in', p_user is not null,
    'missions', jsonb_build_object('have', v_have, 'need', v_need),
    'identity_verified', v_identity,
    'identity_purpose', r.params->>'purpose',
    'missing', v_missing,
    'reason', case when v_allowed then null when p_user is null then 'sign_in' when not v_live then 'disabled'
                   when v_have < v_need and not v_identity then 'missions_and_identity'
                   when v_have < v_need then 'missions' else 'identity_verification' end,
    'links', jsonb_strip_nulls(jsonb_build_object('missions', r.params->>'missions_href', 'identity', r.params->>'identity_href')));
end;
$$;

-- Issue one stream token for the private object, only when the rule is met.
-- A locked caller gets the state with claimed = false and NO play row.
create or replace function public.music_gate_claim_rule(p_user uuid, p_track text, p_rule text,
                                                        p_token text, p_stream_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_state jsonb; v_play uuid;
begin
  if p_user is null then
    return public.music_gate_rule_state(null, p_track, p_rule) || jsonb_build_object('claimed', false);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('music_gate:' || p_user::text || ':' || p_track, 0));
  v_state := public.music_gate_rule_state(p_user, p_track, p_rule);
  if not coalesce((v_state->>'allowed')::boolean, false) then
    return v_state || jsonb_build_object('claimed', false);
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'bad stream token'; end if;
  insert into public.music_gated_plays (user_id, track_key, stream_token, stream_expires_at)
  values (p_user, p_track, p_token, now() + make_interval(secs => least(greatest(coalesce(p_stream_seconds, 300), 30), 900)))
  returning id into v_play;
  return v_state || jsonb_build_object('claimed', true, 'play_id', v_play);
end;
$$;
revoke all on function public.music_gate_rule_state(uuid, text, text) from public, anon, authenticated;
revoke all on function public.music_gate_claim_rule(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.music_gate_rule_state(uuid, text, text) to service_role;
grant execute on function public.music_gate_claim_rule(uuid, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. PREVIEW AND FULL LISTENS ARE DIFFERENT STAGES IN THE TAXONOMY.
-- The names already exist (js/music-engine.js, the owner analytics counts
-- music_preview_play and music_full_play apart); they were unmapped.
-- ---------------------------------------------------------------------------
do $tax$ begin
  if to_regclass('public.event_taxonomy') is null then return; end if;
  insert into public.event_taxonomy(event_name, stage, note) values
    ('music_preview_play', 'content', 'The public preview of a track started (a gated track for anyone not entitled to it).'),
    ('music_full_play', 'content', 'The full track started (for a gated track: a Worker-issued play for an entitled member).')
  on conflict (event_name) do nothing;
end $tax$;
