/* LIGHT-THEME LEGIBILITY AUDIT — measured in painted pixels, not in CSS.

   Loads each page with mcc_theme="light" and walks it a viewport at a
   time. At each stop it screenshots the viewport and asks one question
   of the pixels inside every text box currently on screen: is there any
   contrast there at all? Capturing per viewport rather than full-page
   is deliberate — this site drives Lenis smooth scroll and GSAP pinning,
   so page-absolute coordinates do not survive a full-page capture.

   The metric is the ratio between the modal (background) luminance of
   the box and the farthest luminance that occupies a real share of it.
   Text drawn in the background colour scores 1:1 — invisible — no
   matter what the stylesheet claims the colours are.

   WHAT IT IS GOOD AT, AND WHAT IT IS NOT. It is decisive about the
   catastrophic band — anything under about 2.5:1 is genuinely
   unreadable and every such finding here has held up when rendered and
   looked at. Between roughly 3:1 and the 4.5:1 floor it under-reads
   small letterspaced text sitting in a wide box, because the glyphs
   occupy too little of the box for the percentile sweep to reach their
   core. Treat that band as a list of places to go and LOOK, not as a
   verdict. Run it from the repo root:

     PW_MODULE=<playwright> PW_CHROME=<chrome> \
       node scripts/legibility.mjs sites.html gallery.html ...

   LEG_PORT moves the local server if you want two of these at once;
   LEG_OUT chooses where the JSON lands. Theme-locked pages report
   themselves skipped rather than being audited against a coat they
   never wear. */
import { createRequire } from "module";
import { spawn } from "child_process"; import http from "http"; import fs from "fs";
import { decode } from "./png-read.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || "playwright");
const PORT = +(process.env.LEG_PORT || 8973), ROOT = process.cwd();
const HERE = process.env.LEG_OUT || ".";
const pages = process.argv.slice(2);

const srv = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
await new Promise(r => { const p = n => http.get(`http://127.0.0.1:${PORT}/`, () => r()).on("error", () => n > 0 && setTimeout(() => p(n - 1), 200)); p(50); });
const b = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try { localStorage.setItem("mcc_theme", "light"); } catch (e) {} });

const lum = (r, g, bl) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/* Ground and ink, read off a luminance histogram.

   Ground is the modal bucket — the paper the box is mostly made of. Ink
   is the extreme, but it cannot be read off a single bucket: antialiasing
   smears one glyph across dozens of buckets, so each is individually
   below any sane noise floor and a perfectly legible label measures as
   flat. So we accumulate inward from both ends until we have swept a real
   share of the box, and take whichever end lands farther from the ground. */
const ends = (hist, n) => {
  let mode = 0; for (let i = 1; i <= 100; i++) if (hist[i] > hist[mode]) mode = i;
  const share = Math.max(4, n * 0.006);
  let lo = 0, acc = 0;
  for (lo = 0; lo <= 100; lo++) { acc += hist[lo]; if (acc >= share) break; }
  let hi = 100; acc = 0;
  for (hi = 100; hi >= 0; hi--) { acc += hist[hi]; if (acc >= share) break; }
  return { mode, ink: Math.abs(lo - mode) >= Math.abs(hi - mode) ? Math.min(lo, 100) : Math.max(hi, 0) };
};

/* Collect every element that paints its own text, with its page-absolute box. */
const COLLECT = () => {
  const out = [];
  const sel = el => { let s = el.tagName.toLowerCase(); if (el.id) s += "#" + el.id;
    const c = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (c.length) s += "." + c.join("."); return s; };
  document.querySelectorAll("body *").forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    /* a reveal animation part-way through is not a legibility bug — skip
       anything not yet fully opaque, itself or through an ancestor */
    for (let a = el; a && a !== document.body; a = a.parentElement)
      if (+getComputedStyle(a).opacity < 0.99) return;
    if (cs.position === "fixed") return;              /* bars float over changing ground */
    const txt = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!txt.length) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 6 || r.width > 1600) return;
    /* wholly on screen, or the crop would sample the frame edge */
    if (r.top < 2 || r.bottom > innerHeight - 2 || r.left < 0 || r.right > innerWidth) return;
    out.push({ sel: sel(el), x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height), size: Math.round(parseFloat(cs.fontSize)),
      color: cs.color, weight: cs.fontWeight,
      text: txt.map(n => n.textContent).join(" ").trim().replace(/\s+/g, " ").slice(0, 48) });
  });
  return out;
};

const findings = {};
for (const p of pages) {
  const pg = await ctx.newPage();
  try {
    await pg.goto(`http://127.0.0.1:${PORT}/${p}`, { waitUntil: "load", timeout: 30000 });
    await pg.waitForTimeout(1200);
    const theme = await pg.evaluate(() => document.documentElement.getAttribute("data-theme"));
    if (theme !== "light") { console.log(`skip ${p} (theme=${theme})`); await pg.close(); continue; }
    const rows = [], seen = new Set();
    const H = await pg.evaluate(() => document.documentElement.scrollHeight);
    const VH = 900, STEP = 700;
    for (let top = 0; top < H + STEP; top += STEP) {
      await pg.evaluate(y => window.scrollTo(0, y), top);
      await pg.waitForTimeout(750);                    /* let reveals finish */
      const boxes = await pg.evaluate(COLLECT);
      if (!boxes.length) continue;
      const img = decode(await pg.screenshot({ animations: "disabled" }));
      for (const bx of boxes) {
        const key = bx.sel + "|" + bx.text;
        if (seen.has(key)) continue;
        const x0 = Math.max(0, bx.x), y0 = Math.max(0, bx.y);
        const x1 = Math.min(img.w, bx.x + bx.w), y1 = Math.min(img.h, bx.y + bx.h);
        if (x1 - x0 < 6 || y1 - y0 < 5) continue;
        const hist = new Uint32Array(101); let n = 0;
        for (let y = y0; y < y1; y++) {
          const row = y * img.w * img.ch;
          for (let x = x0; x < x1; x++) {
            const i = row + x * img.ch;
            hist[Math.round(lum(img.data[i], img.data[i + 1], img.data[i + 2]) * 100)]++; n++;
          }
        }
        if (n < 60) continue;
        seen.add(key);
        const { mode, ink } = ends(hist, n);
        const ratio = cr(mode / 100, ink / 100);
        const large = bx.size >= 24 || (bx.size >= 19 && +bx.weight >= 700);
        const need = large ? 3 : 4.5;
        if (ratio >= need) continue;
        rows.push({ ...bx, ratio: +ratio.toFixed(2), need, ground: mode, ink });
      }
    }
    /* CONFIRMATION. A scroll sweep can photograph an element while its
       reveal is still easing. Every flagged element is parked in the
       middle of the viewport, given a full second to settle, and
       measured again. Only a second failure counts. */
    const confirmed = [];
    for (const r of rows) {
      const box = await pg.evaluate(({ sel, text }) => {
        const cand = [...document.querySelectorAll("body *")].filter(el => {
          const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1);
          return t.length && t.map(n => n.textContent).join(" ").trim().replace(/\s+/g, " ").slice(0, 48) === text;
        });
        if (!cand.length) return null;
        cand[0].scrollIntoView({ block: "center", behavior: "instant" });
        return true;
      }, r).catch(() => null);
      if (!box) continue;
      await pg.waitForTimeout(1000);
      const now = await pg.evaluate(({ text }) => {
        const el = [...document.querySelectorAll("body *")].find(e => {
          const t = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1);
          return t.length && t.map(n => n.textContent).join(" ").trim().replace(/\s+/g, " ").slice(0, 48) === text;
        });
        if (!el) return null;
        for (let a = el; a && a !== document.body; a = a.parentElement)
          if (+getComputedStyle(a).opacity < 0.99) return null;
        const q = el.getBoundingClientRect();
        if (q.top < 2 || q.bottom > innerHeight - 2 || q.width < 8 || q.height < 6) return null;
        return { x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height) };
      }, r).catch(() => null);
      if (!now) continue;
      const img = decode(await pg.screenshot({ animations: "disabled" }));
      const x0 = Math.max(0, now.x), y0 = Math.max(0, now.y);
      const x1 = Math.min(img.w, now.x + now.w), y1 = Math.min(img.h, now.y + now.h);
      if (x1 - x0 < 6 || y1 - y0 < 5) continue;
      const hist = new Uint32Array(101); let n = 0;
      for (let y = y0; y < y1; y++) {
        const rowo = y * img.w * img.ch;
        for (let x = x0; x < x1; x++) { const i = rowo + x * img.ch;
          hist[Math.round(lum(img.data[i], img.data[i + 1], img.data[i + 2]) * 100)]++; n++; }
      }
      if (n < 60) continue;
      const { mode, ink } = ends(hist, n);
      const again = cr(mode / 100, ink / 100);
      if (again >= r.need) continue;
      confirmed.push({ ...r, ratio: +again.toFixed(2) });
    }
    rows.length = 0; rows.push(...confirmed);
    rows.sort((a, b) => a.ratio - b.ratio);
    findings[p] = rows;
    if (!rows.length) { console.log(`ok   ${p}`); }
    else {
      console.log(`\n### ${p} — ${rows.length}`);
      for (const r of rows.slice(0, 12))
        console.log(`  ${String(r.ratio).padStart(5)}:1 /${r.need}  ${r.sel.padEnd(34)} ${r.color.padEnd(22)} ${r.size}px  "${r.text}"`);
      if (rows.length > 12) console.log(`  ... ${rows.length - 12} more`);
    }
  } catch (e) { console.log(`ERR  ${p}: ${String(e).slice(0, 130)}`); }
  await pg.close();
}
fs.writeFileSync(`${HERE}/legibility2.json`, JSON.stringify(findings, null, 1));
const tot = Object.values(findings).reduce((a, r) => a + r.length, 0);
console.log(`\n=== ${tot} illegible elements across ${Object.keys(findings).length} pages ===`);
await b.close(); srv.kill();
