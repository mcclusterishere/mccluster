# API recovery continuation — November 7, 2026

This continues the [October 5–November 4 inventory](API-RECOVERY-20261104.md),
not a new claim that all historical ideas shipped. Main inspected:
`1f3b3d26df29135887e38fd38a831e8ace7aaa6f`, then reconciled with
`55befc618eb24d21a37e6c4afd66c1bb47767237` after #766 merged. The original 254 branch names and
89 PR results are discovery evidence, not 254 implementation audits.

## Evidence boundary

- Re-read original inventory, current source, selected current PR metadata and
  release handoffs. Personal Context again returned unavailable. No new full
  conversation or satellite-code audit was possible in this pass.
- Supported Cloudflare metadata reads checked binding presence/selected flags,
  not secret values. The latest observed deployment was November 7 at 13:16 UTC;
  deployment metadata alone does not establish the source SHA or owner journey.
- Supported Supabase table metadata listed existing shared social, ingestion,
  site-content/history and learning tables. It did not list Finance, Arcade or
  front-page-draft tables. Table existence is not a grants/RPC/runtime test.
- A production SQL metadata query was denied by automatic approval review under
  this task's retained no-production-SQL restriction. It was not retried. Only
  the explicitly allowed metadata alternative was used; no database writes ran.
- Direct API/Core health requests from this environment returned HTTP 403. An
  isolated `weather-snapshot-cli --live` returned eight `fetch_failed` feeds.
  These are access-path failures here, not proof of provider outage or missing
  weather credentials. No owner production session was available to this task.
- The observed `gh-pages` head was `1cc3f38c32498275b226890814308ec7c4d65e5f`.
  This proves a published branch exists, not a freshly checked live user journey.

## Original scope, without duplicate ownership

No integration is labeled **working live** solely from source or a merged PR.
“Code-ready” below identifies the stated bounded code surface; release gates
remain explicit.

| Original integration | Current state | Evidence / exact remaining work |
| --- | --- | --- |
| Halo Finance | Actively repaired in its original task | [#747](https://github.com/mcclusterishere/mccluster/pull/747) is merged through #754. Current metadata shows no Alpaca credential pair, no enabled Alpaca flag and no Finance tables. Finance owner retains provider/quota/cache/schema work; do not add a parallel provider here. |
| BLS | Adapter and owner controls integrated; live acceptance separately owned | #746 is integrated. [#766](https://github.com/mcclusterishere/mccluster/pull/766) owns bounded owner snapshot controls/charts. Missing BLS key is not a blocker. The release executor owns #766 live acceptance after merge `55befc61`. No edits to those controls or their manual in this continuation. |
| Owner/self-service | Active owner repair plus blocked customer-stack integration | [#741](https://github.com/mcclusterishere/mccluster/pull/741) is the front-page owner task. [#681](https://github.com/mcclusterishere/mccluster/pull/681), head `5e020833`, remains open and currently non-mergeable. Its customer schema and current-main reconciliation are separate from the owner front page. Preserve the consolidated stack; do not merge ancestor branches independently. |
| Instagram cross-posting | Branch implementation; release blocked | [#624](https://github.com/mcclusterishere/mccluster/pull/624), head `c6dcb9a3`, is stacked on customer projects. Shared social tables exist, but this does not establish the pending customer OAuth/Vault contract. An operator secret exists; that is not proof of app ID, scopes, callback, tenant credential or Meta publishing permission. Reconcile the consolidated stack, then sandbox OAuth/queue recovery and explicit publication acceptance. |
| Connecticut weather | Code-ready snapshot pipeline; readiness actively repaired here | [#733](https://github.com/mcclusterishere/mccluster/pull/733) merged. Existing Core job, owner API/desk, provider decoders and default-off timer remain. This change adds a truthful `--check` CLI gate. Intended-host provider access, Core promotion, bzip2, timer/flag and fresh owner snapshot remain unverified. Full CT raster integration into the globe remains separate from existing NOAA alert markers. |
| Travel navigation/traffic | Existing UI/adapter; monthly-budget defect repaired here | Deployed metadata selects keyless FOSSGIS noncommercial pilot; dedicated `TRAVEL_TOMTOM_API_KEY` absent. No key is required for the current pilot. New TomTom monthly enforcement uses the existing quota object. [#617](https://github.com/mcclusterishere/mccluster/pull/617) remains separate UI work; no overlapping client edits here. [Connection guide](../travel/TRAVEL-PROVIDER-CONNECTION.md). |
| Open/research data | Existing adapter catalog is code-ready, individual live state unverified | Existing source registry and authenticated gateway remain canonical. FRED, Finnhub and EODHD bindings were absent in the inspected Worker; keyless sources must not be classified as key-blocked. Validate individual source responses/entitlements via the existing owner inspector. #766 supplies the BLS-specific UI. |
| City / Arcade | Integrated code, separate cloud activation gate | #736/#738/#743/#748 were integrated through release work; [#761](https://github.com/mcclusterishere/mccluster/pull/761) adds explicit default-off cloud behavior and local recovery. Observed cloud flag absent and Arcade tables not listed. Local gameplay is distinct from cloud persistence. The original Arcade task owns schema-first activation and runtime acceptance. |
| PRIM3 | Integrated baseline; subsequent generation work separate | [#739](https://github.com/mcclusterishere/mccluster/pull/739) merged. [#762](https://github.com/mcclusterishere/mccluster/pull/762) is the subsequent reviewed mission-generation work. Existing learning tables are listed, but the adaptive flag is absent. Do not infer owner practice activation from table presence. |
| Market observation ingest | Exact integration/policy blocker | [#600](https://github.com/mcclusterishere/mccluster/pull/600), head `e7b0fc26`, remains open/non-mergeable. Its preserved review identifies policy-erasing connector writes and a pending repair. Shared ingestion tables exist, but this task did not re-query production function bodies. Reconcile policy semantics and Finance ownership before source writes or timer activation. |
| Domains/storefront | Sandbox branch exists; live registration incomplete | [#637](https://github.com/mcclusterishere/mccluster/pull/637), head `f06fb545`, is stacked on #636 and consolidated into the older customer work. Its review explicitly lacks guaranteed-charge/registrant readback and supports sandbox only. Keys do not resolve those missing contracts. No registration, checkout or account changes here. |
| Whip rides/rentals | Existing bounded APIs; operational launch unverified | Canonical `workers/mccluster/src/whip/` and rental-booking metadata exist. Actual dispatch/provider service, driver consent, payment and satellite rollout were not verified. Preserve the original satellite handoff; do not label a route/booking record as operating dispatch. |
| Full-duplex voice | Exact code/runtime integration blocker | [#619](https://github.com/mcclusterishere/mccluster/pull/619), head `1e3f7b4c`, remains open/non-mergeable. Current main has no matching full-duplex route. Branch requires an inference gateway and browser codec integration; its historical Dessa availability statement has not been freshly verified. No free-key substitution or new GPU/service provisioning is claimed. |
| Event prospecting | Unfinished provider-to-CRM implementation | Current `core/src` and Worker search found no Eventbrite/Meetup adapter. Canonical CRM tables exist; generic research is not completed event ingestion. Next slice must specify permitted event sources, normalized source IDs, deduplication and owner draft review before implementing in existing CRM. No organizer contact, outreach or signup is authorized by this audit. |

## Implemented in this continuation

1. **Travel monthly capacity:** 20,000 TomTom attempts per UTC calendar month in
   the existing durable quota ledger; daily and single-flight guards retained.
   Counts persist through restart, provider changes and secret rotation. Both
   failed and successful attempts count. Quota errors use the existing UI/API
   response and `Retry-After`, with no silent provider fallback. Legacy earlier
   days and other account usage remain unknown; this is not a billing guarantee.
2. **Weather readiness:** explicit `--check` returns nonzero on any missing,
   stale or carried-forward feed. Help and invalid options no longer silently
   run a fixture snapshot. Live mode cannot combine a simulated clock/failure.
   Defaults retain diagnostic behavior; fixtures remain visibly labeled.
3. **Connection guidance:** Travel guide describes keyless use, dedicated secret
   binding, quotas, first-month uncertainty, validation and revoke/rollback.
   Local readiness now describes the application's routing budget without
   claiming deployed/provider verification.

## Dependency-ordered release handoff

1. Keep #766 and Finance in their current owning tasks. Review this continuation
   independently; it does not import their branch code or change their providers.
2. Merge only after exact-head checks and independent review. Main publication
   may deploy the canonical Worker; the quota change needs no new binding or
   production SQL. Verify deployment fingerprint and the existing Travel path.
   Keep the current keyless selector; no configuration activation is included.
3. The weather CLI change reaches production Core only through the normal Core
   promotion path. Run `--live --check` on that approved runtime, then separately
   verify timer/flag and owner snapshot. Do not enable scheduling just to make a
   readiness report green. Local eight-feed failure is not production evidence.
4. Finish owner #741 canonical schema proof and approved rollout. Reconcile the
   customer consolidation #681 next; Instagram/domain stacks depend on that
   contract, not on this routing repair. Resolve reviewed schema gates before UI
   activation. Keep account/provider actions explicit.
5. Reconcile #600 with Finance and fix/preserve source-policy authority before
   any observation timer. Voice needs a real runtime/codec workstream; event
   prospecting needs a permitted-source ingestion slice. Whip needs operational
   acceptance. These remain original scope, not silently dropped items.

No credentials, database mutations, persistent access, provider accounts, flags,
schedules, purchases or external communications were created by this continuation.
The release coordinator retains integration/rollout ownership. These repairs do
not declare the entire original inventory complete.

## Fresh validation for this continuation

- Full Worker suite: 1,432 passed, no skips/failures on the initial reviewed base.
- Travel/client/readiness suites: 61 passed; Core weather suite: 22 passed.
- Combined provider/DO/readiness/weather API suites: 61 passed (overlaps above;
  these are not additive counts).
- Source classification: 2,438/2,438. Canonical pinned Worker dry build passed,
  with no upload. Diff checks and high-confidence added-line secret scan passed.
- Tests use existing recorded fixtures and runtime doubles; no claim of live
  provider, actual owner session, physical GPS or production billing proof.
