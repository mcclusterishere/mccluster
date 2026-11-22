/* TEST-ONLY transport adapter for the isolated owner-AI staging server.
   Never include this file in control.html or a production deployment.
   The server must enforce its random HttpOnly session gate BEFORE serving
   this file, the page, assets, auth endpoints, or API requests. */
(function () {
  "use strict";
  var marker = document.querySelector('meta[name="mccluster-staging"]');
  if (!marker || marker.content !== "owner-ai-isolated-runtime") throw new Error("Staging adapter requires the isolated staging page.");

  var nativeFetch = window.fetch.bind(window);
  var API = "https://api.mccluster.org";
  var DATABASE = "https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  /* No fake tool responses are produced in this adapter. The same page
     calls the real staging HTTP/Core/Postgres harness, with its original
     request method, headers and body. Only the two canonical origins move. */
  window.fetch = async function (input, options) {
    var inputUrl = input && typeof input === "object" && input.url ? input.url : String(input);
    var parsed = new URL(inputUrl, location.href);
    if (parsed.origin === API || parsed.origin === DATABASE) {
      var mapped = location.origin + parsed.pathname + parsed.search;
      if (typeof Request !== "undefined" && input instanceof Request) {
        var request = new Request(input, options);
        return nativeFetch(mapped, {
          method: request.method, headers: request.headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
          credentials: "same-origin", cache: "no-store", redirect: "error",
          referrerPolicy: "no-referrer", signal: request.signal
        });
      }
      return nativeFetch(mapped, Object.assign({}, options || {}, { credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" }));
    }
    if (parsed.origin === location.origin && /^https?:$/.test(parsed.protocol)) return nativeFetch(input, options);
    /* A secondary product integration must never escape to production from
       this demonstration, even if its normal module is loaded by Control. */
    return new Response(JSON.stringify({ error: "This integration is not connected in isolated staging." }), { status: 503, headers: { "content-type": "application/json" } });
  };

  function mount() {
    var banner = document.createElement("aside");
    banner.id = "ownerAiStagingBanner";
    banner.setAttribute("role", "status");
    banner.textContent = "Staging: synthetic owner/member identities, simulated Mac workers and synthetic model output; real SQL, enrollment, signed heartbeats and leases.";
    document.body.insertBefore(banner, document.body.firstChild);
    /* These controls belong to the staging harness, outside the product.
       They launch the root server's signed test worker only after the owner
       explicitly supplies a real one-time Core enrollment credential. */
    var workers = document.createElement("details"); workers.id = "ownerAiStagingWorkers";
    var summary = document.createElement("summary"); summary.textContent = "Test-worker controls"; workers.appendChild(summary);
    var instructions = document.createElement("p"); instructions.textContent = "Use Devices → Add this device to create a Mac enrollment. Copy its single-use credential here to install a simulated Mac worker on the isolated test server. This does not install anything on your laptop or prove physical Mac performance."; workers.appendChild(instructions);
    var nameLabel = document.createElement("label"); nameLabel.textContent = "Test worker name";
    var nameInput = document.createElement("input"); nameInput.id = "stagingWorkerName"; nameInput.className = "cr-input"; nameInput.maxLength = 80; nameInput.value = "Staging iMac"; nameInput.autocomplete = "off"; nameLabel.appendChild(nameInput); workers.appendChild(nameLabel);
    var credentialLabel = document.createElement("label"); credentialLabel.textContent = "One-time enrollment credential";
    var credentialInput = document.createElement("input"); credentialInput.id = "stagingWorkerCredential"; credentialInput.className = "cr-input"; credentialInput.type = "password"; credentialInput.autocomplete = "off"; credentialInput.spellcheck = false; credentialLabel.appendChild(credentialInput); workers.appendChild(credentialLabel);
    var install = document.createElement("button"); install.type = "button"; install.className = "cr-btn cr-btn--primary"; install.id = "stagingInstallWorker"; install.textContent = "Install simulated Mac worker"; workers.appendChild(install);
    var workerStatus = document.createElement("p"); workerStatus.id = "stagingWorkerStatus"; workerStatus.setAttribute("role", "status"); workerStatus.textContent = "Sign in with the owner test identity first. The credential is sent once, in the protected request body, then cleared."; workers.appendChild(workerStatus);
    banner.insertAdjacentElement("afterend", workers);
    install.addEventListener("click", async function () {
      var displayName = nameInput.value.trim(), enrollment = credentialInput.value.trim();
      if (!displayName || !/^mcen1_[A-Za-z0-9_-]{43}$/.test(enrollment)) { workerStatus.textContent = "Name the test worker and paste the single-use credential from Devices."; return; }
      credentialInput.value = ""; install.disabled = true; workerStatus.textContent = "Installing the signed test worker…";
      try {
        var token = window.MCC_SUPA && await window.MCC_SUPA.token();
        if (!token) throw new Error("Sign in with the owner test identity, then create a fresh enrollment if needed.");
        var response = await window.fetch("/__staging/workers", { method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ display_name: displayName, credential: enrollment }) });
        enrollment = "";
        if (!response.ok) throw new Error(response.status === 403 ? "Only the owner test identity can install a worker." : "Test worker installation was refused (HTTP " + response.status + "). Check that the enrollment credential has not expired or already been used.");
        workerStatus.textContent = "Simulated Mac worker installed. Open Devices and choose Refresh devices to see its signed heartbeat, then Test device. Repeat with a new enrollment for the second worker.";
      } catch (error) { workerStatus.textContent = error.message || "Test worker installation failed. Create a fresh enrollment and try again."; }
      finally { enrollment = ""; credentialInput.value = ""; install.disabled = false; }
    });
    function clearCredential() { credentialInput.value = ""; }
    window.addEventListener("mcc:auth-changed", clearCredential);
    window.addEventListener("storage", function (event) { if (!event.key || event.key === "mccdb_session") clearCredential(); });
    window.addEventListener("pagehide", clearCredential);
    document.querySelectorAll(".cr-env").forEach(function (item) { item.textContent = "STAGING"; });
    var gate = document.getElementById("cpGate"), email = document.getElementById("cpEmail"), password = document.getElementById("cpPass"), signIn = document.getElementById("cpIn");
    if (!gate || !email || !password || !signIn) return;
    var title = gate.querySelector("h1"), explanation = gate.querySelector("p");
    if (title) title.textContent = "Owner AI staging";
    if (explanation) explanation.textContent = "This access-code protected test environment uses synthetic accounts. Choose an identity below. Do not enter your real account password.";
    email.readOnly = true; email.autocomplete = "off"; email.value = "owner@staging.invalid";
    password.type = "hidden"; password.value = "staging-fixture"; password.autocomplete = "off";
    signIn.textContent = "Open owner test session";
    var identities = document.createElement("div"); identities.className = "owner-ai-staging-identities";
    ["owner", "member"].forEach(function (role) {
      var button = document.createElement("button"); button.type = "button"; button.className = "cr-btn";
      button.setAttribute("data-staging-role", role); button.textContent = role === "owner" ? "Owner test identity" : "Member test identity";
      button.addEventListener("click", function () {
        email.value = role + "@staging.invalid"; password.value = "staging-fixture";
        signIn.textContent = "Open " + role + " test session";
      });
      identities.appendChild(button);
    });
    gate.insertBefore(identities, email.parentElement);
    if (!location.hash) history.replaceState(null, "", location.pathname + "#home:ask");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
