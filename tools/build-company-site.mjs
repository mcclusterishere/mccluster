#!/usr/bin/env node
/* McCLUSTER CORP'S HOUSE: the company property at https://mccluster.org/.

     node tools/build-company-site.mjs          # write the generated module
     node tools/build-company-site.mjs --check  # fail if it drifted

   Two properties, two entities (docs/control-plane/DOMAINS-AND-ENTITIES.md):
   matthew.mccluster.org is Matthew McCluster's house; mccluster.org is
   McCluster Corp's. GitHub Pages serves one custom domain per repository,
   so the company pages are not static files at the repository root. They
   are rendered here into a JS module the one Worker, mccluster, serves on
   the mccluster.org host (workers/mccluster/src/company-site/router.js).

   Sources: data/seo/company-site.json for the words, data/seo/entity-graph.json
   for the Organization and its products, so the company property and the
   profile page describe McCluster Corp with the same graph, one @id each.
   No scripts, no trackers, no cookies on the output: a share preview and a
   crawler read the whole page as delivered. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "workers/mccluster/src/company-site/pages.generated.js");

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xml = esc;

export function buildGraph(site, graph) {
  const O = graph.organization["@id"], P = graph.person["@id"];
  const origin = site.origin;
  const keep = (key, ns) => (key && graph[ns] && graph[ns][key]) ? graph[ns][key] : null;
  const products = site.doors.map((d) => keep(d.entity, "projects") || keep(d.entity, "software")).filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: `${origin}/`,
        name: "McCluster Corp",
        inLanguage: "en-US",
        about: { "@id": O },
        publisher: { "@id": O }
      },
      {
        "@type": "AboutPage",
        "@id": `${origin}/`,
        url: `${origin}/`,
        name: site.meta.title,
        description: site.meta.description,
        isPartOf: { "@id": `${origin}/#website` },
        about: { "@id": O },
        mainEntity: { "@id": O },
        dateModified: site.updated_at
      },
      graph.organization,
      { "@type": "Person", "@id": P, name: graph.person.name, url: graph.person.url },
      ...products
    ]
  };
}

const CSS = `
:root{--ink:#0a0807;--ink-2:#15110f;--cream:#f4efe6;--dim:#c9c1b4;--ruby:#e5383b;--ruby-text:#ff6b6e;--edge:rgba(244,239,230,.14)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ink);color:var(--cream);font:400 1rem/1.65 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--ruby-text)}
a:focus-visible{outline:2px solid var(--ruby-text);outline-offset:3px}
.wrap{max-width:68rem;margin:0 auto;padding:0 16px}
header.top{display:flex;align-items:center;gap:.75rem;padding:1.1rem 0}
header.top img{width:40px;height:40px}
header.top b{font-size:1rem;letter-spacing:.04em}
.k{font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);font-weight:700;margin:2.4rem 0 .4rem}
h1{font-weight:900;letter-spacing:-.01em;line-height:1.02;font-size:clamp(2.1rem,9vw,4.4rem);margin:.2rem 0 1rem;text-transform:uppercase}
h2{font-weight:800;font-size:1.35rem;margin:2.6rem 0 .5rem}
h3{font-weight:800;font-size:1.05rem;margin:0 0 .35rem}
.lede{color:var(--dim);font-size:clamp(1rem,2.6vw,1.2rem);max-width:46rem}
.grid{display:grid;grid-template-columns:minmax(0,1fr);gap:.85rem;margin-top:1rem}
.card{border:1px solid var(--edge);border-radius:14px;padding:1rem;background:var(--ink-2);min-width:0}
.card p{margin:.2rem 0 .7rem;color:var(--dim)}
.card .kind{font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ruby-text);font-weight:700;margin:0 0 .3rem}
.card a.go{font-weight:700;text-decoration:none;border-bottom:1px solid currentColor}
dl{margin:1rem 0 0;display:grid;grid-template-columns:minmax(0,1fr);gap:.6rem}
dl div{border-top:1px solid var(--edge);padding-top:.6rem;min-width:0}
dt{font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:700}
dd{margin:.15rem 0 0;overflow-wrap:anywhere}
.note{color:var(--dim);font-size:.92rem;margin-top:1rem}
footer{border-top:1px solid var(--edge);margin-top:3rem;padding:1.4rem 0 2.4rem;color:var(--dim);font-size:.9rem}
footer a{margin-right:1rem;display:inline-block;padding:.2rem 0}
@media (min-width:46rem){
  .grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  dl{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:1.4rem}
}
@media (min-width:68rem){
  .grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
}`.trim();

export function renderHome(site, graph) {
  const m = site.meta, origin = site.origin;
  const door = (d) => `      <article class="card"><p class="kind">${esc(d.kind)}</p><h3>${esc(d.name)}</h3><p>${esc(d.line)}</p><a class="go" href="${esc(d.href)}">${esc(d.cta)} &#8594;</a></article>`;
  const work = (w) => `      <article class="card"><h3>${esc(w.title)}</h3><p>${esc(w.body)}</p><a class="go" href="${esc(w.href)}">${esc(w.cta)}</a></article>`;
  const fact = (f) => `      <div><dt>${esc(f.label)}</dt><dd>${f.href ? `<a href="${esc(f.href)}">${esc(f.value)}</a>` : esc(f.value)}</dd></div>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(m.title)}</title>
  <meta name="description" content="${esc(m.description)}">
  <link rel="canonical" href="${origin}/">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="icon" type="image/png" href="${esc(m.image)}">
  <meta name="theme-color" content="#0a0807">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="McCluster Corp">
  <meta property="og:title" content="${esc(m.og_title)}">
  <meta property="og:description" content="${esc(m.og_description)}">
  <meta property="og:url" content="${origin}/">
  <meta property="og:image" content="${esc(m.image)}">
  <meta property="og:image:width" content="${m.image_width}">
  <meta property="og:image:height" content="${m.image_height}">
  <meta property="og:image:alt" content="${esc(m.image_alt)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(m.og_title)}">
  <meta name="twitter:description" content="${esc(m.og_description)}">
  <meta name="twitter:image" content="${esc(m.image)}">
  <!-- GENERATED by tools/build-company-site.mjs from data/seo/company-site.json and data/seo/entity-graph.json. Do not edit by hand. -->
  <script type="application/ld+json">${JSON.stringify(buildGraph(site, graph))}</script>
  <style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <header class="top"><img src="${esc(m.image)}" alt="" width="40" height="40"><b>McCluster Corp</b></header>
    <main id="main">
      <p class="k">${esc(site.hero.kicker)}</p>
      <h1>${esc(site.hero.headline)}</h1>
      <p class="lede">${esc(site.hero.lede)}</p>

      <h2 id="products">${esc(site.doors_heading)}</h2>
      <p class="note">${esc(site.doors_intro)}${site.product_map ? ` <a href="${esc(site.product_map.href)}">${esc(site.product_map.cta)} &#8594;</a>` : ""}</p>
      <div class="grid three">
${site.doors.map(door).join("\n")}
      </div>

      <h2 id="work">${esc(site.work_heading)}</h2>
      <div class="grid">
${site.work.map(work).join("\n")}
      </div>

      <h2 id="operations">${esc(site.operations.heading)}</h2>
      <p class="lede">${esc(site.operations.body)} <a href="${esc(site.operations.href)}">${esc(site.operations.cta)}</a>.</p>

      <h2 id="company">${esc(site.facts_heading)}</h2>
      <dl>
${site.facts.map(fact).join("\n")}
      </dl>
      <p class="note">${esc(site.separate_note)}</p>

      <h2 id="founder">${esc(site.founder.heading)}</h2>
      <p class="lede">${esc(site.founder.body)} <a href="${esc(site.founder.href)}">${esc(site.founder.cta)} &#8594;</a></p>
    </main>
    <footer>
${site.footer_links.map((l) => `      <a href="${esc(l.href)}">${esc(l.label)}</a>`).join("\n")}
      <p>© ${esc(String(site.updated_at).slice(0, 4))} McCluster Corp.</p>
    </footer>
  </div>
</body>
</html>
`;
}

export function renderRobots(site) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`;
}

export function renderSitemap(site) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by tools/build-company-site.mjs. The company property's own pages only;
     products that live on matthew.mccluster.org are mapped in that host's sitemap. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${xml(site.origin)}/</loc>
    <lastmod>${xml(site.updated_at)}</lastmod>
  </url>
</urlset>
`;
}

export function renderLlms(site) {
  const lines = [
    "# McCluster Corp",
    "",
    `> ${site.hero.lede}`,
    "",
    "This is McCluster Corp's property. Matthew McCluster, its founder, has his own:",
    `${site.personal_origin}/ (person, resume, engineering, music, portfolio).`,
    "The two are distinct entities; do not merge them.",
    "",
    "## Products and initiatives",
    ...site.doors.map((d) => `- [${d.name}](${d.href}): ${d.kind}. ${d.line}`),
    ...(site.product_map ? [`- [${site.product_map.cta}](${site.product_map.href}): ${site.product_map.line}`] : []),
    "",
    "## Company",
    ...site.facts.map((f) => `- ${f.label}: ${f.value}${f.href ? ` (${f.href})` : ""}`),
    `- ${site.separate_note}`,
    ""
  ];
  return lines.join("\n");
}

export function buildModule(site, graph) {
  const pages = {
    "/": { type: "text/html; charset=utf-8", body: renderHome(site, graph) },
    "/robots.txt": { type: "text/plain; charset=utf-8", body: renderRobots(site) },
    "/sitemap.xml": { type: "application/xml; charset=utf-8", body: renderSitemap(site) },
    "/llms.txt": { type: "text/plain; charset=utf-8", body: renderLlms(site) }
  };
  return `/* GENERATED by tools/build-company-site.mjs from data/seo/company-site.json and
   data/seo/entity-graph.json. Do not edit by hand: change the data and re-run it.
   Served on the mccluster.org host by ./router.js. */
export const COMPANY_ORIGIN = ${JSON.stringify(site.origin)};
export const PERSONAL_ORIGIN = ${JSON.stringify(site.personal_origin)};
export const PAGES = ${JSON.stringify(pages, null, 2)};
`;
}

function main() {
  const site = JSON.parse(readFileSync(join(ROOT, "data/seo/company-site.json"), "utf8"));
  const graph = JSON.parse(readFileSync(join(ROOT, "data/seo/entity-graph.json"), "utf8"));
  if (graph.organization.url !== `${site.origin}/`) throw new Error(`entity-graph Organization.url must be ${site.origin}/ (is ${graph.organization.url})`);
  const out = buildModule(site, graph);
  if (process.argv.includes("--check")) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (cur !== out) { console.error("company site drifted from data/seo/company-site.json: run node tools/build-company-site.mjs"); process.exit(1); }
    console.log("company site: current");
    return;
  }
  writeFileSync(OUT, out);
  console.log("company site: wrote workers/mccluster/src/company-site/pages.generated.js");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
