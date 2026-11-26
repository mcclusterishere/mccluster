/* Creator Studio capture and release handoff at account boundaries. Drive the real bench
   through its buttons and public methods. Only browser I/O is substituted. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../js/creator-studio-take.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Model the bench's three existing stores and async transaction-complete boundary.
function storage() {
  const rows = { takes: new Map(), audio: new Map(), rec: new Map() };
  const writes = { ready: deferred(), resume: null };
  const db = {
    transaction(names, mode) {
      const requests = [];
      let done = false;
      const tx = {
        abort() {
          if (done) throw new Error('Transaction already closed');
          done = true;
          this.error = new DOMException('Aborted', 'AbortError');
          queueMicrotask(() => this.onabort());
        },
        objectStore(name) {
          const items = rows[name];
          function request(work) {
            const req = {};
            requests.push(() => { req.result = work(); req.onsuccess?.({ target: req }); });
            return req;
          }
          return {
            getAll: () => request(() => [...items.values()]),
            get: key => request(() => items.get(key)),
            put: row => request(() => items.set(row.id, row)),
            add: row => request(() => items.set(items.size + 1, row)),
            delete: key => request(() => items.delete(key)),
            openCursor() {
              const req = {};
              let keys;
              function advance() {
                const key = keys.shift();
                const cursor = key === undefined ? null :
                  { value: items.get(key), delete: () => items.delete(key), continue: advance };
                req.onsuccess?.({ target: { result: cursor } });
              }
              requests.push(() => { keys = [...items.keys()]; advance(); });
              return req;
            }
          };
        }
      };
      setImmediate(async () => {
        if (mode === 'readwrite' && names.includes('takes') && writes.resume) {
          writes.ready.resolve();
          await writes.resume.promise;
        }
        if (done) return;
        done = true;
        if (mode === 'readwrite' && names.includes('takes') && writes.afterFailure) {
          tx.error = new Error('fixture write failed');
          tx.onabort();
          writes.afterFailure();
          return;
        }
        for (const run of requests) run();
        tx.oncomplete();
      });
      return tx;
    }
  };
  return { rows, writes, indexedDB: { open() {
    const req = { result: db };
    setImmediate(() => req.onsuccess());
    return req;
  } } };
}

class Element extends EventTarget {
  style = {};
  classList = { toggle() {} };
  children = [];
  attributes = new Map();
  files = [];
  fieldValue = '';
  get value() { return this.fieldValue; }
  set value(value) {
    this.fieldValue = value;
    if (this.type === 'file' && value === '') this.files = [];
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  removeAttribute(k) { this.attributes.delete(k); }
  appendChild(child) { this.children.push(child); child.parentNode = this; }
  replaceChildren() { this.children = []; }
  focus() {}
  scrollIntoView() {}
  click() { this.dispatchEvent(new Event('click')); }
}

async function bench(disk = storage()) {
  const elements = new Map();
  for (const id of ['takeBenchMount', 'trackTitle', 'trackMaster', 'trackPreview', ...Array.from(source.matchAll(/id="(tb\w+)"/g), m => m[1])]) {
    elements.set(id, new Element());
  }
  const get = id => elements.get(id) || null;
  for (const id of ['trackMaster', 'trackPreview']) {
    get(id).type = 'file';
    new Element().appendChild(get(id));
  }
  const document = Object.assign(new EventTarget(), {
    getElementById: get, querySelectorAll: () => [], createElement: () => new Element()
  });
  let owner = 'fixture-a';
  let changed;
  const microphone = { permission: deferred(), stopped: false, recorder: null };
  const stream = { getTracks: () => [{ stop() { microphone.stopped = true; } }] };
  class Recorder {
    mimeType = 'audio/wav';
    state = 'inactive';
    static isTypeSupported() { return true; }
    start() { this.state = 'recording'; microphone.recorder = this; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
  }
  class Audio {
    // The fixture only imports our own mono PCM16 WAVs.
    decodeAudioData(bytes) {
      const header = new DataView(bytes);
      const sampleRate = header.getUint32(24, true);
      const pcm = new Float32Array(header.getUint32(40, true) / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = header.getInt16(44 + 2 * i, true) / 32768;
      return Promise.resolve({ sampleRate, length: pcm.length, duration: pcm.length / sampleRate,
        numberOfChannels: 1, getChannelData: () => pcm });
    }
  }
  class Transfer {
    files = [];
    items = { add: file => this.files.push(file) };
  }
  const window = Object.assign(new EventTarget(), {
    document, indexedDB: disk.indexedDB, File, Blob, location: {}, crypto: globalThis.crypto,
    MCC: { account: () => owner, onAccountChange: fn => { changed = fn; } },
    navigator: { mediaDevices: { getUserMedia: () => microphone.permission.promise } },
    AudioContext: Audio, OfflineAudioContext: Audio, MediaRecorder: Recorder,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}
  });
  let elapsed = 0;
  class FixtureDate extends Date { static now() { return Date.now() + elapsed; } }
  vm.runInNewContext(source, { window, document, Event, Blob, File, DataTransfer: Transfer, Date: FixtureDate, URL, setTimeout });
  const api = window.MCC_TAKE_BENCH;
  const wav = api.pure.encodeWav([new Float32Array(4800).fill(-0.125)], 48000);
  await tick();
  await tick();
  return {
    get, api, disk, microphone, wav,
    change(next, notify = true) { const previous = owner; owner = next; if (notify) changed(next, previous); },
    pageEvent(type) { window.dispatchEvent(Object.assign(new Event(type), { persisted: true })); },
    advance(ms) { elapsed += ms; },
    grant() { microphone.permission.resolve(stream); },
    importTone: () => api.importFile(new File([wav], 'fixture.wav', { type: 'audio/wav' }))
  };
}

test('a late microphone grant is released after sign-out and return to the same account', async () => {
  const b = await bench();
  b.get('tbRecord').click();
  assert.equal(b.api.state().pending, true);
  b.change(null);
  b.change('fixture-a');
  b.grant();
  await tick();
  assert.deepEqual([b.api.state().recording, b.microphone.stopped], [false, true]);
});

test('switching accounts stops capture and ignores a queued recording event', async () => {
  const b = await bench();
  b.get('tbRecord').click();
  b.grant();
  await tick();
  assert.equal(b.api.state().recording, true);
  const recorder = b.microphone.recorder;
  const queued = recorder.ondataavailable.bind(recorder);
  queued({ data: new Blob([b.wav]) });
  await tick();
  await tick();
  assert.deepEqual([...b.disk.rows.rec.values()].map(row => row.owner), ['fixture-a']);
  b.change('fixture-b');
  queued({ data: new Blob([b.wav]) });
  await tick();
  await tick();
  assert.deepEqual([b.api.state().recording, b.microphone.stopped], [false, true]);
  assert.deepEqual([...b.disk.rows.rec.values()].map(row => row.owner), ['fixture-a'], 'only the chunk from before retirement remains');
});

test('stopping normally saves the recorded audio and retires its recovery chunks', async () => {
  const b = await bench();
  b.get('tbRecord').click();
  b.grant();
  await tick();
  b.microphone.recorder.ondataavailable({ data: new Blob([b.wav], { type: 'audio/wav' }) });
  b.get('tbRecord').click();
  for (let i = 0; i < 40 && (!b.api.state().takes.length || b.disk.rows.rec.size); i++) await tick();
  assert.equal(b.microphone.stopped, true);
  assert.deepEqual([...b.disk.rows.takes.values()].map(row => row.owner), ['fixture-a']);
  assert.equal(b.disk.rows.rec.size, 0);
  const [take] = b.api.state().takes;
  assert.deepEqual(new Uint8Array(await b.api.bytes(take.id)), new Uint8Array(b.wav));
});

test('a save rendering during an account switch cannot persist or announce a take for the next account', async () => {
  const b = await bench();
  assert.equal(await b.importTone(), true);
  const pending = b.api.save();
  b.change('fixture-b');
  await pending;
  assert.ok(![...b.disk.rows.takes.values()].some(row => row.owner === 'fixture-b'));
  assert.equal(b.api.state().takes.length, 0);
  assert.doesNotMatch(b.get('tbStatus').textContent || '', /saved|fixture/i);
});

test('an unfinished durable transaction aborts when its owner leaves', async () => {
  const b = await bench();
  await b.importTone();
  b.disk.writes.resume = deferred();
  const pending = b.api.save();
  await b.disk.writes.ready.promise;
  b.change('fixture-b');
  b.disk.writes.resume.resolve();
  await pending;
  assert.equal(b.disk.rows.takes.size, 0);
  assert.equal(b.disk.rows.audio.size, 0);
  assert.equal(b.api.state().takes.length, 0);
  assert.doesNotMatch(b.get('tbStatus').textContent || '', /saved|fixture/i);
});

test('a storage failure cannot retain a volatile fallback after its account retires', async () => {
  const b = await bench();
  await b.importTone();
  b.disk.writes.afterFailure = () => b.change('fixture-b');
  await b.api.save();
  b.change('fixture-a');
  await tick();
  await tick();
  assert.equal(b.api.state().takes.length, 0, 'a failed write from the retired activation was discarded');
  assert.equal(b.disk.rows.takes.size, 0);
});

test('a delayed import cannot reopen an old take after the same account signs back in', async () => {
  const b = await bench();
  const file = new File([b.wav], 'late.wav', { type: 'audio/wav' });
  const reading = deferred();
  const contents = deferred();
  file.arrayBuffer = () => { reading.resolve(); return contents.promise; };
  const pending = b.api.importFile(file);
  await reading.promise;
  b.change(null);
  b.change('fixture-a');
  contents.resolve(b.wav);
  await pending;
  assert.equal(b.api.state().open, false);
  assert.doesNotMatch(b.get('tbStatus').textContent || '', /late.wav/);
});

test('a stale file read cannot hand audio to a reopened release form', async () => {
  const b = await bench();
  await b.importTone();
  const take = await b.api.save();
  const handoff = b.api.useInRelease(take.id);
  b.change('fixture-b');
  b.change('fixture-a');
  await handoff;
  assert.equal(b.get('trackMaster').files.length, 0);
  assert.equal(b.get('trackTitle').value, '');
});

test('the owner can save, reopen after reload, and hand off the correct WAV', async () => {
  const b = await bench();
  assert.equal(await b.importTone(), true);
  const take = await b.api.save();
  assert.deepEqual([...b.disk.rows.takes.values()].map(row => row.owner), ['fixture-a']);
  const next = await bench(b.disk);
  assert.equal(next.api.state().takes[0].id, take.id);
  await next.api.openTake(take.id);
  assert.equal(next.api.state().open, true);
  assert.equal(await next.api.useInRelease(take.id), true);
  assert.deepEqual(new Uint8Array(await next.get('trackMaster').files[0].arrayBuffer()), new Uint8Array(b.wav));
  assert.equal(next.get('trackTitle').value, 'fixture');
});

test('switching accounts clears only the files staged by the bench', async () => {
  const b = await bench();
  await b.importTone();
  const take = await b.api.save();
  assert.equal(await b.api.useInRelease(take.id, 'preview'), true);
  const userFile = new File(['independent choice'], 'chosen.wav');
  b.get('trackMaster').files = [userFile];
  b.change('fixture-b');
  assert.equal(b.get('trackPreview').files.length, 0);
  assert.equal(b.get('trackMaster').files[0], userFile);
});

test('page restoration keeps the same account’s saved take and recovers its interrupted recording', async () => {
  const b = await bench();
  await b.importTone();
  const saved = await b.api.save();
  b.get('tbRecord').click();
  b.grant();
  await tick();
  b.microphone.recorder.ondataavailable({ data: new Blob([b.wav], { type: 'audio/wav' }) });
  for (let i = 0; i < 10 && !b.disk.rows.rec.size; i++) await tick();
  assert.equal(b.disk.rows.rec.size, 1);
  b.pageEvent('pagehide');
  b.advance(60_000);
  b.pageEvent('pageshow');
  for (let i = 0; i < 40 && (b.api.state().takes.length < 2 || b.disk.rows.rec.size); i++) await tick();
  assert.equal(b.microphone.stopped, true);
  assert.equal(b.disk.rows.rec.size, 0);
  const visible = b.api.state().takes;
  assert.equal(visible.length, 2);
  assert.ok(visible.some(take => take.id === saved.id));
  for (const take of visible) assert.deepEqual(new Uint8Array(await b.api.bytes(take.id)), new Uint8Array(b.wav));
});

test('page restoration clears an earlier account’s editing and release files after a missed notification', async () => {
  for (const changedWhileParked of [false, true]) {
    const b = await bench();
    await b.importTone();
    const saved = await b.api.save();
    assert.equal(await b.api.useInRelease(saved.id), true);
    assert.equal(await b.api.useInRelease(saved.id, 'preview'), true);
    if (!changedWhileParked) b.change('fixture-b', false);
    b.pageEvent('pagehide');
    if (changedWhileParked) b.change('fixture-b', false);
    b.pageEvent('pageshow');
    await tick();
    await tick();
    assert.equal(b.api.state().open, false);
    assert.equal(b.api.state().takes.length, 0);
    assert.equal(b.get('trackTitle').value, '');
    assert.equal(b.get('trackMaster').files.length, 0);
    assert.equal(b.get('trackPreview').files.length, 0);
    assert.deepEqual([...b.disk.rows.takes.values()].map(row => row.owner), ['fixture-a']);
  }
});
