// A loopback web site for the browser executor tests. Chromium reaches it as
// http://<fixture host>:<port> through --host-resolver-rules while the
// executor's own policy resolver answers a public address for that name, so
// the private-network rule stays armed. Every path that must never be reached
// (the loopback-addressed ones) counts a hit.
import http from 'node:http';
import { once } from 'node:events';

const html = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body>${body}</body></html>`;

export async function startBrowserFixture({ host = 'fixture.test' } = {}) {
  const hits = { private: 0, upgrades: 0, downloads: 0, paths: [] };
  let origin = '';
  let loopback = '';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://fixture.invalid');
    hits.paths.push(url.pathname);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
      res.end(body);
    };
    switch (url.pathname) {
      case '/':
        return send(200, html(`<h1>Fixture home</h1><p>Welcome to the fixture home page. Hidden: <span hidden>HIDDEN_TEXT</span></p>
          <nav><a href="/page2">Second page</a> <a href="/form">Search form</a> <a href="${loopback}/private">Private link</a> <a href="mailto:hello">Mail</a></nav>
          <script>window.SCRIPT_TEXT = 'SCRIPT_TEXT';</script><style>.decoy{color:red}</style>`));
      case '/page2':
        return send(200, html('<h1>Page two</h1><p>PAGE_TWO_TEXT</p><a href="/">Home</a>'));
      case '/form':
        return send(200, html(`<h1>Search</h1><form action="/submitted" method="get"><label for="q">Query</label><input id="q" name="q" type="text">
          <label for="region">Region</label><select id="region" name="region"><option value="eu">Europe</option><option value="us">America</option></select>
          <input type="hidden" name="h" value="1"><button type="submit">Search</button></form>`));
      case '/submitted':
        return send(200, html(`<p>SUBMITTED q=${escapeHtml(url.searchParams.get('q'))} region=${escapeHtml(url.searchParams.get('region'))}</p>`));
      case '/redirect-private':
        return send(302, '', { location: `${loopback}/private` });
      case '/redirect-ok':
        return send(302, '', { location: `${origin}/ok` });
      case '/ok':
        return send(200, html('<p>OK_PAGE</p>'));
      case '/private':
      case '/private-api':
      case '/private.js':
      case '/private.png':
        hits.private += 1;
        return send(200, url.pathname === '/private' ? html('<p>PRIVATE_PAGE</p>') : 'PRIVATE_BYTES', { 'content-type': url.pathname === '/private' ? 'text/html' : 'text/plain' });
      case '/download':
        hits.downloads += 1;
        return send(200, 'DOWNLOAD_BYTES', { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="file.bin"' });
      case '/alert':
        return send(200, html(`<p>ALERT_PAGE</p><script>alert('hello'); document.body.insertAdjacentHTML('beforeend', '<p>AFTER_ALERT</p>');</script>`));
      case '/popup':
        return send(200, html(`<p>POPUP_PAGE</p><button id="open">Open popup</button><script>document.getElementById('open').addEventListener('click', () => { window.open('/page2', '_blank'); document.body.insertAdjacentHTML('beforeend', '<p>POPUP_REQUESTED</p>'); });</script>`));
      case '/subresource':
        return send(200, html(`<p>SUB_PAGE</p><script src="${loopback}/private.js"></script><img src="${loopback}/private.png" alt="">
          <script>fetch('${loopback}/private-api').then((r) => r.text()).then((t) => { document.body.insertAdjacentHTML('beforeend', '<p>FETCHED_' + t + '</p>'); }).catch(() => { document.body.insertAdjacentHTML('beforeend', '<p>FETCH_BLOCKED</p>'); });</script>`));
      case '/ws':
        return send(200, html(`<p>WS_PAGE</p><script>const s = new WebSocket('ws://${host}:${server.address().port}/socket');
          s.onopen = () => document.body.insertAdjacentHTML('beforeend', '<p>WS_OPEN</p>');
          s.onclose = () => document.body.insertAdjacentHTML('beforeend', '<p>WS_CLOSED</p>');
          s.onerror = () => document.body.insertAdjacentHTML('beforeend', '<p>WS_ERROR</p>');</script>`));
      case '/long':
        // 50,000 characters of text in a clipped box: a big read, a small screenshot.
        return send(200, html(`<p>LONG_PAGE</p><div style="width:1px;height:1px;overflow:hidden">${'LONG_TEXT '.repeat(5000)}</div>`));
      case '/redirect-chain':
        return send(302, '', { location: `${origin}/redirect-ok` });
      case '/redirect-chain-private':
        return send(302, '', { location: `${origin}/redirect-private` });
      case '/sub-redirect':
        return send(200, html(`<p>SUBR_PAGE</p><script src="/js-redirect"></script><script src="/js-redirect-private"></script>`));
      case '/js-redirect':
        return send(302, '', { location: `${origin}/ok.js` });
      case '/ok.js':
        return send(200, "document.body.insertAdjacentHTML('beforeend', '<p>OK_SCRIPT_RAN</p>');", { 'content-type': 'text/javascript' });
      case '/js-redirect-private':
        return send(302, '', { location: `${loopback}/private.js` });
      case '/scroll':
        return send(200, html('<div style="height:3000px">TOP_MARKER</div><p id="bottom">BOTTOM_MARKER</p>'));
      case '/slow': {
        const ms = Math.max(0, Math.min(20_000, Number(url.searchParams.get('ms')) || 1000));
        await new Promise((resolve) => setTimeout(resolve, ms));
        return send(200, html(`<p>SLOW_PAGE ${ms}</p>`));
      }
      default:
        return send(404, html('<p>NOT_FOUND</p>'));
    }
  });
  server.on('upgrade', (req, socket) => { hits.upgrades += 1; socket.destroy(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  origin = `http://${host}:${port}`;
  loopback = `http://127.0.0.1:${port}`;
  const close = async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  };
  return { server, port, host, origin, loopback, hits, close };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
