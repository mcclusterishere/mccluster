/* THE WALL PAGES — one real, crawlable page per event.

     node tools/build-walls.mjs

   Why this exists: the gallery routes events on a hash
   (gallery.html#/candler-crossing). Everything after a # is the same URL to
   a search engine, so every wall shared one title, one description and one
   entry in the index — which means none of them could rank for anything.

   This writes a static page per event at walls/<id>.html, with the client's
   name in the title, the story in real HTML rather than injected by script,
   and structured data that ties three entities together: the EVENT, the
   CLIENT who commissioned it, and the PHOTOGRAPHER who shot it. That last
   link is the whole point — it is what makes a search for the client turn
   up the person who covered them.

   Everything comes out of data/gallery.json. Nothing is written twice.  */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://matthew.mccluster.org";
const ME = {
  name: "Matthew McCluster",
  org: "McCluster Corp",
  page: `${SITE}/matthew-mccluster.html`,
  email: "matthew@mccluster.org",
  sameAs: [
    "https://instagram.com/McClusterishere",
    "https://youtube.com/@McClusterishere",
    "https://tiktok.com/@McClusterishere",
  ],
};

const gallery = JSON.parse(readFileSync(join(ROOT, "data/gallery.json"), "utf8"));
const esc = (s) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* "June 11, 2026" → "2026-06-11". A date without a year ("October 5") gets
   no startDate at all rather than a guessed one — a wrong date in structured
   data is worse than none. */
const MONTHS = ["january","february","march","april","may","june","july",
                "august","september","october","november","december"];
function isoDate(s) {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(s || "").trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

function whereLine(ev) {
  return [ev.venue, ev.city].filter(Boolean).join(", ");
}

/* The description a search engine prints under the link. Lead with the
   client and the place, because that is what someone is searching. */
function metaDesc(ev) {
  const bits = [
    ev.client ? `${ev.title} — photographed for ${ev.client}` : ev.title,
    whereLine(ev),
    ev.date,
  ].filter(Boolean).join(". ");
  const tail = ev.about ? " " + ev.about : "";
  return (bits + "." + tail).replace(/\s+/g, " ").trim().slice(0, 300);
}

function altFor(ev, m, i) {
  return [ev.title, ev.client ? `for ${ev.client}` : "", whereLine(ev),
          `frame ${i + 1}`].filter(Boolean).join(" · ");
}

function ldFor(ev) {
  const url = `${SITE}/walls/${ev.id}.html`;
  const start = isoDate(ev.date);
  const stills = (ev.media || []).filter((m) => m.type !== "film");
  const cover = ev.cover ? `${SITE}/${ev.cover}` : null;

  const me = {
    "@type": "Person",
    "@id": `${SITE}/#matthew-mccluster`,
    name: ME.name,
    url: ME.page,
    email: ME.email,
    jobTitle: "Photographer and Creative Director",
    worksFor: { "@type": "Organization", "@id": `${SITE}/#mccluster-corp`, name: ME.org },
    sameAs: ME.sameAs,
  };

  const graph = [me];

  /* The client as its own entity, cited by the coverage. This is the join:
     the client is the subject, the photographer is the creator, and both
     hang off the same event. */
  let clientNode = null;
  if (ev.client) {
    clientNode = {
      "@type": "Organization",
      "@id": `${url}#client`,
      name: ev.client,
    };
    if (ev.sources && ev.sources.length) clientNode.subjectOf = ev.sources.map((u) => ({ "@type": "WebPage", url: u }));
    graph.push(clientNode);
  }

  const event = {
    "@type": "Event",
    "@id": `${url}#event`,
    name: ev.title,
    url,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
  };
  if (start) event.startDate = start;
  if (ev.about) event.description = ev.about;
  if (cover) event.image = cover;
  if (clientNode) event.organizer = { "@id": `${url}#client` };
  if (ev.venue || ev.city) {
    event.location = {
      "@type": "Place",
      name: ev.venue || ev.city,
      address: { "@type": "PostalAddress", addressLocality: ev.city || undefined },
    };
  }
  graph.push(event);

  /* Every frame credited. copyrightHolder and creator both point at the
     same Person node, so the images are attributable, not orphaned. */
  stills.forEach((m, i) => {
    graph.push({
      "@type": "ImageObject",
      "@id": `${url}#${m.id}`,
      contentUrl: `${SITE}/${m.src}`,
      url: `${SITE}/${m.src}`,
      caption: altFor(ev, m, i),
      creator: { "@id": `${SITE}/#matthew-mccluster` },
      copyrightHolder: { "@id": `${SITE}/#matthew-mccluster` },
      creditText: `${ME.name} / ${ME.org}`,
      representativeOfPage: ev.cover === m.src,
      about: clientNode ? { "@id": `${url}#client` } : undefined,
      isPartOf: { "@id": `${url}#event` },
    });
  });

  graph.push({
    "@type": "ImageGallery",
    "@id": `${url}#gallery`,
    name: `${ev.title}${ev.client ? " — " + ev.client : ""}`,
    url,
    about: { "@id": `${url}#event` },
    author: { "@id": `${SITE}/#matthew-mccluster` },
    copyrightHolder: { "@id": `${SITE}/#matthew-mccluster` },
    ...(ev.about ? { description: ev.about } : {}),
  });

  graph.push({
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "HERE", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "The gallery", item: `${SITE}/gallery.html` },
      { "@type": "ListItem", position: 3, name: ev.title, item: url },
    ],
  });

  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
}

function pageFor(ev) {
  const url = `${SITE}/walls/${ev.id}.html`;
  const title = ev.client
    ? `${ev.client} — ${ev.title}${ev.date ? ` (${ev.date})` : ""} | Photographed by Matthew McCluster`
    : `${ev.title} | Photographed by Matthew McCluster`;
  const desc = metaDesc(ev);
  const cover = ev.cover ? `${SITE}/${ev.cover}` : `${SITE}/assets/img/og-card.jpg`;
  const media = ev.media || [];
  const sellable = media.some((m) => m.sell);

  const frames = media.map((m, i) => {
    if (m.type === "film") {
      return `      <figure class="wl__film">
        <div class="wl__embed"><iframe src="https://www.youtube-nocookie.com/embed/${esc(m.youtube)}" title="${esc(m.title || ev.title)}" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
        <figcaption>${esc(m.title || ev.title)}${m.len ? " &middot; " + esc(m.len) : ""}</figcaption>
      </figure>`;
    }
    if (m.type === "video") {
      return `      <figure><video src="${esc(m.src)}" controls playsinline preload="none"${m.poster ? ` poster="${esc(m.poster)}"` : ""}></video></figure>`;
    }
    return `      <figure class="wrv${i === 0 ? " wl__feat" : ""}" style="--i:${i % 5}"><img src="../${esc(m.src)}" alt="${esc(altFor(ev, m, i))}" loading="lazy" width="1800" height="1200">${
      m.sell ? `<figcaption><a href="../gallery.html#shop">Own this frame &#8594;</a></figcaption>` : ""
    }</figure>`;
  }).join("\n");

  const sources = (ev.sources || []).length
    ? `    <section class="wl__src">
      <h2>Covered in the press</h2>
      <ul>
${ev.sources.map((u) => `        <li><a href="${esc(u)}" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</a></li>`).join("\n")}
      </ul>
    </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="author" content="${esc(ME.name)}">
  <link rel="icon" type="image/png" href="../assets/img/m-mark.png">
  <meta name="theme-color" content="#0b0908">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${esc(cover)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${esc(cover)}">
  <link rel="stylesheet" href="../css/style.css?v=__STAMP__">
  <script src="../js/theme.js?v=__STAMP__"></script>
  <style>
    :root { --ui: "Manrope", system-ui, -apple-system, sans-serif; }
    .wl { max-width: 68rem; margin: 0 auto; padding: 0 clamp(1.1rem, 4vw, 2.2rem) 7rem;
      font-family: var(--ui); color: var(--cream); }
    /* THE HERO: the first frame takes the whole doorway */
    .wl__hero { position: relative; min-height: 74svh; margin: 0 calc(-1 * clamp(1.1rem, 4vw, 2.2rem)) 2.2rem;
      display: flex; align-items: flex-end; overflow: hidden; isolation: isolate; }
    .wl__hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2;
      animation: wlkb 30s ease-in-out infinite alternate; }
    .wl__hero::after { content: ""; position: absolute; inset: 0; z-index: -1;
      background: linear-gradient(180deg, rgba(10,8,7,.34), rgba(10,8,7,.06) 40%, rgba(10,8,7,.88) 88%),
        radial-gradient(90% 60% at 10% 100%, rgba(193,18,31,.3), transparent 60%); }
    @keyframes wlkb { from { transform: scale(1); } to { transform: scale(1.07) translate(-1.2%, -1%); } }
    .wl__hero-in { padding: clamp(1.4rem, 4vw, 2.6rem); }
    .wl__crumb { font-weight: 800; font-size: 0.64rem; letter-spacing: 0.22em; text-transform: uppercase;
      color: rgba(244,239,230,.75); margin: 0 0 .9rem; }
    .wl__crumb a { color: #ff5a5c; text-decoration: none; }
    .wl h1 { font-family: var(--sig); text-transform: uppercase; line-height: 0.86; color: #f4efe6;
      font-size: clamp(2.8rem, 10vw, 6.2rem); margin: 0 0 .8rem; letter-spacing: .005em; }
    .wl__for { display: inline-block; font-weight: 800; font-size: .68rem; letter-spacing: .12em;
      text-transform: uppercase; color: #fff; background: linear-gradient(165deg,#ff5a5c,#b3121b);
      border-radius: 99px; padding: .5rem 1rem; margin: 0 0 .8rem; }
    .wl__meta { font-weight: 700; font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase;
      color: rgba(244,239,230,.72); margin: 0; }
    .wl__about { font-weight: 500; font-size: clamp(1rem, 2.4vw, 1.15rem); line-height: 1.75;
      color: var(--cream-dim); max-width: 64ch; margin: 0 0 2.4rem; }
    /* THE FRAMES: two columns of poise, the feature frame full-bleed */
    .wl__frames { display: grid; gap: clamp(.9rem, 2.4vw, 1.4rem);
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr)); }
    .wl__frames figure { margin: 0; border-radius: 18px; overflow: hidden; position: relative; }
    .wl__frames .wl__feat, .wl__frames .wl__film { grid-column: 1 / -1; }
    .wl__frames img, .wl__frames video { display: block; width: 100%; height: auto; border-radius: 18px;
      transition: transform .6s cubic-bezier(.2,.7,.2,1); }
    .wl__frames figure:hover img { transform: scale(1.025); }
    .wl__frames figcaption { position: absolute; left: .8rem; bottom: .8rem; }
    .wl__frames figcaption a { display: inline-block; font-weight: 800; font-size: .66rem; letter-spacing: .1em;
      text-transform: uppercase; text-decoration: none; color: #fff;
      background: rgba(10,8,7,.72); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      border-radius: 99px; padding: .5rem .95rem; box-shadow: inset 0 0 0 1px rgba(244,239,230,.2); }
    .wl__frames figcaption a:hover { background: linear-gradient(165deg,#ff5a5c,#b3121b); }
    .wl__film figcaption { position: static; padding-top: .5rem; }
    .wl__film figcaption, .wl__film figcaption a { background: none; box-shadow: none; color: var(--cream-dim);
      font-weight: 700; font-size: .72rem; text-transform: none; letter-spacing: 0; padding: 0; }
    .wl__embed { position: relative; aspect-ratio: 16 / 9; border-radius: 18px; overflow: hidden; background: #000; }
    .wl__embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    /* frames rise as the eye reaches them */
    .wrv { opacity: 0; transform: translateY(1.6rem); transition: opacity .7s ease, transform .7s cubic-bezier(.2,.7,.2,1);
      transition-delay: calc(var(--i, 0) * 70ms); }
    .wrv.in { opacity: 1; transform: none; }
    .wl__src { margin-top: 2.8rem; }
    .wl__src h2, .wl__next h2 { font-weight: 800; font-size: 0.66rem; letter-spacing: 0.24em;
      text-transform: uppercase; color: var(--cream-dim); margin: 0 0 0.7rem; }
    .wl__src ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.35rem; }
    .wl__src a { color: var(--cream); font-weight: 600; font-size: 0.84rem; }
    .wl__next { margin-top: 2.6rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .wl__next h2 { width: 100%; }
    .wl__next a { display: inline-block; padding: 0.8rem 1.2rem; border-radius: 99px; text-decoration: none;
      color: var(--cream); font-weight: 800; font-size: 0.74rem; letter-spacing: .08em; text-transform: uppercase;
      box-shadow: inset 0 0 0 1px var(--edge); }
    .wl__next a.hot { color: #fff; background: linear-gradient(165deg,#ff5a5c,#b3121b); box-shadow: none; }
    .wl__by { margin-top: 2.6rem; font-weight: 600; font-size: 0.8rem; color: var(--cream-dim); line-height: 1.7; }
    .wl__by a { color: var(--cream); }
    @media (prefers-reduced-motion: reduce) {
      .wl__hero img { animation: none; }
      .wrv { opacity: 1; transform: none; transition: none; }
      .wl__frames img { transition: none; }
    }
  </style>
  <script type="application/ld+json">
${ldFor(ev)}
  </script>
</head>
<body>
  <main class="wl">
    <header class="wl__hero">
      ${ev.cover || (media[0] && media[0].src) ? `<img src="../${esc(ev.cover || media[0].poster || media[0].src)}" alt="" aria-hidden="true">` : ""}
      <div class="wl__hero-in">
        <p class="wl__crumb"><a href="../index.html">HERE</a> / <a href="../gallery.html">The gallery</a></p>
        ${ev.client ? `<p class="wl__for">Photographed for ${esc(ev.client)}</p>` : ""}
        <h1>${esc(ev.title)}</h1>
        <p class="wl__meta">${esc([whereLine(ev), ev.date, (ev.tags || []).join(" · ")].filter(Boolean).join(" · "))}</p>
      </div>
    </header>
    ${ev.about ? `<p class="wl__about">${esc(ev.about)}</p>` : ""}

    <div class="wl__frames">
${frames}
    </div>
${sources}
    <section class="wl__next">
      <h2>The doors</h2>
      <a href="../gallery.html">The whole gallery &#8594;</a>
      ${sellable ? '<a class="hot" href="../gallery.html#shop">Own a frame from this shoot &#8594;</a>' : ""}
      <a class="hot" href="../hire.html">Book a shoot like this &#8594;</a>
    </section>

    <p class="wl__by">Photographed by <a href="../matthew-mccluster.html">${esc(ME.name)}</a> for ${esc(ME.org)}${
      ev.client ? `, on assignment for ${esc(ev.client)}` : ""
    }. <a href="mailto:${esc(ME.email)}">${esc(ME.email)}</a></p>
  </main>
  <script>
  (function () {
    var els = document.querySelectorAll(".wrv");
    if (!("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("in"); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.1 });
    els.forEach(function (e) { io.observe(e); });
  })();
  </script>
</body>
</html>
`;
}

/* ---- write it all ---- */
const live = (gallery.events || []).filter((e) => (e.media || []).length);
mkdirSync(join(ROOT, "walls"), { recursive: true });

live.forEach((ev) => {
  writeFileSync(join(ROOT, "walls", `${ev.id}.html`), pageFor(ev));
  console.log(`walls/${ev.id}.html  ${(ev.media || []).length} frames  ${ev.client || "—"}`);
});

/* The index is consolidated: the Gallery is the one door for the work
   (owner's call — too many doors). walls.html forwards; the wall pages
   keep their own SEO and are linked from the gallery's case view. */
writeFileSync(join(ROOT, "walls.html"), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>This door moved into the Gallery · McCluster</title>
  <meta name="robots" content="noindex">
  <link rel="canonical" href="${SITE}/gallery.html">
  <script>location.replace("gallery.html");<\/script>
  <meta http-equiv="refresh" content="0;url=gallery.html">
</head>
<body>
  <p style="font-family:sans-serif;padding:2rem">The walls hang in the Gallery now.
    <a href="gallery.html">Continue</a>.</p>
</body>
</html>
`);
console.log(`walls.html  -> gallery.html (consolidated stub)`);

/* ---- sitemap: the wall pages, with a real lastmod ---- */
const smPath = join(ROOT, "sitemap.xml");
let sm = readFileSync(smPath, "utf8");
sm = sm.replace(/\s*<url><loc>https:\/\/here\.mccluster\.org\/walls[^<]*<\/loc>[\s\S]*?<\/url>/g, "");
const today = new Date().toISOString().slice(0, 10);
const rows =
  live.map((ev) => `  <url><loc>${SITE}/walls/${ev.id}.html</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>`).join("\n") + "\n";
sm = sm.replace("</urlset>", rows + "</urlset>");
writeFileSync(smPath, sm);
console.log(`sitemap.xml  +${live.length + 1} urls`);
