# Equity Uprise environmental module

Equity Uprise is the product. McCluster is its current host implementation.
Reusable source now lives in private `mcclusterishere/Equity-Uprise`; this checkout consumes the exact snapshot in `vendor/equity-uprise/product-source.lock.json`. The panel keeps its original import path through a compatibility re-export.
This extraction contains a reusable environmental panel, Cesium point adapter and adapter-bound server controller. The Worker implementation retains its identity, provider/cache and persistence authority. It does not yet package the whole social network, identity service,
media infrastructure, funding rail or independent backend.

## Export into a clean directory

From the McCluster checkout:

```
node scripts/export-equity-environment.mjs /tmp/equity-environment-export
```

The output must not exist. The allowlisted manifest exports public source and
the supplied Equity Uprise artwork only. It never scans storage, environment
variables, sessions, databases, private media or Halo content. No remote repo
is selected or modified. The destination repository remains an explicit choice.

## Mount with your host adapter

Import `mountEnvironment` from `js/world-environment.mjs`. Supply a window,
document and an adapter with:

- `panel`, an empty section with an accessible label; the panel owns its children.
- `frame`, the existing globe iframe, not a new globe instance.
- `request(path, options)`, an implementation of the API contract below.
- `token()`, a current authenticated-session indicator. The UI does not store it.
- `signIn()`, your existing sign-in flow and return destination.
- `mode()`, returning `environment` while the panel is selected.
- `modeEvent` and `authEvent`, event names dispatched on the supplied window.
- `sessionStorageKey`, optional storage-change invalidation key.
- `sendGlobe(message)`, optional transport for the public pin messages.
- `revealPanel()`, optional callback to return from a full-globe view on selection.

The default pin transport is same-origin iframe postMessage. Incoming events
must match both the supplied frame and the current origin. An embedding host
using another transport must implement an equivalent authenticated origin/source
boundary; do not use a wildcard origin. Mount returns `refresh()` and `destroy()`.
Destroy clears listeners, timers and public pins. CSS uses `.we-*` component
classes; the first five rules integrate into the current World layout and should
be replaced with your host's mode/layout rules when extracting.

Load `js/environment-pins.js` beside the existing Cesium renderer. Its factory
accepts `getViewer`, `getCesium`, and a selection callback. It never constructs a
viewer, fetches data or receives account details. Call `set({on,items,selected})`,
`focus(id)`, `pick(scenePick)` and `destroy()` from the host globe. Pin fields are
limited to event ID, title, coordinates and stale status.

`js/world-environment-mccluster.mjs` is intentionally excluded from export. It is
the current first-party binding for the canonical API, M Account, sign-in route
and World mode events. It never accepts a caller-controlled API origin.

## API and authorization contract

- `GET /v1/world/environment`: versioned, bounded public government observations,
  source/fetch/observation dates, unavailable states and approved mission metadata.
- `GET /team`, `POST /team {join}`: current authenticated person's membership and
  assignments only. Repeat requests are idempotent. Never trust a browser user ID.
- `POST /missions/propose {event_id,action_id}`: server re-fetches/validates the
  observation and safe action. Creates a draft, never an approved mission.
- `GET /oversight`: verified owner only, private/no-store; proposals and assignments.
- `POST /missions/:id/review {decision}`: verified owner only, fresh-source and
  safety review, audit trail; decisions are open, paused or closed.
- `POST /missions/:id/join {}`: joined team member, approved open mission, canonical
  eligibility/capacity checks; returns a real assignment, never a fabricated one.

Relative recording links require the matching assignment UUID. They open setup;
they are not a claim that streaming is available. The capture implementation must
independently check assignment ownership, live policy, age/safety rules, camera
consent and publication opt-ins. An independent host must provide or disable that
capability. Do not copy McCluster account tokens or silently change a token's
recipient. New identity, data tenancy, storage, live media, billing and policy
provisioning require explicit design/release review.

## Current backend dependencies

The McCluster Worker adapter reuses government provider/cache modules,
`bearerUser`, `isHouseOwner`, canonical Supabase identity links, network groups,
action missions/assignments and the existing `join_action_mission` RPC. Proposed
SQL under `supabase/pending` is **not** a standalone schema. A copied frontend
alone cannot make these services appear. See `docs/control-plane/WORLD-ENVIRONMENT.md`
in the source checkout for release requirements.

No membership rows, assignment rows, credentials, deployment grants, precise
member locations or owner-only intelligence belong in this package.
