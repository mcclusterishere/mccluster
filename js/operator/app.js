/* ============================================================
   THE OPERATING SHELL.

   One authenticated shell, hash-routed, with every module mounted into
   the same frame. The fragmented mini-site experience it replaces made
   an operator re-authenticate and re-orient on every hop; here the
   navigation, identity, environment and health never leave the screen.

   Routing is by hash so the console remains a static file on GitHub
   Pages — no server rewrite, no build step, and every existing URL in
   the repository keeps working untouched.
   ============================================================ */

import { authToken, clearToken, endpoints } from './api.js';
import { boundary, dot, el, esc, toast } from './ui.js';

import missionControl from './modules/mission-control.js';
import core from './modules/core.js';
import comms from './modules/comms.js';
import studio from './modules/studio.js';
import social from './modules/social.js';
import crm from './modules/crm.js';
import sites from './modules/sites.js';
import backoffice from './modules/backoffice.js';
import whip from './modules/whip.js';
import spatial from './modules/spatial.js';
import prim3 from './modules/prim3.js';
import developer from './modules/developer.js';
import usage from './modules/usage.js';
import integrations from './modules/integrations.js';
import system from './modules/system.js';

/* Navigation is data, so the command palette and the sidebar cannot
   disagree about what exists. */
export const NAV = [
  { group: null, items: [{ id: 'mission', label: 'Mission Control', module: missionControl }] },
  { group: 'Operate', items: [
    { id: 'core', label: 'Core', module: core },
    { id: 'comms', label: 'Communications', module: comms },
    { id: 'crm', label: 'CRM', module: crm },
    { id: 'social', label: 'Social', module: social }
  ] },
  { group: 'Create', items: [{ id: 'studio', label: 'Studio', module: studio }] },
  { group: 'Business', items: [
    { id: 'sites', label: 'Sites & Clients', module: sites },
    { id: 'backoffice', label: 'Back Office', module: backoffice }
  ] },
  { group: 'Products', items: [
    { id: 'whip', label: 'Whip', module: whip },
    { id: 'spatial', label: 'Spatial', module: spatial },
    { id: 'prim3', label: 'PRIM3', module: prim3 }
  ] },
  { group: 'Platform', items: [
    { id: 'developer', label: 'Developer', module: developer },
    { id: 'usage', label: 'Usage & Billing', module: usage },
    { id: 'integrations', label: 'Integrations', module: integrations },
    { id: 'system', label: 'System', module: system }
  ] }
];

const ROUTES = new Map();
NAV.forEach((section) => section.items.forEach((item) => ROUTES.set(item.id, item)));

export const app = {
  route: 'mission',
  params: {},
  identity: null,
  health: { edge: null, checkedAt: null },
  go(id, params = {}) {
    const query = new URLSearchParams(params).toString();
    window.location.hash = `#/${id}${query ? `?${query}` : ''}`;
  }
};

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const id = ROUTES.has(path) ? path : 'mission';
  return { id, params: Object.fromEntries(new URLSearchParams(query || '')) };
}

/* ---------- chrome ---------- */

function renderNav() {
  return `
    <nav class="op-nav">
      <div class="op-nav__brand">
        <div>
          <b>McCluster</b><br>
          <small>Operator OS</small>
        </div>
      </div>
      ${NAV.map((section) => `
        <div class="op-nav__group">
          ${section.group ? `<p class="op-nav__label">${esc(section.group)}</p>` : ''}
          ${section.items.map((item) => `
            <a href="#/${item.id}" data-nav="${item.id}">${esc(item.label)}<span class="op-nav__badge" data-badge="${item.id}" hidden></span></a>
          `).join('')}
        </div>`).join('')}
    </nav>`;
}

function renderTop() {
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  return `
    <header class="op-top">
      <h1 data-title>Mission Control</h1>
      <div class="op-top__spacer"></div>
      <button class="op-cmd" data-open-palette>
        <span>Search or run…</span><kbd>⌘K</kbd>
      </button>
      <span class="op-env ${isLocal ? 'op-env--local' : 'op-env--prod'}" title="${esc(isLocal ? 'Local preview — still pointed at the production API' : 'Production')}">
        ${isLocal ? 'local → prod api' : 'production'}
      </span>
      <span class="op-who" data-health title="Edge health"></span>
      <span class="op-who" data-identity>—</span>
      <button class="op-btn op-btn--ghost op-btn--sm" data-signout>Sign out</button>
    </header>`;
}

/* ---------- auth gate ----------
   The console is house-owner territory. Rather than render a broken
   board full of 401s, it stops at the door and says so. */
function renderGate(reason) {
  return `
    <div class="op-gate">
      <h1>McCluster Operator OS</h1>
      <p>${esc(reason || 'Operator sign-in required.')}</p>
      <input class="op-input" id="opEmail" type="email" placeholder="Owner email" autocomplete="email">
      <input class="op-input" id="opPass" type="password" placeholder="Password" autocomplete="current-password">
      <button class="op-btn op-btn--primary" id="opIn" style="width:100%">Open the console</button>
      <p class="op-state__hint" id="opNote" style="margin-top:.6rem"></p>
    </div>`;
}

async function mountGate(root, reason) {
  root.innerHTML = renderGate(reason);
  const note = root.querySelector('#opNote');
  root.querySelector('#opIn').addEventListener('click', async () => {
    const email = root.querySelector('#opEmail').value.trim();
    const password = root.querySelector('#opPass').value;
    if (!email || !password) { note.textContent = 'Email and password required.'; return; }
    note.textContent = 'Signing in…';
    try {
      await window.MCC_AUTH.signInPassword(email, password);
      clearToken();
      boot();
    } catch (error) {
      note.textContent = error?.message || 'Sign-in failed.';
    }
  });
  root.querySelector('#opPass').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') root.querySelector('#opIn').click();
  });
}

/* ---------- command palette ---------- */

function paletteCommands() {
  const navCommands = [];
  NAV.forEach((section) => section.items.forEach((item) => {
    navCommands.push({
      label: item.label,
      hint: section.group || 'Go',
      run: () => app.go(item.id)
    });
  }));

  /* Deep links into a filtered view. Each one lands on a surface that
     really filters — nothing here pretends to run a query the backend
     cannot answer. */
  return navCommands.concat([
    { label: 'Open failed jobs', hint: 'Core', run: () => app.go('core', { tab: 'jobs', status: 'failed' }) },
    { label: 'Open queued jobs', hint: 'Core', run: () => app.go('core', { tab: 'jobs', status: 'queued' }) },
    { label: 'Give Core a task', hint: 'Core', run: () => app.go('core', { tab: 'compose' }) },
    { label: 'Run host health', hint: 'Core', run: () => app.go('core', { tab: 'health', run: '1' }) },
    { label: 'Conversations waiting for owner', hint: 'Comms', run: () => app.go('comms', { queue: 'owner' }) },
    { label: 'Create a Studio job', hint: 'Studio', run: () => app.go('studio', { tab: 'generate' }) },
    { label: 'Compare models (bakeoff)', hint: 'Studio', run: () => app.go('studio', { tab: 'compare' }) },
    { label: 'Social publishing state', hint: 'Social', run: () => app.go('social', { tab: 'publishing' }) },
    { label: 'Find a client', hint: 'Business', run: () => app.go('sites') },
    { label: 'Edge & deploy fingerprint', hint: 'System', run: () => app.go('system') }
  ]);
}

function openPalette() {
  const commands = paletteCommands();
  const node = el(`
    <div class="op-palette">
      <div class="op-palette__box">
        <input type="text" placeholder="Search surfaces and actions…" autofocus>
        <ul class="op-palette__list"></ul>
      </div>
    </div>`);
  document.body.appendChild(node);

  const input = node.querySelector('input');
  const list = node.querySelector('.op-palette__list');
  let filtered = commands;
  let active = 0;

  const draw = () => {
    if (!filtered.length) { list.innerHTML = '<li class="op-palette__empty">No matching surface or action.</li>'; return; }
    list.innerHTML = filtered.map((command, index) =>
      `<li class="${index === active ? 'is-active' : ''}" data-i="${index}">${esc(command.label)}<small>${esc(command.hint)}</small></li>`
    ).join('');
    list.querySelectorAll('li[data-i]').forEach((li) => {
      li.addEventListener('click', () => choose(Number(li.getAttribute('data-i'))));
    });
  };
  const choose = (index) => {
    const command = filtered[index];
    close();
    if (command) command.run();
  };
  const close = () => node.remove();

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    filtered = query
      ? commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(query))
      : commands;
    active = 0;
    draw();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return close();
    if (event.key === 'ArrowDown') { active = Math.min(active + 1, filtered.length - 1); draw(); event.preventDefault(); }
    if (event.key === 'ArrowUp') { active = Math.max(active - 1, 0); draw(); event.preventDefault(); }
    if (event.key === 'Enter') choose(active);
  });
  node.addEventListener('click', (event) => { if (event.target === node) close(); });
  draw();
  input.focus();
}

/* ---------- render loop ---------- */

let currentAbort = null;

async function renderRoute() {
  const { id, params } = parseHash();
  app.route = id;
  app.params = params;

  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('is-active', link.getAttribute('data-nav') === id);
  });
  const entry = ROUTES.get(id);
  const title = document.querySelector('[data-title]');
  if (title) title.textContent = entry.label;

  const view = document.querySelector('.op-view');
  if (!view) return;

  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();
  const signal = currentAbort.signal;

  view.innerHTML = '<div class="op-state op-state--loading"><span class="op-spin"></span>Reading…</div>';
  try {
    await entry.module.mount(view, { app, params, signal });
  } catch (error) {
    if (signal.aborted) return;
    console.error(`[operator] ${id} crashed`, error);
    view.innerHTML = boundary(() => { throw error; }, entry.label);
  }
}

/* The shell's own health dot. One unauthenticated read, so it is honest
   even when the session is not. */
async function pollHealth() {
  const result = await endpoints.health();
  const node = document.querySelector('[data-health]');
  if (!node) return;
  app.health = { edge: result.ok, checkedAt: Date.now() };
  node.innerHTML = `${dot(result.ok ? 'ok' : 'bad')} ${esc(result.ok ? 'edge up' : 'edge down')}`;
}

export async function boot() {
  const root = document.getElementById('op-root');
  const token = await authToken({ force: true });
  if (!token) return mountGate(root, 'Operator sign-in required. This console reads house-owner surfaces.');

  root.innerHTML = `<div class="op-shell">${renderNav()}<main class="op-main">${renderTop()}<div class="op-view"></div></main></div>`;

  root.querySelector('[data-open-palette]').addEventListener('click', openPalette);
  root.querySelector('[data-signout]').addEventListener('click', async () => {
    try { await window.MCC_AUTH.signOut(); } catch { /* signing out locally is enough */ }
    clearToken();
    window.location.reload();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
    }
  });

  window.addEventListener('hashchange', renderRoute);

  /* Identity is read once. A 401/403 here means the session is real but
     not house-owner, which is worth saying plainly rather than letting
     every panel fail separately. */
  const me = await endpoints.me();
  const identity = root.querySelector('[data-identity]');
  if (me.ok) {
    app.identity = me.data?.user || null;
    identity.textContent = app.identity?.email || 'signed in';
  } else if (me.auth) {
    identity.innerHTML = `${dot('warn')} limited session`;
    toast('Signed in, but this session is not a McCluster house owner. Most surfaces will refuse.', 'warn');
  } else {
    identity.innerHTML = `${dot('bad')} identity unavailable`;
  }

  pollHealth();
  setInterval(pollHealth, 60_000);
  renderRoute();
}

document.addEventListener('DOMContentLoaded', boot);
