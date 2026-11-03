/* PRIM3 World: the stationed agent's news desk in each country card (owner, 2026-11-03: "show briefs on each
   country's card on the world globe").

   The 24 agents read their country's headlines on the OVH box (McCluster Core, executor prim3_agent_news) and write
   one reaction per story plus a regional brief every 4 hours. This module asks the owner-only Worker route
   GET https://api.mccluster.org/v1/prim3/news-desk?country=XX with the signed-in session and fills the card's
   <section id="pwNews"> above the "News → mission" placeholder. Reactions are fiction voiced by McCluster about
   real headlines; each headline links out to its publisher. Nothing is cached in the browser. */
import { onCountryCard } from './hooks.mjs';
import { API_ORIGIN, storedToken } from './owner-gate.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHOWN = 8;

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
function safeUrl(u) { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } }

export function deskHtml(data, { name, now = Date.now() } = {}) {
  const brief = data && data.brief;
  const comments = Array.isArray(data && data.comments) ? data.comments : [];
  if (!brief && !comments.length) return `<p class="pw-empty">The agent in ${esc(name)} has not filed from the news desk yet. Briefs arrive every few hours.</p>`;
  const list = comments.slice(0, SHOWN).map((c) => {
    const url = safeUrl(c.url);
    const head = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(c.headline)}</a>` : esc(c.headline);
    return `<li class="pw-desk-item"><small>${head}</small><span>${esc(c.comment)}</span></li>`;
  }).join('');
  return `${brief ? `<p class="pw-desk-brief">${esc(brief.text)}<small>Brief · ${esc(ago(brief.created_at, now))} · from ${Number(brief.headline_count) || 0} headlines</small></p>` : ''}
    ${list ? `<ul class="pw-desk-list" aria-label="Agent reactions">${list}</ul>` : ''}
    <p class="pw-note">Fiction voiced by McCluster about real headlines. Headlines link to their publishers.</p>`;
}

export async function loadDesk(country, { fetchImpl = globalThis.fetch, storage, timeoutMs = 8000 } = {}) {
  const token = storedToken(storage);
  if (!token) return { error: 'signed-out' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(`${API_ORIGIN}/v1/prim3/news-desk?country=${encodeURIComponent(country)}`, { headers: { authorization: 'Bearer ' + token }, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!r || !r.ok) return { error: r && (r.status === 401 || r.status === 403) ? 'not-owner' : 'unavailable' };
    return { data: await r.json() };
  } catch (e) { return { error: 'unavailable' }; } finally { if (timer) clearTimeout(timer); }
}

if (typeof document !== 'undefined') {
  onCountryCard((country, section, { name }) => {
    if (!section || country === 'US') return; // HQ: McCluster calls missions in; the desk covers the 24 stations
    const box = document.createElement('div');
    box.className = 'pw-desk';
    box.setAttribute('aria-live', 'polite');
    box.innerHTML = `<p class="pw-sub">News desk · agent's read</p><p class="pw-empty">Loading the agent's brief…</p>`;
    section.prepend(box);
    loadDesk(country).then(({ data, error }) => {
      if (!box.isConnected) return; // the card was redrawn
      box.innerHTML = `<p class="pw-sub">News desk · agent's read</p>` + (error ? `<p class="pw-empty">The news desk could not be reached. Try again shortly.</p>` : deskHtml(data, { name }));
    });
  });
}
