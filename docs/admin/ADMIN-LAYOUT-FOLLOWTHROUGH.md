# Admin layout follow-through: integration handoff

This draft adds local category navigation for Sell/Create/System and an Analytics
layout editor with a strict six-view contract. It does not claim production
persistence or a completed rollout. No shared shell file or canonical registry was
edited. The release owner integrates the hooks below alongside #780 and #771.

## Presentation change

`section-groups.js` derives all destinations from `CR.nav`. Sell has Orders &
payments / Store & music; Create has Make / Publish / Build worlds; System has
Health & activity / Operate / Build & programs. The active category displays up
to three existing destinations. Existing item subviews, actions, metrics, filters
and forms stay mounted by the shell's existing renderer. Future registry items
are included automatically in additional groups, never silently dropped.

This replaces the long flat local tab strip, not the bottom app bar. It does not
add a global navigator, synthesize health figures, collapse error evidence or
change any route. Existing shell route binding preserves in-place navigation and
Back/Forward. Native links remain usable before enhancement. Category labels and
counts are navigation descriptions, not operational metrics.

## Additive shared hooks (release owner)

1. In `control.html`, load `css/control-admin-layout.css`, then defer
   `js/control-room/section-groups.js` and `js/control-room/analytics-layout.js`
   before `control-room-v2.js`. Keep #780's widget definition and #771's readiness
   modules and their hooks intact.
2. In `sectionHead(entry, right)` of `js/control-room-v2.js`, immediately before
   `var views = it.views && it.views.length > 1 ?`, insert:
   ```js
   if (window.CR.sectionGroups) tabs = window.CR.sectionGroups.render(entry) || tabs;
   ```
   Preserve the existing `views`, `right`, header and `bindNavLinks` code. The
   module returns null for Inbox and other destinations, preserving their UI.
3. Analytics Setup is the intended location for `CR.analyticsLayout.render()`.
   After rendering, bind with the canonical owner adapter described below; retain
   the returned handle and dispose it before replacing/unmounting the editor.
   Wire `onSaved: CR.analyticsDeck.configure` and
   `onInvalidate: () => CR.analyticsDeck.configure(null)`. An absent adapter shows
   the unavailable explanation with Save/reset disabled. Do not advertise shared
   persistence or enable the hook's saving until the backend gate is satisfied.
4. The canonical auth/owner-revocation path must call `handle.invalidate()` in
   addition to existing `mcc:auth-changed`/session-storage notifications. This
   clears the editor and configured deck. `dispose()` fences late responses and
   unregisters listeners. Existing explicit route/deep-link selection always
   wins over a chapter's chosen opening detail.

The test-only `scripts/e2e/support/admin-layout-hooks.mjs` composes steps 1–2 in
memory into the actual Control shell. Set `ADMIN_LAYOUT_HOOKS=1` for the existing
Control browser suite. It does not modify those shared source files.

## Canonical persistence gate — unresolved, not simulated completion

Reviewed main baseline `968de211a2239dea7816016efd7cc356d5040161`, #780 head
`c4757dc9902c2328dbe70978077e031d6a8dd618`, and #771 head
`cebbbe2c0e13a1bf56ea1d33cc316c5788b3a976`.

The existing front-page publisher is content-specific. #780's publisher accepts
only inactive widget definitions in `platform_apps.settings.widget_access_v1`;
it rejects other fields, preserves unrelated settings, and is not a generic
layout service. #771 inspects readiness, not layout persistence. The Analytics
client/router has no layout read/write contract. The historical
`level3_owner_self_service_settings` migration is a ledger anchor, not a usable
layout API. A JSON settings column alone is not a safe authorized edit contract.
Do not write layouts into those namespaces, reuse a content draft, or bypass
publication with a raw table update.

This change supplies no RPC name, endpoint, SQL, storage fallback or second
configuration authority. The release owner must identify/extend the canonical
owner configuration service with a reviewed layout namespace, permission and
revision contract. Until then, production saving is unavailable.

### Adapter boundary for the canonical service

`bind(container, {adapter, identity, onSaved, onInvalidate})` expects:

- `identity()` returns a stable authenticated principal identifier or null. This
  fences stale UI results; it is not authorization and must not use email or
  client role labels as proof of ownership.
- `adapter.load()` returns `{schema:'analytics-layout/v1', revision: string,
  layout: {version:1, order:[...six IDs], defaults:{...six detail IDs}}}`.
- `adapter.save({expectedRevision, layout})` returns the same envelope only after
  authoritative persistence; it must enforce current owner authorization and an
  atomic revision match server-side. The revision is opaque to the browser.
- Reject revoked/denied access with status 401/403, stale state with 409, and
  missing schema/service with an error. Never turn an error into a default
  successful response. Any failed write disables further edits until reload,
  because its commit outcome may be uncertain. No automatic retry occurs.

The canonical backend must validate the exact same versioned schema independently:
Overview stays first; all six groups occur once; every default belongs to its
fixed group; extra fields are rejected. There is no hide/delete/grant/tier flag.
All eleven detail renderers remain accessible. Server authorization must preserve
house-owner checks, applicable tenant/resource scope, and account-change fencing.
Before enabling production saves, require canonical schema/replay evidence,
unauthorized read/write tests, concurrent stale-write tests, persistence across
reload, and recovery/rollback evidence. The UI fixture is not that evidence.

## Validation

Source tests cover layout rejection and all retained chapter/section destinations.
`admin-layout.e2e.mjs` uses the actual modules with an explicitly synthetic adapter
at 390/1280: load, arrange, save, reload, explicit reset, stale conflict, revoked
access, account change during a write, absent service, retained section routes,
Back navigation and page overflow. Browser evidence is local and fixture-only.
`control-room-nav.e2e.mjs` with the additive hook traverses actual shell content,
legacy aliases and existing local operations. `analytics-tabs.e2e.mjs` continues
to cover all eleven existing detail renderers without configuration.

The PR workflow runs source, isolated browser and composed-shell checks and
retains screenshots. It does not write production settings or run migrations.

Remaining original-mission gates: canonical Analytics persistence/authorization,
release-owned shared hooks, broader editor-specific simplification beyond local
navigation, and authenticated live acceptance after coordinated rollout. No new
AI model/trigger editor, billing logic or entitlement grants are introduced.

Local results before publication: 109/109 focused source checks, 80/80 isolated
module browser checks at 390/1280, and 214/214 composed-shell browser checks at
390/820/1280 passed. The synthetic adapter proves editor state transitions and
reload/remount, not a real database or managed owner authentication. Exact-head
hosted workflow evidence belongs to the draft PR checks.
