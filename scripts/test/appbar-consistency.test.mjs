/* THE APP BAR IS THE ONE THING THAT NEVER CHANGES.
   ============================================================
   The complaint: "the bottom bar is not consistent on every single
   page. The profile icon is not seen on every single page. And on some
   pages PRIM3 is also not being able to be seen."

   What was actually wrong: pages had drifted between different copies of
   the bar. The current house bar has exactly THREE destinations — Music,
   HERE and Mnet/Profile — and js/tabbar.js normalizes every loaded copy to
   that same three-tab contract. Pages that navigate around the house still
   have to load the bar at all. TWENTY-NINE pages once did not, and
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
  'equity-uprise.html': 'public logged-out globe gateway with deliberately minimal navigation',
  'embed.html': 'an embeddable widget that runs inside somebody else\'s page',
  'archive.html': 'redirect stub', 'brand.html': 'redirect stub',
  'cut.html': 'redirect stub', 'door.html': 'redirect stub',
  'feed.html': 'redirect stub', 'merch.html': 'redirect stub',
  'prints.html': 'redirect stub', 'role.html': 'redirect stub',
  'sponsor.html': 'redirect stub', 'walls.html': 'redirect stub',
  'insights.html': 'redirect stub to Analytics · Audience',
  'inbox.html': 'redirect stub to Control · Work · Inbox (the desk bot lives at control.html#work:desk-bot)',
  '404.html': 'the not-found page GitHub Pages serves for a bad address; it forwards /action/<slug> and links home',
  'dashboard.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
  'feed.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
  'fellowship.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
  'fellowships.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
  'lb-harness.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
  'profile.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
  'topics.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
  'uprise-admin.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
  'verify.html': 'same-origin legacy redirect stub: destination is enforced by the route regression suite',
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
  const all = await read('js/tabbar.js');
  /* the canonical bar is buildBar(); the owner's five-tab bar (adminBar) is checked below */
  const bar = all.slice(all.indexOf('function buildBar()'), all.indexOf('return nav;', all.indexOf('function buildBar()')));
  /* Music and the M resolve against the house, the Globe against the World's
     own door, so the bar reads the same from either host (js/tabbar.js) */
  const hrefs = [...bar.matchAll(/href="'\s*\+\s*(?:ROOT|HOUSE|WORLD)\s*\+\s*'([a-z0-9-]+\.html)(?:\?[a-z=&]*)?"/g)].map((m) => m[1]);
  /* Music | M | Globe (owner, 2026-10-14): the Globe replaced Profile */
  assert.deepEqual(hrefs, ['listen.html', 'index.html', 'mnet.html'],
    `expected the three canonical tab destinations, found ${hrefs.join(', ')}`);
  for (const href of hrefs) {
    const html = await read(href);
    assert.match(html, /js\/tabbar\.js/,
      `${href} is a tab destination but has no app bar — tapping that tab loses the navigation`);
  }
  /* the owner's five tabs (admin first, owner 2026-10-15): Play, Home (Control Room), M, Analytics, Globe; every
     destination carries the bar, the Control Room included (it no longer opts out) */
  const admin = all.slice(all.indexOf('function adminBar()'), all.indexOf('function markAdminHere()'));
  const adminHrefs = [...admin.matchAll(/href="'\s*\+\s*HOUSE\s*\+\s*'([a-z0-9-]+\.html)/g)].map((m) => m[1]);
  /* the owner's globe is Hitman's Halo (2026-10-22), on the house like the other four */
  assert.deepEqual(adminHrefs, ['listen.html', 'control.html', 'index.html', 'control.html', 'action-globe.html']);
  for (const href of new Set(adminHrefs)) {
    const html = await read(href);
    assert.match(html, /js\/tabbar\.js/, `${href} is an owner tab destination but has no app bar`);
    assert.doesNotMatch(html, /<body[^>]*data-no-appbar/, `${href} opts out of the bar`);
  }
});

test('the bar always writes the three canonical tabs, unconditionally', async () => {
  const bar = await read('js/tabbar.js');
  const block = /nav\.innerHTML\s*=([\s\S]*?);\n/.exec(bar);
  assert.ok(block, 'could not find the bar markup');
  const markup = block[1];
  assert.doesNotMatch(markup, /data-appnav="create"/, 'the retired Create column must not return');
  for (const nav of ['music', 'home', 'world']) {
    assert.match(markup, new RegExp(`data-appnav="${nav}"`),
      `the ${nav} cell is missing from the bar`);
  }
  assert.doesNotMatch(markup, /data-appnav="(?:uprise|sites)"/,
    'shelved columns must not come back into the canonical three-tab bar');
  /* No conditional may wrap a cell: the moment one does, the bar starts
     differing between pages and this whole complaint comes back. */
  assert.doesNotMatch(markup, /\?\s*'|:\s*''/,
    'a tab is being written conditionally — the bar must be identical on every page');
});


test('exactly three columns for everyone: Music | M | Globe', async () => {
  /* Owner, 2026-10-14: the Globe replaced Profile, and member-only Record and
     Analytics columns are gone; signed in or out, the bar is three cells. */
  const bar = await read('js/tabbar.js');
  assert.match(bar, /var ORDER = \["music", "home", "world"\];/);
  assert.doesNotMatch(bar, /setAttribute\("data-member-tab", "(?:record|analytics)"\)/,
    'no member-only columns are added after sign-in');
  assert.match(bar, /querySelectorAll\('\[data-member-tab\]'\), function \(node\) \{ node\.remove\(\); \}\);/);
  /* the trim law: three winged tabs, two rooms each, so a held tab never moves */
  const wing = bar.slice(bar.indexOf('  var WINGS = {'));
  const world = wing.slice(wing.indexOf('world: {'), wing.indexOf('\n  };'));
  assert.equal((world.match(/\["[a-z0-9-]+\.html[^"]*",/g) || []).length, 2, 'the Globe wing carries two rooms');
  assert.match(bar, /var FIXED = \{\};/);
});

test('the native shell mirrors the same three primary destinations', async () => {
  const [appbar, layout] = await Promise.all([
    read('native/src/AppBar.tsx'),
    read('native/app/(tabs)/_layout.tsx'),
  ]);
  const rooms = /export const ROOMS:[\s\S]*?= \[([\s\S]*?)\n\];/.exec(appbar);
  assert.ok(rooms, 'could not find native ROOMS');
  const keys = [...rooms[1].matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['music', 'here', 'create', 'profile'],
    'native primary navigation must stay aligned with Music · HERE · Create · Network');
  assert.match(layout, /name="uprise" options=\{\{ href: null \}\}/,
    'Equity Uprise stays built but off the primary native bar');
  assert.match(layout, /name="closet" options=\{\{ href: null \}\}/,
    'Prayer Closet stays built but off the primary native bar');
});


test('the retired Create column is removed from legacy bars', async () => {
  const bar = await read('js/tabbar.js');
  assert.match(bar, /dock\.querySelectorAll\('\[data-appnav="create"\]'\)/,
    'old page copies of the Create tab must be removed');
  assert.match(bar, /tab\.remove\(\)/);
  const create = await read('create.html');
  assert.match(create, /js\/tabbar\.js/);
});
