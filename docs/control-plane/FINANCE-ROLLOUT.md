# Halo Finance coordinated rollout

This supersedes the pre-implementation status in FINANCE-LIVE-DATA-SETUP.md and
FINANCE-HALO-ACCEPTANCE.md. Finance was integrated through #754. This follow-through
adds read-only indicative paper portfolio valuation and automated globe/database
acceptance. It does not claim configured live data or a completed production rollout.

## Delivery and limits

The existing globe → Finance → search/history → paper order → saved portfolio path
is preserved. Refresh portfolio value calls the owner-only `/v1/intel/finance/valuation`
route. It reads the saved account and marks up to 30 holdings with at most four
concurrent quote requests, using the existing account-wide quota and cache. Marks
show source timestamps and IEX bid basis. Missing, stale, closed-session, mismatched
instrument or earlier-session holdings suppress the total. A slow batch rechecks
freshness before returning. Valuation never appends to the ledger or calls brokerage
order endpoints. Browser mutations, reload and revoked access clear prior valuation.

This remains a whole-share, long-only, USD simulation. Cross-session positions are
frozen because dividend/split processing is not implemented. The new valuation does
not remove that guard or infer adjustments. It is a timestamped snapshot, not a
continuous portfolio feed, executable price, recommendation or performance backtest.

## Serial coordinator procedure

Only the designated release coordinator performs main merges, production schema
changes, credential installation and deployment. Preserve all unrelated release
configuration. Do not copy the local fixture identity or provider responses to a
hosted environment.

1. Record the final integrated commit and green required CI. Review the existing
   `docs/control-plane/sql/finance-market-draft.sql` candidate. Its source SHA-256 is
   `a787be95f42fa1fb4308d071bcc60c8e18949def2a3593558468a95f0f44d24d`.
   Reconcile migration history and existing objects before applying it once through
   the canonical migration process. Do not rerun its CREATE statements on an
   already provisioned schema. No DROP/reset migration is needed.
2. Verify canonical `orgs(id,slug,enabled)` and
   `org_members(org_id,profile_id,role)` dependencies. Install only the market schema
   for real-security paper accounts. The synthetic developer harness's
   `finance-paper-draft.sql` is not required for that product path.
3. After schema application, verify both tables have RLS enabled; anon and
   authenticated have no table or RPC privileges; service_role can invoke
   `finance_account_read(uuid)`, `finance_account_append(uuid,integer,jsonb)` and
   `finance_quote_budget(text)`. Read calls must reject non-owner identities and
   disabled organizations. Test writes in an isolated fixture, not a real owner's
   audit ledger. Do not delete production paper history as a smoke-test cleanup.
4. Keep all Finance gates disabled while installing the approved Paper Only key
   pair as Worker secrets `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`. Never put
   values in Git, frontend config, logs, reports or chat. Confirm account permission
   for IEX assets/clock/quotes/history using the owner's authorized source; no
   funding, paid upgrade, account signup or brokerage order is part of this release.
5. Enable `FINANCE_DEV_ENABLED=true` and `FINANCE_PERSISTENCE_ENABLED=true` only
   after storage validation. A useful first stage can expose owner-only empty paper
   storage and explicit unavailable prices while `FINANCE_ALPACA_ENABLED` remains
   false. Enable that last gate only after the key pair and permitted access are
   confirmed. Existing `SUPABASE_URL` and service-role binding remain server-only.
   Existing global Markets/Finnhub/EODHD configuration is independent; do not
   silently switch those sources or label their data as IEX.
6. Deploy the coordinator's integrated Worker and static assets. Verify anonymous
   and ordinary-member denial, owner control/storage status, real asset search,
   timestamps and venue labels, and history availability. During a confirmed open
   regular session, let the owner explicitly submit a paper order and verify reload
   and valuation. Off-hours acceptance must show orders unavailable; never fabricate
   an open market or quote. Check the shared globe remains mounted at 390/1280px.
7. Disable `FINANCE_ALPACA_ENABLED` to stop source requests; disable persistence or
   the development gate for wider rollback. Keep schema/history intact. Code-only
   rollback must not remove unrelated Worker exports or reset production data.

## Executable evidence

`Halo Finance integration proof` runs on relevant PR changes. It installs pinned
Playwright/Cesium and PostgreSQL image dependencies, runs Finance failure tests,
then executes `scripts/e2e/finance-ci.mjs`. That runner owns a network-isolated
PostgreSQL fixture and tests the actual Cesium globe on mobile/desktop with all
external browser requests intercepted. It checks storage permissions/quota,
paper order persistence, reload, valuation, access-revocation clearing and overflow.
Fixture proof is not live-provider or production-auth proof.

Local equivalent (use an already installed PostgreSQL 17.6 image):

```sh
PLAYWRIGHT_DIR=/path/to/node_modules CESIUM_DIR=/path/to/cesium/Build/Cesium CHROMIUM_EXECUTABLE=/path/to/chromium node scripts/e2e/finance-ci.mjs
node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/finance-*.test.mjs
```

## Original mission still beyond this slice

Global exchange entitlements and broad historical coverage; evidence-linked
ownership/boards/resources/supply exposure; permitted direct disclosure collection;
point-in-time news-to-company mapping; continuous updates and robust corporate
actions; walk-forward research and paper performance comparisons; and a separately
licensed member Finance offer remain unfinished. Existing country news and exchange
pins are context, not proof of company exposure. No claim of global real-time data,
predictive accuracy or customer redistribution rights follows from this rollout.
