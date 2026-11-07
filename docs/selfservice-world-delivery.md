# Durable World and Instagram delivery (draft, not deployed)

A public World video with explicit Instagram opt-in now commits one World post,
one existing `social_content_items` identity, one draft `social_publish_jobs`
record and one private operation record in the same SQL transaction. Existing
World validation runs first; existing database insert/rate-limit triggers remain
in force. Ordinary World posts use their original path.

`POST /v1/mnet/posts` accepts `delivery: { operation_key, org_id, account_id,
action_mission_id?, action_campaign_id?, campaign_id? }`. The UUID operation key
is bound to the authenticated user and complete request including app key.
Replays return the original post before attached-media validation. Changed
requests reject with 409. Scheduled/newsroom cross-posts are explicitly refused;
the existing World-only newsroom and scheduler remain available.

`GET /v1/mnet/deliveries` returns the signed-in member's latest 50 saved records,
including separate World visibility/removal state and authoritative queue state.
It requires no active plan or provider configuration and is private/no-store.
It remains available after disconnect or an expired subscription. A deleted or
moderated World post is never recreated by replaying the operation.

`POST /v1/customer-social/deliveries/:id/submit` requires the original member,
current organization ownership, active plan, configured provider and the original
customer-managed connection. It moves the existing draft to queued or invokes
existing failed-job recovery; completed/in-progress replays reuse the same job.
No additional scheduler, provider client or persistent credential is introduced.
The existing Instagram cron remains the publisher.

The queue signs the already-uploaded first-party World video using a service-only
RPC. That RPC proves the exact job/content/org/account/media linkage, current
ownership, payment and customer connection, and that the World post is still
public, unremoved and attached to the video. Owner-editable media pointers must
match the recorded canonical uploader-prefixed path and an actual stored video
object. Checks run before container creation
and again before publication of an existing container. No browser file survives
reload and no second video upload is needed. Job identity/payload are immutable.
Cancelling Instagram no longer tombstones the independently published World post.

Optional attribution selects an existing open mission in a live Action campaign.
The World post and external job share `content_id`; the caption receives the
existing mission/content/source URL used by Action attribution. This does not
reactivate the public Missions or Travel tabs. An optional existing social
campaign can be supplied by API only if it belongs to the selected organization.

## Local evidence

- `scripts/test-world-social-delivery-db.mjs`: actual pending SQL on PGlite,
  two non-admin tenants, transaction rollback on a World insertion rejection,
  idempotent replay, changed payload rejection, history recovery, Action identity,
  current job status, paid/disconnect/removal/media guards and denied RPC grants.
- `workers/mccluster/test/world-social-delivery.test.mjs`: authenticated route
  integration, attached-media replay, unchanged World validation, customer gates,
  cancellation independence, queued/processing media guards before provider work.
- `scripts/test/world-publish-core.test.mjs`: ambiguous response/reload, stable
  request key, out-of-order history, external-only retry and auth switching.
- `scripts/test/world-social-composer.browser.mjs`: real markup/createPost fixture
  in Chromium at 390px; World success/external failure/retry, history recovery,
  World-only posting when provider unavailable, logout cleanup and no overflow.
- Existing customer-social PostgreSQL fixture and social/thumbnail unit suites
  also pass. Fixtures do not verify production schema, Vault encryption or Meta.

## Pending gates and deployment order

1. Review/apply `supabase/pending/world_social_delivery.sql` only after the
   existing Action distribution migrations and pending
   `customer_social_selfservice.sql` (which itself depends on creator billing).
   This is unapplied SQL, not release authority. Run production-schema compatibility
   and database security advisors in the authorized staging/release process.
2. Deploy the reviewed canonical Worker before the updated composer assets.
   Missing RPC fails explicitly; normal World-only posting remains available.
3. External publishing still needs the existing approved Meta app, reviewed
   permissions, redirect URI, customer OAuth connection, active plan, and
   `CUSTOMER_SOCIAL_ENABLED=true`. No credentials or provider settings were added.
4. Authorize a separate sandbox/live integration verification before claiming
   Meta publication works. This change creates no real accounts, content or
   provider activity. Provider-side ambiguous publication recovery retains the
   canonical queue's existing container semantics; this is not a new guarantee
   of exactly-once publication by Meta.

Intent records deliberately retain foreign-key references to their post, job,
account and content. Normal soft-delete/disconnect remains supported; hard deletion
of a referenced record requires an explicit retention/deletion procedure so it
cannot silently erase replay protection. This draft does not implement that
operator procedure or a new account-erasure workflow.

Official references consulted: Supabase database functions
(https://supabase.com/docs/guides/database/functions) and Cloudflare Workers best
practices (https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
Supabase's changelog markdown fetch was blocked (403 / unsupported content type);
no new Supabase client or provider API version was introduced.
