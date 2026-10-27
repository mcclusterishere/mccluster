/* THE PUBLISH STRIP PARITY CONTRACT: the two ways out of this repo may not
   disagree about what is private.

     node --test scripts/test/publish-strip-parity.test.mjs

   matthew.mccluster.org ships from .github/workflows/deploy-pages.yml, which
   deletes the internals out of the checkout and force-pushes the rest to
   gh-pages. The Cloudflare Pages export, scripts/stage-cloudflare-pages.mjs,
   is the other way out, and it names as an ALLOWLIST the only root
   directories a public web tree may contain. Until October 2026 the two
   disagreed: the workflow stripped twelve directories by name and, by
   omission, published platform/, core/, native/, PRIM3/, dns/, .mcp.json and
   .cursorrules on the live site. This test derives its expectation from the
   allowlist, so a directory added at the root is private on both paths
   until somebody allows it on both, and it reads the workflow's own rm
   lines, so the parity cannot be satisfied by editing a mirror list.
   Dependency-free on purpose; see docs/control-plane/CLOUDFLARE-PAGES-DIRECT-UPLOAD.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const workflow = read(".github/workflows/deploy-pages.yml");
const stage = read("scripts/stage-cloudflare-pages.mjs");

/* a `const NAME = new Set([ 'a','b' ]);` literal in the stage script */
function stageSet(name) {
  const m = stage.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(m, `stage-cloudflare-pages.mjs no longer declares ${name}`);
  const items = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(items.length > 0, `${name} is empty`);
  return new Set(items);
}
/* the arguments of the one `rm <flag> …` command in the strip step; a line
   continued with a trailing backslash is joined first */
function rmArguments(flag) {
  const joined = workflow.replace(/\\\n\s*/g, " ");
  const lines = joined.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(`rm ${flag} `));
  assert.equal(lines.length, 1, `deploy-pages.yml must strip with exactly one "rm ${flag}" line, found ${lines.length}`);
  return new Set(lines[0].slice(`rm ${flag} `.length).split(/\s+/).filter(Boolean));
}

const allowedDirectories = stageSet("allowedDirectories");
const publicAssetGroups = stageSet("publicAssetGroups");
const forbiddenFiles = stageSet("forbiddenFiles");
const stripped = rmArguments("-rf");
const removedFiles = rmArguments("-f");
const rootEntries = readdirSync(ROOT, { withFileTypes: true });

test("every root directory the Cloudflare export refuses is stripped before gh-pages", () => {
  const privateDirs = rootEntries
    .filter((e) => e.isDirectory() && e.name !== ".git" && !allowedDirectories.has(e.name))
    .map((e) => e.name);
  assert.ok(privateDirs.length >= 10, `expected the private source directories at the root, found ${privateDirs.join(" ")}`);
  const leaked = privateDirs.filter((d) => !stripped.has(d));
  assert.deepEqual(leaked, [], `deploy-pages.yml publishes directories the export allowlist refuses: ${leaked.join(" ")}`);
});

test("the strip never deletes a directory the public export allows, and never the repository itself", () => {
  for (const arg of stripped) {
    assert.ok(!["/", ".", "..", "*", ".git"].includes(arg), `rm -rf ${arg} would destroy the checkout`);
    const [top, group] = arg.split("/");
    if (arg.includes("/")) {
      /* a nested path under a public directory must be one the export refuses too */
      if (top === "assets") assert.ok(!publicAssetGroups.has(group), `${arg} is a public asset group`);
      else assert.ok(!allowedDirectories.has(top), `${arg} is inside public directory ${top}/`);
    } else {
      assert.ok(!allowedDirectories.has(arg), `${arg}/ is public on Cloudflare but stripped from gh-pages`);
    }
  }
  /* control.html fetches data/analytics/application-schema-inventory.json at runtime */
  assert.ok(![...stripped].some((a) => a === "data" || a.startsWith("data/")), "data/ is fetched by published pages");
});

test("every root file the Cloudflare export forbids is removed, agent instructions included", () => {
  /* CNAME is the one exception: GitHub Pages reads the custom domain from it */
  const privateFiles = [...forbiddenFiles]
    .filter((f) => !f.includes("/") && f !== "CNAME" && existsSync(join(ROOT, f)));
  for (const required of [".mcp.json", ".cursorrules", "package.json", "AGENTS.md", "CLAUDE.md"])
    assert.ok(privateFiles.includes(required), `${required} must be at the root and forbidden by the export`);
  const leaked = privateFiles.filter((f) => !removedFiles.has(f));
  assert.deepEqual(leaked, [], `deploy-pages.yml publishes files the export forbids: ${leaked.join(" ")}`);
  assert.ok(stripped.has(".cursor"), "the .cursor rules directory goes with .cursorrules");
  assert.ok(!removedFiles.has("capacitor.config.json"), "the Capacitor wrapper is gone; native/ is the app");
});

test("the stamp step rewrites every file kind that carries a ?v=__STAMP__ URL", () => {
  const step = workflow.match(/name: Stamp asset versions[\s\S]*?xargs -0 sed -i "s\/__STAMP__\/\$\{GITHUB_SHA::12\}\/g"/);
  assert.ok(step, "the stamp step moved");
  for (const kind of ["'*.html'", "'*.js'", "'*.mjs'", "'*.css'"])
    assert.ok(step[0].includes(`-name ${kind}`), `the stamp find skips ${kind}`);
  assert.ok(step[0].includes("-path ./vendor -prune"), "third-party vendor/ must not be rewritten");
  /* the files that made js/css stamping necessary; if these stop carrying
     the placeholder the find is still correct, only this guard goes stale */
  assert.match(read("js/tabbar.js"), /\?v=__STAMP__/, "tabbar loads versioned assets");
  assert.match(read("sw.js"), /__STAMP__/, "the service worker keys its cache on the stamp");
});
