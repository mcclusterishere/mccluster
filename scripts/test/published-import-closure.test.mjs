/* THE PUBLISHED IMPORT CLOSURE CONTRACT: no published module may depend on a
   file the publish step strips.

     node --test scripts/test/published-import-closure.test.mjs

   Audit W1 (2026-11-09): the published gh-pages tree carried
   js/prim3-world/mission-generator.mjs and js/prim3-tactics/levels/generated.mjs,
   both importing PRIM3/game/halo/generated/recipe.mjs, while
   .github/workflows/deploy-pages.yml removed all of PRIM3/. Every source-tree
   test passed; the emitted artifact could not instantiate PRIM3 World, the
   reviewed-mission UI or generated Transit missions. This test walks every
   literal import/export/dynamic-import/new URL(…, import.meta.url) specifier
   in the files the export publishes, resolves it, and fails when the target
   is missing or lives under a root the workflow deletes. It reads the
   workflow's own rm lines (as publish-strip-parity does) so the gate cannot
   drift from the real strip. Computed specifiers, import maps and CDN URLs
   are out of scope and still need the browser network capture named in
   docs/prim3/REVIEWED-RELEASE-PROGRESSION.md. Dependency-free on purpose. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const workflow = read(".github/workflows/deploy-pages.yml");

function rmArguments(flag) {
  const joined = workflow.replace(/\\\n\s*/g, " ");
  const lines = joined.split("\n").map((l) => l.trim()).filter((l) => l.startsWith(`rm ${flag} `));
  assert.equal(lines.length, 1, `deploy-pages.yml must strip with exactly one "rm ${flag}" line`);
  return new Set(lines[0].slice(`rm ${flag} `.length).split(/\s+/).filter(Boolean));
}
const strippedDirs = rmArguments("-rf");
const removedFiles = rmArguments("-f");
/* roots that exist only in the emitted artifact (promoted by other steps),
   so a reference into them cannot be checked against the source tree */
const PUBLISH_TIME_ROOTS = new Set(["site0", "equity-uprise-preview"]);
/* files the workflow itself builds into the tree before the strip (the
   fictional-city district/places/chunks are generated and hashed there) */
const PUBLISH_TIME_PATHS = ["data/fictional-city/"];
/* third-party code is published untouched and is not ours to audit here */
const SKIP_WALK = new Set([".git", "node_modules", "vendor", ...strippedDirs]);

function isStripped(rel) {
  const parts = rel.split("/");
  for (let i = 1; i <= parts.length; i += 1) {
    const prefix = parts.slice(0, i).join("/");
    if (strippedDirs.has(prefix)) return true;
  }
  return removedFiles.has(rel);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(ROOT, abs).split(sep).join("/");
    if (entry.isDirectory()) {
      if (SKIP_WALK.has(rel) || SKIP_WALK.has(entry.name) || isStripped(rel)) continue;
      yield* walk(abs);
    } else if (/\.(?:m?js|html)$/.test(entry.name) && !isStripped(rel)) {
      yield rel;
    }
  }
}

/* strip block and line comments so documentation examples do not count */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

const SPECIFIER = /(?:\bimport\s*(?:[^'"`;]*?\bfrom\s*)?|\bexport\s+[^'"`;]*?\bfrom\s*|\bimport\s*\(\s*|new\s+URL\s*\(\s*)['"]([^'"]+)['"]/g;
const HTML_SRC = /<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi;
const HTML_MODULE = /<script\b[^>]*type\s*=\s*['"]module['"][^>]*>([\s\S]*?)<\/script>/gi;

function localTargets(file, text) {
  const out = [];
  const add = (spec, bareIsRelative = false) => {
    const clean = spec.replace(/[?#].*$/, "");
    if (!clean || /^(?:[a-z]+:|\/\/|data:)/i.test(clean)) return;
    /* a bare specifier in a module is a package import; in an HTML src it is a path */
    if (!bareIsRelative && !clean.startsWith("./") && !clean.startsWith("../") && !clean.startsWith("/")) return;
    const abs = clean.startsWith("/") ? join(ROOT, clean) : resolve(dirname(join(ROOT, file)), clean);
    out.push({ spec, rel: relative(ROOT, abs).split(sep).join("/") });
  };
  if (file.endsWith(".html")) {
    for (const m of text.matchAll(HTML_SRC)) add(m[1], true);
    for (const m of text.matchAll(HTML_MODULE)) for (const s of stripComments(m[1]).matchAll(SPECIFIER)) add(s[1]);
  } else {
    for (const s of stripComments(text).matchAll(SPECIFIER)) add(s[1]);
  }
  return out;
}

function exists(rel) {
  const abs = join(ROOT, rel);
  return existsSync(abs) && statSync(abs).isFile();
}

test("every literal local dependency of a published module survives the strip", () => {
  const broken = [];
  let checked = 0;
  for (const file of walk(ROOT)) {
    for (const { spec, rel } of localTargets(file, read(file))) {
      checked += 1;
      const top = rel.split("/")[0];
      if (PUBLISH_TIME_ROOTS.has(top) || PUBLISH_TIME_PATHS.some((p) => rel.startsWith(p))) continue;
      if (isStripped(rel)) broken.push(`${file} -> ${spec} (publish strips ${rel})`);
      else if (!exists(rel) && !existsSync(join(ROOT, rel))) broken.push(`${file} -> ${spec} (missing ${rel})`);
    }
  }
  assert.ok(checked > 500, `expected hundreds of local specifiers, found ${checked}`);
  assert.deepEqual(broken, [], `published modules depend on files the publish removes or that do not exist:\n${broken.join("\n")}`);
});

test("the generated-recipe compiler ships with its importers (audit W1)", () => {
  assert.ok(exists("js/prim3-tactics/levels/recipe.mjs"), "the public-safe recipe compiler lives under js/");
  assert.ok(!isStripped("js/prim3-tactics/levels/recipe.mjs"));
  for (const importer of ["js/prim3-world/mission-generator.mjs", "js/prim3-tactics/levels/generated.mjs"]) {
    const refs = localTargets(importer, read(importer)).map((t) => t.rel);
    assert.ok(refs.includes("js/prim3-tactics/levels/recipe.mjs"), `${importer} imports the published compiler`);
    assert.ok(!refs.some((r) => r.startsWith("PRIM3/")), `${importer} must not import the private PRIM3 tree`);
  }
  /* the private-tree path stays a shim so tooling keeps resolving; its content
     must come from the published file, never a second copy */
  assert.match(read("PRIM3/game/halo/generated/recipe.mjs"), /export \* from '\.\.\/\.\.\/\.\.\/\.\.\/js\/prim3-tactics\/levels\/recipe\.mjs'/);
});
