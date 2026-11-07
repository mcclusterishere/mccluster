# Canonical identity and domain binding checkpoint

This draft follows green #638 (`38a8058e`) and #639 (`46b3607c`). It changes
neither saved head. No production SQL, owner grant, host record, DNS, provider
activation, payment, deployment or authentication configuration has been applied.
Recent open-PR audit found the separately owned analytics #640; its telemetry,
music-engine and listening schemas remain outside this change.
The parent independently refreshed production metadata at 2026-10-26 19:48 UTC:
348 migrations, latest `20261024014732`; member_fronts, managed_projects,
customer_site_modules, customer_site_addresses, canonical_artist_bindings,
canonical_artist_binding_events and creator_domains were all absent. This is
read-only count/latest/table-presence evidence, not a SQL hash-equivalence audit.

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

## Domain provider authority

The adapter no longer sends or depends on Enterprise-only `custom_metadata`.
Apply `creator_domain_provider_bindings_v1.sql` only after the separate reviewed
`creator_domains_v1.sql` and `creator_domain_targets_v1.sql`; none is a free-site
prerequisite. The full source remains stacked on #638/#639 and their dependencies;
the small SQL list above is an activation subset, not a standalone source merge.

The domain RPC durably records create intent before provider POST, immediately
saves returned zone/UUID identity, and fences changes with an operation token,
two-minute lease and expected provider state. Unknown matching hosts, lost create
responses and malformed success retain a reserved reconciliation claim. No
automatic adoption or second POST occurs. If ID persistence committed but its
response was lost, readback preserves that proven binding for safe verification.
Delete reads the exact zone/ID and confirms hostname before remote deletion;
known-ID 404 permits cleanup, unknown-ID reconciliation does not. A disconnected
uncertain claim retains its verified hostname against other owners.

Before applying, read-only preflight must check duplicate verified hostnames
including detached rows. The stricter index deliberately fails its transaction
if duplicates exist; it does not delete or reassign customer data. Legacy IDs
without recorded zone provenance enter reconciliation, never inferred adoption.
Reviewed reconciliation tooling remains an operator task; the customer sees the
explicit state and no misleading Verify/Disconnect retry controls.

Serving requires matching configured zone, bound provider UUID, active TLS,
current CNAME, paid entitlement and the original project's public renderer. The
provider snapshot expires after 24 hours and explicit Verify refreshes it. This
is an **engineering blocker for unattended hosting**, not an approval/configuration
gate: manual daily verification does not complete self-service hosting. No
unattended provider-refresh job is added here. A subsequent bounded implementation
must supply authoritative scheduled refresh and a tested failure policy before
real host activation. No live provider behavior or TLS has been verified by fixtures.

CNAME remains this adapter's supported connection contract; the UI labels its
routing record as conditional and does not prescribe a CNAME for an apex. No
new apex target, nameserver or shared Cloudflare address is inferred. WordPress
ALIAS compatibility is unverified. Separately, Workers Custom Domains support an
apex in an active owned Cloudflare zone, but that is a different unimplemented
adapter and requires the parent's pending DNS/zone approval. Enterprise static-IP
SaaS apex proxying is an option, not a universal requirement. No purchase,
transfer or DNS change is needed merely to demonstrate this local code.

Cloudflare create metadata is optional, while its plans list metadata as an
Enterprise add-on. No documented create idempotency parameter was found in the
current API reference. Sources: [create](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/),
[get](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/get/),
[exact hostname list](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/list/),
[plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/).

Stories, browser music Studio and on-demand streaming remain subsequent scoped
milestones. Composer #639 is already separately saved; no new network/provider
adapter or telemetry work belongs in this checkpoint.
