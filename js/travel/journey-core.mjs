import { createPlan, legHandoff, normalizePlace } from './navigation-core.mjs';

export const TRAVEL_MODES = Object.freeze(['flight', 'train', 'drive', 'transit', 'walk', 'cycle']);
const text = (value, max = 240) => {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value) || value.length > max) throw new TypeError('Invalid place text');
  return value.trim().replace(/\s+/gu, ' ');
};
export function place(value) {
  if (value == null) return null;
  const label = text(value.label);
  if (!label) return null;
  return { label, coordinates: value.coordinates == null ? null : [...normalizePlace({ coordinates: value.coordinates }).coordinates] };
}
function date(value) {
  if (!value) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) throw new TypeError('Choose a valid date');
  return value;
}
/** Private, user-authored planning data only. Never a booking or a fare. */
export function normalizeJourney(input = {}) {
  const mode = input.mode ?? 'flight';
  if (!TRAVEL_MODES.includes(mode)) throw new TypeError('Choose a travel mode');
  const travelers = input.travelers ?? 1;
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 16) throw new RangeError('Choose 1–16 travelers');
  const departure = date(input.departure), returning = date(input.returning);
  if (returning && (!departure || returning < departure)) throw new RangeError('Return date must follow departure');
  return {
    version: 1, from: place(input.from), to: place(input.to), departure, returning, travelers, mode,
    departureHub: text(input.departureHub ?? ''), arrivalHub: text(input.arrivalHub ?? ''), stay: text(input.stay ?? ''),
    lowestCost: input.lowestCost === true, freeOptions: input.freeOptions === true,
  };
}
export function journeyTitle(input) {
  const d = normalizeJourney(input);
  return d.to ? `${d.from?.label || 'Your journey'} → ${d.to.label}` : 'Your next journey';
}
export const asPlace = p => p?.coordinates ? { coordinates: p.coordinates } : p?.label ? { query: p.label } : p ? { query: p } : null;
export function itinerary(input) {
  const d = normalizeJourney(input), longDistance = ['flight', 'train'].includes(d.mode);
  const gateway = d.mode === 'flight' ? 'airport' : 'station';
  const short = p => p.label.split(',')[0];
  const leg = (id, kind, origin, destination, title, subtitle, edit) => ({ id, kind, origin: asPlace(origin), destination: asPlace(destination), title, subtitle, edit, ready: !!destination && (kind === 'stay' || !!origin) });
  if (!d.from || !d.to) return [];
  return [
    ...(longDistance ? [leg('departure', 'drive', d.from, d.departureHub, d.departureHub ? `${short(d.from)} → ${d.departureHub}` : `Get to your departure ${gateway}`, d.departureHub ? 'Departure transport · planned' : `Choose your departure ${gateway}`, 'departureHub')] : []),
    leg('main', d.mode, longDistance ? d.departureHub || d.from : d.from, longDistance ? d.arrivalHub || d.to : d.to,
      `${short(d.from)} → ${short(d.to)}`, { flight: 'Flight search', train: 'Train search', drive: 'Road journey', transit: 'Public transport', walk: 'Walking route', cycle: 'Cycling route' }[d.mode], longDistance ? 'departureHub' : 'from'),
    ...(longDistance ? [leg('arrival', 'drive', d.arrivalHub, d.stay, d.arrivalHub && d.stay ? `${d.arrivalHub} → ${d.stay}` : `From your arrival ${gateway}`, d.arrivalHub && d.stay ? 'Arrival transport · planned' : 'Add your arrival point and final address', d.arrivalHub ? 'stay' : 'arrivalHub')] : []),
    leg('stay', 'stay', null, d.stay || d.to, d.stay || 'A place to stay', d.stay ? 'Your planned stay' : `Explore stays in ${d.to.label}`, 'stay'),
  ];
}
export function legAction(input, id) {
  const d = normalizeJourney(input), l = itinerary(d).find(x => x.id === id);
  if (!l?.ready) return { type: 'edit', field: l?.edit || 'from' };
  if (['drive', 'transit', 'walk', 'cycle'].includes(l.kind)) {
    const plan = createPlan({ id: 'journey', legs: [l] });
    return { type: 'directions', url: legHandoff(plan, l.id, 'google').url };
  }
  // An explicit search handoff, not an inventory, fare or booking API.
  const url = new URL('https://www.google.com/search');
  const q = l.kind === 'stay' ? (d.stay || `places to stay in ${d.to.label}`)
    : `${l.kind === 'flight' ? 'flights' : 'trains'} from ${d.departureHub || d.from.label} to ${d.arrivalHub || d.to.label} ${d.departure} ${d.returning} ${d.travelers} travelers`;
  url.searchParams.set('q', q.trim());
  return { type: 'search', url: url.href };
}
const fold = s => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function searchCities(rows, query, limit = 7) {
  const q = fold(query).trim();
  if (q.length < 2) return [];
  const words = q.split(/[,\s]+/).filter(Boolean);
  return rows.filter(r => words.every(w => fold(r.label).includes(w)))
    .sort((a, b) => Number(fold(b.name) === q) - Number(fold(a.name) === q) || Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q)) || b.population - a.population).slice(0, limit);
}
