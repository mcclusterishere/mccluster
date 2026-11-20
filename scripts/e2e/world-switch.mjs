/* TRAVEL IS THE HOUSE OWNER'S (owner, 2026-10-20: "the transport and the missions feature will be taken off"; missions came
   back for everyone on 2026-11-17, AGENTS.md "Public World"). mnet.html switches Travel off with hu-travel-off on <html>,
   and the house owner's World lifts it (js/world-owner-modes.js). Travel stays in the code, so the suites that guard it
   still drive it: a test server hands those suites the World with the switch removed, which opens on Travel beside the
   News feed as the owner's does, and every other check asks for the page as it ships. Missions need no switch: they are
   public in the page as it ships. */
export const TRAVEL_SWITCH = ' hu-travel-off';

export function withTravel(html) {
  const page = String(html);
  if (!page.includes(TRAVEL_SWITCH)) throw new Error('mnet.html no longer carries the Travel switch: update scripts/e2e/world-switch.mjs');
  return page.replace(TRAVEL_SWITCH, '').replace('data-world-mode="posts"', 'data-world-mode="travel"');
}
