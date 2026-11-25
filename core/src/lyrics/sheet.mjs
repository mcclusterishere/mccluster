/* McCluster lyric machine: owner lyric sheets in, plain text out.
 *
 * Owners hand over lyrics as .docx (Word, Google Docs export) or plain text. A
 * .docx is a ZIP; the words are in word/document.xml. This reads exactly that one
 * entry with a hand-rolled, bounded ZIP reader and pulls <w:t> runs out of it as
 * text. Nothing in the file is executed, no macro part is opened, no external
 * relationship is followed, and a DOCTYPE/ENTITY (the XML-bomb route) is refused.
 */
import { inflateRawSync } from 'node:zlib';

export const SHEET_MAX_BYTES = 2 * 1024 * 1024;     // a lyric sheet is a few KB
const XML_MAX_BYTES = 4 * 1024 * 1024;

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000; }

/** Read one named entry from a ZIP buffer. Returns a Buffer or null. */
export function zipEntry(buf, wanted) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 22 || b.length > SHEET_MAX_BYTES) throw new Error('lyric sheet is empty or too large');
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a .docx (no ZIP directory)');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  for (let k = 0; k < count && p + 46 <= b.length; k++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('damaged .docx directory');
    const method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24);
    const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), loc = u32(b, p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name !== wanted) continue;
    if (usize > XML_MAX_BYTES) throw new Error('document part too large');
    if (u32(b, loc) !== 0x04034b50) throw new Error('damaged .docx entry');
    const start = loc + 30 + u16(b, loc + 26) + u16(b, loc + 28);
    const data = b.subarray(start, start + csize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data, { maxOutputLength: XML_MAX_BYTES });
    throw new Error(`unsupported ZIP method ${method}`);
  }
  return null;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[e.toLowerCase()] ?? '';
  });
}

/** WordprocessingML -> text: one line per paragraph, <w:br/> breaks lines, tabs become spaces. */
export function documentXmlToText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('refusing a .docx with a DOCTYPE/ENTITY');
  const body = xml.replace(/<w:(?:del|instrText)\b[\s\S]*?<\/w:(?:del|instrText)>/g, '').replace(/<w:p(\s[^>]*)?\/>/g, '<w:p></w:p>');
  const paras = body.split(/<\/w:p>/);
  const out = [];
  for (const p of paras) {
    let line = '';
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(br|cr)\b[^>]*\/>|<w:tab\b[^>]*\/>/g;
    let m;
    while ((m = re.exec(p))) {
      if (m[1] != null) line += unescapeXml(m[1]);
      else if (m[2]) line += '\n';
      else line += ' ';
    }
    if (/<w:p[\s>]/.test(p) || line) out.push(line);
  }
  return out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function docxToText(buf) {
  const xml = zipEntry(buf, 'word/document.xml');
  if (!xml) throw new Error('not a .docx (no word/document.xml)');
  return documentXmlToText(xml.toString('utf8'));
}

/** Any supported sheet (docx bytes, or UTF-8 text) -> plain text. */
export function sheetToText(buf, name = '') {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length > SHEET_MAX_BYTES) throw new Error('lyric sheet too large');
  if (/\.docx$/i.test(name) || (b[0] === 0x50 && b[1] === 0x4b)) return docxToText(b);
  return b.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}
