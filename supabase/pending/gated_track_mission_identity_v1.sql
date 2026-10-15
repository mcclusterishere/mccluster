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
-- Requires, in order: supabase/pending/policy_fellowship_ladder_v1.sql
-- (action_unlock_rules, action_member_verifications, action_unlock_progress)
-- and supabase/pending/mission_admin_approval_v1.sql
-- (action_member_verified_mission_count). The rule is a DATA ROW
-- (action_unlock_rules 'gated_track_niggy_nigg'); the Worker reads it through
-- music_gate_rule_state / music_gate_claim_rule and only then issues a stream
-- token for the private object. The browser only paints the answer.
--
-- IDENTITY, BY CONTRACT. public.member_identity_verified(uid) is the ONE
-- place "this person's identity is verified" is read. Contract with the
-- identity-verification work (branch feat/identity-verification-levels):
-- a verified identity is a row in action_member_verifications with
-- level = 'v1_live_intro' (the live video introduction), status = 'verified'
-- (approved by the owner), not expired and not revoked. That PR adds the
-- level column; until it exists this helper returns false for everyone
-- (fail closed: nobody unlocks the track by the referral-signup vendor
-- status alone). The identity PR may `create or replace` this function with
-- its final definition; every caller (this gate, any future gate) follows.
--
-- ROLLBACK: supabase/pending/gated_track_mission_identity_v1.rollback.sql.

-- ---------------------------------------------------------------------------
-- 1. IDENTITY: one helper, redefinable by the identity PR.
-- ---------------------------------------------------------------------------
create or replace function public.member_identity_verified(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_ok boolean := false;
begin
  if p_user is null or to_regclass('public.action_member_verifications') is null then return false; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'action_member_verifications' and column_name = 'level') then
    return false;  -- the live-intro level does not exist yet: fail closed
  end if;
  execute 'select exists (select 1 from public.action_member_verifications v
                           where v.user_id = $1 and v.level = ''v1_live_intro'' and v.status = ''verified''
                             and (v.expires_at is null or v.expires_at > now()))'
     into v_ok using p_user;
  return coalesce(v_ok, false);
end;
$$;
revoke all on function public.member_identity_verified(uuid) from public, anon, authenticated;
grant execute on function public.member_identity_verified(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. A NEW REQUIREMENT KIND, AND THE RULE ROW.
-- ---------------------------------------------------------------------------
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_requirement_kind_check;
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_requirement_kind_v2_check;
alter table public.action_unlock_rules add constraint action_unlock_rules_requirement_kind_v2_check
  check (requirement_kind in ('none','signed_in','creator_account','fellow','starter_kinds','verified_referrals',
                              'registration_assists','verified_missions_and_identity'));
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_missions_identity_count_check;
alter table public.action_unlock_rules add constraint action_unlock_rules_missions_identity_count_check
  check (requirement_kind <> 'verified_missions_and_identity' or min_count is not null);

insert into public.action_unlock_rules(rule_key, label, unlock_keys, requirement_kind, required_kinds, min_count, params,
                                       creator_exclusive, enabled, requires_counsel_signoff)
values ('gated_track_niggy_nigg', 'Full track: three verified missions and a verified identity',
        array['music_full_track:niggy-nigg'], 'verified_missions_and_identity', null, 3,
        '{"track_key": "niggy-nigg", "missions_href": "mnet.html?view=missions", "identity_href": "account.html#identity"}'::jsonb,
        false, true, false)
on conflict (rule_key) do nothing;

-- action_unlock_progress as in policy_fellowship_ladder_v1.sql, plus the
-- verified_missions_and_identity branch (and identity_verified in the answer).
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
 v_identity boolean := null;
begin
 select * into r from public.action_unlock_rules where rule_key = p_rule_key;
 if not found then return jsonb_build_object('met', false, 'reason', 'no_rule'); end if;
 if r.requirement_kind = 'none' then
   v_have := 1; v_met := true;
 elsif r.requirement_kind = 'signed_in' then
   v_have := case when p_user is null then 0 else 1 end; v_met := p_user is not null;
 elsif p_user is null then
   v_reason := 'sign_in';
   if r.requirement_kind = 'verified_missions_and_identity' then v_need := r.min_count; v_identity := false; end if;
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
   join public.action_member_verifications v on v.user_id = p.user_id
   where p.referred_by in (select mine.referral_code from public.action_participants mine where mine.user_id = p_user)
     and p.user_id <> p_user
     and v.status = 'verified' and (v.expires_at is null or v.expires_at > now());
   v_met := v_have >= v_need;
 elsif r.requirement_kind = 'registration_assists' then
   v_need := r.min_count; v_reason := 'counting_source_pending_counsel';
 elsif r.requirement_kind = 'verified_missions_and_identity' then
   -- distinct missions an ADMIN verified (mission_admin_approval_v1), and the identity contract
   v_need := r.min_count;
   v_have := public.action_member_verified_mission_count(p_user);
   v_identity := public.member_identity_verified(p_user);
   v_met := v_have >= v_need and v_identity;
   if not v_met then
     v_reason := case when v_have < v_need and not v_identity then 'missions_and_identity'
                      when v_have < v_need then 'missions' else 'identity_verification' end;
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
 return jsonb_strip_nulls(jsonb_build_object('met', v_met, 'have', v_have, 'need', v_need, 'reason', v_reason,
                                             'identity_verified', v_identity));
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
  v jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_have integer; v_need integer; v_identity boolean;
begin
  select * into r from public.action_unlock_rules where rule_key = p_rule;
  -- the rule must exist, be about this track, and be a missions-and-identity rule
  if not found or r.requirement_kind <> 'verified_missions_and_identity'
     or not (('music_full_track:' || p_track) = any(r.unlock_keys)) then
    return jsonb_build_object('mode', 'rule', 'rule', p_rule, 'allowed', false, 'reason', 'no_rule');
  end if;
  v := public.action_unlock_progress(p_user, p_rule);
  v_have := coalesce((v->>'have')::integer, 0);
  v_need := coalesce((v->>'need')::integer, r.min_count);
  v_identity := coalesce((v->>'identity_verified')::boolean, false);
  if p_user is null then v_missing := v_missing || '["sign_in"]'::jsonb; end if;
  if v_have < v_need then v_missing := v_missing || '["missions"]'::jsonb; end if;
  if not v_identity then v_missing := v_missing || '["identity_verification"]'::jsonb; end if;
  if not r.enabled then v_missing := v_missing || '["rule_disabled"]'::jsonb; end if;
  return jsonb_build_object(
    'mode', 'rule', 'rule', p_rule, 'track', p_track,
    'allowed', coalesce((v->>'met')::boolean, false),
    'signed_in', p_user is not null,
    'missions', jsonb_build_object('have', v_have, 'need', v_need),
    'identity_verified', v_identity,
    'missing', v_missing,
    'reason', v->>'reason',
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
