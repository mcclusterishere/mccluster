import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = name => readFile(join(root, name), 'utf8');

test('every legacy alias is a real page with a same-origin destination', async () => {
  const routes = JSON.parse(await read('data/legacy-page-routes.json'));
  assert.equal(Object.keys(routes).length, 9, 'keep all known legacy entrypoints covered (lab-landmark and lab-props left with asset-lab.html, shelved in _unfinished/)');
  for (const [alias, target] of Object.entries(routes)) {
    assert.match(alias, /^[a-z][a-z0-9-]*\.html$/);
    assert.ok(target.startsWith('/') && !target.startsWith('//') && !target.includes('\\'));
    const u = new URL(target, 'https://matthew.mccluster.org');
    assert.equal(u.origin, 'https://matthew.mccluster.org');
    await access(join(root, u.pathname));
    const html = await read(alias);
    assert.match(html, /<meta name="robots" content="noindex,follow">/);
    assert.match(html, /location\.replace\(target\.pathname \+ target\.search \+ target\.hash\)/);
    assert.ok(html.includes('href="' + target.replace(/&/g, '&amp;') + '"'));
  }
});

test('legacy navigation preserves harmless campaign context but refuses credential and redirect parameters', async () => {
  const routes = JSON.parse(await read('data/legacy-page-routes.json'));
  for (const [alias, target] of Object.entries(routes)) {
    const html = await read(alias);
    const js = /<script>\s*([\s\S]*?)\s*<\/script>/.exec(html);
    assert.ok(js, alias + ' has no browser redirect');
    const destinations = [];
    const location = {
      origin: 'https://matthew.mccluster.org', search: '?utm_source=old-link&access_token=secret&next=https%3A%2F%2Fevil.test',
      hash: '#section', replace: destination => destinations.push(destination)
    };
    vm.runInNewContext(js[1], { URL, URLSearchParams, location });
    assert.equal(destinations.length, 1);
    const dest = new URL(destinations[0], location.origin);
    assert.equal(dest.origin, location.origin);
    assert.equal(dest.pathname, new URL(target, location.origin).pathname);
    assert.equal(dest.searchParams.get('utm_source'), 'old-link');
    assert.equal(dest.searchParams.get('access_token'), null);
    assert.equal(dest.searchParams.get('next'), null);
    assert.equal(dest.hash, '#section');
    if (new URL(target,location.origin).searchParams.has('view')) {
      assert.equal(dest.searchParams.get('view'), new URL(target,location.origin).searchParams.get('view'));
    }
  }
});

test('CRM no longer sends visitors to the retired verification page', async () => {
  const crm = await read('crm.html');
  assert.doesNotMatch(crm, /href="verify\.html"/);
  assert.match(crm, /href="mnet\.html\?view=discover"/);
});
