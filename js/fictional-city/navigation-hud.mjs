import { viewHeading } from './camera-controls.mjs';
import { DISTRICT_SURFACES } from './spatial.mjs';

const NS = 'http://www.w3.org/2000/svg';
const lastDraw = new WeakMap();
export function updateNavigationHud(node, view, buildings, places = null, neighborhoods = []) {
  if (!node) return;
  const key = [view.navigation?.status, view.navigation?.waypoint, view.destination?.id, view.interior, Math.round(view.x * 10), Math.round(view.z * 10), Math.round(view.yaw * 180 / Math.PI)].join(':');
  if (lastDraw.get(node) === key) return;
  lastDraw.set(node, key);
  const place = buildings.find(b => b.id === view.interior);
  const heading = viewHeading(view.yaw);
  const label = node.querySelector('[data-map-heading]');
  label.textContent = place ? 'Room · Map ↗' : heading.label + ' · Map ↗';
  node.setAttribute('aria-label', place ? `Open city map. Inside ${place.name}. Orange arrow shows your view in this room.` : `Open city map. Looking ${heading.label}. Orange arrow is you; nearby buildings are shown.`);
  const svg = node.querySelector('svg'); svg.replaceChildren();
  const shape = (tag, attrs, text) => {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    svg.append(element); return element;
  };
  const span = place && view.room ? Math.max(view.room.width, view.room.depth) + 4 : 75;
  const scale = 100 / span;
  const origin = place ? { x: 0, z: 0 } : view;
  const mx = x => 50 + (x - origin.x) * scale, mz = z => 50 + (z - origin.z) * scale;
  shape('rect', { width: 100, height: 100, fill: place ? '#e9e4cf' : '#9cc2c0' });
  if (place && view.room) {
    shape('rect', { x: mx(-view.room.width / 2), y: mz(-view.room.depth / 2), width: view.room.width * scale, height: view.room.depth * scale, fill: '#fffdf4', stroke: '#526964', 'stroke-width': 2 });
    shape('text', { x: 50, y: mz(view.room.depth / 2) + 9, 'text-anchor': 'middle', fill: '#203a3b', 'font-size': 9 }, 'EXIT');
  } else {
    const rect = (b, fill) => shape('rect', { x: mx(b.minX), y: mz(b.minZ), width: (b.maxX - b.minX) * scale, height: (b.maxZ - b.minZ) * scale, fill });
    for (const b of [...(places?.surfaces || DISTRICT_SURFACES), ...neighborhoods.flatMap(n => n.surfaces || [])]) rect(b, '#e9e4cf');
    for (const b of places?.streets || [{ minX: -72, maxX: 72, minZ: -10, maxZ: 8 }]) rect(b, '#8d9595');
    for (const n of neighborhoods) for (const road of n.roads || []) {
      if (road.points) shape('polyline', { points: road.points.map(([x, z]) => `${mx(x)},${mz(z)}`).join(' '), fill: 'none', stroke: '#8d9595', 'stroke-width': road.width * scale });
      else rect({ minX: road.x - road.width / 2, maxX: road.x + road.width / 2, minZ: road.z - road.depth / 2, maxZ: road.z + road.depth / 2 }, '#8d9595');
    }
    for (const b of buildings) {
      if (!b.position || !b.size || Math.abs(b.position[0] - view.x) > span || Math.abs(b.position[1] - view.z) > span) continue;
      if (b.footprint?.length) shape('polygon', { points: b.footprint.map(([x, z]) => `${mx(x)},${mz(z)}`).join(' '), fill: b.color || '#93a59b', stroke: '#526964', 'stroke-width': .6 });
      else shape('rect', { x: mx(b.position[0] - b.size[0] / 2), y: mz(b.position[1] - b.size[1] / 2), width: b.size[0] * scale, height: b.size[1] * scale, fill: b.color || '#93a59b', stroke: '#526964', 'stroke-width': .6 });
    }
    rect({ minX: -10.9728, maxX: 10.9728, minZ: 77.0272, maxZ: 98.9728 }, '#47676a');
    shape('text', { x: 6, y: 12, fill: '#203a3b', 'font-size': 10, 'font-weight': 'bold' }, 'N ↑');
  }
  if (view.navigation?.points?.length) {
    shape('polyline', { points: view.navigation.points.map(p => `${mx(p.x)},${mz(p.z)}`).join(' '), fill: 'none', stroke: '#dc6d23', 'stroke-width': 2, 'stroke-dasharray': view.navigation.status === 'preview' ? '3 2' : 'none' });
    if (view.navigation.next) shape('circle', { cx: mx(view.navigation.next.x), cy: mz(view.navigation.next.z), r: 2.5, fill: '#fff', stroke: '#dc6d23', 'stroke-width': 1.5 });
  }
  if (!place && view.destination) {
    const dx = (view.destination.x - view.x) * scale, dz = (view.destination.z - view.z) * scale;
    const factor = Math.min(1, 42 / Math.max(Math.abs(dx), Math.abs(dz), 1));
    shape('circle', { cx: 50 + dx * factor, cy: 50 + dz * factor, r: 4, fill: '#ffcf58', stroke: '#203a3b', 'stroke-width': 1.5 });
  }
  const px = mx(view.x), pz = mz(view.z);
  shape('path', { d: 'M 0 -8 L 5 5 L 0 2 L -5 5 Z', transform: `translate(${px} ${pz}) rotate(${heading.degrees})`, fill: '#c94e19', stroke: '#fff', 'stroke-width': 1.5 });
}
