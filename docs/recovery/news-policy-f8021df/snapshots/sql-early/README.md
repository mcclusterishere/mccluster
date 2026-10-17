# Earlier SQL snapshot — NOT the final migration

These four files preserve a complete earlier printed version of `supabase/pending/news_policy_workspace_v1.sql`. They are recovery material, not an applied or release-ready migration. No database command was run during this preservation.

Order: `001-260.sql.txt`, `260-525.sql.txt`, `525-805.sql.txt`, `805-end.sql.txt`. The source listings overlap on lines 260, 525 and 805. When assembling them, preserve all lines from the first file and omit the first line of each later file. Check each boundary before joining; do not simply concatenate all four.

This earlier snapshot does NOT match the expected final blob `84e94137440fc166885693e77e03bdcbf0c9cf40` (73,377 characters). Later work included additional service-role mutation guards, capacity limits, recursive legacy-RLS repairs, and allowing removal of disabled members. Their final integrated form has not been recovered here. Do not substitute this snapshot for that tested final migration or apply it to production.

The recovered SQL includes durable article metadata, native-content storage, comments/replies/reporting/moderation, primary M-account checks, protected project membership, source provenance, evidence capture, independent claim review, manuscript revisions, RPC wrappers and grants. Those contents are preserved as source, not certified as a secure complete deployment.
