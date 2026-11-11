import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BOARD_SIZE, SHOES, ORDERS, MAX_TURNS, newSoleRun, moveSole, equipSole,
  useSolePower, visitStore, policeTier, newTeaRun, serveTea, validateArcadeCatalog
} from '../../js/city-arcade/engine.mjs';

const source = JSON.parse(await readFile(new URL('../../core/data/fictional-city/district.v1.json', import.meta.url)));
const catalog = JSON.parse(await readFile(new URL('../../data/city-arcade/catalog.v1.json', import.meta.url)));

test('every canonical original storefront has exactly one mini-game slot', () => {
  const sourceIds = source.businesses.map(x => x.id);
  assert.deepEqual(validateArcadeCatalog(catalog, sourceIds), []);
  assert.equal(sourceIds.length, 8);
  assert.equal(catalog.games.filter(x => x.scope === 'store').length, 8);
  assert.equal(catalog.games.filter(x => x.status === 'playable').length, 2);
  assert.deepEqual(SHOES.map(x => x.id), ['velocity', 'ghost', 'gravity', 'robbery']);
  assert.equal(BOARD_SIZE, 7);
});

test('a new player collects Velocity 1s and gains a two-square movement ability', () => {
  const start = newSoleRun();
  const found = moveSole(start, 'west');
  assert.deepEqual(start.collected, []);
  assert.deepEqual(found.collected, ['velocity']);
  assert.equal(found.score, 100);
  const equipped = equipSole(found, 'velocity');
  assert.equal(equipped.equipped, 'velocity');
  const powered = useSolePower(equipped);
  assert.equal(powered.boost, 'dash');
  const dashed = moveSole(powered, 'west');
  assert.deepEqual(dashed.player, { x: 0, y: 3 });
  assert.equal(dashed.boost, null);
  assert.equal(dashed.turn, 2);
  assert.equal(useSolePower(dashed).message, 'This pair is still recharging.');
});

test('gravity can vault an obstacle; ordinary dashes cannot', () => {
  const p = { ...newSoleRun(), player: { x: 3, y: 2 }, collected: ['gravity'] };
  const jumped = moveSole(useSolePower(equipSole(p, 'gravity')), 'east');
  assert.deepEqual(jumped.player, { x: 5, y: 2 });
  const cannot = moveSole({ ...p, boost: 'dash' }, 'east');
  assert.deepEqual(cannot.player, { x: 3, y: 2 });
  assert.equal(cannot.turn, 0);
});

test('police heat belongs to risky fictional choices, not collecting or legal challenges', () => {
  const clean = moveSole(newSoleRun(), 'west');
  assert.equal(clean.heat, 0);
  assert.equal(policeTier(clean.heat), 'No active report');
  const byStore = { ...newSoleRun(), player: { x: 6, y: 3 } };
  const legal = visitStore(byStore, 'challenge');
  assert.equal(legal.score, 75); assert.equal(legal.heat, 0);
  assert.equal(visitStore(legal, 'challenge').turn, 1);
  const crime = visitStore(byStore, 'crime');
  assert.ok(crime.heat >= 4);
  assert.equal(policeTier(crime.heat), 'Active search');
  assert.equal(crime.storeAttempts.includes('crime'), true);
  assert.equal(byStore.storeAttempts.length, 0);
});

test('abstract police interception creates fines and a non-permanent game reset', () => {
  const near = { ...newSoleRun(), player: { x: 6, y: 3 },
    police: { x: 5, y: 3 }, heat: 7, score: 100 };
  const result = visitStore(near, 'challenge');
  assert.equal(result.detentions, 1);
  assert.equal(result.fines, 50);
  assert.deepEqual(result.player, { x: 3, y: 3 });
  assert.equal(result.status, 'playing');
  assert.equal(result.heat, 0);
});

test('collecting all pairs and reaching the exit wins; time and detention can end runs', () => {
  const ready = { ...newSoleRun(), collected: SHOES.map(x => x.id), player: { x: 5, y: 6 } };
  const finish = moveSole(ready, 'east');
  assert.equal(finish.status, 'won');
  assert.equal(finish.score, 250);
  assert.equal(moveSole(finish, 'north'), finish);
  const timed = moveSole({ ...newSoleRun(), turn: MAX_TURNS - 1 }, 'north');
  assert.equal(timed.status, 'failed');
});

test('tea orders score deterministically and finish after five taps', () => {
  let round = newTeaRun();
  for (const order of ORDERS) round = serveTea(round, order.wants);
  assert.equal(round.status, 'won');
  assert.equal(round.correct, ORDERS.length);
  assert.equal(round.score, 175);
  assert.equal(serveTea(round, 'Mint'), round);
  const miss = serveTea(newTeaRun(), 'Mint');
  assert.equal(miss.streak, 0); assert.equal(miss.score, 0);
});

test('catalog rejects invented shop ownership and duplicate game ids', () => {
  const broken = structuredClone(catalog);
  broken.games[1].placeId = 'fake-police-station';
  assert.ok(validateArcadeCatalog(broken, source.businesses.map(x => x.id)).length);
  const duplicate = structuredClone(catalog);
  duplicate.games[2].id = duplicate.games[1].id;
  assert.ok(validateArcadeCatalog(duplicate, source.businesses.map(x => x.id)).length);
});

test('the arcade is owner only: noindex, the shared server gate, and no game code before the yes', async () => {
  const app = await readFile(new URL('../../js/city-arcade/app.mjs', import.meta.url), 'utf8');
  const html = await readFile(new URL('../../city-arcade.html', import.meta.url), 'utf8');
  /* owner, 2026-11-03: private at first, like the rest of the games, until playtested */
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(html, /<link rel="canonical"/);
  const gate = html.match(/<section class="owner-gate"[^>]*data-owner-gate[^>]*>/);
  assert.ok(gate, 'the gate panel');
  assert.match(gate[0], /data-owner-template="arcadeTpl"/);
  assert.match(gate[0], /data-owner-load="js\/city-arcade\/app\.mjs\?v=__STAMP__"/);
  assert.match(html, /<template id="arcadeTpl">[\s\S]*id="arcade-list"[\s\S]*id="arcade-play"[\s\S]*<\/template>/);
  assert.match(html, /<script type="module" src="js\/owner-only\.mjs\?v=__STAMP__"><\/script>/);
  /* outside the inert template, nothing loads the arcade: only the gate, auth and the bar */
  const outside = html.replace(/<template[\s\S]*?<\/template>/g, '');
  assert.doesNotMatch(outside, /<script[^>]+src="[^"]*(city-arcade\/|engine\.mjs)/);
  assert.deepEqual([...outside.matchAll(/<script[^>]*src="([^"?]+)/g)].map(m => m[1]),
    ['js/shell-boot.js', 'js/owner-only.mjs', 'js/mcc-auth.js', 'js/tabbar.js']);
  /* the arcade does not reach into the city's save or the screenplay */
  assert.doesNotMatch(app, /fictional-city\/state\.mjs|mcc-auth/);
  const sitemap = JSON.parse(await readFile(new URL('../../data/seo/sitemap-pages.json', import.meta.url), 'utf8'));
  assert.ok(!sitemap.pages.some(p => p.url.endsWith('/city-arcade.html')), 'out of the sitemap');
});

test('arcade copy carries no public-prototype or "this is fictional" disclaimers', async () => {
  const files = ['../../city-arcade.html', '../../js/city-arcade/app.mjs', '../../js/city-arcade/engine.mjs'];
  const text = (await Promise.all(files.map(f => readFile(new URL(f, import.meta.url), 'utf8')))).join('\n')
    .replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(text, /public prototype|No account or purchase|owner preview|\bfictional\b(?!-city)|dramatized|distinct from fiction/i);
  for (const g of catalog.games) assert.doesNotMatch(g.blurb, /\bfictional\b/i, g.id);
});
