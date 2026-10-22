# Owner Control: Intelligence / Operations / Studio

Status: implementation for owner review, 2026-10-16. Not deployed. PR #470.

## Entry and scope

The preview lives in the existing `control.html?workspace=1#analytics`, not a
new admin application. Query opt-in is a presentation choice, never permission.
The existing user token is checked against `/v1/workspaces/me`; the selected
enabled workspace must be `slug=mccluster`, `kind=studio`, `role=owner` and have
an authenticated profile id. API/database authorization remains unchanged.
Without the flag, the original Control UI is unchanged.

No public World file, shared app-bar file, Worker API, provider secret, database
migration, bank integration or paid feed is changed here.

## Capability preservation

`workspace-core.js` enumerates every native route. Tests compare it to the
actual original Control route arrays so a missing subview fails CI.

| Existing route | Page | How it remains usable |
|---|---|---|
| `#analytics` | Intelligence | Same native analytics module, black globe, filters, charts, Details and Forensics |
| `#home` | Operations | Existing overview and actionable attention list |
| `#work:*` (all 15 views) | Operations | Native inbox, CRM, people, organizations, tasks, bookings, orders, projects, deliverables, payments, renewals, outreach and administration |
| `#system:*` (all 5 views) | Operations | Native command, overview, workload, observability and resources |
| `#apps` | Operations | Existing application registry; its Halo tile opens the one Halo (the four screens on the globe) |
| `#ai` | Operations / global command | Existing McCluster conversation and command palette; no new model or paid call |
| `#create:*` (all 9 views) | Studio | Native projects, library, publishing, channels, Instagram, music, clipping, missions and song tests |

The selector remembers the last route per page. Existing links and browser
Back/Forward retain their semantics. Operations/Studio reuse existing editors,
inspectors and mutation handlers; this is not a completed redesign of every
individual editor. The globe's current geography is not silently imposed as an
Operations record filter.

## Black globe preservation and lifecycle

The existing analytical Earth retains its colors, lighting, boundaries, lake
geometry, country/state selection and privacy-suppressed aggregate handling.
The same DOM and Cesium instance survive switching pages. Its render loop stops
while detached, in details focus, or in a background tab. Revocation
and page exit destroy the widget, handler and observer; late loads cannot
recreate a destroyed scene.

Portrait uses a globe above the inspector; landscape uses a roughly 60/40
split with an independently scrolling inspector. Focus details yields the full
workspace to the cards. New controls are touch-sized and reduced-motion aware.
The global bottom bar is not redesigned.

## Halo: one page, not an embed

**Superseded 2026-10-22** (owner: "it takes you to multiple different places. Not everything is consolidated"). The
Intelligence scene control no longer frames the separate Halo app at `https://prime.mccluster.org/` and no longer hands
it the owner's session. Its Halo button is now a door to the one Halo, the four screens on the globe
(`action-globe.html?explore=1&halo=1`, `docs/control-plane/HALO-ADMIN-GLOBE.md`), the same page the Control tile and the
Control menu open. The black globe is the only scene drawn here. The workspace keeps no frame, timer or message listener
for Halo, and nothing in it posts a message to another site.

The two old Control product shortcuts are corrected only in this opt-in preview.
Legacy Seek First APIs and application are not deleted or renamed by this PR.

## Evidence and review gates

Local Node 22.16.0: 11 new unit tests pass; JS parse and diff whitespace checks
pass. A partial source archive cannot prove the complete old regression suite;
that is run by the repository CI against this head.

Local Chromium navigation is blocked by managed browser policy. That policy was
not changed. Browser testing runs in the dedicated read-only GitHub Actions job,
with real Cesium 1.131.0, 1180x820, 820x1180 and 390x844 viewports and synthetic
API responses. Every network request is intercepted. The Halo door is checked to
open the one Halo page and to make no request to the separate app.

The workflow uploads screenshots, a results file and failure evidence. Screenshots
are labeled synthetic; they are not production analytics. Do not merge for public
rollout before screenshot review. Record actual final CI results on the PR.

## Follow-up not implemented here

- A shared Halo renderer with actual owner analytics layer adapters and synchronized camera.
- Deep visual/interaction parity of every Halo capability with upstream God's Eye View.
- Relationship/evidence graph, time-aligned cross-dataset investigation and new source adapters.
- Bank/investment data, paper/live trading, routing provider geometry, flight-aware dispatch.
- Complete bespoke redesign of each Operations/Studio editor and AI side drawer.

Those require separate source/license/security and interaction tests, not a
claim that a three-page shell finished the whole product.

## Rollback

Remove `workspace=1` from the URL for the unchanged legacy interface. Revert this
PR to remove the preview. No database, key, account or provider rollback exists.
