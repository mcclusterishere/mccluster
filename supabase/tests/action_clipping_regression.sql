-- Clipping marketplace regression: creator -> clipper -> platform metrics ->
-- earnings -> conversions -> release -> payout, through the real functions,
-- signed in as each party in turn. Runs in a transaction that is rolled back.
\set ON_ERROR_STOP on
begin;

-- who is calling: the same claims Supabase sets for a signed-in request
create function pg_temp.sign_in(p_user uuid, p_email text default null) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', case when p_user is null then '' else
           json_build_object('sub', p_user, 'email', coalesce(p_email, ''), 'role', 'authenticated')::text end, true);
$$;
create function pg_temp.raises(p_sql text, p_like text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm not ilike p_like then raise notice 'unexpected error: %', sqlerrm; return false; end if;
  return true;
end $$;

-- the M person behind a sign-in: the m_auth_user_after_insert trigger on auth.users makes it on a real
-- rebuild; anything without that trigger gets one made here
create function pg_temp.m_for(p_user uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  select m_uid into v from public.m_auth_user_links where auth_user_id = p_user;
  if v is null then
    insert into public.m_people default values returning id into v;
    insert into public.m_auth_user_links (auth_user_id, m_uid) values (p_user, v);
  end if;
  return v;
end $$;

create temp table t (k text primary key, v text);
grant all on t to public;

do $$
declare
  house uuid := (select id from public.orgs where slug = 'mccluster');
  other uuid := (select id from public.orgs where slug = 'esmer');
  u_creator uuid := gen_random_uuid(); m_creator uuid;
  u_clipper uuid := gen_random_uuid(); m_clipper uuid;
  u_other uuid := gen_random_uuid(); m_other uuid;
  u_fan1 uuid := gen_random_uuid(); m_fan1 uuid;
  u_fan2 uuid := gen_random_uuid(); m_fan2 uuid;
  v_song uuid; v_audio uuid;
begin
  insert into auth.users (id, email, email_confirmed_at, created_at) values
    (u_creator, 'creator@example.com', now(), now() - interval '1 year'),
    (u_clipper, 'clipper@example.com', now(), now() - interval '1 month'),
    (u_other, 'other@example.com', now(), now() - interval '1 month'),
    (u_fan1, 'fan1@example.com', now() + interval '1 hour', now() + interval '1 hour'),
    (u_fan2, 'fan2@example.com', null, now() + interval '1 hour');
  m_creator := pg_temp.m_for(u_creator);
  m_clipper := pg_temp.m_for(u_clipper);
  m_other := pg_temp.m_for(u_other);
  m_fan1 := pg_temp.m_for(u_fan1);
  m_fan2 := pg_temp.m_for(u_fan2);
  insert into public.org_members (org_id, profile_id, role) values (house, u_creator, 'owner'), (other, u_other, 'owner');
  insert into public.music_catalog_objects (catalog_key, album_slug, album_title, track_title, artist_name, canonical_url)
  values ('regress-album:regress-pull-up', 'regress-album', 'Regress Album', 'Regress Pull Up', 'Matthew McCluster',
          'https://matthew.mccluster.org/album.html?album=regress-album&t=Regress%20Pull%20Up')
  returning id into v_song;
  insert into public.network_media_assets (owner_m_uid, object_path, media_type, mime_type, status)
  values (m_creator, 'regress/clip-source-' || gen_random_uuid() || '.mp3', 'audio', 'audio/mpeg', 'ready')
  returning id into v_audio;
  insert into t values ('house', house), ('other', other), ('u_creator', u_creator), ('m_creator', m_creator),
    ('u_clipper', u_clipper), ('m_clipper', m_clipper), ('u_other', u_other), ('u_fan1', u_fan1), ('u_fan2', u_fan2),
    ('song', v_song), ('audio', v_audio);
end $$;

-- 1. The creator side: tenant boundaries, platform policy, funding before launch.
do $$
declare
  house uuid := (select v::uuid from t where k = 'house');
  other uuid := (select v::uuid from t where k = 'other');
  v_terms jsonb;
  r jsonb;
  mission uuid;
begin
  v_terms := jsonb_build_object(
    'org_id', house, 'title', 'Clip Regress Pull Up', 'description', 'Use the hook.',
    'music_object_id', (select v from t where k = 'song'), 'platforms', jsonb_build_array('instagram'),
    'rules', 'Use the hook, tag the song.', 'required_tags', jsonb_build_array('#pullup'),
    'budget_cents', 10000, 'base_cpm_cents', 300, 'min_views', 1000, 'per_clip_cap_cents', 5000,
    'per_clipper_cap_cents', 10000, 'max_clips_per_clipper', 3, 'earning_window_days', 30,
    'keep_live_days', 0, 'hold_days', 0, 'bonus_account_cents', 200, 'bonus_listen_cents', 50, 'approval_mode', 'creator',
    'assets', jsonb_build_array(
      jsonb_build_object('kind', 'audio', 'label', 'Clean hook stem', 'asset_id', (select v from t where k = 'audio')),
      jsonb_build_object('kind', 'moment', 'label', 'The hook', 'start_ms', 42000, 'end_ms', 58000)));

  perform pg_temp.sign_in((select v::uuid from t where k = 'u_other'), 'other@example.com');
  assert pg_temp.raises(format('select public.clip_campaign_create(%L::jsonb)', v_terms || jsonb_build_object('org_id', other)),
                        '%house catalogue%'), 'another tenant cannot clip the house catalogue';
  assert pg_temp.raises(format('select public.clip_campaign_create(%L::jsonb)', v_terms), '%not authorized%'),
         'nobody creates campaigns in an org they do not own';

  perform pg_temp.sign_in((select v::uuid from t where k = 'u_creator'), 'creator@example.com');
  assert pg_temp.raises(format('select public.clip_campaign_create(%L::jsonb)', v_terms || jsonb_build_object('platforms', jsonb_build_array('youtube'))),
                        '%only Instagram%'), 'YouTube cannot be verified, so it cannot be paid for';
  r := public.clip_campaign_create(v_terms);
  mission := (r->>'mission_id')::uuid;
  insert into t values ('mission', mission);
  assert (select kind from public.action_missions where id = mission) = 'clip', 'the campaign is an Action Network mission of kind clip';
  assert (select status from public.action_missions where id = mission) = 'draft';
  assert (select count(*) from public.action_clip_assets where mission_id = mission) = 2, 'source asset and song moment attached';
  assert (select action_mission_id from public.social_content_items where id = (r->>'content_id')::uuid) = mission, 'the brief is a content item';
  insert into t values ('moment', (select id from public.action_clip_assets where mission_id = mission and kind = 'moment'));

  assert pg_temp.raises(format('select public.clip_campaign_set_status(%L, ''live'')', mission), '%fund the campaign%'),
         'nothing goes live unfunded';
  assert pg_temp.raises(format('select public.clip_campaign_fund(%L, 6000, ''contribution'', ''stripe'', ''pi_typed_in'', '''')', mission),
         '%card funding is not connected%'), 'a creator cannot type in a provider-verified payment';
  r := public.clip_campaign_fund(mission, 6000, 'program_allocation', 'internal', null, 'first allocation');
  assert (r->'money'->>'funded_cents')::bigint = 6000 and (r->'money'->>'available_cents')::bigint = 6000, 'funded';
  r := public.clip_campaign_set_status(mission, 'live');
  assert (select status from public.action_missions where id = mission) = 'open', 'live campaign opens its mission';
  assert jsonb_array_length(public.clip_campaigns_open()) >= 1, 'listed for clippers';
  assert pg_temp.raises(format('select public.clip_campaign_update(%L, ''{"base_cpm_cents": 900}''::jsonb)', mission), '%only the rules%'),
         'a live campaign''s rate cannot change under its clippers';
  assert pg_temp.raises(format('select public.clip_campaign_update(%L, ''{"budget_cents": 5000}''::jsonb)', mission), '%only grow%'),
         'a live campaign''s budget can only grow';
  assert pg_temp.raises(format('select public.clip_campaign_claim(%L)', mission), '%your own campaign%'),
         'a creator cannot clip their own campaign for pay';
end $$;

-- 2. The clipper: claim, civic isolation, a verified account, submissions.
do $$
declare
  mission uuid := (select v::uuid from t where k = 'mission');
  r jsonb; again jsonb; acct uuid; assignment uuid;
begin
  perform pg_temp.sign_in((select v::uuid from t where k = 'u_clipper'), 'clipper@example.com');
  r := public.clip_campaign_claim(mission);
  again := public.clip_campaign_claim(mission);
  assert again->>'claim_id' = r->>'claim_id' and (again->>'idempotent')::boolean, 'claiming twice is one claim';
  assert r->>'ref_code' ~ '^clip-[a-z0-9]{10}$', 'the claim carries its tracking code';
  insert into t values ('claim', r->>'claim_id'), ('claim_code', r->>'ref_code');
  assignment := (select assignment_id from public.action_clip_claims where id = (r->>'claim_id')::uuid);
  assert (select status from public.action_mission_assignments where id = assignment) = 'in_progress', 'the claim is a mission assignment';

  -- civic scoring never sees clip work
  assert pg_temp.raises(format('insert into public.action_proofs (assignment_id, user_id, proof_type) values (%L, %L, ''link'')',
                               assignment, (select v from t where k = 'u_clipper')), '%clip settlement%'), 'no civic proof on a clip';
  assert pg_temp.raises(format('insert into public.action_points_ledger (m_uid, assignment_id, kind, points, reason) values (%L, %L, ''mission'', 100, ''x'')',
                               (select v from t where k = 'm_clipper'), assignment), '%clip settlement%'), 'no civic points for views';

  assert pg_temp.raises('select public.clip_account_register(''youtube'', ''@clipperk'')', '%cannot be verified yet%'),
         'YouTube accounts are not accepted on trust';
  r := public.clip_account_register('instagram', '@ClipperK');
  acct := (r->>'account_id')::uuid;
  assert r->>'code' ~ '^MCC-[0-9A-F]{8}$' and not (r->>'verified')::boolean, 'a code to put in the bio';
  assert (select org_id from public.social_accounts where id = acct) = (select id from public.orgs where slug = 'action-network'),
         'a member''s account lives in the network org, not the creator''s tenant';
  insert into t values ('acct', acct);

  r := public.clip_submit(mission, 'instagram', 'https://www.instagram.com/reel/ABCdef12345/', (select v::uuid from t where k = 'moment'));
  assert r->>'media_id' = 'ABCdef12345', 'the media id is parsed server-side';
  insert into t values ('sub1', r->>'submission_id');
  assert pg_temp.raises(format('select public.clip_submit(%L, ''instagram'', ''https://instagram.com/reel/ABCdef12345'')', mission), '%already been submitted%'),
         'one post, one submission';
  assert pg_temp.raises(format('select public.clip_submit(%L, ''tiktok'', ''https://www.tiktok.com/@k/video/1234567890'')', mission), '%does not pay for%'),
         'only the campaign''s platforms';
  assert pg_temp.raises(format('select public.clip_submit(%L, ''instagram'', ''https://example.com/reel/x'')', mission), '%paste the link%'),
         'only a real post URL';
  r := public.clip_submit(mission, 'instagram', 'https://www.instagram.com/reel/SECOND12345/');
  insert into t values ('sub2', r->>'submission_id');
  r := public.clip_submit(mission, 'instagram', 'https://www.instagram.com/reel/THIRD123456/');
  insert into t values ('sub3', r->>'submission_id');
  assert pg_temp.raises(format('select public.clip_submit(%L, ''instagram'', ''https://www.instagram.com/reel/FOURTH12345/'')', mission), '%most clips%'),
         'per-clipper clip limit';
end $$;

-- 3. The server's side: account verification, clip verification, metrics, settlement.
do $$
declare
  mission uuid := (select v::uuid from t where k = 'mission');
  sub1 uuid := (select v::uuid from t where k = 'sub1');
  sub2 uuid := (select v::uuid from t where k = 'sub2');
  sub3 uuid := (select v::uuid from t where k = 'sub3');
  r jsonb; post uuid; m record;
begin
  perform pg_temp.sign_in(null);
  -- a verification from an account the clipper has not proven is refused
  r := public.clip_record_verification(sub1, jsonb_build_object('available', true, 'found', true, 'live', true,
         'owner_account_id', '17841400000000001', 'caption', 'Pull up #pullup', 'posted_at', now(), 'views', 500));
  assert r->>'status' = 'submitted' or r->>'status' = 'rejected', 'answered';
  assert (select status from public.action_clip_submissions where id = sub1) = 'rejected'
     and (select rejection_reason from public.action_clip_submissions where id = sub1) like '%not on a platform account you have verified%',
         'ownership is proven by the platform, not claimed';
  -- reset that clip for the rest of the run, as a fresh submission would be
  update public.action_clip_submissions set status = 'submitted', rejection_reason = null, verified_at = null where id = sub1;

  r := public.clip_account_mark_verified((select v::uuid from t where k = 'acct'),
         jsonb_build_object('external_account_id', '17841400000000001', 'handle', 'clipperk'));
  assert (select owner_verified_at is not null from public.social_accounts where id = (select v::uuid from t where k = 'acct')), 'verified';

  r := public.clip_record_verification(sub1, jsonb_build_object('available', true, 'found', true, 'live', true,
         'owner_account_id', '17841400000000001', 'caption', 'No tag here', 'posted_at', now(), 'views', 500));
  assert (select rejection_reason from public.action_clip_submissions where id = sub1) like '%missing #pullup%', 'content rules are checked on the real caption';
  update public.action_clip_submissions set status = 'submitted', rejection_reason = null, verified_at = null where id = sub1;

  r := public.clip_record_verification(sub1, jsonb_build_object('available', true, 'found', true, 'live', true,
         'owner_account_id', '17841400000000001', 'caption', 'The hook #PullUp', 'posted_at', now(),
         'platform_media_id', '18000000000000001', 'views', 500, 'likes', 60, 'comments', 5, 'shares', 3));
  assert r->>'status' = 'tracking', 'verified clip is tracked';
  post := (r->>'post_id')::uuid;
  assert (select org_id from public.social_posts where id = post) = (select id from public.orgs where slug = 'action-network')
     and (select content_id from public.social_posts where id = post) is not null, 'canonical post, linked to the campaign brief';
  assert (select metadata->>'platform_media_id' from public.social_posts where id = post) = '18000000000000001';
  assert (select count(*) from public.action_clip_earnings where submission_id = sub1) = 0, 'below the minimum views nothing is earned';

  -- an owner-typed number can never move money
  insert into public.social_metric_snapshots (org_id, post_id, views, source) values ((select org_id from public.social_posts where id = post), post, 1000000, 'reported');
  perform public.clip_settle_submission(sub1);
  assert (select count(*) from public.action_clip_earnings where submission_id = sub1) = 0, 'reported views earn nothing';

  r := public.clip_record_metrics(sub1, jsonb_build_object('available', true, 'found', true, 'live', true, 'views', 20000, 'likes', 2000, 'comments', 100, 'shares', 50));
  select * into m from public.action_clip_submissions where id = sub1;
  assert m.payable_views = 20000 and m.earned_view_cents = 5000, 'CPM $3 on 20,000 views is $60, capped at the $50 per-clip cap';
  r := public.clip_record_metrics(sub1, jsonb_build_object('available', true, 'found', true, 'live', true, 'views', 20000, 'likes', 2000, 'comments', 100, 'shares', 50));
  assert (select count(*) from public.action_clip_earnings where submission_id = sub1) = 1, 'the same numbers settle once';

  -- the second clip runs into the funded amount and pauses the campaign
  r := public.clip_record_verification(sub2, jsonb_build_object('available', true, 'found', true, 'live', true,
         'owner_account_id', '17841400000000001', 'caption', '#pullup', 'posted_at', now(), 'views', 10000, 'likes', 900, 'comments', 40, 'shares', 10));
  assert (select earned_view_cents from public.action_clip_submissions where id = sub2) = 1000, 'only the $10 still funded accrues';
  assert (select status from public.action_clip_campaigns where mission_id = mission) = 'paused'
     and (select budget_exhausted_at is not null from public.action_clip_campaigns where mission_id = mission), 'funding reached: paused';
  assert (select committed_cents from private.clip_money(mission)) = 6000, 'never past verified funding';
end $$;

-- 4. More funding, conversions, fraud, review, release, removal, payout.
do $$
declare
  mission uuid := (select v::uuid from t where k = 'mission');
  sub1 uuid := (select v::uuid from t where k = 'sub1');
  sub2 uuid := (select v::uuid from t where k = 'sub2');
  sub3 uuid := (select v::uuid from t where k = 'sub3');
  code text := (select v from t where k = 'claim_code');
  m_clipper uuid := (select v::uuid from t where k = 'm_clipper');
  house uuid := (select v::uuid from t where k = 'house');
  r jsonb; v_payable bigint;
begin
  perform pg_temp.sign_in((select v::uuid from t where k = 'u_creator'), 'creator@example.com');
  perform public.clip_campaign_fund(mission, 4000, 'program_allocation', 'internal', null, 'top-up');
  perform public.clip_campaign_set_status(mission, 'live');

  perform pg_temp.sign_in(null);
  perform public.clip_settle_submission(sub2);
  assert (select earned_view_cents from public.action_clip_submissions where id = sub2) = 3000, 'the rest accrues once funded: 10,000 views at $3 CPM';

  -- first-party record: a fan arrives through the clip code, signs up, then listens to the song in full
  insert into public.events (name, at, props, uid, device_id) values
    ('page_view', now(), jsonb_build_object('acq', 'clip/instagram/' || code), null, 'dev-fan1'),
    ('album_play', now(), jsonb_build_object('acq', 'clip/instagram/' || code), null, 'dev-fan1'),
    ('account_created', now(), jsonb_build_object('acq', 'clip/instagram/' || code, 'campaign', code), (select v::uuid from t where k = 'u_fan1'), 'dev-fan1'),
    ('account_created', now(), jsonb_build_object('acq', 'clip/instagram/' || code, 'campaign', code), (select v::uuid from t where k = 'u_fan2'), 'dev-fan2'),
    ('account_created', now(), jsonb_build_object('acq', 'clip/instagram/' || code, 'campaign', code), (select v::uuid from t where k = 'u_clipper'), 'dev-k');
  insert into public.music_listens (user_id, track_key, min_seconds, finished_at, completed, heard_seconds)
  values ((select v::uuid from t where k = 'u_fan1'), 'regress-pull-up', 90, now() + interval '1 minute', true, 120);
  r := public.clip_attribute_conversions(now() - interval '1 hour');
  assert (select qualified from public.action_clip_conversions where kind = 'account' and converted_user_id = (select v::uuid from t where k = 'u_fan1')),
         'a new, confirmed account from the clip code qualifies';
  assert (select disqualified_reason from public.action_clip_conversions where converted_user_id = (select v::uuid from t where k = 'u_fan2') and kind = 'account')
         like '%confirmed%', 'an unconfirmed account does not';
  assert (select disqualified_reason from public.action_clip_conversions where converted_user_id = (select v::uuid from t where k = 'u_clipper') and kind = 'account')
         like '%own account%', 'the clipper''s own sign-up does not';
  assert (select qualified from public.action_clip_conversions where kind = 'listen' and converted_user_id = (select v::uuid from t where k = 'u_fan1')),
         'a server-measured full listen of the song (plain slug vs album:slug) qualifies';
  assert (select coalesce(sum(amount_cents), 0) from public.action_clip_earnings where mission_id = mission and kind like 'bonus_%') = 250,
         '$2 account bonus + $0.50 listen bonus';
  r := public.clip_attribute_conversions(now() - interval '1 hour');
  assert (select count(*) from public.action_clip_conversions where mission_id = mission) = 4, 'a second pass adds nothing';

  -- a clip with bought views: huge reach, almost no engagement
  r := public.clip_record_verification(sub3, jsonb_build_object('available', true, 'found', true, 'live', true,
         'owner_account_id', '17841400000000001', 'caption', '#pullup', 'posted_at', now(), 'views', 100000, 'likes', 10));
  assert (select status from public.action_clip_submissions where id = sub3) = 'held'
     and (select 'low_engagement' = any (fraud_flags) from public.action_clip_submissions where id = sub3), 'held for review, with its reason';
  assert (select committed_cents from private.clip_money(mission)) <= 10000, 'still never past funding';

  -- release: approved, live after keep-live, hold over. Clip 1 is not approved yet.
  r := public.clip_release_due();
  assert (select state from public.action_clip_earnings where submission_id = sub1 limit 1) = 'held', 'unreviewed clip stays held';
  assert (select count(*) from public.action_clip_earnings where mission_id = mission and kind like 'bonus_%' and state = 'payable') = 2, 'conversion bonuses release';

  perform pg_temp.sign_in((select v::uuid from t where k = 'u_clipper'), 'clipper@example.com');
  assert pg_temp.raises(format('select public.clip_review_submission(%L, ''approve'')', sub1), '%not authorized%'), 'clippers do not approve clips';
  perform pg_temp.sign_in((select v::uuid from t where k = 'u_creator'), 'creator@example.com');
  perform public.clip_review_submission(sub1, 'approve', 'Great hook');
  perform public.clip_review_submission(sub2, 'approve');
  perform public.clip_review_submission(sub3, 'reject', 'Bought views');
  assert (select count(*) from public.action_clip_earnings where submission_id = sub3 and state <> 'void') = 0, 'rejection voids the held earnings';
  perform pg_temp.sign_in(null);
  r := public.clip_release_due();
  assert (select bool_and(state = 'payable') from public.action_clip_earnings where submission_id in (sub1, sub2)), 'approved clips become payable';

  -- a later refresh finds clip 2 deleted after its keep-live period: it closes, earnings stand
  r := public.clip_record_metrics(sub2, jsonb_build_object('available', true, 'found', false, 'live', false));
  assert (select status from public.action_clip_submissions where id = sub2) = 'closed', 'removed after keep-live: closed, still paid';

  -- payout: everything payable to the clipper in this org, once
  perform pg_temp.sign_in((select v::uuid from t where k = 'u_creator'), 'creator@example.com');
  select coalesce(sum(amount_cents), 0) into v_payable from public.action_clip_earnings where m_uid = m_clipper and state = 'payable';
  assert v_payable = 5000 + 3000 + 250, 'payable = both approved clips + bonuses';
  r := public.clip_record_payout(house, m_clipper, 'manual', 'regress-payout-001', 'Zelle');
  assert (r->>'amount_cents')::bigint = v_payable, 'paid what was payable';
  assert (select count(*) from public.action_clip_earnings where m_uid = m_clipper and state = 'payable') = 0, 'nothing left payable';
  r := public.clip_record_payout(house, m_clipper, 'manual', 'regress-payout-001');
  assert (r->>'idempotent')::boolean, 'the same payout reference is one payout';
  assert pg_temp.raises(format('select public.clip_record_payout(%L, %L, ''manual'', ''regress-payout-002'')', house, m_clipper), '%nothing is payable%'),
         'no double payment';
end $$;

-- 5. Deleted inside the keep-live period: its earnings are voided. Then what each side can read.
do $$
declare
  mission uuid := (select v::uuid from t where k = 'mission');
  r jsonb; sub4 uuid; d jsonb; w jsonb; u_fan3 uuid := gen_random_uuid();
begin
  update public.action_clip_campaigns set keep_live_days = 7 where mission_id = mission;  -- a stricter campaign
  perform pg_temp.sign_in((select v::uuid from t where k = 'u_clipper'), 'clipper@example.com');
  r := public.clip_submit(mission, 'instagram', 'https://www.instagram.com/reel/FOURTH12345/');
  sub4 := (r->>'submission_id')::uuid;
  perform pg_temp.sign_in(null);
  perform public.clip_record_verification(sub4, jsonb_build_object('available', true, 'found', true, 'live', true,
         'owner_account_id', '17841400000000001', 'caption', '#pullup', 'posted_at', now(), 'views', 5000, 'likes', 400));
  assert (select earned_view_cents from public.action_clip_submissions where id = sub4) = 1500, 'accrued while live';
  r := public.clip_record_metrics(sub4, jsonb_build_object('available', true, 'found', false, 'live', false));
  assert (select status from public.action_clip_submissions where id = sub4) = 'removed', 'deleted before keep-live: removed';
  assert (select count(*) from public.action_clip_earnings where submission_id = sub4 and state <> 'void') = 0, 'and earns nothing';

  -- a platform that cannot be read yet waits; it is never paid on trust
  r := public.clip_record_verification(sub4, jsonb_build_object('available', false, 'reason', 'not connected'));
  assert (r->>'status') = 'removed' or (r->>'idempotent')::boolean, 'a settled clip is not re-verified';

  perform pg_temp.sign_in((select v::uuid from t where k = 'u_creator'), 'creator@example.com');
  d := public.clip_campaign_dashboard(mission);
  assert (d->'money'->>'funded_cents')::bigint = 10000 and (d->'money'->>'paid_cents')::bigint = 8250, 'spend and payouts';
  assert (d->'money'->>'committed_cents')::bigint <= (d->'money'->>'funded_cents')::bigint, 'committed never above funded';
  assert (d->'totals'->>'verified_views')::bigint = 30000, 'verified views count tracked and closed clips, not rejected or removed ones';
  assert (d->'totals'->>'verified_accounts')::int = 1 and (d->'totals'->>'verified_listens')::int = 1, 'verified conversions';
  assert (d->'totals'->>'visits')::int = 1 and (d->'totals'->>'plays')::int = 1, 'first-party funnel by clip code';
  assert jsonb_array_length(d->'clippers') = 1 and (d->'clippers'->0->>'quality')::numeric > 0, 'clipper ranked by reach and conversion quality';
  assert (d->'moments'->0->>'clips')::int = 1, 'song moments carry their clips';
  assert jsonb_array_length(d->'payouts') = 1, 'payout listed';

  perform pg_temp.sign_in((select v::uuid from t where k = 'u_other'), 'other@example.com');
  assert pg_temp.raises(format('select public.clip_campaign_dashboard(%L)', mission), '%not authorized%'), 'another tenant cannot read it';
  assert pg_temp.raises(format('select public.clip_campaigns_for_org(%L)', (select v from t where k = 'house')), '%not authorized%');

  perform pg_temp.sign_in((select v::uuid from t where k = 'u_clipper'), 'clipper@example.com');
  assert pg_temp.raises(format('select public.clip_campaign_dashboard(%L)', mission), '%not authorized%'), 'clippers do not see the creator''s dashboard';
  assert (public.action_record()->>'in_progress')::int = 0 and jsonb_array_length(public.action_record()->'missions') = 0,
         'the civic Action Record does not count paid clip work';
  w := public.clip_my_work();
  assert (w->'totals'->>'paid_cents')::bigint = 8250 and jsonb_array_length(w->'claims') = 1, 'the clipper sees their own work and pay';
  assert jsonb_array_length(w->'claims'->0->'submissions') = 4, 'every clip, including rejected and removed, with reasons';

  -- a clipper with no verified clip earns no conversion bonus, however many sign-ups their link brings
  perform pg_temp.sign_in((select v::uuid from t where k = 'u_other'), 'other@example.com');
  r := public.clip_campaign_claim(mission);
  perform pg_temp.sign_in(null);
  insert into auth.users (id, email, email_confirmed_at, created_at)
  values (u_fan3, 'fan3@example.com', now() + interval '2 hours', now() + interval '2 hours');
  insert into public.events (name, at, props, uid, device_id)
  values ('account_created', now(), jsonb_build_object('acq', 'clip/instagram/' || (r->>'ref_code'), 'campaign', r->>'ref_code'), u_fan3, 'dev-fan3');
  perform public.clip_attribute_conversions(now() - interval '1 hour');
  assert (select disqualified_reason from public.action_clip_conversions where converted_user_id = u_fan3 and kind = 'account')
         = 'no verified clip yet', 'no bonus before a verified clip';
  assert not exists (select 1 from public.action_clip_earnings e join public.action_clip_claims k on k.id = e.claim_id
                      where k.ref_code = r->>'ref_code'), 'and nothing is earned';

  -- only the server settles; browsers read nothing directly
  assert not has_function_privilege('authenticated', 'public.clip_settle_submission(uuid)', 'execute'), 'members cannot settle';
  assert not has_function_privilege('authenticated', 'public.clip_record_metrics(uuid, jsonb)', 'execute'), 'members cannot report metrics';
  assert not has_function_privilege('authenticated', 'public.clip_record_verification(uuid, jsonb)', 'execute');
  assert not has_function_privilege('authenticated', 'public.clip_release_due()', 'execute');
  assert not has_function_privilege('anon', 'public.clip_campaign_claim(uuid)', 'execute'), 'signed-out visitors cannot claim';
  assert has_function_privilege('anon', 'public.clip_campaigns_open(text)', 'execute'), 'discovery is public';
  assert not has_table_privilege('authenticated', 'public.action_clip_earnings', 'select'), 'the ledger is server-only';
  assert not has_table_privilege('authenticated', 'public.action_clip_submissions', 'select');

  -- a total reached twice (down by a reversal, then back up) is two ledger rows, never a skipped one
  perform pg_temp.sign_in(null);
  declare
    sub2 uuid := (select v::uuid from t where k = 'sub2');
    v_cap integer := (select per_clip_cap_cents from public.action_clip_campaigns where mission_id = mission);
    v_before bigint := (select sum(amount_cents) from public.action_clip_earnings
                         where submission_id = sub2 and kind in ('views', 'reversal') and state <> 'void');
  begin
    update public.action_clip_campaigns set per_clip_cap_cents = v_before - 500 where mission_id = mission;
    perform public.clip_settle_submission(sub2);
    assert (select sum(amount_cents) from public.action_clip_earnings where submission_id = sub2 and kind in ('views', 'reversal') and state <> 'void')
           = v_before - 500, 'a lower target is a reversal row';
    update public.action_clip_campaigns set per_clip_cap_cents = v_cap where mission_id = mission;
    perform public.clip_settle_submission(sub2);
    assert (select sum(amount_cents) from public.action_clip_earnings where submission_id = sub2 and kind in ('views', 'reversal') and state <> 'void')
           = v_before, 'and back up again is a new row, not a collision with the first';
    perform public.clip_settle_submission(sub2);
    assert (select count(*) from public.action_clip_earnings where submission_id = sub2 and kind in ('views', 'reversal'))
           = (select count(distinct idempotency_key) from public.action_clip_earnings where submission_id = sub2), 'a replay adds nothing';
  end;

  -- the payout ledger guards itself, even against the service role
  assert pg_temp.raises(format('delete from public.action_clip_earnings where mission_id = %L', mission), '%append-only%'),
         'ledger rows are never deleted';
  assert pg_temp.raises(format('update public.action_clip_earnings set amount_cents = amount_cents + 1 where mission_id = %L and state = ''paid''', mission),
         '%never edited%'), 'an earned amount is never edited';
  assert pg_temp.raises(format('update public.action_clip_earnings set state = ''held'', payout_id = null, paid_at = null where mission_id = %L and state = ''paid''', mission),
         '%cannot move from paid%'), 'a paid earning is final';
  assert pg_temp.raises(format('update public.action_clip_earnings set state = ''payable'' where submission_id = %L and state = ''void''', sub4),
         '%cannot move from void%'), 'a voided earning stays void';

  raise notice 'clipping regression: all assertions passed';
end $$;

rollback;
