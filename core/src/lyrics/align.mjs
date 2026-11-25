/* McCluster lyric machine: recognised words + (optional) lyric sheet -> data/lyrics JSON.
 *
 * One pure module shared by the offline CLI (tools/lyrics/transcribe.mjs) and the
 * Core executor (core/src/executors/lyrics-align.mjs), so the file the repo ships
 * and the lyrics a Control upload gets are made by the same code.
 *
 * Output is the shape every player already reads (album.html paintLyrics,
 * js/world-audio-continuity.js lyricLines): timed.line[] with begin/end/content in
 * SECONDS. Added, all optional and ignored by older readers:
 *   source       "aligned" (owner sheet + audio) | "auto" (audio only) | "imported" (TTML/LRC line times)
 *                | "owner" (edited and saved by the owner in Control)
 *   reviewed     false until the owner signs it off in Control
 *   timed.line[].words[]   {begin,end,content} seconds, inside the line
 *   timed.line[].confidence 0..1 how well the audio supports the line
 *   timed.line[].mismatch   true when the audio and the sheet disagree: the review screen highlights it
 *   timed.line[].section    the sheet's label ("Hook", "Verse 1") for the line
 *   timed.line[].sheet      the owner's original words when the sung words replaced them
 *   timed.line[].heard      what the recogniser heard over a mismatched line
 *   timed.line[].added      true for a sung passage the sheet does not contain
 *   timed.line[].repeat     true for a sheet stanza sung again where the sheet writes it once
 */

export const MACHINE_VERSION = 'lyrics-machine/1';

const SECTION_RE = /^\s*\(?\[?\s*((?:intro|outro|hook|chorus|pre[- ]?chorus|post[- ]?chorus|verse|bridge|refrain|interlude|break|ad[- ]?libs?|breakdown|skit)(?:\s*\d+)?)\s*\]?\)?\s*:?\s*$/i;
const LABEL_RE = /^\s*([A-Za-z][A-Za-z0-9 '\-]{0,23}):\s*$/;
const BRACKET_RE = /^\s*\[([^\]]{1,48})\]\s*$/;

/** Split an owner lyric sheet into sung lines with their section labels. */
export function parseSheet(text) {
  const lines = [];
  let section = null;
  let stanza = 0;
  let gap = true;
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = raw.replace(/[​﻿]/g, '').replace(/\s+/g, ' ').trim();
    if (!t) { gap = true; continue; }
    const m = SECTION_RE.exec(t) || LABEL_RE.exec(t) || BRACKET_RE.exec(t);
    if (m) { section = m[1].trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()); stanza += 1; gap = false; continue; }
    if (gap && lines.length) stanza += 1;
    gap = false;
    lines.push({ text: t, section, stanza });
  }
  return lines;
}

/** Lower-case, de-punctuated comparison form of one word. */
export function norm(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function tokens(text) {
  return String(text || '').split(/\s+/).map((raw) => ({ raw, n: norm(raw) })).filter((t) => t.n);
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** 0..1 similarity of two normalised words. */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Flatten recogniser output into words, dropping what is very likely noise. */
export function asrWords(asr) {
  const out = [];
  for (const s of asr?.segments || []) {
    if (s.no_speech_prob > 0.85 && s.avg_logprob < -1) continue;
    for (const w of s.words || []) {
      const n = norm(w.word);
      if (!n || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
      out.push({ raw: String(w.word).trim(), n, start: w.start, end: Math.max(w.start, w.end), p: Number.isFinite(w.probability) ? w.probability : 0.5 });
    }
  }
  /* collapse the recogniser's repeat loop: the same 1-3 word phrase stamped at one instant */
  return out.filter((w, i) => !(i && w.n === out[i - 1].n && w.start === out[i - 1].start));
}

/* Global alignment of sheet words to heard words (Needleman–Wunsch, linear gaps).
   Monotonic by construction, so the lines keep the sheet's order. Returns, for each
   sheet word, the index of its heard word or -1. */
export function alignWords(ref, hyp, { match = 2, fuzzy = 1, mismatch = -1, gap = -1, minSim = 0.6 } = {}) {
  const m = ref.length, n = hyp.length;
  const W = n + 1;
  const score = new Float64Array((m + 1) * W);
  const move = new Uint8Array((m + 1) * W); // 1 diag, 2 up (ref gap), 3 left (hyp gap)
  for (let i = 1; i <= m; i++) { score[i * W] = i * gap; move[i * W] = 2; }
  for (let j = 1; j <= n; j++) { score[j] = j * gap; move[j] = 3; }
  const pair = (i, j) => {
    const s = similarity(ref[i].n, hyp[j].n);
    return s === 1 ? match : s >= minSim ? fuzzy * s : mismatch;
  };
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const d = score[(i - 1) * W + j - 1] + pair(i - 1, j - 1);
      const u = score[(i - 1) * W + j] + gap;
      const l = score[i * W + j - 1] + gap;
      if (d >= u && d >= l) { score[i * W + j] = d; move[i * W + j] = 1; }
      else if (u >= l) { score[i * W + j] = u; move[i * W + j] = 2; }
      else { score[i * W + j] = l; move[i * W + j] = 3; }
    }
  }
  const map = new Array(m).fill(-1);
  let i = m, j = n;
  while (i > 0 || j > 0) {
    const mv = move[i * W + j];
    if (mv === 1) { if (similarity(ref[i - 1].n, hyp[j - 1].n) >= minSim) map[i - 1] = j - 1; i--; j--; }
    else if (mv === 2 || j === 0) i--;
    else j--;
  }
  return map;
}

function lineFromWords(words, extra = {}) {
  return {
    begin: r3(words[0].begin), end: r3(words[words.length - 1].end),
    content: words.map((w) => w.content).join(' '),
    ...extra,
    words: words.map((w) => ({ begin: r3(w.begin), end: r3(w.end), content: w.content })),
  };
}

/* Audio-only: the recogniser's words, broken into lines at breaths and at ~9 words. */
function autoLines(heard, { pause = 0.6, maxWords = 9 } = {}) {
  const lines = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const conf = cur.reduce((a, w) => a + w.p, 0) / cur.length;
    lines.push(lineFromWords(cur.map((w) => ({ begin: w.start, end: w.end, content: w.raw })), { confidence: r3(conf), mismatch: conf < 0.5 }));
    cur = [];
  };
  for (const w of heard) {
    if (cur.length && (w.start - cur[cur.length - 1].end > pause || cur.length >= maxWords || /[.!?]$/.test(cur[cur.length - 1].raw))) flush();
    cur.push(w);
  }
  flush();
  return lines;
}

/* Place sheet lines on heard words. `map[k]` is the heard index for sheet word k
   (or -1). Matched words keep their heard times; runs of unmatched words share the
   gap between their neighbours; lines with no matched word are spread between the
   lines around them, inside [lo, hi]. Confidence says how well the audio supports
   each line; low confidence is flagged (`mismatch`) with what was heard there. */
function placeLines(sheet, ref, map, heard, used, lo, hi) {
  const perLine = sheet.map(() => []);
  ref.forEach((t, k) => perLine[t.li].push({ t, j: map[k] }));
  const lines = sheet.map((line, li) => {
    const items = perLine[li];
    const matched = items.filter((x) => x.j >= 0);
    const conf = items.length ? matched.reduce((a, x) => a + similarity(x.t.n, heard[x.j].n) * Math.min(1, 0.4 + heard[x.j].p), 0) / items.length : 0;
    return { line, items, matched, conf };
  });
  const anchors = lines.map((L) => L.matched.length ? { b: heard[L.matched[0].j].start, e: heard[L.matched[L.matched.length - 1].j].end } : null);
  const weight = lines.map((L) => Math.max(1, L.line.text.length));
  for (let i = 0; i < lines.length; i++) {
    if (anchors[i]) continue;
    let a = i - 1; while (a >= 0 && !anchors[a]) a--;
    let b = i; while (b < lines.length && !anchors[b]) b++;
    const from = a >= 0 ? anchors[a].e : lo;
    const to = b < lines.length ? anchors[b].b : hi;
    const total = weight.slice(a + 1, b).reduce((x, y) => x + y, 0);
    let t = from;
    for (let k = a + 1; k < b; k++) {
      const span = Math.max(0, to - from) * weight[k] / total;
      anchors[k] = { b: t, e: t + span, guessed: true };
      t += span;
    }
  }
  const out = [];
  lines.forEach((L, li) => {
    const win = anchors[li];
    const ws = L.items.map((x) => (x.j >= 0 ? { begin: heard[x.j].start, end: heard[x.j].end, content: x.t.raw } : { begin: null, end: null, content: x.t.raw }));
    for (let k = 0; k < ws.length; k++) {
      if (ws[k].begin != null) continue;
      let e = k; while (e < ws.length && ws[e].begin == null) e++;
      const from = k > 0 ? ws[k - 1].end : win.b;
      const to = e < ws.length ? ws[e].begin : Math.max(from, win.e);
      const step = Math.max(0, to - from) / (e - k);
      for (let q = k; q < e; q++) { ws[q].begin = from + step * (q - k); ws[q].end = from + step * (q - k + 1); }
      k = e - 1;
    }
    const conf = r3(win.guessed ? 0 : L.conf);
    const extra = { confidence: conf, mismatch: conf < 0.5 };
    if (L.line.section) extra.section = L.line.section;
    if (conf < 0.5) {
      const over = heard.filter((h, j) => !used.has(j) && h.start >= win.b - 0.25 && h.end <= win.e + 0.25);
      if (over.length) {
        const sure = over.reduce((a, h) => a + h.p, 0) / over.length;
        extra.heard = over.map((h) => h.raw).join(' ');
        /* prefer what is sung only when the recogniser is clearly sure of it */
        if (sure >= 0.8 && over.length >= 3 && conf < 0.34) {
          extra.sheet = L.line.text;
          out.push({ ...lineFromWords(over.map((h) => ({ begin: h.start, end: h.end, content: h.raw })), extra), _stanza: L.line.stanza });
          over.forEach((h) => used.add(heard.indexOf(h)));
          return;
        }
      }
    }
    out.push({ ...lineFromWords(ws, extra), _stanza: L.line.stanza });
  });
  return out;
}

/* Sheet + audio. The whole sheet is aligned to everything heard (monotonic, so the
   lines keep the sheet's order). Songs repeat what sheets write once (a hook sung
   again, the intro coming back): a sung run the sheet did not account for is
   matched against each stanza, and a repeated stanza is placed with the owner's
   words (`repeat: true`). What still matches nothing is added as heard, flagged. */
function alignedLines(sheet, heard, duration, opts = {}) {
  const ref = [];
  sheet.forEach((line, li) => tokens(line.text).forEach((t) => ref.push({ ...t, li })));
  const map = alignWords(ref, heard, opts);
  const used = new Set(map.filter((j) => j >= 0));
  const out = placeLines(sheet, ref, map, heard, used, 0, duration || (heard.length ? heard[heard.length - 1].end + 4 : 4));

  /* stanzas of the sheet, as candidate repeats */
  const stanzas = [];
  sheet.forEach((line) => {
    const last = stanzas[stanzas.length - 1];
    if (last && last.id === line.stanza) last.lines.push(line); else stanzas.push({ id: line.stanza, lines: [line] });
  });
  const minAdded = opts.minAddedWords ?? 6;

  const runs = [];
  let run = [];
  heard.forEach((h, j) => {
    if (used.has(j)) { if (run.length) runs.push(run); run = []; return; }
    if (run.length && h.start - heard[run[run.length - 1]].end > (opts.runGap ?? 4)) { runs.push(run); run = []; }
    run.push(j);
  });
  if (run.length) runs.push(run);

  const placeRepeats = (idx) => {
    if (idx.length < 3) return idx.length ? [idx] : [];
    const sub = idx.map((j) => heard[j]);
    let best = null;
    /* candidates: each stanza, and every run of consecutive sheet lines about as
       long as what was sung (sheets that never break into stanzas still repeat) */
    const want = idx.length;
    const windows = [];
    for (let i = 0; i < sheet.length; i++) {
      let n = 0; const lines = [];
      for (let k = i; k < sheet.length && n < want * 1.25; k++) { lines.push(sheet[k]); n += tokens(sheet[k].text).length; }
      if (n >= Math.min(3, want)) windows.push({ id: `w${i}`, lines });
    }
    for (const st of [...stanzas, ...windows]) {
      const sref = [];
      st.lines.forEach((line, li) => tokens(line.text).forEach((t) => sref.push({ ...t, li })));
      if (!sref.length) continue;
      const m = alignWords(sref, sub, opts);
      const hit = m.filter((j) => j >= 0).length;
      if (hit < 3) continue;
      /* judged over the lines actually sung this time: a hook sung from its second
         line, or the opening of a sheet written as one long stanza, still counts */
      const sung = sref.map((t, k) => (m[k] >= 0 ? t.li : -1)).filter((li) => li >= 0);
      const span = sref.filter((t) => t.li >= sung[0] && t.li <= sung[sung.length - 1]).length;
      const score = hit / span;
      if (score >= 0.6 && (!best || hit > best.hit)) best = { st, sref, m, hit };
    }
    if (!best) return [idx];
    /* keep the stanza's lines that were actually sung this time (trim unsung ends) */
    const lineHit = best.st.lines.map((_, li) => best.sref.some((t, k) => t.li === li && best.m[k] >= 0));
    const first = lineHit.indexOf(true), last = lineHit.lastIndexOf(true);
    const keep = best.st.lines.slice(first, last + 1);
    const kref = []; const kmap = [];
    best.sref.forEach((t, k) => { if (t.li >= first && t.li <= last) { kref.push({ ...t, li: t.li - first }); kmap.push(best.m[k] >= 0 ? idx[best.m[k]] : -1); } });
    const hitIdx = kmap.filter((j) => j >= 0);
    hitIdx.forEach((j) => used.add(j));
    const lo = heard[Math.min(...hitIdx)].start, hi = heard[Math.max(...hitIdx)].end;
    for (const l of placeLines(keep, kref, kmap, heard, used, lo, hi)) out.push({ ...l, repeat: true });
    const a = idx.indexOf(Math.min(...hitIdx)), b = idx.indexOf(Math.max(...hitIdx));
    return [...placeRepeats(idx.slice(0, a).filter((j) => !used.has(j))), ...placeRepeats(idx.slice(b + 1).filter((j) => !used.has(j)))];
  };

  for (const r of runs) {
    for (const left of placeRepeats(r)) {
      const words = left.filter((j) => !used.has(j)).map((j) => heard[j]);
      if (words.length >= minAdded && words.reduce((a, h) => a + h.p, 0) / words.length >= 0.6) {
        const pieces = autoLines(words);
        /* a lone word broken off by its full stop joins the next fragment */
        for (let i = 0; i < pieces.length - 1; i++) {
          if (pieces[i].words.length === 1 && pieces[i + 1].begin - pieces[i].end < 0.6) {
            const w = [...pieces[i].words, ...pieces[i + 1].words];
            pieces.splice(i, 2, { ...pieces[i + 1], begin: w[0].begin, content: w.map((x) => x.content).join(' '), words: w });
            i -= 1;
          }
        }
        for (const piece of pieces) out.push({ ...piece, mismatch: true, added: true, _stanza: null });
      }
    }
  }
  out.sort((a, b) => a.begin - b.begin);
  return out;
}

/** Make times safe for every reader: inside [0,duration], begins never go backwards,
 *  words inside their line, a line ends no later than the next one starts. */
export function tidy(lines, duration) {
  const D = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  let floor = 0;
  for (const l of lines) {
    if (Array.isArray(l.words)) {
      let wf = Math.max(floor, Math.min(l.begin, D));
      for (const w of l.words) {
        w.begin = r3(Math.min(Math.max(w.begin, wf), D));
        w.end = r3(Math.min(Math.max(w.end, w.begin), D));
        wf = w.begin;
      }
      if (l.words.length) l.end = Math.max(l.end, l.words[l.words.length - 1].end);
    }
    l.begin = r3(Math.min(Math.max(l.begin, floor), D));
    l.end = r3(Math.min(Math.max(l.end, l.begin), D));
    floor = l.begin;
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const next = lines[i + 1].begin;
    if (lines[i].end > next) {
      lines[i].end = r3(Math.max(lines[i].begin, next));
      for (const w of lines[i].words || []) { if (w.end > lines[i].end) w.end = lines[i].end; if (w.begin > w.end) w.begin = w.end; }
    }
  }
  return lines;
}

function plainFrom(lines) {
  const out = [];
  let prev;
  for (const l of lines) {
    if (out.length && l._stanza !== prev) out.push('');
    out.push(l.content);
    prev = l._stanza;
  }
  return out.join('\n');
}

/**
 * Build the lyrics document.
 * @param {object} p
 * @param {object} p.asr        recogniser output ({segments:[{words:[{start,end,word,probability}]}]})
 * @param {string} [p.sheet]    owner lyric sheet text (plain); when present source is "aligned"
 * @param {number} p.duration   audio seconds
 * @param {string} [p.title]
 * @param {string} [p.generatedAt] ISO time (fixed in tests)
 */
export function buildLyrics({ asr, sheet = '', duration, title = '', language = 'en', generatedAt = new Date().toISOString(), options = {} }) {
  const heard = asrWords(asr);
  const sheetLines = parseSheet(sheet);
  const aligned = sheetLines.length > 0;
  let lines = aligned ? alignedLines(sheetLines, heard, duration, options) : autoLines(heard).map((l, i) => ({ ...l, _stanza: i }));
  lines = tidy(lines.filter((l) => l.content && l.content.trim()), duration);
  const plain = aligned ? plainFrom(lines) : lines.map((l) => l.content).join('\n');
  const conf = lines.length ? lines.reduce((a, l) => a + (l.confidence || 0), 0) / lines.length : 0;
  const clean = lines.map(({ _stanza, ...l }) => l);
  return {
    duration_seconds: Math.round(duration),
    language: asr?.language || language,
    songTitle: title,
    source: aligned ? 'aligned' : 'auto',
    reviewed: false,
    machine: {
      version: MACHINE_VERSION,
      engine: { asr: `${asr?.engine || 'unknown'} ${asr?.model || ''}`.trim() },
      generated_at: generatedAt,
      confidence: r3(conf),
      mismatched_lines: clean.filter((l) => l.mismatch).length,
      sheet_lines: sheetLines.length,
      heard_words: heard.length,
    },
    plain,
    timed: { line: clean },
  };
}

/** Schema check used by tests, the CLI and the Control review save. Returns a list of problems. */
export function validateLyrics(doc, { duration = null, slack = 0.75, requireWords = false } = {}) {
  const errs = [];
  if (!doc || typeof doc !== 'object') return ['not an object'];
  if (typeof doc.plain !== 'string') errs.push('plain must be a string');
  const lines = doc.timed?.line;
  if (!Array.isArray(lines)) { errs.push('timed.line must be an array'); return errs; }
  const D = duration ?? (Number.isFinite(doc.duration_seconds) ? doc.duration_seconds : null);
  let prev = -Infinity;
  lines.forEach((l, i) => {
    const at = `line ${i}`;
    if (!Number.isFinite(l.begin) || l.begin < 0) errs.push(`${at}: begin must be a non-negative number`);
    if (typeof l.content !== 'string') errs.push(`${at}: content must be a string`);
    if (l.end != null && !(Number.isFinite(l.end) && l.end >= l.begin)) errs.push(`${at}: end must be >= begin`);
    if (l.begin < prev) errs.push(`${at}: begins before the line above (${l.begin} < ${prev})`);
    prev = l.begin;
    if (D != null && l.begin > D + slack) errs.push(`${at}: begins after the audio ends (${l.begin} > ${D})`);
    if (D != null && l.end != null && l.end > D + slack) errs.push(`${at}: ends after the audio ends (${l.end} > ${D})`);
    if (l.words != null) {
      if (!Array.isArray(l.words)) { errs.push(`${at}: words must be an array`); return; }
      let wp = -Infinity;
      l.words.forEach((w, k) => {
        if (!Number.isFinite(w.begin) || !Number.isFinite(w.end) || w.end < w.begin) errs.push(`${at} word ${k}: needs begin <= end`);
        if (w.begin < l.begin - 0.001 || (l.end != null && w.end > l.end + 0.001)) errs.push(`${at} word ${k}: outside its line`);
        if (w.begin < wp) errs.push(`${at} word ${k}: begins before the word before it`);
        if (typeof w.content !== 'string' || !w.content) errs.push(`${at} word ${k}: content must be a non-empty string`);
        wp = w.begin;
      });
    } else if (requireWords) errs.push(`${at}: words missing`);
    if (l.confidence != null && !(l.confidence >= 0 && l.confidence <= 1)) errs.push(`${at}: confidence must be 0..1`);
  });
  if (doc.source != null && !['auto', 'aligned', 'imported', 'owner'].includes(doc.source)) errs.push(`source ${doc.source} is not known`);
  if (doc.reviewed != null && typeof doc.reviewed !== 'boolean') errs.push('reviewed must be boolean');
  return errs;
}
