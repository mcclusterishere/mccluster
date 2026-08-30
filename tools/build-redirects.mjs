/* Build the payload that keeps the OLD host alive after a domain rename.

     node tools/build-redirects.mjs

   Writes redirects/ — a complete, standalone GitHub Pages site whose only
   job is to forward every old URL to the same path on the new host.

   ---- WHY THIS EXISTS AS A SECOND SITE ---------------------------------

   GitHub Pages serves exactly one custom domain per repository, and it
   takes that name from CNAME. The moment this repo's CNAME says
   matthew.mccluster.org, Pages stops answering for here.mccluster.org —
   not with a redirect, with nothing. Every QR code printed on a garment
   label, every NFC tag, every link in a proclamation citation and every
   URL Google has indexed points at the old host and would simply die.

   So the old host needs its own tiny property. Push redirects/ to a
   second repo, point Pages at it, and the old name keeps answering
   forever at the cost of one file per page.

   ---- WHY 200-PLUS-CANONICAL AND NOT JUST 404.html --------------------

   A single 404.html would technically catch everything, because Pages
   serves it for any unmatched path — but it serves it with an HTTP 404,
   and a 404 is the one status that tells a search engine "this is gone,
   drop it." So every page that actually exists gets a real stub that
   returns 200 and carries a canonical to its new address; 404.html stays
   as the catch-all for deep links and anything added later.

   The redirect itself is a meta refresh plus location.replace, because
   static hosting cannot issue a true 301. Google treats an instant meta
   refresh as a permanent redirect, and the canonical does the signal
   transfer. location.replace runs first for humans, keeps the query
   string and the hash (the site has #/buy/<id> and ?s=<slug> deep links
   that would otherwise be lost), and leaves no dead entry in history.

   ---- THE BETTER OPTION, IF YOU EVER MOVE DNS -------------------------

   A Cloudflare redirect rule does this as a real 301 with no files at
   all, and can cover the apex in the same rule. If DNS ever moves to
   Cloudflare, delete this payload and write one rule instead. Until
   then, this works on the hosting that exists today.
*/
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "redirects");

const OLD_HOST = process.argv[3] || "here.mccluster.org";
const NEW_HOST = process.argv[2] || readFileSync(join(ROOT, "CNAME"), "utf8").trim();

if (OLD_HOST === NEW_HOST) {
  console.error(`old and new host are both ${NEW_HOST} — nothing to redirect`);
  process.exit(1);
}

/* Only real, reachable pages. Owner desks are included on purpose: a
   bookmarked desk that dies is still a broken link, and the destination
   does its own auth anyway. */
const SKIP_DIRS = new Set(["node_modules", ".git", "assets", "raw", "vault-raw", "probe", "redirects", "demos", "native", "platform", "apps", "packages", "docs", "tools", "scripts", "supabase", "workers", "closet-raw",
  /* kept in the repo, deliberately off the live site — a redirect stub
     pointing at a page the deploy strips is a stub that 404s */
  "_unfinished"]);

function pages(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (SKIP_DIRS.has(f) || f.startsWith(".")) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (f.endsWith(".html")) out.push(relative(ROOT, p));
  }
  return out;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function stub(path) {
  const target = `https://${NEW_HOST}/${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved &middot; ${esc(NEW_HOST)}</title>
<link rel="canonical" href="${esc(target)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>location.replace(${JSON.stringify(target)} + location.search + location.hash);</script>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:12vh auto;max-width:34rem;padding:0 1.2rem;background:#0a0807;color:#f4efe6}a{color:#e5383b}</style>
</head>
<body>
<p>This moved to <a href="${esc(target)}">${esc(NEW_HOST)}/${esc(path)}</a>.</p>
<p>If you are not sent along automatically, follow the link.</p>
</body>
</html>
`;
}

/* The catch-all. Pages hands it any path it has no file for, so it has to
   work out its own destination at runtime rather than being told one. */
const notFound = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Moved &middot; ${esc(NEW_HOST)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>location.replace("https://${NEW_HOST}" + location.pathname + location.search + location.hash);</script>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:12vh auto;max-width:34rem;padding:0 1.2rem;background:#0a0807;color:#f4efe6}a{color:#e5383b}</style>
</head>
<body>
<p>Everything moved to <a href="https://${esc(NEW_HOST)}/">${esc(NEW_HOST)}</a>.</p>
</body>
</html>
`;

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const list = pages(ROOT).sort();
for (const p of list) {
  const dest = join(OUT, p);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, stub(p));
}

writeFileSync(join(OUT, "404.html"), notFound);
writeFileSync(join(OUT, "CNAME"), OLD_HOST + "\n");
writeFileSync(join(OUT, "robots.txt"),
  `# The old host. Every page here is a redirect to ${NEW_HOST}.\n` +
  `# Crawling is allowed on purpose: a blocked redirect is a redirect\n` +
  `# nobody follows, and the canonical is how the move gets recorded.\n` +
  `User-agent: *\nAllow: /\n\nSitemap: https://${NEW_HOST}/sitemap.xml\n`);

writeFileSync(join(OUT, "README.md"),
`# ${OLD_HOST} — the forwarding address

Generated by \`tools/build-redirects.mjs\`. Do not hand-edit; regenerate.

This is a whole second website whose only job is to answer for
**${OLD_HOST}** and send every visitor to the same path on
**${NEW_HOST}**. It exists because GitHub Pages serves exactly one custom
domain per repository, so the main repo cannot keep answering for a name
it no longer carries in \`CNAME\`.

## Deploying it

1. Create a new empty GitHub repo, e.g. \`mcclusterishere/here-forwarding\`.
2. Copy **the contents of this folder** (not the folder itself) into it and push.
3. In that repo: **Settings → Pages → Source: main branch, / (root)**.
4. Its \`CNAME\` already says \`${OLD_HOST}\`, so Pages claims the name.
   Leave the existing DNS record for \`${OLD_HOST}\` exactly as it is —
   it already points at GitHub.
5. Wait for the certificate, then tick **Enforce HTTPS**.

${list.length} page stubs, plus a \`404.html\` catch-all that forwards any
path not listed — including anything added to the main site later.

## Better, if DNS ever moves to Cloudflare

One redirect rule replaces this entire repo and issues a real 301 instead
of a meta refresh. Delete this then.
`);

console.log(`${OLD_HOST}  ->  ${NEW_HOST}`);
console.log(`${list.length} page stubs + 404 catch-all + CNAME + robots.txt`);
console.log(`written to redirects/ — push its CONTENTS to a second repo`);
