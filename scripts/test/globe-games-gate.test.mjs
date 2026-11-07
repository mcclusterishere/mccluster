/* The Games tab and the mission surfaces are the house owner's for now (owner, 2026-11-03). Who the owner is stays the
   server's answer: the globe reads /v1/world/access (release.admin_preview, the Worker's level === 'owner'), the bar reads
   /v1/status (requireHouseOwner). These tests hold the client to that answer with the server mocked; the browser proof is
   scripts/e2e/globe-games.e2e.mjs. Nothing here calls production. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');
const [globe, html, css, bar, style, access, mnet, ownerModes] = await Promise.all([
  read('js/action-globe.js'), read('action-globe.html'), read('css/globe-games.css'), read('js/tabbar.js'), read('css/style.css'),
  read('workers/mccluster/src/world-access.js'), read('mnet.html'), read('js/world-owner-modes.js')
]);

/* lift a top-level function out of the globe's IIFE and run it against a mocked server answer */
function lift(src, name, deps) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name);
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  const body = src.slice(at, i + 1);
  return new Function(...Object.keys(deps), body + '\nreturn ' + name + ';')(...Object.values(deps));
}

test('the globe decides owner from the server release answer only (mocked): guest and member no, owner yes', () => {
  const answers = {
    guest: { token: '', access: { release: { version: 'globe-admin-preview/v1', admin_preview: false } } },
    member: { token: 'm', access: { release: { version: 'globe-admin-preview/v1', admin_preview: false } } },
    stale: { token: 'new', accessToken: 'old', access: { release: { version: 'globe-admin-preview/v1', admin_preview: true } } },
    unreachable: { token: 'o', access: null },
    owner: { token: 'o', access: { release: { version: 'globe-admin-preview/v1', admin_preview: true } } }
  };
  const verdict = {};
  for (const [who, a] of Object.entries(answers)) {
    const isOwner = lift(globe, 'isOwner', { sessionToken: () => a.token, access: a.access, accessToken: a.accessToken ?? a.token });
    verdict[who] = isOwner();
  }
  assert.deepEqual(verdict, { guest: false, member: false, stale: false, unreachable: false, owner: true });
  /* and the Worker gives admin_preview to the house owner alone */
  assert.match(access, /admin_preview: level === 'owner'/);
});

test('paintGames shows the Games tab and lifts the mission gate only for the owner (mocked DOM)', () => {
  for (const [who, owner] of [['guest', false], ['member', false], ['owner', true]]) {
    const cls = new Set(), btn = { hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }, door = { hidden: true };
    let closed = 0;
    const paintGames = lift(globe, 'paintGames', {
      isOwner: () => owner, ANALYTICS: false, $: (id) => (id === 'ctlGames' ? btn : id === 'ctlGamesDoor' ? door : null),
      document: { documentElement: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } } },
      games: { isOpen: () => true, close: () => closed++ }, GAMES_OPEN: null, EXPLORE: true, BARE: false, gamesArrived: false, openGames: () => {}
    });
    paintGames();
    assert.equal(btn.hidden, !owner, who + ': Games tab');
    assert.equal(door.hidden, !owner, who + ': the World frame door');
    assert.equal(cls.has('globe-owner'), owner, who + ': mission controls');
    assert.equal(closed, owner ? 0 : 1, who + ': an open overlay closes when the answer is not owner');
  }
});

test('nothing of Games is fetched or opened without the owner answer', () => {
  assert.match(globe, /function openGames\(start\)\{if\(!isOwner\(\)\|\|!window\.HuGames\)return;/);
  assert.equal((globe.match(/'data\/games\/world\.v1\.json'/g) || []).length, 1, 'the data URL lives only in openGames');
  assert.match(html, /<button id="ctlGames" hidden /, 'the tab starts hidden');
  assert.ok(html.indexOf('css/globe-games.css') < html.indexOf('<body>'), 'the owner-only rule is in the head, so nothing flashes');
});

test('until the owner answer, the Games tab and the globe\'s Missions mode, layer and feed are not drawn', () => {
  const rule = /html:not\(\.globe-owner\) :is\(([^)]*)\)\{display:none!important\}/.exec(css);
  assert.ok(rule);
  for (const id of ['#ctlGames', '#ctlGamesDoor', '#feedMode', '#missionsLayer', '#worldFeed', '#worldDetail', '#gamesSheet']) assert.ok(rule[1].split(',').includes(id), id);
  /* gated, not deleted: the controls and their handlers are still on the page */
  assert.match(html, /<button id="feedMode"[^>]*>Missions<\/button>/);
  assert.match(html, /<button id="missionsLayer">Missions<\/button>/);
  assert.match(globe, /\$\('missionsLayer'\)\.onclick=/);
});

test('the bar\'s Missions room is admin-only: guest and member get an empty inert cell, admin gets the room', () => {
  assert.match(bar, /\["mnet\.html\?view=missions", "folk", "Missions", \{[\s\S]*?\}, \{ admin: true \}\]/);
  const slot = ['mnet.html?view=missions', 'folk', 'Missions', {}, { admin: true }], plain = ['account.html?stay=1', 'key', 'Account', {}];
  for (const [who, ADMIN_ON, want] of [['guest', false, false], ['member', false, false], ['admin', true, true]]) {
    const roomAllowed = lift(bar, 'roomAllowed', { ADMIN_ON });
    assert.equal(roomAllowed(slot), want, who);
    assert.equal(roomAllowed(plain), true, who + ': ordinary rooms are unaffected');
  }
  assert.match(bar, /if \(!roomAllowed\(s\)\) return '<span class="appbar__tab appbar__tab--slot appbar__tab--gated" aria-hidden="true"><\/span>';/);
  assert.match(bar, /if \(def && !roomAllowed\(def\)\) return;/, 'a peek never opens a gated room');
  assert.match(style, /\.appbar__tab--slot\.appbar__tab--gated[^{]*\{visibility:hidden;pointer-events:none/);
  /* ADMIN_ON is only ever the server's answer */
  assert.match(bar, /fetch\(API_ORIGIN \+ "\/v1\/status"[\s\S]*?paintAdmin\(r\.ok\);/);
});

test('the World\'s own mission views stay behind the same owner answer', () => {
  assert.match(mnet, /class="[^"]*\bhu-social-only\b/);
  assert.match(mnet, /js\/world-owner-modes\.js/);
  assert.match(ownerModes, /mcc:appbar-admin/);
  assert.match(mnet, /missions=0/);
});
