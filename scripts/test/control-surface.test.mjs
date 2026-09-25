/* THE OPERATOR SURFACE.
   ============================================================
   The complaint: "I'm having trouble as the admin getting to my back
   end, it's like a Frankenstein system."

   The measurement behind it: the Control Room shipped a rail of six
   surfaces and linked to THREE of the sixteen places the owner actually
   works. Thirteen were reachable only by typing the URL from memory.

   Three things pinned here so it cannot drift back.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

/* A surface's href is a URL, not a path: it may legitimately carry a
   query string ("index.html?edit=1" opens the page in edit mode) or a
   fragment. The file on disk is the part before those. */
const fileOf = (href) => String(href).split(/[?#]/)[0];

async function registry() {
  const src = await read('js/control-registry.js');
  const scope = { window: {} };
  new Function('window', src)(scope.window);
  return scope.window.MCC_SURFACES;
}

/* 1. NO ORPHANS ------------------------------------------------- */

test('every surface in the registry is a page that exists', async () => {
  const R = await registry();
  for (const s of R.all) {
    await assert.doesNotReject(read(fileOf(s.href)), `${s.label} points at ${s.href}, which is not there`);
  }
});

test('every operator page is in the registry', async () => {
  /* The list that made the Frankenstein. If a page is added to the
     system and not to the registry, it is unreachable from anywhere and
     this fails rather than letting it quietly go missing. */
  /* This is the active operator plane, not every historical page that still
     exists on disk. Equity Uprise admin/dashboard are shelved under
     _unfinished, Travel Desk is a retained one-off, and ecosystem.html is a
     case-study/deep-link surface rather than an operator desk. */
  const OPERATOR = ['admin.html','console.html','crm.html','analytics.html','desk.html',
    'music-admin.html','management.html','studio.html','lanes.html','vault.html'];
  const R = await registry();
  const known = new Set(R.all.map((s) => fileOf(s.href)));
  for (const page of OPERATOR) {
    assert.ok(known.has(page), `${page} is an operator surface but is in no group — unreachable`);
  }
});

/* 2. THE PALETTE IS EVERYWHERE ---------------------------------- */

test('every operator page can reach every other one', async () => {
  const R = await registry();
  for (const s of R.all) {
    const html = await read(fileOf(s.href));
    assert.match(html, /js\/control-palette\.js/,
      `${s.label} (${s.href}) has no command palette — landing there is a dead end`);
    assert.match(html, /js\/control-registry\.js/,
      `${fileOf(s.href)} loads the palette but not the registry it reads`);
  }
});

/* 3. SEARCH LANDS ON THE RIGHT DESK ----------------------------- */

test('plain-language queries reach the right surface', async () => {
  const R = await registry();
  /* Each of these was typed at the real thing. "who signed up" is the
     one that caught a real bug: "up" substring-matched "Uprise", so the
     Equity Uprise dashboard outranked the front desk. */
  const cases = [
    ['who signed up', ['Analytics', 'Front Desk', 'Mnet']],
    ['leads',         ['Front Desk']],
    ['unsubscribe',   ['Outreach Desk']],
    ['mail',          ['Outreach Desk']],
    ['isrc',          ['The Vault']],
    ['instagram',     ['Socials Room']],
    ['distribution',  ['The Lanes']],
    ['orders',        ['Back Office']],
  ];
  for (const [q, allowed] of cases) {
    const top = R.search(q)[0];
    assert.ok(top, `"${q}" found nothing`);
    assert.ok(allowed.includes(top.label),
      `"${q}" put ${top.label} first; expected one of ${allowed.join(' / ')}`);
  }
});

test('a short token cannot hijack the ranking', async () => {
  const R = await registry();
  /* The specific regression: two-letter fragments are dropped, and a
     keyword hit must be a whole word, so "up" can no longer match
     "Uprise" and outrank a better answer. */
  const top = R.search('who signed up')[0].label;
  assert.ok(!/^Uprise/.test(top), `"up" is hijacking the ranking again: got ${top}`);
});

test('state is declared honestly', async () => {
  const R = await registry();
  for (const s of R.all) {
    assert.ok(['live', 'legacy', 'dark'].includes(s.state),
      `${s.label} has state "${s.state}" — a surface shown as working when it is not costs a click and teaches nothing`);
  }
  assert.equal(R.get('admin').state, 'legacy', 'the back office is mid-migration and must say so');
});
