import { normalizeJourney } from './journey-core.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Existing McCluster session + canonical PostgREST. Owner isolation is RLS. */
export function journeyStore(session, request = fetch) {
  async function call(path, method = 'GET', body) {
    const token = await session.token();
    if (!token) throw new Error('Sign in to save your journeys.');
    const res = await request(`${session.url}/rest/v1/travel_journeys${path}`, {
      method, headers: { apikey: session.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Your sign-in expired. Sign in and try again.' : 'Your journey could not be saved or loaded. Please try again.');
    return res.status === 204 ? [] : res.json();
  }
  const key = id => { if (!UUID.test(id)) throw new TypeError('Invalid journey id'); return `?id=eq.${id}`; };
  return {
    list: () => call('?select=id,plan,updated_at&order=updated_at.desc&limit=50'),
    async save(draft, id = null) {
      const plan = normalizeJourney(draft);
      if (!plan.from || !plan.to) throw new Error('Choose where your journey starts and ends.');
      const rows = await call(id ? key(id) : '', id ? 'PATCH' : 'POST', { plan });
      if (!rows?.[0]?.id) throw new Error('This journey is no longer available. Save it as a new journey.');
      return rows[0];
    },
    remove: id => call(key(id), 'DELETE'),
  };
}
