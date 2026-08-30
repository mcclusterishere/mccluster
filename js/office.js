/* THE OFFICE STRIP — six owner rooms, one back office.
   Injected on every owner page so the desks stop feeling like five
   separate sites. Same origin, same login (the session token lives in
   this browser); this strip is only navigation, never a gate. */
(function boot() {
  "use strict";
  var ROOMS = [
    ["admin.html", "Back Office"],
    ["crm.html",   "Front Desk"],
    ["desk.html",  "Outreach"],
    ["inbox.html", "Inbox"],
    ["vault.html", "Vault"],
    ["lanes.html", "Lanes"],
  ];
  var here = location.pathname.split("/").pop() || "";
  if (!ROOMS.some(function (r) { return r[0] === here; })) return;

  // loaded from <head>, so the body may not exist yet
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", boot);
    return;
  }

  var bar = document.createElement("nav");
  bar.setAttribute("aria-label", "The office");
  bar.style.cssText = "position:sticky;top:0;z-index:260;display:flex;gap:.25rem;" +
    "overflow-x:auto;padding:.5rem clamp(.8rem,3vw,1.4rem);background:rgba(10,8,7,.96);" +
    "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
    "border-bottom:1px solid rgba(244,239,230,.14)";
  bar.innerHTML = ROOMS.map(function (r) {
    var on = r[0] === here;
    return '<a href="' + r[0] + '" style="flex:0 0 auto;text-decoration:none;' +
      "font:800 .68rem 'Manrope',system-ui,sans-serif;letter-spacing:.08em;" +
      "text-transform:uppercase;border-radius:99px;padding:.45rem .85rem;" +
      (on ? "color:#fff;background:linear-gradient(165deg,#ff5a5c,#b3121b);"
          : "color:rgba(244,239,230,.75);box-shadow:inset 0 0 0 1px rgba(244,239,230,.18);") +
      '">' + r[1] + "</a>";
  }).join("");
  document.body.insertBefore(bar, document.body.firstChild);
})();
