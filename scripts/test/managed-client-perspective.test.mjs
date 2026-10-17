import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
test('each managed front door opts in to the one shared bar', () => {
  for (const [slug,path] of [
    ['faith-and-results','partners/faith-and-results.html'],
    ['shiloh-church-gpt','partners/shiloh-church-gpt.html']]) {
    const html = read(path);
    assert.match(html, new RegExp('data-managed-client="' + slug + '"'));
    assert.match(html, /\.\.\/js\/tabbar\.js/);
    assert.doesNotMatch(html, /data-no-appbar|<nav[^>]*class="appbar"/);
    assert.match(html, /name="robots" content="noindex,follow"/);
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  }
});
test('managed perspective is allowlisted and no privilege source exists', () => {
  const module = read('js/managed-client-perspective.js');
  assert.match(module, /Object\.freeze\(\{/);
  assert.match(module, /hasOwnProperty\.call\(catalog, slug\)/);
  assert.match(module, /bar\.admin\(\)/);
  assert.match(module, /withContext\(bar\.navigation\.world\)/);
  assert.match(module, /window\.addEventListener\("mcc:auth-state"/);
  assert.match(module, /new MutationObserver\(paint\)/);
  assert.doesNotMatch(module, /fetch\s*\(|localStorage|service_role|access_token|document\.cookie/);
  assert.match(read('js/site-navigation.js'), /js\/managed-client-perspective\.js/);
});
test('church assistant is truthfully identified as integration preview', () => {
  const html = read('partners/shiloh-church-gpt.html');
  assert.match(html, /INTEGRATION PREVIEW/);
  assert.match(html, /verified live backend/);
  assert.doesNotMatch(html, /role="textbox"|<form[^>]+assistant/i);
});
