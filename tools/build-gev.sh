#!/usr/bin/env bash
set -euo pipefail

UPSTREAM="https://github.com/bilawalsidhu/gods-eye-view.git"
COMMIT="759652207fd1279ece97f0f19af566feb9a82146"
PROXY="https://zmnhbrjyhxzhkxmhkexs.supabase.co/functions/v1/gev-proxy"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inptbmhicmp5aHh6aGt4bWhrZXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMTQ3MTMsImV4cCI6MjA5OTc5MDcxM30.guqcG26tPMCeXrFQ91PWNKoXdNFa1C3C9GUzneyWdFk"
ROOT="$(pwd)"
WORK="$ROOT/.gev-upstream"

rm -rf "$WORK" "$ROOT/gev"
mkdir -p "$WORK"
git -C "$WORK" init
git -C "$WORK" remote add origin "$UPSTREAM"
git -C "$WORK" fetch --depth 1 origin "$COMMIT"
git -C "$WORK" checkout --detach FETCH_HEAD

PROXY="$PROXY" ANON="$ANON" python3 - <<'PY'
from pathlib import Path
import os

root = Path('.gev-upstream')
proxy = os.environ['PROXY']
anon = os.environ['ANON']

main = root / 'src' / 'main.js'
s = main.read_text()
old = """    const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;\n    const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;\n    if (googleApiKey) window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;"""
new = """    const mcRuntime = await (window.__MCCLUSTER_GEV_RUNTIME_CONFIG__ || Promise.resolve({}));\n    const cesiumToken = mcRuntime.cesiumIonToken || import.meta.env.CESIUM_ION_TOKEN || '';\n    const googleApiKey = mcRuntime.googleMapsApiKey || import.meta.env.GOOGLE_MAPS_API_KEY || '';\n    if (googleApiKey) window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;"""
if old not in s:
    raise SystemExit('GEV credential bootstrap signature changed upstream; refusing silent patch')
main.write_text(s.replace(old, new, 1))

html = root / 'index.html'
h = html.read_text()
runtime = f'''<script>\n(() => {{\n  const endpoint = {proxy!r};\n  const anon = {anon!r};\n  const nativeFetch = window.fetch.bind(window);\n  const authHeaders = (seed) => {{\n    const headers = new Headers(seed || {{}});\n    headers.set('authorization', 'Bearer ' + anon);\n    headers.set('apikey', anon);\n    return headers;\n  }};\n  window.__MCCLUSTER_GEV_RUNTIME_CONFIG__ = nativeFetch(endpoint + '?path=runtime-config', {{ headers: authHeaders() }})\n    .then(r => r.ok ? r.json() : {{}}).catch(() => ({{}}));\n  window.fetch = (input, init = undefined) => {{\n    const raw = typeof input === 'string' ? input : (input instanceof URL ? input.href : input?.url);\n    if (raw) {{\n      const source = new URL(raw, window.location.href);\n      if (source.origin === window.location.origin && source.pathname.startsWith('/api/')) {{\n        const target = new URL(endpoint);\n        target.searchParams.set('path', source.pathname.slice(5));\n        source.searchParams.forEach((value, key) => target.searchParams.append(key, value));\n        const next = {{ ...(init || {{}}), headers: authHeaders(init?.headers || (input instanceof Request ? input.headers : undefined)) }};\n        if (input instanceof Request && init === undefined) {{\n          next.method = input.method;\n          if (!['GET','HEAD'].includes(input.method)) next.body = input.body;\n          next.signal = input.signal;\n        }}\n        return nativeFetch(target.toString(), next);\n      }}\n    }}\n    return nativeFetch(input, init);\n  }};\n}})();\n</script>\n'''
if '</head>' not in h:
    raise SystemExit('GEV index head signature changed upstream')
h = h.replace('</head>', runtime + '</head>', 1)
html.write_text(h)
PY

cd "$WORK"
npm ci --no-audit --no-fund
npm run build -- --base=/gev/

cd "$ROOT"
cp -R "$WORK/dist" "$ROOT/gev"
# Upstream currently uses absolute /models/*.glb references for aircraft.
# Mirror only that attribution-preserving public model directory at site root.
if [ -d "$ROOT/gev/models" ]; then
  rm -rf "$ROOT/models"
  cp -R "$ROOT/gev/models" "$ROOT/models"
fi
cat > "$ROOT/gev/MCCluster-GEV-source.txt" <<EOF
God's Eye View upstream: $UPSTREAM
Pinned commit: $COMMIT
Hosted integration: McCluster
Provider attribution and third-party data terms remain those of the upstream project.
EOF
rm -rf "$WORK"

echo "Built hosted GEV at /gev from $COMMIT"
