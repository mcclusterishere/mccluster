# Final admin editor presentation continuation

This continuation closes the three concrete editor presentation gaps identified
in #788. It adds no backend behavior, permissions, billing operations or telemetry.
It preserves #784 and #788, including pending SQL and release-owned integration.

## Delivered behavior

- **Payments/Renewals:** compact All / attention-state / other-state counts over
  the currently loaded rows, explicitly labelled as such. Counts are not revenue
  or a full-ledger total. Each button opens the original table filtered to its
  records; All restores every row. Amounts, currencies, provider verification,
  test-mode notices, state controls and original New/Cancel/History actions stay
  in the existing renderer. No new overdue calculation or payment action.
- **Channels:** registration and campaign forms become native expandable panels;
  the account list and composer remain available. Close details preserves the
  actual form nodes and typed values. Existing errors and pending actions force
  the panel open; native invalid events reveal their control. No credential,
  publishing or channel permission behavior changes. Read-only sessions never
  acquire the owner-only forms.
- **Resources:** Connections, Usage & access, Catalog and Applications become
  compact expandable evidence panels. Where present, summary values copy the
  first three already-rendered properties verbatim. No inferred money/health or
  extra aggregation. Read platform state remains exposed until read; failed reads
  expand their original error/retry evidence. Allowance inputs and existing
  consumer/resource inspectors retain their original nodes and handlers.

The enhancer moves existing DOM nodes instead of reconstructing forms. It makes
no fetches or writes. Its memory holds only open/filter choices, scoped to the
selected workspace and cleared on auth/session changes. Detached render results
are ignored. Scope changes clear those choices; nothing is stored in localStorage.
All original route and server authorization behavior remains authoritative.

## Exact additive shared hooks

The release executor owns `control.html` and `js/control-room-v2.js`; neither is
modified here. Keep #771/#780 and #784/#788 hooks intact.

1. Load `css/control-editor-presentation.css` and defer
   `js/control-room/editor-presentation.js` before `control-room-v2.js`.
2. In `render()`, immediately after its existing `bindSurfaceControls();`, insert:
   ```js
   if (window.CR.editorPresentation) {
     window.CR.editorPresentation.enhance(root, {
       route: state.route,
       scope: state.org && state.org.id
     });
   }
   ```
   This runs after existing action binding; moved elements keep those listeners.
   It only enhances the canonical payments/renewals, channels and resources
   routes. Unknown routes/structures remain unchanged, preserving fallback UI.
3. At the existing verified auth/owner reset, call
   `CR.editorPresentation.clear()` alongside existing private-state clearing.
   The module already listens to `mcc:auth-changed` and session storage events.
   This call clears presentation preferences, not credentials or application data.

`scripts/e2e/support/editor-presentation-hooks.mjs` composes these hooks into the
real shell in memory for tests. The route inventory, renderers and form handlers
are the checkout's actual code, not alternate test implementations.

## Finite original-mission acceptance map

| Original request | Source coverage | Remaining acceptance |
| --- | --- | --- |
| Inbox consolidates People; Home rename; in-place mobile admin shell | #745 incorporated by #754; #784 categories | Release integration and authenticated navigation |
| Consistent owner bar, Games after World, Inbox before Home, Profile dropdown, overflow guidance | #745 plus subsequent seven-visible refinements | Verify deployed assets and owner/member sessions |
| Graphical Analytics with at most six primary tabs and retained detail | #745/#754, all eleven renderers retained | Live source/permission acceptance |
| Owner-configurable Analytics layouts | #784 editor + #788 canonical RPC/adapter/native proof | Pending SQL promotion/replay, lifecycle hooks, live persistence |
| Clear AI reply controls where supported | Existing backend controls and explanations retained by #745 | Live authorized control access; no new model/trigger API required |
| Understandable System errors and evidence | #745/#754 status/grouping/drilldown; this Resources presentation | Live data provenance and unknown-state acceptance |
| Remaining Payments/Renewals, Channels and Resources simplification | This continuation | Integrate additive enhancer and run composed live acceptance |

With this continuation, the identified source presentation scope is finite and
covered. Further visual redesign is optional, not another undefined completion
gate. The mission is not yet “live complete”: release-owned shared hooks, #788
schema promotion, managed-auth/role checks and live acceptance are still real gates.

## Verification

Run focused aggregate source tests and the full real-Control browser suite with
`ADMIN_LAYOUT_HOOKS=1 EDITOR_PRESENTATION_PROOF=1`. The suite retains the original
navigation/order/AI/palette checks at 390/820/1280 and adds editor scenarios at
390/1280: drilldown/all recovery, original form validation/cancel, repeated
binding, keyboard open/close with draft retention, deliberate mutation/error,
Back/Forward, delayed resource response after navigation, failed-read evidence,
viewer role and overflow. Fixtures intercept every request; the only mutations
are synthetic requests. This is not production or physical-device acceptance.

Local results: 116/116 focused aggregate source checks and 264/264 real-Control
browser checks passed. Screenshot artifacts include payments, channels and
resources at 390/1280. The dedicated PR workflow repeats these checks on the
published head. Parent #788's native persistence proof is unchanged by this patch.
