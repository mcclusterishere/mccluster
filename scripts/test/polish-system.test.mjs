import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

test('global stylesheet carries the shared Action Network interaction language', async () => {
  const css = await read('css/style.css');
  assert.match(css, /--mcc-ease:\s*cubic-bezier\(\.22,1,\.36,1\)/);
  assert.match(css, /--mcc-spring:\s*cubic-bezier\(\.34,1\.56,\.64,1\)/);
  assert.match(css, /:where\(button, \[role="button"\]/);
  assert.match(css, /:where\(dialog\[open\]\)/);
  assert.match(css, /\.mcc-surface\s*\{/);
  assert.match(css, /\.mcc-glass\s*\{/);
  assert.match(css, /\.mcc-lift\s*\{/);
  assert.match(css, /\.mcc-shimmer\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('shared polish remains additive instead of repainting every page card', async () => {
  const css = await read('css/style.css');
  const section = css.slice(css.lastIndexOf('MCCLUSTER POLISH SYSTEM'));
  assert.doesNotMatch(section, /:where\([^)]*(article|section|main)[^)]*\)\s*\{/);
  assert.doesNotMatch(section, /body\s*\{[^}]*background:/);
});
