-- Bank payout events are evidence, not proof of creator earnings settlement.
-- Preserve raw event history; latest status must be verified against Stripe.
create or replace view public.action_creator_bank_payout_review
with (security_invoker = true) as
select e.stripe_payout_id,e.stripe_account_id,
       count(*) as event_count,
       count(distinct e.status) as distinct_statuses,
       min(e.created_at) as first_recorded_at,
       max(e.created_at) as last_recorded_at,
       bool_or(e.status='paid') as has_paid_event,
       bool_or(e.status='failed') as has_failed_event,
       bool_or(e.status='canceled') as has_canceled_event
from public.action_creator_bank_payout_events e
group by e.stripe_payout_id,e.stripe_account_id;
revoke all on public.action_creator_bank_payout_review from public,anon,authenticated;
-- Deliberately no automatic status overwrite: delivery time is not event time.
