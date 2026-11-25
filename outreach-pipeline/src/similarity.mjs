/* Similarity guard. A new draft is compared against EVERY prior draft and sent email.
   Reject on any of:
     1. a shared sentence (normalized, 5+ words);
     2. a shared run of SHINGLE_REJECT_N consecutive words;
     3. word 3-shingle Jaccard above jaccardMax;
     4. character trigram cosine above charCosineMax (offline stand in for an embedding);
     5. embedding cosine above embedMax, when an embedding provider is configured;
     6. the same opening (first 6 words of the letter) or a near identical subject.
   Greeting and signature lines are stripped first: "Matthew McCluster" at the bottom is not a template line.
   Thresholds were calibrated on the 13 hand vetted November 2026 drafts, which all pass pairwise
   (their worst pair: 3 word shingle Jaccard 0.016, char trigram cosine 0.74). */
import { sentenceSplit, stripSignature } from './text-rules.mjs';

export const DEFAULT_THRESHOLDS = Object.freeze({
  jaccardMax: 0.08,
  charCosineMax: 0.85,
  embedMax: 0.93,
  subjectJaccardMax: 0.5,
  shingleRejectN: 7,
  minSentenceWords: 5,
});

const norm = (s) => String(s || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);

export function shingles(text, n = 3) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' '));
  return out;
}
export function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
function charGrams(text) {
  const s = ` ${norm(text)} `;
  const m = new Map();
  for (let i = 0; i + 3 <= s.length; i += 1) { const g = s.slice(i, i + 3); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
export function cosineMaps(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; const w = b.get(k); if (w) dot += v * w; }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
export function cosineVec(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
function sentenceKeys(text, minWords) {
  return new Set(sentenceSplit(text).map(norm).filter((s) => s.split(' ').length >= minWords));
}

/* Precompute what we need per history item so a 150 draft run against thousands of prior emails stays fast. */
export function fingerprint(item, { signatureLines, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const letter = stripSignature(item.body, signatureLines);
  return {
    id: item.id ?? null,
    label: item.label || item.to || item.recipient || item.id || 'prior',
    subject: item.subject || '',
    letter,
    sentences: sentenceKeys(letter, thresholds.minSentenceWords),
    sh3: shingles(letter, 3),
    shLong: shingles(letter, thresholds.shingleRejectN),
    chars: charGrams(letter),
    opening: words(letter).slice(0, 6).join(' '),
    subjectSh: shingles(item.subject || '', 1),
    embedding: item.embedding || null,
  };
}

export function compare(fpNew, fpOld, thresholds = DEFAULT_THRESHOLDS) {
  const reasons = [];
  const sharedSentences = [...fpNew.sentences].filter((s) => fpOld.sentences.has(s));
  if (sharedSentences.length) reasons.push({ rule: 'shared_sentence', detail: sharedSentences.slice(0, 3) });
  const sharedRuns = [...fpNew.shLong].filter((s) => fpOld.shLong.has(s));
  if (sharedRuns.length) reasons.push({ rule: 'shared_phrase', detail: sharedRuns.slice(0, 3) });
  const j = jaccard(fpNew.sh3, fpOld.sh3);
  if (j > thresholds.jaccardMax) reasons.push({ rule: 'shingle_jaccard', value: +j.toFixed(4) });
  const c = cosineMaps(fpNew.chars, fpOld.chars);
  if (c > thresholds.charCosineMax) reasons.push({ rule: 'char_cosine', value: +c.toFixed(4) });
  let e = null;
  if (fpNew.embedding && fpOld.embedding) {
    e = cosineVec(fpNew.embedding, fpOld.embedding);
    if (e > thresholds.embedMax) reasons.push({ rule: 'embedding_cosine', value: +e.toFixed(4) });
  }
  if (fpNew.opening && fpNew.opening === fpOld.opening) reasons.push({ rule: 'same_opening', detail: fpNew.opening });
  const sj = jaccard(fpNew.subjectSh, fpOld.subjectSh);
  if (fpNew.subject && sj > thresholds.subjectJaccardMax) reasons.push({ rule: 'similar_subject', value: +sj.toFixed(4) });
  return { against: fpOld.label, againstId: fpOld.id, jaccard: +j.toFixed(4), charCosine: +c.toFixed(4), embedCosine: e == null ? null : +e.toFixed(4), reasons };
}

/* Check one draft against the whole history. Returns { ok, worst, violations }. */
export function guard(draft, historyFingerprints, opts = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
  const fp = fingerprint(draft, { signatureLines: opts.signatureLines, thresholds });
  const violations = [];
  let worst = { jaccard: 0, charCosine: 0, embedCosine: null, against: null };
  for (const old of historyFingerprints) {
    const r = compare(fp, old, thresholds);
    if (r.jaccard > worst.jaccard) worst = { ...worst, jaccard: r.jaccard, against: r.against };
    if (r.charCosine > worst.charCosine) worst = { ...worst, charCosine: r.charCosine };
    if (r.embedCosine != null && (worst.embedCosine == null || r.embedCosine > worst.embedCosine)) worst = { ...worst, embedCosine: r.embedCosine };
    if (r.reasons.length) violations.push(r);
  }
  return { ok: violations.length === 0, worst, violations: violations.slice(0, 10), fingerprint: fp, checkedAgainst: historyFingerprints.length };
}
