import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readRevisionAtStartup } from '../src/runtime-revision.mjs';

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startBroker(manifest) {
  const port = await unusedPort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/tool-broker.mjs', import.meta.url))], {
    env: {...process.env, CORE_BROKER_HOST:'127.0.0.1', CORE_BROKER_PORT:String(port),
      CORE_BROKER_TOKEN:'', CORE_EDGE_SIGNING_KEY:'', MCCLUSTER_DEPLOY_MANIFEST:manifest},
    stdio:['ignore','pipe','pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => {stderr = (stderr + data).slice(-2000);});
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => {child.kill('SIGKILL');reject(new Error(`Broker start timeout: ${stderr}`));},15000);
    child.once('error', error => {clearTimeout(timeout);reject(error);});
    child.once('exit', code => {clearTimeout(timeout);reject(new Error(`Broker exited ${code}: ${stderr}`));});
    child.stdout.on('data', data => {
      if (String(data).includes('core_tool_broker_ready')) {clearTimeout(timeout);resolve();}
    });
  });
  return {child,url:`http://127.0.0.1:${port}/health`};
}

async function stopBroker(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child,'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'),2000);
  await exited;
  clearTimeout(timer);
}

test('the running broker cannot adopt a new manifest SHA until it restarts', {timeout:30000}, async () => {
  const dir = await mkdtemp(join(tmpdir(),'mccluster-runtime-sha-'));
  const manifest = join(dir,'deploy.json');
  let broker;
  try {
    await writeFile(manifest,JSON.stringify({commit_sha:'a'.repeat(40)}));
    broker = await startBroker(manifest);
    const first = await fetch(broker.url).then(r=>r.json());
    assert.equal(first.deployment_sha,'a'.repeat(40));
    await writeFile(manifest,JSON.stringify({commit_sha:'b'.repeat(40)}));
    const stillRunning = await fetch(broker.url).then(r=>r.json());
    assert.equal(stillRunning.deployment_sha,'a'.repeat(40));
    await stopBroker(broker.child);
    broker = await startBroker(manifest);
    const restarted = await fetch(broker.url).then(r=>r.json());
    assert.equal(restarted.deployment_sha,'b'.repeat(40));
  } finally {
    await stopBroker(broker?.child);
    await rm(dir,{recursive:true,force:true});
  }
});

test('startup revision fails closed for unavailable or malformed manifests', async () => {
  const dir = await mkdtemp(join(tmpdir(),'mccluster-runtime-invalid-'));
  const manifest = join(dir,'deploy.json');
  try {
    assert.equal(readRevisionAtStartup(manifest),null);
    await writeFile(manifest,'{bad');
    assert.equal(readRevisionAtStartup(manifest),null);
    await writeFile(manifest,JSON.stringify({commit_sha:'unknown'}));
    assert.equal(readRevisionAtStartup(manifest),null);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
