# News/policy implementation recovery

Owner-requested emergency preservation, 2026-10-17. This is a recovery archive, NOT an activated feature or a complete restoration of the earlier implementation.

## Original work

Reported local branch: `feat/news-reader-policy-evidence-20261017`.
Reported local commit: `f8021df`; parent: `aad89c6c4ecb882c3c9ef28f6981c8a268447ce3`.
The earlier push failed. The previous checkout is unavailable in the current execution environment. GitHub did not contain that commit, its branch, the reported new tree, or the checked new Worker blob when recovery began.

## Preservation rules

`exact/` contains recovered source whose Git blob SHA-1 matches the original pre-push manifest. The trailing `.txt` prevents accidentally serving or executing incomplete recovered application code; remove only that suffix when deliberately restoring its original path. `snapshots/` contains complete earlier source snapshots that have NOT matched the final manifest. `fragments/` contains explicitly incomplete source ranges. The manifest records expected hashes, not proof that all 42 files have been recovered.

At the first checkpoint, the exact original `news-article.html` and `policy-workspace.html` were recovered and matched `b78cdcad398191589627a028dc032b00317ea193` and `43eba23c2401559a8f64c73ab217df68921e7b84` respectively. Additional recovery must be recorded separately; do not infer completeness from this archive's existence.

## Release boundary

No production code, other agents' branches, migration ledger, database, or deployment is changed. No earlier test result certifies a partial recovered tree. Keep any recovery PR draft. Restore missing dependencies and security boundaries, run fresh tests, reconcile concurrent PRs, and follow canonical review/promotion before activation.

The earlier target was same-site article reading, article comments, and Equity Uprise policy-fellow source/claim/evidence review and versioned manuscripts, reusing the canonical Worker, M identity and eu_* research graph. Publisher permissions and independent evidence review remain required; metadata is not full article text, and classification is not verification.
