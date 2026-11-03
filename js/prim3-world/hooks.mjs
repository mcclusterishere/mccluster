/* PRIM3 World: the hook a later build uses to put news into a country's card (owner, 2026-11-02: "News → mission").
   That build fetches GET https://api.mccluster.org/v1/world/news?country=XX and asks McCluster AI for a mission draft;
   none of it is implemented here. Every time a country card is drawn, its empty section
   <section id="pwNews" data-country="XX"> is handed to:
     - every function registered with onCountryCard(fn): fn(countryCode, sectionEl, { name }); it returns an unsubscribe;
     - a window CustomEvent 'prim3:country-card' with detail { country, name, el }.
   The section is replaced whenever the card is redrawn, so a handler works on the element it is given. */

const handlers = new Set();
export const COUNTRY_CARD_EVENT = 'prim3:country-card';

export function onCountryCard(fn) {
  if (typeof fn !== 'function') throw new TypeError('onCountryCard needs a function');
  handlers.add(fn);
  return () => handlers.delete(fn);
}
export function emitCountryCard(country, el, name) {
  for (const fn of handlers) { try { fn(country, el, { name }); } catch (e) { console.warn('[prim3 world] country card hook', e); } }
  try { globalThis.dispatchEvent(new CustomEvent(COUNTRY_CARD_EVENT, { detail: { country, name, el } })); } catch (e) {}
}
