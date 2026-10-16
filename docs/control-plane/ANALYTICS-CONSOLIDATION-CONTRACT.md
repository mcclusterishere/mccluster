# Canonical Analytics consolidation contract

## Owner-facing source of truth
`control.html#analytics` and `js/control-room/analytics.js` are the sole owner-facing Analytics interface. `analytics.html` is a legacy entry point and must redirect after functionality parity is proven. No new owner-only features may be shipped solely in `analytics.html` or `js/analytics.js`.

## Parity migration
- Inventory all panels, filters, drilldowns, scoring, exports, setup, user journeys, attribution, cohort views, and permission checks from the legacy interface.
- Classify each as already native, migrate, deliberately retire, or backend-only; retain evidence of parity tests.
- Users tab must show real API states: loading, authorized empty, unauthorized, and transport/server errors; never silently hide API failure.
- Preserve deep links, date range, selected property and browser navigation.
- Keep `legacy_preview` strictly temporary and remove only after parity tests pass.

## Synchronization guarantees
- Shared authoritative endpoints and database queries; never client-side synthetic metric totals.
- Stable event IDs and replay-safe ingestion, consistent time-zone/window semantics, and documented aggregation definitions.
- Auth and organization scope checked server-side; UI visibility is not authorization.
- Use one request sequence/abort policy to prevent stale responses overwriting a newer property or date range.
- Refresh after mutations, expose data freshness, and support explicit reload and error recovery.
- Test Control Room against the same API fixtures as legacy views; no independent score formulas.

## Release gates
1. Control Room Users tab mounted, searchable, authorized and error-aware.
2. Parity matrix complete with deliberate retirement decisions.
3. Analytics and owner authorization integration tests green.
4. Legacy redirect tested with browser navigation and no redirect loops.
5. Production deployment verified by checking served asset revision and authenticated API.
