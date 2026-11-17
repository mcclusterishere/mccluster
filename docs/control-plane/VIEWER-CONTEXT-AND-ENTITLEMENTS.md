# Viewer context and entitlements

Status: queued, design direction only. Nothing here is built yet. Resume point for any session.

## The owner's request (2026-11-17)

"The entire site needs to be more intelligent. It should know if someone is logged in and what they've opted
into such as the creator account opt in. It needs to have a better recognition of what's going on and not serving
'sign up' suggestions to people who are already signed up for that service. I think this should be implemented or
a system created for this especially because there are going to be modules we are gonna be selling to the end
user."

## What already exists (read on 2026-11-17 against `main` at `fc1986ec`)

- **Sign-in state**: the browser session (`mccdb_session`), `js/mcc-auth.js`, `js/tabbar.js`, and the
  `mcc:auth-changed` event, which 56 files listen to. Each page decides for itself what a signed-in visitor sees.
- **Owner detection**: `GET /v1/status` is house-owner only (`workers/mccluster/src/ai/envelope.js`); everyone else
  is refused. The bar turns its answer into `mcc:appbar-admin`. No equivalent answer exists for ordinary members.
- **Entitlement reads already in the code**: `js/backend.js` `entitlements()` (table `entitlements`: `sku`,
  `expires_at`); `GET /v1/creator-billing/entitlement` (creator plans), used by `js/mccluster-creator-account.js`
  and by the member desk's "business" capability (`js/member-desk-core.js`).
- **Canonical tables that record what a person has**: `creator_billing_subscriptions`, `creator_billing_events`,
  `creator_consultation_entitlements`, `creator_published_sites`, `api_plans` and `api_subscriptions`,
  `music_entitlements`, `network_profiles`, `org_members`, among others.
- **Installation-level module switches** (not per person): `eup_module_policies` (`environment`, `league`,
  `intake`), applied to production on 2026-11-17 as `20261117144103_eup_module_policy_v1`.
- **Hard-coded prompts**: about 46 sign-up, create-account, get-started, become-a-creator and opt-in prompts in
  pages and scripts, none of which can ask what the visitor already has.

## The target

1. **One server answer per visitor** from Worker `mccluster` (for example `GET /v1/me`): signed in or not; profile
   completeness; roles (house owner); opt-ins (creator account, Environmental Justice Team, and the others the
   inventory finds); entitlements (each purchasable module or plan: SKU, status, expiry, source). It reads the
   canonical tables above with the service role after verifying the bearer, answers `private, no-store`, and adds
   no second auth, billing, entitlement or profile store. A guest gets `{ signed_in: false }` without a database
   call.
2. **One client module** (`js/viewer.js`): a ready promise, a `mcc:viewer-changed` event, refresh on sign-in and
   sign-out, after a purchase or opt-in completes, and on focus after a short staleness window. Its cache is tied
   to the session, so a signed-out tab never shows a member's state.
3. **Declarative prompts**: every sign-up, opt-in, upgrade and buy prompt states who it is for (for example
   `data-for="guest"`, `data-unless="creator"`, `data-unless="owns:<sku>"`), and one rule engine applies them,
   including to prompts inserted later. A prompt stays hidden until the answer is known (or shows a guest-safe
   default), so nothing flashes.
4. **A module catalogue** (`data/modules.json`): each module or plan sold to end users, its SKU, the canonical source
   that grants it, and its prompts. The server stays the authority for access; the browser uses the answer only to
   decide what to show.
5. **Tests by persona**: guest, member, member with an unfinished profile, creator (opted in), paying creator,
   module owner, house owner. No persona is offered a sign-up, opt-in or purchase it already has, on any page, at
   390, 820 and 1280 px.

## Rules that apply

`AGENTS.md`: McCluster is the backend (no second auth, billing, CRM or entitlement service); two properties, two
entities (Matthew McCluster's and McCluster Corp's prompts stay on their own property); mobile first; the logo law.
Access is always decided by the server; hiding a prompt never grants anything.

## Queue

| Step | What | State |
| --- | --- | --- |
| 1 | Understand (read only): every prompt and every state source, mapped page by page | queued |
| 2 | Design: the endpoint contract, the rule vocabulary, the module catalogue; owner review of anything that changes what a paying customer sees | queued |
| 3 | Build, review, verify by persona | queued |
