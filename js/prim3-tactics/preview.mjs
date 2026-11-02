/* PRIM3 tactical hints — preview (review branch only; not public canon).
   Normal play: pick a squad member, tap a lit tile to move (1 AP), End turn. No problem to solve.
   Optional: "Get a hint" for the selected unit → a field challenge → a correct answer shows a
   suggested tile and why. The hint never moves the unit or spends AP.
   In production the challenge's answer stays on the server; this preview keeps the session in the
   page so the flow can be tried offline. */
import { createState, beginPlayerPhase, beginThreatPhase, resolveClockStatePhase, moveUnit, gridDistance } from './tactical-resolver.mjs';
import { openHint, answerHint, revealAnswer, playerProjection } from './tactical-hints.mjs';

const BIND = { tenantId: 'preview', playerId: 'you', missionId: 'TR02-PREVIEW' };
const W = 10, H = 10;

function fresh() {
  return beginPlayerPhase(createState({
    width: W, height: H, floors: 1,
    units: [
      { id: 'E1', faction: 'PLAYER', role: 'E', x: 1, y: 2, moveRange: 4, detectionRadius: 6, aim: 75 },
      { id: 'R1', faction: 'PLAYER', role: 'R', x: 0, y: 4, moveRange: 5, detectionRadius: 7, aim: 70 },
      { id: 'T1', faction: 'PLAYER', role: 'T', x: 1, y: 5, moveRange: 4, detectionRadius: 5, aim: 65 },
      { id: 'H1', faction: 'THREAT', x: 7, y: 2, aim: 70, detectionRadius: 3 },
      { id: 'H2', faction: 'THREAT', x: 9, y: 9, aim: 70, detectionRadius: 3 } // unseen: never drawn, never used by the hint
    ],
    cover: [
      { x: 4, y: 2, type: 'HIGH', sides: ['E'] }, { x: 4, y: 3, type: 'LOW', sides: ['E'] },
      { x: 3, y: 6, type: 'LOW', sides: ['E', 'N'] }, { x: 6, y: 5, type: 'HIGH', sides: ['N'] }
    ],
    blockers: [{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 8, y: 8 }, { x: 8, y: 9 }, { x: 9, y: 8 }],
    objectives: [{ id: 'NODE', required: true }],
    battlefield: { objectiveTiles: [{ id: 'NODE', x: 7, y: 6 }] }
  }));
}

let state = fresh(), selected = 'E1', session = null, suggestion = null;
const $ = (id) => document.getElementById(id);

function view() { return playerProjection(state); }

function render() {
  const p = view(), sel = p.units.find((u) => u.id === selected);
  const grid = $('tacGrid'); grid.innerHTML = '';
  const blocked = new Set(p.blockers.map((b) => `${b.x}:${b.y}`));
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tac-cell'; b.dataset.x = x; b.dataset.y = y;
    const unit = p.units.find((u) => u.x === x && u.y === y && !u.dead);
    const cover = p.cover.find((c) => c.x === x && c.y === y);
    const obj = p.objectiveTiles.find((t) => t.x === x && t.y === y);
    let label = `(${x}, ${y})`;
    if (blocked.has(`${x}:${y}`)) { b.classList.add('is-wall'); b.disabled = true; label += ' wall'; }
    if (cover) { b.classList.add(cover.type === 'HIGH' ? 'is-high' : 'is-low'); label += ` ${cover.type.toLowerCase()} cover facing ${cover.sides.join(', ')}`; }
    if (obj) { b.classList.add('is-obj'); b.textContent = '◎'; label += ' objective'; }
    if (unit) { b.textContent = unit.id; b.classList.add(unit.faction === 'PLAYER' ? 'is-ally' : 'is-hostile'); if (unit.id === selected) b.classList.add('is-sel'); label += ` ${unit.faction === 'PLAYER' ? 'squad' : 'known hostile'} ${unit.id}`; }
    else if (sel && sel.ap >= 1 && !blocked.has(`${x}:${y}`) && gridDistance(sel, { x, y, z: 0 }) <= sel.moveRange) { b.classList.add('is-reach'); label += ' reachable'; }
    if (suggestion && suggestion.x === x && suggestion.y === y) { b.classList.add('is-hint'); label += ' suggested'; }
    b.setAttribute('aria-label', label);
    grid.appendChild(b);
  }
  $('tacSquad').innerHTML = p.units.filter((u) => u.faction === 'PLAYER').map((u) =>
    `<button type="button" class="tac-unit${u.id === selected ? ' is-on' : ''}" data-unit="${u.id}" aria-pressed="${u.id === selected}">${u.id} · Field ${u.role} · ${u.ap} AP</button>`).join('');
  $('tacRound').textContent = `Round ${state.round} · ${state.phase === 'PLAYER' ? 'your move' : state.phase}`;
}

function say(html) { $('tacPanel').innerHTML = html; }

function onCell(e) {
  const b = e.target.closest('.tac-cell'); if (!b) return;
  const x = Number(b.dataset.x), y = Number(b.dataset.y);
  const ally = state.units.find((u) => u.faction === 'PLAYER' && u.x === x && u.y === y);
  if (ally) { selected = ally.id; session = null; suggestion = null; say(''); render(); return; }
  try {
    state = moveUnit(state, selected, { x, y, z: 0 }, 'MOVE');
    session = null; suggestion = null; say(`<p class="tac-msg">${selected} moved to (${x}, ${y}).</p>`);
  } catch (err) { say(`<p class="tac-msg is-bad">${err.message}.</p>`); }
  render();
}

function onHint() {
  try {
    const r = openHint(BIND, state, selected);
    session = r.session; suggestion = null;
    say(`<p class="tac-eyebrow">Hint for ${selected} · ${r.response.field.toLowerCase()} · optional</p>
      <p class="tac-q" id="tacQ">${r.response.prompt}</p>
      <form id="tacForm" class="tac-form"><label for="tacAns">Your answer</label>
      <input id="tacAns" name="answer" inputmode="decimal" autocomplete="off" maxlength="32">
      <button type="submit" class="tac-btn tac-btn--go">Check</button></form>
      <p class="tac-msg" id="tacStep" role="status"></p>`);
    $('tacForm').addEventListener('submit', onAnswer);
    $('tacAns').focus();
  } catch (err) { say(`<p class="tac-msg is-bad">${err.message}</p>`); }
}

function onAnswer(e) {
  e.preventDefault();
  const r = answerHint(session, BIND, state, $('tacAns').value);
  session = r.session;
  const res = r.response;
  if (!res.ok) {
    $('tacStep').innerHTML = res.code === 'STALE_BOARD' ? res.message
      : (res.code === 'UNREADABLE' ? 'Type a number, a fraction like 3/4, or a decimal. ' : 'Not yet. ') + (res.nextStep || '') +
        (res.canReveal ? ' <button type="button" class="tac-btn" id="tacReveal">Show the worked answer</button>' : '');
    const rv = $('tacReveal'); if (rv) rv.addEventListener('click', () => { const out = revealAnswer(session); session = out.session; $('tacStep').textContent = `${out.response.explain}. ${out.response.note} Enter it to unlock the hint.`; });
    return;
  }
  suggestion = res.suggestion;
  say(`<p class="tac-eyebrow">Suggested for ${selected}${res.masteryEvidence ? ' · counted toward mastery' : ''}</p>
    ${res.explain ? `<p class="tac-msg">Worked: ${res.explain}</p>` : ''}
    <ul class="tac-why">${res.why.map((l) => `<li>${l}</li>`).join('')}</ul>
    ${res.alternatives.length ? `<p class="tac-msg">Also reasonable: ${res.alternatives.map((a) => a.action === 'HOLD' ? 'hold' : `(${a.x}, ${a.y})`).join(', ')}.</p>` : ''}
    <p class="tac-msg">The hint does not move ${selected}. Tap the highlighted tile to take it, or play your own move.</p>`);
  render();
}

function onEndTurn() {
  state = beginPlayerPhase(resolveClockStatePhase(beginThreatPhase(state)));
  session = null; suggestion = null; say('<p class="tac-msg">New round. Your squad has 2 AP each again.</p>'); render();
}

$('tacGrid').addEventListener('click', onCell);
$('tacSquad').addEventListener('click', (e) => { const b = e.target.closest('[data-unit]'); if (!b) return; selected = b.dataset.unit; session = null; suggestion = null; say(''); render(); });
$('tacHint').addEventListener('click', onHint);
$('tacEnd').addEventListener('click', onEndTurn);
$('tacReset').addEventListener('click', () => { state = fresh(); selected = 'E1'; session = null; suggestion = null; say(''); render(); });
render();
window.__tac = { get state() { return state; }, get session() { return session; } };
