// The browser.act action vocabulary, validated and normalized before any
// browser work: fixed action types with bounded arguments, a handle grammar
// (h1..h999, minted per task by `find`), per-task step and time caps, the log
// sanitizer and the output bound. Pure; the executor and the Core tool share it.
export const BROWSER_ACTION_TYPES = Object.freeze(['open', 'read', 'find', 'click', 'type', 'select', 'scroll', 'wait', 'screenshot', 'back', 'done']);
export const BROWSER_TASK_LIMITS = Object.freeze({
  max_actions: 25,
  max_steps: 25,
  min_ms: 5_000,
  max_ms: 600_000,
  default_max_ms: 120_000,
  default_max_steps: 25,
  max_output_bytes: 1_400_000,
  default_max_output_bytes: 1_000_000,
  read_max_chars: 20_000,
  read_default_chars: 8_000,
  url_chars: 2_048,
  text_chars: 2_000,
  name_chars: 200,
  role_chars: 40,
  value_chars: 200,
  note_chars: 500,
  find_limit: 20,
  find_default_limit: 10,
  scroll_amount: 10,
  wait_ms_min: 100,
  wait_ms_max: 10_000,
  wait_for_timeout_min: 1_000,
  wait_for_timeout_max: 10_000,
  wait_for_default_timeout: 5_000,
  log_string_chars: 200
});
export const HANDLE = /^h[0-9]{1,3}$/;
const WAIT_FOR = new Set(['load', 'networkidle']);
const SCROLL = new Set(['down', 'up']);

function refuse(code, message) {
  return Object.assign(new Error(message), { status: 400, code, retryable: false });
}
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Math.floor(value))); }

export function browserLimitsFromEnv(env = process.env) {
  const number = (name, fallback, min, max) => {
    const n = Number(env[name]);
    return Number.isFinite(n) && n > 0 ? clamp(n, min, max) : fallback;
  };
  return {
    maxSteps: number('MCCLUSTER_BROWSER_MAX_STEPS', BROWSER_TASK_LIMITS.default_max_steps, 1, BROWSER_TASK_LIMITS.max_steps),
    maxMs: number('MCCLUSTER_BROWSER_MAX_MS', BROWSER_TASK_LIMITS.default_max_ms, BROWSER_TASK_LIMITS.min_ms, BROWSER_TASK_LIMITS.max_ms),
    maxOutputBytes: number('MCCLUSTER_BROWSER_MAX_OUTPUT_BYTES', BROWSER_TASK_LIMITS.default_max_output_bytes, 10_000, BROWSER_TASK_LIMITS.max_output_bytes)
  };
}

function onlyKeys(action, allowed, index) {
  for (const key of Object.keys(action)) {
    if (!allowed.includes(key)) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}] (${action.type}) does not take ${key}`);
  }
}
function optionalString(action, key, max, index) {
  const value = action[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].${key} must be a string of at most ${max} characters`);
  return value;
}
function requiredString(action, key, max, index, { allowEmpty = false } = {}) {
  const value = optionalString(action, key, max, index);
  if (value === null || (!allowEmpty && !value)) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].${key} is required`);
  return value;
}
function optionalBoolean(action, key, fallback, index) {
  const value = action[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].${key} must be a boolean`);
  return value;
}
function optionalInteger(action, key, fallback, min, max, index) {
  const value = action[key];
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].${key} must be an integer from ${min} to ${max}`);
  return value;
}
function handle(action, index) {
  const value = action.handle;
  if (typeof value !== 'string' || !HANDLE.test(value)) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].handle must be a handle like h1 returned by find`);
  return value;
}

function normalizeAction(action, index) {
  if (!record(action) || typeof action.type !== 'string') throw refuse('BROWSER_ACTION_INVALID', `actions[${index}] must be an object with a type`);
  const L = BROWSER_TASK_LIMITS;
  switch (action.type) {
    case 'open':
      onlyKeys(action, ['type', 'url'], index);
      return { type: 'open', url: requiredString(action, 'url', L.url_chars, index) };
    case 'read':
      onlyKeys(action, ['type', 'max_chars', 'links', 'forms'], index);
      return { type: 'read', max_chars: optionalInteger(action, 'max_chars', L.read_default_chars, 1, L.read_max_chars, index), links: optionalBoolean(action, 'links', true, index), forms: optionalBoolean(action, 'forms', true, index) };
    case 'find': {
      onlyKeys(action, ['type', 'role', 'name', 'text', 'exact', 'limit'], index);
      const role = optionalString(action, 'role', L.role_chars, index);
      const name = optionalString(action, 'name', L.name_chars, index);
      const text = optionalString(action, 'text', L.name_chars, index);
      if (role !== null && !/^[a-z]+$/.test(role)) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].role must be an ARIA role name`);
      if (!role && !text) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}] (find) needs a role (with an optional name) or a text`);
      if (!role && name) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}] (find) takes a name only together with a role`);
      return { type: 'find', role, name, text, exact: optionalBoolean(action, 'exact', false, index), limit: optionalInteger(action, 'limit', L.find_default_limit, 1, L.find_limit, index) };
    }
    case 'click':
      onlyKeys(action, ['type', 'handle'], index);
      return { type: 'click', handle: handle(action, index) };
    case 'type':
      onlyKeys(action, ['type', 'handle', 'text', 'submit'], index);
      return { type: 'type', handle: handle(action, index), text: requiredString(action, 'text', L.text_chars, index, { allowEmpty: true }), submit: optionalBoolean(action, 'submit', false, index) };
    case 'select':
      onlyKeys(action, ['type', 'handle', 'value'], index);
      return { type: 'select', handle: handle(action, index), value: requiredString(action, 'value', L.value_chars, index) };
    case 'scroll':
      onlyKeys(action, ['type', 'direction', 'amount'], index);
      if (!SCROLL.has(action.direction)) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].direction must be down or up`);
      return { type: 'scroll', direction: action.direction, amount: optionalInteger(action, 'amount', 1, 1, L.scroll_amount, index) };
    case 'wait': {
      onlyKeys(action, ['type', 'ms', 'for', 'timeout_ms'], index);
      const hasMs = action.ms !== undefined;
      const hasFor = action.for !== undefined;
      if (hasMs === hasFor) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}] (wait) takes either ms or for`);
      if (hasMs) {
        if (action.timeout_ms !== undefined) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}] (wait) takes timeout_ms only with for`);
        return { type: 'wait', ms: optionalInteger(action, 'ms', null, L.wait_ms_min, L.wait_ms_max, index) };
      }
      if (!WAIT_FOR.has(action.for)) throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].for must be load or networkidle`);
      return { type: 'wait', for: action.for, timeout_ms: optionalInteger(action, 'timeout_ms', L.wait_for_default_timeout, L.wait_for_timeout_min, L.wait_for_timeout_max, index) };
    }
    case 'screenshot':
      onlyKeys(action, ['type'], index);
      return { type: 'screenshot' };
    case 'back':
      onlyKeys(action, ['type'], index);
      return { type: 'back' };
    case 'done':
      onlyKeys(action, ['type', 'note'], index);
      return { type: 'done', note: optionalString(action, 'note', L.note_chars, index) };
    default:
      throw refuse('BROWSER_ACTION_INVALID', `actions[${index}].type ${String(action.type).slice(0, 40)} is not a browser action`);
  }
}

// Returns the normalized task {actions, max_steps, max_ms, screenshot_on_done}
// or throws BROWSER_INPUT_INVALID (the envelope), BROWSER_TOO_MANY_STEPS (the
// batch or the step cap) or BROWSER_ACTION_INVALID (one action).
export function validateBrowserTask(input, limits = browserLimitsFromEnv({})) {
  if (!record(input)) throw refuse('BROWSER_INPUT_INVALID', 'the browser task must be an object with actions[]');
  for (const key of Object.keys(input)) {
    if (!['actions', 'max_steps', 'max_ms', 'screenshot_on_done'].includes(key)) throw refuse('BROWSER_INPUT_INVALID', `unexpected field ${key}`);
  }
  if (!Array.isArray(input.actions) || !input.actions.length) throw refuse('BROWSER_INPUT_INVALID', 'actions must be a non-empty array');
  if (input.actions.length > BROWSER_TASK_LIMITS.max_actions) throw refuse('BROWSER_TOO_MANY_STEPS', `at most ${BROWSER_TASK_LIMITS.max_actions} actions per task`);
  const stepCeiling = clamp(Number(limits?.maxSteps) || BROWSER_TASK_LIMITS.default_max_steps, 1, BROWSER_TASK_LIMITS.max_steps);
  let maxSteps = stepCeiling;
  if (input.max_steps !== undefined) {
    if (!Number.isFinite(Number(input.max_steps)) || typeof input.max_steps !== 'number') throw refuse('BROWSER_INPUT_INVALID', 'max_steps must be a number');
    maxSteps = clamp(input.max_steps, 1, stepCeiling);
  }
  let maxMs = clamp(Number(limits?.maxMs) || BROWSER_TASK_LIMITS.default_max_ms, BROWSER_TASK_LIMITS.min_ms, BROWSER_TASK_LIMITS.max_ms);
  if (input.max_ms !== undefined) {
    if (!Number.isFinite(Number(input.max_ms)) || typeof input.max_ms !== 'number') throw refuse('BROWSER_INPUT_INVALID', 'max_ms must be a number');
    maxMs = clamp(input.max_ms, BROWSER_TASK_LIMITS.min_ms, BROWSER_TASK_LIMITS.max_ms);
  }
  if (input.screenshot_on_done !== undefined && typeof input.screenshot_on_done !== 'boolean') throw refuse('BROWSER_INPUT_INVALID', 'screenshot_on_done must be a boolean');
  if (input.actions.length > maxSteps) throw refuse('BROWSER_TOO_MANY_STEPS', `${input.actions.length} actions exceed max_steps ${maxSteps}`);
  return {
    actions: input.actions.map(normalizeAction),
    max_steps: maxSteps,
    max_ms: maxMs,
    screenshot_on_done: input.screenshot_on_done !== false
  };
}

export function sanitizeActionForLog(action) {
  const out = {};
  for (const [key, value] of Object.entries(action || {})) {
    out[key] = typeof value === 'string' ? value.slice(0, BROWSER_TASK_LIMITS.log_string_chars) : value;
  }
  return out;
}

const byteSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

// Keep a task output under maxBytes: cut page text first, then drop links and
// forms, then omit the screenshot; usage says so. Never mutates the input.
export function boundBrowserOutput(output, maxBytes) {
  const result = JSON.parse(JSON.stringify(output ?? {}));
  const limit = Math.max(1000, Number(maxBytes) || BROWSER_TASK_LIMITS.default_max_output_bytes);
  // The byte count is part of the output, so it is measured with a placeholder
  // of the widest value already in place.
  result.usage = { ...(result.usage || {}), output_bytes: limit };
  if (byteSize(result) <= limit) {
    result.usage.output_bytes = byteSize(result);
    return result;
  }
  result.usage.output_truncated = 'BROWSER_OUTPUT_TRUNCATED';
  if (result.page && typeof result.page.text === 'string') {
    let guard = 0;
    while (byteSize(result) > limit && result.page.text.length > 0 && guard < 64) {
      const over = byteSize(result) - limit;
      result.page.text = result.page.text.slice(0, Math.max(0, result.page.text.length - Math.max(1, over)));
      result.page.truncated = true;
      guard += 1;
    }
  }
  if (byteSize(result) > limit && result.page) {
    delete result.page.links;
    delete result.page.forms;
  }
  if (byteSize(result) > limit && result.screenshot) {
    delete result.screenshot;
    result.screenshot_error = 'BROWSER_OUTPUT_TRUNCATED';
  }
  if (byteSize(result) > limit && result.page && typeof result.page.text === 'string') {
    result.page.text = '';
    result.page.truncated = true;
  }
  result.usage.output_bytes = byteSize(result);
  return result;
}
