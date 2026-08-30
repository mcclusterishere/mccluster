/* ============================================================
   THE SPATIAL STAGE.

   A viewer for volumetric captures of the product — 3D Gaussian
   Splatting, rendered through WebGPU where the browser has it.

   ---- WHAT THIS FILE HONESTLY IS, TODAY --------------------------------

   A frame with nothing in it yet, and it says so out loud rather than
   pretending. There is no splat of a shake because nobody has filmed
   one: 3DGS is CAPTURED, not authored and not generated. Until an asset
   is registered in data/shake-splats.json this renders nothing at all
   and the storefront below is untouched.

   That is deliberate. The alternative — shipping a fake 3D shake, a
   spinning stock model, a video loop dressed as volumetric — would be a
   lie told in the most expensive place on the page. An empty stage that
   explains itself is worth more than a full one that misleads.

   docs/spatial-commerce.md carries the capture spec: what to film, how
   to shoot it, and how to convert it. Once a .sog or .spz lands in the
   manifest, this lights up with no other change.

   ---- THE THREE TIERS -------------------------------------------------

     webgpu   the browser has WebGPU and an asset is registered → render
     flat     no asset, or no WebGPU → the storefront alone, no stage,
              no apology banner, no layout shift
     off      the visitor asked for reduced motion, or is on a metered
              connection → never even fetch the asset

   Tier is decided BEFORE anything heavy is fetched. A student ordering a
   shake at 11pm on campus wifi must not download eighty megabytes to
   find out their phone cannot render it.

   ---- WHAT IT WILL NOT DO --------------------------------------------

   It will never price anything. The till is
   supabase/functions/shake-order and its pricer, and the law there is
   that nothing the browser sends is a price. A 3D layer is a way of
   LOOKING at a product; it has no opinion about what the product costs.
   ============================================================ */
window.SHKVIEW = (function () {
  "use strict";

  var MANIFEST = "data/shake-splats.json";

  /* ---------- capability, cheaply and early ---------- */
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  /* Save-Data and a 2g effectiveType are the visitor telling us they are
     paying for this by the megabyte or waiting on it by the second. A
     volumetric capture is the single heaviest thing this site could ever
     serve, so it is the first thing to drop. */
  function metered() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    return /(^|-)2g$/.test(c.effectiveType || "");
  }

  function hasWebGPU() { return typeof navigator !== "undefined" && !!navigator.gpu; }

  /* navigator.gpu existing is not the same as an adapter being granted —
     a machine can expose the API and still refuse (blocklisted driver,
     no discrete GPU, headless). Ask properly, once. */
  var adapterPromise = null;
  function adapter() {
    if (!adapterPromise) {
      adapterPromise = hasWebGPU()
        ? navigator.gpu.requestAdapter().catch(function () { return null; })
        : Promise.resolve(null);
    }
    return adapterPromise;
  }

  /* ---------- WebXR, told the truth about ----------
     Quest and Pico expose navigator.xr and can enter immersive-ar.
     Safari on iOS never has: Apple's web AR path is AR Quick Look with a
     USDZ file, which is a different asset and a plain <a rel="ar"> link.
     Reporting "AR available" off navigator.xr alone would promise iPhone
     users a button that does nothing on the majority of the phones this
     shop actually serves. */
  function arSupport() {
    var out = { webxr: false, quicklook: false };
    try {
      var a = document.createElement("a");
      out.quicklook = a.relList && a.relList.supports && a.relList.supports("ar");
    } catch (e) {}
    if (!navigator.xr || !navigator.xr.isSessionSupported) return Promise.resolve(out);
    return navigator.xr.isSessionSupported("immersive-ar")
      .then(function (ok) { out.webxr = !!ok; return out; })
      .catch(function () { return out; });
  }

  /* ---------- the manifest ---------- */
  function manifest() {
    return fetch(MANIFEST, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* An entry only counts when it names a file. A manifest row with an
     empty `asset` is a placeholder describing a capture nobody has shot
     yet, and it must not be treated as content. */
  function assetFor(slug, m) {
    if (!m || !Array.isArray(m.captures)) return null;
    var hit = m.captures.find(function (c) { return c.slug === slug && c.asset; });
    return hit || null;
  }

  /* ---------- decide, then report ---------- */
  function decide(slug) {
    if (reducedMotion()) return Promise.resolve({ tier: "off", why: "reduced-motion" });
    if (metered()) return Promise.resolve({ tier: "off", why: "metered-connection" });
    return manifest().then(function (m) {
      var a = assetFor(slug, m);
      if (!a) return { tier: "flat", why: "no-capture-registered", manifest: m };
      return adapter().then(function (ad) {
        if (!ad) return { tier: "flat", why: hasWebGPU() ? "no-adapter" : "no-webgpu", capture: a };
        return { tier: "webgpu", capture: a, adapter: ad };
      });
    });
  }

  /* ---------- mount ----------
     Returns a promise resolving to the decision, so a page can log or
     test what happened. Mounting into a container that stays EMPTY on the
     flat tier is the point: no banner, no skeleton, no reserved space
     that collapses. The storefront is the fallback. */
  function mount(el, slug) {
    if (!el) return Promise.resolve({ tier: "flat", why: "no-container" });
    return decide(slug).then(function (d) {
      el.setAttribute("data-tier", d.tier);
      if (d.tier !== "webgpu") { el.hidden = true; return d; }
      el.hidden = false;
      /* The renderer is loaded ONLY here, on the one path that can use
         it — after WebGPU is confirmed and an asset is known to exist.
         No engine is vendored into this repo yet, because vendoring
         megabytes of renderer to display nothing would be the same
         mistake as shipping a fake capture. docs/spatial-commerce.md
         records which engine this is expected to be and why. */
      return import("./shake-splat-render.js")
        .then(function (mod) { return mod.render(el, d.capture, d.adapter).then(function () { return d; }); })
        .catch(function (err) {
          /* a renderer that fails is a flat page, never a broken one */
          el.hidden = true;
          el.setAttribute("data-tier", "flat");
          return { tier: "flat", why: "render-failed", error: String(err && err.message || err) };
        });
    });
  }

  return {
    mount: mount, decide: decide, arSupport: arSupport,
    caps: function () {
      return adapter().then(function (ad) {
        return {
          webgpu: hasWebGPU(), adapter: !!ad,
          reducedMotion: reducedMotion(), metered: metered(),
        };
      });
    },
  };
})();
