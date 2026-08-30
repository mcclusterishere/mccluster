/* THE RÉSUMÉ, AS STRUCTURE.
 *
 * matthew-mccluster.html is the source of the career history. The PDF gets
 * at it by printing the page; a .docx cannot do that, so it needs the same
 * content as data. This is the one place that turns the page into data, so
 * a third rendering later does not invent a fourth reading of the markup.
 *
 * Deliberately regex, not a DOM library: this runs in a build with no
 * browser, the markup is ours and stable, and every selector it depends on
 * is asserted in tools/verify-resume.mjs — if the page is restructured,
 * that fails loudly rather than this silently emitting an empty résumé.
 */

const strip = (h) =>
  h.replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ").trim();

const one = (html, re) => { const m = html.match(re); return m ? strip(m[1]) : ""; };

export function parseResume(html) {
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));

  const out = {
    name: one(main, /<h1[^>]*>([\s\S]*?)<\/h1>/),
    kicker: one(main, /class="bio__k"[^>]*>([\s\S]*?)<\/p>/),
    role: one(main, /class="bio__role"[^>]*>([\s\S]*?)<\/p>/),
    contact: one(main, /class="rsm-contact"[^>]*>([\s\S]*?)<\/p>/),
    summary: one(main, /class="bio__lede"[^>]*>([\s\S]*?)<\/p>/),
    sections: [],
  };

  /* split on h2 and read whatever block follows each one */
  const parts = main.split(/<h2[^>]*>/).slice(1);
  for (const part of parts) {
    const title = strip(part.slice(0, part.indexOf("</h2>")));
    const body = part.slice(part.indexOf("</h2>") + 5);

    /* the social row is a screen affordance; the identifiers above it are
       the durable version of the same claim. Paper and Word both skip it,
       exactly as css/resume-print.css does. */
    if (/class="find"/.test(body)) continue;

    if (/class="tl"/.test(body)) {
      /* Split on the OUTER role items only. A role now nests a <ul class="dt">
         of accomplishments, so a naive /<li>.*?<\/li>/ stops at the first
         nested </li> and every job loses its bullets — silently, which is
         the bad kind. Split on the year marker instead, which only ever
         opens a role. */
      const chunks = body.split(/(?=<li[^>]*>\s*<span class="yr">)/).slice(1);
      const items = chunks.map((c) => ({
        years: one(c, /class="yr"[^>]*>([\s\S]*?)<\/span>/),
        title: one(c, /class="ti"[^>]*>([\s\S]*?)<\/span>/),
        where: one(c, /class="wh"[^>]*>([\s\S]*?)<\/span>/),
        bullets: (() => {
          const i = c.indexOf('class="dt"');
          if (i < 0) return [];
          const inner = c.slice(i, c.indexOf("</ul>", i));
          return [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => strip(m[1])).filter(Boolean);
        })(),
      })).filter((j) => j.title);
      if (items.length) out.sections.push({ title, kind: "roles", items });
      continue;
    }

    if (/class="ids"/.test(body)) {
      const items = [...body.matchAll(/<div class="id">([\s\S]*?)<\/div>/g)].map((m) => ({
        label: one(m[1], /<b>([\s\S]*?)<\/b>/),
        value: strip(m[1].replace(/<b>[\s\S]*?<\/b>/, "")),
      })).filter((i) => i.label);
      if (items.length) out.sections.push({ title, kind: "ids", items });
      continue;
    }

    if (/class="bio__facts"/.test(body)) {
      const list = body.slice(body.indexOf('class="bio__facts"'));
      const items = [...list.slice(0, list.indexOf("</ul>")).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
        .map((m) => ({
          label: one(m[1], /<b>([\s\S]*?)<\/b>/),
          value: strip(m[1].replace(/<b>[\s\S]*?<\/b>/, "")),
        }))
        .filter((f) => f.label || f.value);
      if (items.length) out.sections.push({ title, kind: "facts", items });
      continue;
    }

    /* plain prose: take paragraphs up to the next section */
    const items = [...body.matchAll(/<p(?![^>]*class="(?:bio__foot|rsm-contact)")[^>]*>([\s\S]*?)<\/p>/g)]
      .map((m) => strip(m[1]))
      .filter((t) => t.length > 40);
    if (items.length) out.sections.push({ title, kind: "prose", items });
  }

  return out;
}
