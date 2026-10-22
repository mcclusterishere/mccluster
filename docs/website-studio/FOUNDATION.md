# Three-tile Website Studio foundation

Date: 2026-10-17. Related issue: #492.
Status: isolated implementation foundation; NOT an operational Website Studio.
No public funnel, billing, account, Worker route, media bucket or production DB
has been changed by this package. Existing cohort access must be preserved.

## Product decisions

The acquisition path is a real public demonstration -> Use this template ->
free M Account -> return to the selected template/draft -> edit/preview ->
explicit publication. Seeing the demonstration must not require an account;
claiming/saving the template does. Account creation and editor draft save must
not silently start a paid subscription. Keep personal profile/credits/mission
history distinct from the branded public website.

A site has three customizable content tiles, initially music, native video and
an optional immersive 360 experience (at most one). Tile kinds can be changed
and reordered. Each content tile has a separate optional transition source and
trim. Three transitions plus three content tiles means six media slots, NOT
six required uploads or six copies of a source. Standard mode is three ordinary
tiles. Cinematic mode inserts each transition before its content tile. Actual
music/video transport remains independent of scroll-controlled transitions.

Video pinning must reference the existing authorized native post; never clone
posts or silently widen visibility. Song sales refer to canonical offer and
recording IDs, with server-confirmed payments and download entitlement. A paid
master is not the preview URL. One upload may be used in several contexts only
where its rights/ownership/publication approval permit each use.

The 360 tile needs actual projection-aware panorama/video or another verified
immersive source. A normal six-second camera video is not 360 content. Entry is
explicit, with Exit and ordinary navigation. A production service supplying
360 footage is a separately scoped upsell, not an invented monthly deliverable.
Automatic start is a request after visitor sound consent, never a promise that
browser autoplay restrictions can be bypassed. Keep Play and catch rejection.

## Implemented in this package

- Dependency-free versioned document validation and identical preview/public
  segment planning: three tiles, at most one 360, typed canonical references,
  bounded text/URLs/trim/crop, separate transitions and commerce offer reference.
- Original native scroll controller: progress-to-frame mapping, reversibility,
  coalesced requestAnimationFrame scheduling, reduced-motion handling and cleanup.
  It does not load/decode video or provide an unbenchmarked replacement for GSAP.
- Trusted publication-adapter contract: every referenced resource requires
  authorization/readiness/publication checks. The real adapters/routes are NOT
  implemented, and a positive local check is not a published site.
- Tenant-scoped preparation identity excludes text/order/mode. Hash it in the
  trusted job service to reuse prepared media without cross-tenant access leaks.
- Versioned template and creator guidance stored together as JSON for later DB
  import. Supported-format claims remain disabled pending a real uploader.
- Executable pricing model and Node behavior tests.

Run: `node --test scripts/test/website-studio-v1.test.mjs`.
Tests use fixtures/mocked scroll environment, not physical-phone benchmarks.
No full-repository CI or production end-to-end publishing test is claimed.

`schema-draft.sql` is a DATABASE DESIGN DRAFT, not a migration. It adds only
versioned template/guidance and private M-identity-owned drafts. Owner reads use
RLS; writing is service-only with optimistic revisions. It has NOT been run on
PostgreSQL and must pass real-role tests/advisors before promotion. The Node
validator must run at the trusted API boundary, not just in the editor.

## Existing platform reconciliation

Read-only production schema inspection confirmed creator_published_sites is a
text-only org-scoped publication table; media_assets, media_jobs, network_posts,
social_content_items, social_accounts and social_publish_jobs already exist.
Reuse those systems. Native network posts and external social deliveries stay
separate. New site presentation points at their records rather than becoming
another media catalog, payment authority, identity or social scheduler.

The inspected production schema did not contain creator_site_cohort_grants,
although previously inspected publishing code referenced it. Reconcile the
actual deployed route/schema and historical cohort claims before claiming that
cohort publication works. Do not solve this by removing entitlement checks or
making cohort members buy access again.

Canonical Worker mccluster authorizes/orchestrates; shared Supabase is durable
truth. Evaluate spare capacity and isolation on existing OVH Core before adding
paid compute. A Cloudflare Container processor is a candidate, NOT provisioned
infrastructure. Never give compute nodes unrestricted service-role credentials.

## Proposed commercial model, NOT live price changes

Free account/profile/template/editor, and a tightly metered platform-branded
page, is the recommended acquisition offer. Free hosting quotas still require
approval and cost/abuse tests. No white-label/customer-domain promise by default.
Existing paid customers and approved cohort grants keep their agreed terms.

$5/month Social Starter is a proposed SELF-SERVICE product: one brand/operator,
a limited number of genuinely supported connections and a bounded delivery
allowance (example: three connections, sixty destination deliveries/month).
Posting one item to three networks uses three deliveries. Actual connector
approval, paid provider API usage, maintenance and support decide viable limits.
A native platform post is a distinct first-party action.

$33/month is a possible advanced-tools bundle (higher quotas, approvals,
reporting, more storage), not unlimited human-managed marketing or unlimited
video streaming. Human production and 360 capture need scoped quotes. No Stripe
products/prices, subscriptions or promises are modified by this foundation.

## Costs checked against official public documentation

Cloudflare account inspection failed with Authentication error. Therefore these
are USD LIST-PRICE scenarios, not an actual account bill. Allowances are shared
with all existing workloads and may already be consumed.

- Workers Paid: $5/account/month; 10M requests and 30M CPU-ms included. Dynamic
  request/CPU overages and some cache configurations meter separately.
- R2 Standard: $0.015/GB-month; 10 GB-month free, 1M Class A and 10M Class B
  operations free. Additional operations: $4.50/M A, $0.36/M B, rounded up by
  billing unit. Direct egress is not charged; linked services may charge.
- Stream: capacity bought at $5/month per 1,000 stored minutes; delivery $1 per
  1,000 delivered minutes. Buffer/preload delivery can count. Encoding included.
- Containers standard-2: 1 vCPU, 6 GiB RAM, 12 GB disk. Full-use modeled cost
  before allowances: $0.129024/hour. Account includes 6.25 vCPU-hours, 25 GiB-hours
  and 200 GB-hours. This is NOT a measured job runtime. DO/orchestration/logs
  and network overages are outside this compact model.
- Media Transformations: $0.50/1,000 operations after shared 5,000 allowance.
  Video output counts one operation/second; individual extracted still = one.
  URL uniqueness is billed monthly; binding execution is per-operation after
  beta. Current binding public beta says unbilled; do not build margins on it.
  Cache/store processed results. No spritesheet billing assumption is made.

Illustrative 100-profile monthly pilot (not observed customer traffic):
100 GB R2 + 1,000 Stream stored minutes + 10,000 delivered minutes + 100 full-busy
standard-2 hours, with remaining account allowances and Workers base included:
$5 + $1.35 + $15 + $12.177 = $33.527 (~$33.53).
Workers and R2 operations assumed within remaining allowances. DB/email/network
API fees/payment fees/tax/labor and orchestration overages excluded. Reserve
$75-$100/month for this controlled Cloudflare/media pilot rather than promising
a fixed $33.53 bill. Existing Workers payment is not charged again per site.

Alternative managed preparation illustration, 1,000 complete site preparations:
3 six-second transitions x 2 video variants = 36,000 output seconds -> $15.50
at published paid rates after 5,000 remaining operations. Extracting each of 20
frames/second separately for the same variants = 720,000 operations -> $357.50.
These exclude posters/retries/storage/viewing. They are DIFFERENT output methods,
not a universal cost of image sequences. Native FFmpeg generates a sequence in
one job; its cost is compute, not an API operation per frame. Do not add both
managed and native preparation costs for the same job. Beta charges may be zero.

Sources (retrieved 2026-10-17):
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/stream/pricing/
- https://developers.cloudflare.com/containers/platform/pricing/
- https://developers.cloudflare.com/stream/transform-videos/
- https://developers.cloudflare.com/stream/transform-videos/bindings/
- https://buffer.com/pricing
- https://developers.tiktok.com/doc/content-sharing-guidelines/
- https://docs.x.com/x-api/getting-started/pricing
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- https://gsap.com/community/standard-license/

Free/open-source distribution is not a blanket exception to a dependency's
license. The new scroll module is independently written using native browser
APIs, with no GSAP code/imports. We are not relicensing the existing repository,
removing required notices or claiming faster performance without benchmarks.

## Next integration gate

Test the SQL/identity/entitlement path in isolated PostgreSQL; then connect
actual authenticated draft save, owner-authorized upload/jobs and bounded media
loader. The same renderer must serve the preview and last-good public revision.
Support processing retry, media withdrawal, publish version conflict/rollback,
format inspection, captions and accessible still fallback. Only then replace
the account funnel's conceptual demo with the working template and public URL.

Record template selection, committed account draft, processing success/failure,
publication revision, content play, checkout result and per-network delivery
from their authoritative services with stable IDs/idempotency. Keep measured
costs in sub-cent precision until aggregate billing; a fractional job rounded
to zero cents is not zero infrastructure cost. Do not invent analytics counts.
