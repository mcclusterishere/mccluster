// The browser.act action vocabulary as a pure validator: every action shape,
// every cap, the handle grammar, the clamps for max_steps and max_ms, the
// log sanitizer and the output bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_ACTION_TYPES, BROWSER_TASK_LIMITS, HANDLE, boundBrowserOutput, browserLimitsFromEnv, sanitizeActionForLog, validateBrowserTask
} from '../src/compute/browser-actions.mjs';

const valid = (actions, extra = {}) => validateBrowserTask({ actions, ...extra });
const code = (input, expected) => assert.throws(() => validateBrowserTask(input), (error) => {
  assert.equal(error.code, expected, `${error.message}`);
  assert.equal(error.status, 400);
  return true;
});

test('the vocabulary, handle grammar and env defaults are the designed ones', () => {
  assert.deepEqual(BROWSER_ACTION_TYPES, ['open', 'read', 'find', 'click', 'type', 'select', 'scroll', 'wait', 'screenshot', 'back', 'done']);
  assert.equal(BROWSER_TASK_LIMITS.max_actions, 25);
  assert.ok(HANDLE.test('h1') && HANDLE.test('h999') && !HANDLE.test('h0001') && !HANDLE.test('H1') && !HANDLE.test('h') && !HANDLE.test('1'));
  assert.deepEqual(browserLimitsFromEnv({}), { maxSteps: 25, maxMs: 120_000, maxOutputBytes: 1_000_000 });
  assert.deepEqual(browserLimitsFromEnv({ MCCLUSTER_BROWSER_MAX_STEPS: '10', MCCLUSTER_BROWSER_MAX_MS: '30000', MCCLUSTER_BROWSER_MAX_OUTPUT_BYTES: '500000' }), { maxSteps: 10, maxMs: 30_000, maxOutputBytes: 500_000 });
  assert.deepEqual(browserLimitsFromEnv({ MCCLUSTER_BROWSER_MAX_STEPS: '99', MCCLUSTER_BROWSER_MAX_MS: '1', MCCLUSTER_BROWSER_MAX_OUTPUT_BYTES: '9999999999' }), { maxSteps: 25, maxMs: 5_000, maxOutputBytes: 1_400_000 }, 'env values are clamped to the fixed ceilings');
});

test('every action type normalizes with its defaults', () => {
  const task = valid([
    { type: 'open', url: 'https://example.com/' },
    { type: 'read' },
    { type: 'read', max_chars: 100, links: false, forms: false },
    { type: 'find', role: 'link', name: 'Docs' },
    { type: 'find', text: 'Sign in', exact: true, limit: 3 },
    { type: 'find', role: 'button' },
    { type: 'click', handle: 'h1' },
    { type: 'type', handle: 'h2', text: 'hello', submit: true },
    { type: 'select', handle: 'h3', value: 'eu' },
    { type: 'scroll', direction: 'down' },
    { type: 'scroll', direction: 'up', amount: 3 },
    { type: 'wait', ms: 250 },
    { type: 'wait', for: 'networkidle' },
    { type: 'wait', for: 'load', timeout_ms: 2000 },
    { type: 'screenshot' },
    { type: 'back' },
    { type: 'done', note: 'finished' }
  ]);
  assert.equal(task.max_steps, 25);
  assert.equal(task.max_ms, 120_000);
  assert.equal(task.screenshot_on_done, true);
  assert.deepEqual(task.actions[1], { type: 'read', max_chars: 8000, links: true, forms: true });
  assert.deepEqual(task.actions[2], { type: 'read', max_chars: 100, links: false, forms: false });
  assert.deepEqual(task.actions[3], { type: 'find', role: 'link', name: 'Docs', text: null, exact: false, limit: 10 });
  assert.deepEqual(task.actions[4], { type: 'find', role: null, name: null, text: 'Sign in', exact: true, limit: 3 });
  assert.deepEqual(task.actions[7], { type: 'type', handle: 'h2', text: 'hello', submit: true });
  assert.deepEqual(task.actions[9], { type: 'scroll', direction: 'down', amount: 1 });
  assert.deepEqual(task.actions[11], { type: 'wait', ms: 250 });
  assert.deepEqual(task.actions[12], { type: 'wait', for: 'networkidle', timeout_ms: 5000 });
  assert.deepEqual(task.actions[14], { type: 'screenshot' });
  assert.deepEqual(task.actions[16], { type: 'done', note: 'finished' });
  assert.deepEqual(valid([{ type: 'done' }]).actions[0], { type: 'done', note: null });
});

test('invalid shapes are BROWSER_ACTION_INVALID; the batch envelope is BROWSER_INPUT_INVALID; too many steps is BROWSER_TOO_MANY_STEPS', () => {
  for (const input of [null, 'open', [], {}, { actions: [] }, { actions: 'open' }, { actions: [{ type: 'done' }], unexpected: 1 }, { actions: [{ type: 'done' }], max_steps: 'ten' }, { actions: [{ type: 'done' }], max_ms: 'slow' }, { actions: [{ type: 'done' }], screenshot_on_done: 'yes' }]) {
    code(input, 'BROWSER_INPUT_INVALID');
  }
  code({ actions: Array.from({ length: 26 }, () => ({ type: 'screenshot' })) }, 'BROWSER_TOO_MANY_STEPS');
  code({ actions: [{ type: 'screenshot' }, { type: 'screenshot' }, { type: 'done' }], max_steps: 2 }, 'BROWSER_TOO_MANY_STEPS');
  const invalidActions = [
    'open', { type: 'shell', command: 'ls' }, { type: 'evaluate', script: '1+1' }, { type: 'open' }, { type: 'open', url: '' }, { type: 'open', url: 'x'.repeat(2049) }, { type: 'open', url: 'https://example.com/', wait: true },
    { type: 'read', max_chars: 0 }, { type: 'read', max_chars: 20001 }, { type: 'read', links: 'yes' },
    { type: 'find' }, { type: 'find', name: 'Docs' }, { type: 'find', exact: true }, { type: 'find', role: 'link', limit: 21 }, { type: 'find', role: 'a'.repeat(41) }, { type: 'find', text: 'x'.repeat(201) }, { type: 'find', role: 'link', name: 'x'.repeat(201) },
    { type: 'click' }, { type: 'click', handle: 'h' }, { type: 'click', handle: 'H1' }, { type: 'click', handle: 'h1234' },
    { type: 'type', handle: 'h1' }, { type: 'type', handle: 'h1', text: 'x'.repeat(2001) }, { type: 'type', handle: 'h1', text: 'x', submit: 'enter' },
    { type: 'select', handle: 'h1' }, { type: 'select', handle: 'h1', value: 'x'.repeat(201) },
    { type: 'scroll' }, { type: 'scroll', direction: 'left' }, { type: 'scroll', direction: 'down', amount: 0 }, { type: 'scroll', direction: 'down', amount: 11 },
    { type: 'wait' }, { type: 'wait', ms: 99 }, { type: 'wait', ms: 10001 }, { type: 'wait', for: 'idle' }, { type: 'wait', for: 'load', timeout_ms: 999 }, { type: 'wait', for: 'load', timeout_ms: 10001 }, { type: 'wait', ms: 500, for: 'load' },
    { type: 'screenshot', full_page: true }, { type: 'back', steps: 2 }, { type: 'done', note: 'x'.repeat(501) }
  ];
  for (const action of invalidActions) {
    code({ actions: [{ type: 'open', url: 'https://example.com/' }, action] }, 'BROWSER_ACTION_INVALID');
  }
});

test('max_steps and max_ms are clamped into their ranges and the env default applies when absent', () => {
  assert.equal(valid([{ type: 'done' }], { max_steps: 99 }).max_steps, 25);
  assert.equal(valid([{ type: 'done' }], { max_steps: 0 }).max_steps, 1);
  assert.equal(valid([{ type: 'done' }], { max_steps: 7.9 }).max_steps, 7);
  assert.equal(valid([{ type: 'done' }], { max_ms: 1 }).max_ms, 5000);
  assert.equal(valid([{ type: 'done' }], { max_ms: 999_999_999 }).max_ms, 600_000);
  assert.equal(valid([{ type: 'done' }], { max_ms: 45_000.7 }).max_ms, 45_000);
  const limited = validateBrowserTask({ actions: [{ type: 'done' }] }, { maxSteps: 5, maxMs: 30_000 });
  assert.equal(limited.max_steps, 5);
  assert.equal(limited.max_ms, 30_000);
  assert.throws(() => validateBrowserTask({ actions: [{ type: 'screenshot' }, { type: 'screenshot' }, { type: 'done' }] }, { maxSteps: 2 }), (error) => error.code === 'BROWSER_TOO_MANY_STEPS');
  assert.equal(valid([{ type: 'done' }], { screenshot_on_done: false }).screenshot_on_done, false);
});

test('the log sanitizer cuts every string at 200 characters and keeps the shape', () => {
  const long = 'u'.repeat(500);
  assert.deepEqual(sanitizeActionForLog({ type: 'open', url: long }), { type: 'open', url: 'u'.repeat(200) });
  assert.deepEqual(sanitizeActionForLog({ type: 'type', handle: 'h1', text: long, submit: true }), { type: 'type', handle: 'h1', text: 'u'.repeat(200), submit: true });
  assert.deepEqual(sanitizeActionForLog({ type: 'find', role: null, limit: 10 }), { type: 'find', role: null, limit: 10 });
});

test('the output bound cuts page text first, then drops links and forms, then the screenshot, and says so in usage', () => {
  const base = {
    ok: true, implementation: 'chromium.local', steps: [{ index: 0, type: 'read', outcome: 'ok' }],
    page: { url: 'https://example.com/', title: 't', text: 'x'.repeat(50_000), links: Array.from({ length: 60 }, (_, i) => ({ text: `l${i}`, href: `https://example.com/${i}` })), forms: [{ action: '/f', method: 'get', fields: [] }] },
    screenshot: { base64: 'A'.repeat(40_000), width: 1280, height: 800, bytes: 30_000, type: 'image/jpeg' },
    usage: { steps: 1, wall_ms: 10, navigations: 1, requests_blocked: 0 }
  };
  const untouched = boundBrowserOutput(base, 1_000_000);
  assert.equal(untouched.page.text.length, 50_000);
  assert.equal(untouched.usage.output_truncated, undefined);
  assert.ok(Number.isFinite(untouched.usage.output_bytes));

  const textCut = boundBrowserOutput(base, 60_000);
  assert.ok(textCut.page.text.length < 50_000 && textCut.page.text.length > 0, 'text is cut first');
  assert.equal(textCut.page.truncated, true);
  assert.ok(textCut.page.links.length === 60 && textCut.screenshot, 'links and the screenshot survive while the text alone can absorb the cut');
  assert.equal(textCut.usage.output_truncated, 'BROWSER_OUTPUT_TRUNCATED');
  assert.ok(Buffer.byteLength(JSON.stringify(textCut)) <= 60_000);

  const noLinks = boundBrowserOutput(base, 41_000);
  assert.equal(noLinks.page.links, undefined);
  assert.equal(noLinks.page.forms, undefined);
  assert.ok(noLinks.screenshot, 'the screenshot is the last thing dropped');
  assert.ok(Buffer.byteLength(JSON.stringify(noLinks)) <= 41_000);

  const bare = boundBrowserOutput(base, 2_000);
  assert.equal(bare.screenshot, undefined);
  assert.equal(bare.screenshot_error, 'BROWSER_OUTPUT_TRUNCATED');
  assert.equal(bare.page.text, '');
  assert.ok(Buffer.byteLength(JSON.stringify(bare)) <= 2_000);
  assert.deepEqual(base.page.links.length, 60, 'the input is never mutated');
  assert.equal(base.page.text.length, 50_000);
});
