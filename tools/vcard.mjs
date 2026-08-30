/* Derive the contact file and the tap QR from data/card.json.
   The card is one record; this writes the two surfaces that can't read
   JSON at runtime — the .vcf a phone saves, and the QR a camera scans.

     node tools/vcard.mjs

   Re-run it after any edit to data/card.json. Nothing here is typed twice.  */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const card = JSON.parse(readFileSync(join(ROOT, "data/card.json"), "utf8"));
const p = card.person;
const by = (id) => (card.reach || []).find((r) => r.id === id) || {};

/* vCard escapes commas, semicolons and backslashes inside a value, and folds
   any line past 75 octets onto a continuation that starts with one space. */
const esc = (s) => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
function fold(line) {
  const b = Buffer.from(line, "utf8");
  if (b.length <= 75) return line;
  const out = [];
  let i = 0;
  while (i < b.length) {
    let end = Math.min(b.length, i + (i === 0 ? 75 : 74));
    // never split a multi-byte character: back off any continuation byte
    while (end < b.length && (b[end] & 0xc0) === 0x80) end--;
    out.push((i === 0 ? "" : " ") + b.subarray(i, end).toString("utf8"));
    i = end;
  }
  return out.join("\r\n");
}

const L = [];
const put = (line) => L.push(fold(line));

put("BEGIN:VCARD");
put("VERSION:3.0");
put(`N:${esc(p.last)};${esc(p.first)};;;`);
put(`FN:${esc(p.full)}`);
if (p.org) put(`ORG:${esc(p.org)}`);
if (p.title) put(`TITLE:${esc(p.title)}`);

const email = by("email");
if (email.value) put(`EMAIL;TYPE=INTERNET,WORK,PREF:${esc(email.value)}`);

const tel = by("tel");
if (tel.value) put(`TEL;TYPE=CELL,VOICE,PREF:${esc(tel.value)}`);

const site = by("site");
if (site.href) put(`URL;TYPE=WORK:${esc(site.href)}`);
put(`URL;TYPE=HOME:${esc(card.url)}`);

/* Apple and Google both read X-SOCIALPROFILE; the handle rides in the label
   so a phone that ignores the type still shows something useful. */
(card.social || []).forEach((s) => {
  put(`X-SOCIALPROFILE;TYPE=${esc(s.id)}:${esc(s.href)}`);
});

/* No ADR: the work runs out of two states, and a vCard address field that
   holds two cities reads as a bad address in every phone. It lives in the
   note instead, where it reads as what it is. */
const note = [p.line, p.where].filter(Boolean).join(" — ");
if (note) put(`NOTE:${esc(note)}`);
put(`REV:${new Date().toISOString().replace(/\.\d{3}/, "")}`);
put("END:VCARD");

writeFileSync(join(ROOT, "mccluster.vcf"), L.join("\r\n") + "\r\n");
console.log("wrote mccluster.vcf —", L.length, "lines");

/* The QR is regenerated separately — see tools/qr.py — because it only has
   to change when card.url changes, which is close to never. */
console.log("if data/card.json's url changed, also run: python3 tools/qr.py");
