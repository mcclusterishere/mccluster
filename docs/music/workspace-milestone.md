# Private collaborative music projects — staged milestone

Discovery hook for the existing creator UI: link to `music-workspace.html`, label **Music projects**. Mount `handleMusicWorkspace(request,env)` from `workers/mccluster/src/music-workspace.js`; route/preflight `/v1/music-workspace/action` and `/v1/music-workspace/file`. No existing music/profile/tabbar source was modified. The new page uses the shared auth and tabbar.

## Audit of existing main runtime

- `js/music-creator-studio.js:66` defines creator master/preview upload ceilings; around lines628–699 it collects collaborator permission and rights attestations for release submission. This is creator release management, not a shared editing project.
- `supabase/migrations/20260920041011_music_creator_platform_v1.sql:251` defines public previews/artwork and private creator masters. Existing private master access is uploader-owned (`:275`), so sharing those buckets directly would not give a correct collaborative permission model.
- `supabase/migrations/20261021050105_music_creator_one_click_v1.sql:167` exposes creator eligibility/onboarding. The new workspace requires an existing active music_creator_profiles record linked to the same authenticated user through m_auth_user_links; it does not onboard or approve anybody.
- `workers/mccluster/src/music/router.js:1` implements listening ledger/gated streams. `js/music-engine.js` is playback runtime. Searching inspected music runtime/schema found no shared multitrack editor, stem separation, MIDI/MusicXML editing or collaborative arrangement persistence. Code elsewhere or external providers are not evidence of integration.

## Delivered and bounded

Private projects, owner-invited existing active creators by handle, explicit accept/decline, editor/listener roles and owner revocation. Editors upload original audio/stems with immutable credits; listeners listen/download/comment. Original objects are insert-only in a private bucket. File size is capped at25MB; supported container formats are WAV, MP3, FLAC, Ogg, MP4 audio and WebM. Worker validates size and container signature, computes a SHA256 for the normal upload flow, and retries an uncertain upload only if existing bytes match. The stored hash is provenance metadata, not a third-party integrity attestation: authenticated uploaders can invoke their own finalize RPC directly.

Microphone recording uses browser MediaRecorder only after a user gesture. The take stays local for playback/review until the creator separately uploads it and supplies credits. Tracks stop on stop, navigation or auth changes. Unsupported browsers have file upload fallback. No private audio, actual microphone recording or external analysis service was used in development.

A version is an immutable ordered listening arrangement of original asset IDs plus author/note. A base-version check prevents silent overwrites between collaborators. This is asynchronous collaboration and individual-file listening, **not** simultaneous playback/mixing, a sequencer, multitrack recording, sample editing, trim/effects/export or a realtime synchronized DAW. Owner release-ready selection points to a specific version; subsequent versions remain drafts. Nothing creates/publishes creator_tracks, World posts, catalog releases or external distribution. Creators can download originals for the existing separate release/rights workflow.

Video editing/posting, trackout vs MP3 analysis, stem separation, MIDI/MusicXML analysis/editing, waveform tools and audio mix export remain acceptance gaps. No provider placeholder is presented as completed functionality.

## Deployment and verification

Pending migration `20261026009400_music_workspace.sql` requires existing auth.users, music_creator_profiles, m_auth_user_links and Supabase storage schemas. It adds project RLS, authenticated identity-bound RPCs and private `music-workspace-originals` bucket/policies. Review/apply only with production authorization. No migration, bucket or account was created in production. Existing membership/access policy is preserved.

Local PGlite fixture executes the migration and tests two creators plus a guest: invitation gating, listener/editor/owner permissions, direct-table RLS, upload original immutability, comments, version conflicts, ready/draft separation and revoked file access. Worker fixtures prove JWT forwarding and invalid file rejection. Chromium390px fixture uses a fake MediaRecorder and fake stream to prove gesture-only recording, local review/no upload, cleanup and no horizontal overflow. Real mobile audio codec, storage and production auth integration remain unverified.

Quota hardening: each creator can own at most20 projects; each project can reserve at most100 files totaling1GiB. Pending reservations count toward both limits, so failed uploads cannot bypass quotas. Project creation uses an owner advisory lock and reservations use a project-row lock before checking count/bytes. These are staged code limits, not production configuration changes. UI explains each limit and exposes retry of the uploader's pending original without consuming another reservation. There is no automatic deletion of immutable originals or abandoned reservations; administrative retention/cleanup is a separate future policy. PGlite tests exercise exact project/count/byte boundaries and two queued competing reservations; PGlite serializes requests, so this is not a multi-connection load test.
