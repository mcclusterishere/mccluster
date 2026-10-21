import test from 'node:test';
import assert from 'node:assert/strict';
import './support/offline-network.mjs';

test('an unmocked Worker request is rejected before network dispatch', async () => {
  await assert.rejects(fetch('https://fixture.invalid', {headers:{authorization:'fixture-only'}}),
    error => error.code === 'OFFLINE_WORKER_TEST_FETCH');
});
