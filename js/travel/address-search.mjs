import { normalizePlace } from './navigation-core.mjs';

// Photon explicitly supports search-as-you-type. Its public service is for
// modest use: debounce in the UI, bound requests here, and never retry a 429.
// Search terms go to Photon; this service never receives the user's GPS.
// Street-route requests separately send chosen endpoints to the routing
// provider after the traveler selects both endpoints. Saving remains explicit.
export function addressResults(data) {
  const seen = new Set(), rows = [];
  for (const feature of (Array.isArray(data?.features) ? data.features : []).slice(0, 20)) {
    try {
      if (feature.geometry?.type !== 'Point') continue;
      const coordinates = [...normalizePlace({ coordinates: feature.geometry.coordinates }).coordinates];
      const p = feature.properties || {};
      const clean = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
      const street = [clean(p.housenumber), clean(p.street)].filter(Boolean).join(' ');
      const label = [...new Set([clean(p.name), street, clean(p.city) || clean(p.district), clean(p.state), clean(p.postcode), clean(p.country)].filter(Boolean))].join(', ');
      if (!label || label.length > 240 || seen.has(label)) continue;
      seen.add(label); rows.push({ label, coordinates });
    } catch { /* A malformed provider row never becomes a false coordinate. */ }
  }
  return rows.slice(0, 6);
}

export function createAddressSearch(request = fetch) {
  let lastRequest = 0, blockedUntil = 0, requests = [];
  return async (query, signal) => {
    const q = String(query).trim();
    if (q.length < 3 || q.length > 240) return [];
    const now = Date.now();
    requests = requests.filter(t => now - t < 60000);
    if (now < blockedUntil || requests.length >= 25) throw Error('Address search is busy. Enter the full address, or try again shortly.');
    const delay = Math.max(0, 1100 - (now - lastRequest));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    lastRequest = Date.now(); requests.push(lastRequest);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once:true });
    const timer = setTimeout(cancel, 8000);
    try {
      const url = new URL('https://photon.komoot.io/api/');
      url.searchParams.set('q', q); url.searchParams.set('limit', '6'); url.searchParams.set('lang', 'en');
      const res = await request(url.href, { signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store' });
      if (res.status === 429) blockedUntil = Date.now() + 60000;
      if (!res.ok) throw Error('Address suggestions are unavailable. You can still enter a complete address.');
      return addressResults(await res.json());
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  };
}

export function currentPosition(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation) return reject(Error('Location is unavailable here. Enter your starting address.'));
    geolocation.getCurrentPosition(position => {
      try { resolve([...normalizePlace({ coordinates:[position.coords.longitude, position.coords.latitude] }).coordinates]); }
      catch { reject(Error('Your location could not be read. Enter your starting address.')); }
    }, error => reject(Error(error.code === 1
      ? 'Location access is off. Enter your starting address, or enable location in your browser settings.'
      : 'Your location could not be found. Try again or enter your starting address.')),
    { enableHighAccuracy:true, timeout:12000, maximumAge:60000 });
  });
}
