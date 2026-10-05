import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..','..');
const read=(p)=>readFile(join(ROOT,p),'utf8');

test('paid media validation runs before estimate reservation and provider submission', async()=>{
  const [router,orchestrator,contract,control]=await Promise.all([
    read('workers/mccluster/src/media/router.js'),
    read('workers/mccluster/src/media/orchestrator.js'),
    read('workers/mccluster/src/media/input-contract.js'),
    read('js/control-room/media.js')
  ]);
  const at=(needle)=>router.indexOf(needle);
  assert.ok(at('validateModelInput(model, input);') > 0);
  assert.ok(at('validateModelInput(model, input);') < at('estimateModelCost(model, input)'));
  assert.ok(at('validateModelInput(model, input);') < at("rpc(env, 'media_create_budgeted_job_v2'"));
  assert.ok(orchestrator.indexOf('validateBakeoff(models, input)') < orchestrator.indexOf('Promise.allSettled'));
  assert.match(contract,/Object\.is\(allowed, value\)/,'enum comparison must not coerce numeric values to strings');
  assert.match(contract,/capability === 'lip-sync'/);
  assert.match(contract,/visual.*audio|audio.*visual/s);
  assert.match(control,/PROMPT_ONLY_CAPABILITIES/);
  assert.match(control,/Bakeoff models must share one capability/);
});
