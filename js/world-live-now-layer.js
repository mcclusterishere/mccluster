/* THE WORLD'S "LIVE NOW" LAYER, by contract.

   Who is live doing a mission right now, as CITY pins (owner, 2026-10-15:
   city-level pins approved; never exact coordinates). The World's globe is
   owned elsewhere (PR #442); this file does not touch it. It is a
   self-contained layer the globe can mount:

     var layer = MCC_LIVE_NOW_LAYER.create({
       apiBase: "https://api.mccluster.org",   // default
       getToken: function () { return MCC_SUPA.token(); },  // optional; members see runs
       onUpdate: function (state) { ... },     // { pins, total_live, members, generated_at }
       intervalMs: 30000
     });
     layer.start();                 // poll; layer.stop() to end
     layer.attachCesium(viewer, Cesium);   // optional: draws its own entities, removes them on detach()

   Contract of GET /v1/live/now (workers/mccluster/src/live/index.js):
     public : { precision:'city', total_live, cells:[{city,region,country,lat,lng,live_count,missions[]}] }
     members: the same, plus runs:[{id,mission,city,region,country,lat,lng,live_since}]
   A pin is a city cell (0.1-degree centre). This module re-snaps every point
   to one decimal and drops any without a city, so even a wrong answer cannot
   draw a finer point. The public sees the pin and the count; a member taps
   a run and the page calls POST /v1/live/sessions/:id/watch for playback. */
(function (root) {
  "use strict";

  var API = "https://api.mccluster.org";
  /* null, "" and missing never become 0: no invented (0,0) pins */
  function snap(v) { if (v === null || v === undefined || v === "" || typeof v === "boolean") return null; var n = Number(v); return isFinite(n) ? Math.round(n * 10) / 10 : null; }

  function toPins(answer) {
    var a = answer && typeof answer === "object" ? answer : {};
    var runs = Array.isArray(a.runs) ? a.runs : [];
    var pins = [];
    (Array.isArray(a.cells) ? a.cells : []).forEach(function (c) {
      var lat = snap(c.lat), lng = snap(c.lng);
      if (!c || !c.city || lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      var here = runs.filter(function (r) { return r && r.city === c.city && snap(r.lat) === lat && snap(r.lng) === lng; })
        .map(function (r) { return { id: String(r.id), mission: String(r.mission || ""), live_since: r.live_since || null }; });
      pins.push({
        key: "live:" + lat + ":" + lng + ":" + c.city,
        kind: "live_now",
        precision: "city",
        city: String(c.city), region: c.region ? String(c.region) : "", country: c.country ? String(c.country) : "",
        lat: lat, lng: lng,
        live_count: Math.max(0, Number(c.live_count) || 0),
        missions: (Array.isArray(c.missions) ? c.missions : []).slice(0, 3).map(String),
        runs: here
      });
    });
    return { pins: pins, total_live: Math.max(0, Number(a.total_live) || 0), members: Boolean(a.members), generated_at: a.generated_at || null };
  }

  function label(pin) {
    return pin.live_count + " live · " + pin.city + (pin.missions.length ? " · " + pin.missions[0] : "");
  }

  function create(opts) {
    opts = opts || {};
    var base = String(opts.apiBase || API).replace(/\/+$/, "");
    var doFetch = opts.fetchImpl || (root.fetch ? root.fetch.bind(root) : null);
    var state = { pins: [], total_live: 0, members: false, generated_at: null };
    var timer = 0, cesium = null;

    function refresh() {
      var tokenP = typeof opts.getToken === "function" ? Promise.resolve(opts.getToken()).catch(function () { return null; }) : Promise.resolve(null);
      return tokenP.then(function (t) {
        var headers = t ? { authorization: "Bearer " + t } : {};
        return doFetch(base + "/v1/live/now", { headers: headers });
      }).then(function (res) {
        if (res.status === 503) return { cells: [], total_live: 0 };
        if (!res.ok) throw new Error("live now " + res.status);
        return res.json();
      }).then(function (j) {
        state = toPins(j);
        draw();
        if (typeof opts.onUpdate === "function") opts.onUpdate(state);
        return state;
      });
    }
    function start() { stop(); refresh().catch(function () {}); timer = setInterval(function () { refresh().catch(function () {}); }, Math.max(15000, opts.intervalMs || 30000)); }
    function stop() { if (timer) clearInterval(timer); timer = 0; }

    function draw() {
      if (!cesium) return;
      var v = cesium.viewer, C = cesium.Cesium;
      cesium.entities.forEach(function (e) { v.entities.remove(e); });
      cesium.entities = state.pins.map(function (p) {
        return v.entities.add({
          id: p.key,
          position: C.Cartesian3.fromDegrees(p.lng, p.lat),
          point: { pixelSize: 10 + Math.min(10, p.live_count * 2), color: C.Color.fromCssColorString("#ff3b47"), outlineColor: C.Color.WHITE, outlineWidth: 2 },
          label: { text: label(p), font: "600 14px system-ui, sans-serif", pixelOffset: new C.Cartesian2(0, -22), showBackground: true },
          properties: { live_now: true, runs: p.runs.map(function (r) { return r.id; }) }
        });
      });
    }
    function attachCesium(viewer, Cesium) { cesium = { viewer: viewer, Cesium: Cesium, entities: [] }; draw(); }
    function detach() { if (cesium) { cesium.entities.forEach(function (e) { cesium.viewer.entities.remove(e); }); cesium = null; } }

    return { refresh: refresh, start: start, stop: stop, attachCesium: attachCesium, detach: detach, state: function () { return state; } };
  }

  var api = { create: create, toPins: toPins, label: label };
  root.MCC_LIVE_NOW_LAYER = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
