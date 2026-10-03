#!/usr/bin/env node
/* WHICH PUBLIC PAGES CHANGED BETWEEN TWO COMMITS, as IndexNow paths.

     node tools/seo/indexnow-changed.mjs <base-sha> <head-sha>

   Prints one URL path per line (engineering/, docket-516.html, ...), only
   for pages that are in the sitemap: a page we do not ask search engines to
   index is not one we ping them about. IndexNow's rule is to submit only
   URLs that changed, so a deploy that touched no public page prints nothing
   and the workflow sends nothing. */
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES } from "./build-sitemaps.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function indexable() {
  const map = new Map(PAGES.map(([path, file]) => [file, path]));
  for (const f of readdirSync(join(ROOT, "walls")).filter((x) => x.endsWith(".html"))) map.set(`walls/${f}`, `walls/${f}`);
  return map;
}

export function changedPaths(files) {
  const map = indexable();
  const out = [];
  for (const f of files) if (map.has(f) && existsSync(join(ROOT, f))) out.push(map.get(f) || "");
  return [...new Set(out)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) { console.error("usage: indexnow-changed.mjs <base-sha> <head-sha>"); process.exit(2); }
  const files = execFileSync("git", ["diff", "--name-only", base, head], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  /* the home page is the empty path; IndexNow wants the bare host URL */
  for (const p of changedPaths(files)) console.log(p === "" ? "/" : p);
}
