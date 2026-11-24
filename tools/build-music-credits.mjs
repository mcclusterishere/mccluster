#!/usr/bin/env node
/* THE CREDIT LINE, WRITTEN FROM THE STRUCTURE.

     node tools/build-music-credits.mjs          # rewrite the lines in data/albums.json
     node tools/build-music-credits.mjs --check  # fail if a line drifted from its structure

   data/albums.json says who is on a track twice: as structure (track.credits, naming artists in the registry by
   slug) and as the words a page shows (track.credit, and track.sub under a title). The words are never typed: this
   writes them from the structure with js/music-credits.js, the same function the pages call. Edit track.credits;
   run this; then tools/build-music-registry.mjs and tools/build-catalogue.mjs, which read the line.

   A track with no structure is left exactly as written. A subtitle that is not a credit ("the title track") stays
   the owner's: sub is written only where somebody besides the record's own artist is on it. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "../js/music-credits.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data/albums.json");
const { line, sub, credited, index } = globalThis.MCC_CREDITS;

/* the same document with every generated line rewritten; throws on a slug the registry does not know */
export function withLines(doc) {
  const known = index(doc);
  return {
    ...doc,
    albums: (doc.albums || []).map((album) => ({
      ...album,
      tracks: (album.tracks || []).map((t) => {
        if (!t.credits) return t;
        for (const x of credited(t)) {
          if (!known[x.slug]) throw new Error(`${album.slug} / ${t.title}: "${x.slug}" is not in the artists registry`);
        }
        const { title, sub: oldSub, credit: _old, credits, ...rest } = t;
        const short = sub(doc, t);
        const next = { title };
        if (short !== null) next.sub = short; else if (oldSub !== undefined) next.sub = oldSub;
        next.credit = line(doc, t);
        next.credits = credits;
        return { ...next, ...rest };
      })
    }))
  };
}

export function render(text) {
  return JSON.stringify(withLines(JSON.parse(text)), null, 1) + "\n";
}

function main() {
  const current = readFileSync(FILE, "utf8");
  const next = render(current);
  if (process.argv.includes("--check")) {
    if (next !== current) {
      console.error("data/albums.json: a credit line drifted from its structure: run node tools/build-music-credits.mjs");
      process.exit(1);
    }
    console.log("music credits: current");
    return;
  }
  writeFileSync(FILE, next);
  console.log("music credits: wrote the credit lines in data/albums.json");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
