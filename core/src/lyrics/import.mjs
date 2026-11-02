/* McCluster lyric machine: timed lyrics that already exist (DistroKid TTML, LRC).
 *
 * Line times come straight from the file. Word times come from the audio when
 * recognised words are available (each line's words are aligned only against what
 * was heard inside that line's window), otherwise they are spread evenly across the
 * line. Output is the same data/lyrics JSON, source "imported", reviewed:false.
 *
 * TTML is parsed as untrusted text: a DOCTYPE or ENTITY declaration is refused (no
 * external or expanding entities), and only <p begin end> elements are read.
 */
import { tokens, alignWords, asrWords, tidy, MACHINE_VERSION } from './align.mjs';
import { unescapeXml } from './sheet.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;

/** TTML time expression -> seconds. Clock "HH:MM:SS(.fff)" / "MM:SS.fff", or offset "12.5s" / "800ms" / "3m". */
export function ttmlTime(v, { frameRate = 30, tickRate = 1 } = {}) {
  const s = String(v || '').trim();
  let m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)(?::(\d+))?$/.exec(s);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(m[4]) / frameRate : 0);
  m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return { h: n * 3600, m: n * 60, s: n, ms: n / 1000, f: n / frameRate, t: n / tickRate, undefined: n }[m[2]];
  }
  return NaN;
}

/** TTML text -> {title, duration, lines:[{begin,end,content}]} */
export function parseTtml(xml) {
  const text = String(xml || '');
  if (text.length > 2 * 1024 * 1024) throw new Error('TTML too large');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('refusing TTML with a DOCTYPE/ENTITY');
  if (!/<tt[\s>]/.test(text)) throw new Error('not TTML (no <tt> root)');
  const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag); return m ? (m[2] ?? m[3]) : null; };
  const root = /<tt\b[^>]*>/.exec(text)[0];
  const opts = { frameRate: Number(attr(root, 'ttp:frameRate')) || 30, tickRate: Number(attr(root, 'ttp:tickRate')) || 1 };
  const titleM = /<ttm:title[^>]*>([\s\S]*?)<\/ttm:title>/.exec(text);
  const bodyTag = /<body\b[^>]*>/.exec(text);
  const duration = bodyTag && attr(bodyTag[0], 'dur') ? ttmlTime(attr(bodyTag[0], 'dur'), opts) : null;
  const lines = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(text))) {
    const tag = '<p' + m[1] + '>';
    const begin = ttmlTime(attr(tag, 'begin'), opts);
    let end = ttmlTime(attr(tag, 'end'), opts);
    if (!Number.isFinite(end) && attr(tag, 'dur')) end = begin + ttmlTime(attr(tag, 'dur'), opts);
    const content = unescapeXml(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (Number.isFinite(begin) && content) lines.push({ begin, end: Number.isFinite(end) ? end : null, content });
  }
  lines.sort((a, b) => a.begin - b.begin);
  return { title: titleM ? unescapeXml(titleM[1]).trim() : '', duration: Number.isFinite(duration) ? duration : null, lines };
}

/** LRC text -> {title, lines}. Supports repeated stamps "[00:12.00][01:30.00]text" and [ti:]. */
export function parseLrc(src) {
  const lines = [];
  let title = '';
  let offset = 0;
  for (const raw of String(src || '').replace(/\r\n?/g, '\n').split('\n')) {
    const tag = /^\[(ti|offset):([^\]]*)\]\s*$/i.exec(raw.trim());
    if (tag) { if (tag[1].toLowerCase() === 'ti') title = tag[2].trim(); else offset = Number(tag[2]) / 1000 || 0; continue; }
    const stamps = [];
    let rest = raw.trim();
    let m;
    while ((m = /^\[(\d+):(\d{1,2}(?:[.:]\d+)?)\]/.exec(rest))) {
      stamps.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')));
      rest = rest.slice(m[0].length);
    }
    const content = rest.replace(/<\d+:\d{1,2}(?:\.\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    for (const t of stamps) if (content) lines.push({ begin: Math.max(0, t - offset), end: null, content });
  }
  lines.sort((a, b) => a.begin - b.begin);
  return { title, duration: null, lines };
}

export function parseTimedLyrics(text, name = '') {
  if (/\.lrc$/i.test(name) || /^[ \t]*(\[[a-z]+:[^\]\n]*\][ \t]*)*\[\d+:\d{1,2}(?:[.:]\d+)?\]/im.test(text)) return parseLrc(text);
  return parseTtml(text);
}

/** Timed lines (+ optional recogniser output) -> data/lyrics JSON, source "imported". */
export function buildImported({ parsed, asr = null, duration = null, title = '', generatedAt = new Date().toISOString(), engine = null }) {
  const D = duration ?? parsed.duration ?? (parsed.lines.length ? parsed.lines[parsed.lines.length - 1].begin + 4 : 0);
  const heard = asr ? asrWords(asr) : [];
  const lines = parsed.lines.map((l, i) => {
    const end = l.end ?? (parsed.lines[i + 1] ? parsed.lines[i + 1].begin : Math.min(D, l.begin + 4));
    const toks = tokens(l.content);
    let words;
    const inWin = heard.filter((h) => h.start >= l.begin - 0.3 && h.end <= end + 0.3);
    let matched = 0;
    if (toks.length && inWin.length) {
      const map = alignWords(toks, inWin);
      words = toks.map((t, k) => (map[k] >= 0 ? { begin: inWin[map[k]].start, end: inWin[map[k]].end, content: t.raw } : { begin: null, end: null, content: t.raw }));
      matched = words.filter((w) => w.begin != null).length;
      /* unmatched runs share the time between their neighbours */
      for (let k = 0; k < words.length; k++) {
        if (words[k].begin != null) continue;
        let e = k; while (e < words.length && words[e].begin == null) e++;
        const from = k ? words[k - 1].end : l.begin;
        const to = e < words.length ? words[e].begin : end;
        const step = Math.max(0, to - from) / (e - k);
        for (let q = k; q < e; q++) { words[q].begin = from + step * (q - k); words[q].end = from + step * (q - k + 1); }
        k = e - 1;
      }
      for (const w of words) { w.begin = Math.min(Math.max(w.begin, l.begin), end); w.end = Math.min(Math.max(w.end, w.begin), end); }
    } else {
      const step = (end - l.begin) / Math.max(1, toks.length);
      words = toks.map((t, k) => ({ begin: l.begin + step * k, end: l.begin + step * (k + 1), content: t.raw }));
    }
    const out = { begin: r3(l.begin), end: r3(end), content: l.content };
    if (heard.length) out.confidence = r3(toks.length ? matched / toks.length : 0);
    out.words = words.map((w) => ({ begin: r3(w.begin), end: r3(w.end), content: w.content }));
    return out;
  });
  tidy(lines, D);
  return {
    duration_seconds: Math.round(D),
    language: asr?.language || 'en',
    songTitle: title || parsed.title || '',
    source: 'imported',
    reviewed: false,
    machine: {
      version: MACHINE_VERSION,
      engine: engine || { timing: 'imported', words: heard.length ? (asr?.engine || 'asr') : 'even-split' },
      generated_at: generatedAt,
      word_timing: heard.length ? 'audio' : 'even',
    },
    plain: lines.map((l) => l.content).join('\n'),
    timed: { line: lines },
  };
}
