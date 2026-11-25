# Contribute panel

The desktop Contribute panel is the user-facing opt-in for the compute contribution
pilot (`COMPUTE-CONTRIBUTION-LEDGER.md`). A person turns contribution on from their
own computer, and the panel shows how many work units that computer has contributed
and how many spendable units it has earned.

The panel is a client. It never calls the Core, and it never talks to production
Supabase. Opt-in is a file in the node state root. Ledger totals appear only after
a trusted writer (the node doctor, or a local test helper) records a receipt from
`compute_ledger_balances`.

## Files in the state root

- `contribute.json` (`schema`: `mccluster.contribute-panel/v1`): `{ opted_in, updated_at }`.
  The opt-in toggle is the only writer of this file from the panel.
- `contribution-balances.json` (`schema`: `mccluster.contribution-balances/v1`):
  `account_id`, `contributed_micro`, `earned_micro`, `carry_micro`, `available_micro`,
  `pending_micro`. The panel only reads this file.

The same contract is implemented twice so a Windows desktop and a Linux/macOS helper
stay in lockstep:

- `desktop/contribute-panel/index.mjs` and `cli.mjs` (runs on this box, covered by tests)
- `desktop/windows/src/ContributeLedger.cs` and `ContributePanel.cs` (WinForms control
  that follows the EquityNet / Equity Fighter StatusPanel Contribute section)

The redemption rule is unchanged: 3 contributed work units earn 1 spendable unit.
Leftover units stay as carry. The panel may preview that math with `redemptionMint`;
only the pending SQL actually records a mint.

## How to opt in on a second computer (once one is online)

These steps assume the contribution-ledger branch and this panel branch have been
reviewed, the pending compute SQL has been applied to the environment you intend to
use (not done here; production was not touched), and `CORE_CONTRIBUTION_LEDGER_ENABLED=1`
is set on the Core that will reserve and settle jobs.

1. Install the EquityNet / Equity Fighter desktop build that includes `ContributePanel`,
   or check out `prime/desktop-contribute-panel` and run the helper below.
2. Install a local Ollama (or the approved node adapter) and the Windows node doctor
   at `core/windows/mccluster-node.ps1`. The doctor is the only process that should
   write the node state root besides the opt-in file.
3. Enrol the device with the doctor (`-Enroll`). The one-time enrolment credential
   is passed in the child environment (`MCCLUSTER_NODE_ENROLL_TOKEN`), never on a
   command line, and is not stored by the panel.
4. Open the Contribute section. Read the consent text. Set limits (idle only, AC
   power only, max concurrency 1 in the pilot). Turn the **Opt in** toggle on, or
   click **Enable contribution**. That writes `contribute.json` with `opted_in: true`.
5. After the node completes accepted work, refresh the panel. Contributed and earned
   units come from `contribution-balances.json`. Three accepted work units credit one
   spendable unit; a remainder stays as carry.
6. Pause and Revoke stay on the existing doctor buttons: Pause stops new claims
   within one poll; Revoke removes the local key material and names the node id to
   revoke on the Core.

Helper on a Unix machine, against a local state directory only:

```
node desktop/contribute-panel/cli.mjs --state /path/to/state-root opt-in
node desktop/contribute-panel/cli.mjs --state /path/to/state-root status
```

## Tests

- `node --test desktop/contribute-panel/contribute-panel.test.mjs`
- `PGLITE_MODULE_PATH=<pinned pglite dist/index.js> node scripts/compute-contribute-e2e.mjs`
  registers two (plus one stale) nodes in a disposable database, contributes work,
  checks the 3-to-1 credit, routes the job to the online node, skips offline and
  stale nodes, and deducts the spender's credits. It never uses production.

Windows helper tests: `dotnet run --project desktop/windows/tests/ContributeLedgerTests.csproj`.
