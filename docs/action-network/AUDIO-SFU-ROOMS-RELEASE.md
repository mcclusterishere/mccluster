# Equity Uprise audio-only rooms — Cloudflare Realtime SFU

**19 October 2026 · Security-reviewed implementation candidate · NOT RELEASED**

This audio lane uses Cloudflare **Realtime SFU** and is separate from the existing single-host **Cloudflare Stream** WHIP/WHEP live-video lane. It is not a second social graph, not a private-message replacement, and is never represented as a video call. Audio is never recorded, transcribed, or automatically captured by this client.

## Source of truth

- `workers/mccluster/src/audio-sfu-rooms.js`: member-authenticated, service-role-projected API. App credentials only in Worker secrets. Browser exchanges authorized SDP, **never** sees SFU App Secret, publication session ID, or raw service-role response.
- `js/mnet-audio.js`: hidden unless `GET /v1/mnet/audio/status` reports `enabled:true`; listener receives tracks without a mic request. `getUserMedia({audio:true,video:false})` only in a direct Speak button handler. Stop local tracks on mute, leave, and pagehide. `css/mnet-audio.css` extends the existing Live section without replacing it.
- `supabase/pending/20261019235000_network_sfu_audio_rooms.sql`: service-only room/member/subscriber tables with RLS and no browser grants, atomic join and speaker-assignment RPCs.
- `AUDIO_SFU_ROOMS_ENABLED="false"` in Wrangler until production readiness. No recording/transcription providers, no hidden automatic streams.

## Access and region

Hosts must have an **active MNet live-host cohort, staff, or client-project grant** in an authorized category. Anyone may discover the title of a public live audio room. **Only signed-in linked McCluster members** can join. Host controls speaking permissions. Joining is a listening-only action, not microphone consent. Country code is optional, chosen by the host, not inferred from member IP or exact location. Country filters use ISO 3166-1.

Membership has three distinct roles: host, speaker, listener. The backend validates the role on every publishing attempt. Cloudflare owns the WebRTC media plane; Supabase holds authoritative membership and room state. Non-hosts cannot promote, kick, or end the room. Kicked identities are rejected on atomic rejoin. Audio teardown uses the SFU `tracks/close` forced path, including receiver sessions.

## Release gates — all mandatory

1. **Consent**: merge the current policy-acknowledgement update (#545) and verify a member reacknowledges after the October 19 notice. Before switch-on, amend the policy's 'audio rooms not currently switched on' future-language to an accurate active service disclosure, with explicit listener/speaker audiences, no-recording default, retention for metadata, and escalation path. Then bump the notice version again if the disclosed processing has materially changed.
2. **Database**: review and apply the exact pending migration in the production ledger through authorized Supabase; test anon/authenticated RLS is denied, service role is allowed, join capacity is transactional, kicks cannot rejoin, and concurrent speaker grants never exceed the stage cap. Backups and rollback policy required. No schema write on a PR merge.
3. **Provider**: create a Cloudflare Realtime SFU app (currently no app in the connected Cloudflare account). Add `AUDIO_SFU_APP_ID` and `AUDIO_SFU_APP_SECRET` as **Worker secrets**, not in source or browser. Check billing, quotas, API limits, TURN/NAT scenarios. Do not confuse this with Stream credentials.
4. **Moderation and recovery**: complete a reliable admin kill switch and report-review queue, durable rate limits, abandoned-session reaper, forced close on kicks/mutes/end, session recovery on network loss, and provider error-state handling. Confirm zero unmoderated speaking and no continued audio after kicks. Flag-off stops new calls, **not existing SFU connections**; provider cleanup is a separate requirement.
5. **End-to-end**: two iPhones and desktop in same room; host plus 3 speakers; listeners; device permission denial; headphone routing; iOS autoplay recovery; tab suspension; forced logout; blocked users; concurrent joins; unknown country; empty directories; WAN drop/reconnect; App Secret isolation; all CI green.
6. **Release**: deploy Worker behind disabled flag, validate current migrations and provider secrets, enable only through an approved rollout, smoke test production, and monitor anonymous access and error budgets. Roll back by disabling the flag **and explicitly closing any live provider tracks**.

**Unresolved before release:** report workflow, operator emergency stop, durable rate/cap limits, device/WebRTC end-to-end verification, and cost ceiling. Do not interpret green unit tests or source files as a production voice product.
