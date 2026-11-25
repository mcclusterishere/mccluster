/* Courtyard presentation only. Engine columns/rows and saved state never move.
   Three.js ground (X,Z) -> display (X,Y): east is +X, north is +Y = -Z. */
export const COURTYARD_VIEW_KEY = 'prim3.courtyard.display.v1';
export function displayPreferences(raw) {
  try { const p = JSON.parse(raw); if (p?.v === 1) return { v: 1, projection: p.projection === 'top' ? 'top' : 'perspective', origin: p.origin === 'objective' ? 'objective' : 'centre' }; } catch {}
  return { v: 1, projection: 'perspective', origin: 'centre' };
}
export function displayFrame(width, height, objective, origin = 'centre', metresPerCell = 1) {
  const at = origin === 'objective' && objective ? { x: objective.x, z: objective.y } : { x: (width - 1) / 2, z: (height - 1) / 2 };
  return { origin: at, metresPerCell,
    toDisplay: (x, z) => ({ x: (x - at.x) * metresPerCell, y: (at.z - z) * metresPerCell }),
    toGround: (x, y) => ({ x: at.x + x / metresPerCell, z: at.z - y / metresPerCell }) };
}
export const signed = (n) => `${n > 0 ? '+' : ''}${Number(n.toFixed(3))}`;
