# Equity Uprise architecture: installable product release contract

Owner direction, 2026-10-31: the reusable architecture and product are named **Equity Uprise**. It will power independently configured ecosystems, including transportation and actionable social media. Customers must be able to obtain the product in a new repository, without existing user data, retain its UI and workflows, configure modules and branding, and operate it on their own backend. This promotes independently operated editions from a future packaging idea to an active product target. It does not replace the current McCluster production backend or move its users.

## What “productized” means

A customer who has not worked on this repository can install a versioned release on empty supported infrastructure, create their own administrator, configure their brand and enabled modules without editing application source, complete the advertised workflows, back up and restore their installation, and upgrade to the next release without losing data or customizations. Documentation and repeatable acceptance tests must prove every step.

Production-ready for Matthew's installation and ready to distribute are separate release gates. A working checkout or green repository test suite does not prove an independent installation works. Deleting production records does not create a clean product distribution: records, identifiers, credentials, branded assets and historical seed data can still remain in Git history, migrations and fixtures.

## Product and ecosystem scope

Equity Uprise is the reusable software architecture owned by McCluster Corp. Equity Uprise World is a social application built on that architecture. Existing company/person identities and deployed infrastructure names remain distinct; the product name does not rename the canonical Worker, database or organizations.

The shared foundation provides identity, organizations, authorization, owner Control, module configuration, events, jobs, media, observability and deployment. Configurable modules cover actionable social/community, mission workflows, transportation, music/media, commerce/storefronts, customer sites, collaboration and intelligence. Each module has its own readiness gates; an installation can enable a supported subset without forking the product. The first independent-install proof may use a small subset, but the product contract covers the full ecosystem architecture.

Mission content is installation data. Removing the current mission catalog does not remove the mission engine; a clean product install starts without Matthew's missions and allows its operator to create their own when that module is enabled. Disabled modules must be inaccessible through server APIs as well as absent from navigation.

## Supported deployment model

Build a licensed, independently operated edition of the existing software. The initial supported stack should stay close to the current implementation: customer-owned Supabase/Postgres, customer-owned Cloudflare edge resources and static hosting, and a documented Linux Core runtime only for modules that require durable jobs. Document the exact supported versions and services before claiming support. “Own backend” means independent infrastructure and credentials on this supported stack; arbitrary database or hosting compatibility is not promised.

The current McCluster installation remains canonical for its existing tenants. A new customer's installation must neither access McCluster's production database nor inherit its administrator, organization, Stripe account, OAuth applications, mail delivery, telemetry, API origins or webhook secrets. Telemetry outside the installation is opt-in. A hosted tenant and an independent installation are different products and must be labeled accordingly.

## Required boundaries

| Layer | Distributed | Customer-owned state |
|---|---|---|
| Application | UI components, workflows, APIs, reviewed module code | Configuration, branding, navigation choices |
| Database | Schema, RLS, functions, deterministic system defaults | Accounts, organizations, media, orders, campaigns, messages, operational history |
| Modules | Versioned manifests, dependency rules, upgrade scripts | Enabled modules, roles, settings, entitlements |
| Assets | Only explicitly redistributable fonts, icons and neutral assets | Logos, recordings, photographs, video and customer uploads |
| Operations | Installer, validation, backup/restore and update tools | Infrastructure, credentials, domain, payment and mail accounts |
| Commercial | License agreement, attribution, support/version policy | Customer's products, prices and transactions |

Generate releases from an explicit reviewed file allowlist and a new source snapshot. Do not distribute the production repository's .git history, database dump, evidence snapshots, transcripts, logs, uploads, customer seed records or personal catalogs. An exclude list alone is insufficient. Optional demo content must be synthetic, separately installed and removable. The current proprietary LICENSE is not yet a customer distribution/reseller agreement; agree that package before selling copies, without silently changing current ownership or granting all asset rights.

## Release acceptance gates

| Gate | Required proof | Current assessment |
|---|---|---|
| Clean package | Artifact inventory, dependency/asset notices, secret and personal-data review; no production history | Not proven; no reviewed distribution allowlist |
| Empty installation | CI provisions an empty isolated backend, installs schema, bootstraps a fresh owner and signs in | Existing reset reconstructs production history, not a customer installer |
| Installation isolation | Two deployments with unrelated domains and projects pass API/RLS tests; neither calls McCluster production | Hardcoded production references remain in runtime/config |
| Configuration | Brand, origin, mail, payment, storage and owner setup via validated config/onboarding | Settings scattered across source and provider dashboards |
| Module control | Server-enforced dependencies, authorization, enable/disable and draining behavior; disabled routes refuse use | Feature flags and tenant systems exist; unified product module contract not proven |
| User journeys | For every advertised module: public, member and operator success, error, retry and recovery flows | Significant test coverage; real payment proof and album purchases remain open |
| Upgrades | Install N-1, add synthetic customer data/customizations, upgrade to N, verify preservation and restore | Current production migration ledger is not an independent-install upgrade contract |
| Operations | Installation health check, background jobs, backup, tested restore, diagnostics and recovery | Production operations exist; customer-facing operational package incomplete |
| Documentation | A new operator follows install, configuration, modules, permissions, commerce, upgrades and troubleshooting guides | Existing docs largely describe the current organization and control plane |
| Commercial release | Versioned artifact, changelog, supported matrix, license/redistribution terms and support policy | No independently installable release accepted |

Do not assign a completion percentage from file counts. Count accepted gates and name the missing proof. A gate is accepted only with reproducible evidence, not because its document exists.

## Implementation order

1. **Finish the live commerce release.** The owner-approved mission cleanup has separately removed 39 missions, five campaigns and 19 partner drafts while retaining the specified free-ride mission; music offers were preserved. Preserve the applied direct-sales migration and its Git ledger. Deploy reviewed checkout/access/webhook code after CI. Resolve the two new albums' names, files and prices. Prove test purchase, fulfilment, download and refund; track full-album bundles separately from single-track v1. Review merch schema and provider configuration independently. No campaign/mission cleanup is a prerequisite for packaging.
2. **Create a neutral installation profile.** Inventory runtime production references; replace them through a typed installation configuration and secret references. Keep the existing installation behavior through its own profile. Bootstrap ownership from a fresh authenticated installation flow, never a hardcoded email or org slug. Missing configuration must fail closed, with no production fallback.
3. **Build a clean baseline and installer.** Classify SQL into schema, system defaults, demo data and production-only history. Build a new edition baseline from reviewed schema, not a blind replay of every production migration. Validate on empty infrastructure with no network access to production. Preserve the current production ledger unchanged for existing deployments.
4. **Extract one complete edition.** Start with identity, owner Control, branding and music storefront capabilities; add modules only when their dependency and lifecycle contracts pass. Keep existing UI/UX and compatibility routes. An album purchase must snapshot the included tracks, bind price/currency/session, grant all purchased tracks idempotently and revoke/refund consistently; do not fake a bundle by granting unrelated individual orders.
5. **Add module management and extension points.** Each module declares id, version, dependencies, routes, tables, capabilities, settings, jobs, migration compatibility and removal behavior. Persist configuration separately from source. Disable at the server, preserve records and existing paid entitlements, and expose safe export. Custom CSS/templates/hooks must survive upgrades.
6. **Prove independent install and upgrade.** Run two fresh installations, execute supported journeys, upgrade a previous release with synthetic data, restore backup, and publish the artifact only after all gates pass. First pilot: one new operator using the documentation without an agent fixing the database manually.

## Immediate evidence (2026-10-31)

- `README.md` describes Matthew's live property, rather than an independent customer installation.
- `supabase/config.toml`, `workers/mccluster/wrangler.toml` and `core/core.env.example` point to the production project/origins.
- Browser code including `js/create.js`, `js/comments.js`, `js/music-direct.js` and `js/music-purchase.js` carries the production Supabase URL.
- `supabase/functions/_shared/house-ops.ts` resolves the literal `mccluster` organization for operator authorization.
- `scripts/supabase-local-reset-with-replay.sh` reconstructs the historical production model; `supabase/replay_migrations/0018_equity_uprise_seed.sql` inserts organization-specific topics, sources and fellowships.
- `docs/products/MISSION-APPLICATIONS-AND-MODULAR-PRODUCTS.md` already describes module boundaries, but explicitly labels independent editions a later packaging target. This contract advances that target, not its implementation status.

Run `node scripts/productization-audit.mjs` for a repeatable, read-only inventory of known installation bindings. It reports paths and categories, never matching source lines or secret values. This is a focused portability inventory, not a security certification or proof that unflagged files are distributable.
