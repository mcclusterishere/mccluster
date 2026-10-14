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

## Rise, movement tallies, and Street Credit (proposed product contract)
- **Rise** is the native affirmative reaction. It replaces the ambiguous favorite/like vocabulary for Human Uprise movement participation, while ordinary content reactions may remain separate if required by existing clients.
- A **verified, consented join** to a movement counts as exactly **one unique Rise** for that movement. Email/account verification alone does not automatically enroll a person into an unrelated movement.
- Separate counters: `unique_risers` (distinct verified participants), `verified_actions` (completed reviewed contributions), and `supporter_reactions` (explicit reactions). Never conflate signups, reactions, or completed work.
- Deduplicate joins using an immutable account/person identity and movement ID; enforce uniqueness in the database, not merely the browser. Retries, double taps, session changes, and concurrent requests must not double-count. Define account closure and consent withdrawal semantics before launch.
- **Street Credit** is a proposed opt-in reputation record for *verified positive contributions*, not a financial credit score or an assessment of human worth. Show the evidence, criteria, appeal process, and provenance for every credited contribution.
- Equity Uprise may administer a specific transparent contribution rubric within Human Uprise; it must not unilaterally control all programs' reputation or score members on protected traits, neighborhood, wealth, political affiliation, or inactivity.
- Do not use Street Credit for credit, employment, housing, insurance, or other eligibility decisions. Avoid unreviewed global rankings of people; prioritize project-level accomplishments.
- All writes require authenticated authorization, anti-bot/anti-fraud checks, audit logs, reversible moderation, and tests for duplicate joins and account transitions.
- **Implementation status:** requirements only; no database tables, API endpoints, or counters are claimed to be implemented by this document.
