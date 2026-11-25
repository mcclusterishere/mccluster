# E=Up Civic League, Companies & Finance and Sources & Review: private intake

Date: 2026-11-09. Admin-only. Source under `workers/mccluster/src/eup/` behind `/v1/eup` (house-owner check in `router.js`); schema `supabase/pending/eup_intake_v1.sql` (unapplied; rollback beside it). This is synthetic-fixture-tested source, not a connected collector, not populated data and not a release.

## Why a separate private store

The applied civic schema (`20261014021057_civic_global_discovery`) grants anon/authenticated SELECT on verified civic rows, and `action_policy_bills` has a public `using(true)` read policy. An admin import written there would be public the moment it was marked verified. The E=Up intake therefore lives in `eup_*` tables in the same canonical database, service_role only, RLS on with no client policy, reached only through `eup_*` RPCs. Nothing publishes to a public projection; that is a later, separately authorised step with no code here.

## One registry, no duplicate gateway

`registry.js` mirrors the planning inventory (12 connectors plus congressional disclosures, all disabled) and reflects existing `civic_source_registry` rows by key instead of copying them. Definitions live in code; mutable state lives in `eup_source_registry_state`. The USAspending boundary stays the existing seek-first adapter. Market quotes, OpenFEC, LegiScan (secondary) and congressional financial disclosures are `held`: never fetched. Google Civic Representatives and ProPublica Congress are listed as retired, not dependencies.

Gate before any upstream request (`intake.assertFetchAllowed`, used by `adapters/index.js boundedUpstreamRead`): known source → not held (403 `rights_held`) → access approved (else 503 `not_configured`) → entitlement unexpired (403 `rights_expired`) → configured and credential bindings present by name (503 `not_configured`) → not paused (503 `source_paused`). Reads apply the same rights check to stored rows: a cached restricted record is withheld once its grant is held, unreviewed or expired (`withholdRestricted`).

## Data contracts

Every row carries provenance: `source_id, source_record_id, url, observed_at, effective_from, effective_to, upstream_updated_at, fetched_at, parser_version, raw_hash, rights_revision, review_state, coverage`. `eup_record_snapshots` is append-only (trigger); a duplicate import (same raw hash) is a no-op; a changed record is a new revision that supersedes the old; a changed bill text is a new `eup_civic_bill_versions` row; a restated company fact is a new fact marked `amended` that `supersedes` the old one.

Civic: jurisdictions (effective-dated boundary versions; `jurisdiction_relations` for overlapping districts; ZIP codes are not districts), offices with seats, persons, terms (`vacant` = no person), committees, bills (`enacted` only with a public act or "became law"), bill versions/actions/amendments/roll calls, election contests, candidacies (`registered` is not incumbency), results by stage (`preliminary`, `canvassed`, `certified`), `term_started` only when the term start date has passed.

Companies: entity, identifiers (`cik`, `lei`, `ticker` are hard keys; a record whose identifiers span two entities, or whose legal name disagrees with the identifier's owner, becomes an identity review item and is not merged), typed locations (`headquarters`, `registered_office`, `mailing_address`, `exchange`, `facility`, `place_of_performance`; only HQ/facility/performance geocodes pin; exchange never pins), facts with period/unit/currency/amendment, awards with agency/recipient/obligation/outlay/place of performance and a note that an award is not evidence an officeholder caused it. `quote` is always null.

## Routes (all owner-only, private/no-store)

- `GET /v1/eup/civic/jurisdictions?parent=none|<uuid>`, `boundaries?jurisdiction=`, `offices?jurisdiction=`, `terms?office=`, `bills?jurisdiction=&session=`, `bills/:id`, `elections?jurisdiction=`
- `GET /v1/eup/companies/search?q=`, `GET /v1/eup/companies/:id`
- `GET /v1/eup/sources`, `GET /v1/eup/sources/:id`, `POST /v1/eup/sources/:id/refresh {idempotency_key}` (bounded, idempotent per key; 503 until configured and approved), `POST .../pause`, `POST .../resume`, `GET /v1/eup/sources/review?status=open`, `POST /v1/eup/sources/review/:id/correct {expected_revision, idempotency_key, correction}` (CAS; same key replays, different payload 409)

An empty selection says "absence of coverage", a failed run leaves the last success and record count visible as `stale`, and an unknown count is `null`, never zero.

## Adapters (pure parsers, fixture-tested, no network)

SEC submissions/companyfacts, GLEIF LEI record, Congress.gov bill/actions/text versions, Census TIGER listing (vintage + FIPS; a listed file is not validated geometry), CT General Assembly bill record (wire format unverified: the bounded read timed out), Bridgeport council roster (synthetic names; contact details never copied; term dates unknown).

## Tests

`workers/mccluster/test/eup-adapters.test.mjs`, `eup-sources.test.mjs`, `eup-civic.test.mjs`, `eup-companies.test.mjs` (fake REST, offline) and `scripts/test/eup-intake.integration.mjs` with `scripts/test/support/eup-intake-database.mjs` (PGlite: SQL applied twice, client-role denial, duplicate import, amended bill, retry, outage, wrong geography, identity conflict, corrections, zero rows in the public civic/policy tables after import). Run with `PGLITE_MODULE=<pglite dist>/index.js node scripts/test/eup-intake.integration.mjs`.

## Not done

No live source read, key, account, entitlement, geocoder, scheduled job or production apply. Native multi-session concurrency not proven (PGlite is serial). The Connecticut/Bridgeport pilot is a proposal for owner review, not a chosen scope.
