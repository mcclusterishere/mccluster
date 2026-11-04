// One mission contract drives authoring and play. Points are local, never currency.
export const TEA_MISSION = Object.freeze({ version: 1, duration: 75, speed: 200, brewSeconds: 1.2,
  reward: 100, spawn: { x: 300, y: 220 }, route: ['Lemon', 'Mint', 'Berry', 'Ginger', 'Lemon'] });
export const BREWERS = Object.freeze(['Lemon', 'Mint', 'Berry', 'Ginger'].map((tea, i) => ({ tea, x: 75 + i * 150, y: 75 })));
export function validateTeaMission(m) {
  if (!m || m.version !== 1) throw Error('Unsupported mission version');
  for (const [key, low, high] of [['duration',30,180],['speed',100,300],['brewSeconds',.5,3],['reward',0,500]]) {
    if (!Number.isFinite(m[key]) || m[key] < low || m[key] > high) throw Error(`Invalid ${key}`);
  }
  if (!m.spawn || !Number.isFinite(m.spawn.x) || !Number.isFinite(m.spawn.y) || m.spawn.x < 20 || m.spawn.x > 580 || m.spawn.y < 130 || m.spawn.y > 300) throw Error('Invalid spawn');
  if (!Array.isArray(m.route) || m.route.length < 1 || m.route.length > 12 || m.route.some(t => !BREWERS.some(b => b.tea === t))) throw Error('Invalid customer route');
  return structuredClone(m);
}
