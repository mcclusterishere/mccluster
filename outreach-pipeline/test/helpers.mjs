import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { LocalStore } from '../src/store.mjs';
import { createSearch } from '../src/search.mjs';
import { createFetcher } from '../src/fetch-page.mjs';
import { loadHistory } from '../src/history.mjs';
import { fixtureComposer } from './fixtures/fixture-composer.mjs';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/* Tests never touch the network: any real fetch fails the test. */
globalThis.fetch = async (url) => { throw new Error(`network disabled in tests: ${url}`); };

export function setup(envOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outreach-test-'));
  const config = loadConfig({ OUTREACH_SEARCH_PROVIDER: 'fixture', OUTREACH_DATA_DIR: dir, ...envOverrides });
  return {
    dir, config,
    store: new LocalStore(dir),
    search: createSearch(config, { fixturePath: path.join(FIXTURES, 'search.json') }),
    fetchPage: createFetcher(config, { fixturePages: path.join(FIXTURES, 'pages.json') }),
    seed: loadHistory(path.join(FIXTURES, 'history')),
    composer: fixtureComposer,
  };
}
