/* A minimal NEXRAD Level III reader for the super-resolution digital base
   products: N0B (product 153, reflectivity) and N0G (product 154, radial
   velocity), from the public Unidata bucket `unidata-nexrad-level3`.

   Format (NOAA ICD 2620001): an optional WMO/AWIPS text header, the 18-byte
   Message Header Block, the 102-byte Product Description Block, then the
   symbology block, which for these products is bzip2-compressed (PDB halfword
   51 = 1). The symbology carries one Digital Radial Data Array (packet 16):
   one byte per range bin per radial. Both products are 0.5 deg x 0.25 km
   (1840 bins = 460 km for N0B, 1200 bins = 300 km for N0G); the packet's own
   range-scale halfword reads 999 on these products and is recorded, not used.

   Decompression uses the system `bzip2 -dc` (the bzip2 package that ships with
   Ubuntu and is already on the OVH box): no npm dependency, no native addon,
   and the input is bounded (MAX_COMPRESSED) before it reaches the process. A
   host without bzip2 gets a clear `decoder_missing` and the radar feed is
   reported missing; nothing else in the snapshot is affected.

   Data levels (MetPy's DigitalMapper, from the PDB thresholds): code 0 is below
   threshold, code 1 is range folded (velocity) or missing (reflectivity), and a
   code n >= 2 is min + (n - 2) * increment, with min and increment in tenths in
   PDB halfwords 31 and 32. Units: dBZ for 153, m/s for 154. Velocity is RADIAL:
   positive is motion away from the radar, negative toward it. It is not a wind
   vector, and it is relative to this radar only. */
import { spawn } from 'node:child_process';

export const PRODUCTS = Object.freeze({
  153: Object.freeze({ code: 'N0B', name: 'Super-resolution base reflectivity', quantity: 'reflectivity', units: 'dBZ', code1: 'missing', km_per_bin: 0.25 }),
  154: Object.freeze({ code: 'N0G', name: 'Super-resolution base radial velocity', quantity: 'radial_velocity', units: 'm/s', code1: 'range_folded', km_per_bin: 0.25 }),
});
export const MAX_COMPRESSED = 2 * 1024 * 1024;
export const MAX_UNCOMPRESSED = 16 * 1024 * 1024;

function err(message, code) { return Object.assign(new Error(message), { code }); }

/* Days since 1970-01-01 (day 1 = 1970-01-01) + seconds after midnight, UTC. */
function nexradTime(days, seconds) { return new Date(((days - 1) * 86400 + seconds) * 1000).toISOString(); }

/* Locate the Message Header Block: skip a WMO/AWIPS text header if present. */
export function findHeader(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const limit = Math.min(buf.length - 120, 200);
  for (let off = 0; off <= limit; off += 1) {
    const code = view.getInt16(off);
    if (code !== 153 && code !== 154) continue;
    // the PDB divider (-1) sits right after the 18-byte message header, and repeats the product code at +12
    if (view.getInt16(off + 18) === -1 && view.getInt16(off + 30) === code) return off;
  }
  throw err('no Level III message header found', 'l3_header');
}

export function readHeader(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const off = findHeader(buf);
  const v = new DataView(buf.buffer, buf.byteOffset + off, buf.byteLength - off);
  const hw = (n) => v.getInt16((n - 1) * 2); // ICD halfword numbering, 1-based, MHB starts at 1
  const hwu = (n) => v.getUint16((n - 1) * 2);
  const i32 = (n) => v.getInt32((n - 1) * 2);
  const u32 = (n) => v.getUint32((n - 1) * 2);
  const product = hw(16);
  const info = PRODUCTS[product];
  if (!info) throw err(`Level III product ${product} unsupported`, 'unsupported');
  return {
    offset: off,
    product, ...info,
    message_time: nexradTime(hwu(2), u32(3)),
    radar: { lat: i32(11) / 1000, lon: i32(13) / 1000, height_ft: hw(15) },
    operational_mode: hw(17), vcp: hw(18), sequence: hw(19), volume_scan: hw(20),
    volume_start: nexradTime(hwu(21), u32(22)),
    generated: nexradTime(hwu(24), u32(25)),
    elevation_number: hw(29),
    elevation_deg: hw(30) / 10,
    thresholds: { min: hw(31) / 10, increment: hw(32) / 10, levels: hwu(33) },
    compression: hw(51),
    uncompressed_size: (hwu(52) << 16) + hwu(53),
    symbology_offset_hw: u32(55),
  };
}

export function bunzip2(input, { timeoutMs = 20_000, bin = 'bzip2' } = {}) {
  if (input.length > MAX_COMPRESSED) return Promise.reject(err('compressed radar product too large', 'too_large'));
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(bin, ['-dc'], { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { reject(err(`bzip2 unavailable: ${e.message}`, 'decoder_missing')); return; }
    const parts = []; let size = 0; let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, err('bzip2 timed out', 'decoder_timeout')); }, timeoutMs);
    child.on('error', (e) => finish(reject, err(`bzip2 unavailable: ${e.code || e.message}`, e.code === 'ENOENT' ? 'decoder_missing' : 'decoder_failed')));
    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > MAX_UNCOMPRESSED) { child.kill('SIGKILL'); finish(reject, err('radar product inflates past the limit', 'too_large')); return; }
      parts.push(d);
    });
    child.stderr.resume();
    child.on('close', (code) => code === 0 ? finish(resolve, new Uint8Array(Buffer.concat(parts))) : finish(reject, err(`bzip2 exited ${code}`, 'decoder_failed')));
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  });
}

/* Parse the (decompressed) symbology block's packet 16. */
export function readRadials(sym) {
  const v = new DataView(sym.buffer, sym.byteOffset, sym.byteLength);
  if (v.getInt16(0) !== -1 || v.getInt16(2) !== 1) throw err('symbology block header invalid', 'l3_symbology');
  // block header: -1, id 1, length(4), layers(2); layer: -1, length(4); then the packet
  let off = 10;
  if (v.getInt16(off) !== -1) throw err('symbology layer divider missing', 'l3_symbology');
  off += 6;
  const packet = v.getUint16(off);
  if (packet !== 16) throw err(`packet ${packet} unsupported (expected 16)`, 'unsupported');
  const firstBin = v.getInt16(off + 2);
  const nBins = v.getInt16(off + 4);
  const packetScale = v.getInt16(off + 10); // recorded only; see the header note
  const nRadials = v.getInt16(off + 12);
  off += 14;
  const radials = [];
  for (let r = 0; r < nRadials; r += 1) {
    if (off + 6 > sym.length) throw err('radial data truncated', 'l3_truncated');
    const nBytes = v.getInt16(off);
    const start = v.getInt16(off + 2) / 10;
    const delta = v.getInt16(off + 4) / 10;
    const data = sym.subarray(off + 6, off + 6 + Math.min(nBytes, nBins));
    if (off + 6 + nBytes > sym.length) throw err('radial data truncated', 'l3_truncated');
    radials.push({ start, delta, data });
    off += 6 + nBytes + (nBytes % 2);
  }
  return { firstBin, nBins, packet_range_scale: packetScale, radials };
}

export async function decodeLevel3(bytes, { inflate = bunzip2 } = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = readHeader(buf);
  const symStart = header.offset + 18 + 102; // MHB + PDB
  let sym = buf.subarray(symStart);
  if (header.compression === 1) sym = await inflate(sym);
  else if (header.compression !== 0) throw err(`compression ${header.compression} unsupported`, 'unsupported');
  return { header, km_per_bin: header.km_per_bin, ...readRadials(sym) };
}

/* code -> physical value (null for the special codes) */
export function levelValue(code, thresholds) {
  return code < 2 ? null : thresholds.min + (code - 2) * thresholds.increment;
}

const R_EARTH_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/* Great-circle distance (km) and initial bearing (deg from north) from the radar. */
export function rangeBearing(lat0, lon0, lat, lon) {
  const p1 = toRad(lat0), p2 = toRad(lat), dl = toRad(lon - lon0);
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return { km: d, deg: (toDeg(Math.atan2(y, x)) + 360) % 360 };
}

/* Beam-centre height above the radar (m) at a ground range, 4/3 effective earth. */
export function beamHeightM(rangeKm, elevationDeg) {
  const re = (4 / 3) * R_EARTH_KM;
  const h = Math.sqrt(rangeKm ** 2 + re ** 2 + 2 * rangeKm * re * Math.sin(toRad(elevationDeg))) - re;
  return Math.round(h * 1000);
}

/* Nearest-bin resample onto a regular lon/lat grid. Each output cell keeps the
   SOURCE level code (0..255) so its meaning stays the product's; 255 marks
   "outside the scan" (beyond the last bin or no radial). The range used is the
   ground distance, treated as the slant range: at 0.5 deg the difference is
   under 0.5 % out to 230 km, smaller than one 2 km cell. */
export const OUTSIDE = 255;
export function resampleToGrid(decoded, grid) {
  const { header, radials, firstBin, nBins, km_per_bin: kmPerBin } = decoded;
  const byAzimuth = new Array(3600).fill(-1);
  radials.forEach((r, idx) => {
    const a0 = Math.round(((r.start % 360) + 360) % 360 * 10);
    const n = Math.max(1, Math.round(r.delta * 10));
    for (let k = 0; k < n; k += 1) byAzimuth[(a0 + k) % 3600] = idx;
  });
  const out = new Uint8Array(grid.nx * grid.ny).fill(OUTSIDE);
  for (let j = 0; j < grid.ny; j += 1) {
    const lat = grid.north - (j + 0.5) * grid.dlat;
    for (let i = 0; i < grid.nx; i += 1) {
      const lon = grid.west + (i + 0.5) * grid.dlon;
      const { km, deg } = rangeBearing(header.radar.lat, header.radar.lon, lat, lon);
      const bin = Math.floor(km / kmPerBin) - firstBin;
      if (bin < 0 || bin >= nBins) continue;
      const idx = byAzimuth[Math.floor(deg * 10) % 3600];
      if (idx < 0) continue;
      const data = radials[idx].data;
      if (bin >= data.length) continue;
      out[j * grid.nx + i] = Math.min(254, data[bin]);
    }
  }
  return out;
}
