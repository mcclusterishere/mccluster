// A tiny Chrome DevTools Protocol driver for environments where Playwright cannot be installed but a Chrome
// binary exists (CHROME env or google-chrome on PATH). Headless, one page at a time, no third-party packages.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function launch({ chrome = process.env.CHROME || 'google-chrome' } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'cdp-lite-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--disable-dev-shm-usage', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let err = '';
    proc.stderr.on('data', d => { err += d; const m = err.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(Number(m[1])); });
    proc.on('exit', code => reject(new Error('chrome exited ' + code + ': ' + err.slice(-400))));
    setTimeout(() => reject(new Error('chrome did not start: ' + err.slice(-400))), 20000);
  });
  async function page() {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map(), events = [];
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } else if (m.method) events.push(m); };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
    await send('Page.enable'); await send('Runtime.enable');
    return {
      send, events,
      async viewport(width, height, mobile = true) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile }); },
      async goto(url, waitMs = 1500) { await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, waitMs)); },
      async evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; },
      async screenshot(path) { const { data } = await send('Page.captureScreenshot', { format: 'png' }); const { writeFile } = await import('node:fs/promises'); await writeFile(path, Buffer.from(data, 'base64')); },
      async close() { ws.close(); await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {}); }
    };
  }
  return { page, async close() { proc.kill('SIGKILL'); await new Promise(r => setTimeout(r, 200)); rmSync(profile, { recursive: true, force: true }); } };
}
