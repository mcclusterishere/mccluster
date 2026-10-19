# McCluster Music Runtime & Queued Research Pipeline v1

**Status: draft internal R&D, PR #543 stacked on PR #541. No production schema changes, GPU deployment, model downloads or public music publication performed.**

## One transport across the music system

MCC_MUSIC is the sole authority for audio playback, gated masters, preview limits, creator tracks, playback-origin telemetry, media-session controls and verified listen accounting. The opt-in same-origin shell at _unfinished/music-runtime/index.html keeps it in the parent document while supported music, research and creator rooms change in an iframe. On a registered embedded page, music-engine.js aliases the parent transport before constructing Audio.

This is not yet sitewide zero-gap playback. Full-page navigation outside the shell and cross-origin transitions destroy the host. iOS Safari background/resume and gesture-dependent playback need device verification. Autoplay exposure must never be treated as a listener's deliberate musical preference. Existing public pages remain unchanged.

## Durable CPU/GPU queue, ownership and review

The PENDING file supabase/pending/music_research_pipeline_v1.sql defines a PGMQ-backed queue (not a production migration). An authenticated creator must own the original creator_tracks master and hold rights attestations before submitting a job. Each stage requires explicit opt-in and a commercially approved model. An idempotency key deduplicates retries; creator quotas bound abuse.

PGMQ messages store a job UUID, stage and resource. The installed pgmq.read function supports JSONB conditional message matching. CPU workers claim analysis/engraving; GPU workers claim separation/transcription. Each worker receives a visibility lease and UUID fencing token, renews with heartbeats, and cannot finish after lease loss or cancellation. Retries are bounded with a backoff. No browser can claim or finish an internal job.

Service workers fetch creator-private audio, execute only allowlisted tools in isolated subprocesses without inheriting Supabase credentials, and upload derived files to a private bucket. SHA256 output hashes and storage references are checked before moving a job to awaiting_review. A separate authenticated creator downloads scoped short-lived artifact links, approves or rejects each stage, and explicitly requests the next. Approval never automatically publishes, sells or grants third-party training rights.

Execution implementations: scripts/research-engine/music-job-worker.mjs (CPU) and queued_worker.py (GPU resource adapter). Neither is deployed or scheduled by this PR.

## BPM and musical key accuracy

The measured first-party signal model is js/resonance/core.mjs with js/resonance/theory.mjs as a cautious baseline. Optional CPU harmonic-CQT/key templates and beat-track hypotheses are in scripts/research-engine/tempo_key.py. An optional Beat This! model (MIT code and weights) can be used ONLY with an operator-approved local SHA256-pinned checkpoint. No runtime downloads.

js/resonance/tempo-key-consensus.mjs compares independent BPM/key hypotheses, preserves half-time/double-time ambiguity and enharmonic equivalence, and abstains when models disagree. Its confidence values are uncalibrated heuristics until evaluation against held-out, legally usable reference audio. Do not declare an exact BPM/key for changing meter, tempo, key modulation, percussive or microtonal music without human correction.

benchmark_tempo_key.py reports strict and half/double-time tolerant BPM error separately, key MIREX weighted accuracy, and abstention by recording style. Training-data overlap must be excluded before claiming benchmark independence. Evaluation candidates include MUSDB18, MAESTRO, Slakh2100 and annotated genre-diverse tempo/key recordings with cleared usage rights.

## From audio to a reviewable score

1. Approved original full mix or genuine DAW stems → acoustic analysis (sample rate, spectrum, BPM/key candidates and resonator signature).
2. Approved licensed separator → estimated vocals, bass, drums and other stems, with stem leakage and separation errors; these are not recovered original recording session trackouts.
3. Human creator reviews the stems before optional transcription.
4. Approved isolated pitched stems → provisional MIDI note events, with onset/pitch/instrument uncertainty. Separating kick, snare and hats requires additional drum classification models; a generic drums stem is insufficient.
5. Human reviews MIDI before music21/MusicXML. Draft notation remains creator-private until edited and individually authorized for release.

Model license distinctions:
- Beat This! code and model weights: MIT, with training-data terms subject to diligence.
- Essentia KeyExtractor/HPCP: AGPLv3 or separately licensed commercial use.
- BS/Mel-Band RoFormer and Demucs: code licenses do not determine EACH pretrained checkpoint's commercial rights.
- Basic Pitch: Apache2 code; validate exact installed checkpoint license and polyphonic accuracy.
- MuScriptor (2026): MIT code, CC BY-NC 4.0 pretrained weights; weights DISABLED for McCluster commercial use.
- MT3: Apache-licensed source; independently confirm external checkpoint permissions.

The on-disk model allowlist is config/music-research-models.v1.json. Only first-party spectral analysis is enabled. All other inference requires separate legal review, version pinning, checksum validation, access restrictions, and metrics.

## Security, tests, and deployment gates

- Model runners never receive service-role credentials or user JWTs; execution hosts must deny arbitrary internet egress.
- Browser review uses MUID-based RLS, private Storage objects and short-lived signed URLs. No public master URLs.
- Explicit rights review continues to govern creator publishing, regardless of queue status.
- Stage costs, quotas, retry/exhaustion, cancellation, credential rotation, orphan-object cleanup, and revoked consent must be verified in staging.
- Run the SQL test at supabase/tests/music_research_pipeline_v1.sql only after installing the pending migration on a disposable database; never run it against production as a shortcut.
- Run Node/music/runtime CI, real model integration tests with authorized samples, and iPhone Safari foreground/background testing.
- Do not merge or deploy this draft to production until all approvals and complete end-to-end validation pass.

## Primary source materials

- Beat This! official: https://github.com/CPJKU/beat_this
- MuScriptor 2026: https://github.com/muscriptor/muscriptor
- Audio Separator: https://github.com/nomadkaraoke/python-audio-separator
- Basic Pitch: https://github.com/spotify/basic-pitch
- Essentia KeyExtractor: https://essentia.upf.edu/reference/streaming_KeyExtractor.html
- Essentia license: https://essentia.upf.edu/licensing_information.html
- Supabase PGMQ: https://supabase.com/docs/guides/queues/pgmq
- MIREX key evaluation: https://mir-eval.readthedocs.io/latest/api/key.html
