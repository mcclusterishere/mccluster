/* ============================================================
   LYRIC SHEET (browser) — an owner's lyric file to plain text.

   .txt / .lrc / .ttml are read as text (the lyric machine on McCluster
   Core parses LRC/TTML timings itself). A .docx is a ZIP whose words live
   in word/document.xml: this finds that one entry, inflates it with the
   browser's own DecompressionStream, and keeps the <w:t> runs, one line per
   paragraph. Nothing in the file runs; a DOCTYPE/ENTITY is refused.
   Same rules as core/src/lyrics/sheet.mjs (the server-side reader).

   window.MCC_LYRIC_SHEET = { read(file) -> Promise<{text, kind}>, MAX_BYTES }
   ============================================================ */
(function (root) {
  "use strict";
  var MAX_BYTES = 2 * 1024 * 1024;
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000; }

  function inflate(bytes) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("This browser cannot open .docx here; paste the words instead."));
    var ds = new DecompressionStream("deflate-raw");
    var out = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(out).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function entry(b, wanted) {
    var eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return Promise.reject(new Error("That is not a .docx file."));
    var count = u16(b, eocd + 10), p = u32(b, eocd + 16);
    for (var k = 0; k < count && p + 46 <= b.length; k++) {
      if (u32(b, p) !== 0x02014b50) break;
      var method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), loc = u32(b, p + 42);
      var name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name !== wanted) continue;
      var start = loc + 30 + u16(b, loc + 26) + u16(b, loc + 28);
      var data = b.subarray(start, start + csize);
      if (method === 0) return Promise.resolve(data);
      if (method === 8) return inflate(data);
      return Promise.reject(new Error("Unsupported .docx compression."));
    }
    return Promise.reject(new Error("No document text in that .docx."));
  }

  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function unescape(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (_, e) {
      if (e[0] === "#") { var n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
      return ENT[e.toLowerCase()] || "";
    });
  }
  function xmlToText(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("That .docx carries a DOCTYPE; refusing it.");
    var body = xml.replace(/<w:(?:del|instrText)\b[\s\S]*?<\/w:(?:del|instrText)>/g, "").replace(/<w:p(\s[^>]*)?\/>/g, "<w:p></w:p>");
    return body.split(/<\/w:p>/).map(function (para) {
      var line = "", re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(br|cr)\b[^>]*\/>|<w:tab\b[^>]*\/>/g, m;
      while ((m = re.exec(para))) line += m[1] != null ? unescape(m[1]) : m[2] ? "\n" : " ";
      return line.replace(/\s+$/, "");
    }).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  function read(file) {
    if (!file) return Promise.resolve({ text: "", kind: "none" });
    if (file.size > MAX_BYTES) return Promise.reject(new Error("That lyric file is over 2 MB; a lyric sheet is a few KB."));
    var name = String(file.name || "").toLowerCase();
    return file.arrayBuffer().then(function (ab) {
      var b = new Uint8Array(ab);
      if (/\.docx$/.test(name) || (b[0] === 0x50 && b[1] === 0x4b)) {
        return entry(b, "word/document.xml").then(function (x) { return { text: xmlToText(new TextDecoder().decode(x)), kind: "docx" }; });
      }
      var text = new TextDecoder().decode(b).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
      var kind = /\.lrc$/.test(name) || /^\s*\[\d+:\d/.test(text) ? "lrc" : /<tt[\s>]/.test(text) ? "ttml" : "text";
      return { text: text, kind: kind };
    });
  }

  root.MCC_LYRIC_SHEET = { read: read, xmlToText: xmlToText, MAX_BYTES: MAX_BYTES };
})(typeof window !== "undefined" ? window : globalThis);
