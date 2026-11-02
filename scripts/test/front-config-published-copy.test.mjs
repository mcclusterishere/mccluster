import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The browser cannot load packages/ (deploy-pages.yml strips it), so the editors import a published copy.
// One validator, two paths: the copy must stay byte-identical to the package the Worker imports.
test('js/front-config.mjs is byte-identical to packages/front-config/index.mjs', () => {
  assert.equal(readFileSync('js/front-config.mjs', 'utf8'), readFileSync('packages/front-config/index.mjs', 'utf8'));
});
test('the bridge exposes the validator to classic scripts and imports only the published copy', () => {
  const bridge = readFileSync('js/front-config-bridge.mjs', 'utf8');
  assert.match(bridge, /from '\.\/front-config\.mjs'/);
  assert.doesNotMatch(bridge, /from ['"]\.\.\/packages/);
  assert.match(bridge, /window\.MCC_FRONT_CONFIG = \{ validateFront, mediaPrefix, FRONT_MAX_BYTES, FRONT_SCHEMA \}/);
});
