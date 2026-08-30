/* THE BOT'S KNOWLEDGE, BUILT FROM THE LEDGER RATHER THAN WRITTEN OUT.
 *
 *     node scripts/kb-build.mjs            # print the SQL
 *     node scripts/kb-build.mjs --out f.sql
 *
 * The answering path in supabase/functions/inbox refuses to say anything it
 * cannot cite — gate() treats an uncited claim as fatal and hands off to a
 * person instead. Which is right, and which means an empty kb_documents
 * table is not a bot with no knowledge, it is a bot that hands off every
 * single message. This is what fills it.
 *
 * TWO RULES, BOTH LOAD-BEARING.
 *
 * 1. NO PRICE IS TYPED HERE. Every figure comes out of data/offers.json
 *    through the SAME derive() and priceOf() the website renders with —
 *    js/offers.js is loaded and run against a stub window, rather than
 *    reimplemented. If the two ever disagreed, the bot would quote one
 *    number in a DM while the card charged another, and nobody would find
 *    out until a refund. Reusing the function makes that impossible rather
 *    than unlikely.
 *
 * 2. NOTHING UNAPPROVED GETS A NUMBER. The ledger marks some prices
 *    approved:false. priceOf() already returns the public note instead of a
 *    figure for those, and this script prints whatever it returns and never
 *    reaches around it.
 *
 * Chunking is done by the deployed chunkDocument() from brain.ts, not by a
 * copy of it, so what lands in the table is exactly what the function would
 * have produced through /kb_put.
 */
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import vm from "vm";
import { chunkDocument } from "../supabase/functions/inbox/brain.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFile(join(ROOT, p), "utf8");
const readJson = async (p) => JSON.parse(await read(p));

/* ---------------------------------------------------------------- *
 * THE WEBSITE'S OWN PRICING ENGINE, RUN HERE
 *
 * js/offers.js is a browser IIFE that hangs its API off `window`. It is
 * not a module and it is not going to become one just for this; giving it
 * a window is four lines and keeps one implementation of the formulas.
 * ---------------------------------------------------------------- */
async function offersApi() {
  const src = await read("js/offers.js");
  /* Enough DOM for the file to reach the bottom and publish its API. It
     paints nothing here: every query answers "not on this page", which is
     the same answer it gets on a page that has no cards on it. */
  const el = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
               setAttribute() {}, appendChild() {}, classList: { contains: () => false },
               dataset: {}, style: {}, innerHTML: "", textContent: "" };
  const sandbox = {
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    document: {
      currentScript: null,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ ...el }),
      addEventListener() {},
      readyState: "complete",
      body: { ...el },
    },
    fetch: () => Promise.reject(new Error("kb-build does not fetch; the ledger is read from disk")),
    setTimeout, clearTimeout, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "js/offers.js" });
  const api = sandbox.window.MCC_OFFERS;
  if (!api?.derive || !api?.priceOf) throw new Error("js/offers.js did not expose derive/priceOf");
  return api;
}

const esc = (s) => String(s ?? "").replace(/'/g, "''");

/* One markdown document. Headings matter: chunkDocument splits on them and
   prefixes each chunk's heading with the document title, so a chunk found
   by "hosting" still knows which page it came off. */
function doc({ kind, title, url, body }) {
  return { kind, title, url: url ?? null, body: body.trim() + "\n" };
}

async function build() {
  const O = await offersApi();
  const L = O.derive(await readJson("data/offers.json"));
  const offerings = (await readJson("data/offerings.json")).offerings || [];
  const sites = await readJson("data/sites.json").catch(() => ({}));
  const docs = [];

  const site = "https://matthew.mccluster.org";
  const money = O.dollars;

  /* ---------- one document per offer, priced by the ledger ---------- */
  for (const o of O.listed(L)) {
    const lines = [];
    lines.push(o.lede || o.one_line || "");
    lines.push("");

    for (const mode of (o.billing_modes || o.modes || ["m"])) {
      const pr = O.priceOf(L, o.id, mode);
      if (!pr) continue;
      const heading =
        mode === "equity" ? "Equity Uprise price"
        : mode === "year" ? "Paying the year up front"
        : "Price";
      lines.push(`## ${heading}`);
      if (!pr.approved) {
        // NOT a number, and not the reason it is not a number
        lines.push(pr.note || "Priced with you during discovery.");
      } else if (pr.from != null) {
        lines.push(`From ${money(pr.from)} ${pr.per || ""}.`.trim());
        for (const r of pr.rate_lines || []) {
          lines.push(`- ${r.label}: ${money(r.amount)} — ${r.unit}`);
        }
      } else {
        lines.push(`${pr.display} ${pr.per || ""}`.trim() + ".");
        if (pr.recurring) lines.push(`Then ${pr.recurring}.`);
        if (pr.first_year) lines.push(`First year all in: ${pr.first_year}.`);
        if (pr.saving) lines.push(`Paying the year together saves ${pr.saving}.`);
        if (pr.share_percent) {
          lines.push(
            `Plus ${pr.share_percent}% of approved eligible connected online revenue, ` +
            `for up to ${pr.term_months} months, ending at the earlier of the term or a ${money(pr.cap)} cap. ` +
            `No ownership is taken.`);
        }
      }
      lines.push("");
    }

    if (o.includes?.length) {
      lines.push("## What is included");
      for (const i of o.includes) lines.push(`- ${i}`);
      lines.push("");
    }
    if (o.excludes?.length) {
      lines.push("## What is not included");
      for (const i of o.excludes) lines.push(`- ${i}`);
      lines.push("");
    }
    if (o.equity_note) {
      lines.push("## Equity Uprise");
      lines.push(o.equity_note);
      lines.push("");
    }
    if (o.never_promise?.length) {
      lines.push("## Never promised");
      lines.push("These are not offered and must never be implied:");
      for (const i of o.never_promise) lines.push(`- ${i}`);
      lines.push("");
    }

    lines.push("## How to buy it");
    const ck = o.checkout || {};
    const ways = Object.keys(ck).filter((k) => ck[k] && typeof ck[k] === "object" && ck[k].offering);
    if (ways.length) {
      for (const w of ways) {
        lines.push(`- ${ck[w].label}: ${site}/pay.html?offer=${ck[w].offering}`);
      }
      lines.push(`Or start from the cards at ${site}/sites.html`);
    } else if (o.next_step) {
      lines.push(`- ${o.next_step.label}: ${site}/${o.next_step.href}`);
    }

    docs.push(doc({
      kind: "offer",
      title: o.name + (o.full_name && o.full_name !== o.name ? ` (${o.full_name})` : ""),
      url: `${site}/sites.html#${o.id}`,
      body: lines.join("\n"),
    }));
  }

  /* ---------- what is actually on sale, by slug ---------- */
  docs.push(doc({
    kind: "offering",
    title: "Everything that can be paid for online",
    url: `${site}/sites.html`,
    body: [
      "These are the exact things a card can be charged for on this site today.",
      "Every one of them opens a Stripe checkout. Nothing else can be paid for online;",
      "anything not on this list is arranged through the questions at /onboard.html.",
      "",
      "## The list",
      ...offerings
        .filter((x) => x.slug && x.title)
        .map((x) => {
          const p = x.price_type === "custom"
            ? `you choose, ${money(x.min || 1)} to ${money(x.max || 25000)}`
            : money(x.price);
          return `- ${x.title} — ${p} — ${site}/pay.html?offer=${x.slug}`;
        }),
    ].join("\n"),
  }));

  /* ---------- the website build itself ---------- */
  docs.push(doc({
    kind: "service",
    title: "How the website build works",
    url: `${site}/sites.html#build`,
    body: `
The website itself is built for free. What is paid for is the domain and the
hosting: the address people type, and the machine that answers when they do.

## What free actually means
The build is included. There is no setup fee, no design fee and no per-page
charge. What is billed is the address and the ground it sits on.

## The order things happen in
1. Pick the address on the domain and hosting card at ${site}/sites.html and check it is free.
2. Pay to go live. The chosen name travels with the payment.
3. The draft gets built and sent for review.
4. Changes get made until it is right.
5. It goes live on the address.

## Drafts
Buying the domain puts you on a draft a month: one round of changes a month,
included, for as long as the hosting is running.

## Who does the work
Matthew McCluster, McCluster Corp. One person who builds it and one desk that
runs it — not an agency handing the work down a chain.
`.trim(),
  }));

  /* ---------- domains ---------- */
  docs.push(doc({
    kind: "service",
    title: "Domain names: checking one and buying one",
    url: `${site}/sites.html#domains`,
    body: `
## Is a name available
Type it into the domain and hosting card at ${site}/sites.html and press
Check. It asks the registries directly and answers straight away whether that
address is available or already taken, and what it costs. Availability is
checked live; nobody has to look it up for you and there is nothing to wait
for.

## Which endings can be bought in one tap
.com, .net and .org. Each is ${money(33)} for the year.

## Other endings
.io, .co, .dev, .app, .me, .info, .biz, .us, .church, .tv and .xyz can all be
looked up and can all be registered — they are just priced with you first,
because they do not all cost the same as a .com. Ask and a price comes back.

## Checking does not hold a name
A search says the address was available at the moment it was asked. Nothing
is reserved until it is registered, and it is registered once the payment
lands. An address that was available an hour ago can be taken by somebody
else, so the answer is never a promise.

## Renewal
The domain renews at ${money(33)} a year.
`.trim(),
  }));

  /* ---------- hosting ---------- */
  const runway = O.offerOf(L, "runway");
  const rp = runway?.pricing || {};
  docs.push(doc({
    kind: "service",
    title: "What hosting includes and what it costs",
    url: `${site}/sites.html#hosting`,
    body: `
## The monthly rate
${money(rp.recurring?.amount)} a month, every month after the first. The first
month is already inside the go-live total, so month one is never billed twice.

## Paying the year together
${money(rp.annual?.monthly_equivalent)} a month instead of ${money(rp.recurring?.amount)},
when the twelve months are paid together. That is ${money(rp.annual?.hosting_amount)}
for the year of hosting, or ${money(rp.annual?.total)} to go live including the
domain, and it saves ${money(rp.annual?.saving)} against paying monthly.

## What is in it
- The machine that answers when somebody types the address
- SSL, so the address loads as https and browsers do not warn people off
- Backups
- Keeping it online

## No revenue share
Domain and hosting has no Equity Uprise version and takes no percentage of
anything. It is an address and a machine, billed like plumbing.
`.trim(),
  }));

  /* ---------- Equity Uprise, in plain words ---------- */
  const eq = (L.modes || {}).equity || {};
  const anti = O.priceOf(L, "anti-social", "equity");
  docs.push(doc({
    kind: "program",
    title: "Equity Uprise: paying with a share of revenue instead of cash",
    url: `${site}/sites-details.html#equity`,
    body: `
${eq.plain || ""}

## What it is
Half the standard monthly price, against a capped share of the revenue the
work actually brings in. It is a payment arrangement, not an investment: no
ownership is taken and no equity in the company changes hands, whatever the
name suggests.

## The numbers on Anti-Social
${anti?.approved
  ? `${anti.display} a month, plus ${anti.share_percent}% of approved eligible ` +
    `connected online revenue, for up to ${anti.term_months} months, ending at the ` +
    `earlier of the term or a ${money(anti.cap)} cap.`
  : (anti?.note || "Structured during discovery.")}

## Which services have it
Anti-Social has an approved Equity Uprise rate. Who Did the Shoot and Write a
Song are quoted per project, so an arrangement for those is written during
discovery and there is no standing formula. Domain and hosting has none at all.

## It is an agreement, not a button
Equity Uprise cannot be bought in a tap because it is a contract. It starts at
${site}/onboard.html and the terms are written down before anything begins.
`.trim(),
  }));

  /* ---------- what people actually ask ---------- */
  docs.push(doc({
    kind: "faq",
    title: "Common questions",
    url: `${site}/sites.html#faq`,
    body: `
## How much is a website
The build is free. Going live is ${money(rp.start?.total)} — ${money(33)} for the
domain for a year and ${money(rp.recurring?.amount)} for the first month of
hosting — then ${money(rp.recurring?.amount)} a month. Or ${money(rp.annual?.total)}
to go live with the whole year of hosting paid, which drops the monthly rate to
${money(rp.annual?.monthly_equivalent)}.

## Do you take a cut of my sales
Not on domain and hosting. Never. That one is a flat rate.
On Anti-Social there is an optional Equity Uprise arrangement, and it is optional.

## How long does it take
It starts when the payment lands and the draft comes back for review. A real
timeline depends on how ready the words and pictures are, which is one of the
questions asked at ${site}/onboard.html.

## Can I keep my own domain
Yes. Point it at the hosting and keep it. The domain line is only for
registering a new one.

## Do you do social media as well
Yes — that is Anti-Social. Website and socials run as one service rather than
two products.

## Do you do photography and video
Yes — that is Who Did the Shoot. Priced per project, per day or per event.

## Where do I actually pay
${site}/sites.html — four cards, one price and one button each.

## Can I see something you built
${site}/sites.html has the client examples, and each one opens the real site.
`.trim(),
  }));

  /* ---------- what it costs everywhere else ----------

     THE ONE DOCUMENT WHOSE NUMBERS DO NOT COME FROM THE LEDGER, because
     they are not McCluster's prices — they are what the rest of the
     market charges, researched and dated in data/market-rates.json.

     Every comparison below is COMPUTED, never asserted. The script puts
     the band and the real price side by side and works out which side of
     the band the price falls on. That matters because the answer is not
     always flattering: the photography half-day sits ABOVE the published
     band, and a page that only makes the comparison when it wins is a
     page nobody believes the second time. */
  const market = await readJson("data/market-rates.json").catch(() => null);
  if (market) {
    const shoot = O.offerOf(L, "who-did-the-shoot") || {};
    const rateLine = (id) => (((shoot.pricing || {}).m || {}).rate_lines || [])
      .filter((r) => r.id === id)[0];

    /* what WE charge for the thing this band describes, from the ledger */
    const ours = (id) => {
      const line = (rid, note) => {
        const r = rateLine(rid);
        return r ? { amount: r.amount, text: money(r.amount) + (note || "") } : null;
      };
      switch (id) {
        case "website-build":
          return { amount: 0, text: "free — the build is included, not billed" };
        case "hosting-maintenance":
          return { amount: rp.recurring.amount, text: money(rp.recurring.amount) + " a month" };
        case "social-management": {
          const pr = O.priceOf(L, "anti-social", "m");
          return pr && pr.approved
            ? { amount: pr.amount, text: money(pr.amount) + " a month — and that runs the WEBSITE as well as the feeds" }
            : null;
        }
        case "headshot-session": return line("photo-portrait");
        case "event-hour":       return line("photo-event", " an hour");
        case "photo-half-day":   return line("photo-half");
        case "photo-full-day":   return line("photo-full");
        default: return null;
      }
    };

    const gold = market.golden_discount || {};
    const lines = [
      gold.the_claim_this_supports || "",
      "",
      market.what_these_numbers_are,
      "",
      "Checked " + market.checked + " for " + market.markets.join(" and ") + ".",
      market.stale_line,
      "",
      "## The discount, in one line",
      gold.what_it_means || "",
      "",
    ];

    for (const r of market.rates) {
      const mine = ours(r.id);
      lines.push("## " + r.label);
      lines.push("Everywhere else: " + money(r.low) + " to " + money(r.high) +
                 " " + r.unit + ".");
      if (mine) {
        lines.push("Here: " + mine.text + ".");
        /* the verdict, worked out rather than claimed */
        if (mine.amount === 0) {
          lines.push("That line is not charged at all here.");
        } else if (mine.amount < r.low) {
          lines.push("That is below the bottom of the band.");
        } else if (mine.amount > r.high) {
          lines.push("That is ABOVE the band, and it should be said plainly if it comes up.");
        } else {
          lines.push("That sits inside the band rather than under it.");
        }
      }
      if (gold.percent_off) {
        const ceiling = Math.round(r.typical * (100 - gold.percent_off)) / 100;
        lines.push("A third off that median is " + money(ceiling) +
                   ", which is the most this may cost.");
      }
      if (r.detail) lines.push(r.detail);
      lines.push("");
    }

    lines.push("## How to use these numbers");
    for (const rule of market.how_to_use_it) lines.push("- " + rule);

    docs.push(doc({
      kind: "market",
      title: "What this work costs everywhere else",
      url: `${site}/sites.html#market`,
      body: lines.join("\n"),
    }));
  }

  /* ---------- who qualifies for Equity Uprise ----------
     The eligibility rules are the reason the discount can exist at all,
     so they are a document of their own rather than a paragraph inside
     the programme document. Somebody asking "can I get 50% off" is
     asking this question, and the answer has three parts. */
  const eq2 = (L.modes || {}).equity || {};
  if (eq2.eligibility) {
    const el = eq2.eligibility;
    const lines = [el.plain || "", ""];
    lines.push("## What you need, and why");
    for (const r of el.requirements || []) {
      lines.push("- " + r.must + " " + r.why);
    }
    lines.push("");
    lines.push("## If that is not you");
    lines.push(el.not_eligible || "");
    lines.push("");
    lines.push("## What the discount is");
    const eqp = O.priceOf(L, "anti-social", "equity");
    lines.push(
      "Half the standard monthly price" +
      (eqp && eqp.approved ? " — " + eqp.display + " a month on Anti-Social instead of " +
        (O.priceOf(L, "anti-social", "m") || {}).display : "") +
      ", against a capped share of the revenue the work brings in.");
    lines.push("It is a payment arrangement. No ownership changes hands.");
    lines.push("");
    lines.push("## It is not automatic");
    lines.push("Meeting the three requirements makes somebody ELIGIBLE. It still takes a programme-fit review and a signed agreement, and it is never preselected for anybody. Do not tell somebody they are approved.");

    docs.push(doc({
      kind: "program",
      title: "Who qualifies for Equity Uprise",
      url: `${site}/sites-details.html#equity-eligibility`,
      body: lines.join("\n"),
    }));
  }

  /* ---------- who this is ---------- */
  docs.push(doc({
    kind: "about",
    title: "Who McCluster is",
    url: site,
    body: `
McCluster Corp. Matthew McCluster builds the websites, runs the hosting and
runs the desk.

## What is sold
Four things: domain and hosting, Anti-Social (website and social management as
one service), Who Did the Shoot (photography and video), and Write a Song
(original music built into a campaign).

## Where things live
- Everything for sale: ${site}/sites.html
- The long version, with the full terms: ${site}/sites-details.html
- The questions, to start anything that is not a one-tap purchase: ${site}/onboard.html
- Equity Uprise, the civic programme: ${site}/equity-uprise.html
- The music: ${site}/album.html
`.trim(),
  }));

  /* ---------- who has been built for ---------- */
  const shown = (sites.showcase || []).filter((s) => s?.slug && s?.name);
  if (shown.length) {
    docs.push(doc({
      kind: "proof",
      title: "Sites already built",
      url: `${site}/sites.html#examples`,
      body: [
        "Real clients with real sites. Each one opens.",
        "",
        "## The list",
        ...shown.map((s) => `- ${s.name}${s.kind ? ` (${s.kind})` : ""}${s.line ? ` — ${s.line}` : ""} — ${site}/demo.html?s=${s.slug}`),
      ].join("\n"),
    }));
  }

  return docs;
}

/* ---------------------------------------------------------------- *
 * SQL
 *
 * Idempotent on (kind, coalesce(url, title)), which is the unique index
 * kb_documents already carries, and the chunks are replaced rather than
 * added to — re-running this must not double every passage.
 * ---------------------------------------------------------------- */
function toSql(docs) {
  const out = [
    "-- GENERATED BY scripts/kb-build.mjs. Do not edit by hand: edit the",
    "-- ledger or the script and run it again.",
    "--",
    "-- Embeddings are left null on purpose. kb_search() fuses full-text and",
    "-- vector ranks and works on full-text alone, so the bot answers today",
    "-- with no embedding provider configured; running /kb_put later fills",
    "-- the vectors in and the same rows get better, rather than different.",
    "begin;",
    "",
    "with house as (select id from public.orgs where slug = 'mccluster')",
    "select 1;",
    "",
  ];

  for (const d of docs) {
    const chunks = chunkDocument(d.title, d.body);
    if (!chunks.length) continue;
    const hash = String(d.body.length) + ":" + [...d.body].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16);

    out.push(`-- ${d.title} (${chunks.length} chunk${chunks.length === 1 ? "" : "s"})`);
    out.push(`insert into public.kb_documents (org_id, kind, url, title, body, source, content_hash, enabled)`);
    out.push(`select o.id, '${esc(d.kind)}', ${d.url ? `'${esc(d.url)}'` : "null"}, '${esc(d.title)}', '${esc(d.body)}', 'ledger', '${esc(hash)}', true`);
    out.push(`  from public.orgs o where o.slug = 'mccluster'`);
    /* THE CONFLICT TARGET IS THE TENANT'S, NOT THE HOUSE'S.
       0027 widened this index to (org_id, kind, coalesce(url, title)) when
       the knowledge base became multi-tenant. Naming the old two-column
       target does not just fail -- it would, if it matched anything, treat
       two customers' pages with the same title as the same document. */
    out.push(`on conflict (org_id, kind, coalesce(url, title)) do update`);
    out.push(`  set title = excluded.title, body = excluded.body,`);
    out.push(`      content_hash = excluded.content_hash, enabled = true, updated_at = now();`);
    out.push("");
    /* Scoped to the house org for the same reason: a rebuild here must not
       reach into another tenant's chunks, and "same kind, same url" is a
       collision waiting to happen across customers who all sell hosting. */
    out.push(`delete from public.kb_chunks c using public.kb_documents d, public.orgs o`);
    out.push(` where c.document_id = d.id and d.org_id = o.id and o.slug = 'mccluster'`);
    out.push(`   and d.kind = '${esc(d.kind)}'`);
    out.push(`   and coalesce(d.url, d.title) = '${esc(d.url ?? d.title)}';`);
    out.push("");
    out.push(`insert into public.kb_chunks (document_id, ordinal, heading, body, tokens)`);
    out.push(`select d.id, v.ordinal, v.heading, v.body, v.tokens from public.kb_documents d, public.orgs o,`);
    out.push(`(values`);
    out.push(chunks.map((c) =>
      `  (${c.ordinal}, '${esc(c.heading)}', '${esc(c.body)}', ${Math.ceil(c.body.length / 4)})`
    ).join(",\n"));
    out.push(`) as v(ordinal, heading, body, tokens)`);
    out.push(` where d.org_id = o.id and o.slug = 'mccluster'`);
    out.push(`   and d.kind = '${esc(d.kind)}' and coalesce(d.url, d.title) = '${esc(d.url ?? d.title)}';`);
    out.push("");
  }

  out.push("commit;");
  return out.join("\n");
}

const docs = await build();

/* TWO DOCUMENTS CANNOT SHARE AN IDENTITY.
   kb_documents is unique on (org_id, kind, coalesce(url, title)), so two
   documents of the same kind pointing at the same page are not two rows —
   they are one row, written twice, and the second one wins. Three service
   documents all pointing at /sites.html silently became one, and the only
   symptom was a bot that had never heard of hosting. Loud here instead. */
{
  const seen = new Map();
  for (const d of docs) {
    const id = `${d.kind}\u0000${d.url ?? d.title}`;
    if (seen.has(id)) {
      console.error(`FATAL: "${d.title}" and "${seen.get(id)}" share the identity ` +
        `(${d.kind}, ${d.url ?? d.title}). One would overwrite the other. ` +
        `Give one of them a distinct url — a #fragment is enough.`);
      process.exit(1);
    }
    seen.set(id, d.title);
  }
}

const sql = toSql(docs);
const outArg = process.argv.indexOf("--out");
if (outArg > -1 && process.argv[outArg + 1]) {
  await writeFile(join(ROOT, process.argv[outArg + 1]), sql + "\n");
  const chunks = docs.reduce((n, d) => n + chunkDocument(d.title, d.body).length, 0);
  console.error(`${docs.length} documents, ${chunks} chunks -> ${process.argv[outArg + 1]}`);
} else {
  console.log(sql);
}
