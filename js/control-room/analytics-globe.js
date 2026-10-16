/* THE ANALYTICS GLOBE: one charcoal Earth for the owner's analytics.
   (owner, 2026-10-15: "a custom globe of exactly the real globe, segmented
   like this (country borders). Charcoal interface. Select the globe, select
   locations, go there on the globe to see what analytics exist there.")
   (owner, 2026-10-16: "each selected country to be mapped accordingly and each
   state mapped accordingly across the countries so that when I'm looking at
   that individual place it can show me where on the planet it is when it's
   selected either from the console or the globe itself." And: "a little glow
   outline of the globe … I just don't need arcs and other stuff, just modern
   selection.")

   One Cesium instance (a CesiumWidget, not a second World): the same Cesium
   release the World loads (js/action-globe.js, 1.131 from cesium.com), but no
   imagery at all, so no paid map and no ion: a solid charcoal ellipsoid, the
   Natural Earth 1:110m country polygons (data/geo/country-boundaries-110m.json,
   public domain) with lighter borders and a faint graticule. Rendering is on
   demand (requestRenderMode): nothing draws unless the camera moves or the
   data changes, so an idle phone is idle.

   What it draws, and nothing else:
     the dark globe, the borders, a faint graticule (the glow rim is CSS,
     css/control-analytics.css, from --an-rim);
     no choropleth: every place stays grey (owner, 2026-10-16: "a grey sphere that only lights up when selected
                  boundaries are selected"); the panel's aggregate (already folded, under 5 never present) only
                  feeds the selected place's label
     cells        intel 10-degree cells, drawn as cells, never as points
     selection    ONE place: a country, or a state / province inside it. Filled
                  and outlined in --an-accent, the camera flies to fit it, and a
                  small label (name, count) with a white dot at its label point.
   States and provinces (Natural Earth 1:10m admin-1, data/geo/admin1/<CC>.json,
   public domain) are fetched for the SELECTED country only, once, and cached;
   their lines are drawn for that country only. This file is loaded only by the
   Control Room (control.html), so no state data ever reaches the public globe.

   Selection is one shape, {country, state}, owned by the panel
   (js/control-room/analytics.js): a tap here calls opts.onSelect(next) and the
   panel answers with api.select(next, true), the same call its dropdown makes. */
(function () {
  "use strict";
  window.CR = window.CR || {};
  var CESIUM_BASE = "https://cesium.com/downloads/cesiumjs/releases/1.131/Build/Cesium/";
  var BOUNDARIES = "data/geo/country-boundaries-50m.json";
  var ADMIN1 = "data/geo/admin1/";
  /* colours come from CSS tokens on the stage (css/control-analytics.css); these are only the fallbacks */
  var FALLBACK = { "--an-space": "#0b0b0d", "--an-earth": "#121316", "--an-land": "#26282d", "--an-land-context": "#33363d",
    "--an-border": "#5d626c", "--an-graticule": "#ffffff", "--an-accent": "#e11d2e" };
  var cesiumPromise = null, boundaryPromise = null, admin1Cache = {};

  function loadCesium() {
    if (window.Cesium) return Promise.resolve(window.Cesium);
    if (cesiumPromise) return cesiumPromise;
    cesiumPromise = new Promise(function (resolve, reject) {
      window.CESIUM_BASE_URL = window.CESIUM_BASE_URL || CESIUM_BASE;
      var s = document.createElement("script");
      s.src = CESIUM_BASE + "Cesium.js";
      s.async = true;
      s.onload = function () { window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium did not load")); };
      s.onerror = function () { cesiumPromise = null; reject(new Error("Cesium did not load")); };
      document.head.appendChild(s);
    });
    return cesiumPromise;
  }
  function loadBoundaries() {
    if (!boundaryPromise) boundaryPromise = fetch(BOUNDARIES).then(function (r) { if (!r.ok) throw new Error("boundaries " + r.status); return r.json(); }).then(decode)
      .catch(function (e) { boundaryPromise = null; throw e; });
    return boundaryPromise;
  }
  /* the 1:50m file is delta-encoded hundredths of a degree (tools/build-country-boundaries.mjs --scale 50m) */
  function undelta(r) { var o = new Array(r.length), x = 0, y = 0; for (var i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; o[i] = x / 100; o[i + 1] = y / 100; } return o; }
  function decode(geo) {
    if (!geo || !/^delta-0\.01/.test(geo.encoding || "")) return geo;
    (geo.countries || []).forEach(function (c) { c.p = (c.p || []).map(function (poly) { return poly.map(undelta); }); });
    geo.lakes = (geo.lakes || []).map(function (poly) { return poly.map(undelta); });
    geo.encoding = "decoded"; return geo;
  }
  /* one country's states and provinces, fetched on demand and kept (a failed fetch is retried next time) */
  function loadAdmin1(cc) {
    cc = String(cc || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return Promise.resolve(null);
    if (!admin1Cache[cc]) admin1Cache[cc] = fetch(ADMIN1 + cc + ".json").then(function (r) { if (r.status === 404) return null; if (!r.ok) throw new Error("states " + r.status); return r.json(); })
      .catch(function (e) { delete admin1Cache[cc]; throw e; });
    return admin1Cache[cc];
  }
  /* a degree is a real number or nothing; 0,0 is never a place */
  function deg(v) { if (v === null || v === undefined || v === "" || typeof v === "boolean" || Array.isArray(v)) return null; var x = Number(v); return isFinite(x) ? x : null; }
  function lonLat(lon, lat) { var x = deg(lon), y = deg(lat); return x === null || y === null || Math.abs(y) > 90 || Math.abs(x) > 180 || (x === 0 && y === 0) ? null : [x, y]; }
  function reducedMotion() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }

  /* REGION ROWS -> STATE SHAPES. Cloudflare reports a region code (request.cf.regionCode, "CT") and a name
     (request.cf.region, "Connecticut"); Natural Earth keys states by ISO 3166-2 ("US-CT") and carries alternates.
     Match by code first, then by name, then by Natural Earth's grouping (a French region over its departements, a UK
     nation over its councils). A row that matches nothing is counted as unmatched, never guessed onto a shape.
     Returns {byKey: {stateKey: {value, area, members}}, unmatched}. Pure: the panel and the tests call it. */
  function matchRegions(states, rows) {
    var byKey = {}, unmatched = 0;
    states = states || [];
    (rows || []).forEach(function (r) {
      var v = Number(r.page_views) || 0, code = String(r.code || "").toUpperCase(), nm = norm(r.name), hit = [];
      if (code) hit = states.filter(function (s) { return (s.codes || []).indexOf(code) >= 0; });
      if (hit.length > 1) { var exact = hit.filter(function (s) { return String(s.k || "").split("-")[1] === code; }); if (exact.length) hit = exact; }
      if (!hit.length && nm) hit = states.filter(function (s) { return (s.names || []).indexOf(nm) >= 0 || norm(s.n) === nm; });
      if (!hit.length && nm) hit = states.filter(function (s) { return norm(s.g) === nm || norm(s.u) === nm; });
      if (!hit.length) { unmatched += v; return; }
      var area = hit.length > 1 ? (r.name || code) : null, members = hit.map(function (s) { return s.k; });
      hit.forEach(function (s) { var x = byKey[s.k] || (byKey[s.k] = { value: 0, area: area, members: members }); x.value += v; });
    });
    return { byKey: byKey, unmatched: unmatched };
  }
  /* the box to fit: the largest polygon's box (the lower 48 rather than Alaska and Hawaii together), never under minDeg */
  function fitBox(polys, minDeg) {
    var best = null, bestA = -1;
    (polys || []).forEach(function (poly) {
      var o = poly[0]; if (!o) return; var w = 180, s = 90, e = -180, n = -90;
      for (var k = 0; k < o.length; k += 2) { w = Math.min(w, o[k]); e = Math.max(e, o[k]); s = Math.min(s, o[k + 1]); n = Math.max(n, o[k + 1]); }
      var a = (e - w) * (n - s) * Math.cos((s + n) / 2 * Math.PI / 180); if (a > bestA) { bestA = a; best = [w, s, e, n]; }
    });
    if (!best) return null;
    var cx = (best[0] + best[2]) / 2, cy = (best[1] + best[3]) / 2, hw = Math.max(minDeg, best[2] - best[0]) / 2 * 1.3, hh = Math.max(minDeg, best[3] - best[1]) / 2 * 1.3;
    return [Math.max(-180, cx - hw), Math.max(-89, cy - hh), Math.min(180, cx + hw), Math.min(89, cy + hh)];
  }

  function mount(host, opts) {
    opts = opts || {};
    var api = { ready: false, failed: null, data: { mode: "countries", points: [], cells: [], states: null }, sel: { country: null, state: null } };
    host.innerHTML = '<div class="crg-canvas" data-crg-canvas></div><div class="crg-credit" hidden data-crg-credit></div>' +
      '<div class="crg-tip" role="status" aria-live="polite" hidden data-crg-tip><small></small><b></b><span></span></div>' +
      '<p class="crg-msg" data-crg-msg>Loading the globe…</p>';
    var canvasBox = host.querySelector("[data-crg-canvas]"), tip = host.querySelector("[data-crg-tip]"), msg = host.querySelector("[data-crg-msg]");
    var Cs, widget, scene, camera, C = {}, fills = null, instancesByCode = {}, countries = [], polysByCode = {};
    var cellLayer = null, outlineLayer = null, dotLayer = null, occluder = null, scratch2 = null;
    var st = { cc: null, file: null, fills: null, lines: null, byKey: {}, ids: {}, out: [] }, hoverSel = null, tipSel = null, tipCart = null;

    function say(t) { if (!msg) return; msg.textContent = t || ""; msg.hidden = !t; }
    /* each token resolved by the browser (so a token may be any CSS colour, color-mix included) */
    function tokens() {
      var probe = document.createElement("i"); probe.style.display = "none"; host.appendChild(probe);
      Object.keys(FALLBACK).forEach(function (k) {
        var c = null;
        try { probe.style.color = ""; probe.style.color = "var(" + k + "," + FALLBACK[k] + ")"; c = Cs.Color.fromCssColorString(getComputedStyle(probe).color); } catch (e) { c = null; }
        C[k.slice(5)] = c || Cs.Color.fromCssColorString(FALLBACK[k]);
      });
      probe.remove();
      /* the selection outline: the accent, lifted toward white so it reads as an edge over its own fill */
      C.outline = Cs.Color.lerp(C.accent, Cs.Color.WHITE, 0.28, new Cs.Color());
    }
    function valueOf(code) { if (!code) return null; for (var i = 0; i < api.data.points.length; i++) if (api.data.points[i].code === code) return api.data.points[i]; return null; }
    function countryColor(code) {
      var sel = api.sel;
      if (code && code === sel.country) return sel.state ? C["land-context"] : C.accent.withAlpha(0.78);
      return C.land;
    }
    function stateColor(k) {
      var sel = api.sel;
      if (!sel.state) return C.land.withAlpha(0.012); /* invisible but still tappable over the country's fill */
      if (k === sel.state) return C.accent.withAlpha(0.8);
      return C["land-context"];
    }
    var needRecolor = false;
    function recolor() {
      if (!fills || !fills.ready || (st.fills && !st.fills.ready) || (borders && !borders.ready)) { needRecolor = true; return; }
      needRecolor = false;
      var fine = st.out.length ? st.cc : null, clear = Cs.ColorGeometryInstanceAttribute.toValue(Cs.Color.TRANSPARENT);
      Object.keys(instancesByCode).forEach(function (code) {
        var col = code === fine ? clear : Cs.ColorGeometryInstanceAttribute.toValue(countryColor(code));
        instancesByCode[code].forEach(function (id) { var a = fills.getGeometryInstanceAttributes(id); if (a) a.color = col; });
      });
      /* the selected country is drawn at 1:10m: its 1:50m fill and lines step aside */
      if (borders && borders.ready) Object.keys(lineIdsByCode).forEach(function (code) {
        var on = code !== fine; lineIdsByCode[code].forEach(function (id) { var a = borders.getGeometryInstanceAttributes(id); if (a && a.show && a.show[0] !== (on ? 1 : 0)) a.show = Cs.ShowGeometryInstanceAttribute.toValue(on); });
      });
      if (st.fills) { var oc = Cs.ColorGeometryInstanceAttribute.toValue(countryColor(st.cc)); st.out.forEach(function (id) { var a = st.fills.getGeometryInstanceAttributes(id); if (a) a.color = oc; }); }
      if (st.fills) Object.keys(st.ids).forEach(function (k) {
        var col = Cs.ColorGeometryInstanceAttribute.toValue(stateColor(k));
        st.ids[k].forEach(function (id) { var a = st.fills.getGeometryInstanceAttributes(id); if (a) a.color = col; });
      });
    }
    function polygonInstance(id, poly, height, color) {
      return new Cs.GeometryInstance({ id: id,
        geometry: new Cs.PolygonGeometry({
          polygonHierarchy: new Cs.PolygonHierarchy(Cs.Cartesian3.fromDegreesArray(poly[0]), poly.slice(1).map(function (h) { return new Cs.PolygonHierarchy(Cs.Cartesian3.fromDegreesArray(h)); })),
          height: height, granularity: Cs.Math.RADIANS_PER_DEGREE * 1.5, vertexFormat: Cs.PerInstanceColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cs.ColorGeometryInstanceAttribute.fromColor(color) } });
    }
    function ringLine(ring, height, color, width, id) {
      var h = []; for (var k = 0; k < ring.length; k += 2) h.push(ring[k], ring[k + 1], height);
      h.push(ring[0], ring[1], height);
      return new Cs.GeometryInstance({ id: id, geometry: new Cs.PolylineGeometry({ positions: Cs.Cartesian3.fromDegreesArrayHeights(h), width: width || 1, arcType: Cs.ArcType.RHUMB, vertexFormat: Cs.PolylineColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cs.ColorGeometryInstanceAttribute.fromColor(color), show: new Cs.ShowGeometryInstanceAttribute(true) } });
    }
    var borders = null, lineIdsByCode = {}, lakeCount = 0, scaleNote = null;
    function buildCountries(geo) {
      var inst = [], lines = [], seq = 0;
      countries = geo.countries || []; scaleNote = geo.source || null; lakeCount = (geo.lakes || []).length;
      countries.forEach(function (c) {
        var code = c.c || ("_" + (seq++));
        if (c.c) polysByCode[c.c] = c.p || [];
        (c.p || []).forEach(function (poly, pi) {
          var outer = poly[0]; if (!outer || outer.length < 6) return;
          var id = "c|" + code + "|" + pi;
          /* Antarctica's ring runs along the pole; it is drawn as borders only */
          if (code !== "AQ") { inst.push(polygonInstance(id, poly, 1200, C.land)); (instancesByCode[code] = instancesByCode[code] || []).push(id); }
          poly.forEach(function (ring, ri) { var lid = "b|" + code + "|" + pi + "." + ri; lines.push(ringLine(ring, 6000, C.border.withAlpha(0.8), 1, lid)); (lineIdsByCode[code] = lineIdsByCode[code] || []).push(lid); });
        });
      });
      /* the 1:50m lakes are cut out of the land: the sphere's own grey, above every land fill, with a fine shore */
      var lakes = [], shores = [];
      (geo.lakes || []).forEach(function (poly, li) {
        if (!poly[0] || poly[0].length < 6) return;
        lakes.push(polygonInstance("l|" + li + "|", poly, 3600, C.earth));
        shores.push(ringLine(poly[0], 6000, C.border.withAlpha(0.5), 1));
      });
      /* a faint graticule every 30 degrees */
      for (var lon = -180; lon < 180; lon += 30) { var mer = []; for (var la = -80; la <= 80; la += 5) mer.push(lon, la, 4000); lines.push(gline(mer)); }
      for (var lat = -60; lat <= 60; lat += 30) { var par = []; for (var lo = -180; lo <= 180; lo += 5) par.push(lo, lat, 4000); lines.push(gline(par)); }
      fills = scene.primitives.add(new Cs.Primitive({ geometryInstances: inst, appearance: new Cs.PerInstanceColorAppearance({ flat: false, translucent: true }), asynchronous: false, releaseGeometryInstances: true }));
      if (lakes.length) scene.primitives.add(new Cs.Primitive({ geometryInstances: lakes, appearance: new Cs.PerInstanceColorAppearance({ flat: false, translucent: false }), asynchronous: false, releaseGeometryInstances: true }));
      borders = scene.primitives.add(new Cs.Primitive({ geometryInstances: lines.concat(shores), appearance: new Cs.PolylineColorAppearance({ translucent: true }), asynchronous: false }));
    }
    function gline(arr) {
      return new Cs.GeometryInstance({ geometry: new Cs.PolylineGeometry({ positions: Cs.Cartesian3.fromDegreesArrayHeights(arr), width: 1, arcType: Cs.ArcType.NONE, vertexFormat: Cs.PolylineColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cs.ColorGeometryInstanceAttribute.fromColor(C.graticule.withAlpha(0.06)), show: new Cs.ShowGeometryInstanceAttribute(true) } });
    }
    /* the selected country's states: fills (tappable) and lines, for that country only */
    function dropStates() {
      if (st.fills) scene.primitives.remove(st.fills); if (st.lines) scene.primitives.remove(st.lines);
      st = { cc: null, file: null, fills: null, lines: null, byKey: {}, ids: {}, out: [] };
    }
    function buildStates(cc, file) {
      dropStates(); if (!file || !file.states) return;
      var inst = [], lines = [];
      st.cc = cc; st.file = file;
      /* the country itself at 1:10m (the dissolve of its own states, so the edges agree), under its states */
      (file.outline || []).forEach(function (poly, pi) {
        if (!poly[0] || poly[0].length < 6) return;
        var id = "c|" + cc + "|o" + pi; inst.push(polygonInstance(id, poly, 2000, countryColor(cc))); st.out.push(id);
        poly.forEach(function (ring) { lines.push(ringLine(ring, 6600, C.border.withAlpha(0.85), 1)); });
      });
      file.states.forEach(function (s) {
        st.byKey[s.k] = s; st.ids[s.k] = [];
        (s.p || []).forEach(function (poly, pi) {
          if (!poly[0] || poly[0].length < 6) return;
          var id = "s|" + s.k + "|" + pi; inst.push(polygonInstance(id, poly, 3000, C.land.withAlpha(0.012))); st.ids[s.k].push(id);
          lines.push(ringLine(poly[0], 6500, C.border.withAlpha(0.4), 1));
        });
      });
      if (!inst.length) return;
      st.fills = scene.primitives.add(new Cs.Primitive({ geometryInstances: inst, appearance: new Cs.PerInstanceColorAppearance({ flat: false, translucent: true }), asynchronous: false, releaseGeometryInstances: true }));
      st.lines = scene.primitives.add(new Cs.Primitive({ geometryInstances: lines, appearance: new Cs.PolylineColorAppearance({ translucent: true }), asynchronous: false }));
    }
    function selectedPolys() {
      if (api.sel.state && st.byKey[api.sel.state]) return st.byKey[api.sel.state].p || [];
      if (api.sel.country && st.cc === api.sel.country && st.file && st.file.outline && st.file.outline.length) return st.file.outline;
      return api.sel.country ? polysByCode[api.sel.country] || [] : [];
    }
    function labelPoint() {
      var s = api.sel, ll = null;
      if (s.state && st.byKey[s.state]) ll = st.byKey[s.state].l && lonLat(st.byKey[s.state].l[0], st.byKey[s.state].l[1]);
      else if (s.country) { var p = valueOf(s.country); ll = (p && lonLat(p.lon, p.lat)) || (opts.labelPoint && opts.labelPoint(s.country)); }
      if (!ll) { var b = fitBox(selectedPolys(), 0); ll = b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null; }
      return ll;
    }
    /* the selection: a crisp outline with a soft glow (no pulse), the parent country's outline for context, a white dot */
    function drawSelection() {
      [outlineLayer, dotLayer].forEach(function (l) { if (l) scene.primitives.remove(l); });
      outlineLayer = dotLayer = null;
      var polys = selectedPolys(), rings = [];
      polys.forEach(function (poly) { if (poly[0] && poly[0].length >= 6) rings.push(poly[0]); });
      if (rings.length) outlineLayer = scene.primitives.add(new Cs.Primitive({ asynchronous: false,
        geometryInstances: rings.map(function (ring) { var h = []; for (var k = 0; k < ring.length; k += 2) h.push(ring[k], ring[k + 1], 9000); h.push(ring[0], ring[1], 9000);
          return new Cs.GeometryInstance({ geometry: new Cs.PolylineGeometry({ positions: Cs.Cartesian3.fromDegreesArrayHeights(h), width: 5, arcType: Cs.ArcType.RHUMB, vertexFormat: Cs.PolylineMaterialAppearance.VERTEX_FORMAT }) }); }),
        appearance: new Cs.PolylineMaterialAppearance({ material: Cs.Material.fromType("PolylineGlow", { color: C.outline, glowPower: 0.22, taperPower: 1 }) }) }));
      /* a state's parent country is its context: the country's other states stay drawn (lines and shading) and the
         label names the country; the coarse 1:110m country outline is not redrawn over the finer state edges */
      var ll = (api.sel.country || api.sel.state) ? labelPoint() : null;
      if (ll) {
        var c = document.createElement("canvas"), s = 32; c.width = c.height = s;
        var g = c.getContext("2d"), grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.32, "rgba(255,255,255,1)"); grd.addColorStop(0.5, "rgba(255,255,255,.25)"); grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd; g.fillRect(0, 0, s, s);
        dotLayer = new Cs.BillboardCollection({ scene: scene });
        dotLayer.add({ position: Cs.Cartesian3.fromDegrees(ll[0], ll[1], 10000), image: c, width: 14, height: 14, id: "dot" });
        scene.primitives.add(dotLayer);
      }
    }
    function drawOverlays() {
      if (!api.ready) return;
      if (cellLayer) { scene.primitives.remove(cellLayer); cellLayer = null; }
      var d = api.data;
      if (d.mode === "cells") {
        var cells = (d.cells || []).filter(function (x) { return Array.isArray(x.bounds) && x.bounds.length === 4 && x.bounds.every(function (v) { return deg(v) !== null; }); });
        var cm = Math.max(1, cells.length ? Number(cells[0].value) || 1 : 1);
        if (cells.length) cellLayer = scene.primitives.add(new Cs.Primitive({ asynchronous: false, appearance: new Cs.PerInstanceColorAppearance({ flat: true, translucent: true }),
          geometryInstances: cells.map(function (x) {
            return new Cs.GeometryInstance({ id: "g|" + x.code + "|cell", geometry: new Cs.RectangleGeometry({ rectangle: Cs.Rectangle.fromDegrees(x.bounds[0], x.bounds[1], x.bounds[2], x.bounds[3]), height: 9000, vertexFormat: Cs.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
              attributes: { color: Cs.ColorGeometryInstanceAttribute.fromColor(x.code === api.sel.country ? C.accent.withAlpha(0.8) : C.graticule.withAlpha(0.05 + 0.14 * Math.sqrt((Number(x.value) || 0) / cm))) } }); }) }));
      }
      recolor(); drawSelection(); placeTip(); scene.requestRender();
    }
    /* for the browser test: where a place's label point is on the canvas (null when it faces away) */
    window.__craGlobeProject = function (code) {
      if (!api.ready) return null;
      var ll = null;
      if (/^[A-Z]{2}-/.test(code || "") && st.byKey[code]) { var s = st.byKey[code]; ll = s.l && lonLat(s.l[0], s.l[1]); if (!ll) { var b = fitBox(s.p, 0); ll = b && [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; } }
      else { var p = valueOf(code); ll = (p && lonLat(p.lon, p.lat)) || (opts.labelPoint && opts.labelPoint(code)); }
      if (!ll) return null;
      var cart = Cs.Cartesian3.fromDegrees(ll[0], ll[1], 9000); occluder.cameraPosition = camera.positionWC;
      if (!occluder.isPointVisible(cart)) return null;
      var w = (Cs.SceneTransforms.worldToWindowCoordinates || Cs.SceneTransforms.wgs84ToWindowCoordinates)(scene, cart);
      return w ? { x: w.x, y: w.y } : null;
    };
    /* for the browser test, like the World's __huPlaced: what is drawn, what is selected, and what the camera looks at */
    window.__craGlobe = function () {
      var c = api.ready ? Cs.Cartographic.fromCartesian(camera.positionWC) : null;
      return { ready: api.ready, failed: api.failed ? String(api.failed.message || api.failed) : null, countries: countries.length,
        valued: api.data.points.map(function (p) { return p.code; }), arcs: 0, dots: dotLayer ? dotLayer.length : 0,
        selected: api.sel.country, state: api.sel.state, statesFor: st.cc, states: Object.keys(st.byKey).length,
        fill: function (code) { if (code === st.cc && st.out.length && st.fills && st.fills.ready) { var o = st.fills.getGeometryInstanceAttributes(st.out[0]); return o ? Array.prototype.slice.call(o.color) : null; } var ids = instancesByCode[code]; if (!ids || !fills || !fills.ready) return null; var a = fills.getGeometryInstanceAttributes(ids[0]); return a ? Array.prototype.slice.call(a.color) : null; },
        lakes: lakeCount, scale: scaleNote,
        stateFill: function (k) { var ids = st.ids[k]; if (!ids || !ids.length || !st.fills || !st.fills.ready) return null; var a = st.fills.getGeometryInstanceAttributes(ids[0]); return a ? Array.prototype.slice.call(a.color) : null; },
        camera: c ? { lon: Cs.Math.toDegrees(c.longitude), lat: Cs.Math.toDegrees(c.latitude), height: c.height } : null, tip: tip.hidden ? null : tip.textContent };
    };
    /* the label: the selected place (or, with a mouse, the hovered one), pinned to its label point */
    function placeTip() {
      var s = hoverSel || api.sel;
      if (!(s.country || s.state) || !opts.tooltipFor) { tip.hidden = true; tipSel = null; return; }
      var t = opts.tooltipFor(s); if (!t) { tip.hidden = true; tipSel = null; return; }
      tip.querySelector("small").textContent = t.context || ""; tip.querySelector("small").hidden = !t.context;
      tip.querySelector("b").textContent = t.title; tip.querySelector("span").textContent = t.line;
      tipSel = s;
      var ll = null;
      if (s === api.sel) ll = labelPoint();
      else { var p = valueOf(s.country); ll = p && lonLat(p.lon, p.lat); }
      tipCart = ll ? Cs.Cartesian3.fromDegrees(ll[0], ll[1], 9000) : null;
      positionTip();
    }
    function positionTip() {
      if (!tipSel || !tipCart) { tip.hidden = true; return; }
      occluder.cameraPosition = camera.positionWC;
      if (!occluder.isPointVisible(tipCart)) { tip.hidden = true; return; }
      var w = (Cs.SceneTransforms.worldToWindowCoordinates || Cs.SceneTransforms.wgs84ToWindowCoordinates)(scene, tipCart, scratch2);
      if (!w) { tip.hidden = true; return; }
      tip.hidden = false;
      var bw = host.clientWidth, x = Math.max(8, Math.min(bw - tip.offsetWidth - 8, w.x + 16)), y = Math.max(8, w.y - tip.offsetHeight / 2);
      tip.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    }
    function pickAt(pos) {
      var all = scene.drillPick ? scene.drillPick(pos, 4) : [scene.pick(pos)], out = { country: null, state: null };
      (all || []).forEach(function (pk) {
        var id = pk && (typeof pk.id === "string" ? pk.id : null), m = id && /^([cgs])\|([^|]+)\|/.exec(id);
        if (!m || m[2].charAt(0) === "_") return;
        if (m[1] === "s" && !out.state) out.state = m[2];
        else if ((m[1] === "c" || m[1] === "g") && !out.country) out.country = m[2];
      });
      if (out.state && !out.country) out.country = st.cc;
      return out.country ? out : null;
    }
    /* what a tap means: a state inside the selected country selects it (again: back to the country); another country
       selects that country; the selected country again (no state) clears */
    function nextFromTap(hit) {
      var s = api.sel;
      if (hit.state && hit.country === s.country) return hit.state === s.state ? { country: s.country, state: null } : { country: s.country, state: hit.state };
      if (hit.country === s.country && !s.state) return { country: null, state: null };
      return { country: hit.country, state: null };
    }
    function homeView(dur) {
      var dest = Cs.Cartesian3.fromDegrees(opts.home ? opts.home[0] : -60, opts.home ? opts.home[1] : 22, homeAltitude());
      if (dur) camera.flyTo({ destination: dest, duration: dur, easingFunction: Cs.EasingFunction.CUBIC_IN_OUT }); else { camera.cancelFlight(); camera.setView({ destination: dest }); scene.requestRender(); }
    }
    function flyToSel() {
      if (!api.ready) return;
      var dur = reducedMotion() ? 0 : 0.8;
      if (!api.sel.country) { homeView(dur); return; }
      var box = fitBox(selectedPolys(), api.sel.state ? 2.2 : 6);
      if (!box) { var ll = labelPoint(); if (!ll) return; box = [ll[0] - 8, ll[1] - 6, ll[0] + 8, ll[1] + 6]; }
      /* fit the shape, but never so close that the planet is lost: a country keeps the curve of the Earth in view,
         a state its neighbours (owner: "show me where on the planet it is") */
      var rect = Cs.Rectangle.fromDegrees(box[0], box[1], box[2], box[3]);
      var at = Cs.Cartographic.fromCartesian(camera.getRectangleCameraCoordinates(rect));
      var dest = Cs.Cartesian3.fromRadians(at.longitude, at.latitude, Math.max(at.height, api.sel.state ? 7e5 : 6.5e6));
      if (dur) camera.flyTo({ destination: dest, duration: dur, easingFunction: Cs.EasingFunction.CUBIC_IN_OUT });
      else { camera.cancelFlight(); camera.setView({ destination: dest }); scene.requestRender(); }
    }
    /* the whole Earth fits the stage: Cesium's field of view spans the longer side, so the altitude follows the aspect */
    function homeAltitude() { var w = host.clientWidth || 390, h = host.clientHeight || 300; return 8.6e6 * Math.max(w, h) / Math.max(1, Math.min(w, h)); }
    var seq = 0;
    function ensureStates(cc) {
      if (!cc) { if (st.cc) { dropStates(); scene.requestRender(); } return Promise.resolve(null); }
      if (st.cc === cc) return Promise.resolve(st.file);
      if (st.cc) dropStates();
      var my = ++seq;
      return loadAdmin1(cc).then(function (file) { if (my !== seq || api.sel.country !== cc) return null; buildStates(cc, file); drawOverlays(); return file; },
        function () { return null; });
    }

    api.setData = function (d) {
      api.data = { mode: d.mode === "cells" ? "cells" : "countries", points: (d.points || []).slice(0, 300), cells: (d.cells || []).slice(0, 2000), states: d.states || null };
      drawOverlays();
    };
    /* the one way in: the panel's dropdown, its rows, Clear and a tap here all end in select({country, state}, fly) */
    api.select = function (sel, fly) {
      sel = sel || {}; var cc = /^[A-Z]{2}$/.test(sel.country || "") ? sel.country : (/^g\d+:/.test(sel.country || "") ? sel.country : null);
      api.sel = { country: cc, state: cc && sel.state ? String(sel.state) : null };
      hoverSel = null;
      if (!api.ready) return Promise.resolve();
      drawOverlays();
      var go = function () { if (fly) flyToSel(); };
      if (cc && /^[A-Z]{2}$/.test(cc)) {
        if (st.cc === cc) { go(); return Promise.resolve(st.file); }
        /* fly to the country at once; a state waits for its shape */
        if (!api.sel.state) go();
        return ensureStates(cc).then(function (f) { if (api.sel.state) go(); return f; });
      }
      ensureStates(null); go(); return Promise.resolve(null);
    };
    api.flyTo = flyToSel;
    api.resize = function () { if (widget) { widget.resize(); scene.requestRender(); } };
    api.destroy = function () { try { if (widget) widget.destroy(); } catch (e) {} widget = null; api.ready = false; };

    Promise.all([loadCesium(), loadBoundaries()]).then(function (r) {
      Cs = r[0];
      try {
        widget = new Cs.CesiumWidget(canvasBox, {
          baseLayer: false, skyBox: false, skyAtmosphere: false, scene3DOnly: true, shadows: false,
          requestRenderMode: true, maximumRenderTimeChange: Infinity, useBrowserRecommendedResolution: false,
          creditContainer: host.querySelector("[data-crg-credit]"),
          contextOptions: { webgl: { alpha: true, antialias: true, powerPreference: "low-power" } }
        });
      } catch (e) { api.failed = e; say("This device cannot draw the globe (WebGL is unavailable). Every number is still in the cards below."); if (opts.onReady) opts.onReady(api); return; }
      scene = widget.scene; camera = scene.camera;
      tokens();
      /* sharp on a retina phone without paying for 3x: at most two device pixels per CSS pixel */
      var dpr = window.devicePixelRatio || 1; widget.resolutionScale = Math.min(dpr, 2) / dpr;
      scene.backgroundColor = Cs.Color.TRANSPARENT;
      var g = scene.globe; g.baseColor = C.earth; g.showGroundAtmosphere = false;
      /* DEPTH: one soft light from just above-left of the viewer, so the sphere shades toward its limb at every zoom
         (no sun, no night side, no texture: a grey sphere) */
      g.enableLighting = true; g.lightingFadeOutDistance = 1e10; g.lightingFadeInDistance = 2e10; g.dynamicAtmosphereLighting = false;
      var light = new Cs.DirectionalLight({ direction: new Cs.Cartesian3(0, 0, -1), intensity: 2.2 }); scene.light = light;
      var lr = new Cs.Cartesian3(), lu = new Cs.Cartesian3();
      scene.preRender.addEventListener(function () {
        Cs.Cartesian3.multiplyByScalar(camera.rightWC, 0.32, lr); Cs.Cartesian3.multiplyByScalar(camera.upWC, -0.38, lu);
        var d = Cs.Cartesian3.add(camera.directionWC, lr, light.direction); Cs.Cartesian3.add(d, lu, d); Cs.Cartesian3.normalize(d, d);
      });
      g.showSkirts = false; g.depthTestAgainstTerrain = false;
      if (scene.sun) scene.sun.show = false; if (scene.moon) scene.moon.show = false;
      scene.fog.enabled = false;
      var ctl = scene.screenSpaceCameraController; ctl.enableTilt = false; ctl.enableLook = false;
      ctl.minimumZoomDistance = 1.2e5; ctl.maximumZoomDistance = 4.5e7;
      occluder = new Cs.EllipsoidalOccluder(Cs.Ellipsoid.WGS84, camera.positionWC); scratch2 = new Cs.Cartesian2();
      buildCountries(r[1]);
      homeView(0);
      scene.postRender.addEventListener(function () { if (needRecolor && fills && fills.ready && (!st.fills || st.fills.ready) && (!borders || borders.ready)) { recolor(); scene.requestRender(); } if (tipSel) positionTip(); });
      var h = new Cs.ScreenSpaceEventHandler(scene.canvas);
      h.setInputAction(function (e) {
        var hit = pickAt(e.position); hoverSel = null;
        if (!hit) return;
        var next = nextFromTap(hit);
        if (opts.onSelect) opts.onSelect(next); else api.select(next, true);
      }, Cs.ScreenSpaceEventType.LEFT_CLICK);
      /* a mouse gets a hover label for a country with data; one pick per animation frame at most */
      var pending = null, raf = 0;
      h.setInputAction(function (e) {
        if (!(window.matchMedia && matchMedia("(hover: hover)").matches)) return;
        pending = e.endPosition; if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0; var hit = pending ? pickAt(pending) : null, c = hit && !hit.state && hit.country !== api.sel.country && valueOf(hit.country) ? { country: hit.country, state: null } : null;
          if ((c && c.country) !== (hoverSel && hoverSel.country)) { hoverSel = c; placeTip(); scene.requestRender(); }
        });
      }, Cs.ScreenSpaceEventType.MOUSE_MOVE);
      if (window.ResizeObserver) new ResizeObserver(function () { api.resize(); }).observe(host);
      api.ready = true; say("");
      var first = api.sel; drawOverlays();
      if (first.country) api.select(first, false).then(flyToSel);
      if (opts.onReady) opts.onReady(api);
    }).catch(function (e) { api.failed = e; say("The globe did not load (" + (e && e.message || e) + "). Every number is still in the cards below."); if (opts.onReady) opts.onReady(api); });
    return api;
  }
  window.CR.analyticsGlobe = { mount: mount, lonLat: lonLat, deg: deg, loadAdmin1: loadAdmin1, matchRegions: matchRegions, fitBox: fitBox, norm: norm };
})();
