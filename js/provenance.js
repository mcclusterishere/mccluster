/* ============================================================
   PROVENANCE — the camera's signature, shown where the work is.

   Content Credentials (C2PA) is the standard Adobe, Sony, Nikon,
   Leica and the AP settled on: the camera signs the frame at
   capture and the signature rides inside the file. It is what
   NFTs claimed to do and never did — evidence that this camera,
   in these hands, made this picture, checkable by a stranger at
   contentcredentials.org/verify.

   TWO RULES HERE.

   It costs nothing when there is nothing to say. Which files
   carry a signature is decided at build time by
   scripts/scan-provenance.mjs and shipped as one small JSON, so
   no visitor range-requests a single photograph to find out. If
   that file lists nothing signed, this module exits and never
   touches the DOM.

   It never claims what it cannot show. An unsigned photograph
   gets no badge and no apology — absence of a credential is not
   evidence of anything, and stamping "unverified" across a
   portfolio would say something false about work that is real.
   The badge appears only where a signature actually exists, and
   sends the viewer to the independent verifier rather than
   asking them to take this site's word for it.

   Turn it on at the source: Sony A7R V, Menu > Setup > Content
   Credentials. Every frame shot after that arrives signed, the
   build scan finds it, and these badges light up on their own.
   ============================================================ */
(function () {
  "use strict";

  var VERIFY = "https://contentcredentials.org/verify?source=";

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  /* walls pages sit a directory down and address images as ../assets/…,
     while the manifest keys are always root-relative */
  function keyOf(img) {
    var src = img.getAttribute("src") || "";
    if (!src || /^(data:|blob:|https?:)/i.test(src)) {
      // an absolute URL on our own origin still resolves to a repo path
      try {
        var u = new URL(img.src, location.href);
        if (u.origin !== location.origin) return "";
        return u.pathname.replace(/^\//, "");
      } catch (e) { return ""; }
    }
    return src.replace(/^\.\//, "").replace(/^(\.\.\/)+/, "").split("?")[0];
  }

  var MARK = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 3l7.5 3v5.4c0 4.3-3 8.2-7.5 9.6-4.5-1.4-7.5-5.3-7.5-9.6V6z"/>'
    + '<path d="M8.9 12.2l2.1 2.1 4.1-4.4"/></svg>';

  ready(function () {
    fetch("provenance.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var signed = d && d.signed;
        // nothing signed yet: say nothing, do nothing, cost nothing
        if (!signed || !Object.keys(signed).length) return;

        var badged = 0;
        function mark(img) {
          var k = keyOf(img);
          if (!k || !signed[k] || img.dataset.provenance) return;
          img.dataset.provenance = "1";

          var host = img.closest("figure") || img.parentNode;
          if (!host) return;
          if (getComputedStyle(host).position === "static") host.style.position = "relative";

          var a = document.createElement("a");
          a.className = "provmark";
          a.href = VERIFY + encodeURIComponent(new URL(img.src, location.href).href);
          a.target = "_blank";
          a.rel = "noopener";
          a.title = "Signed at capture. Check this frame independently.";
          a.innerHTML = MARK + "<span>Content Credentials</span>";
          a.addEventListener("click", function (e) {
            e.stopPropagation();   // never trip the lightbox underneath
            if (window.MCC_TRACK) window.MCC_TRACK("provenance_verify", { file: k });
          });
          host.appendChild(a);
          badged++;
        }

        /* The gallery paints its grid from JS and the walls stream frames in,
           so a single pass at load would badge whatever happened to exist at
           that instant and silently miss the rest. Sweeping is idempotent —
           a marked image carries data-provenance and is skipped — so it can
           safely run again on every batch the page adds. */
        function sweep() { [].forEach.call(document.images, mark); }
        sweep();
        if (window.MutationObserver) {
          new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
        }
        if (badged && window.MCC_TRACK) window.MCC_TRACK("provenance_shown", { frames: badged });
      })
      .catch(function () {});
  });
})();
