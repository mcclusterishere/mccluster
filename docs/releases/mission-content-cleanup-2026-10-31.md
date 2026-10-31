# Mission content cleanup — 2026-10-31

Owner explicitly approved deleting the old mission content, then requested a retry after the first confirmation was interrupted. The interrupted attempt left production unchanged. The retry completed as one transaction in Supabase project `zmnhbrjyhxzhkxmhkexs`.

Removed 39 missions, five campaigns, and 19 partner drafts. The mission specified for retention in the supplied plan, **Give someone a free ride** (`302dcb4e-ca21-4289-b633-9c397985fb9d`), remains with no campaign. Post-commit verification: one mission, zero campaigns, zero drafts. The existing direct-music offer was preserved.

Before deletion the relevant dependency inventory showed eight mission assignments, three participants, three bounties, two cohorts and two campaign events. These are subject to the existing foreign-key cascade rules. There were no submitted proofs, bounty claims, bounty funding rows, cohort members or campaign financial ledger rows in the affected set. No blocking clip campaigns or intelligence decisions/outcomes were present. The transaction held locks and refused to run if target counts changed or purchase/funding/proof activity appeared.

This was an owner-authorized content operation, not a schema migration. The migration ledger remains at 355. Historical migration files were not rewritten. The mission engine code and schemas remain available; visibility is unchanged. Independent Equity Uprise product distributions must use a clean baseline without these production content seeds.
