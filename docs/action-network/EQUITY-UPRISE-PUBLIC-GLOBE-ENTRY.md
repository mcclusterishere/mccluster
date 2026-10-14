# Human Uprise — public globe entry and access contract

## Brand hierarchy
- **Human Uprise** is the public parent platform, intended for `humanuprise.com`.
- **Equity Uprise** is one program within Human Uprise, not the umbrella brand.
- Other Uprise programs may share one M Account, the globe, and the mission infrastructure. Program membership and admin authorization remain separate.
- Existing McCluster corporate/music pages retain their identity. Avoid mass renames of internal identifiers without a compatibility plan.

## Routes and roles
- `equity-uprise.html` is the existing static public entry route, now displaying Human Uprise branding until a dedicated route is implemented. It embeds the interactive public mission globe and links to `action-globe.html`.
- `action-globe.html?embedded=1` uses **public RPCs only**, including when embedded; never expose private Halo data, member coordinates, or unpublished missions.
- `mnet.html` provides sign-in and the member network. Server-side RLS, RPC checks, and role verification—not visible buttons—must enforce member permissions.
- Admin-only publishing, moderation, analytics, and source management must be authorized on the server. Do not infer admin from client-side session flags.

## Production domain target (not yet configured)
- User-owned public hostname: `humanuprise.com`. Verify Cloudflare zone, actual hosting origin, TLS and CSP before creating DNS records.
- Proposed host-specific HTTP 200 rewrite: `/` -> `/equity-uprise.html` as an interim entry, preserving the Human Uprise hostname; a dedicated `human-uprise.html` is preferable later.
- Keep `mccluster.org`, `matthew.mccluster.org`, and existing routes functional. No DNS, TLS, or production routing changes are made by this PR.

## Pre-merge acceptance gates
1. Guest: interact with Earth using mouse/touch/keyboard fallback; explore approved public missions and sourced news; no member actions or private records.
2. Member: authenticate with one M Account, explore worldwide, participate only where server-side eligibility allows; exercise action, proof, and funding flows end-to-end.
3. Admin: verify owner-only approval of mission pins, program placement, evidence, and media/news sources.
4. Privacy: anonymous RPCs return no precise member locations, private profile data, or cohorts below the threshold; validate consent withdrawal and suppression at 0, 4, and 5.
5. Accessibility: mobile viewport, focus management, reduced-motion and low-memory fallback; interactive iframe must not be hidden from assistive technology.
6. Data: reconcile live Supabase migration versions against the repository ledger and test the deployed schema in staging.
7. Tests: automated and browser-based end-to-end coverage for guest/member/admin/unauthorized personas; green CI alone is insufficient.
8. Deployment: review hosting, canonical URLs, DNS, HTTPS, CSP, rollback, and monitoring before cutover.

## Current limitations
- Public globe uses public RPCs and does not yet implement role-specific data fetching.
- Near Me pans the camera; it is not authoritative proof of regional eligibility.
- The member mission participation and funding lifecycle is not established by the globe's links alone.
- The entry route filename is legacy and must not be mistaken for the parent brand.
