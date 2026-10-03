#!/usr/bin/env node
/* THE SITEMAPS, WITH DATES THAT ARE TRUE.

     node tools/seo/build-sitemaps.mjs          # write sitemap.xml + sitemap-video.xml
     node tools/seo/build-sitemaps.mjs --check  # fail if either drifted

   WHAT GOES IN. The list below is the set of pages meant to be found:
   each one is checked before it is written. A page that carries
   noindex, has no canonical, or whose canonical names a different URL is
   refused and the build fails, because a URL we tell Google to skip, or
   one that points somewhere else, does not belong in the map we hand it.
   The photo walls are picked up from walls/ automatically (every wall
   that is a page, not a redirect stub).

   LASTMOD IS THE FILE'S LAST COMMIT. Google uses lastmod only when it is
   "consistently and verifiably accurate", so it is never today's date by
   default: it is the date of the last commit that touched the page, or
   today only when the page has uncommitted changes (it is being changed
   today). --check in CI therefore fails when a page changes and the map
   was not rebuilt, which is the drift worth catching. CI must check out
   full history (fetch-depth: 0) for the dates to be readable.

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITE = "https://matthew.mccluster.org";

/* [url path, file] in the order a person would want them read */
export const PAGES = [
  ["", "index.html"],
  ["matthew-mccluster.html", "matthew-mccluster.html"],
  ["resume-it-support.html", "resume-it-support.html"],
  ["engineering/", "engineering/index.html"],
  ["engineering/ipc-data-center.html", "engineering/ipc-data-center.html"],
  ["engineering/mccluster-platform.html", "engineering/mccluster-platform.html"],
  ["services.html", "services.html"],
  ["hire.html", "hire.html"],
  ["sites.html", "sites.html"],
  ["sites-details.html", "sites-details.html"],
  ["case-designer-kicks.html", "case-designer-kicks.html"],
  ["portfolio.html", "portfolio.html"],
  ["gallery.html", "gallery.html"],
  ["shots.html", "shots.html"],
  ["films.html", "films.html"],
  ["album.html", "album.html"],
  ["listen.html", "listen.html"],
  ["catalogue.html", "catalogue.html"],
  ["license.html", "license.html"],
  ["newsroom.html", "newsroom.html"],
  ["press.html", "press.html"],
  ["card.html", "card.html"],
  ["docket-516.html", "docket-516.html"],
  ["policy.html", "policy.html"],
  ["policy-memo-dna.html", "policy-memo-dna.html"],
  ["action/", "action/index.html"],
  ["heal-the-3rd-world.html", "heal-the-3rd-world.html"],
  ["end-racism.html", "end-racism.html"],
  ["whip.html", "whip.html"],
  ["prayer-closet.html", "prayer-closet.html"],
  ["closet/sent.html", "closet/sent.html"],
  ["inner-room.html", "inner-room.html"],
  ["privacy.html", "privacy.html"]
];

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wallPages() {
  return readdirSync(join(ROOT, "walls")).filter((f) => f.endsWith(".html")).sort().map((f) => [`walls/${f}`, `walls/${f}`])
    .filter(([, file]) => !/<meta name="robots" content="[^"]*noindex/i.test(readFileSync(join(ROOT, file), "utf8")));
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
  const pages = [...PAGES, ...wallPages()];
  const bad = [];
  const rows = pages.map(([path, file]) => {
    if (!existsSync(join(ROOT, file))) { bad.push(`${file}: missing`); return ""; }
    const p = validate(path, file);
    if (p.length) bad.push(`${file}: ${p.join("; ")}`);
    const imgs = imagesFor(path).map((src) => `\n    <image:image><image:loc>${xml(`${SITE}/${src}`)}</image:loc></image:image>`).join("");
    return `  <url>\n    <loc>${xml(`${SITE}/${path}`)}</loc>\n    <lastmod>${dates ? lastmod(file) : "0000-00-00"}</lastmod>${imgs}\n  </url>`;
  });
  if (bad.length) throw new Error("refusing to map these pages:\n  " + bad.join("\n  "));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by tools/seo/build-sitemaps.mjs. Do not edit by hand: add a page
     to PAGES in that file and re-run it. lastmod is each page's last commit.
     The policy, and why particular pages stay out, is in
     docs/SEO-AEO-AUTHORITY-SYSTEM.md. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${rows.join("\n")}
</urlset>
`;
}

export function buildVideoSitemap() {
  const g = JSON.parse(readFileSync(join(ROOT, "data/gallery.json"), "utf8"));
  const rows = [];
  for (const [path, file] of wallPages()) {
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
<!-- GENERATED by tools/seo/build-sitemaps.mjs from data/gallery.json: films embedded
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
  /* --check-structure: the right pages, images and videos, ignoring dates.
     This is what CI enforces on every pull request. The dates are made
     true at deploy time instead: deploy-pages.yml runs this script on the
     full history before anything else touches the files. */
  if (process.argv.includes("--check-structure")) {
    const want = { "sitemap.xml": buildSitemap({ dates: false }), "sitemap-video.xml": buildVideoSitemap() };
    let bad = 0;
    for (const [f, body] of Object.entries(want)) {
      const cur = existsSync(join(ROOT, f)) ? undated(readFileSync(join(ROOT, f), "utf8")) : "";
      if (cur !== body) { console.error(`${f}: the mapped pages changed: run node tools/seo/build-sitemaps.mjs`); bad++; }
    }
    if (bad) process.exit(1);
    console.log("sitemaps: structure current");
    return;
  }
  const out = { "sitemap.xml": buildSitemap(), "sitemap-video.xml": buildVideoSitemap() };
  if (process.argv.includes("--check")) {
    let bad = 0;
    for (const [f, body] of Object.entries(out)) {
      const cur = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), "utf8") : "";
      if (cur !== body) { console.error(`${f} is stale: run node tools/seo/build-sitemaps.mjs`); bad++; }
    }
    if (bad) process.exit(1);
    console.log("sitemaps: current");
    return;
  }
  for (const [f, body] of Object.entries(out)) writeFileSync(join(ROOT, f), body);
  console.log(`sitemaps: ${(out["sitemap.xml"].match(/<loc>/g) || []).length} pages, ${(out["sitemap-video.xml"].match(/<video:video>/g) || []).length} videos`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
