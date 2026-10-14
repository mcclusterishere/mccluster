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
- **Street Credit Bureau**, a McCluster Corp program, is the proposed issuer and steward of Street Credit. Equity Uprise is a separate McCluster Corp program and may contribute verified activity evidence under an approved rubric. Neither program may score protected traits, neighborhood, wealth, political affiliation, or inactivity.
- Do not use Street Credit for credit, employment, housing, insurance, or other eligibility decisions. Avoid unreviewed global rankings of people; prioritize project-level accomplishments.
- All writes require authenticated authorization, anti-bot/anti-fraud checks, audit logs, reversible moderation, and tests for duplicate joins and account transitions.
- **Implementation status:** requirements only; no database tables, API endpoints, or counters are claimed to be implemented by this document.

## McCluster Corp program architecture and paid cohort handoff (founder direction, 2026-10-14)

**Ownership and hierarchy**
- **McCluster Corp** is the umbrella organization behind Human Uprise, Equity Uprise, Street Credit Bureau, and the creator/influencer initiatives. Preserve corporate ownership and brand separation in navigation, permissions, contracts, and reporting.
- **Human Uprise** is the movement-creation platform: people discover movements, start their own, join with verified identity, perform missions, and generate verifiable records of contribution.
- **Equity Uprise** is a program under the umbrella, focused on equity-related movements and actions. It can produce evidence of completed activities but does not issue Street Credit independently.
- **Street Credit Bureau** is the McCluster Corp program that issues, administers, audits, and handles appeals for **Street Credit**. Treat this as a contribution credential/reputation program, *not* a consumer credit reporting agency, FICO-like credit score, or claim of regulatory accreditation. Naming, public claims, consent, and applicable legal obligations require review before launch.
- **Clipping / creator network** is a distinct, related product surface and workflow. Do **not** clutter the Human Uprise globe, movement creation, or public feed with clipper recruitment and campaign controls. Link into it from appropriate creator or program-management areas, sharing identity and verified ledger events where authorized.

**Rise / Uprise accounting**
- A movement's first verified, consented membership join produces **one unique Rise** on that movement. Explicit reactions and completed verified actions are separate event types; a verified account alone is not an automatic join.
- **Verified Uprises** for eligibility are a separate, fraud-resistant tally of approved, attributable contributions, not raw reactions, page views, reposts, or self-awarded clicks. Define and version the earning rules; show an explainable audit trail and allow corrections and appeals.
- A participant can create and operate a movement without reaching a reputation threshold. Thresholds apply to *optional elevated roles or paid program consideration*, not basic expression or participation.

**Potential earned roles and cohort ladder — proposed, not yet approved**
1. Member / movement starter: create and join movements, perform missions, collect verifiable contributions.
2. Contributor / Clipper: opt into creator tasks in the separate creator network, with clearly scoped deliverables and validation.
3. Program Influencer: eligible for supervised recruitment, amplification, mentoring, or movement-support work.
4. Program Manager: eligible for additional training and authorization to coordinate program operations, subject to human review and explicit role grants.
5. Paid cohort participant: may receive a stipend or per-deliverable compensation under an approved agreement, budget, and verified earnings process.

**100 verified Uprises** is the founder's *candidate threshold* for consideration for a paid cohort or elevated program roles ("Give me 100 up"). It is **not** an automatic offer of employment, a promise of payment, a universal prerequisite, or a final payout formula. Eligibility must also consider relevant skills, capacity, approved work, safety/compliance checks, program budget, and transparent human review. Allow an appeal or alternative assessment where appropriate.

**Integrate with the existing influencer/cohort concept**
- Reuse the planned creator stipend and incentive framework as an input, not a live payment guarantee: previous planning included a $50/month influencer allocation split between $25 base stipend and $25 incentives, 3-month cohorts, and roles across artists, producers, editors, videographers, and audio engineers. Pricing, staffing, compensation, and cadence remain subject to approved budgets and signed agreements.
- A creator's Rise or Street Credit status may open an **application/invitation** to a cohort. Compensation only accrues from accepted cohort terms and completed eligible work; do not transfer money solely because a counter crossed 100.
- Reuse the existing Stripe Connect verified-earnings, account-binding, payout reconciliation, and owner Control workflows only after end-to-end security and test-mode verification. Never make client-side tally changes trigger transfers.
- The clipper experience should be simplified into a separate minimal journey: **See task → Claim task → Submit clip → Review → Earn**, with program-owner approval, anti-fraud checks, and transparent payment terms. Keep it out of the globe's primary navigation.

**Next-agent implementation sequence**
1. Inventory existing Action Network membership, reaction, mission-proof, clip campaign, cohort, role, and Stripe Connect schemas and open PRs before building duplicates.
2. Design event-sourced or immutable audited records for `movement_join_verified`, `rise_reaction`, `mission_contribution_verified`, `street_credit_awarded`, `street_credit_reversed`, `cohort_application`, `cohort_approved`, and `cohort_earning_verified`. Specify deduplication keys, authorization, consent, retention, and reversals.
3. Build owner/admin policy and rubric versioning for Street Credit Bureau, transparent member history, dispute resolution, and privacy controls. Review use of the term "credit" and any relevant regulatory implications.
4. Add a configurable, **disabled-by-default** 100-verified-Uprise eligibility signal and human-reviewed application to paid cohorts. No automatic role promotion or payouts.
5. Keep the clipper network modular; audit and simplify existing clipper PRs instead of duplicating infrastructure inside the globe.
6. Test anonymous/member/creator/program-manager/owner authorization, duplicate joins, fraudulent submissions, threshold transitions (99/100/101), reversals, consent withdrawal, and Stripe test-mode settlement.
7. Do not merge or deploy these features on documentation alone. The current PR remains subject to the separate globe/security release gates above.

**Status:** product and architecture notes only. This change does not create credit scores, roles, cohorts, compensation, or transfers.

## PR #427 release blocker execution checklist (2026-10-14; owner-requested)

**Release status: BLOCKED.** Do not merge, run production migrations, cut over DNS, or enable payouts on the strength of green CI alone.

### 1. Migration reconciliation — highest priority
- Live Supabase project `zmnhbrjyhxzhkxmhkexs` reported **302** distinct migration versions; branch `supabase/production-ledger.json` reports **301**. The live latest is `20261014023813 gdelt_backoff_cache`; the branch ledger's latest is `20261014083000 gdelt_backoff_cache`.
- Additional same-name/different-version examples: live `20261014013557 action_globe_regions` versus repository `20261013233000_action_globe_regions.sql`; live `20261014014547 action_globe_region_activation` versus repository `20261014040000_action_globe_region_activation.sql`.
- Do **not** assume matching names mean matching SQL, or assume the extra migration is safe to discard. Retrieve full production history, migration contents where accessible, and local files; produce a name/version/checksum comparison including duplicates, missing and renamed migrations. Check for pending PR overlaps and the repo's production-ledger generator.
- Prefer a fresh staging clone and schema diff. Reconcile history using supported Supabase migration repair only after verifying applied schema and obtaining explicit production-change approval. No blanket replay, deletion, or history rewrite.
- Acceptance: deterministic ledger generation; documented one-to-one or justified exception mapping; staging `db push --dry-run` / schema comparison; no unintended production DDL.

### 2. Guest / member / program-manager / owner authorization
- Inventory existing M Account auth, `m_people` identity, service-role APIs, RLS policies, and owner Control session enforcement.
- Build a route-to-permission matrix covering globe, public mission details, join/claim/proof, funding, publication, Street Credit issuance, cohort roles, and private analytics. Explicitly test unauthenticated, unverified, authenticated, cross-account, program-manager, and owner/admin cases.
- Public globe RPCs must return only approved data. Client-side hiding is not authorization. Never ship service-role secrets in browser JS. Verify SECURITY DEFINER grants/search paths and inspect Supabase security advisor warnings.
- Ensure member/admin UI is session-aware while server checks remain authoritative. No implicit program-manager privileges from a reputation tally.

### 3. Regional eligibility
- Distinguish *browse worldwide* from *participate in a region*. `Near me` currently pans the camera and **does not verify residence**.
- Define consented, server-validated regional affiliation, verification/appeal, opt-out, moves, and region activation. Do not derive residency from IP, nearest centroid, or unverified browser GPS.
- The existing `action_globe_can_join_mission` is service-only and explicitly a **prerequisite**, not complete join authorization. Wire it into the canonical identity-bound mission join transaction with all existing eligibility checks.
- Test zero/one/two-member activation, public suppression below five, cross-region access, and concurrency.

### 4. Mission participation, evidence and funding
- Inventory existing mission/assignment, payment/Stripe, receipts, refunds, creator transfer, and reconciliation endpoints before implementing duplicates.
- Complete authenticated **discover → join/claim → do → submit evidence → review → verified contribution** journey, including idempotency, authorization, moderation, disputes, audit logs, and explicit states.
- Complete **fund → payment confirmation/webhook → allocated funding → refund/reversal → verified impact** journey in Stripe **test mode**; do not infer payment from client redirects.
- Do not award Street Credit or cohort eligibility from a self-reported action, a mere click, or unverified payment.
- Ensure funding, payouts, and member-facing proof never expose sensitive payment details.

### 5. End-to-end browser acceptance
- Use Playwright or an equivalent real-browser harness against a staging environment with seeded, non-production test identities. Test desktop, iPhone-sized, and Android-sized viewports, keyboard navigation, reduced motion, and low-memory/no-WebGL fallback.
- Cover guest globe rotation and navigation, sign-in/session expiry, member-only actions, wrong-region denial, legitimate-region join, duplicate join, evidence submission, admin review, funding receipt and webhook, privacy thresholds, and owner-only publication.
- Add runtime/API assertions and negative authorization tests; source-text regex checks alone do not establish behavior.
- Publish CI artifact evidence, failure screenshots/traces, test account setup, and an explicit go/no-go report for #427. Re-run all checks on final head commit.

**Required handoff:** for every blocker, include file paths, tests added, commands/results, schema diffs, open risks, and exact commit IDs. Do not mark an item fixed without evidence.
