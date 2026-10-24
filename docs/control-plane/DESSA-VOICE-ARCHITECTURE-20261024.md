# McCluster realtime voice — Dessa readiness architecture (2026-10-24)

## Research status and what is NOT available

Dessa is the speech-native full-duplex conversational AI research project announced by Block on October 23, 2026. Public descriptions emphasize simultaneous listening/speaking, turn-taking and interruption handling without a conventional ASR → text LLM → TTS cascade. No public, officially supported Dessa inference endpoint, API schema, WebSocket protocol, licensed model weights, distributable runtime or exact layer-by-layer model specification was available on October 24. Treat it as **research only**. The provider entry `dessa` always reports `awaiting_official_release` and never claims to execute. Do not reverse engineer, scrape an unofficial demo, or market Kyutai Moshi as Dessa.

Source references: Block's October 23 announcement; public summaries of the Dessa research launch; Kyutai's independently released Moshi code and documented WebSocket inference server: https://github.com/kyutai-labs/moshi and https://github.com/kyutai-labs/moshi/blob/main/moshi/moshi/server.py . Kyutai server exposes `GET /api/chat` as a binary WebSocket. Kyutai is not affiliated with Block's Dessa release.

## Architecture

```text
Mobile browser / desktop browser (owner, explicit mic grant)
    |
    | POST https://api.mccluster.org/v1/voice/sessions
    | user Authorization Bearer; exact Origin allowlist
    v
Existing Worker "mccluster" (workers/mccluster/src/entry-platform.js)
    | bearerUser() -> canonical Supabase Auth
    | isHouseOwner() -> house org membership (Supabase)
    | mint HMAC-SHA256 30-second origin-bound upgrade ticket
    |
    | browser connects new WebSocket(endpoint, protocols)
    v
wss://api.mccluster.org/v1/voice/stream
    | validate WSS upgrade + origin + ticket + explicit feature flag
    | do not log, persist, decode, or transcribe speech frames
    | discard browser bearer, cookies and ticket before next hop
    v
Owned first-party TLS/WSS gateway (*.mccluster.org/api/chat)
    | Bearer VOICE_MOSHI_GATEWAY_TOKEN from Worker only
    | gateway authenticates and STRIPS token before Moshi
    | reverse tunnel privately to compute node; redirect disabled
    v
OVH-managed GPU compute workload / Kyutai Moshi
    | full-duplex native audio binary framing (Kyutai protocol)
    | binary speech replies through the same WSS stream
    v
Browser with Kyutai-compatible audio codec/playback
```

There is **one control plane**: GitHub `mcclusterishere/mccluster`, Cloudflare Worker `mccluster` on `api.mccluster.org`, canonical Supabase project `zmnhbrjyhxzhkxmhkexs`, and persistent OVH McCluster Core/compute nodes. This implementation adds a Worker handler, not another Worker, database, user identity, conversation log, or subscription. Preserve `HereTenantAgent` export. All model naming is internal: the resident assistant remains **McCluster AI**.

## Provider design

- `speech.converse.full_duplex` is a McCluster-owned semantic capability. Do not put model/vendor names in user-facing capability IDs.
- `dessa`: reserved provider ID, `executable:false`. Add a real provider-specific adapter only after obtaining Block's interface or licensed weights, verifying streaming audio input/output, timing protocol, model quality, safety and commercial rights. Its presumed wire format is **not** Moshi's.
- `moshi`: optional self-hosted reference implementation. GPU hardware and actual inference runtime must be available before configuration. A typical reference environment needs substantial VRAM (check the specific model's exact requirements); the present OVH CPU/GPU inventory has not been validated by this PR.
- Existing `/v1/mnet/audio` and Cloudflare SFU audio rooms are social communications; they must not be confused with speech-model inference. No live-room audio is captured by this feature.
- Raw audio is ephemeral on the streaming path. No recordings, transcripts, embeddings, per-user voiceprints or derived memories are written by this change. McCluster's private `ai_context` remains the single future context plane. Tool calls, memory extraction and voice activation need separate consent, design and logging controls.

## Route contract (OFF unless explicitly enabled)

`GET /v1/voice/status`:
- Header: signed-in owner's Authorization Bearer + allowlisted Origin.
- Returns provider states, capability ID, and privacy note; no model or signing credentials. All other user roles get 403; unauthenticated get 401.

`POST /v1/voice/sessions`:
- Owner bearer + allowlisted Origin, JSON `{"provider":"moshi"}`.
- Returns 201 `{"endpoint":"wss://api.mccluster.org/v1/voice/stream","protocols":["mcv1.…"],"expires_in_seconds":30,"audio_frame_protocol":"kyutai-moshi-api-chat","recording":false}`.
- Browser passes ticket in `Sec-WebSocket-Protocol` through the standard `new WebSocket(endpoint, protocols)` constructor. Do **not** place bearer or ticket into the URL.
- `{"provider":"dessa"}` always returns 503 with `awaiting_official_release`. Unknown providers 400. Backend not configured 503.

`GET /v1/voice/stream`:
- WebSocket Upgrade, exact allowlisted Origin, valid signed ticket, matching audience/provider/issued/expires attributes. No user Authorization header required for the upgrade; short-lived ticket was minted only after checking the owner role.
- Forwards an opaque WSS stream to a **fixed, operator-configured, first-party** TLS endpoint `wss://<subdomain>.mccluster.org/api/chat`. Never accepts caller-supplied upstream URLs.
- Returns 401/403/426/502/503 on failed tickets, origin, upgrade, inference gateway or configuration, never upstream error bodies or tokens.

Security limit: Ticket is HMAC-signed and origin-bound with a **30-second connection initiation window**, but is **not single-use**. Before enabling public/member voice, implement atomic ticket consumption in an approved shared store (not an in-memory Map) and stronger replay defenses. Revoked owner roles can still use already-issued tickets until they expire. The private gateway **must verify and strip** `VOICE_MOSHI_GATEWAY_TOKEN`; Kyutai's original bare Moshi server does not understand that McCluster-specific token. Without the gateway, do not activate.

## Configuration (no production secrets in Git)

| Variable | Source | Purpose |
| --- | --- | --- |
| `VOICE_CONVERSATION_ENABLED` | Worker var | Exact literal `true` only; missing/false fail-closed |
| `VOICE_SESSION_SIGNING_KEY` | Worker secret | Random 32+ characters used for HMAC; rotate to revoke tickets |
| `VOICE_MOSHI_WS_URL` | Worker secret/var | Exact `wss://<owned-subdomain>.mccluster.org/api/chat` |
| `VOICE_MOSHI_GATEWAY_TOKEN` | Worker secret and private reverse proxy | Independent 32+ character gateway bearer, stripped upstream |

`wss://voice.mccluster.org/api/chat` in tests is **an illustrative URL, not an assertion DNS, reverse tunnel or inference service exists**. No credential is generated or installed by this PR. Native model traffic requires a streaming-compatible browser client for Kyutai's audio framing and opus handling; `MediaRecorder` chunks or raw PCM are not interchangeable with the Moshi binary protocol.

## Rollout steps and acceptance gates

1. Assess OVH/Core compute inventory and pick an adequately provisioned GPU node; document model weights/versions, licensing, VRAM, inference latency and safety settings.
2. Deploy Moshi behind a private HTTPS/WSS gateway controlled by McCluster, secured with the shared dedicated gateway token, TLS, network restrictions, limited active sessions and timeouts. Never expose an unauthenticated Moshi `/api/chat` publicly.
3. Smoke test microphone permission, full-duplex packet framing, codec encode/decode, interruption, barge-in, audio playout, concurrent session termination and browser suspend/resume using Kyutai's compatible browser client.
4. Set all Worker secrets and first-party WSS endpoint. Activate only after security test by setting `VOICE_CONVERSATION_ENABLED=true`; otherwise all inference calls fail closed.
5. Verify owner-only CORS and signed-ticket negative tests, a successful live WebSocket 101 and streaming quality measurements (not just a status response).
6. Add a dedicated owner-only Control Room client following existing shared navigation conventions. This PR does **not** install a mic UI, change the live owner desk, launch a GPU server, or claim full voice calls are already functional.
7. After Block publishes officially supported Dessa integration material, add its protocol-specific adapter under the same stable capability and update release/legality checks; do **not** merely rename Moshi.

Automated contract: `node --test workers/mccluster/test/dessa-voice.test.mjs`. Full Worker regression: `cd workers/mccluster && npm test`. Tests use a mocked authenticated GPU gateway; passing them does not certify production connectivity. Never merge or deploy until normal CI, edge auth and operator approval pass.
