import { corsHeaders } from '../lib/http.js';

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>McCluster spatial plane</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist/maplibre-gl.css" />
  <style>
    :root { color-scheme: dark; --bg:#07090d; --panel:#10151c; --ink:#e8edf4; --muted:#8b97a8; --line:#243041; --go:#7cffb2; --warn:#ffcc66; --stop:#ff6b6b; }
    html, body { margin:0; height:100%; background:var(--bg); color:var(--ink); font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
    #map { position:absolute; inset:0; }
    .hud { position:absolute; z-index:2; top:12px; left:12px; right:12px; display:flex; gap:10px; flex-wrap:wrap; pointer-events:none; }
    .card { pointer-events:auto; background:color-mix(in srgb, var(--panel) 88%, transparent); border:1px solid var(--line); border-radius:14px; padding:12px 14px; backdrop-filter: blur(16px); max-width:360px; }
    h1 { margin:0 0 4px; font-size:14px; letter-spacing:.02em; }
    .status { color:var(--muted); }
    .status b { color:var(--go); font-weight:600; }
    .status.bad b { color:var(--stop); }
    .status.warn b { color:var(--warn); }
    .layers { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
    button { pointer-events:auto; background:#1a2330; color:var(--ink); border:1px solid var(--line); border-radius:999px; padding:6px 10px; cursor:pointer; }
    button.on { border-color:var(--go); color:var(--go); }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .legend { margin-top:8px; color:var(--muted); }
    input { width:100%; box-sizing:border-box; margin-top:8px; background:#0b1016; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:8px; }
    a { color:var(--go); }
    .popup { color:#111; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="hud">
    <section class="card">
      <h1>McCluster spatial plane</h1>
      <div id="status" class="status warn"><b>booting</b> · satellite of /v1/geo</div>
      <div class="layers">
        <button id="btn-usgs" class="on" type="button">USGS 4.5+</button>
        <button id="btn-internal" type="button" disabled>Internal sites</button>
      </div>
      <input id="token" type="password" autocomplete="off" placeholder="House-owner bearer token (optional)" />
      <div class="legend">Keyless OPEN feed. Missing viewer tokens cannot trap boot. Internal pins stay behind auth.</div>
    </section>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
  <script>
    const statusEl = document.getElementById('status');
    const setStatus = (kind, html) => { statusEl.className = 'status ' + kind; statusEl.innerHTML = html; };
    const map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [-40, 20],
      zoom: 1.6,
      canvasContextAttributes: { antialias: true }
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    if (map.setProjection) map.setProjection({ type: 'globe' });

    const quakeColor = ['interpolate', ['linear'], ['get', 'severity'], 4.5, '#7cffb2', 6, '#ffcc66', 7.5, '#ff6b6b'];

    function featureCollection(records, extra = {}) {
      return {
        type: 'FeatureCollection',
        features: (records || []).filter((row) => row.point).map((row) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [row.point.lon, row.point.lat] },
          properties: { name: row.name, severity: row.severity, source: row.event_type || row.entity_type, ...extra, ...row.properties }
        }))
      };
    }

    async function loadJson(path, headers) {
      const response = await fetch(path, { headers });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, data };
    }

    async function boot() {
      const plane = await loadJson('/v1/geo/plane');
      if (!plane.ok) {
        setStatus('bad', '<b>' + plane.status + '</b> · plane unreachable. USGS still loading.');
      } else {
        setStatus(plane.data.database_schema_ready ? '' : 'warn',
          '<b>' + (plane.data.database_schema_ready ? 'live' : 'adapter-ready') + '</b> · ' + (plane.data.public_layers || []).length + ' public layers');
      }

      const usgs = await loadJson('/v1/geo/open/usgs');
      const records = usgs.ok ? (usgs.data.result?.records || []) : [];
      if (!usgs.ok) setStatus('bad', '<b>usgs ' + usgs.status + '</b> · ' + (usgs.data.error || 'open feed failed'));
      else if (plane.ok) setStatus(plane.data.database_schema_ready ? '' : 'warn',
        '<b>' + records.length + ' quakes</b> · USGS 4.5+ week · OPEN');

      map.addSource('usgs', { type: 'geojson', data: featureCollection(records) });
      map.addLayer({ id: 'usgs-heat', type: 'circle', source: 'usgs', paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'severity'], 4.5, 4, 8, 18],
        'circle-color': quakeColor,
        'circle-opacity': 0.85,
        'circle-stroke-width': 0.6,
        'circle-stroke-color': '#071018'
      }});
      map.on('click', 'usgs-heat', (event) => {
        const f = event.features[0];
        new maplibregl.Popup().setLngLat(event.lngLat).setHTML(
          '<div class="popup"><strong>' + (f.properties.name || 'quake') + '</strong><br>M' + (f.properties.severity || '?') + '</div>'
        ).addTo(map);
      });

      document.getElementById('btn-usgs').onclick = (event) => {
        const vis = map.getLayoutProperty('usgs-heat', 'visibility') === 'none';
        map.setLayoutProperty('usgs-heat', 'visibility', vis ? 'visible' : 'none');
        event.currentTarget.classList.toggle('on', vis);
      };
    }

    async function loadInternal() {
      const token = document.getElementById('token').value.trim();
      if (!token) return;
      const headers = { authorization: 'Bearer ' + token };
      const payload = await loadJson('/v1/geo/plane/internal', headers);
      if (!payload.ok) {
        setStatus('bad', '<b>internal ' + payload.status + '</b> · house-owner required');
        return;
      }
      const sites = payload.data.sites || [];
      if (map.getSource('internal')) map.getSource('internal').setData({
        type: 'FeatureCollection',
        features: sites.filter((s) => s.lat != null && s.lon != null).map((s) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          properties: { name: s.name, city: s.city, layer: s.layer }
        }))
      });
      else {
        map.addSource('internal', { type: 'geojson', data: { type: 'FeatureCollection', features: sites.filter((s) => s.lat != null && s.lon != null).map((s) => ({
          type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          properties: { name: s.name, city: s.city, layer: s.layer }
        })) } });
        map.addLayer({ id: 'internal-sites', type: 'circle', source: 'internal', paint: {
          'circle-radius': 6, 'circle-color': '#6cb6ff', 'circle-stroke-width': 1, 'circle-stroke-color': '#fff'
        }});
      }
      document.getElementById('btn-internal').disabled = false;
      document.getElementById('btn-internal').classList.add('on');
      setStatus('', '<b>' + sites.length + ' internal sites</b> · house-owner');
    }

    map.on('load', () => boot().catch((error) => setStatus('bad', '<b>boot failed</b> · ' + error.message)));
    document.getElementById('token').addEventListener('change', loadInternal);
  </script>
</body>
</html>
`;

export function viewerResponse(request, env) {
  return new Response(HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...corsHeaders(request, env)
    }
  });
}
