#!/usr/bin/env node
/* THE PUBLIC REGISTRY, DERIVED.

     node tools/build-music-registry.mjs          # rewrite data/catalogue.json
     node tools/build-music-registry.mjs --check  # fail if it drifted

   data/catalogue.json used to be written by hand beside data/albums.json,
   and the two disagreed: the registry was three recordings short of the
   shelf, one length was blank long after the file had been measured, and a
   track's house number had nothing to do with its ISRC. Every page that
   joined the two (listen.js, album.html, catalogue.html) carried a comment
   about the mismatch instead of a fix.

   One source each, nothing typed twice:
   - data/albums.json         what exists and in what order: the shelf, the
                              title, the credit, the gate (owner-edited)
   - data/ddex/identifiers.json  the ISRC on each slug (the QT6KV desk's
                              ledger: append-only, never reminted here)
   - workers/mccluster/src/music/tracks.js  each file's length, measured by
                              scripts/music-track-lengths.mjs from the audio
   A track's slug is its audio file name without the extension (a gated track
   uses its bucket folder): the same key the players send and the ledger uses.

   The house number (QT6KV·NN) is the ISRC's designation when one is issued,
   so the registry page and the ledger say the same thing about a record. A
   recording with no ISRC yet takes the next number after the ledger, in
   shelf order, and that number is not an ISRC (docs/ddex.md). */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/catalogue.json");

export function trackSlug(t) {
  if (t.gated && t.gated.object) return String(t.gated.object).split("/")[0];
  return String(t.src || "").split(/[?#]/)[0].split("/").pop().replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* the credit line as the site states it: the track's own credit when it has
   one (an empty string is a statement too), else its subtitle, else the
   artist the album is billed to */
export function creditOf(album, t) {
  if (typeof t.credit === "string") return t.credit;
  return t.sub || album.artist || "";
}

export function build({ albums, ledger, lengths }) {
  const prefix = ledger.prefix || "QT6KV";
  const isrcBySlug = new Map((ledger.recordings || []).map((r) => [r.slug, r.isrc]));
  let unissued = Math.max(0, ...(ledger.recordings || []).map((r) => +String(r.isrc).slice(-5) || 0));
  const tracks = [];
  for (const album of albums.albums || []) {
    for (const t of album.tracks || []) {
      const slug = trackSlug(t);
      if (!slug) throw new Error(`${album.slug}: a track has no src`);
      if (tracks.some((x) => x.slug === slug)) throw new Error(`${slug} appears twice in data/albums.json`);
      const isrc = isrcBySlug.get(slug);
      const no = isrc ? +isrc.slice(-5) : ++unissued;
      const length = t.gated ? "" : clock(lengths[slug] && lengths[slug].seconds);
      const row = {
        slug,
        title: t.title,
        credit: creditOf(album, t),
        album: album.name,
        albumSlug: album.slug,
        page: album.slug === "here" ? "album.html" : `album.html?album=${album.slug}`,
        length,
        available: true,
        no
      };
      if (t.gated) row.gated = true;
      if (isrc) row.isrc = isrc;
      tracks.push(row);
    }
  }
  return {
    generated_by: "tools/build-music-registry.mjs",
    isrc_prefix: prefix,
    count: tracks.length,
    tracks
  };
}

export async function load() {
  const albums = JSON.parse(readFileSync(join(ROOT, "data/albums.json"), "utf8"));
  const ledger = JSON.parse(readFileSync(join(ROOT, "data/ddex/identifiers.json"), "utf8"));
  const { TRACKS } = await import(pathToFileURL(join(ROOT, "workers/mccluster/src/music/tracks.js")).href);
  return { albums, ledger, lengths: TRACKS };
}

export async function render() {
  return JSON.stringify(build(await load()), null, 1) + "\n";
}

async function main() {
  const next = await render();
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(OUT, "utf8"); } catch {}
    if (current !== next) {
      console.error("data/catalogue.json drifted from data/albums.json, the ISRC ledger or the measured lengths: run node tools/build-music-registry.mjs");
      process.exit(1);
    }
    console.log("music registry: current");
    return;
  }
  writeFileSync(OUT, next);
  console.log(`music registry: wrote ${JSON.parse(next).count} tracks to data/catalogue.json`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
