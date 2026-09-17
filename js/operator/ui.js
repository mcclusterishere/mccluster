/* ============================================================
   SHARED OPERATOR PRIMITIVES.

   Every module composes from this file. The point is not tidiness: it
   is that "loading", "empty", "degraded" and "failed" must look and mean
   the same thing everywhere, or an operator cannot read the board at a
   glance. A module that invents its own empty state teaches the operator
   that empty means something different here, which is how a dead panel
   gets mistaken for a quiet one.

   Nothing in this file fetches. It renders Results (see api.js) and
   emits DOM.
   ============================================================ */

export const esc = (value) => {
  const node = document.createElement('i');
  node.textContent = value === null || value === undefined ? '' : String(value);
  return node.innerHTML;
};

export const el = (html) => {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
};

/* ---------- status semantics ----------
   One vocabulary. Backends disagree about wording — `done`, `ok`,
   `ACTIVE_HEALTHY`, `executed`, `succeeded` all mean the same thing to
   an operator — so normalize once, here, and never branch on raw
   strings in a module. */
const STATUS_MAP = {
  ok: 'ok', up: 'ok', done: 'ok', active: 'ok', healthy: 'ok', executed: 'ok',
  succeeded: 'ok', success: 'ok', completed: 'ok', ready: 'ok', online: 'ok',
  active_healthy: 'ok', passed: 'ok', true: 'ok', approved: 'ok', published: 'ok',

  running: 'busy', in_progress: 'busy', working: 'busy', processing: 'busy',
  claimed: 'busy', uploading: 'busy',

  queued: 'pending', pending: 'pending', waiting: 'pending', scheduled: 'pending',
  draft: 'pending', todo: 'pending', requested: 'pending',

  degraded: 'warn', partial: 'warn', stale: 'warn', warning: 'warn', warn: 'warn',
  unknown: 'warn', unavailable: 'warn', paused: 'warn', throttled: 'warn',

  failed: 'bad', error: 'bad', down: 'bad', denied: 'bad', invalid: 'bad',
  cancelled: 'bad', canceled: 'bad', expired: 'bad', rejected: 'bad', false: 'bad',

  autonomous: 'ai', assistant: 'ai', model: 'ai', agent: 'ai'
};

export function tone(status) {
  if (status === true) return 'ok';
  if (status === false) return 'bad';
  const key = String(status ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_MAP[key] || 'idle';
}

export function pill(status, label) {
  const text = label ?? (status === true ? 'yes' : status === false ? 'no' : String(status ?? '—'));
  return `<span class="op-pill op-pill--${tone(status)}">${esc(text)}</span>`;
}

export function dot(status, title = '') {
  return `<i class="op-dot op-dot--${tone(status)}"${title ? ` title="${esc(title)}"` : ''}></i>`;
}

/* ---------- time ---------- */
export function ago(value) {
  if (!value) return '—';
  const then = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  const future = seconds < 0;
  const n = Math.abs(seconds);
  const unit =
    n < 60 ? `${n}s` :
    n < 3600 ? `${Math.round(n / 60)}m` :
    n < 86_400 ? `${Math.round(n / 3600)}h` :
    `${Math.round(n / 86_400)}d`;
  return future ? `in ${unit}` : `${unit} ago`;
}

export function stamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').slice(0, 19) : '—';
}

export function duration(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function count(value) {
  return value === null || value === undefined ? '—' : Number(value).toLocaleString();
}

/* ---------- the four states every panel can be in ---------- */

export function loading(label = 'Reading…') {
  return `<div class="op-state op-state--loading"><span class="op-spin"></span>${esc(label)}</div>`;
}

export function empty(label = 'Nothing here.', hint = '') {
  return `<div class="op-state op-state--empty"><b>${esc(label)}</b>${hint ? `<span>${esc(hint)}</span>` : ''}</div>`;
}

/* A failed read. Never collapses into `empty`: the operator must be able
   to tell "there is nothing" from "I could not look". */
export function failure(result, { retry } = {}) {
  const auth = result?.auth;
  const code = result?.code ? ` · ${result.code}` : '';
  const status = result?.status ? `HTTP ${result.status}` : 'no response';
  return `
    <div class="op-state op-state--error">
      <b>${esc(auth ? 'Not authorized' : 'Could not read this')}</b>
      <span>${esc(result?.message || 'Unknown failure')}</span>
      <code>${esc(status)}${esc(code)}</code>
      ${auth ? '<span class="op-state__hint">This surface needs a McCluster house-owner session.</span>' : ''}
      ${retry ? `<button class="op-btn op-btn--sm" data-retry="${esc(retry)}">Retry</button>` : ''}
    </div>`;
}

/* Some data arrived and some did not. Distinct from both empty and
   failure, because the numbers on screen are real but incomplete —
   and an operator making a decision needs to know which. */
export function degraded(names, extra = '') {
  if (!names || !names.length) return '';
  return `
    <div class="op-degraded">
      ${dot('warn')} Partial data — these did not answer: <b>${esc(names.join(', '))}</b>.
      Treat them as unknown, not empty.${extra ? ` ${esc(extra)}` : ''}
    </div>`;
}

/* ---------- table ----------
   columns: [{ key, label, width, align, render(row), className }]
   Selection stays in-page: the row click hands the row to onSelect,
   which by convention opens the inspector rather than navigating. */
export function table(columns, rows, options = {}) {
  const { onSelect, selectedId, idKey = 'id', emptyLabel = 'No rows.', emptyHint = '' } = options;
  if (!rows || !rows.length) return empty(emptyLabel, emptyHint);

  const head = columns.map((column) =>
    `<th${column.width ? ` style="width:${column.width}"` : ''}${column.align ? ` class="op-t--${column.align}"` : ''}>${esc(column.label)}</th>`
  ).join('');

  const body = rows.map((row, index) => {
    const id = row?.[idKey] ?? index;
    const selected = selectedId !== undefined && String(selectedId) === String(id);
    const cells = columns.map((column) => {
      const value = column.render ? column.render(row) : esc(row?.[column.key] ?? '—');
      const classes = [column.align ? `op-t--${column.align}` : '', column.className || ''].filter(Boolean).join(' ');
      return `<td${classes ? ` class="${classes}"` : ''}>${value}</td>`;
    }).join('');
    return `<tr data-row="${esc(id)}" class="${selected ? 'is-selected' : ''}${onSelect ? ' is-clickable' : ''}">${cells}</tr>`;
  }).join('');

  return `<div class="op-tablewrap"><table class="op-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* Wires row clicks after a table is injected. Kept separate so a module
   can re-render markup without re-binding by hand. */
export function bindTable(root, rows, onSelect, idKey = 'id') {
  root.querySelectorAll('tr[data-row]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const id = tr.getAttribute('data-row');
      const row = rows.find((candidate, index) => String(candidate?.[idKey] ?? index) === id);
      if (row) onSelect(row);
    });
  });
}

/* ---------- inspector drawer ----------
   The console's main interaction: a selected row stays in context and
   detail slides in beside it. Full navigation is reserved for workflows
   that genuinely change task. */
let drawerEl = null;

export function drawer({ title, subtitle, body, actions = [] }) {
  if (!drawerEl) {
    drawerEl = el('<aside class="op-drawer" hidden><div class="op-drawer__inner"></div></aside>');
    document.body.appendChild(drawerEl);
    drawerEl.addEventListener('click', (event) => {
      if (event.target === drawerEl) closeDrawer();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !drawerEl.hidden) closeDrawer();
    });
  }
  const inner = drawerEl.querySelector('.op-drawer__inner');
  inner.innerHTML = `
    <header class="op-drawer__head">
      <div>
        <h2>${esc(title)}</h2>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
      <button class="op-btn op-btn--ghost" data-close>Close</button>
    </header>
    ${actions.length ? `<div class="op-drawer__actions">${actions.join('')}</div>` : ''}
    <div class="op-drawer__body">${body}</div>`;
  inner.querySelector('[data-close]').addEventListener('click', closeDrawer);
  drawerEl.hidden = false;
  document.body.classList.add('op-drawer-open');
  return inner;
}

export function closeDrawer() {
  if (drawerEl) drawerEl.hidden = true;
  document.body.classList.remove('op-drawer-open');
}

/* ---------- field list, for inspectors ---------- */
export function fields(pairs) {
  const rows = pairs
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `<div class="op-field"><dt>${esc(label)}</dt><dd>${value ?? '—'}</dd></div>`)
    .join('');
  return `<dl class="op-fields">${rows}</dl>`;
}

/* Raw payload, always available but never the default view. An operator
   reads the human presentation; a debugging operator opens this. */
export function raw(value, label = 'Raw payload') {
  return `
    <details class="op-raw">
      <summary>${esc(label)}</summary>
      <pre>${esc(JSON.stringify(value, null, 2))}</pre>
    </details>`;
}

/* ---------- activity timeline ---------- */
export function timeline(events, { emptyLabel = 'No activity in the window read.' } = {}) {
  if (!events || !events.length) return empty(emptyLabel);
  return `<ol class="op-timeline">${events.map((event) => `
    <li class="op-timeline__item">
      ${dot(event.status || 'idle')}
      <div>
        <p class="op-timeline__title">${esc(event.title)}</p>
        ${event.detail ? `<p class="op-timeline__detail">${esc(event.detail)}</p>` : ''}
      </div>
      <time title="${esc(stamp(event.at))}">${esc(ago(event.at))}</time>
    </li>`).join('')}</ol>`;
}

/* ---------- section scaffolding ---------- */
export function panel({ title, meta = '', body, actions = '', span = '' }) {
  return `
    <section class="op-panel${span ? ` op-panel--${span}` : ''}">
      <header class="op-panel__head">
        <h2>${esc(title)}</h2>
        ${meta ? `<span class="op-panel__meta">${meta}</span>` : ''}
        ${actions ? `<div class="op-panel__actions">${actions}</div>` : ''}
      </header>
      <div class="op-panel__body">${body}</div>
    </section>`;
}

export function metric(label, value, { sub = '', status } = {}) {
  return `
    <div class="op-metric">
      <p class="op-metric__label">${status !== undefined ? dot(status) : ''}${esc(label)}</p>
      <p class="op-metric__value">${esc(value)}</p>
      ${sub ? `<p class="op-metric__sub">${esc(sub)}</p>` : ''}
    </div>`;
}

/* ---------- honest buttons ----------
   Zero fake functionality: a control either performs a real backend
   action, or it is disabled and says exactly why. There is no third
   option and no optimistic success. */
export function button(label, { action, variant = '', disabled = '', size = '' } = {}) {
  const classes = ['op-btn', variant && `op-btn--${variant}`, size && `op-btn--${size}`].filter(Boolean).join(' ');
  if (disabled) {
    return `<button class="${classes}" disabled title="${esc(disabled)}">${esc(label)}</button>`;
  }
  return `<button class="${classes}" data-action="${esc(action)}">${esc(label)}</button>`;
}

export function unsupported(label, reason) {
  return `<span class="op-unsupported" title="${esc(reason)}">${esc(label)} · not supported by the backend</span>`;
}

/* ---------- toast ---------- */
let toastHost = null;
export function toast(message, kind = 'ok') {
  if (!toastHost) {
    toastHost = el('<div class="op-toasts"></div>');
    document.body.appendChild(toastHost);
  }
  const node = el(`<div class="op-toast op-toast--${kind}">${esc(message)}</div>`);
  toastHost.appendChild(node);
  setTimeout(() => { node.classList.add('is-out'); setTimeout(() => node.remove(), 300); }, 4200);
}

/* ---------- error boundary ----------
   A module that throws must not take the shell with it. */
export function boundary(render, label) {
  try {
    return render();
  } catch (error) {
    console.error(`[operator] ${label} failed to render`, error);
    return `
      <div class="op-state op-state--error">
        <b>${esc(label)} could not render</b>
        <span>${esc(error?.message || String(error))}</span>
        <code>This is a console bug, not a backend failure.</code>
      </div>`;
  }
}
