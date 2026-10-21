# Equity Uprise audio-only rooms — Cloudflare Realtime SFU

**19 October 2026 · Security-reviewed implementation candidate · NOT RELEASED**

This audio lane uses Cloudflare **Realtime SFU** and is separate from the existing single-host **Cloudflare Stream** WHIP/WHEP live-video lane. It is not a second social graph, not a private-message replacement, and is never represented as a video call. Audio is never recorded, transcribed, or automatically captured by this client.

## Source of truth

- `workers/mccluster/src/audio-sfu-rooms.js`: member-authenticated, service-role-projected API. App credentials only in Worker secrets. Browser exchanges authorized SDP, **never** sees SFU App Secret, publication session ID, or raw service-role response.
- `js/mnet-audio.js`: hidden unless `GET /v1/mnet/audio/status` reports `enabled:true`; listener receives tracks without a mic request. `getUserMedia({audio:true,video:false})` only in a direct Speak button handler. Stop local tracks on mute, leave, and pagehide. `css/mnet-audio.css` extends the existing Live section without replacing it.
- `supabase/pending/20261019235000_network_sfu_audio_rooms.sql`: service-only room/member/subscriber tables with RLS and no browser grants, atomic join and speaker-assignment RPCs.
- `AUDIO_SFU_ROOMS_ENABLED="false"` in Wrangler until production readiness. No recording/transcription providers, no hidden automatic streams.

## Access and region

Hosts must have an **active MNet live-host cohort, staff, or client-project grant** in an authorized category. A room belongs to a country: the one the host picks, else the country Cloudflare reads from the host's connection; "Everywhere" rooms are members only. Country codes are ISO 3166-1.

**Signed-in members** can join any room in any region (owner, 2026-10-20: region hopping is for members). They listen, raise a hand, and speak when the host invites them. Joining is a listening-only action, not microphone consent.

**Signed-out visitors** (owner, 2026-10-20) can see every live room worldwide, with its host's display name and how many are speaking and listening. They can **listen** only to a room in the country Cloudflare reads from their own connection (`request.cf.country`; never a header, query or body the browser sets), and only when the host left "Let people there listen before they sign in" on. Anything else (another region, raising a hand, speaking, hosting) answers "Sign in…". The Worker gives the visitor a pass signed with `AUDIO_ROOM_PASS_KEY`, bound to one room, one seat and that country, lasting four hours, and re-reads the connection country on every call: a visitor whose connection moves to another country is asked to sign in. A visitor seat stores no account, IP or country, is deleted when they leave, and lapses two minutes after the browser stops checking in. Visitors may hold at most half of a room's seats, so members can always get in. Unknown countries (XX, T1, local development) get no visitor seat. A VPN can move a visitor's country: the lock is the owner's regional scope, not identity.

**Who sees whom.** People in a room see the stage (host and speakers) by public display name and avatar, and listeners only as a number. Only the host sees raised hands, by display name, to invite or remove. Every seat has an opaque `participant_id`; member ids (`m_uid`) never leave the Worker. Membership has three roles: host, speaker, listener; the backend validates the role on every publishing attempt, and a newly invited speaker starts muted until their own Speak tap. Non-hosts cannot promote, kick, or end the room. Kicked members are rejected on atomic rejoin; a removed visitor's seat is deleted. Audio teardown uses the SFU `tracks/close` forced path, including receiver sessions.

Flags: `AUDIO_SFU_ROOMS_ENABLED` (rooms at all) and `AUDIO_ROOMS_VISITOR_LISTEN_ENABLED` plus the secret `AUDIO_ROOM_PASS_KEY` (visitor listening). Both default to `"false"`.

Tests: `workers/mccluster/test/audio-sfu-rooms.test.mjs` (Worker, including the visitor region lock, pass tampering and expiry, and the no-`m_uid` projections) and `scripts/test/audio-rooms-db.mjs` (the pending SQL in PGlite: seats, the visitor lock and half-room cap, the stage cap, kicked members, browser roles refused; run with `PGLITE_DIR=<dir with @electric-sql/pglite> node scripts/test/audio-rooms-db.mjs`; it is not yet wired into a CI lane, which needs a workflow edit for review).

## Release gates — all mandatory

1. **Consent**: merge the current policy-acknowledgement update (#545) and verify a member reacknowledges after the October 19 notice. Before switch-on, amend the policy's 'audio rooms not currently switched on' future-language to an accurate active service disclosure, with explicit listener/speaker audiences, no-recording default, retention for metadata, and escalation path. Before visitor listening, the policy must also say that a signed-out listener's connection country (read by Cloudflare, not stored) decides which rooms they can hear, and that their seat keeps nothing once they leave. Then bump the notice version again if the disclosed processing has materially changed.
2. **Database**: review and apply the exact pending migration in the production ledger through authorized Supabase; test anon/authenticated RLS is denied, service role is allowed, join capacity is transactional, kicks cannot rejoin, and concurrent speaker grants never exceed the stage cap. Backups and rollback policy required. No schema write on a PR merge.
3. **Provider**: create a Cloudflare Realtime SFU app (currently no app in the connected Cloudflare account). Add `AUDIO_SFU_APP_ID` and `AUDIO_SFU_APP_SECRET` as **Worker secrets**, not in source or browser. For visitor listening, add `AUDIO_ROOM_PASS_KEY` (32+ random characters) as a Worker secret too. Check billing, quotas, API limits, TURN/NAT scenarios. Do not confuse this with Stream credentials.
4. **Moderation and recovery**: complete a reliable admin kill switch and report-review queue, durable rate limits, abandoned-session reaper, forced close on kicks/mutes/end, session recovery on network loss, and provider error-state handling. Confirm zero unmoderated speaking and no continued audio after kicks. Flag-off stops new calls, **not existing SFU connections**; provider cleanup is a separate requirement.
5. **End-to-end**: two iPhones and desktop in same room; host plus 3 speakers; listeners; device permission denial; headphone routing; iOS autoplay recovery; tab suspension; forced logout; blocked users; concurrent joins; unknown country; empty directories; WAN drop/reconnect; App Secret isolation; all CI green.
6. **Release**: deploy Worker behind disabled flag, validate current migrations and provider secrets, enable only through an approved rollout, smoke test production, and monitor anonymous access and error budgets. Roll back by disabling the flag **and explicitly closing any live provider tracks**.

**Unresolved before release:** report workflow, operator emergency stop, durable rate/cap limits, device/WebRTC end-to-end verification, and cost ceiling. Do not interpret green unit tests or source files as a production voice product.
