/* THE WORLD IS THE SOCIAL FEED (owner, 2026-10-20: "the transport and the missions feature will be taken off and the social
   feature will be the only feature"). mnet.html switches Travel and Missions off (hu-social-only on <html>, missions=0 for
   the globe). They stay in the code, so the suites that guard them still drive them: a test server hands those suites the
   World with the switch removed, and the social-only checks ask for the page as it ships. */
export const SOCIAL_SWITCH = ' hu-social-only';

export function withTravelAndMissions(html) {
  const page = String(html);
  if (!page.includes(SOCIAL_SWITCH)) throw new Error('mnet.html no longer carries the social-only switch: update scripts/e2e/world-switch.mjs');
  return page.replace(SOCIAL_SWITCH, '').replace('data-world-mode="posts"', 'data-world-mode="travel"').replaceAll('&amp;missions=0', '');
}
