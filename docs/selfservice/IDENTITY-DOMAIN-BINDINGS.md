# Canonical identity and domain binding checkpoint

This draft follows green #638 (`38a8058e`) and #639 (`46b3607c`). It changes
neither saved head. No production SQL, owner grant, host record, DNS, provider
activation, payment, deployment or authentication configuration has been applied.
Recent open-PR audit found the separately owned analytics #640; its telemetry,
music-engine and listening schemas remain outside this change.

## Smallest free website release

Over the existing Auth, M Account, profile and organization schema, apply reviewed
pending files in this order:

1. `member_fronts_v1.sql` — existing public front-media bucket and front pages.
2. `managed_projects_v1.sql` — ordinary owned website configurations.
3. `managed_project_identity_v1.sql` — immutable UUID/owner/M identity, extracted
   from the domain dependency. Existing `creator_domain_targets_v1.sql` remains
   compatible when domains are activated later.
4. `customer_site_storage_v1.sql` — proposed configurable 500,000,000-byte quota,
   reservations, usage and restrictive direct Storage write boundary.
5. `customer_site_modules_v1.sql` and `customer_site_addresses_v1.sql` — tenant
   World/discovery settings and optional `mccluster.org/<slug>` addresses.
6. Only if canonical artist binding is needed: `canonical_artist_bindings_v1.sql`.

Release the reviewed Worker and static files together, then enable the existing
`CUSTOMER_SITE_OFFER_ENABLED` setting only after live Storage-boundary checks.
Create the project using the signed-in owner's normal dashboard; publish its
ordinary offers or cinematic configuration. Public front-media bytes remain
public after unpublishing a page until explicitly removed; no private-media or
revocable-media promise is made. The 500 MB storage allowance is not processing,
bandwidth, model access or a subscription price.

The minimal-schema fixture executes these exact pending files and the real
Worker create/edit/public-read/module/address handlers, with paid subscriptions,
domains, registrar, Studio, music and social-delivery tables absent. It verifies
owner isolation, both layouts and quota failure. Existing managed Storage runtime
and production release remain separate verification gates; PGlite is a fixture.
Native Studio tiles retain their separate preparation/approval dependencies.

## Canonical artist authority

Only the two existing stable act IDs from `data/albums.json` are recognized.
The existing McCluster house-owner organization gate authorizes a private grant
with reviewed provenance to an existing active M Account. The grantee then binds
only an owned immutable project UUID. A display name, slug, email, civic Equity
organization record, `user_metadata`, or client-supplied destination grants
nothing. `registry_key` remains the separate protected Vaunt presentation.

The service-only SQL RPC repeats operator/account/project checks, locks the grant,
records grant/bind/revoke events and refuses reassignment or resurrection. No
actual owner UUID is seeded. A revoked grant needs explicit reviewed authority
repair; the customer cannot regrant it. Public resolution returns only a generated
canonical renderer URL and supplied registry branding after the ordinary public
project renderer confirms publication/privacy and exact owner/project identity.
Revocation, owner-link changes, removed/private/unpublished targets fail closed.
Absent binding retains the existing static fallback. Migration unavailability is
a distinct service error, not an inferred owned tenant.

The existing project dashboard displays only the signed-in grantee's reviewed
identities and owned projects. A delayed response or account change during token
refresh cannot submit or display a previous account's binding. The album selects
the adapter using its explicit stable act ID; a bound destination is generated
from the immutable project, while 403/404 removes the stale link and contextual
home. Unavailable adapter/migration retains the supplied static bootstrap page,
without claiming that a managed tenant exists.

Intercepted 390/1440 browser fixtures run the real dashboard with Worker/SQL
authority, account-switch races and same-name foreign project exclusion. The
existing artist/player fixture also exercises bound-project navigation, real
audio start/resume, browser Back and private-binding link removal. Local Chromium
154 evidence is separate from final-head CI's browser result.

## Domain follow-up still pending

The old adapter still depends on Enterprise-only `custom_metadata`. Replace it
with durable zone/provider-ID authority and an explicit uncertain-create state.
Do not adopt an unknown same-host record or retry an ambiguously accepted POST.
Persist a returned provider ID before later DNS checks; verify zone/hostname on
readback before deletion and on serving. Retain claims needing reviewed
reconciliation. CNAME remains the supported connection contract; no new apex
target, nameserver or shared Cloudflare address is inferred.

Cloudflare create metadata is optional, while its plans list metadata as an
Enterprise add-on. No documented create idempotency parameter was found in the
current API reference. Sources: [create](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/),
[get](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/get/),
[exact hostname list](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/list/),
[plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/).

Stories, browser music Studio and on-demand streaming remain subsequent scoped
milestones. Composer #639 is already separately saved; no new network/provider
adapter or telemetry work belongs in this checkpoint.
