// Public-safe, deterministic City Arcade game rules. No Core/owner city-save mutations.
export const BOARD_SIZE = 7;
export const START = Object.freeze({ x: 3, y: 3 });
export const EXIT = Object.freeze({ x: 6, y: 6 });
export const STORE = Object.freeze({ x: 6, y: 3 });
export const MAX_TURNS = 32;
export const WALLS = Object.freeze([[1, 1], [2, 1], [4, 2], [1, 4], [4, 4], [2, 5]]);
export const SHOES = Object.freeze([
  { id: 'velocity', name: 'Velocity 1s', icon: '⚡', x: 2, y: 3, ability: 'Dash two squares' },
  { id: 'ghost', name: 'Ghost Soles', icon: '◈', x: 5, y: 1, ability: 'Two turns of concealment' },
  { id: 'gravity', name: 'Gravity Highs', icon: '✦', x: 0, y: 5, ability: 'Leap one obstacle' },
  { id: 'robbery', name: 'Robbery 1s', icon: '◆', x: 5, y: 5, ability: 'A risky, cursed burst of speed' }
]);
export const ORDERS = Object.freeze([
  { customer: 'Early commuter', wants: 'Lemon', options: ['Mint', 'Ginger', 'Lemon'] },
  { customer: 'Night editor', wants: 'Ginger', options: ['Ginger', 'Lemon', 'Berry'] },
  { customer: 'Camera operator', wants: 'Mint', options: ['Berry', 'Mint', 'Lemon'] },
  { customer: 'Garage mechanic', wants: 'Berry', options: ['Ginger', 'Berry', 'Mint'] },
  { customer: 'Block regular', wants: 'Lemon', options: ['Lemon', 'Berry', 'Ginger'] }
]);
const DIRECTIONS = Object.freeze({ north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] });
const at = (a, b) => a.x === b.x && a.y === b.y;
const wallAt = (x, y) => WALLS.some(p => p[0] === x && p[1] === y);
const valid = (x, y) => x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE && !wallAt(x, y);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function newSoleRun() {
  return {
    status: 'playing', turn: 0, player: { ...START }, police: { x: 0, y: 0 },
    collected: [], equipped: null, cooldowns: {}, boost: null, veil: 0,
    heat: 0, score: 0, fines: 0, detentions: 0, storeAttempts: [],
    message: 'Collect all four pairs, equip their powers, and return to the exit.'
  };
}

export function policeTier(heat) {
  if (heat >= 7) return 'Pursuit';
  if (heat >= 4) return 'Active search';
  if (heat >= 2) return 'Witness report';
  return 'No active report';
}
function copy(run) {
  return {
    ...run, player: { ...run.player }, police: { ...run.police },
    collected: [...run.collected], cooldowns: { ...run.cooldowns },
    storeAttempts: [...run.storeAttempts]
  };
}
function tick(run) {
  run.turn += 1;
  for (const [id, remaining] of Object.entries(run.cooldowns)) run.cooldowns[id] = Math.max(0, remaining - 1);
  const found = SHOES.find(s => at(s, run.player) && !run.collected.includes(s.id));
  if (found) {
    run.collected.push(found.id);
    run.score += 100;
    run.message = 'Collected ' + found.name + '! Equip it to try its power.';
  }
  if (run.heat >= 4) {
    const dx = Math.sign(run.player.x - run.police.x), dy = Math.sign(run.player.y - run.police.y);
    const moves = [[dx, 0], [0, dy]];
    for (const [mx, my] of moves) {
      if ((mx || my) && valid(run.police.x + mx, run.police.y + my)) {
        run.police.x += mx; run.police.y += my; break;
      }
    }
  }
  if (at(run.player, run.police) && run.heat >= 4 && run.veil <= 0) {
    run.detentions += 1;
    run.fines += 50;
    run.score = Math.max(0, run.score - 80);
    run.player = { ...START };
    run.police = { x: 0, y: 0 };
    run.heat = 0;
    run.boost = null;
    run.message = 'Detained in the fictional arcade. 50-point fine; returned to the start.';
  }
  run.veil = Math.max(0, run.veil - 1);
  if (run.turn % 4 === 0) run.heat = Math.max(0, run.heat - 1);
  if (run.detentions >= 3) {
    run.status = 'failed'; run.message = 'Three detentions. Run ended. Try a cleaner route.';
  } else if (run.collected.length === SHOES.length && at(run.player, EXIT)) {
    run.status = 'won'; run.score += 250;
    run.message = 'Collection complete! All four shoes secured.';
  } else if (run.turn >= MAX_TURNS) {
    run.status = 'failed'; run.message = 'Time is up. Collect the missing pairs and retry.';
  }
  return run;
}
export function moveSole(run, direction) {
  if (run.status !== 'playing' || !DIRECTIONS[direction]) return run;
  const [dx, dy] = DIRECTIONS[direction];
  const steps = run.boost === 'dash' || run.boost === 'leap' ? 2 : 1;
  const x = run.player.x + dx * steps, y = run.player.y + dy * steps;
  if (!valid(x, y)) return { ...run, message: 'That route is blocked. Try another street.' };
  if (steps === 2 && run.boost !== 'leap' && !valid(run.player.x + dx, run.player.y + dy)) {
    return { ...run, message: 'Dash needs a clear path. Gravity Highs can vault obstacles.' };
  }
  const next = copy(run);
  next.player = { x, y };
  next.boost = null;
  next.message = steps === 2 ? 'Powered movement!' : 'Moved ' + direction + '.';
  return tick(next);
}
export function equipSole(run, id) {
  if (run.status !== 'playing' || !run.collected.includes(id)) return run;
  const next = copy(run);
  next.equipped = id; next.message = 'Equipped ' + SHOES.find(s => s.id === id).name + '.';
  return next;
}
export function useSolePower(run) {
  if (run.status !== 'playing' || !run.equipped) return { ...run, message: 'Equip a collected pair first.' };
  if ((run.cooldowns[run.equipped] || 0) > 0) return { ...run, message: 'This pair is still recharging.' };
  const next = copy(run);
  next.cooldowns[next.equipped] = 5;
  if (next.equipped === 'ghost') {
    next.veil = 3; next.message = 'Ghost Soles: concealment for the next two moves.';
  } else if (next.equipped === 'gravity') {
    next.boost = 'leap'; next.message = 'Gravity Highs: next move vaults two squares.';
  } else if (next.equipped === 'robbery') {
    next.boost = 'dash'; next.heat = clamp(next.heat + 4, 0, 10);
    next.score += 50;
    next.message = 'Robbery 1s: burst charged; witnesses report unusual activity.';
  } else {
    next.boost = 'dash'; next.message = 'Velocity 1s: next move dashes two clear squares.';
  }
  return next;
}
export function visitStore(run, choice) {
  if (run.status !== 'playing') return run;
  if (!at(run.player, STORE)) return { ...run, message: 'Reach the marked storefront first.' };
  if (!['challenge', 'crime'].includes(choice) || run.storeAttempts.includes(choice)) {
    return { ...run, message: 'That storefront choice has already been played.' };
  }
  const next = copy(run);
  next.storeAttempts.push(choice);
  if (choice === 'challenge') {
    next.score += 75; next.message = 'Store challenge won. +75 arcade points; no police response.';
  } else {
    next.score += 120;
    next.heat = clamp(next.heat + 6, 0, 10);
    next.message = 'Fictional smash-and-grab: report filed, police searching. +120 points, heavy heat.';
  }
  return tick(next);
}
export function newTeaRun() {
  return { status: 'playing', index: 0, score: 0, streak: 0, correct: 0, message: 'Fill five orders.' };
}
export function serveTea(run, choice) {
  if (run.status !== 'playing' || !ORDERS[run.index]?.options.includes(choice)) return run;
  const right = ORDERS[run.index].wants === choice;
  const streak = right ? run.streak + 1 : 0;
  const score = run.score + (right ? 20 + Math.min(5, streak) * 5 : 0);
  const index = run.index + 1;
  return {
    ...run, index, streak, score, correct: run.correct + Number(right),
    status: index === ORDERS.length ? 'won' : 'playing',
    message: right ? 'Correct blend! Keep the streak going.' : 'Wrong blend. Next order!'
  };
}
export function validateArcadeCatalog(registry, cityBusinessIds = []) {
  const errors = [], ids = new Set(), shopIds = new Set();
  if (registry?.schema !== 'here.city-arcade/v1' || !Array.isArray(registry.games)) return ['invalid catalog schema'];
  for (const game of registry.games) {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(game.id || '') || ids.has(game.id)) errors.push('duplicate/invalid game id');
    ids.add(game.id);
    if (!['playable', 'planned'].includes(game.status)) errors.push('invalid status: ' + game.id);
    if (!['city', 'store'].includes(game.scope)) errors.push('invalid scope: ' + game.id);
    if (typeof game.title !== 'string' || !game.title.trim()) errors.push('missing title: ' + game.id);
    if (game.scope === 'store') {
      if (!cityBusinessIds.includes(game.placeId) || shopIds.has(game.placeId)) errors.push('invalid/duplicate shop: ' + game.id);
      shopIds.add(game.placeId);
    } else if (game.placeId != null) errors.push('city title must not claim a storefront');
    if (game.status === 'playable' && !['designer-kicks-sole-run', 'gauranfucking-tea-tea-rush'].includes(game.id)) errors.push('unimplemented game: ' + game.id);
  }
  if (cityBusinessIds.length && (shopIds.size !== cityBusinessIds.length)) errors.push('not every original store has a slot');
  return errors;
}
