import { normalizeRouteRequest } from './route-core.mjs';

// A user-initiated provider handoff only. No fare, availability, reservation,
// payment choice, affiliate commission or dispatch state is invented here.
// https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction
export function rideHandoff({ origin, destination, originLabel = '', destinationLabel = '' }) {
  const points = normalizeRouteRequest({ origin, destination, mode: 'drive' });
  const location = (coordinates, label) => ({ latitude: coordinates[1], longitude: coordinates[0],
    addressLine1: String(label).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) });
  const url = new URL('https://m.uber.com/looking');
  url.searchParams.set('pickup', JSON.stringify(location(points.origin, originLabel)));
  url.searchParams.set('drop[0]', JSON.stringify(location(points.destination, destinationLabel)));
  return url.href;
}
