# Managed projects — pending integration and provisioning

An existing M Account can own multiple named pages without changing its single
member front. This change creates no account or Vaunt row and activates no backend.

## Contracts

`handleManagedProjects` in `workers/mccluster/src/managed-projects.js` mounts under
`/v1/projects`. GET/POST collection list/create only the authenticated owner’s
projects. GET/POST `/:slug/edit` read/save its private draft, optionally publish
with `{config, publish:true}`. DELETE `/:slug/published` unpublishes; DELETE
`/:slug` removes permanently and retains the slug. GET `/:slug` returns only a
published, nonremoved project with a public owner network profile. Missing rows
use `project_not_found`; existing nonpublic rows use `project_unavailable`.

Ownership always derives from verified Supabase user plus primary M Account
link; every private query includes both owner_user_id and m_uid. Client ownership,
slug reassignment, registry binding and removal-reset fields are rejected.
Creation is INSERT (no upsert); the primary key handles concurrent slug collisions.
Anonymous/authenticated roles have no table grants or RLS policies.

Media validation and editor uploads use the narrower prefix
`front-media/<auth uid>/projects/<slug>/`. Other projects and the personal page
cannot be referenced through customer JSON. Editor cleanup must stay within that
prefix. Existing account storage policies remain the storage boundary; projects
are pages owned by that same account, not separately delegated tenants.

## Integrated editor and renderer contracts

- Mount the handler in the canonical Worker; no new service.
- Link `customer-projects.html` from the customer hub.
- `project-studio.html` loads `js/project-studio.js` before existing front-studio.js.
  It sets `__MCC_PROJECT_STUDIO=true` and validated `__MCC_PROJECT_STUDIO_SLUG`.
  Missing/invalid slug must fail closed instead of opening the personal editor.
- Shared editor GET/save `/v1/fronts/me` becomes `/v1/projects/<slug>/edit`;
  delete publication becomes `/v1/projects/<slug>/published`. Preview, public URL,
  sign-in return and success copy use `front.html?project=<slug>` consistently.
- Availability fields match member fronts: publicly_available, publish_blocker,
  profile_visibility, removed. Do not equate saved publication with public access.
- The public renderer and same-origin iframe draft preview use this routing.
  Private previews must not fetch public drafts or fall back to personal pages.

## Vaunt boundary

Reviewed reference: PR #621 head `100dbcfc2f93acb4ed7d14b7ff4eb3e6d7fcb188`,
`docs/control-plane/VAUNT-PROJECT-PAGE.md`. The slug `vaunt` is reserved against
self-service creation. No operator seed is supplied: resolving Matthew's real
user/M Account and approving the exact seed is a separate production action.
An eventual reviewed seed may bind immutable registry_key `vaunt`. Customer API
cannot set or change this binding. The renderer must resolve approved local assets
through the frozen registry, never through relaxed customer media validation.

Static `?project=vaunt` fallback may occur only for explicit project_not_found
and a known frozen registry entry. Never fall back on outages, removed/private
projects, authentication failure or malformed responses. The static registry is
in separate PR #621, not assumed deployed or present on main. Any future release
must preserve its scene order, soundtrack, album links and shared footer hooks.

## Verification

- `node --test workers/mccluster/test/managed-projects.test.mjs`: synthetic two-owner
  API fixture tests, public/private separation, private profile gate, collisions,
  owner reassignment denial, removal, reserved Vaunt, per-project media prefixes.
- `PGLITE_DIR=<node_modules> node scripts/test-managed-projects-db.mjs`: isolated
  Postgres checks direct anon/member denial, slug uniqueness, publication/removal
  constraints and registry binding. No production or external requests.
- Shared editor/renderer browser fixtures verify project editing, publication, media separation and account-switch clearing.

`supabase/pending/managed_projects_v1.sql` must be reviewed and applied only after
separate explicit production approval. The existing front-media bucket/policies
must also be provisioned before uploads work. Missing schema/configuration returns
503 without reporting successful setup. No provider, account, seed, storage or
schema has been changed in production by this task.
