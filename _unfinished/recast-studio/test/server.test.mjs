import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { makeServer } from '../server.mjs';
test('preview host is loopback-only with no mutation endpoints and restrictive browser policy', async () => {
  const server = makeServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.match(await page.text(), /Local prototype/);
    assert.equal((await fetch(base, { method: 'POST', body: 'no upload' })).status, 405);
    assert.equal((await fetch(base + '/api/jobs')).status, 404);
    assert.equal((await fetch(base + '/package.json')).status, 404);
    const badHostStatus = await new Promise((resolve, reject) => {
      const req = request(base, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(base + '/app.mjs')).status, 200);
    assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
