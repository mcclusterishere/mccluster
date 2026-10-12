# Product surface boundaries (2026-10-11)

## One administrative Control Room
**Canonical owner/admin entry:** `control.html` (including `#analytics`, `#create:music`, Work, System, and other native views).
Former standalone admin pages such as `music-admin.html` and `insights.html` are compatibility entry points and should resolve to the corresponding Control view. Do not add new operator-only dashboards to these pages. Server-side owner/ops authorization remains mandatory; hidden navigation is not an access control.

## Creator Studio: separate product, shared identity and design system
**Creator entry:** `creator.html`, with member workspace `mnet.html` and creator-specific `creator-landing-analytics.html` currently present.
Creator data must be scoped to the authenticated creator's verified identity and catalog. The existing `/v1/analytics/my-creator` API derives the creator ID from the authenticated user; never accept arbitrary creator IDs for self-service authorization.
Do not redirect ordinary creators to `control.html` or expose owner-level analytics.

## Fan experience: separate product, shared identity and design system
**Fan entry:** `listen.html` and the authenticated listening/profile experience. The existing `/v1/analytics/my-listening` endpoint is user-scoped and does not accept caller-selected identities.
Owner-only `Control → Analytics → Fans` is **not** a fan-facing dashboard: it is the administrator's verified-account explorer. Fan profiles for listeners must be separate and private to the authenticated listener.

## Compatibility and migration
- `analytics.html` and `console.html` still contain customer-facing functionality and conditional operator redirects. Do not unconditionally redirect them until the customer functions have verified replacement routes.
- `js/owner-control-redirect.js` currently treats successful `GET /v1/status` as an operator signal. Audit this authorization check: status success must not be assumed equivalent to owner access. Replace with an explicit owner-capability check before migrating redirects.
- Preserve deep links, keyboard navigation, and mobile-first visual branding.
- Consolidate only duplicate **operator** surfaces. Never merge admin, creator, and fan permissions.
- Ensure a cross-account test proves creators cannot read other creators' data, fans cannot read other listeners' data, and neither can access the owner user explorer.

## Current state / outstanding work
- Owner artist and fan analytics are being integrated into native `js/control-room/analytics.js` in PR #411.
- Legacy `analytics.html` remains until customer and owner features are reconciled.
- Creator and fan experiences are distinct product surfaces, but still share some account and navigation infrastructure.
- This is a source-level architecture inventory, not proof that deployed access rules or redirects are correct.
