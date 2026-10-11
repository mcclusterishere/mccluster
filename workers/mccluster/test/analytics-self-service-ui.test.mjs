import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../../../js/music-self-analytics.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function setup(mode = 'fan') {
  const listeners = new Map();
  const host = {
    dataset: { mode },
    _text: '',
    _html: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; this._html = ''; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this._text = ''; },
    replaceChildren() { this.textContent = ''; }
  };
  const section = { hidden: true };
  const btn = { addEventListener() {} };
  let session = { access_token: 'account-A' };
  const pending = [];
  const window = {
    MCC: { refreshIfNeeded: async () => session },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    }
  };
  const document = {
    getElementById(id) {
      return ({ selfMusicAnalytics: host, selfMusicRefresh: btn, fanListeningSection: section })[id] || null;
    }
  };
  const fetch = (url, options) => {
    const task = deferred();
    pending.push({ token: options.headers.Authorization, task });
    return task.promise;
  };
  runInNewContext(script, { window, document, fetch });
  return {
    host, section, pending,
    setSession(value) { session = value; },
    emit(type, detail = {}) { for (const fn of listeners.get(type) || []) fn(detail); }
  };
}
const payload = (value) => ({
  ok: true,
  json: async () => ({ ok: true, counts: { song_start: value }, activity: [{ name: value }] })
});

test('sign-out clears private listening before pending API resolves', async () => {
  const app = setup();
  await tick();
  assert.equal(app.pending.length, 1);
  app.pending[0].task.resolve(payload('private-A'));
  await tick();
  assert.match(app.host.innerHTML, /private-A/);
  assert.equal(app.section.hidden, false);

  app.setSession(null);
  app.emit('mcc:auth-changed');
  assert.doesNotMatch(app.host.innerHTML, /private-A/);
  assert.equal(app.section.hidden, true);
  await tick();
  assert.equal(app.pending.length, 1);
});

test('account switch ignores a delayed response from the previous token', async () => {
  const app = setup();
  await tick();
  app.setSession({ access_token: 'account-B' });
  app.emit('mcc:auth-changed');
  await tick();
  assert.equal(app.pending.length, 2);
  assert.equal(app.pending[1].token, 'Bearer account-B');

  app.pending[1].task.resolve(payload('private-B'));
  await tick();
  assert.match(app.host.innerHTML, /private-B/);

  app.pending[0].task.resolve(payload('private-A'));
  await tick();
  assert.match(app.host.innerHTML, /private-B/);
  assert.doesNotMatch(app.host.innerHTML, /private-A/);
});

test('cross-tab session removal hides fan panel immediately', async () => {
  const app = setup();
  await tick();
  app.pending[0].task.resolve(payload('private-A'));
  await tick();
  app.setSession(null);
  app.emit('storage', { key: 'mccdb_session' });
  assert.equal(app.section.hidden, true);
  assert.doesNotMatch(app.host.innerHTML, /private-A/);
});

test('artist analytics also discard an outdated session response', async () => {
  const app = setup('creator');
  await tick();
  app.setSession(null);
  app.emit('mcc:auth-changed');
  app.pending[0].task.resolve(payload('private-A'));
  await tick();
  assert.doesNotMatch(app.host.innerHTML, /private-A/);
});
