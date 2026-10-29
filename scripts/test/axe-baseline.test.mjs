/* The accessibility ratchet's always-on half. The browser half
   (scripts/e2e/sitemap-a11y.e2e.mjs, run by
   .github/workflows/site-accessibility.yml) measures the pages; this keeps
   its baseline honest without a browser: every sitemap page is in it, every
   count is a whole number, and the workflow still runs the check. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, ROOT), 'utf8');
const baseline = JSON.parse(read('scripts/e2e/fixtures/axe-baseline.json'));
const sitemap = JSON.parse(read('data/seo/sitemap-pages.json')).pages.map(p => p.url.replace('https://matthew.mccluster.org/', ''));

test('the axe baseline covers every sitemap page', () => {
  assert.equal(baseline.schema_version, 'mccluster-axe-baseline/v1');
  const missing = sitemap.filter(p => !(p in baseline.pages));
  assert.deepEqual(missing, [], 'add new sitemap pages with A11Y_WRITE_BASELINE=1 node scripts/e2e/sitemap-a11y.e2e.mjs');
});

test('every baseline count is a non-negative whole number', () => {
  for (const [page, rules] of Object.entries(baseline.pages)) {
    for (const [rule, n] of Object.entries(rules)) assert.ok(Number.isInteger(n) && n >= 0, `${page} ${rule}: ${n}`);
  }
});

test('the sitemap pages carry no critical or serious axe finding today', () => {
  const allowed = new Set(['region']);
  const serious = [];
  for (const p of sitemap) for (const [rule, n] of Object.entries(baseline.pages[p] || {})) if (n && !allowed.has(rule)) serious.push(`${p} ${rule}:${n}`);
  assert.deepEqual(serious, []);
});

test('the workflow runs the ratchet on PRs and main only, at pinned versions', () => {
  const wf = read('.github/workflows/site-accessibility.yml');
  assert.match(wf, /node scripts\/e2e\/sitemap-a11y\.e2e\.mjs/);
  assert.match(wf, /axe-core@4\.10\.3/);
  assert.match(wf, /'scripts\/e2e\/fixtures\/axe-baseline\.json'/);
  assert.doesNotMatch(wf, /git push|contents: write/);
  for (const uses of wf.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/, uses);
});
