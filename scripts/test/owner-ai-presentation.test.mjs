/* Presentation safety and honest device/pair states. Executes the shipped
   helper; no browser, worker, inference or deployment is claimed by this test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../js/control-room/owner-ai.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source, context);
const ui = context.window.CR.ownerAi;
const plain = value => JSON.parse(JSON.stringify(value));

test('Markdown renders readable prose and literal code without trusting raw HTML or URLs', () => {
  const html = ui.markdown('# Plan\n\nA **clear** answer with `x < 3`.\n\n- first\n- second\n\n1. One\n2. Two\n\n> A note\n\n```js\nconst value = "<script>";\n```');
  assert.match(html, /<h3>Plan<\/h3>/);
  assert.match(html, /<strong>clear<\/strong>/);
  assert.match(html, /<code>x &lt; 3<\/code>/);
  assert.match(html, /<ul><li>first<\/li><li>second<\/li><\/ul>/);
  assert.match(html, /<ol><li>One<\/li><li>Two<\/li><\/ol>/);
  assert.match(html, /<blockquote>A note<\/blockquote>/);
  assert.match(html, /data-action="ai-copy-code"/);
  assert.match(html, /const value = &quot;&lt;script&gt;&quot;/);
  const hostile = ui.markdown('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert) [data](data:text/html,x) [ok](https://example.test/path?a=1&b=2)');
  assert.doesNotMatch(hostile, /<img|<script|href="(?:javascript|data):/i);
  assert.match(hostile, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(hostile, /href="https:\/\/example\.test\/path\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
  assert.equal(ui.safeLink('https://example.test/\nattack'), null);
  assert.equal(ui.esc('"\'><img>'), '&quot;&#39;&gt;&lt;img&gt;');
});

test('partial streaming Markdown remains escaped until a fence is complete', () => {
  const partial = ui.markdown('```html\n<img src=x onerror=alert(1)>');
  assert.match(partial, /<pre><code>&lt;img src=x onerror=alert\(1\)&gt;<\/code><\/pre>/);
  assert.doesNotMatch(partial, /<img/);
  assert.doesNotMatch(ui.markdown('\u00000\u0000<script>'), /<script/);
});

test('comparison tables and code link labels remain readable and escaped', () => {
  const html = ui.markdown('| Worker | Output |\n| --- | --- |\n| Mac | `a|b` |\n| <img src=x> | [link](https://example.test) |\n\n[`code`](https://example.test)');
  assert.match(html, /<th scope="col">Worker<\/th>/);
  assert.match(html, /<td><code>a\|b<\/code><\/td>/);
  assert.match(html, /<td>&lt;img src=x&gt;<\/td>/);
  assert.match(html, /rel="noopener noreferrer"><code>code<\/code><\/a>/);
  assert.doesNotMatch(html, /<img|\u0000/);
});

test('routing preserves exact implementation and explicit pin, and never invents a worker', () => {
  assert.deepEqual(plain(ui.route('auto')), { mode: 'auto', implementation: 'qwen3.8b.local' });
  assert.deepEqual(plain(ui.route('node:mac-a')), { mode: 'node', implementation: 'qwen3.8b.local', node_id: 'mac-a' });
  assert.deepEqual(plain(ui.route('pair:pair-1', 'qwen3.5-27b.mlx')), { mode: 'pair', implementation: 'qwen3.5.27b.pair', pair_id: 'pair-1' });
  assert.equal(ui.receipt({}).label, 'Device not yet reported');
  const receipt = ui.receipt({ model: 'qwen3:8b', metadata: { agent_job_id: 'turn-1', node: { node_id: 'ovh', node_name: 'OVH', generation_tokens_per_second: 3.25, fallback_reason: 'The eligible Mac disconnected before a lease was accepted.' } } });
  assert.equal(receipt.label, 'OVH · qwen3:8b · 3.3 tok/s');
  assert.equal(receipt.node_id, 'ovh');
  assert.match(receipt.fallback, /disconnected/);
});

test('all lifecycle states have concrete recovery copy; unknown never means ready', () => {
  for (const state of ['pending', 'connected', 'model_ready', 'test_passed', 'offline', 'paused', 'revoked']) {
    assert.equal(ui.deviceState({ state }), state);
    assert.ok(ui.stateLabel({ state }).length > 2);
    assert.ok(ui.recovery({ state }).length > 20);
  }
  assert.equal(ui.deviceState({ state: 'invented-ready' }), 'offline');
  assert.match(ui.recovery({ state: 'revoked' }), /new credential/);
  assert.match(ui.recovery({ state: 'offline' }), /Wi-Fi/);
});
