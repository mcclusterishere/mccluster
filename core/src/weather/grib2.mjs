/* A minimal GRIB2 reader for MRMS, in plain Node (zlib only, no native decoder).

   MRMS publishes each product as one gzip-compressed GRIB2 message on a regular
   latitude/longitude grid (grid template 3.0) packed as PNG (data representation
   template 5.41), or occasionally as simple packing (5.0). That is all this reads:
   anything else throws `unsupported`, so a format change fails loudly instead of
   decoding garbage.

   Decoding a CONUS message (7000 x 3500 points) means inflating the whole PNG
   stream, because PNG row filters depend on the row above. Rows are unfiltered
   one at a time and only the rows inside the requested crop are kept, so memory
   is the inflated stream (about 49 MB for 16-bit) plus two rows.

   Value = (R + X * 2^E) / 10^D  (WMO GRIB2 regulation 92.9.4), where X is the
   packed integer, R the reference value, E the binary and D the decimal scale.
   MRMS marks "no coverage" and "missing" with negative sentinels (-1, -3, -999)
   AFTER unpacking; this reader returns them unchanged and the caller maps them. */
import zlib from 'node:zlib';

const td = new TextDecoder('ascii');

/* GRIB2 signed integers are sign-and-magnitude, not two's complement. */
function sm32(view, off) { const u = view.getUint32(off); return u & 0x80000000 ? -(u & 0x7fffffff) : u; }
function sm16(view, off) { const u = view.getUint16(off); return u & 0x8000 ? -(u & 0x7fff) : u; }

export function readSections(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length < 16 || td.decode(buf.subarray(0, 4)) !== 'GRIB') throw Object.assign(new Error('not a GRIB message'), { code: 'grib_magic' });
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf[7] !== 2) throw Object.assign(new Error(`GRIB edition ${buf[7]} is not 2`), { code: 'unsupported' });
  const discipline = buf[6];
  const total = Number(view.getBigUint64(8));
  if (total > buf.length) throw Object.assign(new Error('GRIB message truncated'), { code: 'grib_truncated' });
  const sections = {};
  let off = 16;
  while (off + 4 <= total) {
    if (td.decode(buf.subarray(off, off + 4)) === '7777') break;
    const len = view.getUint32(off);
    const num = buf[off + 4];
    if (len < 5 || off + len > total) throw Object.assign(new Error('GRIB section length invalid'), { code: 'grib_truncated' });
    if (sections[num]) break; // one field per message is all MRMS sends; a second field is ignored
    sections[num] = { off, len, bytes: buf.subarray(off, off + len), view: new DataView(buf.buffer, buf.byteOffset + off, len) };
    off += len;
  }
  for (const n of [1, 3, 4, 5, 7]) if (!sections[n]) throw Object.assign(new Error(`GRIB section ${n} missing`), { code: 'grib_truncated' });
  return { discipline, total, sections };
}

/* Section 1: reference time. Section 4 template 4.0: category / number. */
export function describe(bytes) {
  const { discipline, sections } = readSections(bytes);
  const s1 = sections[1].view;
  const ref = new Date(Date.UTC(s1.getUint16(12), s1.getUint8(14) - 1, s1.getUint8(15), s1.getUint8(16), s1.getUint8(17), s1.getUint8(18)));
  const s3 = sections[3].view;
  const gridTemplate = s3.getUint16(12);
  if (gridTemplate !== 0) throw Object.assign(new Error(`grid template 3.${gridTemplate} unsupported`), { code: 'unsupported' });
  const ni = s3.getUint32(30), nj = s3.getUint32(34);
  const basic = s3.getUint32(38), sub = s3.getUint32(42);
  const unit = basic === 0 || basic === 0xffffffff ? 1e-6 : basic / (sub === 0xffffffff ? 1 : sub);
  const la1 = sm32(s3, 46) * unit, lo1 = sm32(s3, 50) * unit, la2 = sm32(s3, 55) * unit, lo2 = sm32(s3, 59) * unit;
  const di = s3.getUint32(63) * unit, dj = s3.getUint32(67) * unit;
  const scan = s3.getUint8(71);
  const s4 = sections[4].view;
  const productTemplate = s4.getUint16(7);
  const s5 = sections[5].view;
  const packing = s5.getUint16(9);
  return {
    discipline, reference_time: ref.toISOString(),
    parameter: { category: s4.getUint8(9), number: s4.getUint8(10), product_template: productTemplate },
    grid: {
      template: 0, ni, nj, la1, lo1: lo1 > 180 ? lo1 - 360 : lo1, la2, lo2: lo2 > 180 ? lo2 - 360 : lo2, di, dj, scan,
      // scanning mode bit 2 (0x40) set = +j (south to north); MRMS scans north to south (0x00)
      south_to_north: (scan & 0x40) !== 0, west_to_east: (scan & 0x80) === 0,
    },
    packing: {
      template: packing,
      points: s5.getUint32(5),
      reference: s5.getFloat32(11),
      binary_scale: sm16(s5, 15),
      decimal_scale: sm16(s5, 17),
      bits: s5.getUint8(19),
    },
    bitmap: sections[6] ? sections[6].bytes[5] : 255,
  };
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/* Parse a PNG held in GRIB section 7; return { width, height, bpp, rows(fn) }. Grayscale only. */
function pngRows(png, onRow) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (png[i] !== sig[i]) throw Object.assign(new Error('section 7 is not PNG'), { code: 'png_magic' });
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8, width = 0, height = 0, depth = 0, colour = 0;
  const idat = [];
  while (off + 8 <= png.length) {
    const len = view.getUint32(off);
    const type = td.decode(png.subarray(off + 4, off + 8));
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(off + 8); height = view.getUint32(off + 12); depth = png[off + 16]; colour = png[off + 17];
      if (png[off + 20] !== 0) throw Object.assign(new Error('interlaced PNG unsupported'), { code: 'unsupported' });
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  // GRIB 5.41 uses grey (0) for 8/16 bits, RGB (2) for 24, RGBA (6) for 32
  const channels = colour === 0 ? 1 : colour === 2 ? 3 : colour === 6 ? 4 : 0;
  if (!channels || depth !== 8 && depth !== 16 && !(colour === 0 && (depth === 1 || depth === 2 || depth === 4))) {
    throw Object.assign(new Error(`PNG colour ${colour} depth ${depth} unsupported`), { code: 'unsupported' });
  }
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength))));
  if (raw.length < height * (stride + 1)) throw Object.assign(new Error('PNG data truncated'), { code: 'png_truncated' });
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const base = y * (stride + 1);
    const filter = raw[base];
    for (let x = 0; x < stride; x += 1) {
      const v = raw[base + 1 + x];
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      cur[x] = filter === 0 ? v : filter === 1 ? (v + a) & 255 : filter === 2 ? (v + b) & 255
        : filter === 3 ? (v + ((a + b) >> 1)) & 255 : filter === 4 ? (v + paeth(a, b, c)) & 255 : -1;
      if (cur[x] < 0) throw Object.assign(new Error(`PNG filter ${filter} invalid`), { code: 'png_filter' });
    }
    onRow(y, cur, { width, bitsPerPixel });
    const t = prev; prev = cur; cur = t;
  }
  return { width, height, bitsPerPixel };
}

function sampleAt(row, x, bitsPerPixel) {
  if (bitsPerPixel === 8) return row[x];
  if (bitsPerPixel === 16) return (row[2 * x] << 8) | row[2 * x + 1];
  if (bitsPerPixel === 24) return (row[3 * x] << 16) | (row[3 * x + 1] << 8) | row[3 * x + 2];
  if (bitsPerPixel === 32) return ((row[4 * x] << 24) >>> 0) + ((row[4 * x + 1] << 16) | (row[4 * x + 2] << 8) | row[4 * x + 3]);
  const perByte = 8 / bitsPerPixel, byte = row[Math.floor(x / perByte)];
  const shift = 8 - bitsPerPixel * (1 + (x % perByte));
  return (byte >> shift) & ((1 << bitsPerPixel) - 1);
}

/* Decode the field inside a lon/lat window. Returns a Float32Array of nj' x ni'
   values, north row first, with the crop's own corner coordinates. A bitmap
   (section 6 indicator 0) is not used by MRMS and is refused. */
export function decodeWindow(bytes, { west, south, east, north }) {
  const meta = describe(bytes);
  const { sections } = readSections(bytes);
  const g = meta.grid, p = meta.packing;
  if (meta.bitmap !== 255) throw Object.assign(new Error('GRIB bitmap unsupported'), { code: 'unsupported' });
  if (g.south_to_north || !g.west_to_east) throw Object.assign(new Error(`scanning mode ${g.scan} unsupported`), { code: 'unsupported' });
  // column / row indices of the window (inclusive), clamped to the grid
  const lo1 = g.lo1;
  const i0 = Math.max(0, Math.ceil((west - lo1) / g.di - 1e-9));
  const i1 = Math.min(g.ni - 1, Math.floor((east - lo1) / g.di + 1e-9));
  const j0 = Math.max(0, Math.ceil((g.la1 - north) / g.dj - 1e-9));
  const j1 = Math.min(g.nj - 1, Math.floor((g.la1 - south) / g.dj + 1e-9));
  if (i1 < i0 || j1 < j0) throw Object.assign(new Error('window outside the grid'), { code: 'outside_grid' });
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  const out = new Float32Array(w * h);
  const scaleE = 2 ** p.binary_scale, scaleD = 10 ** -p.decimal_scale;
  const unpack = (x) => (p.reference + x * scaleE) * scaleD;
  const s7 = sections[7].bytes.subarray(5);
  if (p.template === 41) {
    if (p.bits === 0) out.fill(unpack(0));
    else {
      const info = pngRows(s7, (y, row, { width, bitsPerPixel }) => {
        if (y < j0 || y > j1) return;
        if (width !== g.ni) throw Object.assign(new Error('PNG width differs from the grid'), { code: 'grib_mismatch' });
        for (let x = i0; x <= i1; x += 1) out[(y - j0) * w + (x - i0)] = unpack(sampleAt(row, x, bitsPerPixel));
      });
      if (info.height !== g.nj) throw Object.assign(new Error('PNG height differs from the grid'), { code: 'grib_mismatch' });
    }
  } else if (p.template === 0) {
    // simple packing: bits-per-value big-endian bit stream, row-major
    const nb = p.bits;
    for (let y = j0; y <= j1; y += 1) {
      for (let x = i0; x <= i1; x += 1) {
        let v = 0;
        if (nb) {
          const bit = (y * g.ni + x) * nb;
          for (let k = 0; k < nb; k += 1) { const b = bit + k; v = v * 2 + ((s7[b >> 3] >> (7 - (b & 7))) & 1); }
        }
        out[(y - j0) * w + (x - i0)] = unpack(v);
      }
    }
  } else {
    throw Object.assign(new Error(`data representation template 5.${p.template} unsupported`), { code: 'unsupported' });
  }
  return {
    meta,
    window: { ni: w, nj: h, west: lo1 + i0 * g.di, east: lo1 + i1 * g.di, north: g.la1 - j0 * g.dj, south: g.la1 - j1 * g.dj, di: g.di, dj: g.dj },
    values: out,
  };
}

/* Write a one-field GRIB2 message (template 3.0 / 4.0 / 5.41, 16-bit grey PNG).
   Used only to make small, real-valued test fixtures from a crop of a live
   MRMS message; Core never publishes GRIB. */
export function encodeGrib2Png({ referenceTime, category, number, discipline = 209, west, north, di, dj, ni, nj, values, decimalScale = 1, reference = -999 }) {
  const ints = new Uint16Array(ni * nj);
  for (let k = 0; k < ints.length; k += 1) ints[k] = Math.max(0, Math.min(65535, Math.round(values[k] * 10 ** decimalScale - reference * 10 ** decimalScale)));
  const stride = ni * 2;
  const raw = Buffer.alloc(nj * (stride + 1));
  for (let y = 0; y < nj; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < ni; x += 1) raw.writeUInt16BE(ints[y * ni + x], y * (stride + 1) + 1 + 2 * x);
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) : 0, 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ni, 0); ihdr.writeUInt32BE(nj, 4); ihdr[8] = 16; ihdr[9] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const smPut32 = (b, off, v) => { const m = Math.abs(Math.round(v)); b.writeUInt32BE(v < 0 ? (m | 0x80000000) >>> 0 : m, off); };
  const smPut16 = (b, off, v) => { const m = Math.abs(v); b.writeUInt16BE(v < 0 ? (m | 0x8000) : m, off); };
  const t = new Date(referenceTime);
  const s1 = Buffer.alloc(21); s1.writeUInt32BE(21, 0); s1[4] = 1; s1.writeUInt16BE(161, 5); s1[9] = 2; s1[10] = 1;
  s1.writeUInt16BE(t.getUTCFullYear(), 12); s1[14] = t.getUTCMonth() + 1; s1[15] = t.getUTCDate(); s1[16] = t.getUTCHours(); s1[17] = t.getUTCMinutes(); s1[18] = t.getUTCSeconds(); s1[19] = 0; s1[20] = 0;
  const s3 = Buffer.alloc(72); s3.writeUInt32BE(72, 0); s3[4] = 3; s3.writeUInt32BE(ni * nj, 6); s3.writeUInt16BE(0, 12);
  s3[14] = 6; s3.writeUInt32BE(ni, 30); s3.writeUInt32BE(nj, 34); s3.writeUInt32BE(0, 38); s3.writeUInt32BE(0xffffffff, 42);
  const lon360 = (v) => (v < 0 ? v + 360 : v);
  smPut32(s3, 46, north * 1e6); smPut32(s3, 50, lon360(west) * 1e6); s3[54] = 48;
  smPut32(s3, 55, (north - (nj - 1) * dj) * 1e6); smPut32(s3, 59, lon360(west + (ni - 1) * di) * 1e6);
  s3.writeUInt32BE(Math.round(di * 1e6), 63); s3.writeUInt32BE(Math.round(dj * 1e6), 67); s3[71] = 0;
  const s4 = Buffer.alloc(34); s4.writeUInt32BE(34, 0); s4[4] = 4; s4.writeUInt16BE(0, 7); s4[9] = category; s4[10] = number;
  const s5 = Buffer.alloc(21); s5.writeUInt32BE(21, 0); s5[4] = 5; s5.writeUInt32BE(ni * nj, 5); s5.writeUInt16BE(41, 9);
  s5.writeFloatBE(reference * 10 ** decimalScale, 11); smPut16(s5, 15, 0); smPut16(s5, 17, decimalScale); s5[19] = 16; s5[20] = 0;
  const s6 = Buffer.from([0, 0, 0, 6, 6, 255]);
  const s7 = Buffer.concat([Buffer.alloc(5), png]); s7.writeUInt32BE(s7.length, 0); s7[4] = 7;
  const body = Buffer.concat([s1, s3, s4, s5, s6, s7, Buffer.from('7777', 'ascii')]);
  const s0 = Buffer.alloc(16); s0.write('GRIB', 0, 'ascii'); s0[6] = discipline; s0[7] = 2; s0.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([s0, body]);
}
