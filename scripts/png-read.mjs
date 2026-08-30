/* Minimal PNG reader — enough to turn a Playwright screenshot into pixels.
   Playwright emits 8-bit RGBA (colour type 6), non-interlaced. Anything
   else is refused loudly rather than decoded into garbage. */
import zlib from "zlib";
export function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let off = 8, w = 0, h = 0, depth = 0, type = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), tag = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (tag === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9];
      if (body[12] !== 0) throw new Error("interlaced png unsupported"); }
    else if (tag === "IDAT") idat.push(body);
    else if (tag === "IEND") break;
    off += len + 12;
  }
  if (depth !== 8 || (type !== 6 && type !== 2)) throw new Error(`png depth ${depth} type ${type} unsupported`);
  const ch = type === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++], line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride), up = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = up ? up[x] : 0, c = up && x >= ch ? up[x - ch] : 0, v = line[x];
      let r;
      switch (f) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                  r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error("bad filter " + f);
      }
      cur[x] = r & 255;
    }
  }
  return { w, h, ch, data: out };
}
