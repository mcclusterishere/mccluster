import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const src = readFileSync(new URL('../../../js/control-room/character-studio.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../../control.html', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../../js/control-room-v2.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../../js/control-room/workspace-core.js', import.meta.url), 'utf8');

function moduleFor(role, slug = 'mccluster') {
  const window = { CR: {} };
  runInNewContext(src, { window });
  const mod = window.CR.characterStudio;
  let requests = 0;
  mod.init({
    request: async () => { requests += 1; return {}; },
    render: () => {},
    getState: () => ({ workspace: { role }, org: { slug } })
  });
  return { mod, requests: () => requests };
}
test('Character Studio uses the canonical Control Create view, not a new public login or tab', () => {
  assert.match(html, /js\/control-room\/character-studio\.js/);
  assert.match(html, /css\/character-studio\.css/);
  assert.match(shell, /"projects", "characters", "library"/);
  assert.match(shell, /characterStudio\.bind/);
  assert.match(shell, /characterStudio\.init/);
  assert.match(routes, /'projects','characters','library'/);
  assert.match(routes, /characters:'Characters'/);
});
test('Private UI refuses staff, signed-out context and non-house workspace', () => {
  for (const [role, slug] of [['viewer','mccluster'],['editor','mccluster'],['owner','other-org']]) {
    const { mod, requests } = moduleFor(role, slug);
    const page = mod.render();
    assert.match(page, /Character Studio is private/);
    assert.doesNotMatch(page, /<form/);
    assert.equal(requests(), 0);
  }
});
test('Owner can see an editable character engine, not active paid generation', () => {
  const { mod, requests } = moduleFor('owner');
  const page = mod.render();
  assert.match(page, /ccsForm/);
  assert.match(page, /Compile private preview/);
  assert.match(page, /Save as draft/);
  assert.match(page, /Nothing is published, billed, or activated/);
  assert.match(page, /no image, voice or video is generated/i);
  assert.equal(requests(), 0);
});
test('Creator-controlled strings in a preview and HTML inputs cannot execute HTML', () => {
  const { mod } = moduleFor('owner');
  mod.state.form.display_name = '<img src=x onerror=alert(1)>';
  mod.state.preview = { blueprint: {
    display_name: '<script>alert(1)</script>', handle: 'safe',
    preview: { social_bio: '<img src=x onerror=alert(1)>', content_series: [{title: '<svg onload=alert(1)>'}] }
  }};
  const page = mod.render();
  assert.doesNotMatch(page, /<script>alert/);
  assert.doesNotMatch(page, /<img src=x/);
  assert.doesNotMatch(page, /<svg onload/);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /&lt;img/);
  assert.match(page, /&lt;svg/);
});
