/* THE APP BAR IS THE ONE THING THAT NEVER CHANGES.
   ============================================================
   The complaint: "the bottom bar is not consistent on every single
   page. The profile icon is not seen on every single page. And on some
   pages PRIM3 is also not being able to be seen."

   What was actually wrong: the bar never renders fewer than five tabs —
   js/tabbar.js writes all five unconditionally — so no page was ever
   missing the profile cell. TWENTY-NINE pages simply never loaded
   tabbar.js at all, and one of them was whip.html, which is the
   DESTINATION OF THE FOURTH TAB. Tapping that tab took you somewhere
   with no bar to tap back from.

   The bar is locked by the owner's instruction. These tests pin its
   consistency without touching its design.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

/* The only pages allowed to go without it, and why each one is allowed.
   A page is not exempt because somebody forgot — it is exempt because it
   is not a place you navigate around from. */
const EXEMPT = {
  'embed.html': 'an embeddable widget that runs inside somebody else\'s page',
  'archive.html': 'redirect stub', 'brand.html': 'redirect stub',
  'cut.html': 'redirect stub', 'door.html': 'redirect stub',
  'feed.html': 'redirect stub', 'merch.html': 'redirect stub',
  'prints.html': 'redirect stub', 'role.html': 'redirect stub',
  'sponsor.html': 'redirect stub', 'walls.html': 'redirect stub',
};
const immersive = (f) => /^equity-uprise-.*-3d\.html$/.test(f);

test('every navigable page carries the app bar', async () => {
  const files = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
  const missing = [];
  for (const f of files) {
    if (EXEMPT[f] || immersive(f)) continue;
    const html = await read(f);
    if (!/js\/tabbar\.js/.test(html)) missing.push(f);
  }
  assert.deepEqual(missing, [],
    `these pages have no app bar, so a visitor lands somewhere with no way back: ${missing.join(', ')}`);
});

test('every tab destination has the bar it was reached from', async () => {
  /* The specific bug. whip.html is where the fourth tab goes and it had
     no bar — tap it, and the navigation you tapped is gone. */
  const bar = await read('js/tabbar.js');
  const hrefs = [...bar.matchAll(/href="'\s*\+\s*ROOT\s*\+\s*'([a-z0-9-]+\.html)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 5, `expected the five tabs, found ${hrefs.length}`);
  for (const href of hrefs) {
    const html = await read(href);
    assert.match(html, /js\/tabbar\.js/,
      `${href} is a tab destination but has no app bar — tapping that tab loses the navigation`);
  }
});

test('the bar always writes all five tabs, unconditionally', async () => {
  const bar = await read('js/tabbar.js');
  const block = /nav\.innerHTML\s*=([\s\S]*?);\n/.exec(bar);
  assert.ok(block, 'could not find the bar markup');
  const markup = block[1];
  for (const nav of ['music', 'uprise', 'home', 'sites', 'profile']) {
    assert.match(markup, new RegExp(`data-appnav="${nav}"`),
      `the ${nav} cell is missing from the bar`);
  }
  /* No conditional may wrap a cell: the moment one does, the bar starts
     differing between pages and this whole complaint comes back. */
  assert.doesNotMatch(markup, /\?\s*'|:\s*''/,
    'a tab is being written conditionally — the bar must be identical on every page');
});
