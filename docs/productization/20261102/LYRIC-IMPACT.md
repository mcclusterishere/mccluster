# Lyric migration impact gate

Separate extension, not part of the six-file website foundation. Source: `story/cluster-fucked-workspace-20261101` at `9d7a7eedc495bb577da1df879cbf7a8fe7aa1cfa`, `supabase/pending/music_lyric_revisions_v1.sql`, Git blob `4d47740154b39d7a57ad8d72e0cff030bf598cac`.

The parent's independent 02:34 UTC catalog audit confirms that `private.music_lyric_revisions`, `music_lyrics_get/save/export`, and `music_lyrics_public_guard_trg` are absent. Existing `control_authorize_service(uuid,uuid,text,text,text,text,uuid)`, `music_review_digest(jsonb)`, `creator_tracks.lyrics`, reviewed snapshot/digest/time, approved master version and the existing track guard are present. Do not report a missing authorizer from a differently typed lookup.

This migration is **not schema-only**. It preserves affected original JSON privately as untrusted legacy revision zero, sanitizes both `lyrics` and `reviewed_snapshot.lyrics`, clears review digest/time and publication time for affected rows, changes approved/published statuses to `pending_review`, and cleared rights to `review`. It changes no master bytes/paths. Private history is not new public approval. Releasing its editor before SQL is not safe.

Before approval, run the prepared aggregate-only `lyric-impact-preflight.sql` after refreshing the source hash and catalog. It returns totals only: rows inspected, affected, release downgrades, rights re-review and publication timestamps cleared. It never returns lyric contents or customer identifiers, creates no function, and mutates no row. Its normalization is checked against the source function in a disposable database; revalidate it if that source changes. An exact count is still a point-in-time estimate, not application authority.

Back up the affected records and database under approved private retention/access controls before execution; do not export lyric JSON to Git, chat or this packet. Verify restore on a separate authorized target. Preserve old guard ordering and immutable music version/ownership/payment protections. Record exact SQL hash and reviewed combined Edge/editor commit. Obtain approval that explicitly acknowledges possible release withdrawal and rights re-review, rather than describing the change as harmless scaffolding.

Containment: keep lyric mutation/export entry points unavailable if schema is missing, do not fall back to creator-writable history, and retain private revisions and immutable history. If new guards cause an issue, disable the affected feature and inspect safely; do not restore unsafe payloads to public fields or automatically reapprove downgraded releases. Any content restoration/publication decision is separately reviewed.

Parent reports 50 local PostgreSQL assertions for this source; those are attributed evidence, not tests rerun in this task. No production impact query or lyric migration was executed here.
