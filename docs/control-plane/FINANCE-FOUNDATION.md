# Finance development foundation

## Latest: persistent owner slice (local verification only)

The owner Halo World panel now links to `finance-dev.html` as a separate product
entry. It does not change Travel/Missions release flags. Finance displays the
existing `data/markets/exchanges.json` reference with version, source descriptions
and a static/non-live label; no exchange prices are inferred from that reference.
Paper orders remain explicitly synthetic, separate from sourced reference data.

`GET/POST /v1/intel/finance/portfolio` uses canonical Supabase RPC functions via
the existing store, with owner identity derived only from server authentication.
POST accepts one command, never client balance/price/owner. Replay validates it
before an append-only, revision-checked write. Retries use stable command IDs;
conflicts require reload. Fills and balances are deterministic projections of the
saved synthetic-v1 commands. This is not full tax-lot/double-entry financial
accounting or a real market execution system.

The review draft `docs/control-plane/sql/finance-paper-draft.sql` has RLS enabled,
no anon/authenticated table or RPC grants, service-role-only invoker functions,
and a house-owner membership check inside each function. The API additionally
requires `FINANCE_DEV_ENABLED=true` and `FINANCE_PERSISTENCE_ENABLED=true`.
Missing schema, missing permission and disabled persistence fail closed. No
production migration file was generated or applied. No hosted credentials were
used. The draft must be promoted through the repository's reviewed migration
process before a production release.

Owner controls show server flags and source gates, check storage through
`GET /v1/intel/finance/control`, and reload saved portfolios. We used these same
controls to test storage and the feature. Configuration mutation, source approvals,
delegated operator roles, paid tiers and customer entitlements are NOT implemented;
configuration stays in the existing server environment. There is no new admin
framework or public checkout.

Run `node scripts/finance-preview.mjs` from the repository root for a local-only
preview. It requires Docker and the installed `postgres:17.6` image (the script
never pulls). It starts an isolated network-disabled PostgreSQL container, applies
the draft to fixture organization tables, and prints a loopback URL. Open that URL
for a fictional owner session. Its actual Worker handlers, controls and SQL are
used for saves/reloads. Stop with Ctrl-C; the disposable container is removed.
Persistence survives browser reload, not destruction of this test container.
The preview landing page is a product-entry harness, not a rendered globe; the
actual globe entry is implemented in `js/halo/halo.js`.

Verification: 41 targeted Node tests; real PostgreSQL permission rejection,
append-only history and stale revision checks; browser buy → save → reload at
390px and 1280px; storage diagnostics, rejected short sales, signed-out gate and
no horizontal overflow. No hosted Supabase or provider call was part of these
checks. Full production-schema integration/advisors and real globe browser
integration remain release checks.

Release blockers: reviewed production migration plus deployment/flag approval;
source-specific collection/redistribution decisions and adapters for live filings;
authorized market feed before non-synthetic paper execution. Current customer
release and collection remain disabled. $6/module/month remains proposed.

The sections below retain the foundation history; the persistent slice above
supersedes the earlier session-only UI description.

Local implementation, 2026-11-04. No production migration, deployment, collection,
payment integration or customer release. Pricing direction is $6 per module/month;
free browsing and premium features remain proposed. No Quiver purchase.

## Implemented contract

`workers/mccluster/src/finance/foundation.js` is independently authored and has no
network dependency. It normalizes **already extracted** House/Senate assertions;
it is not a PDF parser or live collector. Tests use invented, explicitly synthetic
rows and do not contain copied vendor records. SEC is a reserved source only.

Normalization preserves source URL/hash/page/parser version, owner uncertainty,
value intervals, transaction and filing dates, public availability and ingestion.
Security resolution deliberately stays unresolved. Report/row identity is scoped
to organization, private owner and source. Amendments explicitly reference their
predecessor and cannot cross scopes or branch silently. Duplicate identical input
is idempotent; a different same-identity assertion requires reconciliation rather
than overwrite. Callers retain the first ingestion timestamp when retrying.

Actual replay uses ingestion time. Reconstructed replay excludes unknown public
availability and uses demonstrated availability, without claiming Halo possessed
that record then. These utilities operate on validated normalized rows; persistence
and transactional reconciliation are not implemented. No raw request body should
be passed directly into history/replay utilities.

`GET /v1/intel/finance` is routed after the existing server `requireHouseOwner`
check and only enabled by `FINANCE_DEV_ENABLED=true`. It returns a development
manifest, not filings; successful responses are private/no-store. No release flag
was enabled. Existing World, Travel and Missions presentation is untouched.

`authorizeFinance` is a server-side policy evaluator, not a subscription system.
It requires separate scoped, unexpired, nonrevoked source and feature grants.
Member browse still requires source permission; premium cannot override it.
Owner-private records require owner identity plus private source permission.
Future handlers must resolve principals and grants from authenticated server
authority, never client JSON. There is no member route or persistent grant loader
yet. Production customer enforcement is NOT complete merely because this policy
unit is tested.

## Sources and collection gates

All collection is hard-disabled; `assertCollectionAllowed` always throws.
House/Senate access and intended use remain under review. No fetch transport,
scheduled collector or bulk ingest was created.

- House: https://disclosures-clerk.house.gov/FinancialDisclosure/ViewSearch
- Senate: https://efdsearch.senate.gov/search/home/
- Statutory restrictions: https://uscode.house.gov/us/usc/119-120/t5/s13107/
- SEC supported APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC fair access: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data

Public availability does not automatically authorize customer redistribution.
Direct congressional ingestion needs a documented permitted-use/access decision;
the commercial restriction/media exception must not be assumed away. SEC has
documented programmatic access but its connector is not implemented, and attached
third-party materials need their own handling. Market quotes require independent
entitlements. No endpoint scraping, protection bypass or paid vendor dataset
copying substitutes for those decisions.

## Next bounded packages

1. Persist scope/grants through the existing canonical authority after reviewed
   schema design; test database policies and service-role paths before exposure.
2. Independently authored source adapters: discover IDs, bounded fetch, checksums,
   extraction, checkpoint/retry and amendments. Enable each only after access/use
   review. SEC submissions are a documented-access alternative; they are not
   congressional trades. Manual permitted document import is another option.
3. Expand synthetic fixtures: scan/OCR uncertainty, options, annual-report overlap,
   corrected symbols, name collisions, missing availability and retracted reports.
4. AI assists extraction and candidate resolution with cited page spans and
   abstention. Deterministic validation governs dates/ranges/identity. Measure field
   precision, missed rows, review minutes and amendment lag against a reviewed set;
   do not claim superiority to Quiver without comparable evidence. No training.
5. Integrate an independent Finance globe product through the existing host and
   shared navigation, preserving retired member Travel/Missions. Add private report
   storage/retrieval only after isolation tests. No customer release implied.

Quiver, Unusual Whales and manual official-document workflows are comparison
baselines, not dependencies. Quiver's public schema documents upload/modification
times and value lower bounds; customer data rights are distinct from personal API
rights. https://api.quiverquant.com/docs/schema.json

## Verification and remaining work

Run from repository root:

```
node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/finance-foundation.test.mjs workers/mccluster/test/world-markets.test.mjs scripts/test/halo-markets.test.mjs
```

38 tests passed after adding the paper sandbox. Include
`workers/mccluster/test/finance-paper.test.mjs` in the command above.
The existing selected-quote test was corrected
to use its declared current clock rather than a stale provider fixture. Existing
quote/chart local edits remain; they are not historical market coverage. No PDF
parsing, live provider validation, model evaluation, persistent disclosure store,
price license, persistent paper ledger, checkout, or production changes.

## Owner-only synthetic sandbox

`finance-dev.html`, `js/finance-dev.js`, and `css/finance-dev.css` provide a standalone
development panel with an existing-globe return link. It is not registered in
shipping navigation and does not reactivate any product. The static shell contains
no private data; the workspace opens only after server authorization succeeds.
Local preview needs the existing authenticated Worker and `FINANCE_DEV_ENABLED`
on that local Worker; this change does not configure or deploy either. Browser
verification intercepted API requests and executed the real local router with a
fixture principal, without hitting production or a provider.

`POST /v1/intel/finance/paper-demo` is owner-gated and default-off. It accepts only
up to 100 commands in a bounded 16 KiB JSON body. Caller-supplied identity, prices,
cash or quote timestamps are rejected. The server reconstructs a fixed synthetic
scenario from commands; no mutable server account or user database is involved.
The scenario is explicitly January 2026, not current data. It starts at $10,000,
uses integer cents and whole shares, and buys/sells at subsequent fixture ask/bid
observations. Exact duplicate command IDs are idempotent; conflicting reuse fails.
Balanced cash/trade-clearing entries are returned for inspection. This is not yet
tax-lot accounting or a production portfolio ledger. No fees, dividends, corporate
actions, liquidity model or persistent order storage is claimed. Reload resets it.

The synthetic route does not require an external-source grant because it serves
no external data. It cannot bypass the existing owner check; customer routes stay
absent. Future real-data routes must load source/feature grants server-side using
the foundation evaluator; that integration remains unimplemented.

Browser checks at 390px and 1280px passed: authorized render, buy, rejected short,
access revocation and zero horizontal overflow. There were no page exceptions.
Screenshots and temporary harness were retained under `/tmp/finance-*` for this
session, not added to public assets. Tests also cover stale/prior/halted quotes,
wrong currency, fabricated prices, overspending, malformed/oversize requests,
default-off behavior and forbidden principals.
