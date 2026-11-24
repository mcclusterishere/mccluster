# Mac node (Shiloh Mac, M1)

Owner, 2026-11-24: Shiloh **Mac** (not "Max"), "it's apple ... it's m1". It is one more owned member of the node
network that McCluster Core is (owned hardware first; the OVH box is the paid, always-on member). Same runtime as
every node: the node agent, the Ollama adapter and the lyric machine. No Worker, no second backend, and no Supabase
key on the Mac: it enrols once with a one-time token and signs every request with its own Ed25519 key.

| Piece | Source | Where it runs |
| --- | --- | --- |
| Node agent | `core/src/compute/node-agent.mjs` | LaunchAgent `org.mccluster.node.agent`, polls every 1000 ms (owned first; OVH polls at 5000) |
| Ollama adapter | `core/src/compute/ollama-adapter.mjs` | LaunchAgent `org.mccluster.node.adapter`, `127.0.0.1:4790`, Metal through Ollama |
| Lyric machine | `core/src/compute/lyrics-executor.mjs` | LaunchAgent `org.mccluster.node.lyrics`, `127.0.0.1:4792`, demucs + faster-whisper + wav2vec2 on the CPU |
| Manifest | `core/node-manifests/owner-mac-m1.json` | `~/.mccluster-node/capabilities.json` |

What it advertises follows the memory the installer measures (`sysctl hw.memsize`):

- `ai.chat/qwen3-vl.4b.local`: resident, with vision. Fits an 8 GB M1.
- `ai.chat/qwen3.8b.local`: on demand, **only with 16 GB or more** (pruned otherwise).
- `lyrics.align/lyrics.machine.local`: uploaded releases get timed here instead of waiting on OVH
  (`core/src/compute/lyrics-node.mjs` offloads to any live node with it, OVH excluded).

The entries are the laptop's, byte for byte, so a task is claimable on whichever node polls first
(`scripts/test/node-manifests-mac.test.mjs`).

## Setup on the Mac

1. Install Homebrew tools: `brew install node ollama` (for the lyric machine also `brew install python@3.11 ffmpeg`),
   and start Ollama.
2. Clone this repository and run `bash core/macos/mccluster-mac-node.sh install --lyrics`.
   The first run writes `~/.mccluster-node/node.env` (mode 600) and stops.
3. The owner fills `MCCLUSTER_ORG_ID` and a one-time `MCCLUSTER_NODE_ENROLL_TOKEN` in that file, then runs
   `install` again: it pulls the models and starts the three LaunchAgents.
4. `bash core/macos/mccluster-mac-node.sh status` shows what is loaded and what answers. Once the agent log shows the
   node enrolled, delete the token line.

`uninstall` stops and removes the LaunchAgents and keeps the node identity in `~/.mccluster-node`.

The Mac sleeps: while it sleeps it is simply not live, and the network routes around it. Keep it plugged in and set
"Prevent automatic sleeping when the display is off" if it should take work overnight.

## One click instead (2026-11-24)

Owner: "I should be able to opt the Mac in by logging into the Mac on the website and just clicking the opt-in
button." On the Mac, sign in as the owner at `device.html` and tap **Get the install command**: it is the two lines
above with the org and a one-time pass already in them (`--org … --grant …`), so there is nothing to paste into
`node.env`. The pass is good for 15 minutes and enrols one device. Any device, phones included, can also tap
**Opt this device in** to join from the page itself. How it works: `DEVICE-OPT-IN.md`.
