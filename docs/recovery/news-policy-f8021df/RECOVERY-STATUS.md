# Recovery status — 2026-10-17

This archive is now on GitHub in PR #497, branch `recovery/news-policy-f8021df-20261017`. It is a partial recovery of the unpublished local work, not the original complete commit or a deployment.

## Exact final source recovered

The following recovered files have the same Git blob SHA-1 as the original 42-file pre-push manifest. Paths below are original paths; archived copies live under `exact/` and end in `.txt`.

| Original path | Verified original blob |
| --- | --- |
| `news-article.html` | `b78cdcad398191589627a028dc032b00317ea193` |
| `policy-workspace.html` | `43eba23c2401559a8f64c73ab217df68921e7b84` |
| `js/news-policy-client.js` | `e91fe0c039267cb32d6cb2994f50fb75a951b5fd` |
| `supabase/functions/_shared/eu-policy-os.ts` | `3b7413a3479be391b2881e6633c12a2d09ce3962` |
| `workers/mccluster/src/world-host.js` | `df60a6aba9061c9d6679f51bb1e7de909fa3e25b` |

A matching source hash proves byte identity, not functional completeness without the other files.

## Other real code preserved

- `snapshots/sql-early/`: four overlapping printed ranges covering an earlier complete SQL migration. Read its README before assembly. The final migration and its later repairs are NOT claimed recovered.
- `snapshots/news-policy-route-assembly.js.txt`: a complete module assembled from the earlier printed Worker beginning and later printed route tail. It preserves native reader/content handling, comments and moderation, workspace/project/member management, evidence capture, review and manuscript routes. Its final manifest hash is not verified; later response projections and error handling must be reconciled.
- `snapshots/news-reader-navigation.js.txt`: a complete earlier native-reader dialog/history controller. Its final manifest hash is not verified; later joint-history/music compatibility changes must be reconciled.
- `snapshots/test-news-policy-db.mjs.txt`: complete earlier disposable database harness. It depends on schema fixtures and the behavior suite that are not restored here. It has NOT been run against this archive.

## Still missing / not certified

The original `f8021df` commit object and full 42-file final tree are not on GitHub. In particular the complete final article/workspace frontend controllers, styles, final migration, tests, and changes to the legacy EU service adapters and shared integration files have not all been recovered. Use the original manifest to track each file; never treat the manifest itself as the source bytes.

The earlier reported 102 database assertions and other test results belong to the unavailable original working tree. They do not certify this partial recovery. No production migration, deployment, merge to main, or mutation of another agent's branch has occurred. Keep this PR draft and quarantined until deliberate restoration and fresh verification.
