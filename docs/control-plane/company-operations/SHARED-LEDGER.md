# Shared contributions and organization architecture

Backend review candidate for a reusable company or informal group. This extends
`codex/company-operations-20261109` at `cc9e0d606d7cfa4a073f402f02bf92490efa9e3b`
on the separate `codex/shared-contribution-ledger-20261109` branch. It is a
synthetic-tested architecture, not an operating trust, bank account, autonomous
corporation, independent audit or payment service.

## The product records

One private place to answer:

- Who supplied money, performed work, provided an asset, or reported an activity?
- What evidence supports that report, under which recorded policy?
- Who recorded, reviewed, disputed or corrected it, and when?
- Which human or AI seat is responsible for a campaign milestone?
- What was reported this week, what was reviewed, and what still lacks evidence?
- What distribution proposal needs a human's legal, accounting and payment review?

`shared-ledger.js` composes the existing portable company reducer with
`organization.js`. `createSharedLedgerOperations()` uses the same authenticated
service, immutable event table, tenant scope, revision compare-and-append,
artifact verifier and replay. There is no new database, payment ledger, auth
stack, blockchain, provider account, scheduler or job queue. Old company histories
continue to replay; extended histories require the extension reducer and fail
closed with the base-only reader instead of silently dropping unfamiliar events.

## Contributions are not interchangeable balances

Participants are private record subjects, not authentication accounts or access
grants. The recorder, contributor and independent reviewer are distinct fields.
No real participant or private evidence is included in the repository.

Money uses exact integer minor-unit strings and one explicitly configured
currency. `pledged` and `reported_received` are separate. `incoming` and
`outgoing` are explicit, not guessed from a description. Gift, loan, expense,
reimbursement, capital-contribution and unclassified labels are operator
assertions, not completed legal/tax classifications. Even a reviewed received
record is not an independently verified bank transaction or spendable balance.
The summary intentionally returns `bankBalance: null`.

Work is integer minutes plus a work type. Assets retain quantity, decimal scale,
unit and asserted holding basis (`use_only`, `reported_transfer`, `unknown`).
Non-quantified activity retains its evidence and description. Money, minutes,
asset quantities and activities are never summed into one grand total.

A valuation is a separate, dated, independently reviewed estimate for accepted
work or assets. It preserves its basis/evidence, can be superseded explicitly,
and never becomes cash, wages, debt, equity or a beneficiary interest. Correcting
or disputing the source contribution removes its valuation from current totals.

## Rules, review and immutable history

Policies record money/work/asset/distribution rules from an existing external
agreement reference. A human proposes; a different authenticated human records
review. Policy approval is **not** signing a contract or establishing enforceable
rights. No code automatically grants ownership or authorizes a distribution.
A revised policy names the current reviewed predecessor. Competing revisions
cannot silently replace one another. Pending work under old rules must be
reconciled explicitly; already accepted records retain their historical policy.

A contribution begins `submitted`. A different human can record approval or
rejection with a note. Accepted records contribute to the current projection.
Corrections append a new entry with the old entry ID and a reason, preserving
both versions. A submitted correction does not change accepted totals. An
approved correction supersedes its predecessor; a conflicting correction branch
is refused. A recorded dispute holds the affected entry out of current accepted
totals and invalidates dependent reconciliation. Nothing silently edits/deletes
the underlying events.

Evidence is a private immutable artifact reference and SHA-256, checked through
the existing canonical storage verifier. Contribution types require appropriate
evidence kinds. A hash establishes bytes, not truth. Sensitive documents should
stay in restricted canonical storage with deliberate retention; do not put bank
identifiers, passwords, identity documents, family details or children's data in
logs, public code, report metadata or a public blockchain.

## Reconciliation and distribution proposals

A reconciliation names an explicit period and the complete ordered set of
accepted, reported-received money entries in that period. It records separately
an operator-supplied external statement's incoming/outgoing amounts and preserves
differences. It does not create an account or prove custody. Independent review
with differences yields `reviewed_with_exceptions`, which cannot support a
handoff. A late accepted entry, correction or dispute makes prior reconciliation
stale, requiring a fresh record and review.

Distribution allocations are explicitly entered, sum exactly to the proposed
amount, and identify known record participants. They are not inferred from
hours, asset values, cap-table shares or contribution percentages. A proposal
requires a current reviewed policy, matched non-stale reconciliation, source
review evidence and a different human reviewer. Its handoff remains disabled,
with no legal effect or actual payment. The packet digest includes the complete
returned artifact except the digest field. The financial operator must still
establish actual funds/custody, recipient identity, legal entitlement, tax,
provider eligibility and action-time authorization. No available-to-spend balance
or provider execution is implemented.

For an actual company dividend, retain the original company module's separate
cap-table/declaration workflow. Do not automatically convert participation in this
shared ledger into ownership. Do not assume a nonprofit can distribute profits
to participants merely because it records their contributions.

## Human-led organization and AI work

See `ORGANIZATION-ARCHITECTURE.md` for exact commands, role/campaign/milestone
versions, seat history, daily evidence, weekly snapshots and reporting timezone.
The CEO label is a recorded operational human sponsor, not a legal appointment.
The current authenticated ingress remains **owner-only**. Daily entries are
owner-transcribed reports about a human or AI seat, not direct authenticated
member/agent submissions. No role record grants application permissions.

The architecture points at existing `ops_objectives`, `ops_agent_jobs`, Core
capabilities, plan policy and completion-evidence checks. Work proposals are dry
runs. Task/job references are unverified; reported/approved output is distinct
from actual execution and `verifiedCompletion` is always false. Assigning an AI
seat does not start a model, create a job, prove work happened or allow it to
approve itself. Human/AI collaboration through scoped canonical identity and a
trusted execution-receipt resolver remains an integration gate.

Weekly reports can be compiled on demand or saved as immutable versioned
snapshots with explicit week start, reporting timezone and as-of instant. No
weekly schedule, email or message delivery was configured. Future recurring
runs should use the existing canonical Core scheduling/notification path, persist
the report before delivery, and obey the recipient and data-sharing approval
boundary rather than adding a second digest service.

## Conventional audit trail before blockchain

Recommended default: canonical database transactions, least-privilege permissions,
append-only events, evidence references, protected backups and independently
stored signed checkpoints or write-once audit copies. The existing hash chain
helps detect modification during replay; it does **not** make a database
administrator unable to rewrite history and recompute hashes. This is not an
independently audited or externally anchored ledger today.

A permissioned blockchain may be useful if genuinely independent organizations
must share verification and governance without relying on one operator. If one
operator controls every validator, it adds complexity without removing that
trust dependency. A public chain exposes durable metadata and variable fees;
wallet/key control does not establish personal identity, work performed or legal
rights. Ordinary self-custody recovery differs from password reset. Smart-wallet
recovery adds its own guardian and implementation risks.

If independent proofs later justify it, first design signed private batch
checkpoints. An optional later adapter could anchor only a batch commitment or
Merkle root, with randomized private leaf commitments and privately retained
proofs. Never anchor names, amounts, document URLs or raw records. Even hashes
of predictable inputs can reveal information. An inclusion proof can support
checking a prior committed version; it cannot establish truth, ownership or
entitlement. Wallet creation, chain selection, costs, privacy review and any
transaction require their own authorization. No anchoring code or wallet exists
in this module.

## Legal/account boundary, with Connecticut/US as an example

A software contribution record does not form a legal trust or open a bank or
custodial account. Connecticut specifies methods and requirements for creating a
trust, including intent, beneficiaries and trustee duties. An institution's
account title, ownership, authorized signers and deposit-insurance treatment are
separate from an application's labels. Actual legal structure, agreements,
valuation and tax treatment need a qualified lawyer/accountant before real
trust/equity/custody mechanics. This architecture asserts none exists.

Sources checked for the architecture recommendation:

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): log access, tamper detection and protected copies.
- [NIST IR 8202, Blockchain Technology Overview](https://csrc.nist.gov/pubs/ir/8202/final): permission models and distributed ledger trust; foundational 2018 reference.
- [Ethereum privacy](https://ethereum.org/privacy/ethereum): standard transactions are pseudonymous and publicly visible.
- [Ethereum gas](https://ethereum.org/developers/docs/gas/): transaction fees vary.
- [Account abstraction](https://ethereum.org/roadmap/account-abstraction/) and [support FAQ](https://ethereum.org/community/support/faq): recovery models and limitations.
- [Connecticut Uniform Trust Code](https://www.cga.ct.gov/current/PUB/chap_802c.htm), §§45a-499v/w: methods and requirements for creating a trust. Official search results were checked; the full-page fetch returned an error, so no exhaustive legal review is claimed.
- [FDIC trust accounts](https://www.fdic.gov/financial-institution-employees-guide-deposit-insurance/trust-accounts): deposit records/ownership categories, not app-ledger labels.

## Integration and held boundaries

1. Compose this branch after the original company module. Reconcile ongoing #793
   work rather than overwriting its current tree. `service.js` only gains a trusted
   server-selected reducer and artifact-command list; no client picks either.
2. Use `createSharedLedgerOperations` with the existing current-owner resolver
   and canonical immutable-artifact verifier. Keep these entrypoints private and
   unregistered until the host/Control authorization and lifecycle tests pass.
3. The SQL event store is unchanged. It remains a review candidate, not a newly
   applied production migration. This extension does not expand database roles.
4. Add the existing Control frontend for participants, contributions, evidence,
   policies, reconciliation, role assignments, daily reports and weekly views.
   Preserve distinction between personal records and organization authority.
5. Review owner succession, member/agent scoped ingress, disputes, sensitive-data
   retention, qualified legal/accounting decisions and canonical execution
   verification before expanding beyond the tested architecture.
6. Run focused, native DB, aggregate and integrated UI tests on the actual
   composed tree. Keep providers, money movement, legal operations, public
   projections and blockchain anchoring disabled.

Keep subscription billing and purchased access separate from this ledger. Existing
product-widget authorization distinguishes resource capabilities from purchased
access; contributions, internal role seats and reviewed records do not create
module entitlements. Do not repurpose creator billing or merchandise purchase
rights as ownership, governance authority or contribution balances. See the
existing [product-widget entitlement contract](../../productization/PRODUCT-WIDGET-ENTITLEMENTS.md)
through `docs/productization/PRODUCT-WIDGET-ENTITLEMENTS.md` in the repository.

## Ledger command contract

All commands have exact `{id,type,data}` envelopes. Unknown/missing fields fail.
Company/request identity, actor identity and the human indicator are supplied by
trusted authorization, never by command data. IDs are bounded opaque identifiers.

| Command | Exact data fields |
| --- | --- |
| `ledger_register_arrangement` | `name jurisdiction currency currencyExponent purpose` |
| `ledger_enable` (existing company) | `purpose` |
| `ledger_record_participant` | `id label` |
| `ledger_record_evidence` | `id kind artifactRef sha256 effectiveDate` |
| `ledger_propose_policy` | `id supersedes evidenceId moneyRule workRule assetRule distributionRule` |
| `ledger_review_policy` | `policyId decision` |
| `ledger_record_contribution` | `id partyRef kind occurredOn description evidenceId policyId value supersedes correctionReason` |
| `ledger_review_contribution` | `contributionId decision note` |
| `ledger_dispute_contribution` | `contributionId reason evidenceId` |
| `ledger_propose_valuation` | `id contributionId supersedes amountMinor currency asOf evidenceId basis` |
| `ledger_review_valuation` | `valuationId decision` |
| `ledger_record_reconciliation` | `id periodStart periodEnd statementEvidence entryIds reportedIncomingMinor reportedOutgoingMinor` |
| `ledger_review_reconciliation` | `reconciliationId decision note` |
| `ledger_propose_distribution` | `id policyId reconciliationId amountMinor currency allocations purpose evidenceId` |
| `ledger_review_distribution` | `proposalId decision note` |
| `ledger_prepare_handoff` | `proposalId` |

Decisions are `approve` or `reject`. Approval requires current evidence/policy/
reconciliation; rejecting a pending stale proposal remains possible. Optional
predecessors and correction reasons use explicit null. Money value fields are
`amountMinor currency flow classification receiptState`; work uses
`minutes workType`; assets use `quantity unit unitScale holdingBasis`; activity
uses an empty object. Evidence kinds and enum values are validated in source.
Each distribution allocation is `{partyRef,amountMinor}` and values are positive
integer minor-unit strings.

An approved supersession is permanent even when its successor is disputed.
Disputing a corrected contribution holds the lineage; it never resurrects the
predecessor, restores an old handoff or permits cousin corrections to double
count the same contribution. Resolution is another explicitly reviewed
successor of the current lineage head.

## Upgrade and recovery limits

The extension reader replays base company histories unchanged. New commands are
stored in the same candidate table, so no extension SQL is required. Once new
event types exist, a base-only reader cannot read that aggregate and fails closed
with `history_schema_or_record_invalid`. Do not erase events or downgrade the
reader to make that error disappear. Safe rollback is to disable the integrated
route while preserving an extension-compatible recovery reader and private
backups. This is a tested reader-compatibility boundary, not a full platform
N-1 upgrade or disaster-recovery claim.
