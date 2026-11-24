/* THIS DEVICE AS A NODE (owner, 2026-11-24: "I should be able to log in any computer in any processing level, with
   any processing power, including possibly a phone ... Anything with a chip, you want it to do work.").

   The owner signs in on device.html and taps opt in. Two ways in, both through one grant from the gateway
   (core/src/compute/device-grant.mjs, POST /v1/compute/device-grants with the owner's session):
     - a computer that can run the full node (Mac, Windows, Linux) gets a one-line install with the grant in it;
       that node keeps working with the page closed;
     - any device at all, phones included, can be a node right here while the page is open: this module.

   The browser node speaks mccluster-compute/1 like every other node (core/src/compute/signature.mjs): its own
   Ed25519 key made by WebCrypto, kept non-extractable in IndexedDB (the private key never leaves the browser and
   is never shown), node id = "node_" + the first 32 hex of sha256(SPKI), every request signed over
   MCCLUSTER-COMPUTE-V1 / method / path / node / timestamp / nonce / sha256(body). It enrols once with the grant,
   then heartbeats what it measured (cores, memory, WebGPU) so the network sees it live.

   Work: a capability is advertised only when a runner for it exists in RUNNERS and the device can run it. Today
   the list is empty, so a browser node is live and measured but claims nothing: the scheduler never hands it a
   task it cannot do. Runners are added here (with their own tests) as browser workloads land. */
(function (root) {
  "use strict";
  var PROTOCOL = "mccluster-compute/1";
  var DB = "mcc-device-node", STORE = "identity";
  var RUNNERS = []; /* { capability, implementation, features, available(measured) -> bool, run(input) -> Promise<output> } */

  function b64url(bytes) {
    var s = "", a = new Uint8Array(bytes);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function hex(bytes) { return Array.prototype.map.call(new Uint8Array(bytes), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function pem(spki) {
    var b = b64url(spki).replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return "-----BEGIN PUBLIC KEY-----\n" + b.match(/.{1,64}/g).join("\n") + "\n-----END PUBLIC KEY-----\n";
  }
  var enc = new TextEncoder();
  function sha256(bytes) { return crypto.subtle.digest("SHA-256", bytes); }

  function canonical(method, path, nodeId, timestamp, nonce, digest) {
    return ["MCCLUSTER-COMPUTE-V1", method.toUpperCase(), path, nodeId, timestamp, nonce, digest].join("\n");
  }

  /* ---- identity in IndexedDB (CryptoKey objects; the private key is not extractable) ---- */
  function idb() {
    return new Promise(function (ok, no) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
    });
  }
  function idbDo(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (ok, no) {
        var tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { ok(req && req.result); db.close(); };
        tx.onerror = function () { no(tx.error); db.close(); };
      });
    });
  }
  function loadIdentity() { return idbDo("readonly", function (s) { return s.get("node"); }); }
  function saveIdentity(v) { return idbDo("readwrite", function (s) { return s.put(v, "node"); }); }
  function forgetIdentity() { return idbDo("readwrite", function (s) { return s.delete("node"); }); }

  function supported() {
    return !!(root.crypto && crypto.subtle && root.indexedDB && root.TextEncoder);
  }
  function newIdentity() {
    return crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]).then(function (pair) {
      return crypto.subtle.exportKey("spki", pair.publicKey).then(function (spki) {
        return sha256(spki).then(function (fp) {
          return { nodeId: "node_" + hex(fp).slice(0, 32), publicKeyPem: pem(spki), privateKey: pair.privateKey, enrolled: false };
        });
      });
    });
  }

  function signedHeaders(identity, method, path, bodyBytes) {
    var timestamp = new Date().toISOString(), nonce = crypto.randomUUID();
    return sha256(bodyBytes).then(function (d) {
      var digest = b64url(d);
      return crypto.subtle.sign({ name: "Ed25519" }, identity.privateKey, enc.encode(canonical(method, path, identity.nodeId, timestamp, nonce, digest))).then(function (sig) {
        return {
          "x-mccluster-compute-protocol": PROTOCOL, "x-mccluster-node-id": identity.nodeId, "x-mccluster-timestamp": timestamp,
          "x-mccluster-nonce": nonce, "x-mccluster-content-sha256": digest, "x-mccluster-signature": b64url(sig)
        };
      });
    });
  }

  /* ---- what this device has: measured, never guessed ---- */
  function measure() {
    var nav = root.navigator || {};
    var out = {
      platform: (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "browser",
      mobile: !!(nav.userAgentData && nav.userAgentData.mobile) || /Mobi|Android|iPhone|iPad/i.test(nav.userAgent || ""),
      cpu_count: Math.max(0, Math.min(4096, Number(nav.hardwareConcurrency) || 0)),
      /* navigator.deviceMemory is coarse (and capped at 8) where it exists at all */
      memory_bytes: nav.deviceMemory ? Math.round(nav.deviceMemory * 1073741824) : 0,
      gpu: null
    };
    if (!nav.gpu || !nav.gpu.requestAdapter) return Promise.resolve(out);
    return nav.gpu.requestAdapter().then(function (a) {
      if (!a) return out;
      var info = a.info || {};
      out.gpu = { vendor: String(info.vendor || "unknown"), model: String(info.architecture || info.device || info.description || "webgpu"), max_buffer_bytes: Number(a.limits && a.limits.maxBufferSize) || 0 };
      return out;
    }).catch(function () { return out; });
  }
  function inventory(m) {
    return {
      hostname: null, platform: "browser:" + String(m.platform).slice(0, 60), arch: null, cpu_count: m.cpu_count, memory_bytes: m.memory_bytes, disk_free_bytes: 0,
      gpus: m.gpu ? [{ vendor: m.gpu.vendor, model: m.gpu.model, vram_bytes: 0, compute: "webgpu", form: "unknown", memory: "shared", vram_source: "none" }] : []
    };
  }
  function capabilities(m) {
    return RUNNERS.filter(function (r) { try { return r.available(m); } catch (e) { return false; } }).map(function (r) {
      return { capability: r.capability, implementation: r.implementation, backend: "browser", version: "1", features: r.features || {}, max_concurrency: 1, min_vram_bytes: 0 };
    });
  }
  function labels(m) { return { trust: "owned", role: m.mobile ? "browser-phone" : "browser", site: "browser" }; }

  /* ---- the node ---- */
  function DeviceNode(opts) {
    this.computeUrl = String(opts.computeUrl || "https://compute.mccluster.org").replace(/\/$/, "");
    this.onState = opts.onState || function () {};
    this.fetch = opts.fetch || root.fetch.bind(root);
    this.timer = 0; this.identity = null; this.measured = null; this.running = false;
  }
  DeviceNode.prototype.call = function (path, body, extra) {
    var self = this, bytes = enc.encode(JSON.stringify(body || {}));
    var head = extra ? Promise.resolve(extra) : signedHeaders(self.identity, "POST", path, bytes);
    return head.then(function (h) {
      return self.fetch(self.computeUrl + path, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, h), body: bytes });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw Object.assign(new Error(j.error || j.message || ("Compute " + r.status)), { status: r.status, code: j.code });
        return j;
      });
    });
  };
  /* status without starting: is this browser already a node? */
  DeviceNode.prototype.status = function () {
    if (!supported()) return Promise.resolve({ supported: false });
    return loadIdentity().then(function (id) { return { supported: true, enrolled: !!(id && id.enrolled), nodeId: id ? id.nodeId : null }; });
  };
  /* opt in: a grant from the owner's session, then enrol (once) and start */
  DeviceNode.prototype.optIn = function (grant, orgId, displayName) {
    var self = this;
    if (!supported()) return Promise.reject(new Error("This browser cannot hold a node key"));
    return loadIdentity().then(function (id) { return id || newIdentity(); }).then(function (id) {
      self.identity = id;
      return measure();
    }).then(function (m) {
      self.measured = m;
      if (self.identity.enrolled) return null;
      return self.call("/v1/compute/enroll", {
        protocol: PROTOCOL, org_id: orgId, display_name: String(displayName || "browser node").slice(0, 160), public_key: self.identity.publicKeyPem,
        agent_version: "browser-node/1", inventory: inventory(m), capabilities: capabilities(m), labels: labels(m), max_leases: 1
      }, { "x-mccluster-enroll-grant": grant }).then(function () { self.identity.enrolled = true; return saveIdentity(self.identity); });
    }).then(function () { return self.start(); });
  };
  DeviceNode.prototype.start = function () {
    var self = this;
    if (self.running) return Promise.resolve();
    return loadIdentity().then(function (id) {
      if (!id || !id.enrolled) throw new Error("Not opted in yet");
      self.identity = id; self.running = true;
      return (self.measured ? Promise.resolve(self.measured) : measure()).then(function (m) { self.measured = m; return self.beat(); });
    });
  };
  DeviceNode.prototype.beat = function () {
    var self = this;
    if (!self.running) return Promise.resolve();
    var m = self.measured;
    return self.call("/v1/compute/heartbeat", { agent_version: "browser-node/1", inventory: inventory(m), capabilities: capabilities(m), labels: labels(m), max_leases: 1, load: { running_leases: 0 } })
      .then(function (r) { self.onState({ live: true, nodeId: self.identity.nodeId, measured: m, capabilities: capabilities(m), at: r.server_time }); },
        function (err) {
          self.onState({ live: false, nodeId: self.identity.nodeId, measured: m, error: err.message, code: err.code });
          if (err.code === "UNKNOWN_NODE" || err.code === "NODE_REVOKED") { self.stop(); return forgetIdentity(); }
        })
      .then(function () { if (self.running) self.timer = setTimeout(function () { self.beat(); }, document.hidden ? 60000 : 30000); });
  };
  DeviceNode.prototype.stop = function () { this.running = false; clearTimeout(this.timer); };
  /* leave: stop and forget the key here (the owner revokes the node in Control) */
  DeviceNode.prototype.leave = function () { this.stop(); return forgetIdentity(); };

  var api = { DeviceNode: DeviceNode, measure: measure, supported: supported, RUNNERS: RUNNERS, _test: { canonical: canonical, pem: pem, b64url: b64url, inventory: inventory, capabilities: capabilities, labels: labels } };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MCC_DEVICE_NODE = api;
})(typeof self !== "undefined" ? self : this);
