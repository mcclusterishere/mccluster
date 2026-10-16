/* THE ANALYTICS GLOBE: one charcoal Earth for the owner's analytics.
   (owner, 2026-10-15: "a custom globe of exactly the real globe, segmented
   like this (country borders). Charcoal interface. Select the globe, select
   locations, go there on the globe to see what analytics exist there.")

   One Cesium instance (a CesiumWidget, not a second World): the same Cesium
   release the World loads (js/action-globe.js, 1.131 from cesium.com), but no
   imagery at all, so no paid map and no ion: a solid charcoal ellipsoid, the
   Natural Earth 1:110m country polygons (data/geo/country-boundaries-110m.json,
   public domain) with lighter borders and a faint graticule. Rendering is on
   demand (requestRenderMode): nothing draws unless the camera moves or the
   data changes, so an idle phone is idle.

   It draws only what the panel hands it, already aggregated to COUNTRY and
   already folded (under 5 is never drawn; js/control-room/analytics.js):
     choropleth   country fill by value bucket (5-10 / 10-100 / 100+)
     points       a glow at the country's Natural Earth label point, only for a
                  country that has one (never a made-up place, never 0,0)
     arcs         great circles from the origin country to each drawn country,
                  both ends real label points
     cells        intel 10-degree cells, drawn as cells, never as points
   A tap on a country selects it (the panel's country filter follows), and
   the panel can select a country and fly there. */
(function () {
  "use strict";
  window.CR = window.CR || {};
  var CESIUM_BASE = "https://cesium.com/downloads/cesiumjs/releases/1.131/Build/Cesium/";
  var BOUNDARIES = "data/geo/country-boundaries-110m.json";
  var C = {
    space: "#0b0b0d", earth: "#121316", land: "#26282d", border: "#5d626c", graticule: "#ffffff",
    lo: "#7a1f29", mid: "#d42032", hi: "#ff2b3c", sel: "#ff3346", arc: "#ff3347"
  };
  var cesiumPromise = null, boundaryPromise = null;

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
    if (!boundaryPromise) boundaryPromise = fetch(BOUNDARIES).then(function (r) { if (!r.ok) throw new Error("boundaries " + r.status); return r.json(); })
      .catch(function (e) { boundaryPromise = null; throw e; });
    return boundaryPromise;
  }
  /* a degree is a real number or nothing; 0,0 is never a place */
  function deg(v) { if (v === null || v === undefined || v === "" || typeof v === "boolean" || Array.isArray(v)) return null; var x = Number(v); return isFinite(x) ? x : null; }
  function lonLat(lon, lat) { var x = deg(lon), y = deg(lat); return x === null || y === null || Math.abs(y) > 90 || Math.abs(x) > 180 || (x === 0 && y === 0) ? null : [x, y]; }
  /* the legend's buckets; a value under the panel's floor (5) never reaches here */
  function bucket(v) { v = Number(v) || 0; return v >= 100 ? 3 : v >= 10 ? 2 : v > 0 ? 1 : 0; }
  function reducedMotion() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }
  function glowImage() {
    var c = document.createElement("canvas"), s = 64; c.width = c.height = s;
    var g = c.getContext("2d"), grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, "rgba(255,240,240,1)"); grd.addColorStop(0.18, "rgba(255,70,85,0.95)");
    grd.addColorStop(0.45, "rgba(255,43,60,0.35)"); grd.addColorStop(1, "rgba(255,43,60,0)");
    g.fillStyle = grd; g.fillRect(0, 0, s, s); return c;
  }

  function mount(host, opts) {
    opts = opts || {};
    var api = { ready: false, failed: null, data: { mode: "countries", points: [], cells: [], selected: null, origin: null } };
    host.innerHTML = '<div class="crg-canvas" data-crg-canvas></div><div class="crg-credit" hidden data-crg-credit></div>' +
      '<div class="crg-tip" role="status" aria-live="polite" hidden data-crg-tip><b></b><span></span></div>' +
      '<p class="crg-msg" data-crg-msg>Loading the globe…</p>';
    var canvasBox = host.querySelector("[data-crg-canvas]"), tip = host.querySelector("[data-crg-tip]"), msg = host.querySelector("[data-crg-msg]");
    var Cs, widget, scene, camera, fills = null, instancesByCode = {}, countries = [], bboxByCode = {};
    var pointLayer = null, arcLayer = null, cellLayer = null, hoverCode = null, tipCode = null, tipCart = null, occluder = null, scratch2 = null;

    function say(t) { if (!msg) return; msg.textContent = t || ""; msg.hidden = !t; }
    function colorFor(code) {
      var p = valueOf(code);
      if (code && code === api.data.selected) return C.sel;
      if (!p) return C.land;
      var b = bucket(p.value);
      return b === 3 ? C.hi : b === 2 ? C.mid : C.lo;
    }
    function valueOf(code) { if (!code) return null; for (var i = 0; i < api.data.points.length; i++) if (api.data.points[i].code === code) return api.data.points[i]; return null; }
    var needRecolor = false;
    function recolor() {
      if (!fills || !fills.ready) { needRecolor = true; return; }
      needRecolor = false;
      Object.keys(instancesByCode).forEach(function (code) {
        var col = Cs.ColorGeometryInstanceAttribute.toValue(Cs.Color.fromCssColorString(colorFor(code)));
        instancesByCode[code].forEach(function (id) { var a = fills.getGeometryInstanceAttributes(id); if (a) a.color = col; });
      });
    }
    function buildCountries(geo) {
      var inst = [], lines = [], seq = 0;
      countries = geo.countries || [];
      countries.forEach(function (c) {
        var code = c.c || ("_" + (seq++)), w = 180, s = 90, e = -180, n = -90;
        (c.p || []).forEach(function (poly, pi) {
          var outer = poly[0]; if (!outer || outer.length < 6) return;
          for (var k = 0; k < outer.length; k += 2) { w = Math.min(w, outer[k]); e = Math.max(e, outer[k]); s = Math.min(s, outer[k + 1]); n = Math.max(n, outer[k + 1]); }
          var id = "c|" + code + "|" + pi;
          /* Antarctica's ring runs along the pole; it is drawn as borders only */
          if (code !== "AQ") {
            inst.push(new Cs.GeometryInstance({
              id: id,
              geometry: new Cs.PolygonGeometry({
                polygonHierarchy: new Cs.PolygonHierarchy(Cs.Cartesian3.fromDegreesArray(outer), poly.slice(1).map(function (h) { return new Cs.PolygonHierarchy(Cs.Cartesian3.fromDegreesArray(h)); })),
                height: 1200, granularity: Cs.Math.RADIANS_PER_DEGREE * 1.5, vertexFormat: Cs.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT
              }),
              attributes: { color: Cs.ColorGeometryInstanceAttribute.fromColor(Cs.Color.fromCssColorString(C.land)) }
            }));
            (instancesByCode[code] = instancesByCode[code] || []).push(id);
          }
          poly.forEach(function (ring) {
            var h = []; for (var k = 0; k < ring.length; k += 2) h.push(ring[k], ring[k + 1], 6000);
            h.push(ring[0], ring[1], 6000);
            lines.push(new Cs.GeometryInstance({ geometry: new Cs.PolylineGeometry({ positions: Cs.Cartesian3.fromDegreesArrayHeights(h), width: 1, arcType: Cs.ArcType.RHUMB, vertexFormat: Cs.PolylineColorAppearance.VERTEX_FORMAT }),
              attributes: { color: Cs.ColorGeometryInstanceAttribute.fromColor(Cs.Color.fromCssColorString(C.border).withAlpha(0.85)) } }));
          });
        });
        if (c.c) bboxByCode[c.c] = [w, s, e, n];
      });
      /* a faint graticule every 30 degrees */
      for (var lon = -180; lon < 180; lon += 30) { var mer = []; for (var la = -80; la <= 80; la += 5) mer.push(lon, la, 4000); lines.push(gline(mer)); }
      for (var lat = -60; lat <= 60; lat += 30) { var par = []; for (var lo = -180; lo <= 180; lo += 5) par.push(lo, lat, 4000); lines.push(gline(par)); }
      fills = scene.primitives.add(new Cs.Primitive({ geometryInstances: inst, appearance: new Cs.PerInstanceColorAppearance({ flat: true, translucent: false }), asynchronous: false, releaseGeometryInstances: true }));
      scene.primitives.add(new Cs.Primitive({ geometryInstances: lines, appearance: new Cs.PolylineColorAppearance({ translucent: true }), asynchronous: false }));
    }
    function gline(arr) {
      return new Cs.GeometryInstance({ geometry: new Cs.PolylineGeometry({ positions: Cs.Cartesian3.fromDegreesArrayHeights(arr), width: 1, arcType: Cs.ArcType.NONE, vertexFormat: Cs.PolylineColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cs.ColorGeometryInstanceAttribute.fromColor(Cs.Color.fromCssColorString(C.graticule).withAlpha(0.06)) } });
    }
    function arcPositions(a, b) {
      var g = new Cs.EllipsoidGeodesic(Cs.Cartographic.fromDegrees(a[0], a[1]), Cs.Cartographic.fromDegrees(b[0], b[1]));
      var dist = g.surfaceDistance, top = Math.min(1.9e6, Math.max(1.5e5, dist * 0.11)), out = [], N = 48, c = new Cs.Cartographic();
      for (var i = 0; i <= N; i++) { var t = i / N; g.interpolateUsingFraction(t, c); out.push(Cs.Cartesian3.fromRadians(c.longitude, c.latitude, 8000 + Math.sin(Math.PI * t) * top)); }
      return out;
    }
    function drawOverlays() {
      if (!api.ready) return;
      if (pointLayer) { scene.primitives.remove(pointLayer); pointLayer = null; }
      if (arcLayer) { scene.primitives.remove(arcLayer); arcLayer = null; }
      if (cellLayer) { scene.primitives.remove(cellLayer); cellLayer = null; }
      var d = api.data, max = 1;
      d.points.forEach(function (p) { max = Math.max(max, Number(p.value) || 0); });
      api.placed = []; api.arcs = 0;
      if (d.mode === "cells") {
        var cells = (d.cells || []).filter(function (x) { return Array.isArray(x.bounds) && x.bounds.length === 4 && x.bounds.every(function (v) { return deg(v) !== null; }); });
        if (cells.length) cellLayer = scene.primitives.add(new Cs.Primitive({ asynchronous: false, appearance: new Cs.PerInstanceColorAppearance({ flat: true, translucent: true }),
          geometryInstances: cells.map(function (x) { var cm = Math.max(1, Number(cells[0].value) || 1);
            return new Cs.GeometryInstance({ id: "g|" + x.code, geometry: new Cs.RectangleGeometry({ rectangle: Cs.Rectangle.fromDegrees(x.bounds[0], x.bounds[1], x.bounds[2], x.bounds[3]), height: 9000, vertexFormat: Cs.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
              attributes: { color: Cs.ColorGeometryInstanceAttribute.fromColor(Cs.Color.fromCssColorString(x.code === d.selected ? C.sel : C.hi).withAlpha(0.25 + 0.5 * Math.sqrt((Number(x.value) || 0) / cm))) } }); }) }));
      } else {
        var bb = new Cs.BillboardCollection({ scene: scene }), img = glowImage(), placed = [];
        d.points.forEach(function (p) {
          var ll = lonLat(p.lon, p.lat); if (!ll) return; placed.push({ p: p, ll: ll });
          var r = 18 + 26 * Math.sqrt((Number(p.value) || 0) / max) * (p.code === d.selected ? 1.25 : 1);
          bb.add({ position: Cs.Cartesian3.fromDegrees(ll[0], ll[1], 9000), image: img, width: r, height: r, id: "c|" + p.code + "|pt" });
        });
        pointLayer = scene.primitives.add(bb);
        api.placed = placed.map(function (x) { return { code: x.p.code, lon: x.ll[0], lat: x.ll[1], value: x.p.value }; });
        var o = d.origin && lonLat(d.origin.lon, d.origin.lat);
        if (o) {
          var arcs = placed.filter(function (x) { return x.p.code !== d.origin.code; }).slice(0, 16).map(function (x) {
            return new Cs.GeometryInstance({ id: "a|" + x.p.code + "|arc", geometry: new Cs.PolylineGeometry({ positions: arcPositions(o, x.ll), width: 2.5, arcType: Cs.ArcType.NONE, vertexFormat: Cs.PolylineMaterialAppearance.VERTEX_FORMAT }) });
          });
          api.arcs = arcs.length;
          if (arcs.length) arcLayer = scene.primitives.add(new Cs.Primitive({ asynchronous: false, geometryInstances: arcs,
            appearance: new Cs.PolylineMaterialAppearance({ material: Cs.Material.fromType("PolylineGlow", { color: Cs.Color.fromCssColorString(C.arc).withAlpha(0.9), glowPower: 0.25, taperPower: 0.45 }) }) }));
        }
      }
      recolor(); placeTip(); scene.requestRender();
    }
    /* for the browser test: where a drawn country's label point is on the canvas (null when it faces away) */
    window.__craGlobeProject = function (code) {
      var p = valueOf(code), ll = p && lonLat(p.lon, p.lat); if (!api.ready || !ll) return null;
      var cart = Cs.Cartesian3.fromDegrees(ll[0], ll[1], 9000); occluder.cameraPosition = camera.positionWC;
      if (!occluder.isPointVisible(cart)) return null;
      var w = (Cs.SceneTransforms.worldToWindowCoordinates || Cs.SceneTransforms.wgs84ToWindowCoordinates)(scene, cart);
      return w ? { x: w.x, y: w.y } : null;
    };
    /* for the browser test, like the World's __huPlaced: what is drawn, where, and what the camera looks at */
    window.__craGlobe = function () {
      var c = api.ready ? Cs.Cartographic.fromCartesian(camera.positionWC) : null;
      return { ready: api.ready, failed: api.failed ? String(api.failed.message || api.failed) : null, countries: countries.length, placed: api.placed || [], arcs: api.arcs || 0, selected: api.data.selected,
        fill: function (code) { var ids = instancesByCode[code]; if (!ids || !fills || !fills.ready) return null; var a = fills.getGeometryInstanceAttributes(ids[0]); return a ? Array.prototype.slice.call(a.color) : null; },
        camera: c ? { lon: Cs.Math.toDegrees(c.longitude), lat: Cs.Math.toDegrees(c.latitude), height: c.height } : null, tip: tip.hidden ? null : tip.textContent };
    };
    /* the tooltip: the selected (or, with a mouse, the hovered) country, pinned to its label point */
    function placeTip() {
      var code = hoverCode || api.data.selected, p = code ? valueOf(code) : null, ll = p && lonLat(p.lon, p.lat);
      if (!code || !opts.tooltipFor) { tip.hidden = true; tipCode = null; return; }
      var t = opts.tooltipFor(code); if (!t) { tip.hidden = true; tipCode = null; return; }
      tip.querySelector("b").textContent = t.title; tip.querySelector("span").textContent = t.line;
      tipCode = code;
      if (!ll) { var bx = bboxByCode[code]; ll = bx ? [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2] : null; }
      tipCart = ll ? Cs.Cartesian3.fromDegrees(ll[0], ll[1], 9000) : null;
      positionTip();
    }
    function positionTip() {
      if (!tipCode || !tipCart) { tip.hidden = true; return; }
      occluder.cameraPosition = camera.positionWC;
      if (!occluder.isPointVisible(tipCart)) { tip.hidden = true; return; }
      var w = (Cs.SceneTransforms.worldToWindowCoordinates || Cs.SceneTransforms.wgs84ToWindowCoordinates)(scene, tipCart, scratch2);
      if (!w) { tip.hidden = true; return; }
      tip.hidden = false;
      var bw = host.clientWidth, x = Math.max(8, Math.min(bw - tip.offsetWidth - 8, w.x + 14)), y = Math.max(8, w.y - tip.offsetHeight / 2);
      tip.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    }
    function codeAt(pos) {
      var pk = scene.pick(pos), id = pk && (typeof pk.id === "string" ? pk.id : null);
      if (!id) return null;
      var m = /^[cga]\|([^|]+)\|/.exec(id);
      return m && m[1].charAt(0) !== "_" ? m[1] : null;
    }
    function flyTo(code) {
      if (!api.ready) return;
      var dur = reducedMotion() ? 0 : 1.2, p = valueOf(code), ll = p && lonLat(p.lon, p.lat);
      if (!code) { camera.flyTo({ destination: Cs.Cartesian3.fromDegrees(opts.home ? opts.home[0] : -60, opts.home ? opts.home[1] : 22, homeAltitude()), duration: dur }); return; }
      if (ll) { camera.flyTo({ destination: Cs.Cartesian3.fromDegrees(ll[0], ll[1] - 6, homeAltitude()), duration: dur }); return; }
      var bx = bboxByCode[code];
      if (bx) camera.flyTo({ destination: Cs.Cartesian3.fromDegrees((bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2, homeAltitude()), duration: dur });
    }
    /* the whole Earth fits the stage: Cesium's field of view spans the longer side, so the altitude follows the aspect */
    function homeAltitude() { var w = host.clientWidth || 390, h = host.clientHeight || 300; return 8.6e6 * Math.max(w, h) / Math.max(1, Math.min(w, h)); }

    api.setData = function (d) {
      api.data = { mode: d.mode === "cells" ? "cells" : "countries", points: (d.points || []).slice(0, 300), cells: (d.cells || []).slice(0, 2000), selected: d.selected || null, origin: d.origin || null };
      drawOverlays();
    };
    api.select = function (code, fly) { api.data.selected = code || null; drawOverlays(); if (fly) flyTo(code); };
    api.flyTo = flyTo;
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
      /* sharp on a retina phone without paying for 3x: at most two device pixels per CSS pixel */
      var dpr = window.devicePixelRatio || 1; widget.resolutionScale = Math.min(dpr, 2) / dpr;
      scene.backgroundColor = Cs.Color.TRANSPARENT;
      var g = scene.globe; g.baseColor = Cs.Color.fromCssColorString(C.earth); g.showGroundAtmosphere = false; g.enableLighting = false;
      g.showSkirts = false; g.depthTestAgainstTerrain = false;
      if (scene.sun) scene.sun.show = false; if (scene.moon) scene.moon.show = false;
      scene.fog.enabled = false;
      var ctl = scene.screenSpaceCameraController; ctl.enableTilt = false; ctl.enableLook = false;
      ctl.minimumZoomDistance = 1.2e6; ctl.maximumZoomDistance = 4.5e7;
      occluder = new Cs.EllipsoidalOccluder(Cs.Ellipsoid.WGS84, camera.positionWC); scratch2 = new Cs.Cartesian2();
      buildCountries(r[1]);
      camera.setView({ destination: Cs.Cartesian3.fromDegrees(opts.home ? opts.home[0] : -60, opts.home ? opts.home[1] : 22, homeAltitude()) });
      scene.postRender.addEventListener(function () { if (needRecolor && fills && fills.ready) { recolor(); scene.requestRender(); } if (tipCode) positionTip(); });
      var h = new Cs.ScreenSpaceEventHandler(scene.canvas);
      h.setInputAction(function (e) {
        var code = codeAt(e.position); hoverCode = null;
        if (!code) return;
        var next = code === api.data.selected ? null : code;
        api.data.selected = next; drawOverlays();
        if (opts.onSelect) opts.onSelect(next);
      }, Cs.ScreenSpaceEventType.LEFT_CLICK);
      /* a mouse gets a hover tooltip; one pick per animation frame at most */
      var pending = null, raf = 0;
      h.setInputAction(function (e) {
        if (!(window.matchMedia && matchMedia("(hover: hover)").matches)) return;
        pending = e.endPosition; if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; var c = pending ? codeAt(pending) : null; c = c && valueOf(c) ? c : null; if (c !== hoverCode) { hoverCode = c; placeTip(); scene.requestRender(); } });
      }, Cs.ScreenSpaceEventType.MOUSE_MOVE);
      if (window.ResizeObserver) new ResizeObserver(function () { api.resize(); }).observe(host);
      api.ready = true; say("");
      drawOverlays();
      if (opts.onReady) opts.onReady(api);
    }).catch(function (e) { api.failed = e; say("The globe did not load (" + (e && e.message || e) + "). Every number is still in the cards below."); if (opts.onReady) opts.onReady(api); });
    return api;
  }
  window.CR.analyticsGlobe = { mount: mount, bucket: bucket, lonLat: lonLat, deg: deg };
})();
