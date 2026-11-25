/* Review component for the existing McCluster City engine, not a second game.
   Authored game interiors only. No surveyed Jimmy's interior, real-brand model,
   map placement, shop ownership or production integration is asserted here. */
export const STORE_MODEL_ID = 'designer-kicks-retail-factory';
export const STORE_MODEL_VERSION = 1;
export const STORE_WIDTH = 18;
export const STORE_DEPTH = 14;

// Owner-approved creative labels. These are not crime statistics or real-brand designs.
export const COLLECTION_LABELS = Object.freeze([
  ['Bridgeport', 'Robbery 1s'], ['Waterbury', 'Burglary Twos'],
  ['Hartford', 'Arson Threes'], ['New Haven', 'Hami Fours'],
  ['New Britain', 'Assault Fives'], ['Manchester', 'Stolen Sixes'],
  ['Orange', 'Larceny Sevens'], ['Derby', 'GTA Eights'],
  ['East Haven', 'Larceny Nines'], ['Norwich', 'Home Invasion Tens'],
  ['Hamden', 'Repo Elevens'], ['Meriden', 'Burglary Twelves'],
  ['Cromwell', 'Stolen Thirteens']
].map(([city, name], index) => Object.freeze({ city, name, number: index + 1 })));

const fixture = (id, type, x, z, w, d, h) => ({ id, type, x, z, w, d, h });
const retail = [
  ...[-1.9, .7, 3.3].flatMap((z, i) => [
    fixture(`display-west-${i}`, 'display', -7.4, z, 1.3, 2, 2.3),
    fixture(`display-east-${i}`, 'display', 7.4, z, 1.3, 2, 2.3)
  ]),
  fixture('hero-display', 'hero', 0, .1, 2.4, 1.6, .8),
  fixture('fitting-bench-west', 'bench', -3.4, 3.6, 3.3, 1.2, .6),
  fixture('fitting-bench-east', 'bench', 3.4, 3.6, 3.3, 1.2, .6),
  fixture('checkout', 'checkout', -3.8, -1.8, 4.8, 1.1, 1.15),
  fixture('backroom-wall-west', 'partition', -1.9, -3.6, 14.2, .18, 2.7),
  fixture('backroom-wall-east', 'partition', 8.2, -3.6, 1.6, .18, 2.7),
  fixture('stock-rack', 'stock', -7.4, -5.2, 1.4, 2.6, 2.5),
  fixture('packing-table', 'packing', -3.4, -5.2, 3.5, 1.4, 1.0)
];
const factory = [
  fixture('textile-rack', 'textiles', -7.3, -4.8, 1.6, 3, 2.5),
  fixture('cutting-table', 'cutting', -3.5, -4.5, 3.8, 1.8, 1.0),
  fixture('sole-press-a', 'press', .6, -5, 1.6, 1.6, 2.1),
  fixture('sole-press-b', 'press', 3.1, -5, 1.6, 1.6, 2.1),
  fixture('sewing-bank-west', 'sewing', -6.4, -.6, 3.2, 1.5, 1.2),
  fixture('sewing-bank-east', 'sewing', -1.7, -.6, 3.2, 1.5, 1.2),
  fixture('assembly-transfer', 'conveyor', 3.8, -.6, 4.4, 1.35, .9),
  fixture('finishing-table', 'finishing', -6.2, 3.5, 3.2, 1.6, 1.0),
  fixture('garment-rail', 'garments', -1.8, 3.5, 2.6, 1.1, 2.0),
  fixture('dispatch-rack', 'stock', 3.1, 3.6, 2.0, 2.5, 2.5)
];
const floor = (id, label, elevation, fixtures, targets) => ({
  id, label, elevation, width: STORE_WIDTH, depth: STORE_DEPTH, fixtures, targets,
  surfaces: [{ minX: -9, maxX: 9, minZ: -7, maxZ: 7 }],
  blockers: fixtures.map(f => ({ id: f.id, minX: f.x - f.w / 2, maxX: f.x + f.w / 2, minZ: f.z - f.d / 2, maxZ: f.z + f.d / 2 }))
});

export function createStoreLayout({ collectionSlots = 13 } = {}) {
  if (!Number.isSafeInteger(collectionSlots) || collectionSlots < 1 || collectionSlots > 24) throw new RangeError('Collection size must be 1–24');
  return {
    id: STORE_MODEL_ID, version: STORE_MODEL_VERSION, provenance: 'authored-game-interior',
    collection: Array.from({ length: collectionSlots }, (_, index) => ({
      id: `collection-slot-${String(index + 1).padStart(2, '0')}`, status: 'pending-design-and-integration',
      ...(COLLECTION_LABELS[index] || { city: null, name: null, number: index + 1 }),
      offense: null, shoeModel: null, power: null, price: null, purchasable: false
    })),
    floors: [
      floor('retail', 'Showroom and backroom', 0, retail.map(f => ({ ...f })), [
        { id: 'street', kind: 'exit', x: 0, z: 5.8 },
        { id: 'counter', kind: 'counter', x: -3.8, z: -.25 },
        { id: 'collection', kind: 'collection', x: 0, z: 1.6 },
        { id: 'backroom', kind: 'waypoint', x: 6.3, z: -3.6 },
        { id: 'factory-stair', kind: 'floor', floor: 'factory', x: 6.3, z: -5.2 }
      ]),
      floor('factory', 'Shoe and clothing factory', -4.2, factory.map(f => ({ ...f })), [
        { id: 'showroom-stair', kind: 'floor', floor: 'retail', x: 6.3, z: -5.2 },
        { id: 'textiles', kind: 'inspect', x: -5.95, z: -4.8 },
        { id: 'cutting', kind: 'inspect', x: -3.5, z: -2.9 },
        { id: 'pressing', kind: 'inspect', x: 1.8, z: -3.5 },
        { id: 'sewing', kind: 'inspect', x: -1.7, z: 1.0 },
        { id: 'assembly', kind: 'inspect', x: 4.3, z: 1.0 },
        { id: 'finishing', kind: 'inspect', x: -6.2, z: 5.2 },
        { id: 'clothing', kind: 'inspect', x: -1.8, z: 5.0 },
        { id: 'dispatch', kind: 'inspect', x: 4.8, z: 3.6 }
      ])
    ]
  };
}

export function storeFloor(layout, id = 'retail') {
  return layout.floors.find(f => f.id === id) || layout.floors.find(f => f.id === 'retail');
}

// Adapter seam: caller persists the floor with the existing city position, then
// uses the selected floor's collision world. This does not modify a city save.
export function transitionStoreFloor(layout, position, targetId) {
  const current = layout.floors.find(f => f.id === position.floor);
  const target = current?.targets.find(t => t.id === targetId && t.kind === 'floor');
  if (!target || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return { ok: false, reason: 'unknown-floor-link', position };
  if (Math.hypot(position.x - target.x, position.z - target.z) > 1.8) return { ok: false, reason: 'approach-stairs', position };
  const next = layout.floors.find(f => f.id === target.floor);
  const arrival = next?.targets.find(t => t.kind === 'floor' && t.floor === current.id);
  if (!arrival) return { ok: false, reason: 'broken-floor-link', position };
  return { ok: true, position: { ...position, floor: next.id, x: arrival.x, z: arrival.z } };
}
