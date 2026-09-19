import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../worker-build-provenance.mjs', import.meta.url));
test('build records the actual checkout without provider variables and marks modified code', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'worker-provenance-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
    git('init'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
    await writeFile(path.join(cwd,'source.js'), 'export default 1;\n');
    git('add','source.js'); git('commit','-m','fixture');
    const sha = git('rev-parse','HEAD');
    const generate = () => execFileSync(process.execPath,[script],{cwd,encoding:'utf8'});
    const read = async () => JSON.parse((await readFile(path.join(cwd,'.wrangler/build-provenance.mjs'),'utf8')).replace('export const build = ','').trim().replace(/;$/,''));
    generate(); assert.equal((await read()).sha,sha); assert.equal((await read()).dirty,false);
    await writeFile(path.join(cwd,'source.js'), 'export default 2;\n');
    generate(); assert.equal((await read()).dirty,true);
  } finally { await rm(cwd,{recursive:true,force:true}); }
});

test('missing Git provenance fails the build and removes stale generated provenance', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(),'worker-no-git-'));
  try {
    await mkdir(path.join(cwd,'.wrangler'));
    const output = path.join(cwd,'.wrangler/build-provenance.mjs');
    await writeFile(output,'stale');
    assert.notEqual(spawnSync(process.execPath,[script],{cwd}).status,0);
    await assert.rejects(readFile(output),{code:'ENOENT'});
  } finally { await rm(cwd,{recursive:true,force:true}); }
});
