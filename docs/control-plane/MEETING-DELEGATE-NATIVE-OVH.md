# McCluster Meeting Delegate: Native OVH Target

Status: target architecture for the first owned deployment.

## Decision

The production target is **native Linux process mode on the OVH VPS**.

Docker, Kubernetes, Vexa-hosted APIs, hosted transcription, hosted LLM inference, and a second agent control plane are not architectural requirements.

The meeting transport may reuse Apache-2.0 Vexa source, pinned and modified under McCluster control, but McCluster remains the product and authority.

## What we keep from upstream

Use the smallest useful subset of the audited Vexa source:

1. meeting join/browser modules
   - Google Meet
   - Microsoft Teams
   - Zoom
   - Jitsi fallback
2. remote-browser/session modules
3. meeting bot worker
4. meeting API lifecycle and transcript collector
5. runtime process backend
6. transcript contracts / lifecycle contracts
7. local Faster Whisper transcription service
8. the Redis/Valkey command and transcript streams required by the meeting worker

## What we do not need

Do not deploy Vexa's separate AI/agent product surface.

McCluster already owns these responsibilities:

- AI reasoning: OVH Ollama / Qwen
- autonomous work queue: `ops_agent_jobs`
- scheduling: `ops_agent_jobs.run_after`
- canonical persistence: Supabase
- CRM / relationships: McCluster Work
- approval policy: McCluster control plane
- user/operator UI: Control Room
- code execution / repo workflows: McCluster Core

Therefore the first native deployment does **not** need:

- Vexa agent API
- Vexa agent worker
- Vexa terminal UI
- Vexa dashboard as an operator surface
- Anthropic / Claude runtime credentials
- Vexa hosted transcription
- Vexa hosted inference

## Native process topology

Everything is private/loopback except the outbound browser session that joins the meeting.

```
                           Google Meet / Zoom / Teams
                                     ^
                                     |
                              Chromium / Playwright
                                     |
                          McCluster meeting bot worker
                                     |
                    +----------------+----------------+
                    |                                 |
               PulseAudio                        transcript stream
               Xvfb/fluxbox                          |
                    |                                 v
                    |                          Valkey / Redis
                    |                                 |
                    |                        meeting-api collector
                    |                                 |
                    +-------------------+-------------+
                                        |
                                        v
                              McCluster Core adapter
                                        |
             +--------------------------+--------------------------+
             |                          |                          |
       ops_agent_jobs              Supabase session           Ollama/Qwen
       run_after scheduler          + event ledger             debrief
```

## Host services

### Existing McCluster services

Keep existing services unchanged:

- McCluster Core runner
- McCluster tool broker
- Ollama
- compute-node agent
- existing Cloudflare private ingress/tunnel as appropriate

### New meeting services

The native target adds:

1. **PostgreSQL backing for the extracted upstream meeting service**
   - Bind localhost only.
   - This is an implementation database, not McCluster durable truth.
   - Only minimum Vexa lifecycle state belongs here.

2. **Valkey or Redis**
   - Bind localhost only.
   - Used for runtime lifecycle, transcript streams, and the bot command bus.
   - Append-only persistence is optional for v1 because canonical outcomes live in Supabase, but restart behavior must be tested.

3. **Xvfb**
   - Virtual display for Chromium.

4. **Fluxbox**
   - Minimal X window manager required by the browser runtime.

5. **PulseAudio**
   - Meeting audio capture.
   - Create the upstream-compatible `tts_sink` and `virtual_mic`.
   - Keep both muted by default.
   - Speaking must explicitly unmute only during generated speech.

6. **Chromium + Playwright dependencies**
   - Headful browser under Xvfb.
   - Persistent profiles stored in a root-controlled meeting-engine directory.
   - Never share a browser auth profile with unrelated workloads.

7. **Meeting runtime kernel**
   - `RUNTIME_BACKEND=process`.
   - Bot workloads are child process groups.
   - The runtime is responsible for graceful termination and orphan cleanup.

8. **Meeting API**
   - Loopback only.
   - Spawns bots through the process runtime.
   - Reads lifecycle and transcript streams.
   - Core reaches this through the McCluster-owned adapter.

9. **Local transcription service**
   - Faster Whisper behind an OpenAI-compatible `/v1/audio/transcriptions` endpoint.
   - Start CPU-only.
   - Upgrade model/device independently when a suitable GPU becomes available.
   - No hosted STT is required.

## Resource assumptions

Upstream's conservative meeting-bot guidance is approximately one CPU core and 2 GB RAM per active Chromium meeting bot.

The current OVH node can therefore support an initial single-call deployment comfortably, but concurrency must be measured rather than guessed.

Initial production policy:

- maximum concurrent meeting bots: 1
- one shared transcription worker
- no simultaneous voice generation until audio-loop testing passes
- reject or queue overlapping delegated meetings instead of oversubscribing the VPS

Raise concurrency only after measuring:

- Chromium CPU
- Chromium RSS
- Faster Whisper CPU/RAM
- transcript latency
- Qwen debrief latency
- event-loop / Core runner impact

## Networking

No new public service port is required.

Required bindings should be loopback or private only:

- meeting API: localhost
- runtime: localhost
- Redis/Valkey: localhost
- meeting PostgreSQL: localhost
- transcription: localhost
- X11/VNC debug: disabled by default

The meeting bot itself makes normal outbound HTTPS/WebRTC connections to the meeting provider.

If remote debugging is temporarily required, expose it through an authenticated private tunnel and remove it after diagnosis.

## Authentication

Core owns the server-to-server credential.

```
MCCLUSTER_MEETING_ENGINE_URL=http://127.0.0.1:<owned-port>
MCCLUSTER_MEETING_ENGINE_API_KEY=<random server-side token>
MCCLUSTER_MEETING_TARGET_KEY=<independent long random AES source secret>
```

Do not reuse:

- Supabase service role
- Core broker bearer
- Cloudflare signing key
- meeting-engine API key
- target-encryption key

Each trust boundary gets a separate credential.

## Meeting account strategy

Anonymous guest joins may be enough for some external calls but cannot be the only production assumption.

Create a dedicated meeting identity such as:

**McCluster AI Delegate**

The identity must be used only for delegated meeting attendance.

Where platform policy permits, maintain authenticated browser state in a dedicated persistent Chromium profile owned by the meeting service account.

Do not log into the meeting bot with Matthew's primary personal browser profile.

## Disclosure

The participant identity itself is disclosure:

- `McCluster AI Notes for Matthew`
- `McCluster AI Delegate for Matthew`
- `McCluster AI Observer for Matthew`

If chat controls are live, delegate mode sends an opening disclosure.

If voice controls are live, the first spoken contribution must identify the system as an AI delegate.

Recording remains off by default.

Transcription remains policy-gated.

## First production milestone

The first milestone is deliberately not a vendor call.

Create a disposable Google Meet and prove:

1. Core schedules a future `meeting_delegate_dispatch` job.
2. The encrypted target in `ops_agent_jobs` contains no reusable meeting URL or passcode.
3. Runtime launches a Chromium bot under process mode.
4. Bot appears with the disclosed McCluster AI identity.
5. A human admits the bot.
6. Local audio reaches Faster Whisper.
7. Speaker-attributed transcript becomes readable by the meeting API.
8. Post-meeting collection retrieves it.
9. Local Qwen generates the debrief.
10. Supabase stores the session summary.
11. No browser, X11, audio, or worker processes remain after teardown.

Only after that passes do we test a real low-risk business call.

## Voice milestone

Voice is a separate acceptance gate.

Before enabling `MCCLUSTER_MEETING_INTERACTIVE=1`:

1. prove chat read/write;
2. prove no echo loop with the virtual microphone muted at rest;
3. synthesize a short test utterance;
4. verify only the intended audio enters the meeting;
5. prove immediate `speak_stop`;
6. prove the bot returns to a muted microphone state;
7. prove the model cannot speak outside the approved delegate policy;
8. prove external participants can distinguish the AI from Matthew.

## Source ownership

The audited bootstrap source is:

`Vexa-ai/vexa-core@37a920cd05116d6919186b0b9b4d564247d0e929`

License: Apache-2.0.

The McCluster working copy keeps an `upstream` remote for security/reliability updates and a McCluster-owned branch for modifications.

Long term, the preferred direction is to extract the browser/join/transcript implementation into a smaller McCluster meeting-engine repository rather than carrying upstream agent/dashboard domains forever.

## Replacement path

Because McCluster calls stable capability contracts, the implementation can evolve without changing Control Room or autonomous workflows.

Future bindings can include:

- extracted McCluster browser bot
- Google Meet native media driver when broadly usable
- Zoom native SDK driver
- Microsoft Teams media/calling driver
- a secondary hosted emergency fallback

Self-hosted remains routing priority 1.
