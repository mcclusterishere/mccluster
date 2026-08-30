#!/usr/bin/env node
/* ============================================================
   SYNC A DEMO. Copies a client build into demos/<slug>/ so the
   sales page can show it from this domain, on our terms, forever.

   Why a copy and not a link: a client can move, redesign, or take
   their site private. A vendored demo never goes dark, never
   shows a prospect a half finished edit, and never leaks a real
   login. It is a frozen showroom floor.

   Usage:
     node scripts/sync-demo.mjs <path-to-client-build> <slug>
   Example:
     node scripts/sync-demo.mjs ../Shiloh-Church-BPT-App shiloh

   What it does, in order:
     1. Copies only what the browser needs. Docs, build tooling,
        native wrappers, and template kits stay behind.
     2. Strips the service worker registration and deletes sw.js,
        so a demo can never install itself over this site or serve
        a stale cache from our origin.
     3. Drops the web manifest link, so nobody installs the demo
        thinking it is their own church app.
     4. Adds noindex, so the showroom copy never competes with the
        client's real site in search.
     5. Removes named demo accounts from data/config.json. A real
        person's email is not a sales prop.
   The church's public contact inbox gets the same treatment (scrubContactEmail).
     6. Writes demos/<slug>/DEMO.txt with the date and the source
        commit, so we always know how old the floor model is.
   ============================================================ */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [src, slug] = process.argv.slice(2);
if (!src || !slug) {
  console.error("usage: node scripts/sync-demo.mjs <path-to-client-build> <slug>");
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error("slug must be lowercase letters, numbers, and dashes");
  process.exit(1);
}


/* The church's own contact email is a real inbox too. The showroom swaps
   it for a demo address so no prospect ever mails the live church from a
   sales prop. Runs on every JSON data file in the copy. */
function scrubContactEmail(json) {
  return json.replace(/"email"\s*:\s*"[^"@]+@[^"]+"/g, '"email": "office@shilohdemo.example"');
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const from = path.resolve(src);
const to = path.join(root, "demos", slug);

if (!fs.existsSync(path.join(from, "index.html"))) {
  console.error("no index.html at " + from);
  process.exit(1);
}

/* Only the runtime travels. Everything else is ours to keep. */
const TAKE = ["index.html", "admin.html", "golive.html", "guide.html", "setup.html",
  "events.ics", "css", "js", "data", "assets"];

fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
let copied = 0;
for (const item of TAKE) {
  const s = path.join(from, item);
  if (!fs.existsSync(s)) continue;
  fs.cpSync(s, path.join(to, item), { recursive: true });
  copied++;
}

/* 2, 3, 4: make every page in the copy safe to serve from our origin. */
const pages = fs.readdirSync(to).filter((f) => f.endsWith(".html"));
for (const page of pages) {
  const p = path.join(to, page);
  let html = fs.readFileSync(p, "utf8");

  /* the service worker: registration block out, file gone */
  html = html.replace(/<script>\s*if \("serviceWorker" in navigator\)[\s\S]*?<\/script>/g,
    "<!-- service worker removed: a demo never installs itself -->");
  html = html.replace(/navigator\.serviceWorker\.register\([^)]*\)[^;]*;/g, "void 0;");

  /* the manifest: a prospect should not install the showroom */
  html = html.replace(/\s*<link rel="manifest"[^>]*>/g, "");

  /* noindex, and say plainly what this copy is */
  if (!/name="robots"/.test(html)) {
    html = html.replace(/<head>/i,
      '<head>\n  <meta name="robots" content="noindex, nofollow">\n  <!-- Demo copy served by McCluster Sites. The live site is the client\'s own. -->');
  }
  fs.writeFileSync(p, html);
}
fs.rmSync(path.join(to, "sw.js"), { force: true });

/* 5: no real person's login ships as a sales prop, and the showroom
   gets showroom keys. The client's real passcodes never leave their
   own repo. These are public on purpose: the demo holds no real data,
   so the back office is a feature to show, not a door to guard. */
const DEMO_PASS = "demo";
const cfgPath = path.join(to, "data", "config.json");
if (fs.existsSync(cfgPath)) {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  if (Array.isArray(cfg.demoStaff) && cfg.demoStaff.length) {
    cfg.demoStaff = [];
  }
  cfg.webhookUrl = "";
  if (cfg.adminPasscode) cfg.adminPasscode = DEMO_PASS;
  if (cfg.editorPasscode) cfg.editorPasscode = DEMO_PASS + "-editor";
  cfg.note = "DEMO COPY served from matthew.mccluster.org. Demo mode only: " +
    "everything a visitor does lives in their own browser and is never sent anywhere. " +
    "Named staff accounts are stripped and the passcodes are showroom keys, " +
    "set by scripts/sync-demo.mjs. The client's real passcodes stay in their own repo.";
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
}

/* 5c: the church's public contact inbox is a real inbox. Every JSON data
   file in the copy gets the demo address instead, so no prospect ever
   mails the live church from a sales prop. */
for (const jp of fs.readdirSync(path.join(to, "data")).filter((f) => f.endsWith(".json"))) {
  const full = path.join(to, "data", jp);
  const scrubbed = scrubContactEmail(fs.readFileSync(full, "utf8"));
  fs.writeFileSync(full, scrubbed);
}

/* 5b: the back office is the thing that sells the work, so do not make
   a prospect guess a passcode. Fill it in and say plainly why. */
const adminPath = path.join(to, "admin.html");
if (fs.existsSync(adminPath)) {
  let a = fs.readFileSync(adminPath, "utf8");
  a = a.replace(/<\/body>/i,
    '<script>\n' +
    '  /* demo copy: the showroom key is filled in so the back office is one tap */\n' +
    '  (function () {\n' +
    '    function seed() {\n' +
    '      var f = document.getElementById("gatePass");\n' +
    '      if (!f) return;\n' +
    '      if (!f.value) f.value = ' + JSON.stringify(DEMO_PASS) + ';\n' +
    '      var b = document.getElementById("gateBlurb");\n' +
    '      if (b) b.textContent = "Demo back office. The passcode is filled in, just press the button.";\n' +
    '    }\n' +
    '    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", seed);\n' +
    '    else seed();\n' +
    '    setTimeout(seed, 400);\n' +
    '  })();\n' +
    '</script>\n</body>');
  fs.writeFileSync(adminPath, a);
}

/* 6: stamp the floor model */
let stamp = "unknown";
try {
  stamp = execSync("git -C " + JSON.stringify(from) + " rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch { /* not a repo, fine */ }
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(to, "DEMO.txt"),
  "Demo copy of " + slug + "\nsynced: " + today + "\nsource commit: " + stamp +
  "\nrefresh: node scripts/sync-demo.mjs <path> " + slug + "\n");

const size = execSync("du -sh " + JSON.stringify(to), { encoding: "utf8" }).split("\t")[0];
console.log("demo synced: demos/" + slug + " (" + size.trim() + ", " + copied + " items, source " + stamp + ")");
console.log("point the ledger at it: \"url\": \"demos/" + slug + "/index.html\"");
