import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  parseSheet, norm, similarity, alignWords, tokens, buildLyrics, tidy, validateLyrics, asrWords,
} from '../src/lyrics/align.mjs';
import { docxToText, sheetToText, documentXmlToText, zipEntry } from '../src/lyrics/sheet.mjs';
import { parseTtml, parseLrc, ttmlTime, buildImported, parseTimedLyrics } from '../src/lyrics/import.mjs';
import { transcribe, finalize } from '../src/lyrics/pipeline.mjs';
import { lyricsAlign, mayReplace, sheetInput } from '../src/executors/lyrics-align.mjs';

/* ---- a tiny recogniser output: what faster-whisper hands align.mjs ---- */
const W = (word, start, end, probability = 0.9) => ({ word, start, end, probability });
const ASR = {
  engine: 'faster-whisper', model: 'fixture', language: 'en',
  segments: [
    { start: 1, end: 4, avg_logprob: -0.2, no_speech_prob: 0.01, words: [W('First', 1.0, 1.3), W('get', 1.3, 1.5), W('your', 1.5, 1.7), W('money', 1.7, 2.1, 0.6), W('on', 2.1, 2.3, 0.5), W('then', 2.4, 2.6), W('stack', 2.6, 2.9), W('a', 2.9, 3.0), W('hundred', 3.0, 3.6, 0.4)] },
    { start: 5, end: 8, avg_logprob: -0.2, no_speech_prob: 0.01, words: [W("I'm", 5.0, 5.2), W('the', 5.2, 5.3), W('dealer', 5.3, 5.8), W('for', 5.8, 5.9), W('the', 5.9, 6.0), W('whole', 6.0, 6.3), W('tribe', 6.3, 6.8)] },
    { start: 9, end: 12, avg_logprob: -0.2, no_speech_prob: 0.01, words: [W('Alabama', 9.0, 9.6), W('to', 9.6, 9.7), W('the', 9.7, 9.8), W('coastline', 9.8, 10.5)] },
  ],
};
const SHEET = `Hook:
First get your monyon. Then stack a hundun

Bridge:
I’m the dealer for the whole tribe.
We the family we got soul ties.
Alabama to the coastline.
`;

test('sheet parsing keeps the owner\'s lines and turns labels into sections', () => {
  const lines = parseSheet(SHEET + '\n[Outro · The Survey]\nBe real too…\nVerse 1:\nSo I gave you back');
  assert.deepEqual(lines.map((l) => l.text), ['First get your monyon. Then stack a hundun', 'I’m the dealer for the whole tribe.', 'We the family we got soul ties.', 'Alabama to the coastline.', 'Be real too…', 'So I gave you back']);
  assert.deepEqual(lines.map((l) => l.section), ['Hook', 'Bridge', 'Bridge', 'Bridge', 'Outro · The Survey', 'Verse 1']);
});

test('word normalising and similarity are forgiving of punctuation and curly quotes', () => {
  assert.equal(norm('I’m'), 'im');
  assert.equal(norm('“First'), 'first');
  assert.equal(similarity('monyon', 'money'), 0.5);
  assert.ok(similarity('hundun', 'hundred') >= 0.5);
  assert.equal(similarity('hitcrew', 'hitcrew'), 1);
});

test('global alignment maps sheet words to heard words in order and skips what is missing', () => {
  const ref = tokens('the dealer for the whole tribe');
  const hyp = tokens('yo the dealer for whole tribe now').map((t, i) => ({ ...t, start: i, end: i + 0.5, p: 1 }));
  const map = alignWords(ref, hyp);
  assert.deepEqual(map, [1, 2, 3, -1, 4, 5]);
  assert.ok(map.filter((j) => j >= 0).every((j, i, a) => i === 0 || j > a[i - 1]), 'monotonic');
});

test('an aligned document: owner words, audio times, the missing line interpolated and flagged', () => {
  const doc = buildLyrics({ asr: ASR, sheet: SHEET, duration: 14, title: 'Hundun', generatedAt: '2026-10-31T00:00:00Z' });
  assert.equal(doc.source, 'aligned');
  assert.equal(doc.reviewed, false);
  assert.deepEqual(validateLyrics(doc, { duration: 14 }), []);
  const [hook, dealer, family, alabama] = doc.timed.line;
  assert.equal(hook.content, 'First get your monyon. Then stack a hundun');
  assert.equal(hook.section, 'Hook');
  assert.equal(hook.begin, 1);
  assert.ok(hook.words.find((w) => w.content === 'monyon.').begin >= 1.7 - 1e-9);
  assert.equal(dealer.begin, 5);
  assert.equal(dealer.mismatch, false);
  /* "We the family we got soul ties." was never heard: placed between its neighbours and flagged */
  assert.equal(family.confidence, 0);
  assert.equal(family.mismatch, true);
  assert.ok(family.begin >= dealer.end && family.end <= alabama.begin);
  assert.equal(alabama.begin, 9);
  assert.equal(doc.plain.split('\n\n').length, 2, 'stanzas keep their blank line');
});

test('audio only: the heard words become lines, marked auto and unreviewed', () => {
  const doc = buildLyrics({ asr: ASR, duration: 14 });
  assert.equal(doc.source, 'auto');
  assert.ok(doc.timed.line.length >= 3);
  assert.deepEqual(validateLyrics(doc, { duration: 14, requireWords: true }), []);
  assert.equal(doc.timed.line[1].content, "I'm the dealer for the whole tribe");
});

test('the recogniser\'s repeat-loop duplicates and noise segments are dropped', () => {
  const words = asrWords({ segments: [
    { no_speech_prob: 0.9, avg_logprob: -1.5, words: [W('Thanks', 0, 1)] },
    { no_speech_prob: 0, avg_logprob: -0.1, words: [W('yeah', 2, 2.3), W('yeah', 2, 2.3), W('go', 2.4, 2.6)] },
  ] });
  assert.deepEqual(words.map((w) => w.n), ['yeah', 'go']);
});

test('tidy makes any times safe: inside the song, never backwards, words inside lines', () => {
  const lines = tidy([
    { begin: -1, end: 2, content: 'a', words: [{ begin: -1, end: 0.5, content: 'a' }] },
    { begin: 1.5, end: 9, content: 'b c', words: [{ begin: 1.6, end: 2, content: 'b' }, { begin: 1.2, end: 1.4, content: 'c' }] },
    { begin: 3, end: 99, content: 'd', words: [{ begin: 3, end: 99, content: 'd' }] },
  ], 10);
  assert.deepEqual(validateLyrics({ plain: '', timed: { line: lines } }, { duration: 10 }), []);
  assert.equal(lines[0].begin, 0);
  assert.equal(lines[2].end, 10);
  assert.ok(lines[1].end <= lines[2].begin);
});

test('the validator names what would break a player', () => {
  const bad = { plain: 'x', timed: { line: [
    { begin: 5, end: 6, content: 'late', words: [{ begin: 4, end: 5.5, content: 'late' }] },
    { begin: 2, end: 3, content: 'early' },
    { begin: 200, end: 201, content: 'after' },
  ] }, source: 'guess', reviewed: 'no' };
  const errs = validateLyrics(bad, { duration: 100 }).join('\n');
  assert.match(errs, /outside its line/);
  assert.match(errs, /begins before the line above/);
  assert.match(errs, /after the audio ends/);
  assert.match(errs, /source guess/);
  assert.match(errs, /reviewed must be boolean/);
});

/* ---- owner sheets: .docx built here, byte by byte, as Word writes it ---- */
function zip(files) {
  const locals = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'); const comp = deflateRawSync(data); const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const DOC = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const P = (...runs) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`;

test('a .docx lyric sheet reads to plain lines, entities and breaks included', () => {
  const docx = zip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': DOC(P('Hook:') + P('First get your ', 'monyon. Then stack a hundun') + '<w:p/>' + P('Rock &amp; roll') + '<w:p><w:r><w:t>one</w:t><w:br/><w:t>two</w:t></w:r></w:p>'),
  });
  assert.equal(docxToText(docx), 'Hook:\nFirst get your monyon. Then stack a hundun\n\nRock & roll\none\ntwo\n');
  assert.equal(sheetToText(docx, 'sheet.docx'), docxToText(docx));
  assert.equal(sheetToText(Buffer.from('﻿line one\r\nline two'), 'x.txt'), 'line one\nline two');
});

test('a .docx with a DOCTYPE/ENTITY (the XML-bomb route) or no document part is refused', () => {
  assert.throws(() => documentXmlToText('<!DOCTYPE x [<!ENTITY a "aaaa">]><w:document/>'), /DOCTYPE/);
  assert.throws(() => docxToText(zip({ 'word/other.xml': '<x/>' })), /no word\/document.xml/);
  assert.throws(() => zipEntry(Buffer.from('not a zip at all, just text that is long enough'), 'word/document.xml'), /no ZIP directory/);
});

/* ---- DistroKid TTML / LRC ---- */
const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<!--
Generated by DistroKid
https://distrokid.com
-->
<tt xmlns="http://www.w3.org/ns/ttml"
xmlns:tts="http://www.w3.org/ns/ttml#styling"
xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
xml:lang="en">
<head>
<metadata>
<ttm:title>Data Breach</ttm:title>
</metadata>
</head>
<body dur="00:04:16.000">
<div>
<p begin="00:00:00.093" end="00:00:08.139">Know… How you know… How you… You…</p>
<p begin="00:00:18.096" end="00:00:24.004">You clicked an ad, the computer crashed.</p>
<p begin="00:01:08.095" end="00:01:09.993">Brute Force cracked it. PWNED. RIP.</p>
<p begin="00:03:36.998" end="00:03:40.005">It&apos;s a data breach.</p>
</div>
</body>
</tt>`;

test('DistroKid TTML: line times kept exactly, title and duration read', () => {
  const t = parseTtml(TTML);
  assert.equal(t.title, 'Data Breach');
  assert.equal(t.duration, 256);
  assert.equal(t.lines.length, 4);
  assert.deepEqual(t.lines[1], { begin: 18.096, end: 24.004, content: 'You clicked an ad, the computer crashed.' });
  assert.equal(t.lines[3].content, "It's a data breach.");
  assert.equal(ttmlTime('00:03:36.998'), 216.998);
  assert.equal(ttmlTime('12.5s'), 12.5);
  assert.equal(ttmlTime('800ms'), 0.8);
  assert.throws(() => parseTtml('<!DOCTYPE tt [<!ENTITY x SYSTEM "file:///etc/passwd">]><tt><body><div><p begin="0" end="1">&x;</p></div></body></tt>'), /DOCTYPE/);
});

test('TTML without audio spreads words evenly inside each line; with audio they land on what was heard', () => {
  const parsed = parseTimedLyrics(TTML, 'x.ttml');
  const even = buildImported({ parsed, title: 'Data Breach', generatedAt: 'fixed' });
  assert.equal(even.source, 'imported');
  assert.equal(even.machine.word_timing, 'even');
  assert.deepEqual(validateLyrics(even, { duration: 256 }), []);
  const l = even.timed.line[1];
  assert.equal(l.begin, 18.096);
  assert.equal(l.words.length, 7);
  assert.equal(l.words[0].begin, 18.096);
  assert.equal(l.words[6].end, 24.004);
  const asr = { engine: 'faster-whisper', segments: [{ words: [W('You', 18.4, 18.6), W('clicked', 18.6, 19.1), W('an', 19.1, 19.2), W('ad', 19.2, 19.6)] }] };
  const timed = buildImported({ parsed, asr, duration: 256 });
  assert.equal(timed.machine.word_timing, 'audio');
  assert.equal(timed.timed.line[1].begin, 18.096, 'the line time is the file\'s');
  assert.equal(timed.timed.line[1].words[1].begin, 18.6, 'a heard word takes the audio time');
  assert.deepEqual(validateLyrics(timed, { duration: 256 }), []);
});

test('LRC: repeated stamps, offset, enhanced word tags stripped', () => {
  const lrc = parseLrc('[ti:Hook]\n[offset:+500]\n[00:12.50][01:02.00]Stand on business <00:13.10>with us\n[00:20.00]Stand on\n');
  assert.equal(lrc.title, 'Hook');
  assert.deepEqual(lrc.lines.map((l) => [l.begin, l.content]), [[12, 'Stand on business with us'], [19.5, 'Stand on'], [61.5, 'Stand on business with us']]);
  assert.equal(parseTimedLyrics('[00:01.00]x').lines.length, 1);
});

/* ---- the pipeline with replaceable stages ---- */
test('pipeline: stages are pluggable, recorded, and a failing separator falls back to the mix', async () => {
  const calls = [];
  const stages = {
    separator: { name: 'fake-sep', model: 'm6', run: async () => { calls.push('sep'); throw new Error('no weights'); } },
    recogniser: { name: 'fake-asr', model: 'tiny', run: async (audio) => { calls.push('asr:' + audio); return ASR; } },
    aligner: { name: 'fake-ctc', model: 'w2v', run: async (doc) => { calls.push('ctc'); return doc; } },
  };
  const { doc } = await transcribe({ audio: 'song.mp3', sheetText: SHEET, duration: 14, stages, generatedAt: 'fixed', log: () => {} });
  assert.deepEqual(calls, ['sep', 'asr:song.mp3'], 'no isolated vocal: the aligner is skipped, the mix is recognised');
  assert.equal(doc.machine.engine.separator, 'none (fallback: full mix)');
  assert.equal(doc.machine.engine.aligner, 'none (no isolated vocal)');
  assert.match(doc.machine.engine.asr, /faster-whisper fixture/);
  assert.ok('asr_seconds' in doc.machine.timing && 'map_seconds' in doc.machine.timing);

  const calls2 = [];
  const ok = {
    separator: { name: 'demucs', model: 'htdemucs_6s', run: async () => { calls2.push('sep'); return { vocals: '/tmp/vocals16k.wav', manifest: { stems: [{ stem: 'vocals' }, { stem: 'drums' }] } }; } },
    recogniser: { name: 'faster-whisper', model: 'x', run: async (audio) => { calls2.push('asr:' + audio); return ASR; } },
    aligner: { name: 'wav2vec2-ctc', model: 'BASE_960H', run: async (doc, vocals) => { calls2.push('ctc:' + vocals); doc.timed.line[0].words[0].begin = 0.9; return doc; } },
  };
  const r = await transcribe({ audio: 'song.mp3', sheetText: SHEET, duration: 14, stages: ok, workDir: '/tmp/nowhere', generatedAt: 'fixed' });
  assert.deepEqual(calls2, ['sep', 'asr:/tmp/vocals16k.wav', 'ctc:/tmp/vocals16k.wav']);
  assert.equal(r.stems.stems.length, 2, 'the separator hands back every stem it made');
  assert.equal(r.doc.timed.line[0].begin, 0.9, 'lines follow their refined words');
  assert.equal(r.doc.machine.engine.separator, 'demucs htdemucs_6s');
  assert.deepEqual(validateLyrics(r.doc, { duration: 14 }), []);
});

test('finalize re-derives line bounds from refined words', () => {
  const doc = { plain: '', timed: { line: [{ begin: 3, end: 4, content: 'a b', words: [{ begin: 2.5, end: 2.8, content: 'a' }, { begin: 2.9, end: 3.6, content: 'b' }] }] } };
  finalize(doc, 10);
  assert.equal(doc.timed.line[0].begin, 2.5);
  assert.equal(doc.timed.line[0].end, 3.6);
});

/* ---- the Core executor ---- */
test('the executor never replaces lyrics the owner reviewed', () => {
  assert.equal(mayReplace(null), true);
  assert.equal(mayReplace({ source: 'auto', reviewed: false, timed: { line: [] } }), true);
  assert.equal(mayReplace({ source: 'aligned', reviewed: true, timed: { line: [] } }), false);
  assert.equal(mayReplace({ source: 'owner', reviewed: false, timed: { line: [] } }), false);
  assert.equal(sheetInput('[00:01.00]hi').imported.lines.length, 1);
  assert.equal(sheetInput(TTML).imported.lines.length, 4);
  assert.equal(sheetInput('Hook:\nwords').sheetText, 'Hook:\nwords');
});

test('lyrics_align: reads the release, runs the pipeline, writes only unreviewed lyrics', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const calls = [];
  const rest = async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (!init.method) return { body: [{ id, title: 'Upload', master_bucket: 'creator-masters', master_path: 'u/1-song.mp3', lyrics: null, lyrics_sheet: SHEET }] };
    return { body: [{ id }] };
  };
  let got = null;
  const out = await lyricsAlign({ id: 'job', input: { track_id: id } }, {
    rest,
    download: async (bucket, path, to) => { assert.equal(bucket, 'creator-masters'); assert.match(to, /master\.mp3$/); },
    transcribe: async (args) => { got = args; return { doc: buildLyrics({ asr: ASR, sheet: args.sheetText, duration: 14, generatedAt: 'fixed' }) }; },
  });
  assert.equal(got.sheetText, SHEET.trim());
  assert.equal(out.written, true);
  assert.equal(out.source, 'aligned');
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.match(patch.path, /lyrics->>reviewed\.eq\.false/, 'the write itself refuses to land on reviewed lyrics');
  assert.equal(patch.body.lyrics.reviewed, false);
  assert.equal(patch.body.lyrics.track_id, id);

  const kept = await lyricsAlign({ input: { track_id: id } }, {
    rest: async () => ({ body: [{ id, title: 'Done', master_bucket: 'b', master_path: 'p.mp3', lyrics: { source: 'aligned', reviewed: true, timed: { line: [] } } }] }),
    download: async () => { throw new Error('must not download'); },
  });
  assert.equal(kept.written, false);
  await assert.rejects(lyricsAlign({ input: { track_id: 'nope' } }), /uuid/);
});

test('a hook the sheet writes once but the song sings twice is placed twice, the second marked repeat', () => {
  const sheet = 'Hook:\nStand on business stand on\nStand on business with us\n\nVerse:\nBusiness plans I have written\n';
  const say = (text, t0) => text.split(' ').map((w, i) => W(w, t0 + i * 0.4, t0 + i * 0.4 + 0.3));
  const asr = { engine: 'faster-whisper', model: 'fixture', segments: [
    { words: [...say('Stand on business stand on', 1), ...say('Stand on business with us', 4)] },
    { words: say('Business plans I have written', 10) },
    { words: [...say('Stand on business stand on', 20), ...say('Stand on business with us', 23)] },
  ] };
  const doc = buildLyrics({ asr, sheet, duration: 30, generatedAt: 'fixed' });
  assert.deepEqual(validateLyrics(doc, { duration: 30 }), []);
  const hooks = doc.timed.line.filter((l) => l.content === 'Stand on business stand on');
  assert.equal(hooks.length, 2);
  assert.equal(hooks[0].begin, 1);
  assert.equal(hooks[1].begin, 20);
  assert.equal(hooks[1].repeat, true);
  assert.ok(!doc.timed.line.some((l) => l.added), 'nothing left over as raw heard text');
});
