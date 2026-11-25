#!/usr/bin/env node
// Generate the Phase A printable tracking marker for the Unity AR client.
//
//   node tools/ar/generate-marker.mjs
//
// Writes:
//   ar/Assets/McCluster/Markers/mccluster-ar-marker-01.png   the reference image AR Foundation tracks
//   ar/print/mccluster-ar-marker-01.pdf                      US Letter, printed at 100% = 180 mm square
//
// The pattern is a seeded pseudo-random block grid: high contrast, many corners, no symmetry and no
// repeated tiles, which is what ARKit/ARCore image tracking wants. It is a fiducial, not a mark: it
// carries no brand, no logo and no lettering, and must never be used as one.
// Dependency-free (node:zlib only) so it runs in CI and on any checkout.
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MARKER = Object.freeze({
  name: 'mccluster-ar-marker-01',
  seed: 0x4d43_0001,      // fixed: changing it changes the printed marker
  dataCells: 24,          // random data grid, cells per side
  cellPx: 36,             // pixels per cell
  physicalMeters: 0.18,   // printed edge length, quiet zone included; must equal the reference library size
});
export const PNG_PATH = `ar/Assets/McCluster/Markers/${MARKER.name}.png`;
export const PDF_PATH = `ar/print/${MARKER.name}.pdf`;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cell grid: 1 white quiet ring, 1 black ring, the data grid, 1 black ring, 1 white quiet ring.
 *  Returns { cells, side } with cells[y][x] = 1 for black. */
export function markerCells(m = MARKER) {
  const side = m.dataCells + 4;
  const rnd = mulberry32(m.seed);
  const cells = [];
  for (let y = 0; y < side; y++) {
    const row = [];
    for (let x = 0; x < side; x++) {
      const ring = Math.min(x, y, side - 1 - x, side - 1 - y);
      row.push(ring === 0 ? 0 : ring === 1 ? 1 : (rnd() < 0.5 ? 1 : 0));
    }
    cells.push(row);
  }
  // Orientation key: a solid 3x3 black block in the data grid's top-left and a solid white one
  // in its bottom-right, so a rotated print is never mistaken for the upright one by a person.
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
    cells[2 + dy][2 + dx] = 1;
    cells[side - 3 - dy][side - 3 - dx] = 0;
  }
  return { cells, side };
}

/** 8-bit grayscale pixels, row-major, 0 = black, 255 = white. */
export function markerPixels(m = MARKER) {
  const { cells, side } = markerCells(m);
  const size = side * m.cellPx;
  const px = Buffer.alloc(size * size);
  for (let y = 0; y < size; y++) {
    const cy = Math.floor(y / m.cellPx);
    for (let x = 0; x < size; x++) px[y * size + x] = cells[cy][Math.floor(x / m.cellPx)] ? 0 : 255;
  }
  return { px, size };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Filter-0 scanlines (one leading 0 byte per row) for a grayscale image. */
export function scanlines(px, size) {
  const raw = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size + 1) + 1, y * size, (y + 1) * size);
  return raw;
}

export function encodePng(px, size, physicalMeters) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit grayscale
  const phys = Buffer.alloc(9); // pixels per metre, so a viewer shows the intended print size
  const ppm = Math.round(size / physicalMeters);
  phys.writeUInt32BE(ppm, 0); phys.writeUInt32BE(ppm, 4); phys[8] = 1;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('pHYs', phys),
    chunk('IDAT', deflateSync(scanlines(px, size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page US Letter PDF that prints the marker at exactly physicalMeters at 100% scale. */
export function encodePdf(px, size, m = MARKER) {
  const pt = (mm) => (mm * 72) / 25.4;
  const W = 612, H = 792;                       // US Letter, points
  const edge = pt(m.physicalMeters * 1000);     // 180 mm -> 510.24 pt
  const x0 = (W - edge) / 2, y0 = 150;
  const f = (n) => n.toFixed(2);
  const lines = [
    'McCluster AR - Phase A test marker 01',
    `Print at 100% (Actual size). The black-and-white square, white border included, must measure ${Math.round(m.physicalMeters * 1000)} mm.`,
    'Tape it flat to the wall you control, top edge up, then measure the facade points listed in ar/README.md.',
  ];
  const text = (x, y, size, s) => `BT /F1 ${size} Tf ${f(x)} ${f(y)} Td (${s.replace(/[\\()]/g, '\\$&')}) Tj ET`;
  const bar = pt(100);
  const content = [
    text(x0, H - 60, 14, lines[0]),
    text(x0, H - 80, 8.5, lines[1]),
    text(x0, H - 94, 8.5, lines[2]),
    text(x0 + edge / 2 - 30, y0 + edge + 12, 9, 'TOP EDGE UP'),
    // marker image
    `q ${f(edge)} 0 0 ${f(edge)} ${f(x0)} ${f(y0)} cm /Im1 Do Q`,
    // hairline cut guide 3 mm outside the image (outside the tracked extents)
    `0.6 G 0.3 w ${f(x0 - pt(3))} ${f(y0 - pt(3))} ${f(edge + pt(6))} ${f(edge + pt(6))} re S`,
    // 100 mm scale bar to check the print with a ruler
    `0 G 1 w ${f(x0)} ${f(y0 - 50)} m ${f(x0 + bar)} ${f(y0 - 50)} l S`,
    `${f(x0)} ${f(y0 - 55)} m ${f(x0)} ${f(y0 - 45)} l S ${f(x0 + bar)} ${f(y0 - 55)} m ${f(x0 + bar)} ${f(y0 - 45)} l S`,
    text(x0 + bar + 8, y0 - 53, 8.5, 'this bar must measure 100 mm'),
    text(x0, y0 - 80, 7.5, 'A tracking pattern, not a logo or brand mark. Generated by tools/ar/generate-marker.mjs.'),
  ].join('\n');
  const img = deflateSync(px, { level: 9 });
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    { dict: `<< /Type /XObject /Subtype /Image /Width ${size} /Height ${size} /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate false /Filter /FlateDecode /Length ${img.length} >>`, stream: img },
    { dict: `<< /Length ${Buffer.byteLength(content, 'latin1')} >>`, stream: Buffer.from(content, 'latin1') },
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    const head = Buffer.from(`${i + 1} 0 obj\n${typeof o === 'string' ? o : o.dict}\n`, 'latin1');
    const body = typeof o === 'string' ? Buffer.alloc(0) : Buffer.concat([Buffer.from('stream\n'), o.stream, Buffer.from('\nendstream\n')]);
    const tail = Buffer.from('endobj\n');
    offsets.push(pos);
    parts.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  const xref = ['xref', `0 ${objs.length + 1}`, '0000000000 65535 f ', ...offsets.map(o => String(o).padStart(10, '0') + ' 00000 n ')].join('\n') + '\n';
  parts.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

async function main() {
  const { px, size } = markerPixels();
  for (const [rel, bytes] of [[PNG_PATH, encodePng(px, size, MARKER.physicalMeters)], [PDF_PATH, encodePdf(px, size)]]) {
    const out = resolve(ROOT, rel);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
    console.log(`wrote ${rel} (${bytes.length} bytes)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
