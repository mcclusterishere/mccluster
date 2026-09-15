-- LEGACY PROJECT SECURITY RECORD — DO NOT AUTO-APPLY TO THE CANONICAL "Here" PROJECT.
-- Target project ref: fxbkvcrfbbcmrrupdcjt
-- Canonical project ref used by supabase/config.toml: zmnhbrjyhxzhkxmhkexs
--
-- This file records the narrow P0 containment changes applied directly to the
-- legacy project on 2026-09-13. It deliberately lives outside
-- supabase/migrations so normal McCluster migration replay cannot run it
-- against the canonical control plane.

-- 1. Trigger functions are database-internal hooks, not client RPCs.
revoke execute on function public.cashout_deny_refund() from public, anon, authenticated;
revoke execute on function public.deals_guard() from public, anon, authenticated;
revoke execute on function public.equity_draw() from public, anon, authenticated;
revoke execute on function public.fund_accrue_on_completion() from public, anon, authenticated;
revoke execute on function public.mint_on_completion() from public, anon, authenticated;
revoke execute on function public.referral_share_on_mint() from public, anon, authenticated;
revoke execute on function public.tg_greenlight() from public, anon, authenticated;
revoke execute on function public.tg_notify_deal_insert() from public, anon, authenticated;
revoke execute on function public.tg_notify_deal_status() from public, anon, authenticated;
revoke execute on function public.tg_notify_earnings() from public, anon, authenticated;
revoke execute on function public.tg_notify_listing() from public, anon, authenticated;
revoke execute on function public.tg_notify_paid() from public, anon, authenticated;
revoke execute on function public.vault_intake() from public, anon, authenticated;

-- 2. Internal/scheduled helpers must not be directly callable through the Data API.
revoke execute on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.snapshot_all() from public, anon, authenticated;
revoke execute on function public.stake_sweep() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 3. Replace PostgreSQL's ambient PUBLIC execution with explicit signed-in/service roles.
revoke execute on function public.admin_note_member(uuid, text) from public, anon;
grant execute on function public.admin_note_member(uuid, text) to authenticated, service_role;
revoke execute on function public.apply_badge(text, text, text) from public, anon;
grant execute on function public.apply_badge(text, text, text) to authenticated, service_role;
revoke execute on function public.award_badge(text, text, text, text) from public, anon;
grant execute on function public.award_badge(text, text, text, text) to authenticated, service_role;
revoke execute on function public.civic_rank() from public, anon;
grant execute on function public.civic_rank() to authenticated, service_role;
revoke execute on function public.claim_beta_bankroll() from public, anon;
grant execute on function public.claim_beta_bankroll() to authenticated, service_role;
revoke execute on function public.claim_gauntlet() from public, anon;
grant execute on function public.claim_gauntlet() to authenticated, service_role;
revoke execute on function public.claim_house_offer(uuid) from public, anon;
grant execute on function public.claim_house_offer(uuid) to authenticated, service_role;
revoke execute on function public.claim_run_bonus() from public, anon;
grant execute on function public.claim_run_bonus() to authenticated, service_role;
revoke execute on function public.create_crew(text, text, text) from public, anon;
grant execute on function public.create_crew(text, text, text) to authenticated, service_role;
revoke execute on function public.daily_pulse() from public, anon;
grant execute on function public.daily_pulse() to authenticated, service_role;
revoke execute on function public.driver_ping(boolean, double precision, double precision, double precision) from public, anon;
grant execute on function public.driver_ping(boolean, double precision, double precision, double precision) to authenticated, service_role;
revoke execute on function public.erase_listing(text) from public, anon;
grant execute on function public.erase_listing(text) to authenticated, service_role;
revoke execute on function public.eup_pay(text, numeric, text) from public, anon;
grant execute on function public.eup_pay(text, numeric, text) to authenticated, service_role;
revoke execute on function public.grant_civic_role(text, text, text) from public, anon;
grant execute on function public.grant_civic_role(text, text, text) to authenticated, service_role;
revoke execute on function public.grant_from_fund(text, numeric, text) from public, anon;
grant execute on function public.grant_from_fund(text, numeric, text) to authenticated, service_role;
revoke execute on function public.house_wallet() from public, anon;
grant execute on function public.house_wallet() to authenticated, service_role;
revoke execute on function public.identifier_power() from public, anon;
grant execute on function public.identifier_power() to authenticated, service_role;
revoke execute on function public.imprint_desk(text, text[], text[]) from public, anon;
grant execute on function public.imprint_desk(text, text[], text[]) to authenticated, service_role;
revoke execute on function public.inbox_seen() from public, anon;
grant execute on function public.inbox_seen() to authenticated, service_role;
revoke execute on function public.join_crew(text) from public, anon;
grant execute on function public.join_crew(text) to authenticated, service_role;
revoke execute on function public.leave_crew() from public, anon;
grant execute on function public.leave_crew() to authenticated, service_role;
revoke execute on function public.megaphone_post(text, text[]) from public, anon;
grant execute on function public.megaphone_post(text, text[]) to authenticated, service_role;
revoke execute on function public.member_book() from public, anon;
grant execute on function public.member_book() to authenticated, service_role;
revoke execute on function public.member_dossier() from public, anon;
grant execute on function public.member_dossier() to authenticated, service_role;
revoke execute on function public.my_badges() from public, anon;
grant execute on function public.my_badges() to authenticated, service_role;
revoke execute on function public.my_card() from public, anon;
grant execute on function public.my_card() to authenticated, service_role;
revoke execute on function public.my_colors() from public, anon;
grant execute on function public.my_colors() to authenticated, service_role;
revoke execute on function public.my_connections() from public, anon;
grant execute on function public.my_connections() to authenticated, service_role;
revoke execute on function public.my_crew() from public, anon;
grant execute on function public.my_crew() to authenticated, service_role;
revoke execute on function public.my_distribution() from public, anon;
grant execute on function public.my_distribution() to authenticated, service_role;
revoke execute on function public.my_equity() from public, anon;
grant execute on function public.my_equity() to authenticated, service_role;
revoke execute on function public.my_imprint() from public, anon;
grant execute on function public.my_imprint() to authenticated, service_role;
revoke execute on function public.my_inbox(integer) from public, anon;
grant execute on function public.my_inbox(integer) to authenticated, service_role;
revoke execute on function public.my_mission() from public, anon;
grant execute on function public.my_mission() to authenticated, service_role;
revoke execute on function public.my_redeemable() from public, anon;
grant execute on function public.my_redeemable() to authenticated, service_role;
revoke execute on function public.my_score() from public, anon;
grant execute on function public.my_score() to authenticated, service_role;
revoke execute on function public.my_signals() from public, anon;
grant execute on function public.my_signals() to authenticated, service_role;
revoke execute on function public.my_supporters() from public, anon;
grant execute on function public.my_supporters() to authenticated, service_role;
revoke execute on function public.my_wallet() from public, anon;
grant execute on function public.my_wallet() to authenticated, service_role;
revoke execute on function public.my_web3() from public, anon;
grant execute on function public.my_web3() to authenticated, service_role;
revoke execute on function public.react(uuid, text) from public, anon;
grant execute on function public.react(uuid, text) to authenticated, service_role;
revoke execute on function public.referral_stats() from public, anon;
grant execute on function public.referral_stats() to authenticated, service_role;
revoke execute on function public.request_cashout(numeric) from public, anon;
grant execute on function public.request_cashout(numeric) to authenticated, service_role;
revoke execute on function public.request_gas_grant(text) from public, anon;
grant execute on function public.request_gas_grant(text) to authenticated, service_role;
revoke execute on function public.stake_mark(text) from public, anon;
grant execute on function public.stake_mark(text) to authenticated, service_role;
revoke execute on function public.sweep_stale_deals(integer) from public, anon;
grant execute on function public.sweep_stale_deals(integer) to authenticated, service_role;
revoke execute on function public.transfer_tokens(text, numeric, text) from public, anon;
grant execute on function public.transfer_tokens(text, numeric, text) to authenticated, service_role;
revoke execute on function public.unclaim_listing(text) from public, anon;
grant execute on function public.unclaim_listing(text) to authenticated, service_role;

-- 4. Pin mutable helper search paths to trusted schemas.
alter function public.fund_uid() set search_path = pg_catalog, public;
alter function public.game_price(numeric) set search_path = pg_catalog, public;
alter function public.is_earned_reason(text) set search_path = pg_catalog, public;
alter function public.is_mcc_admin() set search_path = pg_catalog, auth, public;
alter function public.n_log(numeric, numeric) set search_path = pg_catalog, public;
alter function public.ticker_price(integer, integer) set search_path = pg_catalog, public;
alter function public.touch_updated_at() set search_path = pg_catalog, public;
alter function public.vault_uid() set search_path = pg_catalog, public;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- 5. Backend-only RLS/no-policy tables: make deny-by-default explicit at grants layer.
revoke all privileges on table public.deal_payments from anon, authenticated;
revoke all privileges on table public.member_oauth from anon, authenticated;
revoke all privileges on table public.mtoken_ledger_legacy from anon, authenticated;
revoke all privileges on table public.play_pulses from anon, authenticated;
revoke all privileges on table public.push_config from anon, authenticated;
revoke all privileges on table public.rights_splits from anon, authenticated;
