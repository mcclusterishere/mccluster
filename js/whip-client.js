/* A TINY WHIP CLIENT (RFC 9725, WebRTC-HTTP Ingestion Protocol).

   Publish a camera/microphone MediaStream to a WHIP endpoint (Cloudflare
   Stream's webRTC.url) with nothing but the browser's RTCPeerConnection:
     1. one sendonly transceiver per track;
     2. the SDP offer, with ICE candidates gathered (no trickle), POSTed as
        application/sdp to the WHIP URL;
     3. 201 Created + the SDP answer; its Location is the session resource;
     4. DELETE on that resource ends the publish.
   No dependency, no vendored SDK. js/mnet-live.js carries the same few
   lines inline for the live rooms; this is the reusable copy.

   The WHIP URL is a credential (Stream: "anyone with this URL can stream
   live video to this input"): it is held in memory only, never logged,
   never stored. Camera and microphone only: this never asks for the screen. */
(function (root) {
  "use strict";

  function waitForIce(pc, ms) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; pc.removeEventListener("icegatheringstatechange", check); resolve(); } }
      function check() { if (pc.iceGatheringState === "complete") finish(); }
      pc.addEventListener("icegatheringstatechange", check);
      setTimeout(finish, ms || 2500);
    });
  }

  function publish(stream, whipUrl, opts) {
    opts = opts || {};
    var doFetch = opts.fetchImpl || root.fetch.bind(root);
    var Peer = opts.RTCPeerConnection || root.RTCPeerConnection;
    if (!Peer) return Promise.reject(new Error("This browser cannot go live (no WebRTC)."));
    var pc = new Peer({ bundlePolicy: "max-bundle" });
    var resource = null, closed = false;
    stream.getTracks().forEach(function (t) { pc.addTransceiver(t, { direction: "sendonly", streams: [stream] }); });
    if (typeof opts.onState === "function") {
      pc.addEventListener("connectionstatechange", function () { opts.onState(pc.connectionState); });
    }
    return pc.createOffer()
      .then(function (offer) { return pc.setLocalDescription(offer); })
      .then(function () { return waitForIce(pc, opts.iceTimeoutMs); })
      .then(function () {
        return doFetch(whipUrl, { method: "POST", headers: { "content-type": "application/sdp" }, body: pc.localDescription.sdp });
      })
      .then(function (res) {
        if (res.status !== 201 && res.status !== 200) throw new Error("The live server refused the camera (" + res.status + ").");
        var loc = res.headers.get("location");
        resource = loc ? new URL(loc, whipUrl).toString() : null;
        return res.text();
      })
      .then(function (answer) { return pc.setRemoteDescription({ type: "answer", sdp: answer }); })
      .then(function () {
        return {
          pc: pc,
          resource: resource,
          connected: function () { return pc.connectionState === "connected"; },
          close: function () {
            if (closed) return Promise.resolve();
            closed = true;
            try { pc.close(); } catch (_) {}
            return resource ? doFetch(resource, { method: "DELETE" }).then(function () {}, function () {}) : Promise.resolve();
          }
        };
      })
      .catch(function (e) { try { pc.close(); } catch (_) {} throw e; });
  }

  var api = { publish: publish };
  root.MCC_WHIP = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
