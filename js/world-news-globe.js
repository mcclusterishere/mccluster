/* World news belongs to the same stream as community posts. This module owns
   only the in-app story view and geographic marker bridge, never a second feed.
   The globe is sent the stories the feed is showing (window.MCC_WORLD_NEWS_ITEMS, js/mnet.js); it draws no pin per
   story (the news heat map counts them, js/action-globe.js), only the one whose place a card pointed to.
   GDELT mention/permission caveats are retained in internal data and docs. */
(function () {
  'use strict';
  const frame = document.getElementById('mnWorldFrame');
  if (!frame) return;
  const mode = () => window.MCC_WORLD_MODE?.get?.() || document.documentElement.dataset.worldMode || 'travel';
  const feed = document.getElementById('mnFeed');
  const geo = x => x && typeof x.lat === 'number' && typeof x.lon === 'number' &&
    Number.isFinite(x.lat) && Number.isFinite(x.lon) &&
    Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180 && (x.lat !== 0 || x.lon !== 0);
  const valid = x => x && typeof x.id === 'string' && typeof x.title === 'string' &&
    typeof x.domain === 'string' && typeof x.url === 'string' && /^https?:\/\//i.test(x.url);
  const items = () => {
    try { return (window.MCC_WORLD_NEWS_ITEMS?.() || []).filter(valid).slice(0,120); }
    catch (_) { return []; }
  };
  function send(data) {
    if (frame.contentWindow) frame.contentWindow.postMessage(data, location.origin);
  }
  /* THE NEWS STEPS ASIDE IN THE EQUITY UPRISE TAB (release polish, 2026-11-18, review V2-M3, hid the tint; event timeline slice
     S4, 2026-11-19, decision D9, default adopted pending Matthew's confirmation, turns the news layer off): there the environmental
     layers are the subject (owner, 2026-11-17: "make the visuals proportionate to the geographical data we are collecting"; owner
     direction 2026-11-19: no news on the tab's environmental globe), so while the feed's scope is that tab the news layer is off (on:false,
     tint:false): no heat read, no shading or legend, no story pin, no news count on a country's card. Leaving the tab brings it
     back as it was. */
  const scope = () => window.MCC_FEED_SCOPE?.get?.() || 'global';
  /* and behind the sign-in door (release review RS-9, 2026-11-19, hid the shading: its orange, gold and red competed with the
     card's gold and read as a news map; carried release item 6: the door's backdrop goes as quiet as the tab): the door
     (html.mn-door-open, js/mnet.js showGate) says when it opens and closes (mcc:door) */
  const doorOpen = () => document.documentElement.classList.contains('mn-door-open');
  function sync() {
    const quiet = scope() === 'equity' || doorOpen();
    const on = mode() !== 'travel' && mode() !== 'environment' && !quiet;
    send({type:'hu:world-news-pins',on,tint:scope() !== 'equity' && !doorOpen(),items:on ? items().filter(geo).map(x => ({id:x.id,lat:x.lat,lon:x.lon})) : []});
  }

  const reader = document.createElement('dialog');
  reader.id = 'worldNewsReader';
  reader.className = 'world-news-reader';
  reader.setAttribute('aria-labelledby','worldNewsReaderTitle');
  const label = document.createElement('p');
  label.className = 'world-news-reader__eyebrow';
  label.textContent = 'World · News';
  const title = document.createElement('h3');
  title.id = 'worldNewsReaderTitle';
  const meta = document.createElement('p');
  meta.className = 'world-news-meta';
  const actions = document.createElement('div');
  actions.className = 'world-news-reader__actions';
  const discuss = document.createElement('button');
  discuss.type = 'button';
  discuss.textContent = 'Join the conversation';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.onclick = () => reader.close();
  actions.append(discuss, close);
  reader.append(label, title, meta, actions);
  document.body.appendChild(reader);
  let prior = null, currentId = null;
  reader.addEventListener('close', () => { prior?.focus?.(); prior = null; });
  function discussion(id) {
    const card = [...(feed?.querySelectorAll('[data-news-id]') || [])]
      .find(el => el.dataset.newsId === id);
    if (!card) return;
    window.MCC_WORLD_MODE?.set?.('posts');
    card.scrollIntoView({block:'center',behavior:'smooth'});
    card.querySelector('[data-discussion-toggle]')?.click();
  }
  function discussionAvailable(id) {
    const card = [...(feed?.querySelectorAll('[data-news-id]') || [])]
      .find(el => el.dataset.newsId === id);
    // Actual live feed capabilities own the input. Never advertise a dead
    // discussion action while the server flag or SQL migration is disabled.
    return !!card?.querySelector('[data-discussion-toggle]');
  }
  function openStory(story, opener) {
    if (!valid(story)) return;
    discuss.hidden = !discussionAvailable(story.id);
    prior = opener || null;
    currentId = story.id;
    title.textContent = story.title;
    const when = story.seen_at && !Number.isNaN(Date.parse(story.seen_at))
      ? new Date(story.seen_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
    meta.textContent = [story.domain,when,story.place].filter(Boolean).join(' · ');
    if (!reader.open) reader.showModal();
  }
  discuss.onclick = () => {
    const id = currentId;
    if (!id || !discussionAvailable(id)) {
      discuss.hidden = true;
      return; // The modal stays open; the Close button remains useful.
    }
    reader.close();
    discussion(id);
  };
  window.MCC_WORLD_NEWS_READER = {open:openStory};
  window.addEventListener('mcc:world-news-loaded', sync);
  /* the feed rendered a different set of stories (a country picked, a search, a scope, a mission): the pins follow */
  window.addEventListener('mcc:world-news-shown', sync);
  window.addEventListener('mcc:world-mode', sync);
  window.addEventListener('mcc:feed-scope', sync);
  window.addEventListener('mcc:door', sync);
  window.addEventListener('message', e => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const data = e.data || {};
    if (data.type === 'hu:globe-ready') sync();
    if (data.type === 'hu:world-news-selected' && typeof data.id === 'string') {
      window.MCC_WORLD_MODE?.set?.('posts');
      discussion(data.id);
    }
  });
  sync();
})();
