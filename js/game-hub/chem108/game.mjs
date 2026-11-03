/* Molecule Rush: the Chem 108 mini game, mounted inside the Game Hub page so the module's music keeps playing.
   Rules live in engine.mjs; the study content is Chem-108's own (data/, pinned in data/SOURCE.json). */
import { buildCatalog, MODES, modeTopics, pool, makeQuestion, newRound, answer, tick, nextItem, update, emptySave, recordRound, accuracy, multiplier, LIVES, ROUND_SECONDS } from './engine.mjs';

export const SAVE_KEY = 'mcc.gamehub.chem108.v1';
const HERE = new URL('./', import.meta.url);
let catalogPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}
export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = (globalThis.CHEM108_VENDORED ? Promise.resolve() : ['data/data.js', 'data/extra-data.js', 'expose.js']
      .reduce((p, f) => p.then(() => loadScript(new URL(f, HERE).href)), Promise.resolve()))
      .then(() => buildCatalog(globalThis.CHEM108_VENDORED.data, globalThis.CHEM108_VENDORED.extra))
      .catch((e) => { catalogPromise = null; throw e; });
  }
  return catalogPromise;
}

function readSave() {
  try { const x = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (x && x.v === 1 && x.best && x.topics && x.records) return x; } catch (e) { /* storage blocked */ }
  return emptySave();
}
function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* private mode: nothing kept */ } }

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function mount(host, { onExit } = {}) {
  let catalog = null, save = readSave(), mode = 'name-it', topic = 'all';
  let round = null, q = null, lastId = null, results = [], records = {}, locked = false, timer = 0, lastTick = 0, advance = 0;
  host.innerHTML = '<p class="mr-loading" role="status">Loading the Chem-108 deck…</p>';

  loadCatalog().then((c) => { catalog = c; setup(); }).catch(() => {
    host.innerHTML = '<div class="mr-card"><p>The Chem-108 deck did not load. Check the connection and try again.</p><button type="button" class="mr-btn" data-retry>Try again</button></div>';
    host.querySelector('[data-retry]').onclick = () => { document.removeEventListener('keydown', onKey); mount(host, { onExit }); };
  });

  function stopClock() { cancelAnimationFrame(timer); timer = 0; clearTimeout(advance); }
  function setup() {
    stopClock(); round = null;
    const topics = modeTopics(catalog, mode);
    if (topic !== 'all' && !topics.some((t) => t.id === topic)) topic = 'all';
    const best = save.best[mode] || 0;
    host.innerHTML = `
      <div class="mr-setup">
        <header class="mr-head">
          <button type="button" class="mr-back" data-exit aria-label="Back to Chem 108 games">‹ Games</button>
          <div><small>Chem 108 · Arcade</small><h2>Molecule Rush</h2></div>
        </header>
        <fieldset class="mr-modes"><legend>Mode</legend>
          ${Object.entries(MODES).map(([id, m]) => `<button type="button" class="mr-mode" data-mode="${id}" aria-pressed="${id === mode}"><b>${esc(m.title)}</b><span>${esc(m.blurb)}</span><small>${save.best[id] ? 'Best ' + save.best[id] : 'No score yet'}</small></button>`).join('')}
        </fieldset>
        <label class="mr-topic">Topic
          <select data-topic>
            <option value="all">All ${esc(MODES[mode].title)} topics</option>
            ${topics.map((t) => `<option value="${t.id}" ${t.id === topic ? 'selected' : ''}>${t.number} · ${esc(t.title)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="mr-btn mr-start" data-start>Start · ${ROUND_SECONDS} seconds · ${LIVES} lives</button>
        <p class="mr-rules">Every right answer in a row builds the streak: ×2 from three, up to ×5. A miss costs a life and resets it. Your misses come back at the end with the answer.</p>
        ${best ? `<p class="mr-best">Best in ${esc(MODES[mode].title)}: <b>${best}</b></p>` : ''}
        ${accuracyList(topics)}
      </div>`;
    host.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { mode = b.dataset.mode; setup(); host.querySelector(`[data-mode="${mode}"]`)?.focus(); }; });
    host.querySelector('[data-topic]').onchange = (e) => { topic = e.target.value; };
    host.querySelector('[data-start]').onclick = start;
    host.querySelector('[data-exit]').onclick = () => { stopClock(); onExit && onExit(); };
  }
  function accuracyList(topics) {
    const rows = topics.map((t) => ({ t, a: accuracy(save.topics[t.id]), n: save.topics[t.id]?.seen || 0 })).filter((r) => r.n);
    if (!rows.length) return '';
    return `<section class="mr-acc" aria-label="Accuracy by topic"><h3>Your accuracy</h3><ul>${rows.map((r) => `<li><span>${esc(r.t.title)}</span><i style="--p:${r.a}%" aria-hidden="true"></i><b>${r.a}%</b><small>${r.n}</small></li>`).join('')}</ul></section>`;
  }

  function start() {
    round = newRound({ mode, topic }); results = []; records = { ...save.records }; lastId = null;
    host.innerHTML = `
      <div class="mr-play">
        <div class="mr-hud">
          <span class="mr-score"><small>Score</small><b data-score>0</b></span>
          <span class="mr-streak" data-streak-wrap><small>Streak</small><b data-streak>0</b><em data-mult>×1</em></span>
          <span class="mr-lives" aria-label="Lives"><small>Lives</small><b data-lives></b></span>
          <button type="button" class="mr-quit" data-quit aria-label="End the round">End</button>
        </div>
        <div class="mr-time" role="timer" aria-label="Time left"><i data-time></i><span data-secs>${ROUND_SECONDS}</span></div>
        <div class="mr-q" data-q aria-live="polite"></div>
        <div class="mr-opts" data-opts role="group" aria-label="Answers"></div>
      </div>`;
    host.querySelector('[data-quit]').onclick = () => finish('quit');
    paintHud(); ask();
    host.scrollIntoView?.({ block: 'start' }); scrollTo(0, 0);
    lastTick = performance.now(); timer = requestAnimationFrame(loop);
  }
  function loop(now) {
    if (!round || round.over) return;
    const dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
    if (!document.hidden) round = tick(round, dt);
    const bar = host.querySelector('[data-time]'), secs = host.querySelector('[data-secs]');
    if (bar) bar.style.transform = `scaleX(${round.timeLeft / ROUND_SECONDS})`;
    if (secs) secs.textContent = Math.ceil(round.timeLeft);
    host.querySelector('.mr-time')?.classList.toggle('is-low', round.timeLeft <= 10);
    if (round.over) return finish('time');
    timer = requestAnimationFrame(loop);
  }
  function paintHud(flash) {
    const $ = (s) => host.querySelector(s);
    $('[data-score]').textContent = round.score;
    $('[data-streak]').textContent = round.streak;
    $('[data-mult]').textContent = '×' + multiplier(round.streak);
    $('[data-streak-wrap]').classList.toggle('is-hot', multiplier(round.streak) > 1);
    $('[data-lives]').textContent = '♥'.repeat(round.lives) + '♡'.repeat(LIVES - round.lives);
    $('[data-lives]').parentElement.setAttribute('aria-label', `Lives: ${round.lives} of ${LIVES}`);
    if (flash && !reduced()) { const el = $(flash); el.classList.remove('is-pop'); void el.offsetWidth; el.classList.add('is-pop'); }
  }
  function ask() {
    const items = pool(catalog, mode, topic);
    const item = nextItem(items, records, lastId);
    lastId = item.id;
    q = makeQuestion(catalog, mode, item);
    locked = false;
    const qEl = host.querySelector('[data-q]');
    const topicTitle = catalog.topic(q.deck)?.title || '';
    qEl.innerHTML = `<small class="mr-qtopic">${esc(topicTitle)}</small>
      ${q.svg ? `<figure class="mr-structure" role="img" aria-label="A molecular structure${q.formula ? ', formula ' + esc(q.formula) : ''}">${q.svg}</figure>` : ''}
      ${q.big ? `<p class="mr-big">${esc(q.big)}</p>` : ''}
      ${!q.svg && !q.big && q.symbol ? `<p class="mr-symbol" aria-hidden="true">${esc(q.symbol)}</p>` : ''}
      <p class="mr-prompt">${esc(q.prompt)}</p>`;
    const opts = host.querySelector('[data-opts]');
    opts.classList.toggle('is-short', q.options.every((o) => o.label.length <= 24));
    opts.innerHTML = q.options.map((o, i) => `<button type="button" class="mr-opt" data-i="${i}"><kbd>${i + 1}</kbd><span>${esc(o.label)}</span></button>`).join('');
    opts.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => pick(+b.dataset.i); });
  }
  function pick(i) {
    if (locked || !round || round.over) return;
    locked = true;
    const o = q.options[i];
    const r = answer(round, q, o.label);
    round = r.state;
    records[q.id] = update(records[q.id], r.ok);
    results.push({ id: q.id, deck: q.deck, ok: r.ok });
    const btns = host.querySelectorAll('[data-i]');
    btns.forEach((b, j) => { b.disabled = true; if (q.options[j].correct) b.classList.add('is-right'); else if (j === i) b.classList.add('is-wrong'); });
    paintHud(r.ok ? '.mr-score' : '.mr-lives');
    if (r.ok && !reduced()) {
      const p = document.createElement('span'); p.className = 'mr-points'; p.textContent = '+' + r.points; btns[i].appendChild(p);
    }
    if (round.over) { advance = setTimeout(() => finish('lives'), 700); return; }
    advance = setTimeout(ask, r.ok ? 350 : 1100);
  }
  function finish(reason) {
    if (!round) return;
    stopClock();
    if (!round.over) round = { ...round, over: true, reason };
    const { save: next, newBest } = recordRound(save, round, results, records);
    save = next; writeSave(save);
    const done = round; round = null;
    const why = done.reason === 'lives' ? 'Out of lives.' : done.reason === 'time' ? 'Time.' : 'Round ended.';
    host.innerHTML = `
      <div class="mr-end">
        <header class="mr-head"><div><small>${esc(MODES[done.mode].title)} · ${esc(why)}</small><h2>${done.score} points</h2></div></header>
        ${newBest ? '<p class="mr-newbest">New best score</p>' : `<p class="mr-best">Best: <b>${save.best[done.mode] || 0}</b></p>`}
        <dl class="mr-stats"><div><dt>Right</dt><dd>${done.correct} / ${done.answered}</dd></div><div><dt>Best streak</dt><dd>${done.bestStreak}</dd></div><div><dt>Lives left</dt><dd>${done.lives}</dd></div></dl>
        <div class="mr-actions"><button type="button" class="mr-btn" data-again>Play again</button><button type="button" class="mr-btn mr-btn--quiet" data-setup>Change mode</button></div>
        ${done.missed.length ? `<section class="mr-missed" aria-label="What you missed"><h3>What you missed</h3><ol>${done.missed.map(missCard).join('')}</ol></section>` : (done.answered ? '<p class="mr-clean">No misses this round.</p>' : '')}
      </div>`;
    host.querySelector('[data-again]').onclick = start;
    host.querySelector('[data-setup]').onclick = setup;
    host.querySelector('[data-again]').focus();
  }
  function missCard(m) {
    return `<li class="mr-miss">
      ${m.svg ? `<figure class="mr-structure mr-structure--sm" role="img" aria-label="The structure">${m.svg}</figure>` : m.big ? `<p class="mr-big mr-big--sm">${esc(m.big)}</p>` : ''}
      <div><p class="mr-miss__q">${esc(m.prompt)}</p>
      <p class="mr-miss__a">${esc(m.answer)}${m.formula ? ` <small>${esc(m.formula)}</small>` : ''}</p>
      ${m.aliases && m.aliases.length ? `<p class="mr-miss__alias">Also accepted: ${m.aliases.map(esc).join(', ')}</p>` : ''}
      <p class="mr-miss__you">You picked: ${esc(m.picked)}</p>
      ${m.explain ? `<p class="mr-miss__why">${esc(m.explain)}</p>` : ''}</div></li>`;
  }
  function onKey(e) {
    if (!round || locked || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4) { e.preventDefault(); pick(n - 1); }
  }
  document.addEventListener('keydown', onKey);
  return { destroy() { stopClock(); round = null; document.removeEventListener('keydown', onKey); host.innerHTML = ''; } };
}
