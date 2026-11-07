import http from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after } from 'node:test';

// Existing resident tests mock the adapter contract alongside Supabase and the
// broker with fetch. Keep those assertions, but exercise the real inference
// HTTP transport through an ephemeral loopback fixture instead of mocking it.
export async function localAiHttpFixture() {
  const errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const response = await globalThis.fetch(`http://127.0.0.1:4790${req.url}`, {
        method: req.method, headers: req.headers, body,
      });
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(await response.text());
    } catch (error) {
      errors.push(error);
      res.destroy();
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(errors.length, 0, errors[0]?.stack);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
