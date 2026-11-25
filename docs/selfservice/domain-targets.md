# Domain publication targets

Pending integration, not production activation. Apply `managed_projects_v1.sql` and `creator_domains_v1.sql` before `creator_domain_targets_v1.sql`. The additive target migration backfills existing domains as member-front targets and assigns stable UUIDs to projects. No live migrations were performed.

Domain creation accepts `{hostname,target:{type,id,slug}}`. Omitted target retains personal-site behavior. GET domains returns owned target choices, also rendered by the domain dashboard. Domain target identity is immutable: disconnect and create a new proof-bound claim to switch sites. Slug, owner, target UUID and verification token cannot change beneath a running verification. The Worker verifies target ownership before and after provider I/O; old callbacks cannot patch replacement claims.

Supported targets:

* `member_front`: immutable auth user ID, current handle snapshot. Existing member publication checks remain authoritative.
* `managed_project`: stable project UUID plus immutable owner and slug snapshot. Project public response selects `front` or `tiles` presentation. Studio is a managed-project presentation, not a third identity.
* `wetrust`, standalone `studio` and arbitrary URLs are rejected. We Trust's proposed AUTHZ binding is not deployed customer authority. A future adapter requires reviewed canonical identity and public-access proof; source availability does not activate it.

## Integration contract

Root must pass `projectPublic: handleManagedProjects` and `projectTilesPublic: handleProjectTiles` to `handleCreatorDomainHost`. Both handlers must enforce `expectedAuthUserId` and `expectedProjectId` in their public row read. They receive a clean canonical GET request without incoming cookies, authorization or query parameters. The host exposes only its bound public endpoint, never arbitrary APIs. Omitted handlers fail closed.

The managed public endpoint returns `presentation:'front'|'tiles'`. Tiles use `/v1/projects/:slug/tiles/public` and canonical `website-studio-view.html`; both page and data requests recheck canonical entitlement/media withdrawal through `handleProjectTiles`. Missing/withdrawn data never falls back to a front renderer. It injects `MCC_STUDIO_HOST={project,handle,api}`; the Studio public module must accept this only when api equals location.origin and project is valid. Root's shared `front-member.js` must likewise use trusted `MCC_FRONT_HOST.project` and overwrite query-selected project; do not clear it. Shared files and route mounting are intentionally outside this commit.

## Registrar boundary

Purchases remain disabled. No full production factory was added: neither the incomplete NameSilo transport nor the reviewed Cloudflare registration model proves the full current contact/renewal/ownership contract. Existing funded-order fixtures remain functional. This change validates domain/term before transport, omits absent payment IDs, and rejects malformed/sub-cent provider charge confirmations instead of rounding them into a successful order. Ambiguous or mismatched outcomes remain reconciliation-required without automatic replay.

## Executed verification

* 13 offline Worker tests: two tenants, owner/UUID/slug changes, unsupported target, missing public adapter, removed publication, front/tiles dispatch, withdrawn tiles, stripped credentials, late provider completion, registrar fallback/uncertain result and replay.
* Disposable PGlite runs pending SQL: immutable identities, browser role denial and stale callback against a replaced claim.
* Existing full domain-order PGlite API fixtures: quote/consent/funding/fulfillment/refund/timeout/ownership checks.
* Chromium 390px: owned target choice, no horizontal overflow, account-change clearing and delayed old-tenant response suppression.

These tests use fixtures. No real DNS/TLS, registrar operation, contact, payment, migration or deployment was performed. Integration with the parallel Studio handler still needs combined tests after cherry-picking.
