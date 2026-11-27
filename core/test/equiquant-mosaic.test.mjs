import test from 'node:test';
import assert from 'node:assert/strict';
import { equiquantMosaicReplay } from '../src/executors/equiquant-mosaic-replay.mjs';
import { assertCompletionEvidence, buildCompletionEvidence } from '../src/completion-evidence.mjs';
import { notifyJobSuccess, notifyJobFailure } from '../src/notifier.mjs';

const job = {
  id: '00000000-0000-4000-8000-000000000010',
  org_id: '00000000-0000-4000-8000-000000000011',
  target_type: 'equiquant_project',
  target_id: '00000000-0000-4000-8000-000000000012',
  job_type: 'equiquant_mosaic_replay',
};

// Independent goldens from the rounded field projection of #865's Python validation.json.
const expected = {
  pooled: [0.3340546369, '1ff244cbd378d568008aacb022beeddb4ddd3f56b1f1f8efdfdd7ddc56bfeddf'],
  group_levels: [0.2529111721, '2c92416ed00303e53775306edfb97e3fd3ff725ff580e8cdc34015401b27b782'],
  group_slopes: [0.2556166798, 'b0fe5ad9536b8681eae1eb1f1aadcb4df8d4e020abd6d0bd99bfbe631d9f9fa6'],
};
for (const [scenario, [mse, digest]] of Object.entries(expected)) {
  test(`MOSAiC ${scenario} reproduces the reference scores and folds`, async () => {
    const claimed = { ...job, input: { scenario } };
    const replay = await equiquantMosaicReplay(claimed);
    assert.equal(replay.held_out_mse, mse);
    assert.equal(replay.result_sha256, digest);
    const result = JSON.parse(replay.result_json);
    assert.equal(result.scenario, scenario);
    for (const name of ['primary', 'strict_coverage', 'shift_8_cells', 'swap_sides']) {
      assert.equal(result.configurations[name].folds.length, 13);
    }
    assert.deepEqual(replay, await equiquantMosaicReplay({ ...claimed, attempts: 2 }));
    const output = buildCompletionEvidence(claimed, replay);
    assert.equal(assertCompletionEvidence(claimed, output), true);
    assert.throws(() => buildCompletionEvidence(claimed, { ...replay, result_json: '{}' }), /result mismatch/);
    assert.throws(() => buildCompletionEvidence(claimed, { ...replay, held_out_mse: 0 }), /score mismatch/);
    assert.throws(() => buildCompletionEvidence(claimed, { ...replay, source_commit: '' }), /source mismatch/);
  });
}

test('only the fixed input and project queue target are accepted', async () => {
  for (const input of [null, [], {}, { scenario: 'other' }, { scenario: 'toString' },
    { scenario: 'pooled', path: 'observations.json' }, { scenario: 'pooled', notify_owner: true }]) {
    await assert.rejects(equiquantMosaicReplay({ ...job, input }), /allowlisted/);
  }
  await assert.rejects(equiquantMosaicReplay({ ...job, target_type: 'other', input: { scenario: 'pooled' } }), /workspace-scoped/);
  await assert.rejects(equiquantMosaicReplay({ ...job, input: { scenario: 'pooled' } }, { signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('private replay success and failure cannot trigger outbound communication', async () => {
  const claimed = { ...job, input: { notify_owner: true } };
  assert.equal((await notifyJobSuccess(claimed, {})).reason, 'private_research_job');
  assert.equal((await notifyJobFailure(claimed, new Error('retry limit'), 'failed')).reason, 'private_research_job');
});
