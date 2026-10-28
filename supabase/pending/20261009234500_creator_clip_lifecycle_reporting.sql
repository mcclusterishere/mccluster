-- STAGED Gap 5: derive clip activity and earnings from existing authoritative tables.
-- Depends on creator_lifecycle_events migration and clipping marketplace v1.
-- Do not count user-claimed submissions as verified publications.
create or replace view public.creator_clip_lifecycle_summary
with (security_invoker=true) as
with claims as (
 select user_id, count(*) as claims_count,
 min(claimed_at) as first_claim_at
 from public.action_clip_claims group by user_id
), submissions as (
 select user_id,
 count(*) as submitted_count,
 count(*) filter(where verified_at is not null and status in ('tracking','held','closed')) as verified_count,
 min(verified_at) filter(where verified_at is not null and status in ('tracking','held','closed')) as first_verified_at,
 max(verified_at) filter(where verified_at is not null and status in ('tracking','held','closed')) as last_verified_at
 from public.action_clip_submissions group by user_id
), earnings as (
 select c.user_id,
 coalesce(sum(e.amount_cents) filter(where e.state in ('payable','paid')),0)::bigint as eligible_earnings_cents,
 coalesce(sum(e.amount_cents) filter(where e.state='paid'),0)::bigint as paid_earnings_cents
 from public.action_clip_earnings e
 join public.action_clip_claims c on c.id=e.claim_id
 group by c.user_id
)
select coalesce(c.user_id,s.user_id,e.user_id) creator_user_id,
 coalesce(c.claims_count,0) claims_count,
 coalesce(s.submitted_count,0) submitted_count,
 coalesce(s.verified_count,0) verified_count,
 s.first_verified_at,s.last_verified_at,
 coalesce(e.eligible_earnings_cents,0) eligible_earnings_cents,
 coalesce(e.paid_earnings_cents,0) paid_earnings_cents
from claims c full join submissions s using(user_id)
full join earnings e on e.user_id=coalesce(c.user_id,s.user_id);
revoke all on public.creator_clip_lifecycle_summary from public,anon,authenticated;
grant select on public.creator_clip_lifecycle_summary to service_role;
-- Owner-only reporting must be mediated by an authenticated Worker endpoint
-- with independently verified owner authorization; never expose this view directly.
