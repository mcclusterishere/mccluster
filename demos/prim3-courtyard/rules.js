/* PRIM3 courtyard prototype. Pure rules: no rendering, timers or DOM. */
(function (scope) {
  'use strict';
  const SIZE = 10;
  const RELAY = Object.freeze({ x: 7, y: 6 });
  const BLOCKED = ['4,2', '4,3', '5,4', '5,5', '8,8', '8,9', '9,8', '7,6'];
  const ROSTER = [
    { id: 'E', name: 'Arjun Mehta', short: 'Arjun', country: 'India', code: 'IN', role: 'Entry', range: 5, x: 1, y: 2, kit: 'Low-profile carrier, compact entry tool and close protection kit.' },
    { id: 'R', name: 'Rafael Costa', short: 'Rafael', country: 'Brazil', code: 'BR', role: 'Recon', range: 6, x: 0, y: 4, kit: 'Light soft armor, handheld optics and a compact sensor pack.' },
    { id: 'T', name: 'Aya Shinoda', short: 'Aya', country: 'Japan', code: 'JP', role: 'Technical', range: 4, x: 1, y: 5, kit: 'Light field layers, a cyberdeck and a wrist interface.' }
  ];
  const key = (x, y) => `${x},${y}`;
  function createState() {
    return { size: SIZE, blocked: new Set(BLOCKED), relay: { ...RELAY }, units: ROSTER.map(u => ({ ...u, ap: 2 })), turn: 1, moving: null, complete: false };
  }
  function reachable(state, id) {
    const unit = state.units.find(u => u.id === id);
    if (!unit) return new Map();
    const map = new Map([[key(unit.x, unit.y), [{ x: unit.x, y: unit.y }]]]);
    if (unit.ap < 1 || state.moving) return map;
    const occupied = new Set(state.units.filter(u => u.id !== id).map(u => key(u.x, u.y)));
    const queue = [{ x: unit.x, y: unit.y }];
    for (let i = 0; i < queue.length; i++) {
      const point = queue[i], path = map.get(key(point.x, point.y));
      if (path.length - 1 >= unit.range) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const x = point.x + dx, y = point.y + dy, k = key(x, y);
        if (x < 0 || x >= state.size || y < 0 || y >= state.size || state.blocked.has(k) || occupied.has(k) || map.has(k)) continue;
        map.set(k, path.concat({ x, y })); queue.push({ x, y });
      }
    }
    return map;
  }
  function beginMove(state, id, x, y) {
    if (state.moving) return null;
    const unit = state.units.find(u => u.id === id);
    const path = reachable(state, id).get(key(x, y));
    if (!unit || unit.ap < 1 || !path || path.length < 2) return null;
    unit.ap--;
    state.moving = { id, path: path.map(p => ({ ...p })) };
    return state.moving.path;
  }
  function finishMove(state) {
    if (!state.moving) return false;
    const unit = state.units.find(u => u.id === state.moving.id);
    const end = state.moving.path[state.moving.path.length - 1];
    unit.x = end.x; unit.y = end.y; state.moving = null; return true;
  }
  function endTurn(state) {
    if (state.moving) return false;
    state.turn++; state.units.forEach(u => { u.ap = 2; }); return true;
  }
  function canConnect(state, id) {
    const unit = state.units.find(u => u.id === id);
    return !!unit && id === 'T' && unit.ap > 0 && !state.moving && !state.complete && Math.abs(unit.x - state.relay.x) + Math.abs(unit.y - state.relay.y) === 1;
  }
  function connect(state, id) {
    if (!canConnect(state, id)) return false;
    state.units.find(u => u.id === id).ap--; state.complete = true; return true;
  }
  const api = Object.freeze({ SIZE, ROSTER, key, createState, reachable, beginMove, finishMove, endTurn, canConnect, connect });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.PRIM3Rules = api;
})(typeof window !== 'undefined' ? window : globalThis);
