/* HALO LAYERS ON THE ADMIN GLOBE (owner, 2026-10-21: "put all the capabilities of Hitman Halo into the admin experience of
   the globe section"). The live layers Hitman's Halo had that the World's globe did not: military aircraft, ships, earthquakes,
   active fires, wildfire perimeters and tropical cyclones. Every one comes from the Worker's owner-only routes
   (GET /v1/world/layers/<id>, workers/mccluster/src/world-halo-layers.js); the page never calls a provider itself.

   Each layer is one primitive collection, so thousands of points stay cheap; it refreshes on its own clock while it is on and
   the page is visible, and it says honestly what it holds: a count, a stale answer, "needs a key", or unavailable. Nothing is
   invented: no motion between snapshots, no routes, no identities beyond what the provider broadcast. A tap opens what the
   provider said about that one thing (js/halo/halo.js asks describe()). */
(function () {
  'use strict';

  const SPECS = Object.freeze({
    military: Object.freeze({ label: 'Military flights', rows: 'aircraft', every: 30000, color: '#ffbf3c' }),
    vessels: Object.freeze({ label: 'Ships (AIS)', rows: 'vessels', every: 60000, color: '#5ad1c4' }),
    quakes: Object.freeze({ label: 'Earthquakes', rows: 'quakes', every: 60000, color: '#ff7a59' }),
    fires: Object.freeze({ label: 'Active fires', rows: 'fires', every: 600000, color: '#ff5a1f' }),
    perimeters: Object.freeze({ label: 'Wildfire perimeters', rows: 'perimeters', every: 600000, color: '#ff8a3d' }),
    cyclones: Object.freeze({ label: 'Tropical cyclones', rows: 'cyclones', every: 600000, color: '#9fd6ff' })
  });

  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const lonLat = (lon, lat) => finite(lon) && finite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max || 120) : '');

  /* small canvases, drawn once: an aircraft, a ship, a storm */
  const icons = {};
  function icon(kind, color) {
    const key = kind + color;
    if (icons[key]) return icons[key];
    const c = document.createElement('canvas'); c.width = c.height = 48;
    const x = c.getContext('2d');
    x.fillStyle = color; x.strokeStyle = '#120d05'; x.lineWidth = 2; x.beginPath();
    if (kind === 'aircraft') {
      [[24, 3], [28, 8], [28, 19], [43, 29], [43, 34], [28, 29], [28, 38], [34, 43], [34, 46], [24, 43], [14, 46], [14, 43], [20, 38], [20, 29], [5, 34], [5, 29], [20, 19], [20, 8]]
        .forEach(([a, b], n) => (n ? x.lineTo(a, b) : x.moveTo(a, b)));
      x.closePath(); x.fill(); x.stroke();
    } else if (kind === 'ship') {
      x.moveTo(24, 4); x.lineTo(36, 40); x.lineTo(24, 33); x.lineTo(12, 40); x.closePath(); x.fill(); x.stroke();
    } else {
      x.lineWidth = 4; x.strokeStyle = color;
      for (let a = 0; a < 2; a++) { x.beginPath(); x.arc(24, 24, 15, a * Math.PI, a * Math.PI + Math.PI * 0.8); x.stroke(); }
      x.fillStyle = color; x.beginPath(); x.arc(24, 24, 6, 0, Math.PI * 2); x.fill();
    }
    icons[key] = c;
    return c;
  }

  /* a billboard turned to its course on the ground: rotated about the local north, so it reads right from any angle */
  function headingAxis(C, position) {
    const m = C.Transforms.eastNorthUpToFixedFrame(position);
    return new C.Cartesian3(m[4], m[5], m[6]);
  }

  /* shallow quakes warm, deep ones cool (USGS's own convention, roughly) */
  function depthColor(C, km) {
    const d = finite(km) ? km : 10;
    return C.Color.fromCssColorString(d < 33 ? '#ff5a3c' : d < 70 ? '#ffa23c' : d < 300 ? '#ffe066' : '#6fb7ff');
  }

  function create(G) {
    const C = window.Cesium;
    const state = {};
    const listeners = new Set();
    Object.keys(SPECS).forEach((id) => { state[id] = { on: false, phase: 'off', count: 0, stale: false, reason: '', credit: '', fetched: 0, prims: [], entities: [], timer: 0, seq: 0, items: [] }; });

    function viewer() { return G.viewer(); }
    function changed(id) { listeners.forEach((fn) => { try { fn(id, status(id)); } catch (_) { /* a listener's own fault */ } }); }
    function status(id) {
      const L = state[id];
      return L ? { on: L.on, state: L.phase, count: L.count, stale: L.stale, reason: L.reason, credit: L.credit } : null;
    }
    function clear(id) {
      const L = state[id], v = viewer();
      if (v) {
        L.prims.forEach((p) => { if (v.scene.primitives.contains(p)) v.scene.primitives.remove(p); });
        L.entities.forEach((e) => v.entities.remove(e));
      }
      L.prims = []; L.entities = []; L.items = []; L.count = 0;
    }

    function pickId(id, item) { return { haloPick: true, layer: id, item }; }

    const draw = {
      military(id, rows) {
        const v = viewer(), col = new C.BillboardCollection(), L = state[id];
        rows.forEach((r) => {
          if (!Array.isArray(r) || !lonLat(r[2], r[3])) return;
          const item = { hex: text(r[0], 12), callsign: text(r[1], 16), lon: r[2], lat: r[3], alt: finite(r[4]) ? r[4] : null, speed: finite(r[5]) ? r[5] : null, track: finite(r[6]) ? r[6] : null, type: text(r[7], 24), squawk: text(r[8], 8), emergency: r[9] === true };
          const position = C.Cartesian3.fromDegrees(item.lon, item.lat, Math.max(0, item.alt ?? 9000));
          col.add({
            position, image: icon('aircraft', item.emergency ? '#ff4444' : SPECS.military.color), width: 22, height: 22,
            rotation: item.track === null ? 0 : -C.Math.toRadians(item.track), alignedAxis: item.track === null ? C.Cartesian3.ZERO : headingAxis(C, position),
            scaleByDistance: new C.NearFarScalar(100000, 1.25, 20000000, 0.4), id: pickId(id, item)
          });
          L.items.push(item);
        });
        v.scene.primitives.add(col); L.prims.push(col); L.count = col.length;
      },
      vessels(id, rows) {
        const v = viewer(), col = new C.BillboardCollection(), L = state[id];
        rows.forEach((r) => {
          if (!Array.isArray(r) || !lonLat(r[2], r[3])) return;
          const heading = finite(r[6]) && r[6] >= 0 && r[6] < 360 ? r[6] : (finite(r[5]) && r[5] >= 0 && r[5] < 360 ? r[5] : null);
          const item = { mmsi: text(String(r[0] ?? ''), 12), name: text(r[1], 40), lon: r[2], lat: r[3], sog: finite(r[4]) ? r[4] : null, cog: finite(r[5]) ? r[5] : null, heading, status: r[7] ?? null };
          const position = C.Cartesian3.fromDegrees(item.lon, item.lat, 0);
          col.add({
            position, image: icon('ship', SPECS.vessels.color), width: 16, height: 16,
            rotation: heading === null ? 0 : -C.Math.toRadians(heading), alignedAxis: heading === null ? C.Cartesian3.ZERO : headingAxis(C, position),
            scaleByDistance: new C.NearFarScalar(50000, 1.3, 15000000, 0.35), id: pickId(id, item)
          });
          L.items.push(item);
        });
        v.scene.primitives.add(col); L.prims.push(col); L.count = col.length;
      },
      quakes(id, rows) {
        const v = viewer(), pts = new C.PointPrimitiveCollection(), labels = new C.LabelCollection(), L = state[id];
        rows.forEach((q) => {
          if (!q || !lonLat(q.lon, q.lat)) return;
          const mag = finite(q.mag) ? Math.max(0, Math.min(9.9, q.mag)) : null;
          const item = { id: text(q.id, 40), mag, place: text(q.place, 120), time: text(q.time, 40), lon: q.lon, lat: q.lat, depth: finite(q.depth_km) ? q.depth_km : null, url: text(q.url, 300), tsunami: q.tsunami === true || q.tsunami === 1, alert: text(q.alert, 12) };
          const position = C.Cartesian3.fromDegrees(item.lon, item.lat, 0);
          pts.add({ position, pixelSize: 5 + (mag ?? 1) * 2.4, color: depthColor(C, item.depth).withAlpha(0.85), outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1, id: pickId(id, item) });
          if (mag !== null && mag >= 4.5) labels.add({ position, text: 'M' + mag.toFixed(1), font: '600 12px Inter, system-ui, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -14), distanceDisplayCondition: new C.DistanceDisplayCondition(0, 1.6e7) });
          L.items.push(item);
        });
        v.scene.primitives.add(pts); v.scene.primitives.add(labels); L.prims.push(pts, labels); L.count = pts.length;
      },
      fires(id, rows) {
        const v = viewer(), pts = new C.PointPrimitiveCollection(), L = state[id], color = C.Color.fromCssColorString(SPECS.fires.color).withAlpha(0.85);
        rows.forEach((r) => {
          if (!Array.isArray(r) || !lonLat(r[0], r[1])) return;
          const item = { lon: r[0], lat: r[1], frp: finite(r[2]) ? r[2] : null, confidence: text(String(r[3] ?? ''), 8), acq: text(r[4], 40), satellite: text(r[5], 16), daynight: text(r[6], 2) };
          pts.add({ position: C.Cartesian3.fromDegrees(item.lon, item.lat, 0), pixelSize: item.frp === null ? 3 : Math.min(8, 3 + Math.log10(1 + item.frp) * 2), color, scaleByDistance: new C.NearFarScalar(100000, 1.6, 15000000, 0.7), id: pickId(id, item) });
          L.items.push(item);
        });
        v.scene.primitives.add(pts); L.prims.push(pts); L.count = pts.length;
      },
      perimeters(id, rows) {
        const v = viewer(), L = state[id], fill = C.Color.fromCssColorString(SPECS.perimeters.color);
        const polys = [], lines = [];
        rows.forEach((p) => {
          if (!p || !Array.isArray(p.rings) || !Array.isArray(p.rings[0])) return;
          const ring = p.rings[0].filter((pt) => Array.isArray(pt) && lonLat(pt[0], pt[1]));
          if (ring.length < 3) return;
          const item = { id: text(String(p.id ?? ''), 60), name: text(p.name, 120), acres: finite(p.acres) ? p.acres : null, contained: finite(p.contained_pct) ? p.contained_pct : null, discovered: text(p.discovered, 40), lon: ring[0][0], lat: ring[0][1] };
          const positions = C.Cartesian3.fromDegreesArray(ring.flat());
          polys.push(new C.GeometryInstance({ geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(positions) }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(fill.withAlpha(0.28)) }, id: pickId(id, item) }));
          lines.push(new C.GeometryInstance({ geometry: new C.GroundPolylineGeometry({ positions: positions.concat([positions[0]]), width: 2 }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(fill.withAlpha(0.95)) }, id: pickId(id, item) }));
          L.items.push(item);
        });
        if (polys.length) {
          const ground = C.GroundPrimitive.isSupported(v.scene);
          const area = ground
            ? new C.GroundPrimitive({ geometryInstances: polys, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }) })
            : new C.Primitive({ geometryInstances: polys, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }) });
          v.scene.primitives.add(area); L.prims.push(area);
          if (ground) { const edge = new C.GroundPolylinePrimitive({ geometryInstances: lines, appearance: new C.PolylineColorAppearance() }); v.scene.primitives.add(edge); L.prims.push(edge); }
        }
        L.count = L.items.length;
      },
      cyclones(id, rows) {
        const v = viewer(), col = new C.BillboardCollection(), labels = new C.LabelCollection(), L = state[id];
        rows.forEach((s) => {
          if (!s || !lonLat(s.lon, s.lat)) return;
          const item = { id: text(String(s.id ?? ''), 20), name: text(s.name, 60), classification: text(s.classification, 40), intensity: finite(s.intensity_kt) ? s.intensity_kt : null, pressure: finite(s.pressure_mb) ? s.pressure_mb : null, dir: finite(s.movement_dir) ? s.movement_dir : null, speed: finite(s.movement_kt) ? s.movement_kt : null, basin: text(s.basin, 20), url: text(s.advisory_url, 300), lon: s.lon, lat: s.lat };
          const position = C.Cartesian3.fromDegrees(item.lon, item.lat, 0);
          col.add({ position, image: icon('storm', SPECS.cyclones.color), width: 34, height: 34, id: pickId(id, item) });
          labels.add({ position, text: (item.name || 'Storm') + (item.intensity !== null ? ' · ' + Math.round(item.intensity) + ' kt' : ''), font: '600 12px Inter, system-ui, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -24) });
          L.items.push(item);
        });
        v.scene.primitives.add(col); v.scene.primitives.add(labels); L.prims.push(col, labels); L.count = col.length;
      }
    };

    async function load(id) {
      const L = state[id], seq = ++L.seq, v = viewer();
      if (!v) return;
      L.phase = L.count ? L.phase : 'loading'; changed(id);
      let body = null, phase = 'on', reason = '';
      try {
        const t = G.token();
        const res = await fetch(G.api + '/v1/world/layers/' + id, { headers: t ? { accept: 'application/json', authorization: 'Bearer ' + t } : { accept: 'application/json' }, cache: 'no-store' });
        if (res.status === 401 || res.status === 403) { phase = 'locked'; reason = 'owner only'; }
        else if (!res.ok) { phase = 'error'; reason = 'answered ' + res.status; }
        else body = await res.json();
      } catch (e) { phase = 'error'; reason = 'could not reach the Worker'; }
      if (seq !== L.seq || !L.on) return;
      if (body && body.unavailable) { phase = 'unavailable'; reason = body.upstream_error === 'not_configured' ? 'needs a key' : 'provider unavailable'; }
      L.fetched = Date.now(); L.reason = reason; L.stale = !!(body && body.stale); L.credit = body ? text(body.credit || body.attribution, 80) : '';
      if (body && !body.unavailable) {
        clear(id);
        const rows = Array.isArray(body[SPECS[id].rows]) ? body[SPECS[id].rows] : [];
        try { draw[id](id, rows); } catch (e) { phase = 'error'; reason = 'could not draw'; clear(id); }
      } else if (phase !== 'on') clear(id);
      L.phase = phase;
      if (v.scene.requestRender) v.scene.requestRender();
      changed(id);
    }

    function tick(id) {
      const L = state[id];
      if (!L.on || document.hidden) return;
      if (Date.now() - L.fetched >= SPECS[id].every - 500) load(id);
    }

    function setOn(id, on) {
      const L = state[id];
      if (!L || L.on === !!on) return Promise.resolve();
      L.on = !!on;
      if (!L.on) { L.seq++; clearInterval(L.timer); L.timer = 0; clear(id); L.phase = 'off'; L.reason = ''; L.stale = false; changed(id); return Promise.resolve(); }
      L.timer = setInterval(() => tick(id), Math.min(SPECS[id].every, 30000));
      return load(id);
    }

    function onVisible() { if (!document.hidden) Object.keys(state).forEach(tick); }
    document.addEventListener('visibilitychange', onVisible);

    /* what the provider said about one picked thing, for the sheet; position() is where to follow it */
    function describe(pick) {
      if (!pick || !pick.haloPick || !state[pick.layer]) return null;
      const it = pick.item || {}, L = state[pick.layer], C2 = window.Cesium;
      const fmt = (v, unit, k) => (!finite(v) ? 'Unknown' : Math.round(v * (k || 1)).toLocaleString('en-US') + (unit ? ' ' + unit : ''));
      const when = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleString() : 'Unknown'; };
      const at = (h) => () => C2.Cartesian3.fromDegrees(it.lon, it.lat, h || 0);
      const credit = L.credit || SPECS[pick.layer].label;
      switch (pick.layer) {
        case 'military': return { title: it.callsign || it.hex || 'Military aircraft', rows: [['Type', it.type || 'Unknown'], ['Altitude', fmt(it.alt, 'ft', 3.28084)], ['Ground speed', fmt(it.speed, 'kn', 1.94384)], ['Track', fmt(it.track, '°')], ['Squawk', it.squawk || 'Unknown'], ['ICAO', it.hex || 'Unknown']], note: (it.emergency ? 'Emergency squawk broadcast. ' : '') + 'Broadcast by the aircraft’s own transponder (ADS-B). Many military aircraft never broadcast; this is not every one.', credit, position: at(Math.max(0, it.alt ?? 9000)), range: 60000 };
        case 'vessels': return { title: it.name || 'MMSI ' + it.mmsi, rows: [['MMSI', it.mmsi || 'Unknown'], ['Speed', finite(it.sog) ? it.sog.toFixed(1) + ' kn' : 'Unknown'], ['Course', fmt(it.cog, '°')], ['Heading', fmt(it.heading, '°')]], note: 'The ship’s own AIS broadcast, received from shore. Ships far from a receiver are not shown.', credit, position: at(0), range: 25000 };
        case 'quakes': return { title: (finite(it.mag) ? 'M' + it.mag.toFixed(1) + ' · ' : '') + (it.place || 'Earthquake'), rows: [['Magnitude', finite(it.mag) ? it.mag.toFixed(1) : 'Unknown'], ['Depth', fmt(it.depth, 'km')], ['Time', when(it.time)], ['Tsunami flag', it.tsunami ? 'Yes' : 'No'], ['PAGER alert', it.alert || 'None']], link: it.url && /^https:\/\/earthquake\.usgs\.gov\//.test(it.url) ? it.url : '', note: 'USGS, last 24 hours. Magnitude and location are revised as review continues.', credit, position: at(0), range: 400000 };
        case 'fires': return { title: 'Fire detection', rows: [['Radiative power', finite(it.frp) ? it.frp.toFixed(1) + ' MW' : 'Unknown'], ['Confidence', it.confidence || 'Unknown'], ['Detected', when(it.acq)], ['Satellite', it.satellite || 'Unknown'], ['Pass', it.daynight === 'D' ? 'Day' : it.daynight === 'N' ? 'Night' : 'Unknown']], note: 'A satellite thermal hotspot (VIIRS), not a confirmed wildfire. Industry, flares and volcanoes show too.', credit, position: at(0), range: 60000 };
        case 'perimeters': return { title: it.name || 'Wildfire', rows: [['Size', fmt(it.acres, 'acres')], ['Contained', finite(it.contained) ? Math.round(it.contained) + '%' : 'Unknown'], ['Discovered', when(it.discovered)]], note: 'The incident perimeter as reported by U.S. agencies (NIFC). It lags the fire.', credit, position: at(0), range: 120000 };
        case 'cyclones': return { title: it.name || 'Tropical cyclone', rows: [['Class', it.classification || 'Unknown'], ['Wind', fmt(it.intensity, 'kt')], ['Pressure', fmt(it.pressure, 'mb')], ['Moving', finite(it.dir) ? Math.round(it.dir) + '° at ' + fmt(it.speed, 'kt') : 'Unknown']], link: it.url && /^https:\/\/www\.nhc\.noaa\.gov\//.test(it.url) ? it.url : '', note: 'Latest National Hurricane Center position. Follow the official advisory for forecasts and warnings.', credit, position: at(0), range: 1500000 };
        default: return null;
      }
    }

    function destroy() {
      document.removeEventListener('visibilitychange', onVisible);
      Object.keys(state).forEach((id) => { const L = state[id]; L.on = false; L.seq++; clearInterval(L.timer); clear(id); });
      listeners.clear();
    }

    return Object.freeze({
      ids: Object.keys(SPECS),
      toggle: (id) => setOn(id, !(state[id] && state[id].on)),
      set: setOn,
      on: (id) => !!(state[id] && state[id].on),
      status,
      describe,
      onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      destroy
    });
  }

  window.HaloLayers = Object.freeze({ SPECS, create });
})();
