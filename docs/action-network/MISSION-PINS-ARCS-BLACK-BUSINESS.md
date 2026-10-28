# Missions: many pins, an origin, the policy arc, Black business on the map

Owner mission curation, 2026-10-15 (the curation itself is live, `control_audit` id 58;
three starter missions were added later by owner direction, `control_audit` id 59).
This change is **pending**: SQL in
`supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql`, client code
that stays silent until it is applied, and a public-comment adapter behind a flag that is off.

Evidence labels: **VERIFIED** (read in production or run here), **INFERRED**, **PROPOSED**.

## What production looks like today (VERIFIED, 2026-10-15/16, SELECT only)

| Fact | State |
| --- | --- |
| `action_globe_mission_regions` primary key | `(mission_id)`: one pin per mission |
| `action_globe_regions` | 3 rows (US-CT, US-GA, CD-HK); no country level |
| `action_globe_region_boundaries` | 0 rows |
| `join_action_mission()` | refuses any mission with ANY region row unless the member has a consented, unlocked region there |
| `action_globe_member_regions` | 0 rows |
| Consequence | **every pinned open mission (6 of 9) cannot be joined by anyone**, through every join path (`_attributed`, `_live`, `_origin` all call the canonical join). The three new starter missions have no pin, so they can. |
| "Connecticut cohort" | no cohort by that name. `action_cohorts` has "Equity Uprise · policy writers, next cohort" (campaign `equity-uprise-003`) and the homelessness field team. PR #440 adds state cohorts (`region_key`). |
| "Spend with intention" (`d7fc0ca4-…`) | open, no campaign, no assignments |
| "Spend $20 at a Black-owned business, then put them on" (`ba66d4a3-…`) | draft, End Racism campaign, no assignments |
| "Co-write a policy reform paper" (`df26314d-…`) | draft |
| Business-type profile model | `network_organizations` (`organization_type` includes `for_profit`, `verification_state`) + `network_organization_members` (role `owner`) |
| Other session's migration `20261016020407_action_partner_opportunity_drafts_v1` | creates `action_funding_opportunities` and `action_partner_mission_drafts`: no overlap with this file |

## 1. Many pins per mission

- Key becomes `(mission_id, region_key)`. Each pin has `pin_role` (`pin`, `origin`, `context`),
  `sort_order`, and `join_scope`.
- **`join_scope` defaults to `anywhere`**: a pin shows where a mission is, it does not decide who
  may join. Only `region_members` restricts. This lifts the lock-out above for all existing pins.
  *Owner: confirm that no existing pin was meant to be regional.*
- Country regions: ISO 3166-1 alpha-2 as `region_key` (`US`, `DE`, …), alpha-3, Natural Earth
  continent, label point (Natural Earth `LABEL_Y`/`LABEL_X`, inside the country), and a boundary
  **reference**: Natural Earth Admin 0 – Countries 1:50m, **v5.1.2**, public domain, feature id
  `ADM0_A3`. No geometry is loaded; drawing outlines and flags is the World PR's job (#442).
- Country sets are data: `action_globe_country_lists`. The first, `wb_high_income_fy27_pop1m`:
  - every economy the **World Bank classifies high income for FY27** (July 1 2026 – June 30 2027;
    2025 GNI per capita, Atlas method, above US$14,375), from `CLASS.xlsx`
    (<https://datahelpdesk.worldbank.org/knowledgebase/articles/906519>, downloaded 2026-10-15:
    87 high-income economies);
  - with **population ≥ 1,000,000** (World Bank WDI `SP.POP.TOTL`, 2024, API read 2026-10-15) → **50**.
  - Owner decisions: **Taiwan** is high income but WDI has no population for it, so the rule
    leaves it out; **Russia** is high income and is in. Edit the rows to change either.
- Pins placed: *Trace the minerals in your phone* and *Recycle one dead device the right way* on all
  50; their existing Haut-Katanga pin stays as `context` (where the cobalt comes from).
  The owner said "consumer countries (US + first world)", so both use the same list.
  *Owner: if "major consumer-electronics countries" should also include China, India, Brazil,
  make a second list (the Global E-waste Monitor 2024 ranks generators by total and per capita).*
- Public RPC `action_globe_public_region_missions()` already returned one row per pin; it now also
  returns `region_level, country_code, continent, pin_role, origin_label`, ordered origin first.
  `js/action-globe.js` groups rows by mission (`groupPins`): the feed, search and deck list each
  mission once ("50 countries"), the Earth draws every pin, continent counts count a mission once
  per continent, rows without a point are dropped (never 0,0).

## 2. Origin: "Started by the Connecticut cohort"

`action_mission_origins` (label, region, optional cohort, optional campaign). **Display only:
joining never reads it.** Trace the minerals gets the label, an `origin` pin at US-CT, and no cohort
id, because no Connecticut cohort row exists yet. *Owner: when PR #440's Connecticut cohort exists,
set `origin_cohort_id`.*

## 3. Policy arc

`action_mission_arcs(arc_key, parent, child, step, unlock_rule='parent_verified')`.
First arc `policy-reform`: **Write a policy memo → Co-write a policy reform paper (step 2)**.
`join_action_mission()` refuses a child until that member's parent assignment is `verified`
(set only by an admin's review). The paper **stays draft**; publishing it is the owner's call.
The memo card says "Next in this arc: Co-write a policy reform paper".

The owner's own path, memo → Urban Leadership Fellowship, is context for this design only. It is
not product copy and the UI makes no claim about it.

## 4. Buy from a Black business / Put your Black business on the map

- `d7fc0ca4-…` keeps its id and becomes **"Buy from a Black business"**. Previous description, for
  rollback: "Support a locally owned business or creator from a historically underrepresented
  community. Post proof of support and a short note about what you learned. Do not photograph
  people without permission."
- **Proposal: retire** the draft "Spend $20 at a Black-owned business, then put them on"
  (`ba66d4a3-…`, no assignments) to `closed`. Its directory links now show on the new mission;
  its "put them on" idea becomes the listing CTA.
- The card CTA **"Put your Black business on the map"** opens a listing form in the mission dialog.
  The listing is its own review, separate from the mission's proof:
  - evidence: business name, town/state, country, public link; optional street address only for an
    exact pin; attestation that it is Black-owned and the submitter may list it; consent to show it
    (`consent_version` `2026-10-15`);
  - `submit_action_business_listing()` only ever files `submitted` (max three waiting per member);
  - `review_action_business_listing()` is admin-only (`eu_is_admin`), needs a note to reject or ask
    for more, audits to `control_audit`, refuses 0,0;
  - approval creates the business profile in the existing model (`network_organizations`
    `for_profit`, `verified`, submitter as `owner`), once;
  - the pin is placed by the reviewer: **coarse (rounded to 0.1°, about 11 km)** unless the business
    opted into its exact address; `action_globe_public_business_pins()` shows only approved,
    consented, placed listings, and the street only for an exact pin; withdrawal takes it off at once.
  - Listing a business does not complete the mission, and is not paid.
- Not built: an admin queue UI for listings (the desk calls the RPC); geocoding.

## 5. File a public comment

See `PUBLIC-COMMENT-ADAPTER.md`.

## 6. Ladder note (owner decision)

At the time of the brief, "Help someone reach a real service" (mapped as a starter in PR #440) was
closed and no song or rally mission existed. Since then the owner created **"Help a person"**,
**"Write a song"** and **"Show up to a rally"** (open, `control_audit` id 59), and the fellowship
rule became any three verified missions (PR #440). This PR creates no missions. *Owner: confirm
which of the three are the ladder's starter kinds in `action_ladder_starter_kinds` and whether they
should carry pins (today they have none, so anyone can join them).*

## Hazards found

- `supabase/pending/20261014170000_action_mission_curated_catalog_resources.sql` would **close**
  File a public comment, Spend with intention and Trace the minerals, which the owner reopened.
  Do not apply it as written.
- `action_globe_demo_pins_v1.sql` (now `supabase/tests/action_globe_demo_pins_v1.applied.sql`) is already applied (rows dated 2026-10-15 17:55Z)
  and uses `ON CONFLICT (mission_id)`; it stays before this file in the scratch harness and is never re-run in production.

## Apply checklist (owner approval required)

1. Owner confirms: display-only default for existing pins; the 50-country list (Taiwan, Russia);
   retiring `ba66d4a3`; listing consent text.
2. Promote `action_globe_demo_pins_v1.sql` (already applied) per `supabase/pending/README.md`.
3. `apply_migration` `action_mission_pins_arcs_black_business` with the pending file.
4. Read back: `select mission_id, count(*) from action_globe_public_region_missions() group by 1`
   → Trace 52, Recycle 51; `select * from action_mission_card_extras()`.
5. A test member joins Trace the minerals (proves the lock-out is gone).
6. Promote the file to `supabase/migrations/` with its version.
7. Rollback: the header of the pending file. The previous `action_globe_public_region_missions()`
   is the definition in `supabase/migrations/20261014013557_action_globe_regions.sql` plus the
   `song_title` column (left join `action_globe_song_missions`), as read from production.

## Tests

`scripts/test-mission-pins-db.sh` (scratch Postgres 16: the real migrations, the demo pins, this
file twice, then `supabase/tests/action_mission_pins_arcs_business.behaviour.sql` and the existing
join-authorization audit); `scripts/test/mission-pins-arcs-business.test.mjs`;
`workers/mccluster/test/public-comment.test.mjs`.
