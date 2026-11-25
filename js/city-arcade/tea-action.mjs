import { TEA_MISSION, BREWERS, validateTeaMission } from './tea-config.mjs';
export { TEA_MISSION, BREWERS, validateTeaMission } from './tea-config.mjs';
export function newTeaAction(m = TEA_MISSION) {
  const config = validateTeaMission(m);
  return { config, player: { ...config.spawn }, remaining: config.duration, index: 0, score: 0,
    cup: null, brewing: null, status: 'ready', message: `First order: ${config.route[0]}. Brew upstairs, deliver downstairs.` };
}
export function stepTea(s, input, dt) {
  if (s.status !== 'playing') return s;
  dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, .05));
  const n = { ...s, player: { ...s.player }, remaining: Math.max(0, s.remaining - dt) };
  if (!n.remaining) return { ...n, status: 'failed', message: 'Shift ended. Try a faster route!' };
  if (n.brewing) {
    n.brewing = { ...n.brewing, left: n.brewing.left - dt };
    if (n.brewing.left <= 0) { n.cup = n.brewing.tea; n.brewing = null; n.message = `${n.cup} ready. Deliver to the customer!`; }
    return n;
  }
  const x = Math.sign(input.x || 0), y = Math.sign(input.y || 0), length = Math.hypot(x, y) || 1;
  n.player.x = Math.max(20, Math.min(580, n.player.x + x / length * n.config.speed * dt));
  n.player.y = Math.max(120, Math.min(315, n.player.y + y / length * n.config.speed * dt));
  if (!input.act) return n;
  const brewer = BREWERS.find(b => Math.hypot(n.player.x-b.x, n.player.y-b.y) < 75);
  if (brewer) {
    if (n.cup === brewer.tea) return n;
    n.brewing = { tea: brewer.tea, left: n.config.brewSeconds };
    n.cup = null; n.message = `Brewing ${brewer.tea}…`; return n;
  }
  if (Math.hypot(n.player.x-300, n.player.y-345) < 85) {
    if (n.cup !== n.config.route[n.index]) { n.message = `This customer wants ${n.config.route[n.index]}. Brew that blend upstairs.`; return n; }
    n.index++; n.score += n.config.reward; n.cup = null;
    n.status = n.index === n.config.route.length ? 'won' : 'playing';
    n.message = n.status === 'won' ? 'Perfect delivery! Shift complete.' : `Served! Next up: ${n.config.route[n.index]}.`;
  } else n.message = 'Move close to a brewer or the customer, then act.';
  return n;
}
