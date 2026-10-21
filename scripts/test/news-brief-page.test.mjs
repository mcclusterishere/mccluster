/* THE MORNING BRIEF page (owner, 2026-10-20). A person publishes; the machine never does. The live reading drops the
   citation marks, the page is never indexed, every source opens off-site without referrer, and region leaders are
   granted by the house owner only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

test('the page is private to search, phone-first and loads only the house scripts', async () => {
  const html = await read('brief.html');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /width=device-width,initial-scale=1/); assert.doesNotMatch(html, /user-scalable=no/);
  assert.deepEqual([...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map((m) => m[1]), ['js/analytics.js', 'js/mcc-auth.js', 'js/tabbar.js', 'js/news-brief.js']);
  const css = await read('css/news-brief.css');
  assert.match(css, /font: 400 max\(16px, 1rem\)/, 'form text never below 16px');
  assert.doesNotMatch(css, /@media \(max-width/, 'breakpoints only add');
  assert.match(css, /minmax\(0, 1fr\)/); assert.doesNotMatch(css.replace(/minmax\(0, [12]fr\)/g, ''), /\b1fr\b/);
});

test('publishing is a person tapping Publish on text they can edit; reading live drops the citations', async () => {
  const js = await read('js/news-brief.js');
  const posts = [...js.matchAll(/\/v1\/mnet\/posts/g)].length;
  assert.equal(posts, 1, 'one publish path');
  assert.match(js, /function publish\(ev\)[\s\S]*\$\("nbPostText"\)\.value/);
  assert.match(js, /function spoken\(text\) \{ return String\(text \|\| ""\)\.replace\(\/\\s\*\\\[\\d\{1,3\}\\\]\/g, ""\)/);
  assert.match(js, /rel="noopener noreferrer nofollow"/);
  assert.match(js, /Not financial advice\./);
  assert.match(js, /navigator\.wakeLock/);
});

test('the Worker routes are signed-in only and region leaders are the owner\'s to grant', async () => {
  const src = await read('workers/mccluster/src/news-briefs.js');
  assert.match(src, /if \(!who\) return fail\(req, env, 'Sign in to read the briefs', 401\)/);
  assert.match(src, /Only the house owner grants region leaders/);
  assert.match(src, /headlines: sample\.map\(\(\{ url, \.\.\.headline \}\) => headline\)/, 'the model sees no link');
});

test('the house owner can also publish the brief to the newsroom, with the headlines it cites, and sees it ticked', async () => {
  const [js, html] = await Promise.all([read('js/news-brief.js'), read('brief.html')]);
  assert.match(html, /<label class="nb__check" id="nbNewsroomRow" hidden><input type="checkbox" id="nbNewsroom" checked>/, 'hidden until the page knows it is the owner');
  assert.match(js, /\$\("nbNewsroomRow"\)\.hidden = !\(state\.data && state\.data\.owner\)/);
  assert.match(js, /draft\.newsroom = true; draft\.newsroom_note = "morning_brief"; draft\.newsroom_sources = citedSources\(state\.brief\)/);
  assert.match(js, /out\.length < 12/, 'at most twelve sources ride with an article');
});
