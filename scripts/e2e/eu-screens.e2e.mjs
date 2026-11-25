/* Equity Uprise building screens, end to end in a real browser. Local static server only; the owner check is
   answered by a fixture (no production call), and /equity-uprise-preview/ is served from the canonical sources the
   deploy copies there. Floor GLBs are used when they have been built (the floor builders); without them the demo
   runs on the Core V2 chassis plus screen panels.

   At 390px (phone) and 1440px (desktop):
     open the building -> pick a floor in TRAINING -> tap a screen on the canvas -> terminal -> diagnose and fix
     the floor's sandbox fault -> "Back to the building" lands on the same floor, pose and mode -> browser back
     works too -> MISSION "blind the floor" shows NO SIGNAL in MISSION and never in WORKPLACE -> every app renders
     at 390 with scrollWidth === clientWidth.
   Usage: node scripts/e2e/eu-screens.e2e.mjs [outDir] */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir, stat } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, normalize, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = process.argv[2] || join(ROOT, "e2e-out", "eu-screens");
await mkdir(OUT, { recursive: true });
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || "/opt/node-tools/node_modules", "x"))("playwright")); }

const P = "docs/design/equity-uprise-building/production/";
const PREVIEW_DIRS = [P + "lab-runtime/", P + "asset-registry/generated/", P + "electronics/generated/", P + "generated/", P + "electronics/"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".glb": "model/gltf-binary" };
async function resolvePath(p) {
  if (p.startsWith("/equity-uprise-preview/")) {
    const rest = p.slice("/equity-uprise-preview/".length);
    const name = basename(rest);
    for (const d of rest.startsWith("lab-runtime/") ? [P + "lab-runtime/"] : PREVIEW_DIRS) { const f = join(ROOT, d, name); if (existsSync(f)) return f; }
    return null;
  }
  return join(ROOT, p);
}
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, "http://local").pathname)).replace(/^([.][.][/\\])+/, "");
  try {
    const f = await resolvePath(p);
    if (!f || !(await stat(f)).isFile()) throw new Error("404");
    res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* third-party assets (three.js from jsdelivr, Google Fonts) are fetched once with curl and cached, so the browser
   never needs its own route to the internet */
const CACHE = join(OUT, ".cdn");
mkdirSync(CACHE, { recursive: true });
function cdn(url) {
  const f = join(CACHE, Buffer.from(url).toString("base64url").slice(0, 180));
  if (!existsSync(f)) writeFileSync(f, execFileSync("curl", ["-sSfL", "--max-time", "60", url], { maxBuffer: 64 << 20 }));
  return readFileSync(f);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: Boolean(ok), detail }); if (!ok) console.error("FAIL", name, detail); else console.log("ok  ", name); };

async function newContext(viewport) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, serviceWorkers: "block", reducedMotion: "reduce", deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.setItem("mccdb_session", JSON.stringify({ access_token: "fixture-owner", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600 })); });
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === BASE) return route.continue();
    if (u.hostname === "api.mccluster.org" && u.pathname === "/v1/status") return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"ok":true}' });
    if (["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"].includes(u.hostname)) {
      try { const body = cdn(u.href); const ct = u.hostname === "fonts.googleapis.com" ? "text/css" : u.pathname.endsWith(".woff2") ? "font/woff2" : "text/javascript"; return route.fulfill({ status: 200, contentType: ct, headers: { "access-control-allow-origin": "*" }, body }); }
      catch (e) { return route.abort(); }
    }
    if (u.hostname.endsWith("supabase.co")) return route.fulfill({ status: 401, body: "{}" });
    return route.abort();
  });
  return ctx;
}

const noOverflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const pose = (page) => page.evaluate(() => { const b = globalThis.__euBuilding; return { pos: b.camera.position.toArray(), target: b.controls.target.toArray(), floor: b.floor, mode: b.mode }; });
const near = (a, b, eps = 0.05) => a.every((v, i) => Math.abs(v - b[i]) < eps);

async function waitBuilding(page) { await page.waitForFunction(() => document.documentElement.dataset.buildingReady === "1", null, { timeout: 90000 }); await page.waitForTimeout(900); }
async function waitFloor(page, lv) { await page.waitForFunction((lv) => globalThis.__euBuilding && globalThis.__euBuilding.floor === lv && document.querySelector("[data-boot]").hidden, lv, { timeout: 90000 }); await page.waitForTimeout(900); }
async function waitApp(page) { await page.waitForFunction(() => document.documentElement.dataset.appReady === "1", null, { timeout: 60000 }); await page.waitForFunction(() => !document.querySelector("[data-boot]") || document.querySelector("[data-boot]").hidden, null, { timeout: 60000 }); }

async function run(label, viewport) {
  const ctx = await newContext(viewport);
  const page = await ctx.newPage();
  /* shared CI/agent machines can be slow with software WebGL: be patient rather than flaky */
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => { errors.push(String(e)); console.log("  [pageerror]", String(e).slice(0, 300)); });

  await page.goto(BASE + "/screens/building.html", { waitUntil: "domcontentloaded" });
  await waitBuilding(page);
  await page.screenshot({ path: join(OUT, `${label}-01-building.png`) });

  /* TRAINING on F6, then frame the IDF rack console from the floor's screen list */
  await page.click('[data-setmode="TRAINING"]');
  await page.click('[data-fl="F6"]');
  await waitFloor(page, "F6");
  await page.click("[data-list]");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${label}-01c-list.png`) });
  await page.click('[data-pick="SCR-F6-DESK-SYSTEMS-01"]');
  await page.waitForTimeout(1100);
  await page.click('[data-sheet] [data-grab], .sheet .grab').catch(() => {});
  /* a real canvas tap: project the screen's panel to pixels and tap it */
  const pt = await page.evaluate(() => {
    const b = globalThis.__euBuilding; const s = b.registry.screens.find((x) => x.screen_id === "SCR-F6-DESK-SYSTEMS-01");
    const m = b.hooks.proxies.get(s.screen_id) || (b.hooks.bound.get(s.screen_id) || [])[0];
    m.geometry.computeBoundingBox();
    const v = m.geometry.boundingBox.getCenter(new m.position.constructor()).applyMatrix4(m.matrixWorld).project(b.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  });
  await page.evaluate(() => { document.querySelector("[data-sheet]").dataset.open = "false"; });
  await page.waitForTimeout(350);
  if (viewport.width < 600) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('[data-sheet][data-open="true"] [data-open="SCR-F6-DESK-SYSTEMS-01"]', { timeout: 5000 });
  check(`${label}: canvas tap selects the screen`, true);
  await page.screenshot({ path: join(OUT, `${label}-02-screen-selected.png`) });
  const before = await pose(page);
  await page.click('[data-open="SCR-F6-DESK-SYSTEMS-01"]');
  await page.waitForURL(/screens\/terminal\.html\?screen=SCR-F6-DESK-SYSTEMS-01&mode=TRAINING&return=/, { timeout: 15000 });
  check(`${label}: enter URL encodes screen, mode and return`, true, page.url().slice(0, 120));
  await waitApp(page);
  const ov1 = await noOverflow(page);
  check(`${label}: terminal has no horizontal overflow`, ov1.sw === ov1.cw, JSON.stringify(ov1));
  await page.screenshot({ path: join(OUT, `${label}-03-terminal.png`) });

  const type = async (cmd) => { await page.fill("[data-in]", cmd); await page.press("[data-in]", "Enter"); await page.waitForTimeout(120); };
  await type("ticket");
  await type("show interfaces status");
  await page.screenshot({ path: join(OUT, `${label}-04-terminal-show.png`) });
  await page.fill("[data-in]", "show int"); await page.press("[data-in]", "Tab");
  check(`${label}: Tab completes`, /^show interface/.test(await page.inputValue("[data-in]")), await page.inputValue("[data-in]"));
  await page.fill("[data-in]", "");
  await type("cable test Gi1/0/13");
  await type("cable reseat Gi1/0/13");
  await type("ping f6-cam01");
  const text = await page.textContent("[data-term]");
  check(`${label}: sandbox fault diagnosed and fixed`, /TICKET RESOLVED/.test(text) && /Success rate is 100 percent/.test(text));
  await page.press("[data-in]", "ArrowUp");
  check(`${label}: history recall`, (await page.inputValue("[data-in]")) === "ping f6-cam01");
  await page.screenshot({ path: join(OUT, `${label}-05-terminal-fixed.png`) });

  /* Back to the building: same floor, pose and mode */
  await page.click("[data-back]");
  await page.waitForURL(/screens\/building\.html/, { timeout: 15000 });
  await waitBuilding(page);
  const after = await pose(page);
  check(`${label}: back lands on the same pose`, near(before.pos, after.pos) && near(before.target, after.target), JSON.stringify({ before, after }));
  check(`${label}: back keeps floor and mode`, after.floor === "F6" && after.mode === "TRAINING", JSON.stringify(after));
  await page.screenshot({ path: join(OUT, `${label}-06-back-in-building.png`) });

  /* state persisted: reopening the console resumes the session */
  await page.evaluate(() => globalThis.__euBuilding.hooks.open("SCR-F6-DESK-SYSTEMS-01"));
  await page.waitForURL(/terminal\.html/); await waitApp(page);
  check(`${label}: terminal session resumes`, /session resumed/.test(await page.textContent("[data-term]")));
  await page.goBack();
  await waitBuilding(page);
  const viaBrowser = await pose(page);
  check(`${label}: browser back returns to the pose`, near(before.pos, viaBrowser.pos) && viaBrowser.floor === "F6", JSON.stringify(viaBrowser));

  /* MISSION: blind F2, the camera console shows NO SIGNAL there; WORKPLACE never does */
  await page.click('[data-setmode="MISSION"]');
  await page.click('[data-fl="F2"]'); await waitFloor(page, "F2");
  await page.click("[data-mission]");
  await page.click('[data-fl="B1"]'); await waitFloor(page, "B1");
  await page.evaluate(() => globalThis.__euBuilding.hooks.open("SCR-B1-SEC-NVR-01"));
  await page.waitForURL(/vms\.html/); await waitApp(page);
  await page.click('[data-filter="F2"]');
  await page.waitForTimeout(400);
  const missionStates = await page.$$eval(".cam .st", (els) => els.map((e) => e.textContent));
  check(`${label}: MISSION shows the blinded floor as NO SIGNAL`, missionStates.length > 0 && missionStates.every((s) => /NO SIGNAL/.test(s)), missionStates.join("|"));
  await page.screenshot({ path: join(OUT, `${label}-07-vms-mission.png`) });
  const u = new URL(page.url()); u.searchParams.set("mode", "WORKPLACE");
  await page.goto(u.href); await waitApp(page);
  await page.click('[data-filter="F2"]'); await page.waitForTimeout(400);
  const workStates = await page.$$eval(".cam .st", (els) => els.map((e) => e.textContent));
  check(`${label}: WORKPLACE never shows mission outages`, workStates.length > 0 && workStates.every((s) => /REC/.test(s) && !/OFF/.test(s)), workStates.join("|"));

  /* every app at this width */
  const apps = [["kiosk", "SCR-F1-RECEPTION-MONITOR-01", "WORKPLACE"], ["noc", "SCR-B1-LAB-DASHBOARD-01", "TRAINING"], ["studio", "SCR-F4-FLOOR-CONTROL-01", "WORKPLACE"], ["evidence", "SCR-F5-ARCHIVE-SEARCH-01", "TRAINING"], ["departures", "SCR-F7-ECOSYSTEM-DISPLAY-01", "WORKPLACE"], ["wall", "SCR-F2-DISPLAY-PERSPECTIVES", "WORKPLACE"], ["vms", "SCR-B1-SEC-NVR-01", "WORKPLACE"]];
  for (const [app, screen, mode] of apps) {
    await page.goto(`${BASE}/screens/${app}.html?screen=${screen}&mode=${mode}`);
    await waitApp(page);
    await page.waitForTimeout(500);
    const ov = await noOverflow(page);
    check(`${label}: ${app} renders without overflow`, ov.sw === ov.cw, JSON.stringify(ov));
    await page.screenshot({ path: join(OUT, `${label}-app-${app}.png`) });
  }
  check(`${label}: no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

try {
  await run("phone-390", { width: 390, height: 844 });
  if (!process.env.PHONE_ONLY) await run("desktop-1440", { width: 1440, height: 900 });
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
assert.equal(failed.length, 0, failed.map((f) => f.name + " " + f.detail).join("\n"));
