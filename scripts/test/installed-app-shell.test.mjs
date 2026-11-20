import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../js/shell-boot.js', import.meta.url), 'utf8');

function boot({ standalone, displayMode = false, framed = false, media = 'modern' } = {}) {
  const classes = new Set();
  const styles = [];
  const timers = new Map();
  let mediaListener;
  const mode = { matches: displayMode };
  if (media === 'modern') mode.addEventListener = (event, listener) => {
    assert.equal(event, 'change');
    mediaListener = listener;
  };
  if (media === 'legacy') mode.addListener = listener => { mediaListener = listener; };
  const document = {
    documentElement: { classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : !!force;
        if (on) classes.add(name); else classes.delete(name);
        return on;
      }
    } },
    createElement(name) { assert.equal(name, 'style'); return {}; },
    head: { appendChild(style) { styles.push(style); } }
  };
  const window = { navigator: { standalone } };
  window.parent = framed ? {} : window;
  if (media !== 'absent') window.matchMedia = query => {
    assert.equal(query, '(display-mode: standalone)');
    return mode;
  };
  const context = vm.createContext({
    window, document, navigator: window.navigator,
    location: { pathname: '/mnet.html', search: '' }, URLSearchParams,
    setTimeout(fn, delay) { const id = timers.size + 1; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context, { filename: 'shell-boot.js' });
  return { classes, styles, timers, window, changeMode(matches) {
    assert.equal(typeof mediaListener, 'function', 'display-mode changes are observed');
    mode.matches = matches;
    mediaListener({ matches });
  } };
}

test('ordinary browser navigation never acquires installed-app layout', () => {
  const page = boot();
  assert.equal(page.classes.has('mcc-installed-app'), false);
  assert.equal(page.classes.has('mcc-app-top'), false);
  assert.equal(page.classes.has('mcc-shell-pending'), true);
  page.window.MCC_SHELL.navigationReady();
  assert.equal(page.classes.has('mcc-shell-pending'), false);
});

test('iOS standalone identifies the top app even without matchMedia', () => {
  const page = boot({ standalone: true, media: 'absent' });
  assert.equal(page.classes.has('mcc-installed-app'), true);
  assert.equal(page.classes.has('mcc-app-top'), true);
  page.window.MCC_SHELL.clear();
  assert.equal(page.classes.has('mcc-installed-app'), true, 'session loading does not own app mode');
  assert.equal(page.classes.has('mcc-app-top'), true);
  assert.equal(page.classes.has('mcc-shell-pending'), false);
  assert.equal(page.timers.size, 0);
});

test('standalone display mode works independently of the iOS property', () => {
  const page = boot({ displayMode: true });
  assert.equal(page.classes.has('mcc-installed-app'), true);
  assert.equal(page.classes.has('mcc-app-top'), true);
  page.changeMode(false);
  assert.equal(page.classes.has('mcc-installed-app'), false);
  assert.equal(page.classes.has('mcc-app-top'), false);
  page.changeMode(true);
  assert.equal(page.classes.has('mcc-installed-app'), true);
  assert.equal(page.classes.has('mcc-app-top'), true);
});

test('a nested World or globe can know app mode without owning another safe-area inset', () => {
  const frame = boot({ displayMode: true, framed: true });
  assert.equal(frame.classes.has('mcc-installed-app'), true);
  assert.equal(frame.classes.has('mcc-app-top'), false);
  assert.equal(frame.classes.has('mcc-shell-pending'), false);
  assert.equal(frame.window.MCC_SHELL, undefined, 'the parent continues owning navigation readiness');
  assert.equal(frame.styles.length, 0);
  assert.equal(frame.timers.size, 0);
  frame.changeMode(false);
  assert.equal(frame.classes.has('mcc-installed-app'), false);
  frame.changeMode(true);
  assert.equal(frame.classes.has('mcc-app-top'), false);
});

test('legacy media change listeners preserve the independent iOS standalone signal', () => {
  const page = boot({ standalone: true, media: 'legacy' });
  page.changeMode(false);
  assert.equal(page.classes.has('mcc-installed-app'), true);
  assert.equal(page.classes.has('mcc-app-top'), true);
});
