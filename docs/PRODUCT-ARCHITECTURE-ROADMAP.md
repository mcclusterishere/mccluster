# McCluster Corp product architecture and completion roadmap

**Status:** canonical product context  
**Last reconciled:** 2026-10-03  
**Repository:** `mcclusterishere/mccluster`  
**Public product map:** `mccluster-corp.html`  
**Machine-readable public context:** `data/product-context.json`

This document is the bridge between the two large product systems that were built in parallel:

1. the **public authority / identity / evidence system**, substantially reconciled in PR #314; and
2. the **Uprise Action Network / campaign / mission / proof system**, carried through the Action Network redesign and mission automation work, including PRs #292, #301 and #319.

Neither system replaces the other. The product is complete only when they behave as two sides of one McCluster Corp operating system.

---

## 1. Product thesis

McCluster Corp is not a collection of unrelated microsites.

It is one operating organization with several deliberately distinct surfaces:

- **public authority:** who/what is real, what is documented, and what source supports it;
- **platform:** shared identity, database, API, automation, analytics, payments and release infrastructure;
- **Control:** the owner/operator plane;
- **Equity Uprise:** public-interest research, education, campaigns, culture and community action;
- **Uprise Action Network:** the member participation product;
- **PRIM3:** applied technology/cybersecurity learning;
- **studio/services/media:** commercial work, catalogue, licensing and production.

Those surfaces may look different because they have different jobs. They must not disagree about canonical entities, accounts, campaigns, evidence, ownership, status or outcomes.

### The two loops that must join

Authority loop:

`Claim → evidence → canonical entity → public page → machine-readable record`

Action loop:

`Understand → Choose → Act → Prove → Verify → Progress → Collaborate`

The bridge is deliberate: a documented issue, story, release, public record or campaign should be able to hand a person into an appropriate action; a verified action should retain enough provenance to point back to what the mission was for and why it existed.

---

## 2. Canonical entity and product boundaries

### McCluster Corp

- One Organization `@id`: `https://matthew.mccluster.org/#mccluster-corp`.
- Company property and the Organization's `url`: `https://mccluster.org/`, served by the `mccluster` Worker once the owner routes the apex to it (`docs/control-plane/DOMAINS-AND-ENTITIES.md`).
- Human-facing company/product map on Matthew's property: `/mccluster-corp.html`. It keeps its URL; the company property links to it.
- Canonical entity record: `data/seo/entity-graph.json`.
- Public dated evidence: `data/seo/evidence-ledger.json`.
- McCluster Corp owns/operates shared platform capabilities and publishes the products represented in the entity graph.

Do not make the album homepage carry the entire corporate explanation. The HERE/I AM HERE experience is allowed to remain a media world. The dedicated company hub is the connective tissue.

### Matthew McCluster

- One Person `@id`: `https://matthew.mccluster.org/#matthew-mccluster`.
- Canonical profile: `/matthew-mccluster.html`.
- The profile, résumé outputs, recruiter surfaces, newsroom and Organization graph must agree.

### Equity Uprise

Equity Uprise is the public-interest program layer. It can own campaigns, research, evidence, public education and community action. It is not an alternate name for McCluster Corp and it is not the member application itself.

### Uprise Action Network

**Public product name: Uprise Action Network / Action Network.**

Legacy `mnet.html`, Mnet database names, URL parameters or compatibility identifiers may remain where changing them would break deployed links or schemas. Do not reintroduce **Mnet / M Network** as the public product brand merely because an implementation route still carries that name.

Its core unit is **verified action**, not a like.

Member loop:

`Understand → Choose → Act → Prove → Verify → Progress → Collaborate`

Campaign loop:

`Campaign → mission → assignment → proof → review → verified outcome → aggregate impact`

The member must never be able to self-verify, self-award, or mint a completion event.

### PRIM3

PRIM3 is the learning product. Its method is Principles, Rhythm, Immersion and Missions. It may use the shared McCluster identity/platform but must preserve its local product/game canon.

### Music and media

Music is a first-class facet of the same identity, not a disconnected duplicate account system. Media can be:
- an artistic product in its own right;
- a discovery surface;
- campaign storytelling;
- an action gateway.

Catalogue, credits, rights and licensing remain their own authoritative records. Do not rewrite music as civic copy merely to force a campaign connection.

### Whip Equipped LLC

Whip Equipped LLC is a separate company tied to Matthew McCluster through ownership/founding. It is **not** a McCluster Corp sub-brand and must not be pulled under the Organization graph merely for visual neatness.

---

## 3. Identity law

The long-term product identity is one person/account across McCluster surfaces.

### Required direction

- One canonical member/user identity (`m_uid` where that is the existing platform contract).
- Action Network profile is the action/community expression of that identity.
- Music listening/history and creator context are facets of the identity rather than reasons to create another person.
- Client/operator roles attach permissions and workspace context to the same underlying identity instead of cloning users.
- Public Schema.org entity IDs are **not** authentication IDs and must remain stable public identifiers.

Do not create a second auth stack for a new product surface.

---

## 4. Control is the operator plane

`control.html` is the canonical owner/admin operating room.

The intended owner experience is:

`Create → publish → receive participation/work → review exceptions/proof → approve/verify → measure`

The owner should not have to reconcile routine counters, copy rows between admin pages, or manually manufacture state that the backend can derive.

Legacy admin rooms can remain as compatibility surfaces while they are being retired, but new operator capability belongs in Control.

### Control must eventually own these domains coherently

- Home / decisions / things that need the owner;
- resident McCluster AI;
- CRM and relationships;
- companies;
- tasks;
- orders;
- bookings;
- campaign and mission lifecycle;
- proof review/moderation;
- content/media generation;
- social account health and publishing;
- scheduling;
- analytics;
- billing/usage/cost visibility;
- system diagnostics / jobs / audit / observability;
- specialized product Apps.

Do not create a new admin shell to solve a missing Control feature.

---

## 5. What is already real

Treat these as existing foundations, not greenfield wishlist items.

### Public authority / discovery

- canonical person and organization entity graph;
- evidence ledger and generated newsroom;
- recruiter evidence/role surfaces;
- sitemap and search/answer-engine contracts;
- public platform case study;
- structured catalogue and service/hire schemas.

### Action Network

- campaign/gateway handoff;
- Action Network member product;
- missions and assignments;
- proof upload/submission;
- Control review;
- verify/reject;
- idempotent mission award;
- skill XP;
- campaign/action accounting;
- mission counters;
- optional verified-action feed publishing;
- groups/cohorts/reward doctrine;
- account deletion request flow;
- live-video product plumbing, subject to provider provisioning/configuration.

### Platform / Control

- shared Supabase data plane with RLS;
- canonical Cloudflare Worker/API;
- Core/compute/job infrastructure;
- first-party analytics;
- social queue/publishing architecture;
- media generation jobs and cost ledger;
- release validation/rollback contracts;
- Control as the canonical operator shell.

Do not rebuild any of the above from screenshots or older handoffs. Inspect current `main` first.

---

## 6. Product-completion gaps

This is the next build order unless a production incident overrides it.

### P0 — bind the company story to the product graph

**Purpose:** stop the authority system and Action Network from reading as unrelated products.

- Keep `mccluster-corp.html`, `data/product-context.json`, the entity graph, `llms.txt` and profile links coherent.
- Every major public program/campaign should have a clear “why / evidence” path and, where appropriate, a clear “do something” path.
- Do not turn the album homepage into a generic corporate dashboard.

### P1 — finish Control as the only daily operator surface

Use `docs/control-plane/CONTROL-ROOM-BACKEND-GAPS.md` as the implementation ledger and re-audit it against current `main` before coding.

Highest-value missing contracts currently documented there:

- canonical companies model;
- stored/assignable human tasks;
- real order records;
- real booking records;
- canonical owner-facing lead creation;
- approve/reject transitions for AI decisions;
- retry/cancel transitions for social publish jobs;
- bounded owner-gated observability/events;
- accurate migration capture for live `ai_context.decisions`;
- aggregate media-spend enforcement, not visibility only.

Completion condition: the owner can run ordinary daily operations from Control without jumping into legacy CRM/back-office pages for a missing mutation.

### P2 — make identity continuity visible end to end

- Audit every login/profile handoff for one-account continuity.
- Preserve exact campaign/mission intent through auth and onboarding.
- Unify profile-level navigation so Music, HERE/Create and Action Network feel like facets of the same signed-in person.
- Add explicit workspace/role context where a person participates in more than one organization or client environment.
- Never authorize by a hard-coded email in browser code.

Completion condition: a person can arrive from a reel/campaign, sign in or create a profile, complete a mission, return later, use other McCluster surfaces, and remain the same canonical account without duplicated onboarding.

### P3 — finish the native/member product

The web Action Network is production functionality; the native application is a separate shipping target.

- complete native sign-in and session persistence;
- Action Network feed/groups/missions/profile;
- proof capture/upload and review status;
- live/watch experience where provisioned;
- push notifications for meaningful lifecycle events;
- account deletion/cancellation parity;
- deep-link parity for campaign/mission routes;
- app-store privacy, moderation/reporting and support requirements.

Completion condition: the native app is not a wrapper demo; the core Action Network lifecycle works without falling back to the web for ordinary member actions.

### P4 — make commercial work a real client product

The site can sell services; the platform still needs a coherent post-sale operating model.

Build on the shared plane rather than a new “agency backend”:

- company/contact relationship records;
- booking → project/work record;
- order/invoice/payment linkage;
- entitlement/access after purchase;
- client workspace and request history;
- deliverable/approval state;
- recurring service plan state;
- client social-account connections and publishing authority;
- tenant isolation for client sites.

Completion condition: a service lead can become a booked/paid client, receive work, review/approve deliverables and remain visible to the owner in Control without parallel spreadsheets or ad-hoc records.

### P5 — close the measurement loop

Maintain one first-party event vocabulary across surfaces.

For Action Network:
`source → campaign view → mission view → join → proof submitted → verified/rejected → shared/collaborated`

For commercial:
`source → service/hire intent → lead → consultation/booking → order/payment → delivery → renewal`

Requirements:
- durable attribution where legally/ethically appropriate;
- no public exposure of precise participant location;
- distinguish unavailable data from zero;
- campaign/action metrics derived from canonical backend events, not DOM counters;
- operator analytics must explain the selected time window and source state.

### P6 — operational maturity

- org-scoped observability/events;
- trace/correlation identifiers across Worker/Core jobs;
- backup/restore verification and migration drift detection;
- budget/cost guards at the table/service boundary;
- idempotency for external-action mutations;
- clear incident state and retry/cancel paths;
- health checks tied to the actual deployed commit;
- no silent failure UI.

Completion condition: a production problem can be detected, attributed, contained and recovered without guessing which system owns the state.

---

## 7. Cross-product content law

The product should connect attention to context and context to action without coercing every page into the same purpose.

### Public-record / policy / campaign page

Should be able to answer:
- What is this?
- What is documented?
- What is interpretation versus source fact?
- What can I read next?
- Is there an action I can take?

### Mission page

Should be able to answer:
- Why does this mission exist?
- What exactly counts as completion?
- What proof is acceptable?
- What privacy/consent rules apply?
- What happens after submission?
- What outcome/campaign will this roll up to?

### Media release

May include an action gateway where it is genuinely part of the project. It must still preserve canonical credits, rights, track order and catalogue identity.

---

## 8. Data and automation law

- Canonical counters come from backend records/events, never hand-maintained display numbers.
- A verified mission completion must be idempotent.
- A public claim must not be promoted into the evidence layer without source/provenance.
- A client or member must not be able to elevate their own role/status by browser mutation.
- Operator actions that change money, publication, verification, permissions or external systems should be auditable.
- “Unavailable” is not “zero.”
- New product tables belong on the shared Supabase plane unless an existing canonical store already owns the concept.
- Product repos and client sites are satellites/tenants, not new control planes.

---

## 9. What not to do

- Do not resurrect Mnet/M Network as the public name.
- Do not create another McCluster Corp Organization `@id`.
- Do not create a second auth system.
- Do not create a second admin/control room.
- Do not rebuild Action Network missions/proof because an older prompt does not mention the current implementation.
- Do not merge Whip Equipped into McCluster Corp.
- Do not expose internal/private personal context just because an agent has access to it.
- Do not turn public proof into surveillance: public aggregate impact and member-selected sharing are different from exposing private proof/location data.
- Do not reward political viewpoint, candidate/party support, outrage, impressions or raw posting volume.
- Do not hand-type metrics that the backend can compute.

---

## 10. Agent takeover checklist

Before a future agent changes the product:

1. Read `AGENTS.md`.
2. Read this file.
3. Read `data/product-context.json`.
4. Pull/fetch current `main`; do not trust an old handoff SHA.
5. Inspect recent merged PRs that touch the requested surface.
6. For authority/SEO work, read `docs/SEO-AEO-AUTHORITY-SYSTEM.md`.
7. For Control work, read `docs/control-plane/CONTROL-ROOM-BACKEND-GAPS.md` and re-audit it against current main.
8. For Action Network/rewards, read `docs/ACTION-NETWORK-REWARD-SYSTEM.md` and current mission/funnel migrations/tests.
9. Preserve existing stable public/entity IDs and production migrations.
10. Add/extend a contract test for any new cross-surface invariant.

The goal is not to make every page look the same. The goal is to make every surface belong to the same product reality.
