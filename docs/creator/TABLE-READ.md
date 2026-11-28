# Table Read

A private, script-first read for a scene. The host starts a room, loads the scene and sends each actor a link. Actors open it in the phone's browser, allow the camera and microphone, and read. Everyone stays on the same cue. Small live faces sit beside the script, and each phone records its own full-frame camera and mic, but only after the actor agrees. On Prime the takes are aligned, turned into facial curves and imported into Blender.

Status (2026-11-28): code and tests on branch `claude/ecstatic-bell-ispdcf`. **Not released**: `TABLE_READ_ENABLED="false"`. The two-phone run below used real WebRTC between three separate Chromium browsers with fake cameras on one machine. It has **not** yet run on two physical phones over cellular or Wi-Fi.

## Pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Page | `table-read.html`, `css/table-read.css`, `js/table-read/app.js` | Lobby (host), join (actor), room. Phone first: the large active line, the speaker, the next three lines and markers. Live faces are small movable tiles ("Move faces" or drag). "Hide me" hides only the self-view; the camera and the recording keep running. |
| Clock and alignment maths | `js/table-read/sync.js` | NTP-style offset from the room's pongs (best third by round trip), drift in ppm, sync-cue placement inside a take. |
| Device-local takes | `js/table-read/take-store.js` | Chunks every 1 s into IndexedDB as MediaRecorder hands them over. Covers recovery after a closed tab, export (media + `.take.json` manifest) and delete. Nothing uploads. |
| Room rules | `workers/mccluster/src/table-read/room.js` | One source for both transports: host-only commands, held beats, consent before a take, sync cue, markers, signalling relay (size-capped), signed seat passes (`tr1.<claims>.<HMAC>`). |
| Worker | `routes.js`, `durable.js`, `hub.js` in the same folder | `POST /v1/table-read/rooms` (signed-in member), `POST …/invites` (host pass), `GET …/socket` (pass in `Sec-WebSocket-Protocol`). Durable Object `TableReadRoom` keeps the scene, cue, seats and consent. No media and no recordings. |
| Prime relay | `tools/table-read/relay.mjs` | The same room code with zero dependencies, for offline rehearsal on Prime and for the tests. Binds to 127.0.0.1. |
| Prime: align | `tools/table-read/prime/align_takes.py` | Finds each take's 1 kHz sync beep near its timestamp (falling back to the timestamp), trims heads, measures drift, tempo-corrects above 150 ppm, writes one 48 kHz WAV per role and the shot list (one shot per script line). |
| Prime: face | `tools/table-read/prime/face_curves.py` | MediaPipe Face Landmarker (VIDEO, CPU): 52 blendshapes and head pose per frame. ffmpeg decodes the frames. |
| Prime: Blender | `tools/table-read/prime/blender_table_read.py` | Controls `TR_CTRL.<ROLE>` with every expression as a keyed custom property and head turn as keyed rotation. It drives copies of approved rigs (`--rig ROLE=Object`, matching shape-key names) or labelled stand-ins, adds voice strips and one marker per line bound to the speaker's camera, and renders a 720×1280 H.264/AAC proof. `--patch … --shot line-NNN` re-renders only that shot and splices it in. |

## Privacy and consent

- Joining is not consent. The host asks; each actor sees "Record your take?" and chooses. A take cannot start while a connected actor has not allowed it (`consent_missing`). "Stop recording me" revokes mid-take.
- Recordings stay on the device that made them. They leave only when that person taps **Export** (a file they save) or **Send to host**. Send to host goes peer to peer over the call's data channel, with progress, after a confirmation. The host verifies the SHA-256.
- The Worker and the relay never see media. Invite links carry the pass in the URL fragment, which browsers never send to a server. A pass is bound to one room, one seat, one kind (host or actor) and 12 hours. An actor cannot make itself the host (tested).
- No voice cloning, no face generation and no video-generation models are used.

## Downloads (measured 2026-11-28 from PyPI and Google's model store; Windows x64, Python 3.12)

| Who | What | Size |
| --- | --- | --- |
| Phones | Nothing. The browser asks for the camera and microphone. | 0 |
| Prime, face curves (required) | `mediapipe` 1.2.3 wheel | 25.7 MB |
| | `opencv-contrib-python` 5.1.0.95 (MediaPipe imports it: checked) | 59.3 MB |
| | `numpy` 2.5.5, `matplotlib` 3.11.2, `sounddevice`, `absl-py`, `flatbuffers` | 23.0 MB + small dependencies |
| | `face_landmarker.task` float16 v1 (sha256 `64184e22…bc9ff`) | 3.76 MB |
| Prime, captions or lyric timing (optional) | `faster-whisper` 1.2.1, `ctranslate2` 4.9.1, `av` 19.0.2, `onnxruntime` 1.32.0, `tokenizers`, `huggingface-hub` | ≈ 73 MB |
| | `Systran/faster-whisper-base.en` weights | ≈ 145 MB (not verified: Hugging Face is blocked from the cloud session) |
| Prime, already there | Blender 5.3 (verified on Prime in mcclusterishere/mccluster#871). | 0 |

That comes to about **112 MB** for face tracking and about **220 MB** more for the optional Whisper pass. Skip anything Prime already has. Check with:

```powershell
py -m pip list 2>$null | Select-String "mediapipe|opencv|numpy|faster-whisper|ctranslate2"; ffmpeg -version | Select-Object -First 1; blender --version | Select-Object -First 1
```

## Engines that can take jobs today

McCluster Core's Prime manifest (`core/node-manifests/owner-windows-gpu.json`) registers only `ai.chat` (Ollama `qwen3-vl:8b`, `qwen3:8b`, `qwen3:14b` by tier, `qwen3-vl:4b` on tier D) and `browser.act` (Chromium). The media models Core lists are paid cloud models (fal), which this pass leaves out. Face curves, alignment and Blender run on Prime as the local scripts above, not as Core jobs. Registering them as a Core compute capability is a later step.

## Run it

```bash
node scripts/e2e/table-read.e2e.mjs e2e-out/table-read
```

```bash
cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/table-read.test.mjs
```

```bash
python3 -m unittest scripts/test/test_table_read_align.py
```

On Prime, rehearsing offline: `node tools/table-read/relay.mjs`, then open the printed address. Phones need HTTPS for the camera, so a phone read uses the Worker's rooms (release gates below).

## Results (2026-11-28, cloud session)

- `scripts/e2e/table-read.e2e.mjs`: **36/36**. Three browsers, two of them 390×844 phones, each phone with its own camera picture and tone. Live faces flowed peer to peer both ways, and every screen showed the same line after next, back and goto. "Your line" appeared only on the speaker's phone. The scroll advanced; a held beat stopped it for 3.5 s on both phones, and the host saw who was holding. Pause held the cue. A take was refused before consent and rolled after it. Each phone recorded 1280×720 while its self-view was 72 px wide, and hiding the self-view kept the track live and the recorder recording. Both sync cues and the marker landed in both takes. Phone A exported its take; phone B sent its take to the host (progress shown, checksum verified). A take cut off by closing the page came back from storage (3 chunks, 642 KB). Consent survived the rejoin. Both exports decode at 1280×720. No horizontal scroll at 390 px.
- Worker room and route tests: **10/10**. The full Worker suite: **2,086/2,086**.
- Prime tools: alignment on the real exported takes gave a 60.5 ms head spread and −17.9 ppm drift, using timestamps because the fake microphones carry no beep. On synthetic audio the beep was found within 12 ms, a 400 ms offset trimmed, and 1,000 ppm drift measured and corrected. Face curves: face found in 120/120 frames of a moving test clip, 51 curves plus head pose. Blender 5.3: a 239-frame 720×1280 H.264/AAC proof with stand-ins, voices and three shots. Patching `line-002` from another take re-rendered 52 frames in about 20 s and spliced back to 239 frames; patching twice did not duplicate strips.

## Release gates

1. Set the Worker secret `TABLE_READ_PASS_KEY` (32+ random characters).
2. Choose a TURN relay for phones on cellular or strict NATs. STUN alone (`stun.cloudflare.com`) will fail some of them.
3. Deploy to review with the flag on. Run the two-phone read on two real phones (iOS Safari and Android Chrome), plus a desktop host. Cover headphones, denied permission, a backgrounded tab and a dropped network.
4. After the page is live, capture its host observation (`PLATFORM_HOSTS_LIVE=1 node scripts/e2e/platform-hosts.e2e.mjs --capture-added-page /table-read.html --out scripts/e2e/fixtures/platform-hosts-table-read-<date>.json`) and wire it into `scripts/test/platform-hosts-crawl.test.mjs`. Until then that suite's added-page check fails, by design.
5. Disclose Table Read recording (device-local, peer-to-peer transfer, no server copy) in the privacy policy before switching it on for anyone but the owner.
