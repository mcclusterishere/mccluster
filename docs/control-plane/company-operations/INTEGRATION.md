# Company Operations: independent integration package

Status: locally verified backend preparation module, not a released company-management product. Built for the reusable platform and Equity Uprise, with McCluster as its first adapter. Nothing is registered in the shipping router, deployed, applied to production, connected to a payment provider, or added to a public company projection.

Base: `mcclusterishere/mccluster` main `578e683088fdd49fb77848733e70dd4f3af039c3`.
Branch: `codex/company-operations-20261109`.
Integration coordinator: reconcile with the current head of draft #793, rather than overwriting it. Inspected #793 at `d3db21c9a14523fb6d55e5865c9ddaf1e9e64558`. That branch's `workers/mccluster/src/eup/companies.js` handles sourced company research/private intake. It does not implement these governance records. This branch does not edit that router, Control, public World, Core, finance quotes or provider execution.

## What is implemented

- An entity record per `(org_id, company_id)`, with name, legal-form assertion, jurisdiction and currency minor-unit exponent. A record is not proof of registration or legal status. Nonprofit and unknown entities cannot prepare shareholder distributions. Do not assume the McCluster public charity has shareholder dividend rights.
- Immutable private document references and hashes, checked by an injected canonical artifact resolver before acceptance. No document bytes, bank details, tax IDs, securities account identifiers or private real-world records are in this branch.
- Cap-table snapshots: explicit authorized/outstanding integer units, decimal unit scale, holder references and source document. Total holdings must equal outstanding units. Corrections append a new snapshot and refer to the old snapshot; they cannot fork or quietly replace it. This records an assertion; it does not issue, sell, transfer or cancel ownership.
- Cash-dividend preparation for a for-profit corporation, or member-distribution preparation for an LLC. Only an explicitly selected, equal-per-unit class is supported. Exact integer largest-remainder allocation, stable holder-ID tie-breaking and conserved totals. Zero-minor-unit allocations are possible and are not payments.
- Draft → in review → reviewed/rejected → external declaration recorded. Review is immutable and bound to the current terms revision. Preparation and approval require different authenticated people. Declaring records an already-made external human decision supported by a resolution, legal review and accounting review; it does not cast a vote or create legal entitlement.
- Voiding/corrections preserve original evidence. A corrected ownership snapshot blocks further review, declaration, accounting proposal and payment handoff based on stale ownership.
- Accounting proposal with balanced equity/payable sides, clearly unposted. It must go to the existing financial journal authority after an accountant chooses the correct account/tax treatment. It never creates a second money ledger.
- Provider-neutral, hashed handoff packet. The fingerprint covers every returned field except the fingerprint itself, including the accounting proposal. `executionEnabled` is always false. `executePayment()` always refuses. No provider submission, payout state, retrying paid operation, settled balance or receipt is fabricated.
- Hash-linked replay, append-only database records, tenant/company scope, current-owner authorization, stale-revision conflict, same-command recovery after response loss, and independent-installation isolation.

## Portable core and existing authorities

| Piece | Location / boundary |
| --- | --- |
| Pure reducer, exact allocation and record projections | `workers/mccluster/src/company-operations/domain.js` |
| Authenticated command service, replay, hash and artifact checks | `workers/mccluster/src/company-operations/service.js` |
| Canonical RPC adapter and opt-in HTTP handler | `workers/mccluster/src/company-operations/adapter.js` |
| Append-only records and atomic compare-and-append | `supabase/pending/company_operations_v1.sql`, **review only** |
| Tenant and owner authority | Existing `public.orgs` and `public.org_members` |
| Database transport | Existing `workers/mccluster/src/intel/store.js` |
| Runtime and orchestration | Existing Worker `mccluster` and OVH Core; no new worker, database or queue |
| Existing operations tasks / CRM | Keep `ops_objectives`, `ops_agent_jobs` and `out_*`; this package does not replace them |
| Financial authority | Existing approved accounting/payment components, not this record store. The pending `an_fin_*` journal is only a potential reviewed adapter target, not asserted production authority. |
| Company research and market data | Existing E=Up Companies/source intake and `finance/*`; research facts must not be silently converted into ownership or distribution rights |

The reducer has no imports, external calls or provider coupling. The service accepts `store`, `authorize`, `verifyArtifact` and `now`. The database candidate uses canonical organizations rather than a hard-coded house slug, so two synthetic installations work without separate auth stacks.

## Integration sequence

1. Fetch this branch, inspect ancestry/diff, then cherry-pick its single implementation commit into the coordinator's review tree. Keep #793 draft. No new repository is needed. Files are additive except the two pending RPC entries and source-map classifications. Merge those entries into the coordinator's CURRENT copies; never replace its ledger, schema evidence, pending list or source map with this branch's older base.
2. Read all three implementation modules and run the focused tests below. `handleCompanyOperations` is intentionally not imported into `entry.js` or the E=Up router. There is no accidental release path.
3. Review the schema candidate against the actual canonical schema and migration controls. Its functions are service-role only; neither authenticated users nor service role can mutate the table directly. Security-definer functions recheck `orgs.enabled` and owner membership and lock both through the transaction. The command service remains the domain-validation trust boundary; arbitrary server-role access must not become a client RPC proxy.
4. Supply a host-specific `authorize(request)` using the existing verified user/session and enabled organization resolver. Return `{actorId, orgId, role:'owner', enabled:true, human:true}` only after the actual interactive identity is established. Do not copy these fields from JSON/query strings, a generic admin flag, an AI job or an unverified bearer. The reusable module presently supports canonical owners only. Do not modify membership/security merely to make the two-person review pass.
5. Supply `verifyArtifact(principal, artifactRef)` from canonical private immutable storage/version records. Return `{orgId, artifactRef, sha256, immutable:true}` only after checking ownership, access and the exact bytes/version. No unchecked URLs, path-derived ownership, client hashes or public uploads. Unsupported or unavailable artifact storage must fail closed.
6. In the existing Control Companies & Finance workspace, add a separate **Company Operations** section, distinct from research. Use the same authenticated owner lifecycle: clear private state on sign-out, account switch and revocation; abort prior loads; private/no-store responses; no public cache or consumer projection. Show draft/reviewed/recorded/void separately. The handler takes a trusted company ID selected within the authenticated organization. Do not route arbitrary client tenant overrides.
7. Add a profile/record browser, document-reference intake, snapshot editor/validator, declaration preview, independent review, external-resolution record and handoff view through those controls. The current module intentionally has no UI, public route or fake browser acceptance evidence. Add scope, reload, interrupted auth and mobile checks on that integrated UI.
8. Route accounting proposals to the existing financial authority only after explicit review of recognition, account mappings, tax, currency support and correction/reversal policy. The source class allocation is a proposal, not a legal determination of beneficial ownership or eligibility. Prefer no posting until this is reviewed end to end.
9. Keep execution disabled. A future provider adapter needs a separate reviewed action-time handoff, recipient/account verification, tax/withholding and provider eligibility, durable exact-operation identity and uncertain-outcome reconciliation. Never derive permission to transfer money from a recorded declaration. Do not repurpose merchandise/creator checkout code as a securities dividend service.
10. Only after separate release authorization: promote the reviewed schema using the actual returned version, reconcile ledger/snapshot, deploy the composed candidate, and enable its route. Do not apply this pending file now. Keep real corporate filings, legal title changes and financial execution in their required human workflow.

## Supported v1 scope and limits

Node 20+ or Web Crypto capable Worker; verified here with Node 24.22.1. PostgreSQL candidate verified with native 17.7. No new runtime dependency. Tests use existing `@fal-ai/client` 1.10.1 for the pre-existing aggregate suite, and `embedded-postgres` 17.7.0-beta.16 / `pg` 8.23.1 for the optional native proof. These are test-only installed dependencies; the harness never downloads them or reads production credentials.

One profile version per company is currently immutable: correcting legal form/currency requires a reviewed future record amendment, not editing history or pretending a new ID is the same entity. Each snapshot is effective on a specified record date; future record-date declarations are held until an actual matching register exists. Supported allocations exclude preferences/waterfalls, treasury shares, options/warrants, vesting, beneficial/legal/voting-owner reconciliation, non-cash/property dividends, FX, withholding, tax filings and provider execution. These need explicit models and independent verification, not guessed defaults.

Bounds: 30 classes per snapshot, 1,000 holders per class, 500 documents, 100 snapshots, 200 declarations, 2,000 events and 2 MiB projected workspace. Integer strings support up to 36 decimal digits. Command JSON is bounded to 96 KiB and HTTP body to 100 KiB. Current-history replay is bounded, not an unbounded production cap-table system. Repeated commands require the same actor, command ID and payload. On uncertain append outcome, recover with the same command ID; do not create a new ID automatically.

Hash chaining detects accidental/tampered history during replay. It is not an externally anchored signature, a guarantee against a compromised database superuser or proof of a document's legal validity. PostgreSQL domain-validation trusts the service-role Worker; SQL does not independently recompute financial/domain rules. No role delegated through a generic admin label is accepted.

## Verification commands

From the repository root:

```sh
node --import ./workers/mccluster/test/support/offline-network.mjs --test workers/mccluster/test/company-operations.test.mjs
COMPANY_TEST_DEPENDENCIES=/absolute/path/to/existing/node_modules \
  node --import ./workers/mccluster/test/support/offline-network.mjs workers/mccluster/test/company-operations/native-db.mjs
node --import ./workers/mccluster/test/support/offline-network.mjs --test --test-concurrency=4 workers/mccluster/test/*.test.mjs
node --test --test-concurrency=4 scripts/test/*.test.mjs
python3 -m unittest discover -s scripts/test -p 'test_*.py'
git diff --check
```

The native script creates only local disposable PostgreSQL databases, listens on loopback, runs eight concurrent sessions, and closes the cluster. Its interrupted first-install proof is an atomic rollback, not a claimed N-1→N upgrade. Its logical backup/restore proof restores this module's complete event history into a second disposable database and verifies an identical handoff digest. It is not a full platform disaster-recovery proof. No production DB, credential, provider or external network is part of the proof.

See `VERIFICATION.md` for exact outcomes, original failures and remaining tests. No merge/deploy recommendation is implied by an isolated green branch.
