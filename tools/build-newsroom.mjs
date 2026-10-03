#!/usr/bin/env node
/* THE NEWSROOM, RENDERED FROM THE EVIDENCE LEDGER.

     node tools/build-newsroom.mjs          # write newsroom.html + feed.xml
     node tools/build-newsroom.mjs --check  # fail if either drifted

   data/seo/evidence-ledger.json holds the dated public claims and what
   proves each one. Only items a person has verified against the evidence
   AND marked publish are rendered; a publish flag on an unverified item
   stops the build. Internal review notes, unverified claims and owner
   actions live in docs/seo/evidence-review.json, which is never deployed.

   Dates are never moved. Each entry shows when the thing happened (date)
   and, when that differs, when this site published it (published). The
   Article/feed dates are the publication dates, because a feed reader is
   told what is new here, not what is old somewhere else; an entry about a
   2025 proclamation published in 2026 is not passed off as 2025 news.
   Every string from the ledger is HTML-escaped. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://matthew.mccluster.org";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function human(iso) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  if (!m[2]) return m[1];
  if (!m[3]) return `${MONTHS[+m[2] - 1]} ${m[1]}`;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

export function published(ledger) {
  for (const x of ledger.items || []) {
    if (x.publish && x.verification_status !== "verified") throw new Error(`unverified public evidence: ${x.id}`);
    if (x.publish && !/^\d{4}-\d{2}-\d{2}$/.test(String(x.published || ""))) throw new Error(`${x.id}: a published item needs its first-publication date`);
  }
  return (ledger.items || [])
    .filter((x) => x.verification_status === "verified" && x.publish === true)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
}

const href = (ev) => ev.url || ev.path;
const abs = (ev) => ev.url || `${SITE}/${ev.path}`;

function itemNode(e) {
  const about = (e.entities || []).map((id) => ({ "@id": id }));
  const id = `${SITE}/newsroom.html#${e.id}`;
  if (e.schema_type === "Event") {
    const [city, region] = String(e.place || "").split(/,\s*/);
    return {
      "@type": "Event",
      "@id": id,
      name: e.title,
      description: e.summary,
      startDate: e.date,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: e.place ? { "@type": "Place", name: e.place, address: { "@type": "PostalAddress", addressLocality: city, addressRegion: region === "Connecticut" ? "CT" : region, addressCountry: "US" } } : undefined,
      organizer: about.length ? about[0] : undefined,
      subjectOf: e.evidence.map((ev) => ({ "@type": "CreativeWork", name: ev.label, url: abs(ev) }))
    };
  }
  return {
    "@type": e.schema_type === "Report" ? "Report" : "DigitalDocument",
    "@id": id,
    name: e.title,
    description: e.summary,
    dateCreated: e.date,
    url: abs(e.evidence[0]),
    about
  };
}

export function renderPage(ledger) {
  const items = published(ledger);
  const modified = items.map((e) => e.published).sort().pop();
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE}/newsroom.html`,
        url: `${SITE}/newsroom.html`,
        name: "Newsroom and public record: Matthew McCluster and McCluster Corp",
        description: "Dated, documented milestones for Matthew McCluster, McCluster Corp and Equity Uprise, each linked to its primary document.",
        inLanguage: "en-US",
        dateModified: modified,
        isPartOf: { "@id": `${SITE}/#website` },
        about: [{ "@id": `${SITE}/#matthew-mccluster` }, { "@id": `${SITE}/#mccluster-corp` }],
        publisher: { "@id": `${SITE}/#mccluster-corp` },
        mainEntity: {
          "@type": "ItemList",
          itemListOrder: "https://schema.org/ItemListOrderDescending",
          numberOfItems: items.length,
          itemListElement: items.map((e, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/newsroom.html#${e.id}`, item: itemNode(e) }))
        }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Matthew McCluster", item: `${SITE}/matthew-mccluster.html` },
          { "@type": "ListItem", position: 2, name: "Newsroom", item: `${SITE}/newsroom.html` }
        ]
      }
    ]
  };
  const json = JSON.stringify(JSON.parse(JSON.stringify(graph)), null, 2).split("\n").map((l) => "  " + l).join("\n");

  const list = items.map((e) => {
    const links = e.evidence.map((ev) => `<a href="${esc(href(ev))}">${esc(ev.label)}</a>`).join(" · ");
    const pub = e.published !== e.date
      ? ` · Published here <time datetime="${esc(e.published)}">${esc(human(e.published))}</time>` : "";
    return `      <li id="${esc(e.id)}">
        <time datetime="${esc(e.date)}">${esc(human(e.date))}</time>
        <h3>${esc(e.title)}</h3>
        <p>${esc(e.summary)}</p>
        <p class="rec__note">Evidence: ${links}${pub}</p>
      </li>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Newsroom &amp; Public Record · Matthew McCluster / McCluster Corp</title>
  <meta name="description" content="Dated, documented milestones for Matthew McCluster, McCluster Corp and Equity Uprise: legislative citations, proclamations, registrations, certifications and case studies, each linked to its primary document.">
  <meta name="author" content="Matthew McCluster">
  <link rel="canonical" href="${SITE}/newsroom.html">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="icon" type="image/png" href="assets/img/m-mark.png">
  <meta name="theme-color" content="#0a0807">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Matthew McCluster">
  <meta property="og:title" content="Newsroom &amp; Public Record · Matthew McCluster">
  <meta property="og:description" content="Dated milestones for Matthew McCluster and McCluster Corp, each linked to its primary document.">
  <meta property="og:url" content="${SITE}/newsroom.html">
  <meta property="og:image" content="${SITE}/assets/img/og-card.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Newsroom &amp; Public Record · Matthew McCluster">
  <meta name="twitter:description" content="Dated milestones, each linked to its primary document.">
  <meta name="twitter:image" content="${SITE}/assets/img/og-card.jpg">
  <link rel="alternate" type="application/atom+xml" title="Matthew McCluster · newsroom" href="feed.xml">
  <!-- GENERATED by tools/build-newsroom.mjs from data/seo/evidence-ledger.json. Do not edit by hand. -->
  <script type="application/ld+json">
${json}
  </script>
  <link rel="preload" href="assets/fonts/anton-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="css/style.css?v=__STAMP__">
  <link rel="stylesheet" href="css/authority.css?v=__STAMP__">
  <script src="js/theme.js?v=__STAMP__"></script>
  <!-- public document page: the privacy notice shows as a banner, not a wall (see js/live-content.js) -->
  <meta name="mcc-privacy-notice" content="banner">
  <script src="js/live-content.js?v=__STAMP__"></script>
</head>
<body class="record">
  <main class="rec" id="main">
    <nav class="rec__crumb" aria-label="Breadcrumb"><a href="matthew-mccluster.html">Matthew McCluster</a> / Newsroom</nav>
    <p class="rec__k">Newsroom · public record</p>
    <h1>The dated record</h1>
    <p class="rec__role">Matthew McCluster · McCluster Corp · Equity Uprise</p>

    <p class="rec__lede">Milestones for <b>Matthew McCluster</b>, <b>McCluster Corp</b> and the <b>Equity Uprise</b>
      fellowship, newest first. Every entry links the primary document behind it, and an entry is added only once
      that document has been checked. Nothing is backdated: each entry carries the date it happened and, where
      different, the date it was published here.</p>

    <div class="rec__card">
      <dl>
        <div><dt>Media contact</dt><dd><a href="mailto:matthew@mccluster.org">matthew@mccluster.org</a></dd></div>
        <div><dt>Bios, boilerplate and brand assets</dt><dd><a href="press.html">The press kit</a></dd></div>
        <div><dt>Follow</dt><dd><a href="feed.xml">Atom feed</a></dd></div>
        <div><dt>Last updated</dt><dd><time datetime="${esc(modified)}">${esc(human(modified))}</time></dd></div>
      </dl>
    </div>

    <h2 id="record">The record</h2>
    <ul class="rec__log">
${list}
    </ul>

    <p class="rec__foot">
      <a href="matthew-mccluster.html">Matthew McCluster</a> ·
      <a href="press.html">Press kit</a> ·
      <a href="engineering/">IT &amp; engineering</a> ·
      <a href="services.html">Services</a> ·
      <a href="mailto:matthew@mccluster.org">matthew@mccluster.org</a><br>
      © ${esc(String(modified).slice(0, 4))} Matthew McCluster · McCluster Corp.
    </p>
  </main>

  <script src="js/masthead.js?v=__STAMP__"></script>
  <script src="js/analytics.js?v=__STAMP__"></script>
  <script src="js/tabbar.js?v=__STAMP__"></script>
  <script>if (window.MCC_TRACK) window.MCC_TRACK("record_view", { page: "newsroom" });</script>
</body>
</html>
`;
}

export function renderFeed(ledger) {
  const items = published(ledger);
  const updated = items.map((e) => e.published).sort().pop() + "T00:00:00Z";
  const entries = items.map((e) => `  <entry>
    <id>${SITE}/newsroom.html#${esc(e.id)}</id>
    <title>${esc(e.title)}</title>
    <link rel="alternate" type="text/html" href="${SITE}/newsroom.html#${esc(e.id)}"/>
    <published>${esc(e.published)}T00:00:00Z</published>
    <updated>${esc(e.published)}T00:00:00Z</updated>
    <summary>${esc(human(e.date))}: ${esc(e.summary)}</summary>
  </entry>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by tools/build-newsroom.mjs from data/seo/evidence-ledger.json. -->
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${SITE}/newsroom.html</id>
  <title>Matthew McCluster · newsroom</title>
  <subtitle>Dated, documented milestones for Matthew McCluster and McCluster Corp.</subtitle>
  <link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
  <link rel="alternate" type="text/html" href="${SITE}/newsroom.html"/>
  <updated>${updated}</updated>
  <author><name>Matthew McCluster</name><uri>${SITE}/matthew-mccluster.html</uri></author>
${entries}
</feed>
`;
}

function main() {
  const ledger = JSON.parse(readFileSync(join(ROOT, "data/seo/evidence-ledger.json"), "utf8"));
  const out = { "newsroom.html": renderPage(ledger), "feed.xml": renderFeed(ledger) };
  if (process.argv.includes("--check")) {
    let bad = 0;
    for (const [f, body] of Object.entries(out)) {
      let cur = "";
      try { cur = readFileSync(join(ROOT, f), "utf8"); } catch {}
      if (cur !== body) { console.error(`${f} drifted from data/seo/evidence-ledger.json: run node tools/build-newsroom.mjs`); bad++; }
    }
    if (bad) process.exit(1);
    console.log(`newsroom: ${published(ledger).length} published entries, current`);
    return;
  }
  for (const [f, body] of Object.entries(out)) writeFileSync(join(ROOT, f), body);
  console.log(`newsroom: wrote newsroom.html and feed.xml (${published(ledger).length} entries)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
