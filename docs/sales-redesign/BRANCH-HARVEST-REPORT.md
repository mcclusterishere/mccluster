# Branch Harvest Report — Sales Lane Redesign

**Stage:** Phase 0, source inventory. No design or implementation work has begun.
**Base:** `claude/sales-redesign-integration`, cut from `origin/main` at `3c4c5e1`.
**Rule applied:** eat the fish, spit out the bones.

Nothing in this report changes application code. It records what exists, what is
recoverable, and — most importantly — which numbers in the brief are **not
supported by anything in the repository** and therefore require McCluster's
approval before they can be built against.

---

## 1. Headline findings

Three findings change how the redesign should be built. They are stated first
because each one invalidates an assumption in the brief.

### 1.1 The $37,080 cap is not a constant. It is a formula output.

The brief treats `$37,080` as a fixed cap. It is not stored anywhere as a fixed
number. `codex/sites-revenue-share` stores it as:

| Field | Value |
| --- | --- |
| `deal_modes/equity/cap_multiplier` | `10` |
| `deal_modes/equity/cap_basis` | `"normal 12-month service value"` |

Which resolves as `10 × 12 × $309 = $37,080`.

**Consequence:** the cap is derived from the Anti-Social monthly price. The brief
asks whether `$309` is still the right price for the newly-combined
website-plus-social service *and* states `$37,080` as a working term. Those two
statements cannot both float independently. If the combined price changes, the
cap changes with it, unless McCluster explicitly decides the cap is now a fixed
dollar amount decoupled from the formula.

**This is an unresolved business decision, not an implementation detail.** The
offer ledger will store `cap_multiplier` and `cap_basis` and compute the cap, so
the number stays correct if the price moves. It will not hardcode `37080`.

### 1.2 The combined website + social service already exists on main — at $875, not $309.

The brief says to merge website management and social media management into one
Anti-Social service, and warns not to assume `$309` survives the merge. The
repository already contains that merged product:

| Plan (main, `data/sites.json`) | Monthly | Requests/mo |
| --- | --- | --- |
| Hosting | `$87` | 0 |
| Web Management | `$309` | 4 |
| **Management + Social** | **`$875`** | 4 |

`codex/here-revenue-share-offer` has already computed an equity price for it:
`$437.50` (half of `$875`), alongside `$154.50` (half of `$309`).

**Consequence:** the strongest evidence in the repository is that Anti-Social —
website management *and* social management as one service — is the existing
`$875` plan, and its Equity price is `$437.50`. Building Anti-Social at `$309 /
$154.50` would silently reprice the combined service down by 65% and would drop
the cap from `$105,000` to `$37,080`.

**Requires approval. Not inventing an answer.** Both candidate price pairs are
carried in the ledger as `pending_approval` until McCluster picks one.

### 1.3 The Runway pricing ($30 / $30 / $60) does not exist anywhere in the repository.

A repo-wide search across every `.html`, `.js` and `.json` file returns **zero
occurrences** of `$30` or `$60` as a price. `data/domains.json` is a registry of
McCluster's own properties — it carries no customer-facing domain pricing at all.

Worse, the figure conflicts with live data: the brief specifies `$30/month`
continuing hosting, while main's Hosting plan is `$87/month`.

| Source | Hosting price |
| --- | --- |
| Brief (this request) | `$30/mo` |
| `main`, `data/sites.json` | `$87/mo` |
| `codex/here-revenue-share-offer` | `$87/mo` |
| `codex/sites-revenue-share` | plan removed |

**Consequence:** Runway's `$60` starting checkout is new pricing supplied in the
brief, not recovered from the codebase, and it either supersedes the `$87`
hosting plan or sits beside it as a different product. Which one it is changes
what happens to existing `$87` customers.

**Requires approval before Runway can be priced in the interface.**

---

## 2. Source inventory

| Branch | Behind main | Unique commits | Verdict |
| --- | --- | --- | --- |
| `main` @ `3c4c5e1` | — | — | Baseline. Authoritative for routes, CRM paths, deploy protections. |
| `codex/sites-revenue-share` | 59 | 9 | **Primary source** for mode structure and business language. |
| `codex/here-revenue-share-offer` | 59 | 4 | **Primary source** for modular architecture. |
| `claude/redesign-wip` | 66 | 1 | Visual reference only. Do not merge. |
| `claude/product-integration-4o3p2j` | — | 118 | **Unrelated history.** See §2.5. |
| `claude/sites-demo-slot` | 128 | 0 | Absorbed into main. Nothing to recover. |
| `claude/gallery-prints-selector-8qe16l` | — | 0 | Absorbed into main. Nothing to recover. |

### 2.1 `codex/sites-revenue-share` — 5 files, +448 / −688

| Recover | Reject |
| --- | --- |
| `deal_modes` structure: `M Mode` / `Equity Uprise` naming, emblems, channel | Its three-lane public architecture (Web / Photo+Video / Music) — superseded by the four-offer structure |
| `not_ownership: true`, `separate_program_accounting: true` flags | Its collapse of the hire rate sheet — the brief wants detail preserved deeper, not deleted |
| `cap_multiplier` + `cap_basis` formula (see §1.1) | `−688` lines of deletion; this branch removes more than it adds |
| `revenue_basis` wording: *"eligible online revenue processed through the connected payment rails used by the website"* | |
| `program_fit_review_required`, `approval_required`, `agreement_required` gates | |
| The `plain` disclosure paragraph — the clearest existing not-ownership language | |
| `js/crm.js` mode-carrying additions (+65) | |

The `plain` field is the single most valuable piece of approved copy on any
branch. It is the only text in the repository that states the not-ownership
position in full, and it should survive into the redesign close to verbatim.

### 2.2 `codex/here-revenue-share-offer` — 4 files, +367 / −2

Only **two deletions** across the whole branch. It layers a new offer system
beside the existing page shell rather than rewriting it — exactly the
non-destructive pattern the brief asks for.

| Recover | Reject |
| --- | --- |
| `css/sites-offers.css` (+95) — page-specific, no global CSS touched | Its `pricing_modes` vocabulary — `codex/sites-revenue-share`'s `deal_modes` naming is the approved one |
| `js/sites-offers.js` (+197) — self-contained offer controller | Duplicate revenue-share fields that conflict with `deal_modes` |
| Per-plan `revenue_share` blocks with `available: false` on Hosting | |
| The `$437.50` equity price for the combined plan (see §1.2) | |
| Its architecture as the integration pattern for the whole sales lane | |

**Architecture decision:** these two branches implement the same feature twice.
Per the brief, they are not both merged. The resolution is
`here-revenue-share-offer`'s **structure** carrying `sites-revenue-share`'s
**content and business language**.

### 2.3 `claude/redesign-wip` — 18 files, +3,025 / −765

One unique commit, 66 behind. Contains a global CSS rewrite that the brief
explicitly forbids importing. Held for visual inspection only — typography,
spacing, page composition, Equity Uprise presentation. Nothing extracted yet;
inspection belongs to the design stage, and no code from it enters the
integration branch.

### 2.4 Branches with nothing to recover

`claude/sites-demo-slot` and `claude/gallery-prints-selector-8qe16l` both carry
**zero unique commits** against main. Their work is already in main. Confirmed,
not assumed — verified by `git rev-list --left-right --count`.

### 2.5 Correction: `claude/product-integration-4o3p2j` has no merge base

The prior audit describes this branch as "216 commits behind" with one unique
commit. `git rev-list origin/main...origin/claude/product-integration-4o3p2j`
returns **`fatal: no merge base`** — the branch shares no history with main at
all. `git diff` against main is therefore meaningless, and any cherry-pick will
fail.

Its product records must be read as **data** and transplanted by hand into a
fresh file. There is no git operation that safely moves them.

---

## 3. Price conflict register

Every price found, and whether it can be built against.

| Item | Value(s) found | Source | Status |
| --- | --- | --- | --- |
| Runway domain | `$30` | Brief only | **NOT IN REPO — approval required** |
| Runway first month hosting | `$30` | Brief only | **NOT IN REPO — approval required** |
| Runway starting checkout | `$60` | Brief only | **NOT IN REPO — approval required** |
| Continuing hosting | `$30/mo` vs `$87/mo` | Brief vs main | **CONFLICT — approval required** |
| Domain renewal | "approved annual schedule" | Referenced, never defined | **MISSING — approval required** |
| Anti-Social M Mode | `$309` vs `$875` | Both in main | **CONFLICT — approval required** |
| Anti-Social Equity | `$154.50` vs `$437.50` | Both branches | **CONFLICT — follows the above** |
| Equity share percent | `50%` | Both branches agree | Consistent |
| Equity term | `12 months` | Both branches agree | Consistent |
| Equity cap | `10 × 12-month value` | `sites-revenue-share` | Formula, not constant (§1.1) |
| Build floor / ceiling | `$4,950` – `$15,000` | All branches agree | Consistent |
| Who Did the Shoot — Equity | none | — | **NO FORMULA EXISTS** |
| Write a Song — Equity | none | — | **NO FORMULA EXISTS** |
| Publishing / master splits | none | — | **NO TERMS EXIST** |
| hire.html rate card | `$585`, `$875`, `$2,210`, `$1,600`, `$990`, `$750`, `$7,035`, `$699`, `$87`, `$12.60` | `hire.html` | Unstructured; lives in markup, not the ledger |

The final row is its own problem: `hire.html` carries ten prices hardcoded in
markup with no ledger backing. The brief requires a single authoritative offer
ledger. Those figures must be migrated into it, and each one mapped to a core
offer, before `hire.html` can be rebuilt.

---

## 4. Unresolved business decisions

Blocking. No interface will present any of these as fact until McCluster rules.

1. Runway hosting: is it `$30/mo`, and does it replace or coexist with `$87/mo`?
2. What is the domain renewal schedule and amount?
3. Anti-Social combined price: `$309`, `$875`, or a new figure?
4. Does the Equity cap stay `10 × 12-month value`, or become a fixed dollar amount?
5. Is there an Equity formula for Who Did the Shoot? If so, what?
6. Is there an Equity formula for Write a Song? If so, what?
7. Publishing, master ownership and songwriting splits for Write a Song Equity.
8. Definition of "eligible connected online revenue" — gross vs net, processor
   fees, taxes, refunds, chargebacks, offline sales, attribution window.
9. Reporting cadence, dispute process, audit rights, termination, data export.
10. Runway edit and support allowance — the brief says use the approved one; no
    approved allowance was found in the repository.

Items 8 and 9 are agreement terms. Per the brief they are labelled as such in the
interface and never given invented definitions.

---

## 5. What happens next

Design stage, not yet started. It is gated on Mobbin, which is currently
disconnected from this session and needs re-authorization before the required
reference research can be done.

Implementation is additionally gated on decisions 1–4 above, because Runway is
the most prominent element in the redesign and its price is the one number in the
brief with no support in the codebase.

The offer ledger will be built to hold every unresolved value as
`pending_approval` with a visible flag, so the structure can be built and tested
before the numbers are final — but nothing marked `pending_approval` will render
as a real price to a visitor.

---
---

# Phase 1 — decisions applied, and what was harvested

**Stage:** implementation complete on `claude/sales-redesign-integration`.
**Supersedes:** sections 4 and 5 above. Everything before this line is the
Phase 0 inventory and is left intact as the record of how the figures were
traced.

## 1.1 Every Phase 0 finding was confirmed by the approvals

The three headline findings held:

- **The cap is a formula, not a constant.** Approved as `cap_basis:
  normal_12_month_service_value`, `cap_multiplier: 10`. It now resolves to
  `10 × 12 × $875 = $105,000` and is computed in `js/offers.js`, never stored.
  `t-formula.mjs` proves it: change the standard price to $1,000 in the ledger
  and the cap becomes $120,000 with no code edit. There is no literal `105000`
  or `437.5` anywhere in `data/offers.json`.
- **The merged service is the $875 plan, not $309.** Approved at `$875`.
  Equity is `$875 ÷ 2 = $437.50`, derived. `$309` priced website management
  alone and is now grandfathered.
- **`hire.html` held the real production and campaign rates as hand-written
  markup.** They were lifted into the ledger as `rate_lines` and are now the
  approved M Mode pricing for Who Did the Shoot and Write a Song.

## 1.2 The ten unresolved decisions, resolved or carried

| # | Phase 0 question | Status |
|---|---|---|
| 1 | Runway hosting $30 vs $87 | **Resolved.** $30/mo. Runway replaces $87 for new customers; $87 is grandfathered in `legacy_plans`. |
| 2 | Domain renewal | **Resolved.** $30/year. |
| 3 | Anti-Social price | **Resolved.** $875/mo. |
| 4 | Cap: formula or constant | **Resolved.** Stays the formula. |
| 5 | Who Did the Shoot Equity formula | **Carried.** No formula. Renders "Equity terms structured during discovery." |
| 6 | Write a Song Equity formula | **Carried.** As above. |
| 7 | Publishing / master / songwriting splits | **Carried.** Agreement layer. |
| 8 | Definition of eligible revenue | **Carried.** Agreement layer, publicly described as set in discovery. |
| 9 | Reporting, disputes, audit, termination, export | **Carried.** Agreement layer. |
| 10 | Runway edit and support allowance | **Carried.** Still no approved allowance in the repository; Runway lists what it includes and excludes ongoing management, so nothing is promised. |

Items 5–10 are business decisions, not blockers. Nothing invents a number, and
nothing exposes that a decision is outstanding.

## 1.3 Branch harvest — what was taken, what was left

Rule applied throughout: **eat the fish, spit out the bones.**

| Branch | Taken | Left |
|---|---|---|
| `codex/here-revenue-share-offer` | The non-destructive structure: a separate ledger file plus page-scoped CSS and JS that add capability without touching global tokens. `css/offers.css`, `css/onboard.css` and the new JS follow it — delete them and the rest of the site is unchanged. Also the half-price Equity relationship. | Its page markup. |
| `codex/sites-revenue-share` | The business language and the formula logic: `cap_multiplier`, `cap_basis: normal 12-month service value`, the two deal modes, the not-ownership disclosure, the domain-paid-separately rule. This is the spine of `data/offers.json`. | Its rendering. |
| `claude/product-integration-4o3p2j` | Nothing merged — its history is unrelated to this line. Records were read and transplanted by hand where useful. | The branch itself; no merge was performed. |
| `claude/redesign-wip` | Isolated visual ideas only: the full-bleed lead treatment and the subordinate-rung rhythm. | **Its global CSS rewrite, entirely.** `css/style.css` is untouched by this branch. |
| Platform / ISP / distributed-building / Uprise World branches | Nothing. Deliberately out of scope. | All of it. |

Neither revenue-share implementation was merged wholesale. Deployment
protections are untouched: no workflow, no `CNAME`, no `.nojekyll`, no
`sw.js` change is in this branch.

## 1.4 What changed on the pages

- **`data/offers.json`** — the ledger, now approved, with `formulas`,
  `legacy_plans`, `adjuncts` and `crm.configurations`.
- **`js/offers.js`** — shared engine (`window.MCC_OFFERS`): loads, derives,
  and paints the ladder. The pending-approval chip and every internal
  explanation were removed from the render path.
- **`js/offer-crm.js`** *(new)* — the migrated submission path. See
  `CRM-MIGRATION.md`.
- **`js/onboard.js` + `css/onboard.css`** *(new)* — the progressive brief.
- **`js/hire-offers.js`** — four chapters and the Equity calculator.
- **`hire.html`** — the rate card became the four-offer front door; the
  legacy plan schema in its JSON-LD was replaced.
- **`sites.html`** — the three-lane selector removed; meta and schema updated.
- **`js/shop.js`** — two small changes so the package tray survives rate lines
  that are rendered asynchronously and per mode.
- **`supabase/migrations/0009_offer_configurations.sql`** *(new)* — additive,
  nullable, feature-detected.

## 1.5 Open business decisions created by this stage

1. **The Limited Offer ($2,800/mo × 12, three clients ever)** overlaps
   Anti-Social and Who Did the Shoot. It was preserved at its published price
   as a subordinate adjunct rather than silently withdrawn, but whether it
   continues as a separate product or becomes a defined tier of Anti-Social is
   McCluster's call.
2. **The Teardown ($585)** is kept as the entry product. It sits before the
   four chapters and is not one of the four.
3. **The founding-seat free build** still advertises a free custom build with
   any lane on `sites.html`. Runway now starts at $60, so "free build with any
   lane" and "basic website build included in Runway" need to be reconciled in
   copy — they are not contradictory, but they are not yet stated as one thing.
4. **Runway's edit and support allowance** (Phase 0 item 10) is still unset.
5. **`data/sites.json` `lump_year` pricing** (33% off annual) has no equivalent
   in the new ladder. It survives only as legacy record.
