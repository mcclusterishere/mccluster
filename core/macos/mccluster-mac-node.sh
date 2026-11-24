#!/bin/bash
# McCluster Core on an Apple Silicon Mac (Shiloh Mac, M1; owner 2026-11-24: "it's apple ... it's m1").
#
# One more owned node in the network (docs/control-plane/MAC-NODE.md): the same node agent, Ollama adapter and
# lyric machine the laptop and the OVH box run, as the signed-in user's LaunchAgents. No Worker, no second backend,
# no Supabase key on the Mac: it enrols with a one-time token and signs every request with its own key.
#
#   bash core/macos/mccluster-mac-node.sh install [--lyrics] [--grant G --org ORG]   set up (--lyrics: the lyric
#        machine's Python; --grant/--org: the one-click opt-in from device.html, no token to paste)
#   bash core/macos/mccluster-mac-node.sh status               what is running and what answers
#   bash core/macos/mccluster-mac-node.sh uninstall            stop and remove the LaunchAgents (keeps the identity)
#   bash core/macos/mccluster-mac-node.sh run agent|adapter|lyrics   what the LaunchAgents start (not for hand use)
#
# What it advertises follows the memory it measures: qwen3-vl:4b resident (vision, fits an 8 GB M1), qwen3:8b on
# demand only with 16 GB or more, and the lyric machine (demucs + faster-whisper + wav2vec2 on the CPU).
set -euo pipefail

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="${MCCLUSTER_NODE_HOME:-$HOME/.mccluster-node}"
AGENTS="$HOME/Library/LaunchAgents"
LABEL=org.mccluster.node
SERVICES=(agent adapter lyrics)
SELF="$CORE_DIR/macos/mccluster-mac-node.sh"

say() { printf '%s\n' "$*"; }
die() { printf 'mccluster-mac-node: %s\n' "$*" >&2; exit 1; }

node_bin() { command -v node || die "Node.js 20 or newer is needed (brew install node)"; }

run() {
  [ -f "$STATE/node.env" ] || die "no $STATE/node.env: run install first"
  set -a; . "$STATE/node.env"; set +a
  cd "$CORE_DIR"
  case "${1:-}" in
    agent)   exec "$(node_bin)" src/compute/node-agent.mjs ;;
    adapter) exec "$(node_bin)" src/compute/ollama-adapter.mjs ;;
    lyrics)  exec "$(node_bin)" src/compute/lyrics-executor.mjs ;;
    *) die "run agent|adapter|lyrics" ;;
  esac
}

plist() { # $1 service
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL.$1</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SELF</string><string>run</string><string>$1</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>MCCLUSTER_NODE_HOME</key><string>$STATE</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$STATE/logs/$1.log</string>
  <key>StandardErrorPath</key><string>$STATE/logs/$1.log</string>
</dict></plist>
EOF
}

install() {
  local lyrics="" grant="" org=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --lyrics) lyrics=1 ;;
      --grant) grant="${2:-}"; shift ;;
      --org) org="${2:-}"; shift ;;
      *) die "unknown option $1" ;;
    esac
    shift
  done
  [ -z "$grant" ] || [[ "$grant" =~ ^mccg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || die "that grant does not look right; opt in again on the website"
  [ -z "$org" ] || [[ "$org" =~ ^[0-9a-fA-F-]{36}$ ]] || die "that organization id does not look right"
  [ "$(uname -s)" = Darwin ] || die "this is the macOS installer"
  [ "$(uname -m)" = arm64 ] || die "Apple Silicon (M1 or later) only"
  local node; node="$(node_bin)"
  "$node" -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)' || die "Node.js 20 or newer is needed"
  command -v ollama >/dev/null || die "Ollama is needed (brew install ollama, or the app from ollama.com), then run this again"
  (cd "$CORE_DIR" && [ -d node_modules ] || npm ci --omit=dev)

  umask 077
  mkdir -p "$STATE/logs" "$AGENTS"
  local bytes gib; bytes="$(sysctl -n hw.memsize)"; gib=$(( bytes / 1073741824 ))
  say "Memory: ${gib} GB unified."

  # the manifest: the template, with qwen3:8b only when there is room for it beside the resident 4b
  "$node" -e '
    const fs = require("fs"), [src, out, gib] = process.argv.slice(1);
    const m = JSON.parse(fs.readFileSync(src, "utf8"));
    if (Number(gib) < 16) m.capabilities = m.capabilities.filter((e) => e.implementation !== "qwen3.8b.local");
    fs.writeFileSync(out, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
    console.log("Advertises: " + m.capabilities.map((e) => e.capability + "/" + e.implementation).join(", "));
  ' "$CORE_DIR/node-manifests/owner-mac-m1.json" "$STATE/capabilities.json" "$gib"

  local extra=""; [ "$gib" -ge 16 ] && extra="qwen3:8b"
  if [ ! -f "$STATE/node.env" ]; then
    cat > "$STATE/node.env" <<EOF
# McCluster node on this Mac. Fill MCCLUSTER_ORG_ID and the one-time MCCLUSTER_NODE_ENROLL_TOKEN (from the owner),
# then: bash core/macos/mccluster-mac-node.sh install. Remove the token once status shows the node enrolled.
MCCLUSTER_COMPUTE_URL=https://compute.mccluster.org
MCCLUSTER_ORG_ID=
MCCLUSTER_NODE_NAME=shiloh-mac
MCCLUSTER_NODE_ENROLL_TOKEN=
MCCLUSTER_NODE_STATE_DIR=$STATE
MCCLUSTER_NODE_MANIFEST=$STATE/capabilities.json
# an owned node polls first (the gateway is first-poller-wins; OVH polls at 5000)
MCCLUSTER_NODE_POLL_MS=1000
MCCLUSTER_OLLAMA_URL=http://127.0.0.1:11434
MCCLUSTER_OLLAMA_ADAPTER_PORT=4790
MCCLUSTER_OLLAMA_MODEL=qwen3-vl:4b
MCCLUSTER_OLLAMA_RESIDENT_MODELS=qwen3-vl:4b
MCCLUSTER_OLLAMA_VISION_MODELS=qwen3-vl:4b
MCCLUSTER_OLLAMA_EXTRA_MODELS=$extra
MCCLUSTER_OLLAMA_ON_DEMAND_KEEP_ALIVE=5m
MCCLUSTER_OLLAMA_WARM_ON_START=true
OLLAMA_KEEP_ALIVE=24h
MCCLUSTER_LYRICS_EXECUTOR_PORT=4792
LYRICS_PYTHON=$STATE/lyrics-venv/bin/python
EOF
    chmod 600 "$STATE/node.env"
    [ -n "$grant" ] || say "Wrote $STATE/node.env: fill MCCLUSTER_ORG_ID and MCCLUSTER_NODE_ENROLL_TOKEN, then run install again (or use the one-click opt-in on device.html)."
  fi

  # the one-click opt-in: the org and a 15-minute, one-use grant go into node.env; the agent enrols with it once
  if [ -n "$grant" ]; then
    "$node" -e '
      const fs = require("fs"), [f, grant, org] = process.argv.slice(1);
      let t = fs.readFileSync(f, "utf8").replace(/^MCCLUSTER_NODE_ENROLL_GRANT=.*\n?/m, "");
      if (org) t = t.replace(/^MCCLUSTER_ORG_ID=.*$/m, "MCCLUSTER_ORG_ID=" + org);
      fs.writeFileSync(f, t.replace(/\n*$/, "\n") + "MCCLUSTER_NODE_ENROLL_GRANT=" + grant + "\n", { mode: 0o600 });
    ' "$STATE/node.env" "$grant" "$org"
  fi

  if [ -n "$lyrics" ]; then
    command -v python3 >/dev/null || die "Python 3.10+ is needed for the lyric machine (brew install python@3.11)"
    command -v ffmpeg >/dev/null || die "ffmpeg is needed for the lyric machine (brew install ffmpeg)"
    [ -x "$STATE/lyrics-venv/bin/python" ] || python3 -m venv "$STATE/lyrics-venv"
    "$STATE/lyrics-venv/bin/python" -m pip install --upgrade pip >/dev/null
    "$STATE/lyrics-venv/bin/python" -m pip install torch torchaudio demucs faster-whisper
    "$STATE/lyrics-venv/bin/python" -c 'import demucs, faster_whisper, torchaudio; print("lyric machine engines: ok")'
  fi

  "$node" -e 'require("fs").readFileSync(process.argv[1], "utf8").match(/^MCCLUSTER_ORG_ID=\S+/m) || process.exit(1)' "$STATE/node.env" \
    || { say "Not starting yet: MCCLUSTER_ORG_ID is empty in $STATE/node.env."; return 0; }

  ollama pull qwen3-vl:4b
  [ -n "$extra" ] && ollama pull "$extra"
  for s in "${SERVICES[@]}"; do
    plist "$s" > "$AGENTS/$LABEL.$s.plist"
    launchctl bootout "gui/$(id -u)/$LABEL.$s" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL.$s.plist"
  done
  say "Started. Check with: bash core/macos/mccluster-mac-node.sh status"
}

status() {
  for s in "${SERVICES[@]}"; do
    if launchctl print "gui/$(id -u)/$LABEL.$s" >/dev/null 2>&1; then say "$s: loaded"; else say "$s: not loaded"; fi
  done
  curl -fsS -m 3 http://127.0.0.1:4790/health >/dev/null 2>&1 && say "adapter: answers" || say "adapter: no answer"
  curl -fsS -m 3 "http://127.0.0.1:4790/ready?implementation=qwen3-vl.4b.local" >/dev/null 2>&1 && say "qwen3-vl:4b: ready" || say "qwen3-vl:4b: not ready"
  curl -fsS -m 25 http://127.0.0.1:4792/ready >/dev/null 2>&1 && say "lyric machine: ready" || say "lyric machine: not ready (install --lyrics)"
  [ -f "$STATE/logs/agent.log" ] && { say "last agent events:"; tail -n 5 "$STATE/logs/agent.log"; } || true
}

uninstall() {
  for s in "${SERVICES[@]}"; do
    launchctl bootout "gui/$(id -u)/$LABEL.$s" 2>/dev/null || true
    rm -f "$AGENTS/$LABEL.$s.plist"
  done
  say "Stopped. The node identity stays in $STATE (delete that folder to forget it)."
}

case "${1:-}" in
  install) shift; install "$@" ;;
  status) status ;;
  uninstall) uninstall ;;
  run) shift; run "$@" ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
