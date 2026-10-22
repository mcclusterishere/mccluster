# Streaming, mission duration and credit policy

Research date: 2026-10-17. USD public prices, not measured account usage.
Policy is PROPOSED and billing is NOT ACTIVATED. Implementation of pure quotes,
mission-timing proposals and admission checks is in usage-policy.mjs. It does
not itself stop a provider stream, create credits or settle the ledger.

## Provider decisions

Cheapest is workload-dependent. Lowest verified candidates in this comparison:

- Native interactive live pilot: Cloudflare Realtime SFU. Shared SFU/TURN free
  allowance is 1,000 GB/month, then $0.05/GB egress. Ingress is free. Workers,
  Durable Objects and recording/processing costs are separate. It is NOT the
  existing Cloudflare Stream WHIP/WHEP product and needs its own adapter and
  session-level enforcement. Free allowance is account-wide, not per member.
- Existing Stream WebRTC live path: $1/1,000 delivered minutes. That protocol
  currently does not support recording, so it has no recording-storage charge.
  Do not mistake its beta name for free broadcasting. One hour watched by 100
  viewers is 6,000 delivered minutes: $6 at that rate.
- Zero-fee small VOD trial: Mux's free plan allows ten VOD assets and 100,000
  monthly delivery minutes, not ten assets per account on our platform. Live
  is not on that free tier. PAYG has separate plan/credit conditions.
- Paid managed VOD contender: Bunny Stream advertises storage from $0.01/GB,
  delivery from $0.005/GB and $1/month minimum, with standard encoding included.
  Actual region/network and encoded renditions/replication affect the bill.
  Its VOD pricing is not proof of a suitable live-ingest product.
- Mux live: Plus 720p input $0.025/minute ($1.50/host-hour); delivery beyond its
  free allowance $0.0008/minute. PAYG credits can reduce the bill, not erase the
  sustained input cost. Compare full workload, not just free viewer minutes.
- Owncast: open-source software, but server CPU, network/CDN, operations and
  abuse controls are not free. Spare existing OVH resources must be verified.
- R2/raw file delivery can have zero direct egress fees, but storage/operations
  and a custom video delivery stack still cost money. Not interchangeable with
  a managed live platform. No extra storage service was purchased for this work.

Example SFU math: at 2 Mbps, one viewer-hour carries 0.9 GB of encoded media
before transport overhead. With a modeled 20% overhead it is 1.08 GB. The free
1,000 GB corresponds to about 926 such viewer-hours, not 1,000 broadcaster-hours
regardless of audience. Actual bitrates/traffic/provider invoices are authority.

A 1,000-minute VOD audience at 2 Mbps is 15 GB before overhead: $0.075 at Bunny's
starting $0.005/GB versus $1 on Stream's minute rate. That is a payload example,
not a universal rate guarantee and excludes storage/minimums/replication.

## Proposed subsidized limits

- Two broadcaster-hours per member per week; at most six starts.
- Twenty minutes per session, one concurrent host session.
- At most ten simultaneous subsidized viewers.
- 240 viewer-minutes per member per week; recording off by default.
- Independent account-wide byte/spend ceiling and a safety reserve.

The audience allowance is intentionally separate. Ten people watching for 24
minutes use all 240 viewer-minutes, even though the host has broadcast for only
24 minutes. At Stream's paid delivery rate that allowance is $0.24/week/member
before any recording/processing. These are proposed numbers for a small pilot,
not restrictions already imposed on members.

Member-facing message:
> This session has up to 20 minutes of live time and a shared audience allowance.
> We warn you before the live allowance ends. You can keep working offline and
> submit private proof. Ending a broadcast does not fail your mission.

Going live is optional evidence, not a mission's moral value. Do not limit the
number of useful offline actions because broadcasting costs money. Do not make
a free ride depend on operating a camera while driving or filming the passenger.

Enforcement requires atomic backend reservation before provider allocation,
short-lived audience grants, periodic server/provider checks, concurrency
controls and actual provider track/session termination at the limit. Returning
a reusable unmetered WHEP URL and hiding the UI when a counter expires is NOT
cost enforcement. Retries must reuse reservations. Stale/unknown provider state
keeps budget reserved until reconciled; a browser disconnect is not proof that
provider delivery stopped. Already buffered delivery needs a tail allowance.
This provider enforcement is NOT implemented or enabled in PR493's Studio slice.

## Learning mission duration after real completions

Record mission type AND definition version, assignment/run ID, participant,
verified result, active-work time, broadcast time, pauses, source provenance and
whether a recording was cut short. They are different quantities. Never train
on viewer time or infer all work took place inside a six-minute stream.

After at least 100 comparable verified runs from at least 20 contributors,
propose a median, 25th–75th percentile range, 90th percentile and trimmed mean.
Limit one person's influence (five observations per person in this pilot),
deduplicate runs and retain censored data for diagnostics. More than 10%
censoring blocks the simple estimator, rather than pretending the observed
shorter durations are unbiased. Larger/nonrandom missingness requires a better
study or estimator. These gates are policy, not a proof of statistical validity.

Estimator outputs require review. Update estimates in bounded increments,
keep previous versions, and never automatically make a duration a hard failure
requirement. A different task definition starts a separate comparison set.
Agents writing missions must state both the estimated effort and the live
allowance, offer non-live proof and preserve the same consent/privacy rules.

## Exact credit arithmetic

Production schema inspection confirmed 1 credit = 1,000 micro-USD = $0.001,
therefore 1,000 credits = $1. Preserve it. Do not rescale balances or mix credits
with mission points, cash payouts or creator earnings.

Aggregate cost components as rational integer micro-USD; round the aggregate
cost to micro-USD once. For gross-margin m and collection-fee fraction f:
retail = ceil(cost_microUSD * 10000 / (10000 - margin_bps - fee_bps)).
credits = ceil(retail_microUSD / 1000). Require m+f<1.
Use BigInt/server SQL integer arithmetic, not floating-point money. Do not
round and charge every second/heartbeat separately. Fixed payment-collection
fees belong to top-up economics or explicit allocations, not a hidden fee on
every post. Promotional provider allowances are a platform subsidy and must not
silently alter the face value of already purchased credits.

Official X pricing currently distinguishes $0.015 Post:Create from $0.200
Post:Create(with URL). At an illustrative 25% gross margin and no other costs:
20 credits for the former; 267 credits for the latter. These are examples,
NOT activated retail prices. Media metadata/other API calls, payment fees and
support can add costs. A $5 all-you-can-post plan cannot safely include unlimited
20-cent link posts.

Transaction path still required before money activation:
1. Server resolves account, operation, connector, quantities and immutable rate.
2. Show a quote, maximum charge and expiry; obtain explicit spending consent.
3. Atomically reserve through existing compute_reserve_credits, using canonical
   api_credit_ledger and the compute-consumer advisory-lock discipline.
4. Execute with stable request/delivery identities. Never retry an unknown X
   post result blindly; reconcile whether it already exists first.
5. Settle authoritative measured usage once through existing settlement; release
   unused reservation. Failed/unknown billable provider work is not automatically
   free. Never charge above the accepted maximum without new consent.
6. Stripe-confirmed idempotent top-ups, reversals/refunds, concurrent overspend,
   expiry, stale-rate quotes and invoice reconciliation need real PostgreSQL and
   provider test-mode tests. Quote tests alone do not perfect a billing system.

Sources:
https://developers.cloudflare.com/realtime/sfu/platform/pricing/
https://developers.cloudflare.com/stream/webrtc-beta/
https://developers.cloudflare.com/stream/pricing/
https://bunny.net/pricing/stream/
https://www.mux.com/pricing
https://www.mux.com/docs/pricing/overview
https://owncast.online/docs/resources-requirements/
https://docs.x.com/x-api/getting-started/pricing
