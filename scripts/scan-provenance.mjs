/* ============================================================
   SCAN PROVENANCE — which photographs carry Content Credentials.

   C2PA (Content Credentials) is the standard Adobe, Sony, Nikon,
   Leica and the AP settled on: the camera signs the frame at the
   moment of capture, and the signature travels inside the file.
   It is the thing NFTs claimed to do and never did — proof that
   this camera, in these hands, made this picture, checkable by
   anyone at contentcredentials.org/verify.

   The signature lives in a JUMBF box. In a JPEG that is an APP11
   segment carrying the label `c2pa`; in PNG it is a `caBX` chunk;
   in WebP/HEIF it is a `jumb` box. Finding it needs no library —
   it is a byte marker near the head of the file.

   This runs at BUILD time, not in the browser, and writes one
   small JSON the page reads. The alternative — having every
   visitor range-request every photograph to sniff its header —
   would put the bytes back that this site just spent a long time
   taking out.

   Usage:  node scripts/scan-provenance.mjs
   Writes: provenance.json  (shipped; scripts/ is stripped at deploy)
   ============================================================ */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const IMG = path.join(ROOT, "assets", "img");
const OUT = path.join(ROOT, "provenance.json");
const EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".tif", ".tiff"]);

/* the marker sits in the file's header, so only the head is read */
const HEAD = 256 * 1024;

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

/* A JUMBF box labelled for C2PA. Checked as bytes rather than by
   decoding the container, because every format buries it differently
   and all we need to answer is "is there a claim in here". */
function findC2PA(buf) {
  const hay = buf.subarray(0, Math.min(buf.length, HEAD));
  // "jumb" box type followed (within the box header) by a c2pa label
  const jumb = hay.indexOf(Buffer.from("jumb", "ascii"));
  const label = hay.indexOf(Buffer.from("c2pa", "ascii"));
  // PNG carries it in a caBX chunk
  const cabx = hay.indexOf(Buffer.from("caBX", "ascii"));
  if (label >= 0 && (jumb >= 0 || cabx >= 0)) return true;
  // JPEG APP11 (FFEB) whose segment names JP (0x4A50) then c2pa
  for (let i = 0; i + 3 < hay.length - 1; i++) {
    if (hay[i] === 0xff && hay[i + 1] === 0xeb) {
      const win = hay.subarray(i, Math.min(i + 64, hay.length)).toString("latin1");
      if (win.includes("c2pa") || win.includes("jumb")) return true;
    }
  }
  return cabx >= 0;
}

const files = await walk(IMG);
const signed = {};
let checked = 0;

for (const f of files) {
  let buf;
  try { buf = await readFile(f); } catch { continue; }
  checked++;
  if (!findC2PA(buf)) continue;
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  const s = await stat(f);
  signed[rel] = {
    // the digest is what a dispute actually turns on: this exact file
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: s.size,
  };
}

const out = {
  generated: new Date().toISOString().slice(0, 10),
  checked,
  signed,
};
await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`scanned ${checked} images, ${Object.keys(signed).length} carry Content Credentials`);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
