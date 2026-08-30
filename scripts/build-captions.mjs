/* ============================================================
   BUILD CAPTIONS — the lyrics, as caption files the platforms read.

   This site already shows timed lyrics: album.html loads a track's
   JSON and lights each line as the audio playhead reaches it. That
   is the good version, and nothing here replaces it.

   This is for everywhere else. When a music video goes up on
   YouTube, Instagram or TikTok, the words do not travel with it —
   the platform sees a video file and nothing else. So it either
   guesses at the lyrics with speech recognition (badly, on music)
   or shows nothing. Most people scroll with the sound off, which
   means an uncaptioned music video is a silent video of a person
   moving their mouth. A caption file fixes that, and it is also
   the only text a search engine can read off a video.

   Two formats, because the platforms disagree:
     SRT  — YouTube, Instagram, TikTok, Premiere, Resolve.
     VTT  — the web standard, for a <track> element, and what
            YouTube converts to internally anyway.
   They are the same cues with a different punctuation mark in
   the timestamp, which is a fine summary of subtitle standards.

   The one real transformation is line wrapping. DistroKid's
   timings are clean but its cues are one long string — up to 117
   characters here — and a caption renderer will either shrink
   that to nothing or run it off the edge of a phone. Captions
   want about 42 characters a line. So each cue is wrapped on word
   boundaries into balanced lines: the width is recomputed as
   len/lines so two lines come out even rather than one full and
   one orphan word. Nothing is ever dropped or shortened; a long
   line becomes more lines.

   Source of truth is data/lyrics/*.json, the same files the site
   plays from, so the captions cannot drift from the page.

   Run: node scripts/build-captions.mjs
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "data", "lyrics");
const OUT = path.join(ROOT, "assets", "captions");

/* Which lyric file belongs to which song, and the slug the caption
   files carry. Only tracks that actually have timed lines appear
   here — a caption file without timings would be worse than none. */
const SONGS = [
  { slug: "antisocial",              file: "antisocial.json",                        title: "Antisocial" },
  { slug: "deep-end",                file: "deep-end.json",                          title: "Deep End" },
  { slug: "upset",                   file: "upset.json",                             title: "Upset" },
  { slug: "dealer-plates",           file: "dealer-plates.json",                     title: "Dealer Plates" },
  { slug: "please-set-me-free",      file: "please-set-me-free.json",                title: "Please Set Me Free" },
  { slug: "money-or-the-power",      file: "money-or-the-power.dk.json",             title: "Money or the Power" },
  { slug: "environmental-injustice-brave", file: "environmental-injustice-brave.dk.json", title: "Environmental Injustice / Brave" }
];

const WRAP = 42;   /* characters per caption line, the broadcast convention */
const MAXLINES = 3; /* beyond this a cue is unreadable at speed; we allow it
                      rather than cut words, but it is worth knowing */

/* Fill words left to right, breaking whenever the next word would
   pass `target`. A word longer than target still gets its own line
   rather than being cut. */
function fill(words, target) {
  const out = [];
  let line = "";
  for (const w of words) {
    if (!line) { line = w; continue; }
    if ((line + " " + w).length <= target) line += " " + w;
    else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

/* Balanced word wrap, in two passes.

   Filling greedily at the full width gives the fewest lines the
   text can occupy. But it also gives the ugly shape — lines packed
   to the margin and a stray word stranded underneath. Dividing the
   width by a line count guessed up front does not fix it either:
   the guess is a lower bound, and filling to a tight target
   overruns it, which is how a 90-character cue budgeted for three
   lines came out as four with "throne" alone on the last.

   So: take the line count from the full-width pass, then walk the
   target back up from len/lines until the text fits that same
   count again. The first target that does is the most even shape
   available at no cost in lines. */
function wrap(text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [text];

  const widest = fill(words, width);
  const lines = widest.length;
  if (lines === 1) return widest;

  for (let target = Math.ceil(text.length / lines); target <= width; target++) {
    const out = fill(words, target);
    if (out.length <= lines) return out;
  }
  return widest;
}

const pad = (n, w) => String(n).padStart(w, "0");

/* SRT and VTT differ only in the decimal separator, so one clock
   serves both. Milliseconds floor rather than round: a cue that
   rounds up can land a frame past its own end. */
function clock(sec, sep) {
  const ms = Math.floor(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms % 1000, 3)}`;
}

function readCues(file) {
  const d = JSON.parse(fs.readFileSync(path.join(SRC, file), "utf8"));
  if (!d.timed || !Array.isArray(d.timed.line)) throw new Error(`${file}: no timed lines`);
  return d.timed.line.map((l) => ({
    begin: l.begin,
    end: l.end,
    lines: wrap(String(l.content).trim(), WRAP)
  }));
}

const toSrt = (cues) =>
  cues.map((c, i) =>
    `${i + 1}\n${clock(c.begin, ",")} --> ${clock(c.end, ",")}\n${c.lines.join("\n")}\n`
  ).join("\n");

const toVtt = (cues, title) =>
  `WEBVTT\nKind: captions\nLanguage: en\n\nNOTE\n${title}\nBuilt from data/lyrics by scripts/build-captions.mjs\n\n` +
  cues.map((c, i) =>
    `${i + 1}\n${clock(c.begin, ".")} --> ${clock(c.end, ".")}\n${c.lines.join("\n")}\n`
  ).join("\n");

fs.mkdirSync(OUT, { recursive: true });

let cueTotal = 0, wrapped = 0, long = 0;
for (const song of SONGS) {
  const cues = readCues(song.file);
  fs.writeFileSync(path.join(OUT, `${song.slug}.en.srt`), toSrt(cues), "utf8");
  fs.writeFileSync(path.join(OUT, `${song.slug}.en.vtt`), toVtt(cues, song.title), "utf8");

  const w = cues.filter((c) => c.lines.length > 1).length;
  const l = cues.filter((c) => c.lines.length > MAXLINES).length;
  const widest = Math.max(...cues.flatMap((c) => c.lines.map((x) => x.length)));
  cueTotal += cues.length; wrapped += w; long += l;

  console.log(
    `${song.slug.padEnd(32)} ${String(cues.length).padStart(3)} cues  ` +
    `${String(w).padStart(3)} wrapped  widest ${String(widest).padStart(2)}ch` +
    (l ? `  ${l} over ${MAXLINES} lines` : "")
  );
}

console.log(`\n${SONGS.length} songs · ${cueTotal} cues · ${wrapped} wrapped · ` +
            `${SONGS.length * 2} files → assets/captions/`);
if (long) console.log(`note: ${long} cue(s) exceed ${MAXLINES} lines — long lyric lines, nothing dropped`);
