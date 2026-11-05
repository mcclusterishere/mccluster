/* Owner-only Game Hub. A movable capsule shares the site music transport. */
import { validateModules, albumFor, parseHash, hashFor } from './modules.mjs';
import { createSharedMusic } from './shared-music.mjs';
import { mountCapsule } from './floating-capsule.mjs';

const $ = (s) => document.querySelector(s);
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROOT = new URL('../../', import.meta.url);
const LAST_KEY = 'mcc.gamehub.module.v1';

/* plain interface glyphs for courses without supplied artwork (a course icon, not a brand mark) */
const GLYPH = {
  ring: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z"/><circle cx="12" cy="12" r="4.1"/></svg>',
  flask: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6l-5.4 9.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9V3"/><path d="M7.4 15h9.2"/></svg>',
  atom: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20"/></svg>'
};
export function iconHtml(m) {
  if (m.icon.kind === 'image') return `<img src="${esc(new URL(m.icon.src, ROOT).href)}" alt="" width="${m.icon.width || 64}" height="${m.icon.height || 64}" decoding="async">`;
  return `<span class="gh-glyph">${GLYPH[m.icon.glyph] || GLYPH.book}</span>`;
}

const VIEWS = { 'chem108/molecule-rush': () => import('./chem108/game.mjs') };

async function boot() {
  // Course loading must not depend on the optional music catalogue.
  const response = await fetch(new URL('data/game-hub/modules.json', ROOT));
  if (!response.ok) throw new Error('Game Hub course list did not load');
  const doc = await response.json();
  const albumsPromise = fetch(new URL('data/albums.json', ROOT))
    .then((r) => { if (!r.ok) throw new Error('Music catalogue unavailable'); return r.json(); })
    .then((cat) => Array.isArray(cat.albums) ? cat.albums : [])
    .catch(() => null);
  const errors = validateModules(doc);
  if (errors.length) console.warn('Game Hub modules:', errors);
  const modules = doc.modules;
  const capsule = mountCapsule({ root: $('#ghCapsule'), workspace: $('#ghMain') });
  let musicSelection;
  const player = { setModule(...selection) { musicSelection = selection; } };
  // Optional music must not hold up the study interface on a slow/failed request.
  createSharedMusic({ root: $('#ghMusic') }).then(transport => {
    player.setModule = (...selection) => transport.setModule(...selection);
    if (musicSelection) player.setModule(...musicSelection);
  }).catch(() => {
    $('#ghCapsule').querySelectorAll('[data-hub-music-play], [data-music-next], [data-course-soundtrack]').forEach(b => { b.disabled = true; });
    $('[data-music-title]').textContent = 'Music unavailable';
    $('[data-music-status]').textContent = 'Music did not load. Games are still available.';
  });
  let current = null, view = null;
  const owner = true; // this module runs only behind the owner gate

  const nav = $('#ghModules');
  nav.innerHTML = modules.map((m) => `<button type="button" class="gh-mod" data-module="${esc(m.id)}" style="--accent:${esc(m.accent)}" aria-pressed="false" aria-label="${esc(m.label)}">${iconHtml(m)}<span>${esc(m.short)}</span></button>`).join('');
  nav.addEventListener('click', (e) => { const b = e.target.closest('[data-module]'); if (b) { capsule.collapse(true); select(b.dataset.module, null, true); } });
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const btns = [...nav.querySelectorAll('[data-module]')], i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length]; n.focus(); select(n.dataset.module, null, true);
  });

  function closeView() { if (view) { view.destroy(); view = null; } $('#ghPlay').hidden = true; $('#ghPanel').hidden = false; $('#ghMain').classList.remove('is-playing'); }
  function renderPanel(m) {
    const games = m.games.filter((g) => g.gate !== 'owner' || owner);
    $('#ghPanel').innerHTML = `
      <header class="gh-course">
        <span class="gh-course__icon">${iconHtml(m)}</span>
        <div><small>${esc(m.course)}</small><h2>${esc(m.label)}</h2><p>${esc(m.blurb)}</p></div>
      </header>
      <ul class="gh-games">${games.map((g) => `<li>
        ${g.kind === 'embedded'
          ? `<button type="button" class="gh-game" data-play="${esc(g.id)}">`
          : `<a class="gh-game" href="${esc(new URL(g.href, ROOT).href)}">`}
          <small>${esc(g.tag)}</small><b>${esc(g.title)}</b><span>${esc(g.blurb)}</span>
          <em>${g.kind === 'embedded' ? 'Play here · music keeps going' : 'Opens the page'}</em>
        ${g.kind === 'embedded' ? '</button>' : '</a>'}</li>`).join('')}</ul>`;
    $('#ghPanel').querySelectorAll('[data-play]').forEach((b) => { b.onclick = () => select(m.id, b.dataset.play, true); });
  }
  async function openGame(m, gameId) {
    const g = m.games.find((x) => x.id === gameId && x.kind === 'embedded');
    if (!g) return false;
    capsule.collapse();
    closeView();
    $('#ghPanel').hidden = true;
    const host = $('#ghPlay'); host.hidden = false; $('#ghMain').classList.add('is-playing'); scrollTo(0, 0);
    const mod = await VIEWS[g.view]();
    view = mod.mount(host, { onStart: () => capsule.collapse(), onExit: () => select(m.id, null, true) });
    return true;
  }
  async function select(id, play, user) {
    const m = modules.find((x) => x.id === id) || modules.find((x) => x.id === doc.default);
    if (current !== m) {
      current = m;
      document.documentElement.style.setProperty('--accent', m.accent);
      document.documentElement.dataset.module = m.id;
      nav.querySelectorAll('[data-module]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.module === m.id)));
      void albumsPromise.then((albums) => {
        if (current !== m) return;
        const album = albums ? albumFor(albums, m.music.album) : null;
        player.setModule(m, album || { slug: m.music.album, tracks: [] });
      });
      try { localStorage.setItem(LAST_KEY, m.id); } catch (e) { /* nothing kept */ }
    }
    history.replaceState(null, '', hashFor(m.id, play));
    if (play && await openGame(m, play)) return;
    closeView(); renderPanel(m);
    if (user) $('#ghMain').scrollTo?.({ top: 0 });
  }

  const want = parseHash(location.hash);
  let last = null; try { last = localStorage.getItem(LAST_KEY); } catch (e) { /* none */ }
  await select(want.module || last || doc.default, want.play, false);
  addEventListener('hashchange', () => { const h = parseHash(location.hash); select(h.module || current.id, h.play, false); });
}

boot().catch((e) => {
  const p = $('#ghPanel');
  if (p) p.innerHTML = '<p class="gh-error" role="alert">The Game Hub did not load. Refresh to try again.</p>';
  console.error(e);
});
