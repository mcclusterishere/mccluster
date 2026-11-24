/* Run Creator Studio's actual release submit handler with an isolated storage
   and database double. These cases exercise the boundary between a local file,
   its submitted metadata, an accepted review record and the refresh after it.
   No live upload, release or external request is made. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../js/music-creator-studio.js', import.meta.url), 'utf8');
const TRACK = '10000000-0000-4000-8000-000000000001';
const ALBUM = 'alb_original01';
const event = { preventDefault() {} };
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

function studio(options = {}) {
  const nodes = new Map();
  let submit;
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', checked: false, disabled: false, files: [], hidden: false,
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(name, fn) { if (id === 'trackForm' && name === 'submit') submit = fn; },
      reset() { this.resetCount = (this.resetCount || 0) + 1; }
    });
    return nodes.get(id);
  };
  const values = {
    trackTitle: 'Original song', trackArtist: 'Original artist', trackAccess: 'account',
    trackDescription: 'Original description', trackAlbum: ALBUM, trackGenre: 'Original genre',
    trackMusicVideo: 'https://media.example/original.mp4', trackLyricsUrl: 'https://media.example/original.json',
    trackLyricSheet: 'Original words', licensePrice: '10', licenseTerms: 'Original terms', licenseTitle: 'Original license',
    derivativePermissions: '', trackAccent: '#e5383b', trackBackground: '#090706', trackForeground: '#f4efe6', trackSurface: '#17110f'
  };
  for (const [id, value] of Object.entries(values)) $(id).value = value;
  for (const id of ['ownsMaster', 'controlsComposition', 'samplesCleared', 'collaboratorsCleared', 'releaseTerms']) $(id).checked = true;
  $('isDerivative');
  $('trackMaster').files = [{ name: 'master.wav', size: 1024 }];
  $('trackPreview').files = [{ name: 'preview.mp3', size: 512 }];
  $('trackArt');
  $('submitTrack');
  const form = $('trackForm');
  form.elements = [...nodes.entries()].filter(([id]) => id !== 'trackForm').map(([, node]) => node);
  const calls = [], uploads = [], statuses = [], cleanups = [], lyricSheets = [];
  const settings = options.settings || { albums: [{ id: ALBUM, tracks: [] }] };
  const profile = { artist_name: 'Original artist', settings };
  let probes = 0;
  const rest = async (path, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init?.method || 'GET', body });
    return path === 'creator_tracks' && init?.method === 'POST' ? [{ id: TRACK }] : null;
  };
  const uploadGrant = async (bucket, file) => {
    uploads.push({ bucket, file });
    if (options.upload) await options.upload({ bucket, file, $ });
    return 'creator/' + file.name;
  };
  const durationMs = async () => {
    probes++;
    return options.duration ? options.duration() : 120000;
  };
  const args = {
    $, guarded: (fn) => fn, profile, durationMs, uploadGrant, rest,
    publicUrl: (bucket, path) => 'https://storage.example/' + bucket + '/' + path,
    BUCKET_MAX_BYTES: { 'creator-masters': 524288000, 'creator-previews': 52428800, 'creator-artwork': 20971520 },
    describeSize: (n) => String(n),
    status: (id, message, tone) => statuses.push({ id, message, tone }),
    slugify: (s) => s.toLowerCase().replace(/ /g, '-'),
    experienceFromForm: () => ({ theme: { accent: $('trackAccent').value } }),
    attachLyricSheet: async (id, words) => { lyricSheets.push({ id, words }); return words ? 'sheet' : ''; },
    lyricSheetNote: (outcome) => (outcome === 'sheet' ? ' Your lyric sheet is saved; McCluster times it to the song.' : ''),
    saveSettings: async (change) => change(settings), PAGE: { MAX_TRACKS: 60 },
    loadTracks: async () => { if (options.refreshError) throw new Error('Refresh disconnected'); },
    rollbackRelease: async (...args) => { cleanups.push(args); return []; },
    window: {}
  };
  const begin = source.indexOf('$("trackForm").addEventListener("submit", guarded(async (e) => {');
  const end = source.indexOf('/* ---------- onboarding:', begin);
  assert.ok(begin >= 0 && end > begin, 'the actual release submit handler is present');
  new Function(...Object.keys(args), source.slice(begin, end))(...Object.values(args));
  return { $, submit, calls, uploads, statuses, cleanups, lyricSheets, settings, probes: () => probes };
}

test('two submits during the audio probe create one release, and restore the form controls', async () => {
  const pending = deferred();
  const s = studio({ duration: () => pending.promise });
  s.$('trackGenre').disabled = true;
  const first = s.submit(event);
  const disabledDuringProbe = s.$('submitTrack').disabled;
  const busyDuringProbe = s.$('trackForm').attributes['aria-busy'];
  const second = s.submit(event);
  pending.resolve(120000);
  await Promise.all([first, second]);
  assert.equal(s.probes(), 1);
  assert.equal(s.calls.filter((c) => c.path === 'creator_tracks' && c.method === 'POST').length, 1);
  assert.equal(s.uploads.length, 2);
  assert.equal(disabledDuringProbe, true);
  assert.equal(busyDuringProbe, 'true');
  assert.equal(s.$('submitTrack').disabled, false);
  assert.equal(s.$('trackTitle').disabled, false);
  assert.equal(s.$('trackGenre').disabled, true, 'a field disabled before upload stays disabled');
  assert.equal(s.$('trackForm').attributes['aria-busy'], undefined);
});

test('the submitted metadata, rights, lyric sheet, license and album stay with the chosen release', async () => {
  let changed = false;
  const s = studio({ upload: ({ $ }) => {
    if (changed) return;
    changed = true;
    for (const id of ['trackDescription', 'trackGenre', 'trackMusicVideo', 'trackLyricsUrl', 'trackLyricSheet', 'licenseTerms', 'licenseTitle']) $(id).value = 'Changed during upload';
    $('trackAlbum').value = 'alb_other00001';
    $('licensePrice').value = '99';
    $('ownsMaster').checked = false;
    $('trackAccent').value = '#ffffff';
  } });
  await s.submit(event);
  const release = s.calls.find((c) => c.path === 'creator_tracks' && c.method === 'POST').body;
  assert.equal(release.description, 'Original description');
  assert.equal(release.genre, 'Original genre');
  assert.equal(release.music_video_url, 'https://media.example/original.mp4');
  assert.equal(release.lyrics_url, 'https://media.example/original.json');
  assert.equal(release.experience.theme.accent, '#e5383b');
  assert.equal(release.rights_declaration.owns_master, true);
  assert.deepEqual(s.lyricSheets, [{ id: TRACK, words: 'Original words' }]);
  const offer = s.calls.find((c) => c.path === 'music_license_offers').body;
  assert.equal(offer.title, 'Original license');
  assert.equal(offer.terms_text, 'Original terms');
  assert.equal(offer.price_cents, 1000);
  assert.deepEqual(s.settings.albums[0].tracks, [TRACK]);
});

test('a removed or full album reports the failed association while keeping the submitted release', async () => {
  for (const [settings, reason] of [
    [{ albums: [] }, /album was removed/],
    [{ albums: [{ id: ALBUM, tracks: Array.from({ length: 60 }, (_, i) => String(i)) }] }, /track limit/]
  ]) {
    const s = studio({ settings });
    await s.submit(event);
    assert.equal(s.calls.filter((c) => c.body?.status === 'pending_review').length, 1);
    assert.equal(s.cleanups.length, 0);
    const receipt = s.statuses.at(-1).message;
    assert.match(receipt, /Uploaded\. Submitted for rights and publication review/);
    assert.match(receipt, /not added to the album/);
    assert.match(receipt, reason);
  }
});

test('a failed list refresh after acceptance keeps the submitted receipt and does not roll back the release', async () => {
  const s = studio({ refreshError: true });
  await s.submit(event);
  assert.equal(s.calls.filter((c) => c.body?.status === 'pending_review').length, 1);
  assert.equal(s.cleanups.length, 0);
  assert.match(s.statuses.at(-1).message, /^Release submitted\./);
  assert.match(s.statuses.at(-1).message, /Reload to see it before uploading again/);
});

test('missing rights or release terms are refused before files leave the device', async () => {
  for (const id of ['ownsMaster', 'controlsComposition', 'samplesCleared', 'collaboratorsCleared', 'releaseTerms']) {
    const s = studio();
    s.$(id).checked = false;
    await s.submit(event);
    assert.equal(s.probes(), 0, id);
    assert.equal(s.uploads.length, 0, id);
    assert.equal(s.calls.length, 0, id);
    assert.equal(s.$('submitTrack').disabled, false, id);
    assert.equal(s.$('trackTitle').disabled, false, id);
    assert.equal(s.statuses.at(-1).tone, 'bad', id);
  }
});

test('a priced license without terms is refused before any upload', async () => {
  const s = studio();
  s.$('licenseTerms').value = '';
  await s.submit(event);
  assert.equal(s.uploads.length, 0);
  assert.match(s.statuses.at(-1).message, /Add terms for the commercial license/);
});

test('a stalled local metadata probe settles and releases its file once', async () => {
  const begin = source.indexOf('function durationMs(file) {');
  const end = source.indexOf('async function loadProfile()', begin);
  let timeout, cleared = 0, revoked = 0, loads = 0, removed = 0;
  const media = { duration: 123.456, removeAttribute() { removed++; }, load() { loads++; } };
  const durationMs = new Function('document', 'URL', 'setTimeout', 'clearTimeout', source.slice(begin, end) + '\nreturn durationMs;')(
    { createElement: () => media },
    { createObjectURL: () => 'blob:fixture', revokeObjectURL: (u) => { assert.equal(u, 'blob:fixture'); revoked++; } },
    (fn, ms) => { assert.equal(ms, 15000); timeout = fn; return 1; },
    () => { cleared++; }
  );
  const pending = durationMs({ name: 'stalled.wav' });
  const lateMetadata = media.onloadedmetadata;
  timeout();
  assert.equal(await pending, null);
  lateMetadata();
  assert.deepEqual({ cleared, revoked, loads, removed }, { cleared: 1, revoked: 1, loads: 1, removed: 1 });
  assert.equal(media.onloadedmetadata, null);
  assert.equal(media.onerror, null);
});

/* NEVER LOST SILENTLY (owner, 2026-11-23): until the lyrics_sheet column is live the sheet used to vanish into the
   console. The actual attachLyricSheet from the studio: column first, then the words on the release, then "lost". */
test('a lyric sheet is never dropped silently: the column, else the words on the release, else the creator is told', async () => {
  const begin = source.indexOf('async function attachLyricSheet(');
  const end = source.indexOf('function wireLyricSheet(', begin);
  assert.ok(begin >= 0 && end > begin, 'the actual sheet helpers are present');
  const make = (refuse) => {
    const writes = [];
    const rest = async (path, init) => {
      const body = JSON.parse(init.body);
      writes.push({ path, body });
      if (refuse(body)) throw new Error('refused');
      return null;
    };
    const fns = new Function('rest', 'console', source.slice(begin, end) + '\nreturn { attachLyricSheet, lyricSheetNote };')(rest, { warn() {} });
    return { ...fns, writes };
  };
  const live = make(() => false);
  assert.equal(await live.attachLyricSheet('t1', '  line one\nline two '), 'sheet');
  assert.deepEqual(live.writes.map((w) => Object.keys(w.body)), [['lyrics_sheet']]);
  assert.equal(await live.attachLyricSheet('t1', '   '), '');
  assert.equal(live.writes.length, 1, 'an empty sheet writes nothing');

  const pending = make((body) => 'lyrics_sheet' in body);
  assert.equal(await pending.attachLyricSheet('t2', 'line one\nline two'), 'words');
  const kept = pending.writes[1].body.lyrics;
  assert.equal(kept.source, 'sheet');
  assert.equal(kept.reviewed, false);
  assert.equal(kept.plain, 'line one\nline two');
  assert.equal(kept.timed, undefined, 'untimed, so the machine may replace it with timed lyrics');
  assert.match(pending.lyricSheetNote('words'), /saved with the release/);

  const down = make(() => true);
  assert.equal(await down.attachLyricSheet('t3', 'words'), 'lost');
  assert.match(down.lyricSheetNote('lost'), /could not be saved/);
});
