#!/usr/bin/env node
/* THE SITEMAPS, WITH DATES THAT ARE TRUE.

     node tools/build-sitemap.mjs                # write sitemap.xml + sitemap-video.xml
     node tools/build-sitemap.mjs --check        # the right pages, images and videos (dates ignored)
     node tools/build-sitemap.mjs --check-dates  # also every lastmod (needs full git history)

   WHAT GOES IN. data/seo/sitemap-pages.json is the allowlist, in reading
   order. Every page is checked before it is written: one that carries
   noindex, has no canonical, or whose canonical names a different URL is
   refused and the build fails, because a URL we tell Google to skip, or
   one that points somewhere else, does not belong in the map we hand it.
   An indexable photo wall (walls/*.html that is not a redirect stub) that
   the allowlist forgot also fails the build.

   LASTMOD IS THE FILE'S LAST COMMIT. Google uses lastmod only when it is
   "consistently and verifiably accurate", so it is never a hand-typed date
   and never today's date by default: it is the date of the last commit
   that touched the page, or today only when the page has uncommitted
   changes (it is being changed today). The deploy workflow rewrites the
   dates on full history before publishing; --check, which every pull
   request runs, compares everything except the dates so it does not need
   history and does not fail merely because a page changed.

   No priority, no changefreq: Google ignores both, and a number nobody
   reads is a number nobody keeps true.

   IMAGES AND VIDEO. Image entries list the pictures a page actually shows
   (wall stills, album covers on the catalogue shelf). The video sitemap
   lists only films embedded on a crawlable page as a <video> element with
   a poster; a film that only plays inside a script-built reel is left out
   until it has a page of its own. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://matthew.mccluster.org";

/* [url path, file] from the allowlist: "" is index.html, "dir/" is dir/index.html */
export function pages() {
  const d = JSON.parse(readFileSync(join(ROOT, "data/seo/sitemap-pages.json"), "utf8"));
  return d.pages.map(({ url }) => {
    if (!url.startsWith(`${SITE}/`)) throw new Error(`${url}: not on ${SITE}`);
    const path = url.slice(SITE.length + 1);
    return [path, path === "" || path.endsWith("/") ? `${path}index.html` : path];
  });
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wallPages() {
  return readdirSync(join(ROOT, "walls")).filter((f) => f.endsWith(".html")).sort().map((f) => [`walls/${f}`, `walls/${f}`])
    .filter(([, file]) => !/<meta name="robots" content="[^"]*noindex/i.test(readFileSync(join(ROOT, file), "utf8")));
}

function listedWalls(list) {
  const listed = new Set(list.map(([p]) => p));
  return wallPages().filter(([p]) => !listed.has(p)).map(([, f]) => `${f}: an indexable wall missing from data/seo/sitemap-pages.json`);
}

function lastmod(file) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", file], { cwd: ROOT, encoding: "utf8" }).trim();
  if (dirty) return new Date().toISOString().slice(0, 10);
  const d = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!d) throw new Error(`${file}: no commit date (shallow clone? fetch full history)`);
  return d;
}

export function validate(path, file) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const problems = [];
  if (/<meta name="robots" content="[^"]*noindex/i.test(html)) problems.push("carries noindex");
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  if (canon.length !== 1) problems.push(`has ${canon.length} canonical tags`);
  else if (canon[0] !== `${SITE}/${path}`) problems.push(`canonical is ${canon[0]}`);
  return problems;
}

function imagesFor(path) {
  const out = [];
  if (path.startsWith("walls/")) {
    const id = path.slice(6, -5);
    const g = JSON.parse(readFileSync(join(ROOT, "data/gallery.json"), "utf8"));
    const ev = (g.events || []).find((e) => e.id === id);
    for (const m of (ev && ev.media) || []) {
      if (m.type === "film" || m.type === "video") { if (m.poster) out.push(m.poster); continue; }
      out.push(m.src);
    }
  }
  if (path === "catalogue.html") {
    const a = JSON.parse(readFileSync(join(ROOT, "data/albums.json"), "utf8"));
    for (const al of a.albums || []) if (/\.(jpe?g|png|webp)$/i.test(al.art)) out.push(al.art);
  }
  return [...new Set(out)].filter((p) => existsSync(join(ROOT, p)));
}

export function buildSitemap({ dates = true } = {}) {
  const list = pages();
  const bad = listedWalls(list);
  const rows = list.map(([path, file]) => {
    if (!existsSync(join(ROOT, file))) { bad.push(`${file}: missing`); return ""; }
    const p = validate(path, file);
    if (p.length) bad.push(`${file}: ${p.join("; ")}`);
    const imgs = imagesFor(path).map((src) => `\n    <image:image><image:loc>${xml(`${SITE}/${src}`)}</image:loc></image:image>`).join("");
    return `  <url>\n    <loc>${xml(`${SITE}/${path}`)}</loc>\n    <lastmod>${dates ? lastmod(file) : "0000-00-00"}</lastmod>${imgs}\n  </url>`;
  });
  if (bad.length) throw new Error("refusing to map these pages:\n  " + bad.join("\n  "));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by tools/build-sitemap.mjs from data/seo/sitemap-pages.json. Do not
     edit by hand: add the page there and re-run it. lastmod is each page's last
     commit. The policy is in docs/SEO-AEO-AUTHORITY-SYSTEM.md. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${rows.join("\n")}
</urlset>
`;
}

export function buildVideoSitemap() {
  const g = JSON.parse(readFileSync(join(ROOT, "data/gallery.json"), "utf8"));
  const rows = [];
  for (const [path, file] of pages().filter(([p]) => p.startsWith("walls/"))) {
    const html = readFileSync(join(ROOT, file), "utf8");
    const ev = (g.events || []).find((e) => `walls/${e.id}.html` === path);
    for (const m of (ev && ev.media) || []) {
      if (m.type !== "video" || !m.poster || !m.title) continue;
      if (!html.includes(`src="../${m.src}"`)) continue;   // only what the page really embeds
      rows.push(`  <url>
    <loc>${xml(`${SITE}/${path}`)}</loc>
    <video:video>
      <video:thumbnail_loc>${xml(`${SITE}/${m.poster}`)}</video:thumbnail_loc>
      <video:title>${xml(m.title)}</video:title>
      <video:description>${xml([m.about, `${ev.title}${ev.client ? ", for " + ev.client : ""}. Filmed by Matthew McCluster.`].filter(Boolean).join(". "))}</video:description>
      <video:content_loc>${xml(`${SITE}/${m.src}`)}</video:content_loc>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>
  </url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by tools/build-sitemap.mjs from data/gallery.json: films embedded
     as <video> on a crawlable page. publication_date is omitted on purpose: the
     repository does not record when these films were first published, and a
     guessed date is worse than none. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${rows.join("\n")}
</urlset>
`;
}

const undated = (s) => s.replace(/<lastmod>[^<]*<\/lastmod>/g, "<lastmod>0000-00-00</lastmod>");

function main() {
  const dated = !process.argv.includes("--check");
  const want = { "sitemap.xml": buildSitemap({ dates: dated || process.argv.includes("--check-dates") }), "sitemap-video.xml": buildVideoSitemap() };
  if (process.argv.includes("--check") || process.argv.includes("--check-dates")) {
    const strict = process.argv.includes("--check-dates");
    let bad = 0;
    for (const [f, body] of Object.entries(want)) {
      let cur = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), "utf8") : "";
      if (!strict) cur = undated(cur);
      if (cur !== body) { console.error(`${f} is stale: run node tools/build-sitemap.mjs`); bad++; }
    }
    if (bad) process.exit(1);
    console.log(strict ? "sitemaps: current, dates included" : "sitemaps: pages, images and videos current");
    return;
  }
  for (const [f, body] of Object.entries(want)) writeFileSync(join(ROOT, f), body);
  console.log(`sitemaps: ${(want["sitemap.xml"].match(/<loc>/g) || []).length} pages, ${(want["sitemap-video.xml"].match(/<video:video>/g) || []).length} videos`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
