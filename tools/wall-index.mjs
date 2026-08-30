/* Read what actually landed on disk and write it into the gallery.

     node tools/wall-index.mjs candler-crossing

   Or with no argument, every wall named in data/walls-intake.json.

   The files on disk are the truth. This never invents a media entry for a
   photo that isn't there, and it never drops one that is — so a re-run
   after adding three more frames just picks them up.  */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const intake = JSON.parse(readFileSync(join(ROOT, "data/walls-intake.json"), "utf8"));
const gPath = join(ROOT, "data/gallery.json");
const gallery = JSON.parse(readFileSync(gPath, "utf8"));

const only = process.argv[2];
const walls = (intake.walls || []).filter((w) => !only || w.event === only);
if (!walls.length) {
  console.error(only ? `no wall named "${only}" in data/walls-intake.json` : "no walls in the intake");
  process.exit(1);
}

const PHOTO = /\.(jpe?g|png|webp)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
let touched = 0;

for (const w of walls) {
  const ev = (gallery.events || []).find((e) => e.id === w.event);
  if (!ev) {
    console.error(`! ${w.event} is not an event in data/gallery.json — skipped`);
    continue;
  }
  const dir = join(ROOT, "assets/img", w.event);
  if (!existsSync(dir)) {
    console.log(`- ${w.event}: nothing downloaded yet`);
    continue;
  }

  // sorted so the numbering is stable across runs and matches the folder
  const files = readdirSync(dir).filter((f) => PHOTO.test(f) || VIDEO.test(f)).sort();
  if (!files.length) {
    console.log(`- ${w.event}: folder is empty`);
    continue;
  }

  const sell = w.sell !== false;
  ev.media = files.map((f, i) => {
    const isVideo = VIDEO.test(f);
    const m = {
      id: `${w.prefix || w.event}-${String(i + 1).padStart(2, "0")}`,
      type: isVideo ? "video" : "photo",
      src: `assets/img/${w.event}/${f}`,
    };
    // only a still can be sold as a print
    if (!isVideo && sell) m.sell = true;
    return m;
  });

  const stills = ev.media.filter((m) => m.type === "photo");
  const pick = Math.min(Math.max(1, w.cover || 1), stills.length || 1) - 1;
  if (stills.length) ev.cover = stills[pick].src;

  touched++;
  console.log(`${w.event}: ${ev.media.length} on the wall (${stills.length} stills) · cover ${ev.cover}`);
}

if (touched) {
  writeFileSync(gPath, JSON.stringify(gallery, null, 1) + "\n");
  console.log("wrote data/gallery.json");
} else {
  console.log("nothing changed");
}
