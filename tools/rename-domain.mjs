/* Move the whole site to a new domain in one pass.

     node tools/rename-domain.mjs matthew.mccluster.org

   Rewrites CNAME, every canonical, every og:url, the sitemap, the wall
   page generator, the tap card and the vCard. Prints what changed.

   ⚠ RUN THIS AFTER THE DNS RECORD EXISTS, NOT BEFORE.
   GitHub Pages serves exactly one custom domain per repo, and it takes
   the name from CNAME. Push a CNAME for a host that does not resolve yet
   and the live site goes dark until it does. Order matters:

     1. DNS: CNAME  matthew  →  mcclusterishere.github.io
     2. wait for it to resolve (dig matthew.mccluster.org)
     3. run this, commit, push
     4. GitHub → Settings → Pages → wait for the certificate, tick
        Enforce HTTPS
*/
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEW = process.argv[2];
/* The fallback is only reached when CNAME is missing. It is written as a
   split string so that running this tool never rewrites its own fallback
   into the name it just moved to — which is exactly what happened on the
   here → matthew rename, leaving the tool claiming the old host was
   already the new one. */
const OLD = existsSync(join(ROOT, "CNAME"))
  ? readFileSync(join(ROOT, "CNAME"), "utf8").trim()
  : ["here", "mccluster.org"].join(".");

if (!NEW || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(NEW)) {
  console.error("usage: node tools/rename-domain.mjs <new.domain.tld>");
  process.exit(1);
}
if (NEW === OLD) { console.log(`already ${NEW} — nothing to do`); process.exit(0); }

const SKIP = new Set(["node_modules", ".git", "assets", "raw", "vault-raw", "probe"]);
const EXT = /\.(html|json|xml|txt|md|mjs|js|vcf|webmanifest)$/i;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (SKIP.has(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(f)) out.push(p);
  }
  return out;
}

let files = 0, hits = 0;
for (const p of walk(ROOT)) {
  const s = readFileSync(p, "utf8");
  if (!s.includes(OLD)) continue;
  const n = s.split(OLD).length - 1;
  writeFileSync(p, s.split(OLD).join(NEW));
  console.log(`  ${String(n).padStart(3)} × ${p.replace(ROOT + "/", "")}`);
  files++; hits += n;
}
writeFileSync(join(ROOT, "CNAME"), NEW + "\n");

console.log(`\n${OLD} → ${NEW}`);
console.log(`${hits} references across ${files} files, plus CNAME.\n`);
console.log("Now, in order:");
console.log("  1. node tools/vcard.mjs      (the contact file carries the URL)");
console.log("  2. python3 tools/qr.py       (the tap-card QR encodes the URL)");
console.log("  3. node tools/build-walls.mjs (canonicals + sitemap on every wall)");
console.log("  4. commit, push, then tick Enforce HTTPS once the cert issues");
console.log(`\n⚠ Anything already printed with the old URL — NFC tags, business`);
console.log(`  cards, QR stickers — points at ${OLD}. Keep that host alive as a`);
console.log(`  redirect if any of it is already in the wild.`);
