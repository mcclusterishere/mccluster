import {
  BOARD_SIZE, START, EXIT, STORE, MAX_TURNS, WALLS, SHOES, ORDERS,
  newSoleRun, policeTier, moveSole, equipSole, useSolePower, visitStore,
  newTeaRun, serveTea
} from './engine.mjs';

const $ = selector => document.querySelector(selector);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const ROOT = new URL('../../', import.meta.url);
const SAVE_KEY = 'here.city-arcade.best.v1';
let games = [], selected = null, run = null, recorded = false;

function readScores() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}
function recordResult() {
  if (!run || run.status === 'playing' || recorded || !selected) return;
  recorded = true;
  const scores = readScores(), previous = scores[selected.id];
  if (Number.isSafeInteger(previous) && previous >= run.score) return;
  scores[selected.id] = run.score;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(scores)); } catch { /* local storage optional */ }
}
function showGames() {
  const scores = readScores();
  $('#arcade-list').innerHTML = games.map(g => {
    const active = selected?.id === g.id, available = g.status === 'playable';
    const best = Number.isSafeInteger(scores[g.id]) ? 'Best ' + scores[g.id] : g.length;
    return '<button type="button" class="game-card" data-game="' + esc(g.id) + '"' +
      ' aria-pressed="' + String(active) + '"' + (available ? '' : ' disabled') + '>' +
      '<small>' + (available ? 'PLAY NOW' : 'COMING LATER') + ' · ' + esc(g.scope) + '</small>' +
      '<strong>' + esc(g.title) + '</strong><span>' + esc(g.blurb) + '</span>' +
      '<div class="game-meta"><span>' + esc(g.genre) + '</span><span>' + esc(best) + '</span></div></button>';
  }).join('');
}
function selectGame(id) {
  const game = games.find(g => g.id === id && g.status === 'playable');
  if (!game) return;
  selected = game;
  run = id === 'designer-kicks-sole-run' ? newSoleRun() : newTeaRun();
  recorded = false;
  const url = new URL(location.href);
  url.searchParams.set('game', game.id);
  history.replaceState(null, '', url);
  showGames();
  render();
}
function finishStep(next) {
  run = next;
  recordResult();
  showGames();
  render();
}
function renderSole() {
  const active = run.status === 'playing';
  const shoeIcons = new Map(SHOES.filter(s => !run.collected.includes(s.id)).map(s => [s.x + ',' + s.y, s.icon]));
  const blocks = new Set(WALLS.map(p => p.join(',')));
  const grid = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const p = { x, y }, key = x + ',' + y, isPlayer = run.player.x === x && run.player.y === y;
      const isPolice = run.police.x === x && run.police.y === y;
      const isExit = x === EXIT.x && y === EXIT.y, isStore = x === STORE.x && y === STORE.y;
      const isWall = blocks.has(key);
      const classes = ['tile', isWall ? 'wall' : '', isExit ? 'exit' : '',
        isStore ? 'store' : '', shoeIcons.has(key) ? 'shoe' : '',
        isPolice ? 'police' : '', isPlayer ? 'player' : ''].filter(Boolean).join(' ');
      const label = 'Row ' + (y + 1) + ', column ' + (x + 1) + ': ' +
        (isPlayer ? 'player' : isPolice ? 'police' : isWall ? 'blocked building' :
          isExit ? 'collection exit' : isStore ? 'storefront' :
            shoeIcons.has(key) ? 'uncollected shoe' : 'clear street');
      const glyph = isPlayer ? '●' : isPolice ? '✥' : isWall ? '▨' :
        shoeIcons.get(key) || (isStore ? '▣' : isExit ? '⌂' : '·');
      grid.push('<div class="' + classes + '" role="gridcell" aria-label="' + esc(label) + '">' +
        '<span aria-hidden="true">' + glyph + '</span></div>');
    }
  }
  const canStore = run.player.x === STORE.x && run.player.y === STORE.y;
  $('#arcade-play').innerHTML = `
    <div class="mini-badge">Designer Kicks / shoe collector</div>
    <h2 id="play-title">Sole Run</h2>
    <p class="muted">Collect four unique pairs and reach the ⌂ exit in ${MAX_TURNS} turns. Move using the arrows, WASD, or touch controls. A store challenge is legal; a risky grab draws police heat.</p>
    <div class="run-hud">
      <div class="stat"><small>Collection</small><b>${run.collected.length}/${SHOES.length}</b></div>
      <div class="stat"><small>Score</small><b>${run.score}</b></div>
      <div class="stat"><small>Turns left</small><b>${MAX_TURNS - run.turn}</b></div>
      <div class="stat"><small>Police response</small><b>${esc(policeTier(run.heat))}</b></div>
      <div class="stat"><small>Heat</small><b>${run.heat}/10</b></div>
      <div class="stat"><small>Fines / detentions</small><b>${run.fines} / ${run.detentions}</b></div>
    </div>
    <p class="message" role="status">${esc(run.message)}</p>
    <div class="arcade-grid" role="grid" aria-label="Seven-by-seven city block board">${grid.join('')}</div>
    <div class="legend" aria-label="Map legend"><span>● You</span><span>✥ Police</span><span>◆ Shoe</span><span>⌂ Exit</span><span>▣ Store</span><span>▨ Blocked</span></div>
    <div class="pad" aria-label="Movement">
      <button type="button" class="n" data-dir="north" aria-label="Move north" ${active ? '' : 'disabled'}>↑</button>
      <button type="button" class="w" data-dir="west" aria-label="Move west" ${active ? '' : 'disabled'}>←</button>
      <button type="button" class="s" data-dir="south" aria-label="Move south" ${active ? '' : 'disabled'}>↓</button>
      <button type="button" class="e" data-dir="east" aria-label="Move east" ${active ? '' : 'disabled'}>→</button>
    </div>
    <h3>Collection and powers</h3>
    <div class="shoe-list">${SHOES.map(shoe =>
      '<button type="button" class="shoe-btn" data-equip="' + shoe.id + '"' +
      ' aria-pressed="' + (run.equipped === shoe.id) + '"' +
      (active && run.collected.includes(shoe.id) ? '' : ' disabled') + '>' +
      shoe.icon + ' <strong>' + esc(shoe.name) + '</strong><br>' +
      '<small>' + esc(shoe.ability) + '</small></button>').join('')}</div>
    <div class="actions">
      <button class="action primary" type="button" data-power ${active ? '' : 'disabled'}>Use equipped power${run.equipped && run.cooldowns[run.equipped] ? ' (' + run.cooldowns[run.equipped] + ')' : ''}</button>
      <button class="action" type="button" data-store="challenge" ${active && canStore && !run.storeAttempts.includes('challenge') ? '' : 'disabled'}>Play store challenge</button>
      <button class="action" type="button" data-store="crime" ${active && canStore && !run.storeAttempts.includes('crime') ? '' : 'disabled'}>Risky grab (+police heat)</button>
      <button class="action" type="button" data-restart>Restart</button>
    </div>
    ${active ? '' : '<p class="gameover" role="status">' + esc(run.status === 'won' ? 'You won!' : 'Run ended.') + '</p>'}
    <p class="muted">Best scores are saved on this device.</p>`;
}
function renderTea() {
  const order = ORDERS[run.index];
  $('#arcade-play').innerHTML = `
    <div class="mini-badge">GAURANFUCKING TEA / store arcade</div>
    <h2 id="play-title">Tea Rush</h2>
    <p class="muted">Take five quick orders. A correct blend builds your score and streak.</p>
    <div class="run-hud">
      <div class="stat"><small>Order</small><b>${Math.min(ORDERS.length, run.index + 1)}/${ORDERS.length}</b></div>
      <div class="stat"><small>Score</small><b>${run.score}</b></div>
      <div class="stat"><small>Streak</small><b>${run.streak}</b></div>
    </div>
    <p class="message" role="status">${esc(run.message)}</p>
    ${order ? '<h3>' + esc(order.customer) + ' wants ' + esc(order.wants) + ' tea</h3>' +
      '<div class="options">' + order.options.map(choice =>
        '<button class="option" type="button" data-tea="' + esc(choice) + '">' + esc(choice) + '</button>').join('') +
      '</div>' : '<p class="gameover">Round complete! ' + run.correct + ' of ' + ORDERS.length +
      ' customers served correctly.</p>'}
    <div class="actions"><button class="action primary" type="button" data-restart>New round</button></div>
    <p class="muted">One minute, five customers. Best scores are saved on this device.</p>`;
}
function render() {
  if (!selected || !run) return;
  if (selected.id === 'designer-kicks-sole-run') renderSole(); else renderTea();
}
$('#arcade-list').addEventListener('click', event => {
  const el = event.target.closest('[data-game]');
  if (el) selectGame(el.dataset.game);
});
$('#arcade-play').addEventListener('click', event => {
  const btn = event.target.closest('button');
  if (!btn || !selected || !run) return;
  if (btn.hasAttribute('data-restart')) return selectGame(selected.id);
  if (selected.id === 'designer-kicks-sole-run') {
    if (btn.dataset.dir) return finishStep(moveSole(run, btn.dataset.dir));
    if (btn.dataset.equip) return finishStep(equipSole(run, btn.dataset.equip));
    if (btn.hasAttribute('data-power')) return finishStep(useSolePower(run));
    if (btn.dataset.store) return finishStep(visitStore(run, btn.dataset.store));
  } else if (btn.dataset.tea) return finishStep(serveTea(run, btn.dataset.tea));
});
document.addEventListener('keydown', event => {
  if (selected?.id !== 'designer-kicks-sole-run' || !run || run.status !== 'playing') return;
  if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  const key = event.key.toLowerCase();
  const dir = { arrowup: 'north', w: 'north', arrowdown: 'south', s: 'south',
    arrowleft: 'west', a: 'west', arrowright: 'east', d: 'east' }[key];
  if (dir) { event.preventDefault(); finishStep(moveSole(run, dir)); }
});
async function boot() {
  const response = await fetch(new URL('data/city-arcade/catalog.v1.json', ROOT), { cache: 'no-cache' });
  if (!response.ok) throw new Error('Arcade catalog unavailable');
  const registry = await response.json();
  if (registry.schema !== 'here.city-arcade/v1' || !Array.isArray(registry.games)) throw new Error('Wrong arcade catalog schema');
  games = registry.games;
  const requested = new URLSearchParams(location.search).get('game');
  selectGame(games.find(g => g.id === requested && g.status === 'playable')?.id ||
    games.find(g => g.status === 'playable').id);
}
boot().catch(error => {
  $('#arcade-list').innerHTML = '<p role="alert">The games could not load. Refresh this page.</p>';
  console.error('City Arcade', error);
});
