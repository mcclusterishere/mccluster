# Halo case: the Fukushima-oki earthquake and Renesas, March 2022

Written 2026-11-24 UTC. One end-to-end case, built to prove a path, not to make a finding about Renesas.

- The record: `core/data/halo/cases/fukushima-oki-2022-renesas.json` (schema `halo-case/v1`)
- The replay: `js/halo/case-replay.js` (pure; `HaloCase.asOf(case, cutoff)`)
- The proof: `node --test scripts/test/halo-case-replay.test.mjs`

## What is verified, and how

Every source below was opened in a browser in the authoring session on 2026-11-24 UTC and the bytes as served were
hashed (SHA-256, in the case file). "Verified" here means: this page, at this address, said this when it was read.

| Source | What it supports | Verified |
|---|---|---|
| JMA press release, first report, dated 17 March 2022 | M7.3 preliminary, depth 60 km; maximum intensity 6-upper in five municipalities of Miyagi and Fukushima | Read and hashed |
| JMA press release, second report, dated 24 March 2022 | Revised to M7.4, 57 km | **Not re-read.** From a delegated research pass's fetch summary; no hash |
| Renesas notices printed March 17, 18, 23 and 26, 2022 | Halt, partial restart, forecasts, a missed forecast, operator-confirmed recovery, loss in days or weeks of production | Read and hashed, all four. Key facts re-checked against the page text |
| USGS event `us6000h519` detail | Current solution; the list of seven ShakeMap versions with their update times | Read and hashed |
| JMA seismic intensity database, event `20220316233632` | Station intensities in Hitachinaka, Takasaki and Yonezawa | Read and hashed (the database's own answer) |
| Renesas "Global Operations" page | The three plants' published addresses | Read and hashed. It is the 2026 listing |

Not verified: any ShakeMap geometry (no grid file was downloaded); which ShakeMap version USGS prefers; the Japanese
notices against the English ones; anything about March 2022 from a source read only as it stands in 2026.

## The timeline as the replay shows it

All times UTC. Renesas and JMA print a date only, so each enters at the end of that day in Japan (15:00:00Z).

| Cutoff | Evidence usable | Naka | Takasaki | Yonezawa |
|---|---|---|---|---|
| 16 Mar 15:06 | ShakeMap v1 (map-wide maximum only) | unknown | unknown | unknown |
| 17 Mar 06:00 | + ShakeMap v2 | unknown | unknown | unknown |
| 17 Mar 15:00 | + JMA first report, Renesas notice 1 | halted | halted | partial (some test lines) |
| 18 Mar 15:00 | + Renesas notice 2 | partial; forecast full on 23 Mar | partial; forecast full on 23 Mar | partial; forecast full on 20 Mar |
| 21 Mar 12:00 | the same | partial | partial | partial (the forecast date has passed; no source has confirmed it) |
| 23 Mar 15:00 | + Renesas notice 3 | partial, about 50%; 23 Mar forecast **missed**; new forecast 26 Mar | recovered (operator) | recovered (operator) |
| 26 Mar 15:00 | + Renesas notice 4 | recovered (operator) | recovered | recovered |
| 16 May 10:41 | + ShakeMap v7 | the May revision appears only now | | |
| 24 Nov 2026 | + the catalogue values and the addresses | city-station intensities and addresses appear only now | | |

Renesas's page metadata puts the first notice at 11:46 on 17 March in Japan (02:46Z). The notice prints only a date, so
the replay holds it until 15:00Z. That costs up to a day of earliness and guarantees the replay never knows something
before the source can be shown to have said it.

## The separations the case keeps

| Class | In this case | Never becomes |
|---|---|---|
| Known site location | The operator's published address (2026 listing). No coordinates, no geocoding | A point on the map, until coordinates are verified |
| Observed shaking | JMA: five municipalities at 6-upper (first report); public stations in the three plant cities at 3 to 5-lower (catalogue) | Shaking at a factory. A station in the city is not the plant's instrument |
| Modeled shaking | Seven USGS ShakeMap versions, map-wide maximum only | A value at a site. No geometry was verified |
| Confirmed halt | Renesas notice 1 | |
| Partial restart | Notices 1, 2, 3 | Recovery |
| Forecast | Notice 2 (three), notice 3 (one) | A state. A forecast date passing changes nothing; one forecast was missed |
| Recovery | Notices 3 and 4, the operator's own statement, on a wafer-input basis | Independently verified recovery, or shipped output |

Not claimed anywhere: facility shaking from a nearby station; a supplier or customer relationship; any effect on
revenue, a share price, an index or GDP. The four notices state no financial effect. `scripts/test` fails if the case
file is edited to attach a regional or modeled value to a site.

## How this maps onto the canonical path

Nothing was written to any store. This is the mapping an owner-approved ingest would follow
(`INTEL-TO-MISSION-CANON.md`; tables from `20260919055029_universal_ingestion_entity_resolution_v1.sql` and
`20261017030617_intel_mission_canon_v1.sql`).

| Case field | Canonical home today | Gap |
|---|---|---|
| `source`, `source_record_id`, `revision` | `ops_ingest_records.idempotency_key` as `source:record:revision` (the USGS connector already uses `usgs:<id>:<updated>`) | None; revision is folded into the key |
| `content_sha256` | `ops_ingest_records.content_hash`, `intel_evidence.content_sha256` | None |
| `observed_at` | `ops_ingest_records.observed_at` (required), `intel_evidence.observed_at` (optional) | The collector commit defaults a missing `observed_at` to now(). A notice with no event time must not get one |
| `published_at` with its precision | **No column.** | The canon has no published time. Needed before a replay can run from the store: a `published_at` plus `published_precision`, or the computed `available_at` |
| `ingested_at` | `ops_ingest_records.ingested_at` (default now()) | None |
| `retrieved_at` | `intel_evidence.retrieved_at` (required) | None |
| statements with a class | `intel_claims` + `intel_claim_evidence` (supports / contradicts / context) | A claim has no class today (halt, forecast, …). Either a `kind` on the claim or a typed ontology link |
| sites | `ops_ontology_objects` (facility), with `valid_from` / `valid_to` | Coordinates only when a source publishes them |
| the proposal | `ai_context.decisions` (status `proposed`) with `intel_decision_basis` rows naming the evidence | None. Approval is written only by `context-decision` with the house owner's own bearer |
| the replay | **Nothing.** | No as-of read exists. The only bitemporal function (`seek_first_as_of`) was never applied. `HaloCase.asOf` is the reference behaviour for one |

**The owner connection graph (#574, `ops_connected_graph_service`, `GET /v1/intel/connections`)** is reused as it is, not
extended: once the case is ingested, its evidence, claims, the facility objects and the decision are nodes, and the
edges come only from foreign keys and typed ontology links ("no inference creates an edge"). A facility-to-customer
edge would need a typed link with evidence behind it; this case creates none. The graph renders in Control → Analytics →
World intelligence today, not in Halo.

Why the case is not in Halo's UI yet: the file carries a proposed owner decision, and `data/` is published by the Pages
deploy. It is kept under `core/`, which is stripped, and should reach Halo through the owner-gated store after an
approved ingest, not as a public static file. Halo's own Replay control is still the disabled stub it was
(`js/halo/halo.js`, "Replay is not available yet").

## Proposed owner decision

**Status: proposed. Not approved.** No authorized event exists. `HaloCase.decisionStatus` reports `approved` only when
the case names a decision recorded in `ai_context.decisions` by the house owner, with its id, actor and time.

**Question.** When an earthquake is reported near a tracked facility, what may Halo say about the facility, and when?

| Option | What Halo does | In this case |
|---|---|---|
| **A. Stage by operator confirmation (recommended)** | Opens a case on the agency bulletin. Shows regional shaking as regional. Says "status unknown" per facility until the operator or a regulator publishes. Moves a facility to halted, partial or recovered only on such a statement; keeps forecasts apart; records a missed forecast as missed | Three unknown sites for about a day, then the first notice. Every later state had a source |
| B. Infer exposure from shaking | States a likely facility impact from modeled or nearby observed shaking before the operator speaks | About a day faster. A claim no source supported; city stations read 3 to 5-lower while reported losses ran from about 2 days to about 3 weeks, so it would not have told the three sites apart |
| C. No facility cases from earthquakes | Earthquakes stay a map layer | Nothing claimed; the owner hears of a halt from the news |

**Uncertainty.** One event and one operator who published quickly and in detail; many do not. The end-of-day rule can
understate how early a notice was known by up to a day.

**What would change the recommendation.**
- A verified facility-level instrument reading, or a regulator's inspection report, available on the event day.
- Two or three more cases in which operator notices came late or never: that argues for an explicit "no operator
  statement after N hours" state instead of plain unknown.
- A verified early ShakeMap geometry joined in code to verified site coordinates: modeled intensity at the site could
  then be shown, labelled as modeled.

## Unknowns

When front-end wafer processing restarted at Naka and Takasaki; the JMA first report's release time; whether event-day
intensities for the three cities differed from the catalogue; which station is nearest each plant; every ShakeMap
geometry; the plants' addresses as published in March 2022; whether lost production was recovered and any financial
effect; the Japanese notices and any exchange filing times.
